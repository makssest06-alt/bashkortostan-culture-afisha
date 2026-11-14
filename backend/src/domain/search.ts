import { AGE_RATINGS, CATEGORIES, CITIES, DEFAULT_OCCURRENCE_STATUSES, OCCURRENCE_STATUSES, isCategoryId, isCitySlug } from './dictionaries.js';
import { normalizeText, toVenueSlug } from './identity.js';
import { addDays, formatRuDay, isValidHm, isValidYmd, localNow, resolveDatePreset } from './time.js';
import type {
  ApiErrorDetail,
  ApiEvent,
  ApiEventListItem,
  ApiOccurrence,
  CategoryId,
  CityId,
  DatePreset,
  LocalizedText,
  OccurrenceStatus,
  SortKey,
} from './types.js';

export interface SoftFilterHints {
  semantic_query?: string;
  preferences?: string[];
  preferred_categories?: string[];
  category_priority?: string[];
  avoid_categories?: string[];
  price_direction?: 'lower';
  prefer_free?: boolean;
  less_travel?: boolean;
  audience?: string;
}

export interface PartyParticipantsFilter {
  total?: number;
  adults?: number;
  children_count?: number;
  children_ages?: number[];
  participant_ages?: number[];
}

export interface ConstraintsPatchShape {
  reset: boolean;
  set: {
    hard?: Record<string, unknown>;
    soft?: Record<string, unknown>;
  };
  unset: string[];
}

export interface EventsSearchFilters {
  cities: CityId[];
  categories: CategoryId[];
  categories_exclude: CategoryId[];
  date_preset: DatePreset | null;
  date_from: string | null;
  date_to: string | null;
  time_from: string | null;
  time_to: string | null;
  fits_from?: string | null;
  fits_to?: string | null;
  price_max: number | null;
  max_total_price?: number | null;
  participants?: PartyParticipantsFilter | null;
  free_only: boolean;
  age: number | null;
  age_ratings: string[];
  audience: 'kids' | null;
  venue_id: string | null;
  venue_query?: string | null;
  geo_query?: string | null;
  title_query?: string | null;
  topic_query?: string | null;
  language: string | null;
  statuses: OccurrenceStatus[];
  statuses_explicit: boolean;
  q: string | null;
  soft?: SoftFilterHints | null;
  sort: SortKey;
  page: number;
  page_size: number;
}

const VALID_DATE_PRESETS: readonly DatePreset[] = ['today', 'tomorrow', 'weekend', 'week'];
const VALID_AGE_RATINGS = new Set<string>(AGE_RATINGS.map((a) => a.id));
const VALID_SORTS = new Set<SortKey>(['date', 'price', 'popularity']);

function readListParam(url: URL, name: string): string[] {
  const all = url.searchParams.getAll(name);
  if (all.length === 0) return [];
  const tokens = all
    .flatMap((v) => v.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(tokens)];
}

function readSingleParam(url: URL, name: string): string | undefined {
  const raw = url.searchParams.get(name)?.trim();
  return raw ? raw : undefined;
}

function parseBoolParam(url: URL, name: string, issues: ApiErrorDetail[]): boolean | undefined {
  const raw = readSingleParam(url, name)?.toLowerCase();
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  issues.push({ field: name, message: `Параметр ${name} должен быть true или false` });
  return undefined;
}

function parseIntParam(url: URL, name: string, min: number, max: number, issues: ApiErrorDetail[]): number | undefined {
  const raw = readSingleParam(url, name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    issues.push({ field: name, message: `Параметр ${name} должен быть целым числом от ${min} до ${max}` });
    return undefined;
  }
  const n = Number(raw);
  if (n < min || n > max) {
    issues.push({ field: name, message: `Параметр ${name} должен быть целым числом от ${min} до ${max}` });
    return undefined;
  }
  return n;
}

