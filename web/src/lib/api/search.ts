/**
 * Каталог событий: список с фильтрами, сортировкой, счётчиками и вариантами
 * ослабить условия при пустой выдаче. Это реализация GET /api/v1/events
 * и GET /api/v1/facets; обработчики маршрутов только разбирают параметры.
 */

import { loadCatalog } from './db';
import { computeFacets } from './facets';
import { resolveQuery, runSearch, sortMatches } from './filters';
import type { SearchFilters } from './filters';
import { buildRelaxations } from './relax';
import { TIMEZONE } from './time';
import type {
  AppliedFilters,
  CategoryId,
  CityId,
  EventListItem,
  EventsListResponse,
  EventsQuery,
  FacetsResponse,
  SortKey,
} from './types';

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_SORT: SortKey = 'date';

function activeKeys(query: EventsQuery): (keyof EventsQuery)[] {
  const keys: (keyof EventsQuery)[] = [];
  if (query.city?.length) keys.push('city');
  if (query.category?.length) keys.push('category');
  if (query.date) keys.push('date');
  if (query.date_from) keys.push('date_from');
  if (query.date_to) keys.push('date_to');
  if (query.time_from) keys.push('time_from');
  if (query.time_to) keys.push('time_to');
  if (query.price_max !== undefined) keys.push('price_max');
  if (query.free_only) keys.push('free_only');
  if (query.age !== undefined) keys.push('age');
  if (query.age_rating?.length) keys.push('age_rating');
  if (query.audience) keys.push('audience');
  if (query.status?.length) keys.push('status');
  if (query.q?.trim()) keys.push('q');
  return keys;
}

function buildApplied(query: EventsQuery, filters: SearchFilters, sort: SortKey): AppliedFilters {
  return {
    city: filters.cities as CityId[],
    category: filters.categories as CategoryId[],
    date: query.date ?? null,
    date_from: filters.date_from,
    date_to: filters.date_to,
    time_from: filters.time_from,
    time_to: filters.time_to,
    price_max: filters.price_max,
    free_only: filters.free_only,
    age: filters.age,
    age_rating: filters.age_ratings,
    audience: filters.audience,
    status: filters.statuses,
    q: filters.q,
    sort,
    active: activeKeys(query),
  };
}

/**
 * Список событий по условиям каталога.
 * @param now момент «сейчас»; в тестах передаётся явно, в бою берётся текущее время.
 */
export function searchEvents(query: EventsQuery = {}, now: Date = new Date()): EventsListResponse {
  const catalog = loadCatalog(now);
  const filters = resolveQuery(query, catalog.today);
  const sort = query.sort ?? DEFAULT_SORT;
  const pageSize = Math.min(Math.max(1, query.page_size ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = Math.max(1, query.page ?? 1);

  const outcome = runSearch(catalog, filters);
  const sorted = sortMatches(outcome.matches, sort, filters, catalog.today);
  const total = sorted.length;

  const items: EventListItem[] = sorted.slice((page - 1) * pageSize, page * pageSize).map((match) => ({
    ...match.event,
    matched_occurrence_ids: match.occurrences.map((occurrence) => occurrence.id),
    primary_occurrence_id: match.primary.id,
  }));

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
    facets: computeFacets(catalog, filters),
    applied: buildApplied(query, filters, sort),
    hidden_unknown_price: outcome.hidden_unknown_price,
    hidden_unknown_age: outcome.hidden_unknown_age,
    relaxations: total === 0 ? buildRelaxations(catalog, filters, { baseQuery: query, allowChildAge: true }) : [],
    reference_date: catalog.today,
    timezone: TIMEZONE,
  };
}

/** Счётчики по городам, категориям, возрасту и цене. Без условий: по всему каталогу. */
export function getFacetCounts(query: EventsQuery = {}, now: Date = new Date()): FacetsResponse {
  const catalog = loadCatalog(now);
  return computeFacets(catalog, resolveQuery(query, catalog.today));
}
