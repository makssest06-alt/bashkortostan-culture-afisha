/**
 * Условия каталога как чистые данные: ключ запроса, переключение значений, список активных чипов.
 * Источник истины один: адресная строка. Модуль без React и без сети.
 */

import { AGE_RATINGS, CATEGORIES, CITIES, DATE_PRESETS, getCategory, getCity } from '@/data/dictionaries';
import { formatDateRange, formatDay, formatNumber } from '@/lib/api/format';
import { eventsHref, eventsQueryToParams } from '@/lib/api/params';
import type { AgeRating, CategoryId, CityId, DatePreset, EventsQuery, SortKey } from '@/lib/api/types';
import type { Lang, TFunction } from '@/lib/i18n';
import { pick } from '@/lib/i18n/lang';

/**
 * Размер страницы каталога. Десять событий закрывают сетку без дыр и в две, и в три колонки
 * (ритм крупных карточек описан в catalog.module.css).
 */
export const PAGE_SIZE = 10;

export const PRICE_PRESETS = [500, 1000, 2000] as const;
export const MAX_PRICE = 1_000_000;

export const CITY_IDS: readonly CityId[] = CITIES.map((city) => city.slug);
export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((category) => category.id);
export const AGE_IDS: readonly AgeRating[] = AGE_RATINGS.map((rating) => rating.id);
export const DATE_PRESET_IDS: readonly DatePreset[] = DATE_PRESETS.map((preset) => preset.id);

/** Группы панели фильтров: по ним чип находит свой элемент управления. */
export type FilterGroup = 'search' | 'date' | 'city' | 'price' | 'age' | 'category';

/** Условия без пагинации: страницы догружает кнопка «Показать ещё», в адрес они не идут. */
export function normalizeQuery(query: EventsQuery): EventsQuery {
  const next: EventsQuery = { ...query };
  delete next.page;
  delete next.page_size;
  if (next.sort === 'date') delete next.sort;
  return next;
}

/** Ключ запроса: одинаковые условия дают одну строку, по ней лежит ответ в кэше. */
export function queryKey(query: EventsQuery): string {
  const params = eventsQueryToParams(normalizeQuery(query));
  params.sort();
  return params.toString();
}

/** Адрес каталога с условиями. */
export function catalogHref(query: EventsQuery): string {
  return eventsHref(normalizeQuery(query));
}

function toggleIn<T>(list: readonly T[] | undefined, value: T, order: readonly T[]): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  if (next.length === 0) return undefined;
  return order.filter((item) => next.includes(item));
}

export function toggleCity(query: EventsQuery, city: CityId): EventsQuery {
  return { ...query, city: toggleIn(query.city, city, CITY_IDS) };
}

export function toggleCategory(query: EventsQuery, category: CategoryId): EventsQuery {
  return { ...query, category: toggleIn(query.category, category, CATEGORY_IDS) };
}

export function toggleAgeRating(query: EventsQuery, rating: AgeRating): EventsQuery {
  return { ...query, age_rating: toggleIn(query.age_rating, rating, AGE_IDS) };
}

export function toggleAudienceKids(query: EventsQuery): EventsQuery {
  return { ...query, audience: query.audience === 'kids' ? undefined : 'kids' };
}

/** Готовый период и свой диапазон исключают друг друга (так требует API). */
export function setDatePreset(query: EventsQuery, preset: DatePreset): EventsQuery {
  return {
    ...query,
    date: query.date === preset ? undefined : preset,
    date_from: undefined,
    date_to: undefined,
  };
}

/** Своя граница периода. Если границы перепутаны, вторая подтягивается к изменённой. */
export function setDateBound(query: EventsQuery, bound: 'date_from' | 'date_to', value: string): EventsQuery {
  const next: EventsQuery = { ...query, date: undefined, [bound]: value || undefined };
  if (next.date_from && next.date_to && next.date_from > next.date_to) {
    if (bound === 'date_from') next.date_to = next.date_from;
    else next.date_from = next.date_to;
  }
  return next;
}

export function clearDate(query: EventsQuery): EventsQuery {
  return { ...query, date: undefined, date_from: undefined, date_to: undefined };
}

/** Потолок цены и «только бесплатно» вместе не имеют смысла: остаётся последнее выбранное. */
export function setPriceMax(query: EventsQuery, value: number | undefined): EventsQuery {
  return { ...query, price_max: value, free_only: value === undefined ? query.free_only : undefined };
}