export function parseEventsSearchParams(
  url: URL,
  now: Date = new Date(),
): { ok: true; filters: EventsSearchFilters } | { ok: false; issues: ApiErrorDetail[] } {
  const issues: ApiErrorDetail[] = [];
  const { date: today } = localNow(now);

  const citiesRaw = readListParam(url, 'city');
  for (const c of citiesRaw) {
    if (!isCitySlug(c)) {
      issues.push({
        field: 'city',
        message: `Неизвестный город «${c}». Допустимые: ${CITIES.map((x) => x.slug).join(', ')}`,
      });
    }
  }

  const catsRaw = readListParam(url, 'category');
  for (const cat of catsRaw) {
    if (!isCategoryId(cat)) {
      issues.push({
        field: 'category',
        message: `Неизвестная категория «${cat}». Допустимые: ${CATEGORIES.map((x) => x.id).join(', ')}`,
      });
    }
  }

  const dateRaw = readSingleParam(url, 'date');
  const dateFromRaw = readSingleParam(url, 'date_from');
  const dateToRaw = readSingleParam(url, 'date_to');

  let datePreset: DatePreset | null = null;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;

  if (dateRaw) {
    if (dateFromRaw || dateToRaw) {
      issues.push({ field: 'date', message: 'Нельзя передавать date одновременно с date_from или date_to' });
    } else if ((VALID_DATE_PRESETS as readonly string[]).includes(dateRaw)) {
      datePreset = dateRaw as DatePreset;
      const resolved = resolveDatePreset(datePreset, today);
      dateFrom = resolved.from;
      dateTo = resolved.to;
    } else if (isValidYmd(dateRaw)) {
      dateFrom = dateRaw;
      dateTo = dateRaw;
    } else {
      issues.push({
        field: 'date',
        message: 'Параметр date принимает today, tomorrow, weekend, week или дату ГГГГ-ММ-ДД',
      });
    }
  } else {
    if (dateFromRaw) {
      if (isValidYmd(dateFromRaw)) dateFrom = dateFromRaw;
      else issues.push({ field: 'date_from', message: 'Параметр date_from должен быть в формате ГГГГ-ММ-ДД' });
    }
    if (dateToRaw) {
      if (isValidYmd(dateToRaw)) dateTo = dateToRaw;
      else issues.push({ field: 'date_to', message: 'Параметр date_to должен быть в формате ГГГГ-ММ-ДД' });
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      issues.push({ field: 'date_to', message: 'Дата date_to не может быть раньше date_from' });
    }
  }

  const timeFrom = readSingleParam(url, 'time_from') ?? null;
  if (timeFrom && !isValidHm(timeFrom)) {
    issues.push({ field: 'time_from', message: 'Параметр time_from должен быть в формате ЧЧ:ММ' });
  }
  const timeTo = readSingleParam(url, 'time_to') ?? null;
  if (timeTo && !isValidHm(timeTo)) {
    issues.push({ field: 'time_to', message: 'Параметр time_to должен быть в формате ЧЧ:ММ' });
  }
  if (timeFrom && timeTo && isValidHm(timeFrom) && isValidHm(timeTo) && timeFrom > timeTo) {
    issues.push({ field: 'time_to', message: 'Время time_to не может быть раньше time_from' });
  }

  const fitsFrom = readSingleParam(url, 'fits_from') ?? null;
  if (fitsFrom && !isValidHm(fitsFrom)) {
    issues.push({ field: 'fits_from', message: 'Параметр fits_from должен быть в формате ЧЧ:ММ' });
  }
  const fitsTo = readSingleParam(url, 'fits_to') ?? null;
  if (fitsTo && !isValidHm(fitsTo)) {
    issues.push({ field: 'fits_to', message: 'Параметр fits_to должен быть в формате ЧЧ:ММ' });
  }
  if (fitsFrom && fitsTo && isValidHm(fitsFrom) && isValidHm(fitsTo) && fitsFrom > fitsTo) {
    issues.push({ field: 'fits_to', message: 'Время fits_to не может быть раньше fits_from' });
  }

  const catsExcludeRaw = readListParam(url, 'category_exclude');
  for (const cat of catsExcludeRaw) {
    if (!isCategoryId(cat)) {
      issues.push({
        field: 'category_exclude',
        message: `Неизвестная категория «${cat}»`,
      });
    }
  }

  const priceMax = parseIntParam(url, 'price_max', 0, 1_000_000, issues) ?? null;
  const freeBool = parseBoolParam(url, 'free', issues);
  const freeOnlyBool = parseBoolParam(url, 'free_only', issues);
  const freeOnly = Boolean(freeBool || freeOnlyBool);

  const age = parseIntParam(url, 'age', 0, 120, issues) ?? null;

  const ageRatings = readListParam(url, 'age_rating').map((v) => `${v.replace(/\+/g, '').trim()}+`);
  for (const r of ageRatings) {
    if (!VALID_AGE_RATINGS.has(r)) {
      issues.push({ field: 'age_rating', message: `Неизвестная возрастная метка «${r}»` });
    }
  }

  const audienceRaw = readSingleParam(url, 'audience');
  let audience: 'kids' | null = null;
  if (audienceRaw) {
    if (audienceRaw === 'kids') audience = 'kids';
    else issues.push({ field: 'audience', message: 'Параметр audience принимает только значение kids' });
  }

  const statusRaw = readListParam(url, 'status');
  let statuses: OccurrenceStatus[] = [...DEFAULT_OCCURRENCE_STATUSES];
  let statusesExplicit = false;
  if (statusRaw.length > 0) {
    statusesExplicit = true;
    if (statusRaw.includes('all')) {
      statuses = [...OCCURRENCE_STATUSES];
    } else {
      for (const s of statusRaw) {
        if (!OCCURRENCE_STATUSES.includes(s as OccurrenceStatus)) {
          issues.push({ field: 'status', message: `Неизвестный статус сеанса «${s}»` });
        }
      }
      statuses = statusRaw as OccurrenceStatus[];
    }
  }

  const venueIdRaw = readSingleParam(url, 'venue_id') ?? null;
  const venueId = venueIdRaw ? toVenueSlug(venueIdRaw) : null;

  const languageRaw = readSingleParam(url, 'language') ?? null;
  if (languageRaw && !/^[a-z]{2,3}$/i.test(languageRaw)) {
    issues.push({ field: 'language', message: 'Параметр language должен быть кодом ISO 639 (ru, ba, tt)' });
  }

  const qRaw = readSingleParam(url, 'q') ?? null;
  if (qRaw && qRaw.length > 100) {
    issues.push({ field: 'q', message: 'Поисковый запрос не длиннее 100 знаков' });
  }

  const sortRaw = readSingleParam(url, 'sort') ?? 'date';
  if (!VALID_SORTS.has(sortRaw as SortKey)) {
    issues.push({ field: 'sort', message: 'Параметр sort принимает значения: date, price, popularity' });
  }

  const page = parseIntParam(url, 'page', 1, 1000, issues) ?? 1;
  const pageSize = parseIntParam(url, 'page_size', 1, 50, issues) ?? 12;

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    filters: {
      cities: citiesRaw as CityId[],
      categories: catsRaw as CategoryId[],
      categories_exclude: catsExcludeRaw as CategoryId[],
      date_preset: datePreset,
      date_from: dateFrom,
      date_to: dateTo,
      time_from: timeFrom,
      time_to: timeTo,
      fits_from: fitsFrom,
      fits_to: fitsTo,
      price_max: priceMax,
      free_only: freeOnly,
      age,
      age_ratings: [...new Set(ageRatings)],
      audience,
      venue_id: venueId,
      language: languageRaw ? languageRaw.toLowerCase() : null,
      statuses,
      statuses_explicit: statusesExplicit,
      q: qRaw,
      sort: sortRaw as SortKey,
      page,
      page_size: pageSize,
    },
  };
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHm(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function occurrenceMatches(
  occ: ApiOccurrence,
  f: EventsSearchFilters,
  fallbackDurationMin?: number | null,
): boolean {
  if (occ.is_past) return false;
  if (!f.statuses.includes(occ.status)) return false;

  const startYmd = occ.date_start.slice(0, 10);
  const endYmd = (occ.date_end ?? occ.date_start).slice(0, 10);

  if (f.date_from) {
    if (occ.time_precision === 'date') {
      if (endYmd < f.date_from) return false;
    } else if (startYmd < f.date_from) {
      return false;
    }
  }
  if (f.date_to) {
    if (startYmd > f.date_to) return false;
  }

  if (f.time_from || f.time_to) {
    if (occ.time_precision !== 'minute') return false;
    const hm = occ.date_start.slice(11, 16);
    if (f.time_from && hm < f.time_from) return false;
    if (f.time_to && hm > f.time_to) return false;
  }

  if (f.fits_from || f.fits_to) {
    if (occ.time_precision !== 'minute') return false;
    const startHm = occ.date_start.slice(11, 16);
    if (f.fits_from && startHm < f.fits_from) return false;
    let endHm: string;
    if (occ.date_end && occ.date_end.slice(0, 10) === startYmd) {
      endHm = occ.date_end.slice(11, 16);
    } else if (occ.date_end && occ.date_end.slice(0, 10) > startYmd) {
      endHm = '23:59';
    } else {
      endHm = minutesToHm(hmToMinutes(startHm) + (fallbackDurationMin ?? 90));
    }
    if (f.fits_to && endHm > f.fits_to) return false;
  }

  return true;
}

function stemToken(word: string): string {
  const w = normalizeText(word);
  if (w.length >= 6) return w.slice(0, w.length - 2);
  if (w.length >= 4) return w.slice(0, w.length - 1);
  return w;
}

function textMatchesFields(haystack: string, query: string): boolean {
  const needle = normalizeText(query);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const words = needle.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return true;
  return words.every((w) => haystack.includes(w) || haystack.includes(stemToken(w)));
}

function textMatchesEvent(event: ApiEvent, query: string): boolean {
  const haystack = normalizeText(
    [
      event.title,
      event.normalized_title,
      event.title_ba ?? '',
      event.description,
      event.venue,
      event.address ?? '',
      event.city,
      event.tags.join(' '),
      event.organizer ?? '',
    ].join(' '),
  );
  return textMatchesFields(haystack, query);
}

export function computePartyCost(
  event: ApiEvent,
  participants?: PartyParticipantsFilter | null,
): number | null {
  if (event.is_free) return 0;
  if (event.price_min === null) return null;

  const childrenCount =
    participants?.children_count ?? participants?.children_ages?.length ?? 0;
  const totalCount =
    participants?.total ??
    (participants?.adults !== undefined || childrenCount > 0
      ? (participants?.adults ?? 0) + childrenCount
      : 1);
  const adultsCount = participants?.adults ?? Math.max(0, totalCount - childrenCount);

  if (totalCount <= 1 && childrenCount === 0) return event.price_min;

  const offers = event.offers ?? [];
  const childPrices = offers
    .filter((o) => o.audience === 'child' || o.audience === 'reduced')
    .map((o) => (o.is_free ? 0 : o.price))
    .filter((p): p is number => p !== null);
  const adultPrices = offers
    .filter((o) => o.audience === 'adult' || !o.audience)
    .map((o) => (o.is_free ? 0 : o.price))
    .filter((p): p is number => p !== null);

  const unitAdult = adultPrices.length > 0 ? Math.min(...adultPrices) : event.price_min;
  const unitChild = childPrices.length > 0 ? Math.min(...childPrices) : event.price_min;

  return adultsCount * unitAdult + childrenCount * unitChild;
}

function computeSoftScore(event: ApiEvent, soft?: SoftFilterHints | null): number {
  if (!soft) return 0;
  let score = 0;

  if (soft.preferred_categories?.includes(event.category)) score += 6;
  if (soft.category_priority) {
    const idx = soft.category_priority.indexOf(event.category);
    if (idx !== -1) score += Math.max(2, 10 - idx * 3);
  }
  if (soft.avoid_categories?.includes(event.category)) score -= 8;

  if (soft.prefer_free || soft.price_direction === 'lower') {
    if (event.is_free) score += 7;
    else if (event.price_min !== null) {
      if (event.price_min <= 300) score += 4;
      else if (event.price_min <= 700) score += 2;
      else score -= 1;
    }
  }

  if (soft.preferences?.includes('family_friendly') || soft.audience === 'kids') {
    const hasKidsTag = event.tags.some((t) => /дет|семь|семейн|сказ/i.test(t));
    if (hasKidsTag) score += 4;
    if (event.age_limit !== null && event.age_limit <= 6) score += 3;
  }

  if (soft.audience === 'adults' || soft.audience === 'teenagers') {
    const audienceEvidence = normalizeText(`${event.description} ${event.tags.join(' ')}`);
    const matchesAudience = soft.audience === 'adults'
      ? /взросл(?:ых|ым|ые|ая аудитория|ой аудитории)/.test(audienceEvidence)
      : /подрост(?:ок|к[а-я]+)|старшеклассник[а-я]*/.test(audienceEvidence);
    if (matchesAudience) score += 6;
  }

  if (soft.semantic_query) {
    const haystack = normalizeText(
      [event.title, event.description, event.tags.join(' '), event.venue, event.category].join(' '),
    );
    const words = normalizeText(soft.semantic_query)
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    for (const w of words) {
      if (haystack.includes(w) || haystack.includes(stemToken(w))) score += 4;
    }
  }

  return score;
}

export interface SearchMatch {
  event: ApiEvent;
  matchedOccurrences: ApiOccurrence[];
  primaryOccurrence: ApiOccurrence;
  score?: number;
}

export interface SearchOutcome {
  matches: SearchMatch[];
  hidden_unknown_price: number;
  hidden_unknown_age: number;
}

export function runCatalogSearch(events: readonly ApiEvent[], f: EventsSearchFilters): SearchOutcome {
  const matches: SearchMatch[] = [];
  let hiddenUnknownPrice = 0;
  let hiddenUnknownAge = 0;

  for (const event of events) {
    if (event.status !== 'published') continue;
    if (f.cities.length > 0 && !f.cities.includes(event.city_id)) continue;
    if (f.categories.length > 0 && !f.categories.includes(event.category)) continue;
    if (f.categories_exclude.length > 0 && f.categories_exclude.includes(event.category)) continue;
    if (f.venue_id && event.venue_id !== f.venue_id) continue;
    if (f.language && (event.language ?? '').toLowerCase() !== f.language) continue;
    if (f.audience === 'kids') {
      const hasKidsTag = event.tags.some((t) => normalizeText(t) === 'дети');
      if (!hasKidsTag && event.age_limit !== 0 && event.age_limit !== 6) continue;
    }
    if (f.venue_query) {
      const venueHay = normalizeText(`${event.venue} ${event.address ?? ''}`);
      if (!textMatchesFields(venueHay, f.venue_query)) continue;
    }
    if (f.geo_query) {
      const geoHay = normalizeText(`${event.city} ${event.address ?? ''} ${event.venue} ${event.description} ${event.tags.join(' ')}`);
      if (!textMatchesFields(geoHay, f.geo_query)) continue;
    }
    if (f.title_query) {
      const titleHay = normalizeText(`${event.title} ${event.title_ba ?? ''} ${event.tags.join(' ')}`);
      if (!textMatchesFields(titleHay, f.title_query)) continue;
    }
    if (f.topic_query && !textMatchesEvent(event, f.topic_query)) continue;
    if (f.q && !textMatchesEvent(event, f.q)) continue;

    const matchedOccs = event.occurrences.filter((occ) => occurrenceMatches(occ, f, event.duration_min));
    if (matchedOccs.length === 0) continue;

    // Неизвестная цена (null) НЕ считается 0 / бесплатно и учитывается отдельно
    if (f.free_only || f.price_max !== null || (f.max_total_price !== undefined && f.max_total_price !== null)) {
      if (event.price_min === null) {
        hiddenUnknownPrice += 1;
        continue;
      }
      if (f.free_only && !event.is_free) continue;
      if (f.price_max !== null && event.price_min > f.price_max) continue;
      if (f.max_total_price !== undefined && f.max_total_price !== null) {
        const partyCost = computePartyCost(event, f.participants);
        if (partyCost === null || partyCost > f.max_total_price) continue;
      }
    }

    // Неизвестный возраст (null) НЕ считается 0+ и учитывается отдельно
    if (f.age !== null || f.age_ratings.length > 0) {
      if (event.age_limit === null) {
        hiddenUnknownAge += 1;
        continue;
      }
      if (f.age !== null && event.age_limit > f.age) continue;
      if (f.age_ratings.length > 0 && !f.age_ratings.includes(`${event.age_limit}+`)) continue;
    }

    matches.push({
      event,
      matchedOccurrences: matchedOccs,
      primaryOccurrence: matchedOccs[0],
      score: computeSoftScore(event, f.soft),
    });
  }

  matches.sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    if (f.sort === 'price') {
      const pa = a.event.price_min === null ? Number.MAX_SAFE_INTEGER : a.event.price_min;
      const pb = b.event.price_min === null ? Number.MAX_SAFE_INTEGER : b.event.price_min;
      return (
        pa - pb ||
        a.primaryOccurrence.date_start.localeCompare(b.primaryOccurrence.date_start) ||
        a.event.id.localeCompare(b.event.id)
      );
    }
    if (f.sort === 'popularity') {
      return (
        b.event.popularity - a.event.popularity ||
        a.primaryOccurrence.date_start.localeCompare(b.primaryOccurrence.date_start) ||
        a.event.id.localeCompare(b.event.id)
      );
    }
    return a.primaryOccurrence.date_start.localeCompare(b.primaryOccurrence.date_start) || a.event.id.localeCompare(b.event.id);
  });

  return {
    matches,
    hidden_unknown_price: hiddenUnknownPrice,
    hidden_unknown_age: hiddenUnknownAge,
  };
}

