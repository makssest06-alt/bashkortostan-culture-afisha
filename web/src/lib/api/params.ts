/**
 * Разбор и проверка параметров каталога (GET /api/v1/events и /api/v1/facets),
 * а также обратное действие: сборка строки запроса из условий.
 *
 * Модуль чистый: им пользуются и обработчики API, и страница /events,
 * которая получает те же параметры в адресной строке.
 */

import {
  AGE_RATINGS,
  CATEGORIES,
  CITIES,
  OCCURRENCE_STATUSES,
  isAgeRating,
  isCategoryId,
  isCityId,
  isOccurrenceStatus,
} from '../../data/dictionaries';
import { isValidDate, isValidTime } from './time';
import type {
  AgeRating,
  ApiErrorDetail,
  CategoryId,
  CityId,
  DatePreset,
  EventsQuery,
  OccurrenceStatus,
  SortKey,
} from './types';

export type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: ApiErrorDetail[] };

const DATE_PRESETS: readonly DatePreset[] = ['today', 'tomorrow', 'weekend', 'week'];
const SORT_KEYS: readonly SortKey[] = ['date', 'price', 'popularity'];
const TRUE_VALUES = ['1', 'true', 'yes'];
const FALSE_VALUES = ['0', 'false', 'no'];

export const MAX_QUERY_LENGTH = 100;
const MAX_PRICE = 1_000_000;
const MAX_AGE = 120;
const MAX_PAGE = 1000;
const MAX_PAGE_SIZE = 50;

function read(raw: RawParams, name: string): string | undefined {
  if (raw instanceof URLSearchParams) {
    const values = raw.getAll(name);
    return values.length > 0 ? values.join(',') : undefined;
  }
  const value = raw[name];
  if (Array.isArray(value)) return value.join(',');
  return value;
}

function readList(raw: RawParams, name: string): string[] {
  const value = read(raw, name);
  if (value === undefined) return [];
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function readInteger(
  raw: RawParams,
  name: string,
  min: number,
  max: number,
  issues: ApiErrorDetail[],
): number | undefined {
  const value = read(raw, name)?.trim();
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    issues.push({ field: name, message: `Параметр ${name} должен быть целым числом от ${min} до ${max}` });
    return undefined;
  }
  return Number(value);
}

function readBoolean(raw: RawParams, name: string, issues: ApiErrorDetail[]): boolean | undefined {
  const value = read(raw, name)?.trim().toLowerCase();
  if (value === undefined || value === '') return undefined;
  if (TRUE_VALUES.includes(value)) return true;
  if (FALSE_VALUES.includes(value)) return false;
  issues.push({ field: name, message: `Параметр ${name} принимает значения true или false` });
  return undefined;
}

/** «6+», «6» и «6 » (плюс в адресе превращается в пробел) приводятся к метке «6+». */
function normalizeAgeRating(value: string): string {
  return `${value.replace(/\+/g, '').trim()}+`;
}