export function toggleFreeOnly(query: EventsQuery): EventsQuery {
  return query.free_only
    ? { ...query, free_only: undefined }
    : { ...query, free_only: true, price_max: undefined };
}

export function setSort(query: EventsQuery, sort: SortKey): EventsQuery {
  return { ...query, sort: sort === 'date' ? undefined : sort };
}

export function setSearch(query: EventsQuery, text: string): EventsQuery {
  const q = text.trim();
  return { ...query, q: q || undefined };
}

/** Сброс всех условий: сортировка остаётся, это не фильтр. */
export function resetFilters(query: EventsQuery): EventsQuery {
  return query.sort ? { sort: query.sort } : {};
}

/** «1200» из поля ввода превращается в число рублей. Пусто или мусор: условия нет. */
export function parsePriceInput(text: string): number | undefined {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return Math.min(Number(digits), MAX_PRICE);
}

export interface ActiveChip {
  id: string;
  label: string;
  /** Группа панели, где это условие меняется. Нет группы: условие пришло ссылкой, его можно только снять. */
  group?: FilterGroup;
  /** Условия после снятия этого чипа. */
  without: EventsQuery;
}

/** Активные условия по порядку панели: дата, город, цена, возраст, категория, остальное. */
export function buildActiveChips(query: EventsQuery, t: TFunction, lang: Lang): ActiveChip[] {
  const chips: ActiveChip[] = [];

  if (query.q) {
    chips.push({ id: 'q', label: `«${query.q}»`, group: 'search', without: { ...query, q: undefined } });
  }

  if (query.date) {
    const key = `filters.date.${query.date}` as const;
    chips.push({ id: 'date', label: t(key), group: 'date', without: clearDate(query) });
  } else if (query.date_from && query.date_to) {
    chips.push({
      id: 'date',
      label: formatDateRange(query.date_from, query.date_to, lang),
      group: 'date',
      without: clearDate(query),
    });
  } else if (query.date_from) {
    chips.push({
      id: 'date',
      label: `${t('filters.date.from')} ${formatDay(query.date_from, lang)}`,
      group: 'date',
      without: clearDate(query),
    });
  } else if (query.date_to) {
    chips.push({
      id: 'date',
      label: `${t('filters.date.to')} ${formatDay(query.date_to, lang)}`,
      group: 'date',
      without: clearDate(query),
    });
  }

  if (query.time_from || query.time_to) {
    const parts = [
      query.time_from ? `${t('filters.time.from')} ${query.time_from}` : null,
      query.time_to ? `${t('filters.time.to')} ${query.time_to}` : null,
    ].filter(Boolean);
    chips.push({
      id: 'time',
      label: parts.join(', '),
      without: { ...query, time_from: undefined, time_to: undefined },
    });
  }

  for (const city of query.city ?? []) {
    const entry = getCity(city);
    chips.push({
      id: `city-${city}`,
      label: entry ? pick(entry.name, lang) : city,
      group: 'city',
      without: toggleCity(query, city),
    });
  }

  if (query.free_only) {
    chips.push({
      id: 'free',
      label: t('filters.price.freeOnly'),
      group: 'price',
      without: { ...query, free_only: undefined },
    });
  }
  if (query.price_max !== undefined) {
    chips.push({
      id: 'price',
      label: t('filters.price.max', { amount: formatNumber(query.price_max) }),
      group: 'price',
      without: { ...query, price_max: undefined },
    });
  }

  if (query.audience === 'kids') {
    chips.push({
      id: 'audience',
      label: t('filters.audience.kids'),
      group: 'age',
      without: { ...query, audience: undefined },
    });
  }
  if (query.age !== undefined) {
    chips.push({
      id: 'age',
      label: `${t('filters.age.child')}: ${query.age}`,
      group: 'age',
      without: { ...query, age: undefined },
    });
  }
  for (const rating of query.age_rating ?? []) {
    chips.push({ id: `rating-${rating}`, label: rating, group: 'age', without: toggleAgeRating(query, rating) });
  }

  for (const category of query.category ?? []) {
    const entry = getCategory(category);
    chips.push({
      id: `category-${category}`,
      label: entry ? pick(entry.name, lang) : category,
      group: 'category',
      without: toggleCategory(query, category),
    });
  }

  if (query.status?.length) {
    chips.push({ id: 'status', label: t('filters.status.all'), without: { ...query, status: undefined } });
  }

  return chips;
}