export function toListItem(m: SearchMatch): ApiEventListItem {
  return {
    ...m.event,
    matched_occurrence_ids: m.matchedOccurrences.map((o) => o.id),
    primary_occurrence_id: m.primaryOccurrence.id,
  };
}

function countBy<T extends string | number>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** Счётчики фильтров в форме контракта v1 (GET /api/v1/events). */
export function computeOpenApiFacets(events: readonly ApiEvent[], f: EventsSearchFilters) {
  const withoutCity = runCatalogSearch(events, { ...f, cities: [] }).matches;
  const withoutCat = runCatalogSearch(events, { ...f, categories: [], categories_exclude: [] }).matches;
  const withoutAge = runCatalogSearch(events, { ...f, age: null, age_ratings: [] }).matches;
  const withoutPrice = runCatalogSearch(events, { ...f, price_max: null, free_only: false }).matches;

  const cityCounts = countBy(withoutCity.map((m) => m.event.city_id));
  const catCounts = countBy(withoutCat.map((m) => m.event.category));
  const ageCounts = new Map<number | null, number>();
  for (const m of withoutAge) {
    const key = m.event.age_limit;
    ageCounts.set(key, (ageCounts.get(key) ?? 0) + 1);
  }

  let freeCount = 0;
  let paidCount = 0;
  let unknownPriceCount = 0;
  for (const m of withoutPrice) {
    if (m.event.price_min === null) unknownPriceCount += 1;
    else if (m.event.is_free) freeCount += 1;
    else paidCount += 1;
  }

  const total = runCatalogSearch(events, f).matches.length;

  return {
    cities: CITIES.map((c) => ({ id: c.slug, name: c.name.ru, count: cityCounts.get(c.slug) ?? 0 })),
    categories: CATEGORIES.map((c) => ({ id: c.id, name: c.name.ru, count: catCounts.get(c.id) ?? 0 })),
    age_limits: [0, 6, 12, 16, 18, null].map((v) => ({ value: v, count: ageCounts.get(v) ?? 0 })),
    price: { free: freeCount, paid: paidCount, unknown: unknownPriceCount },
    total,
  };
}

