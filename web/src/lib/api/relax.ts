/**
 * Пустая выдача: вместо «ничего не найдено» считаем, какое условие ослабить.
 *
 * Каждый вариант проверяется настоящим поиском, поэтому число рядом с ним
 * правдиво. Варианты с нулём не показываются. Условия пользователя сами
 * не меняются: вариант применяется только по его нажатию.
 */

import { DEFAULT_STATUSES } from '../../data/dictionaries';
import type { Catalog } from './db';
import { countMatches, partyTotalMinor, runSearch } from './filters';
import type { SearchFilters } from './filters';
import { formatDay, formatRub, weekdayInRu, weekdayName } from './format';
import { addDays } from './time';
import type { ConstraintsPatch, EventsQuery, LocalizedText, Relaxation, RelaxationCode } from './types';

export interface RelaxOptions {
  /** Запрос каталога: тогда каждому варианту добавляется готовый ослабленный query. */
  baseQuery?: EventsQuery;
  /**
   * Можно ли предлагать снять фильтр по возрасту ребёнка. В каталоге это видимый
   * фильтр и снять его можно; ассистент возраст ребёнка сам не ослабляет.
   */
  allowChildAge: boolean;
  /** Сколько вариантов вернуть. По умолчанию 6. */
  limit?: number;
}

interface Candidate {
  code: RelaxationCode;
  label: LocalizedText;
  next: SearchFilters;
  patch: ConstraintsPatch;
  querySet: Partial<EventsQuery>;
  queryUnset: (keyof EventsQuery)[];
  /** Участвует ли вариант в запасном «снять несколько условий сразу». */
  removal: boolean;
}

const SEARCH_AHEAD_DAYS = 7;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function unsetPatch(...paths: string[]): ConstraintsPatch {
  return { reset: false, set: {}, unset: paths };
}

function roundUpToHundred(rub: number): number {
  return Math.ceil(rub / 100) * 100;
}

// ---------------------------------------------------------------------------
// Кандидаты по отдельным условиям
// ---------------------------------------------------------------------------

function dateCandidates(catalog: Catalog, filters: SearchFilters): Candidate[] {
  if (filters.date_from === null && filters.date_to === null) return [];
  const result: Candidate[] = [];
  const from = filters.date_from ?? catalog.today;
  const to = filters.date_to ?? from;

  // Ближайший другой день, в который что-то есть.
  for (let delta = 1; delta <= SEARCH_AHEAD_DAYS; delta += 1) {
    const days = [addDays(to, delta), addDays(from, -delta)].filter((day) => day >= catalog.today);
    const found = days.find((day) => countMatches(catalog, { ...filters, date_from: day, date_to: day }) > 0);
    if (found) {
      result.push({
        code: 'date',
        label: {
          ru: capitalize(`${weekdayInRu(found)}, ${formatDay(found, 'ru')}`),
          ba: capitalize(`${formatDay(found, 'ba')}, ${weekdayName(found, 'ba')}`),
        },
        next: { ...filters, date_from: found, date_to: found },
        patch: { reset: false, set: { hard: { date: { from: found, to: found } } }, unset: [] },
        querySet: { date_from: found, date_to: found },
        queryUnset: ['date'],
        removal: false,
      });
      break;
    }
  }

  result.push({
    code: 'date',
    label: { ru: 'В любой день', ba: 'Теләһә ҡайһы көндө' },
    next: { ...filters, date_from: null, date_to: null },
    patch: unsetPatch('hard.date'),
    querySet: {},
    queryUnset: ['date', 'date_from', 'date_to'],
    removal: true,
  });
  return result;
}

