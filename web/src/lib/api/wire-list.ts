/**
 * Ответ списка событий от бэка → форма, с которой работает интерфейс.
 *
 * Контракт v1 (contracts/api.openapi.yaml, EventList) обязывает бэк отдавать только
 * items, page, page_size, total, total_pages. Счётчики, варианты ослабления и прочее —
 * необязательные расширения, и их форма в контракте проще, чем внутри сайта:
 *   facets.age_limits [{ value: 6, count }]   → facets.age_ratings [{ id: '6+', name, count }]
 *   FacetEntry.name и Relaxation.label строкой → подпись на двух языках из справочников сайта
 * Здесь недостающее достраивается, а контрактная форма переводится во внутреннюю.
 * Модуль без серверных зависимостей: его импортирует клиент.
 */

import { AGE_RATINGS, CATEGORIES, CITIES, DEFAULT_STATUSES } from '../../data/dictionaries';
import { localNow } from './time';
import type {
  AgeRating,
  AppliedFilters,
  CategoryId,
  CityId,
  EventListItem,
  EventsListResponse,
  EventsQuery,
  FacetEntry,
  Facets,
  Relaxation,
} from './types';
import type { LocalizedText } from '../i18n/lang';

const TIMEZONE = 'Asia/Yekaterinburg' as const;

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

function text(value: unknown, known?: LocalizedText): LocalizedText {
  if (known) return known;
  if (isObject(value) && typeof value.ru === 'string') return { ru: value.ru, ba: typeof value.ba === 'string' ? value.ba : value.ru };
  const plain = typeof value === 'string' ? value : '';
  return { ru: plain, ba: plain };
}

function entries<T extends string>(raw: unknown, names: (id: string) => LocalizedText | undefined): FacetEntry<T>[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Raw => isObject(entry) && typeof entry.id === 'string')
    .map((entry) => ({ id: entry.id as T, name: text(entry.name, names(entry.id as string)), count: count(entry.count) }));
}

function ageEntries(raw: Raw): FacetEntry<AgeRating | 'unknown'>[] {
  // Форма сайта: age_ratings с id «6+».
  if (Array.isArray(raw.age_ratings)) {
    return entries<AgeRating | 'unknown'>(raw.age_ratings, (id) => AGE_RATINGS.find((age) => age.id === id)?.label);
  }
  // Форма контракта: age_limits с числом value (null — возраст не указан).
  if (!Array.isArray(raw.age_limits)) return [];
  return raw.age_limits.filter(isObject).map((entry) => {
    const id = (typeof entry.value === 'number' ? `${entry.value}+` : 'unknown') as AgeRating | 'unknown';
    const known = AGE_RATINGS.find((age) => age.id === id)?.label;
    return { id, name: known ?? { ru: 'Не указан', ba: 'Күрһәтелмәгән' }, count: count(entry.count) };
  });
}

/** Счётчики фильтров. null: бэк их не прислал, и интерфейс показывает фильтры без чисел. */
export function normalizeFacets(raw: unknown): Facets | null {
  if (!isObject(raw)) return null;
  const price = isObject(raw.price) ? raw.price : {};
  return {
    cities: entries<CityId>(raw.cities, (id) => CITIES.find((city) => city.slug === id)?.name),
    categories: entries<CategoryId>(raw.categories, (id) => CATEGORIES.find((category) => category.id === id)?.name),
    age_ratings: ageEntries(raw),
    price: { free: count(price.free), paid: count(price.paid), unknown: count(price.unknown) },
    total: count(raw.total),
  };
}

/**
 * Варианты ослабить условия. Каталогу нужен готовый запрос (`query`): вариант без него
 * применить нечем, поэтому он не показывается.
 */
export function normalizeRelaxations(raw: unknown): Relaxation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Raw => isObject(entry) && typeof entry.code === 'string' && isObject(entry.query))
    .map((entry) => ({
      ...(entry as unknown as Relaxation),
      codes: Array.isArray(entry.codes) ? (entry.codes as Relaxation['codes']) : [entry.code as Relaxation['code']],
      label: text(entry.label),
      patch: isObject(entry.patch) ? (entry.patch as unknown as Relaxation['patch']) : { reset: false, set: {}, unset: [] },
      count: count(entry.count),
    }));
}

/** Применённые условия, если бэк их не вернул: то, что сайт сам отправил в запросе. */
export function appliedFromQuery(query: EventsQuery): AppliedFilters {
  const service = new Set<keyof EventsQuery>(['page', 'page_size', 'sort']);
  return {
    city: query.city ?? [],
    category: query.category ?? [],
    date: query.date ?? null,
    date_from: query.date_from ?? null,
    date_to: query.date_to ?? null,
    time_from: query.time_from ?? null,
    time_to: query.time_to ?? null,
    price_max: query.price_max ?? null,
    free_only: Boolean(query.free_only),
    age: query.age ?? null,
    age_rating: query.age_rating ?? [],
    audience: query.audience ?? null,
    status: query.status ?? [...DEFAULT_STATUSES],
    q: query.q ?? null,
    sort: query.sort ?? 'date',
    active: (Object.keys(query) as (keyof EventsQuery)[]).filter((key) => !service.has(key) && query[key] !== undefined),
  };
}

/** Собирает ответ списка: обязательные поля контракта плюс достроенные расширения. */
export function normalizeEventsList(raw: Raw, items: EventListItem[], query: EventsQuery = {}): EventsListResponse {
  const pageSize = count(raw.page_size) || items.length || 1;
  const total = typeof raw.total === 'number' ? raw.total : items.length;
  return {
    items,
    total,
    page: count(raw.page) || 1,
    page_size: pageSize,
    total_pages: typeof raw.total_pages === 'number' ? raw.total_pages : Math.ceil(total / pageSize),
    facets: normalizeFacets(raw.facets),
    applied: isObject(raw.applied) ? (raw.applied as unknown as AppliedFilters) : appliedFromQuery(query),
    hidden_unknown_price: count(raw.hidden_unknown_price),
    hidden_unknown_age: count(raw.hidden_unknown_age),
    relaxations: normalizeRelaxations(raw.relaxations),
    reference_date: typeof raw.reference_date === 'string' ? raw.reference_date : localNow(new Date()).date,
    timezone: TIMEZONE,
  };
}