/** Двуязычные счётчики для расширенного GET /api/v1/facets (использует web/src/lib/api/client.ts). */
export function computeWebFacets(events: readonly ApiEvent[], f: EventsSearchFilters) {
  const base = computeOpenApiFacets(events, f);
  return {
    cities: CITIES.map((c) => ({
      id: c.slug,
      name: c.name,
      count: base.cities.find((x) => x.id === c.slug)?.count ?? 0,
    })),
    categories: CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      count: base.categories.find((x) => x.id === c.id)?.count ?? 0,
    })),
    age_ratings: [
      ...AGE_RATINGS.map((a) => ({
        id: a.id,
        name: a.label,
        count: base.age_limits.find((x) => x.value === a.min_age)?.count ?? 0,
      })),
      {
        id: 'unknown' as const,
        name: { ru: 'Возраст не указан', ba: 'Йәше күрһәтелмәгән' },
        count: base.age_limits.find((x) => x.value === null)?.count ?? 0,
      },
    ],
    price: base.price,
    total: base.total,
  };
}

function toBaseWebQuery(f: EventsSearchFilters): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  if (f.cities.length > 0) q.city = [...f.cities];
  if (f.categories.length > 0) q.category = [...f.categories];
  if (f.date_preset) q.date = f.date_preset;
  else {
    if (f.date_from) q.date_from = f.date_from;
    if (f.date_to) q.date_to = f.date_to;
  }
  if (f.time_from) q.time_from = f.time_from;
  if (f.time_to) q.time_to = f.time_to;
  if (f.price_max !== null) q.price_max = f.price_max;
  if (f.free_only) q.free_only = true;
  if (f.age !== null) q.age = f.age;
  if (f.age_ratings.length > 0) q.age_rating = [...f.age_ratings];
  if (f.audience) q.audience = f.audience;
  if (f.statuses_explicit) q.status = [...f.statuses];
  if (f.q) q.q = f.q;
  if (f.sort && f.sort !== 'date') q.sort = f.sort;
  return q;
}