function budgetCandidates(catalog: Catalog, filters: SearchFilters): Candidate[] {
  const result: Candidate[] = [];
  const withoutPrice: SearchFilters = { ...filters, price_max: null, price_total_max: null, free_only: false };

  if (filters.price_max !== null && !filters.free_only) {
    const prices = runSearch(catalog, withoutPrice)
      .matches.map((match) => match.event.price_summary)
      .filter((summary) => summary.kind === 'from')
      .map((summary) => (summary.amount_minor ?? 0) / 100)
      .filter((rub) => rub > (filters.price_max as number));
    if (prices.length > 0) {
      const raised = roundUpToHundred(Math.min(...prices));
      result.push({
        code: 'budget',
        label: { ru: `До ${formatRub(raised)} за человека`, ba: `Бер кешегә ${formatRub(raised)} тиклем` },
        next: { ...filters, price_max: raised },
        patch: { reset: false, set: { hard: { max_price_per_person: raised, currency: 'RUB' } }, unset: [] },
        querySet: { price_max: raised },
        queryUnset: [],
        removal: false,
      });
    }
  }

  if (filters.price_total_max !== null && !filters.free_only) {
    const party = filters.party ?? { adults: 1, children: 0 };
    const totals = runSearch(catalog, withoutPrice)
      .matches.map((match) => partyTotalMinor(match.event, party))
      .filter((total): total is number => total !== null)
      .map((total) => total / 100)
      .filter((rub) => rub > (filters.price_total_max as number));
    if (totals.length > 0) {
      const raised = roundUpToHundred(Math.min(...totals));
      result.push({
        code: 'budget',
        label: { ru: `До ${formatRub(raised)} на всех`, ba: `Бөтәһенә ${formatRub(raised)} тиклем` },
        next: { ...filters, price_total_max: raised },
        patch: { reset: false, set: { hard: { max_total_price: raised, currency: 'RUB' } }, unset: [] },
        querySet: {},
        queryUnset: [],
        removal: false,
      });
    }
  }

  if (filters.free_only) {
    result.push({
      code: 'budget',
      label: { ru: 'Включая платные', ba: 'Түләүлеләре менән бергә' },
      next: { ...filters, free_only: false },
      patch: unsetPatch('hard.free_only'),
      querySet: {},
      queryUnset: ['free_only'],
      removal: filters.price_max === null && filters.price_total_max === null,
    });
  }

  if (filters.price_max !== null || filters.price_total_max !== null) {
    result.push({
      code: 'budget',
      label: { ru: 'Без ограничения цены', ba: 'Хаҡ сикләүһеҙ' },
      next: withoutPrice,
      patch: unsetPatch('hard.max_price_per_person', 'hard.max_total_price', 'hard.currency', 'hard.free_only'),
      querySet: {},
      queryUnset: ['price_max', 'free_only'],
      removal: true,
    });
  }
  return result;
}

