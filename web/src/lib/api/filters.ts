/**
 * Ядро поиска: детерминированные фильтры по событиям и сеансам.
 *
 * Правило, на котором держится доверие к выдаче: неизвестное не считается
 * подходящим. Событие с неуказанной ценой не проходит фильтр «до N рублей»,
 * событие без возрастной метки не проходит фильтр по возрасту ребёнка.
 * Такие события не теряются молча: они считаются в hidden_unknown_*.
 */

import { DEFAULT_STATUSES, KIDS_TAG, ageRatingMin, getCategory, getCity } from '../../data/dictionaries';
import type { Catalog } from './db';
import { startMs } from './db';
import { matchesAllTokens } from './text';
import { addDays, startOfLocalDayMs, valueDate, valueTime, weekRange, weekendRange } from './time';
import type {
  AfishaEvent,
  AgeRating,
  AudienceFilter,
  Availability,
  EventsQuery,
  Occurrence,
  OccurrenceStatus,
  SortKey,
} from './types';

const MS_DAY = 86_400_000;

/** Состав группы для проверки общего бюджета. */
export interface Party {
  adults: number;
  children: number;
}

/** Нормализованные условия поиска: общий язык каталога и ассистента. */
export interface SearchFilters {
  cities: string[];
  categories: string[];
  categories_exclude: string[];
  /** Границы включаются. null у date_from означает «с сегодняшнего дня». */
  date_from: string | null;
  date_to: string | null;
  /** Начало сеанса не раньше и не позже. */
  time_from: string | null;
  time_to: string | null;
  /** Сеанс должен целиком поместиться в интервал. */
  fits_from: string | null;
  fits_to: string | null;
  /** Цена за человека в рублях. */
  price_max: number | null;
  /** Общий бюджет в рублях на состав party. */
  price_total_max: number | null;
  party: Party | null;
  free_only: boolean;
  /** Возраст самого младшего участника. */
  age: number | null;
  age_ratings: AgeRating[];
  audience: AudienceFilter | null;
  statuses: OccurrenceStatus[];
  /** Статусы задал пользователь, а не подставлены по умолчанию. */
  statuses_explicit: boolean;
  availability: Availability[];
  q: string | null;
}

export interface SearchMatch {
  event: AfishaEvent;
  /** Подходящие сеансы по возрастанию даты. */
  occurrences: Occurrence[];
  /** Ближайший подходящий сеанс. */
  primary: Occurrence;
}

export interface SearchOutcome {
  matches: SearchMatch[];
  hidden_unknown_price: number;
  hidden_unknown_age: number;
}

type Verdict = 'ok' | 'fail' | 'unknown';

export function emptyFilters(): SearchFilters {
  return {
    cities: [],
    categories: [],
    categories_exclude: [],
    date_from: null,
    date_to: null,
    time_from: null,
    time_to: null,
    fits_from: null,
    fits_to: null,
    price_max: null,
    price_total_max: null,
    party: null,
    free_only: false,
    age: null,
    age_ratings: [],
    audience: null,
    statuses: [...DEFAULT_STATUSES],
    statuses_explicit: false,
    availability: [],
    q: null,
  };
}

/** Переводит параметры каталога в условия поиска: готовые периоды становятся датами. */
export function resolveQuery(query: EventsQuery, today: string): SearchFilters {
  const filters = emptyFilters();
  filters.cities = [...(query.city ?? [])];
  filters.categories = [...(query.category ?? [])];

  if (query.date === 'today') {
    filters.date_from = today;
    filters.date_to = today;
  } else if (query.date === 'tomorrow') {
    filters.date_from = addDays(today, 1);
    filters.date_to = addDays(today, 1);
  } else if (query.date === 'weekend') {
    const range = weekendRange(today);
    filters.date_from = range.from;
    filters.date_to = range.to;
  } else if (query.date === 'week') {
    const range = weekRange(today);
    filters.date_from = range.from;
    filters.date_to = range.to;
  } else {
    filters.date_from = query.date_from ?? null;
    filters.date_to = query.date_to ?? null;
  }

  filters.time_from = query.time_from ?? null;
  filters.time_to = query.time_to ?? null;
  filters.price_max = query.price_max ?? null;
  filters.free_only = query.free_only === true;
  filters.age = query.age ?? null;
  filters.age_ratings = [...(query.age_rating ?? [])];
  filters.audience = query.audience ?? null;
  if (query.status && query.status.length > 0) {
    filters.statuses = [...query.status];
    filters.statuses_explicit = true;
  }
  const q = query.q?.trim();
  filters.q = q ? q : null;
  return filters;
}