export function buildAppliedFilters(f: EventsSearchFilters) {
  const active: string[] = [];
  if (f.cities.length > 0) active.push('city');
  if (f.categories.length > 0) active.push('category');
  if (f.date_preset) active.push('date');
  else if (f.date_from || f.date_to) {
    if (f.date_from) active.push('date_from');
    if (f.date_to) active.push('date_to');
  }
  if (f.time_from) active.push('time_from');
  if (f.time_to) active.push('time_to');
  if (f.price_max !== null) active.push('price_max');
  if (f.free_only) active.push('free_only');
  if (f.age !== null) active.push('age');
  if (f.age_ratings.length > 0) active.push('age_rating');
  if (f.audience) active.push('audience');
  if (f.statuses_explicit) active.push('status');
  if (f.q) active.push('q');

  return {
    city: [...f.cities],
    category: [...f.categories],
    date: f.date_preset,
    date_from: f.date_from,
    date_to: f.date_to,
    time_from: f.time_from,
    time_to: f.time_to,
    price_max: f.price_max,
    free_only: f.free_only,
    age: f.age,
    age_rating: [...f.age_ratings],
    audience: f.audience,
    status: [...f.statuses],
    q: f.q,
    sort: f.sort,
    active,
  };
}

export interface ApiRelaxation {
  code: 'date' | 'time' | 'budget' | 'city' | 'venue' | 'category' | 'age' | 'status' | 'query';
  codes: Array<'date' | 'time' | 'budget' | 'city' | 'venue' | 'category' | 'age' | 'status' | 'query'>;
  label: LocalizedText;
  patch: ConstraintsPatchShape;
  query: Record<string, unknown>;
  count: number;
}