function buildCandidates(catalog: Catalog, filters: SearchFilters, options: RelaxOptions): Candidate[] {
  const result: Candidate[] = [];

  if (filters.q) {
    result.push({
      code: 'query',
      label: { ru: 'Без поискового запроса', ba: 'Эҙләү һүҙҙәрһеҙ' },
      next: { ...filters, q: null },
      patch: unsetPatch('hard.title_query', 'hard.topic_query'),
      querySet: {},
      queryUnset: ['q'],
      removal: true,
    });
  }

  if (filters.time_from || filters.time_to || filters.fits_from || filters.fits_to) {
    result.push({
      code: 'time',
      label: { ru: 'В любое время', ba: 'Теләһә ҡайһы ваҡытта' },
      next: { ...filters, time_from: null, time_to: null, fits_from: null, fits_to: null },
      patch: unsetPatch('hard.time'),
      querySet: {},
      queryUnset: ['time_from', 'time_to'],
      removal: true,
    });
  }

  result.push(...dateCandidates(catalog, filters));
  result.push(...budgetCandidates(catalog, filters));

  if (filters.cities.length > 0) {
    result.push({
      code: 'city',
      label: { ru: 'По всей республике', ba: 'Бөтә республика буйынса' },
      next: { ...filters, cities: [] },
      patch: { reset: false, set: { hard: { region: 'bashkortostan' } }, unset: ['hard.cities'] },
      querySet: {},
      queryUnset: ['city'],
      removal: true,
    });
  }

  if (filters.categories.length > 0 || filters.categories_exclude.length > 0) {
    result.push({
      code: 'category',
      label: { ru: 'Любая категория', ba: 'Теләһә ҡайһы категория' },
      next: { ...filters, categories: [], categories_exclude: [] },
      patch: unsetPatch('hard.categories_any', 'hard.categories_exclude'),
      querySet: {},
      queryUnset: ['category'],
      removal: true,
    });
  }

  if (filters.audience !== null) {
    result.push({
      code: 'age',
      label: { ru: 'Не только детские события', ba: 'Балалар саралары ғына түгел' },
      next: { ...filters, audience: null },
      patch: unsetPatch('soft.audience'),
      querySet: {},
      queryUnset: ['audience'],
      removal: true,
    });
  }

  if (filters.age_ratings.length > 0) {
    result.push({
      code: 'age',
      label: { ru: 'Любая возрастная метка', ba: 'Теләһә ҡайһы йәш билдәһе' },
      next: { ...filters, age_ratings: [] },
      patch: unsetPatch('hard.required_age_rating'),
      querySet: {},
      queryUnset: ['age_rating'],
      removal: true,
    });
  }

  if (filters.age !== null && options.allowChildAge) {
    result.push({
      code: 'age',
      label: { ru: 'Без фильтра по возрасту', ba: 'Йәш буйынса фильтрһыҙ' },
      next: { ...filters, age: null },
      patch: unsetPatch('hard.participants'),
      querySet: {},
      queryUnset: ['age'],
      removal: true,
    });
  }

  if (filters.statuses_explicit || filters.availability.length > 0) {
    result.push({
      code: 'status',
      label: { ru: 'Только актуальные сеансы', ba: 'Актуаль сеанстар ғына' },
      next: { ...filters, statuses: [...DEFAULT_STATUSES], statuses_explicit: false, availability: [] },
      patch: unsetPatch('hard.statuses'),
      querySet: {},
      queryUnset: ['status'],
      removal: true,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Сборка ответа
// ---------------------------------------------------------------------------

function relaxQuery(
  base: EventsQuery,
  set: Partial<EventsQuery>,
  unset: readonly (keyof EventsQuery)[],
): EventsQuery {
  const next: EventsQuery = { ...base, ...set };
  for (const key of unset) delete next[key];
  // Ослабленный запрос всегда открывается с первой страницы.
  delete next.page;
  return next;
}

function toRelaxation(
  candidate: Candidate,
  count: number,
  options: RelaxOptions,
  codes: RelaxationCode[] = [candidate.code],
): Relaxation {
  const relaxation: Relaxation = {
    code: candidate.code,
    codes,
    label: candidate.label,
    patch: candidate.patch,
    count,
  };
  if (options.baseQuery) {
    relaxation.query = relaxQuery(options.baseQuery, candidate.querySet, candidate.queryUnset);
  }
  return relaxation;
}

/** Когда по одному условию ничего не находится: снимаем условия по очереди, пока не появятся события. */
function combinedRelaxation(
  catalog: Catalog,
  filters: SearchFilters,
  options: RelaxOptions,
): Relaxation | null {
  let current = filters;
  const used: Candidate[] = [];

  // Список строится заново после каждого шага: снятое условие из него исчезает.
  for (let step = 0; step < 12; step += 1) {
    const next = buildCandidates(catalog, current, options).find((candidate) => candidate.removal);
    if (!next) return null;
    used.push(next);
    current = next.next;
    const count = countMatches(catalog, current);
    if (count === 0) continue;

    const merged: Candidate = {
      code: used[0].code,
      label: {
        ru: capitalize(used.map((item) => item.label.ru.toLowerCase()).join(', ')),
        ba: capitalize(used.map((item) => item.label.ba.toLowerCase()).join(', ')),
      },
      next: current,
      patch: {
        reset: false,
        set: {
          hard: Object.assign({}, ...used.map((item) => item.patch.set.hard ?? {})),
          soft: Object.assign({}, ...used.map((item) => item.patch.set.soft ?? {})),
        },
        unset: [...new Set(used.flatMap((item) => item.patch.unset))],
      },
      querySet: Object.assign({}, ...used.map((item) => item.querySet)),
      queryUnset: [...new Set(used.flatMap((item) => item.queryUnset))],
      removal: true,
    };
    return toRelaxation(merged, count, options, [...new Set(used.map((item) => item.code))]);
  }
  return null;
}

/**
 * Варианты ослабить условия для пустой выдачи. Каждый вариант меняет одно условие;
 * если по одному ничего не находится, возвращается один вариант со снятием нескольких.
 */
export function buildRelaxations(catalog: Catalog, filters: SearchFilters, options: RelaxOptions): Relaxation[] {
  const limit = options.limit ?? 6;
  const single = buildCandidates(catalog, filters, options)
    .map((candidate) => ({ candidate, count: countMatches(catalog, candidate.next) }))
    .filter((item) => item.count > 0)
    .map((item) => toRelaxation(item.candidate, item.count, options));
  if (single.length > 0) return single.slice(0, limit);

  const combined = combinedRelaxation(catalog, filters, options);
  return combined ? [combined] : [];
}