// ---------------------------------------------------------------------------
// Проверки события
// ---------------------------------------------------------------------------

function worst(...verdicts: Verdict[]): Verdict {
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'ok';
}

/** Стоимость похода для состава группы в копейках или null, если цена неизвестна. */
export function partyTotalMinor(event: AfishaEvent, party: Party): number | null {
  const summary = event.price_summary;
  if (summary.kind === 'unknown') return null;
  const general = summary.kind === 'free' ? 0 : (summary.amount_minor ?? 0);
  const childOffer = event.offers.find((offer) => offer.audience === 'child');
  let child = general;
  if (childOffer) {
    if (childOffer.is_free) child = 0;
    else if (childOffer.amount_minor !== null) child = childOffer.amount_minor;
  }
  return party.adults * general + party.children * child;
}

function checkPrice(event: AfishaEvent, filters: SearchFilters): Verdict {
  const summary = event.price_summary;
  const verdicts: Verdict[] = [];
  if (filters.free_only) {
    verdicts.push(summary.kind === 'free' ? 'ok' : summary.kind === 'unknown' ? 'unknown' : 'fail');
  }
  if (filters.price_max !== null) {
    if (summary.kind === 'unknown') verdicts.push('unknown');
    else if (summary.kind === 'free') verdicts.push('ok');
    else verdicts.push((summary.amount_minor ?? 0) <= filters.price_max * 100 ? 'ok' : 'fail');
  }
  if (filters.price_total_max !== null) {
    const total = partyTotalMinor(event, filters.party ?? { adults: 1, children: 0 });
    if (total === null) verdicts.push('unknown');
    else verdicts.push(total <= filters.price_total_max * 100 ? 'ok' : 'fail');
  }
  return worst(...verdicts);
}

function checkAge(event: AfishaEvent, filters: SearchFilters): Verdict {
  const rating = event.age_rating;
  const verdicts: Verdict[] = [];
  if (filters.age !== null) {
    if (rating === null) verdicts.push('unknown');
    else verdicts.push(ageRatingMin(rating) <= filters.age ? 'ok' : 'fail');
  }
  if (filters.age_ratings.length > 0) {
    if (rating === null) verdicts.push('unknown');
    else verdicts.push(filters.age_ratings.includes(rating) ? 'ok' : 'fail');
  }
  if (filters.audience === 'kids') {
    if (event.tags.includes(KIDS_TAG) || rating === '0+' || rating === '6+') verdicts.push('ok');
    else verdicts.push(rating === null ? 'unknown' : 'fail');
  }
  return worst(...verdicts);
}

function searchableText(event: AfishaEvent): string {
  const city = getCity(event.venue.city);
  const category = getCategory(event.category);
  return [
    event.title,
    event.title_ba ?? '',
    event.description,
    event.venue.name,
    event.organizer ?? '',
    event.tags.join(' '),
    city ? `${city.name.ru} ${city.name.ba} ${city.name_in.ru}` : '',
    category ? `${category.name.ru} ${category.name_one.ru} ${category.name.ba}` : '',
  ].join(' ');
}