/** Проверяет параметры каталога. Неизвестные параметры игнорируются. */
export function parseEventsQuery(raw: RawParams): ParseResult<EventsQuery> {
  const issues: ApiErrorDetail[] = [];
  const query: EventsQuery = {};

  const cities = readList(raw, 'city');
  const badCity = cities.find((city) => !isCityId(city));
  if (badCity) {
    issues.push({
      field: 'city',
      message: `Неизвестный город «${badCity}». Допустимые значения: ${CITIES.map((city) => city.slug).join(', ')}`,
    });
  } else if (cities.length > 0) {
    query.city = cities as CityId[];
  }

  const categories = readList(raw, 'category');
  const badCategory = categories.find((category) => !isCategoryId(category));
  if (badCategory) {
    issues.push({
      field: 'category',
      message: `Неизвестная категория «${badCategory}». Допустимые значения: ${CATEGORIES.map((item) => item.id).join(', ')}`,
    });
  } else if (categories.length > 0) {
    query.category = categories as CategoryId[];
  }

  const date = read(raw, 'date')?.trim();
  const dateFrom = read(raw, 'date_from')?.trim();
  const dateTo = read(raw, 'date_to')?.trim();
  if (date) {
    if (dateFrom || dateTo) {
      issues.push({ field: 'date', message: 'Укажите либо date, либо date_from и date_to, но не всё вместе' });
    } else if ((DATE_PRESETS as readonly string[]).includes(date)) {
      query.date = date as DatePreset;
    } else if (isValidDate(date)) {
      query.date_from = date;
      query.date_to = date;
    } else {
      issues.push({
        field: 'date',
        message: `Параметр date принимает ${DATE_PRESETS.join(', ')} или дату в формате ГГГГ-ММ-ДД`,
      });
    }
  } else {
    if (dateFrom) {
      if (isValidDate(dateFrom)) query.date_from = dateFrom;
      else issues.push({ field: 'date_from', message: 'Параметр date_from должен быть датой в формате ГГГГ-ММ-ДД' });
    }
    if (dateTo) {
      if (isValidDate(dateTo)) query.date_to = dateTo;
      else issues.push({ field: 'date_to', message: 'Параметр date_to должен быть датой в формате ГГГГ-ММ-ДД' });
    }
    if (query.date_from && query.date_to && query.date_from > query.date_to) {
      issues.push({ field: 'date_to', message: 'Дата date_to не может быть раньше date_from' });
    }
  }

  for (const name of ['time_from', 'time_to'] as const) {
    const value = read(raw, name)?.trim();
    if (!value) continue;
    if (isValidTime(value)) query[name] = value;
    else issues.push({ field: name, message: `Параметр ${name} должен быть временем в формате ЧЧ:ММ` });
  }
  if (query.time_from && query.time_to && query.time_from > query.time_to) {
    issues.push({ field: 'time_to', message: 'Время time_to не может быть раньше time_from' });
  }

  const priceMax = readInteger(raw, 'price_max', 0, MAX_PRICE, issues);
  if (priceMax !== undefined) query.price_max = priceMax;

  const freeOnly = readBoolean(raw, 'free_only', issues) ?? readBoolean(raw, 'free', issues);
  if (freeOnly) query.free_only = true;

  const age = readInteger(raw, 'age', 0, MAX_AGE, issues);
  if (age !== undefined) query.age = age;

  const ratings = readList(raw, 'age_rating').map(normalizeAgeRating);
  const badRating = ratings.find((rating) => !isAgeRating(rating));
  if (badRating) {
    issues.push({
      field: 'age_rating',
      message: `Неизвестная возрастная метка «${badRating}». Допустимые значения: ${AGE_RATINGS.map((item) => item.id).join(', ')}`,
    });
  } else if (ratings.length > 0) {
    query.age_rating = [...new Set(ratings)] as AgeRating[];
  }

  const audience = read(raw, 'audience')?.trim();
  if (audience) {
    if (audience === 'kids') query.audience = 'kids';
    else issues.push({ field: 'audience', message: 'Параметр audience принимает только значение kids' });
  }

  const statuses = readList(raw, 'status');
  if (statuses.includes('all')) {
    query.status = [...OCCURRENCE_STATUSES];
  } else {
    const badStatus = statuses.find((status) => !isOccurrenceStatus(status));
    if (badStatus) {
      issues.push({
        field: 'status',
        message: `Неизвестный статус «${badStatus}». Допустимые значения: ${OCCURRENCE_STATUSES.join(', ')}, all`,
      });
    } else if (statuses.length > 0) {
      query.status = statuses as OccurrenceStatus[];
    }
  }

  const q = read(raw, 'q')?.trim();
  if (q) {
    if (q.length > MAX_QUERY_LENGTH) {
      issues.push({ field: 'q', message: `Поисковый запрос не длиннее ${MAX_QUERY_LENGTH} знаков` });
    } else {
      query.q = q;
    }
  }

  const sort = read(raw, 'sort')?.trim();
  if (sort) {
    if ((SORT_KEYS as readonly string[]).includes(sort)) query.sort = sort as SortKey;
    else issues.push({ field: 'sort', message: `Параметр sort принимает значения ${SORT_KEYS.join(', ')}` });
  }

  const page = readInteger(raw, 'page', 1, MAX_PAGE, issues);
  if (page !== undefined) query.page = page;
  const pageSize = readInteger(raw, 'page_size', 1, MAX_PAGE_SIZE, issues);
  if (pageSize !== undefined) query.page_size = pageSize;

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: query };
}

/** Собирает параметры адресной строки из условий. Пустые условия пропускаются. */
export function eventsQueryToParams(query: EventsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.city?.length) params.set('city', query.city.join(','));
  if (query.category?.length) params.set('category', query.category.join(','));
  if (query.date) params.set('date', query.date);
  if (query.date_from) params.set('date_from', query.date_from);
  if (query.date_to) params.set('date_to', query.date_to);
  if (query.time_from) params.set('time_from', query.time_from);
  if (query.time_to) params.set('time_to', query.time_to);
  if (query.price_max !== undefined) params.set('price_max', String(query.price_max));
  if (query.free_only) params.set('free', '1');
  if (query.age !== undefined) params.set('age', String(query.age));
  if (query.age_rating?.length) params.set('age_rating', query.age_rating.join(','));
  if (query.audience) params.set('audience', query.audience);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.sort) params.set('sort', query.sort);
  if (query.page !== undefined && query.page > 1) params.set('page', String(query.page));
  if (query.page_size !== undefined) params.set('page_size', String(query.page_size));
  return params;
}

/** Адрес страницы каталога с условиями: `/events?city=ufa&date=weekend`. */
export function eventsHref(query: EventsQuery = {}, basePath = '/events'): string {
  const search = eventsQueryToParams(query).toString();
  return search ? `${basePath}?${search}` : basePath;
}