export function buildCatalogRelaxations(
  events: readonly ApiEvent[],
  f: EventsSearchFilters,
  today: string,
  limit = 6,
): ApiRelaxation[] {
  const baseQuery = toBaseWebQuery(f);
  const candidates: Array<{
    code: ApiRelaxation['code'];
    label: LocalizedText;
    patch: ConstraintsPatchShape;
    next: EventsSearchFilters;
    queryMutate: (q: Record<string, unknown>) => void;
    removal: boolean;
  }> = [];

  if (f.q || f.title_query || f.topic_query || f.soft?.semantic_query) {
    candidates.push({
      code: 'query',
      label: { ru: 'Без поискового запроса', ba: 'Эҙләү һорауынан башҡа' },
      patch: {
        reset: false,
        set: {},
        unset: ['soft.semantic_query', 'hard.title_query', 'hard.topic_query'],
      },
      next: { ...f, q: null, title_query: null, topic_query: null, soft: f.soft ? { ...f.soft, semantic_query: undefined } : f.soft },
      queryMutate: (q) => delete q.q,
      removal: true,
    });
  }

  if (f.time_from || f.time_to || f.fits_from || f.fits_to) {
    candidates.push({
      code: 'time',
      label: { ru: 'В любое время', ba: 'Теләһә ҡайһы ваҡытта' },
      patch: { reset: false, set: {}, unset: ['hard.time'] },
      next: { ...f, time_from: null, time_to: null, fits_from: null, fits_to: null },
      queryMutate: (q) => {
        delete q.time_from;
        delete q.time_to;
        delete q.fits_from;
        delete q.fits_to;
      },
      removal: true,
    });
  }

  if (f.date_from !== null || f.date_to !== null) {
    const from = f.date_from ?? today;
    const to = f.date_to ?? from;
    for (let delta = 1; delta <= 7; delta += 1) {
      const candDays = [addDays(to, delta), addDays(from, -delta)].filter((d) => d >= today);
      const found = candDays.find(
        (d) => runCatalogSearch(events, { ...f, date_preset: null, date_from: d, date_to: d }).matches.length > 0,
      );
      if (found) {
        const dayStr = formatRuDay(found);
        candidates.push({
          code: 'date',
          label: { ru: `Другая дата: ${dayStr}`, ba: `Башҡа көн: ${dayStr}` },
          patch: { reset: false, set: { hard: { date: { from: found, to: found } } }, unset: [] },
          next: { ...f, date_preset: null, date_from: found, date_to: found },
          queryMutate: (q) => {
            delete q.date;
            q.date_from = found;
            q.date_to = found;
          },
          removal: false,
        });
        break;
      }
    }
    candidates.push({
      code: 'date',
      label: { ru: 'В любой день', ba: 'Теләһә ҡайһы көндә' },
      patch: { reset: false, set: {}, unset: ['hard.date'] },
      next: { ...f, date_preset: null, date_from: null, date_to: null },
      queryMutate: (q) => {
        delete q.date;
        delete q.date_from;
        delete q.date_to;
      },
      removal: true,
    });
  }

  if (f.price_max !== null && !f.free_only) {
    const noPrice = runCatalogSearch(events, { ...f, price_max: null, max_total_price: null, free_only: false }).matches;
    const higher = noPrice
      .map((m) => m.event.price_min)
      .filter((p): p is number => p !== null && p > (f.price_max as number));
    if (higher.length > 0) {
      const raised = Math.ceil(Math.min(...higher) / 100) * 100;
      candidates.push({
        code: 'budget',
        label: { ru: `До ${raised} ₽`, ba: `${raised} ₽ тиклем` },
        patch: {
          reset: false,
          set: { hard: { max_price_per_person: raised } },
          unset: ['hard.max_total_price', 'hard.free_only'],
        },
        next: { ...f, price_max: raised, max_total_price: null },
        queryMutate: (q) => {
          q.price_max = raised;
        },
        removal: false,
      });
    }
  }

  if (f.free_only) {
    candidates.push({
      code: 'budget',
      label: { ru: 'Включая платные', ba: 'Түләүлеләрен дә индереп' },
      patch: { reset: false, set: {}, unset: ['hard.free_only'] },
      next: { ...f, free_only: false },
      queryMutate: (q) => {
        delete q.free_only;
        delete q.free;
      },
      removal: f.price_max === null && f.max_total_price == null,
    });
  }

  if (f.price_max !== null || (f.max_total_price !== undefined && f.max_total_price !== null)) {
    candidates.push({
      code: 'budget',
      label: { ru: 'Без ограничения цены', ba: 'Хаҡ сикләүһеҙ' },
      patch: {
        reset: false,
        set: {},
        unset: ['hard.max_price_per_person', 'hard.max_total_price', 'hard.free_only'],
      },
      next: { ...f, price_max: null, max_total_price: null, free_only: false },
      queryMutate: (q) => {
        delete q.price_max;
        delete q.free_only;
        delete q.free;
      },
      removal: true,
    });
  }

  if (f.cities.length > 0) {
    candidates.push({
      code: 'city',
      label: { ru: 'По всей республике', ba: 'Бөтә республика буйынса' },
      patch: { reset: false, set: { hard: { region: 'bashkortostan' } }, unset: ['hard.cities'] },
      next: { ...f, cities: [] },
      queryMutate: (q) => delete q.city,
      removal: true,
    });
  }

  if (f.venue_id || f.venue_query || f.geo_query) {
    candidates.push({
      code: 'venue',
      label: { ru: 'На любой площадке', ba: 'Теләһә ҡайһы майҙансыҡта' },
      patch: { reset: false, set: {}, unset: ['hard.venue_query', 'hard.geo_query'] },
      next: { ...f, venue_id: null, venue_query: null, geo_query: null },
      queryMutate: (q) => delete q.venue_id,
      removal: true,
    });
  }

  if (f.categories.length > 0) {
    candidates.push({
      code: 'category',
      label: { ru: 'Любая категория', ba: 'Теләһә ниндәй категория' },
      patch: { reset: false, set: {}, unset: ['hard.categories_any'] },
      next: { ...f, categories: [] },
      queryMutate: (q) => delete q.category,
      removal: true,
    });
  }

  if (f.age !== null || f.age_ratings.length > 0 || f.audience !== null) {
    candidates.push({
      code: 'age',
      label: { ru: 'Без фильтра по возрасту', ba: 'Йәш буйынса сикләүһеҙ' },
      patch: { reset: false, set: {}, unset: ['hard.required_age_rating', 'soft.audience'] },
      next: { ...f, age: null, age_ratings: [], audience: null },
      queryMutate: (q) => {
        delete q.age;
        delete q.age_rating;
        delete q.audience;
      },
      removal: true,
    });
  }

  if (f.statuses_explicit) {
    candidates.push({
      code: 'status',
      label: { ru: 'Только актуальные сеансы', ba: 'Тик көнүҙәк сеанстар' },
      patch: { reset: false, set: {}, unset: ['hard.statuses'] },
      next: { ...f, statuses: [...DEFAULT_OCCURRENCE_STATUSES], statuses_explicit: false },
      queryMutate: (q) => delete q.status,
      removal: true,
    });
  }

  const single: ApiRelaxation[] = [];
  for (const cand of candidates) {
    const cnt = runCatalogSearch(events, cand.next).matches.length;
    if (cnt > 0) {
      const q = { ...baseQuery };
      cand.queryMutate(q);
      delete q.page;
      single.push({
        code: cand.code,
        codes: [cand.code],
        label: cand.label,
        patch: cand.patch,
        query: q,
        count: cnt,
      });
    }
  }

  if (single.length > 0) return single.slice(0, limit);

  // Комбинированное ослабление, если по одному условию ничего не нашлось
  let current = { ...f };
  const qCombined = { ...baseQuery };
  const usedCodes: ApiRelaxation['code'][] = [];
  const usedLabelsRu: string[] = [];
  const usedLabelsBa: string[] = [];
  const combinedUnset = new Set<string>();
  const combinedSetHard: Record<string, unknown> = {};

  for (const cand of candidates) {
    if (!cand.removal) continue;
    cand.queryMutate(qCombined);
    for (const u of cand.patch.unset) combinedUnset.add(u);
    if (cand.patch.set.hard) Object.assign(combinedSetHard, cand.patch.set.hard);

    if (cand.code === 'query') current = { ...current, q: null, title_query: null, topic_query: null };
    if (cand.code === 'time') current = { ...current, time_from: null, time_to: null, fits_from: null, fits_to: null };
    if (cand.code === 'date') current = { ...current, date_preset: null, date_from: null, date_to: null };
    if (cand.code === 'budget') current = { ...current, price_max: null, max_total_price: null, free_only: false };
    if (cand.code === 'city') current = { ...current, cities: [] };
    if (cand.code === 'venue') current = { ...current, venue_id: null, venue_query: null, geo_query: null };
    if (cand.code === 'category') current = { ...current, categories: [] };
    if (cand.code === 'age') current = { ...current, age: null, age_ratings: [], audience: null };
    if (cand.code === 'status') current = { ...current, statuses: [...DEFAULT_OCCURRENCE_STATUSES], statuses_explicit: false };

    usedCodes.push(cand.code);
    usedLabelsRu.push(cand.label.ru.toLowerCase());
    usedLabelsBa.push(cand.label.ba.toLowerCase());
    const cnt = runCatalogSearch(events, current).matches.length;
    if (cnt > 0) {
      return [
        {
          code: usedCodes[0],
          codes: [...new Set(usedCodes)],
          label: { ru: usedLabelsRu.join(', '), ba: usedLabelsBa.join(', ') },
          patch: {
            reset: false,
            set: Object.keys(combinedSetHard).length > 0 ? { hard: combinedSetHard } : {},
            unset: [...combinedUnset],
          },
          query: qCombined,
          count: cnt,
        },
      ];
    }
  }

  return [];
}