function checkEventBasics(event: AfishaEvent, filters: SearchFilters): boolean {
  if (filters.cities.length > 0 && !filters.cities.includes(event.venue.city)) return false;
  if (filters.categories.length > 0 && !filters.categories.includes(event.category)) return false;
  if (filters.categories_exclude.includes(event.category)) return false;
  if (filters.q && !matchesAllTokens(searchableText(event), filters.q)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Проверки сеанса
// ---------------------------------------------------------------------------

function occurrenceMatches(occurrence: Occurrence, filters: SearchFilters, today: string): boolean {
  // Прошедшие сеансы в выдачу не попадают никогда.
  if (occurrence.is_past) return false;
  if (!filters.statuses.includes(occurrence.status)) return false;
  if (filters.availability.length > 0 && !filters.availability.includes(occurrence.availability)) return false;

  const firstDay = valueDate(occurrence.start);
  const lastDay =
    occurrence.end && occurrence.end.precision === 'date' ? valueDate(occurrence.end) : firstDay;
  const from = filters.date_from && filters.date_from > today ? filters.date_from : today;
  // Запрошенный период целиком в прошлом: показывать нечего.
  if (filters.date_to && filters.date_to < from) return false;
  if (lastDay < from) return false;
  if (filters.date_to && firstDay > filters.date_to) return false;

  const wantsStartWindow = filters.time_from !== null || filters.time_to !== null;
  const wantsFit = filters.fits_from !== null || filters.fits_to !== null;
  if (wantsStartWindow || wantsFit) {
    const start = valueTime(occurrence.start);
    // Время неизвестно: нельзя утверждать, что сеанс попадает в окно.
    if (start === null) return false;
    if (filters.time_from && start < filters.time_from) return false;
    if (filters.time_to && start > filters.time_to) return false;
    if (wantsFit) {
      if (filters.fits_from && start < filters.fits_from) return false;
      if (filters.fits_to) {
        const end = occurrence.end ? valueTime(occurrence.end) : null;
        const sameDay = occurrence.end ? valueDate(occurrence.end) === firstDay : false;
        if (end === null || !sameDay || end > filters.fits_to) return false;
      }
    }
  }
  return true;
}

/** Ключ сортировки сеанса. Выставка с периодом встаёт в конец дня, с которого её можно посетить. */
export function occurrenceSortMs(occurrence: Occurrence, filters: SearchFilters, today: string): number {
  if (occurrence.start.precision === 'minute') return startMs(occurrence.start);
  const lower = filters.date_from && filters.date_from > today ? filters.date_from : today;
  const first = valueDate(occurrence.start);
  const day = first > lower ? first : lower;
  return startOfLocalDayMs(day) + MS_DAY - 60_000;
}

// ---------------------------------------------------------------------------
// Поиск
// ---------------------------------------------------------------------------

/** Применяет все условия и возвращает события с подходящими сеансами (без сортировки по условию запроса). */
export function runSearch(catalog: Catalog, filters: SearchFilters): SearchOutcome {
  const matches: SearchMatch[] = [];
  let hiddenPrice = 0;
  let hiddenAge = 0;

  for (const event of catalog.events) {
    if (!checkEventBasics(event, filters)) continue;
    const occurrences = event.occurrences
      .filter((occurrence) => occurrenceMatches(occurrence, filters, catalog.today))
      .sort(
        (a, b) =>
          occurrenceSortMs(a, filters, catalog.today) - occurrenceSortMs(b, filters, catalog.today) ||
          a.id.localeCompare(b.id),
      );
    if (occurrences.length === 0) continue;

    const price = checkPrice(event, filters);
    const age = checkAge(event, filters);
    if (price === 'fail' || age === 'fail') continue;
    if (price === 'unknown' || age === 'unknown') {
      // Событие подошло бы по всему остальному, но ключевое поле не заполнено.
      if (price === 'unknown') hiddenPrice += 1;
      if (age === 'unknown') hiddenAge += 1;
      continue;
    }
    matches.push({ event, occurrences, primary: occurrences[0] });
  }

  return { matches, hidden_unknown_price: hiddenPrice, hidden_unknown_age: hiddenAge };
}

export function countMatches(catalog: Catalog, filters: SearchFilters): number {
  return runSearch(catalog, filters).matches.length;
}

function priceRank(event: AfishaEvent): number {
  const summary = event.price_summary;
  if (summary.kind === 'free') return 0;
  if (summary.kind === 'from') return summary.amount_minor ?? 0;
  return Number.MAX_SAFE_INTEGER;
}

/** Возвращает новый массив в порядке запрошенной сортировки. Порядок детерминирован. */
export function sortMatches(
  matches: readonly SearchMatch[],
  sort: SortKey,
  filters: SearchFilters,
  today: string,
): SearchMatch[] {
  const byDate = (a: SearchMatch, b: SearchMatch): number =>
    occurrenceSortMs(a.primary, filters, today) - occurrenceSortMs(b.primary, filters, today);
  const byId = (a: SearchMatch, b: SearchMatch): number => a.event.id.localeCompare(b.event.id);
  const byPopularity = (a: SearchMatch, b: SearchMatch): number => b.event.popularity - a.event.popularity;

  const sorted = [...matches];
  if (sort === 'price') {
    sorted.sort((a, b) => priceRank(a.event) - priceRank(b.event) || byDate(a, b) || byId(a, b));
  } else if (sort === 'popularity') {
    sorted.sort((a, b) => byPopularity(a, b) || byDate(a, b) || byId(a, b));
  } else {
    sorted.sort((a, b) => byDate(a, b) || byPopularity(a, b) || byId(a, b));
  }
  return sorted;
}