/** Похожие опубликованные события: та же категория или общие метки, с учётом города и периода. */
export function findSimilarEvents(
  events: readonly ApiEvent[],
  sourceEvent: ApiEvent,
  options: {
    cities?: CityId[];
    date_from?: string | null;
    date_to?: string | null;
    limit?: number;
  } = {},
): ApiEventListItem[] {
  const cities = options.cities && options.cities.length > 0 ? options.cities : [sourceEvent.city_id];
  const baseMatches = runCatalogSearch(events, {
    cities,
    categories: [],
    categories_exclude: [],
    date_preset: null,
    date_from: options.date_from ?? null,
    date_to: options.date_to ?? null,
    time_from: null,
    time_to: null,
    price_max: null,
    free_only: false,
    age: null,
    age_ratings: [],
    audience: null,
    venue_id: null,
    language: null,
    statuses: ['scheduled', 'rescheduled'],
    statuses_explicit: false,
    q: null,
    sort: 'date',
    page: 1,
    page_size: 100,
  }).matches.filter((m) => m.event.id !== sourceEvent.id);

  const srcTags = new Set(sourceEvent.tags.map((t) => normalizeText(t)));
  const scored = baseMatches
    .map((m) => {
      let score = 0;
      if (m.event.category === sourceEvent.category) score += 3;
      const sharedTags = m.event.tags.filter((t) => srcTags.has(normalizeText(t))).length;
      score += sharedTags * 2;
      if (m.event.venue_id === sourceEvent.venue_id) score += 1;
      return { m, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.m.primaryOccurrence.date_start.localeCompare(b.m.primaryOccurrence.date_start) ||
        a.m.event.id.localeCompare(b.m.event.id),
    );

  return scored.slice(0, Math.min(Math.max(1, options.limit ?? 5), 20)).map(({ m }) => toListItem(m));
}
