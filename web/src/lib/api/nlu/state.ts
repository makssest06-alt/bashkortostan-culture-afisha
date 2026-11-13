/**
 * Состояние диалога: условия hard/soft, их слияние с новой фразой,
 * правка чипами (patch) и перевод в условия поиска.
 *
 * Сервер состояния не хранит: клиент присылает прежние условия в `previous`,
 * поэтому всё входящее здесь проверяется заново. Функции не меняют аргументы.
 */

import { isAgeRating, isCategoryId, isCityId } from '../../../data/dictionaries';
import { emptyFilters } from '../filters';
import type { SearchFilters } from '../filters';
import { isValidDate, isValidTime } from '../time';
import type {
  AgeRating,
  CategoryId,
  CityId,
  ConstraintStatus,
  Constraints,
  ConstraintsPatch,
  EventsQuery,
  HardConstraints,
  OccurrenceStatus,
  Participants,
  SoftConstraints,
  TimeRange,
} from '../types';
import type { ParsedMessage } from './parse';

const MAX_LIST = 12;
const MAX_TEXT = 120;
const MAX_PEOPLE = 20;
const MAX_BUDGET = 1_000_000;
const CONSTRAINT_STATUSES: readonly ConstraintStatus[] = ['scheduled', 'cancelled', 'postponed', 'sold_out', 'unknown'];
const PRICE_PATHS = ['hard.max_price_per_person', 'hard.max_total_price', 'hard.free_only'];

export function emptyConstraints(): Constraints {
  return { hard: {}, soft: {} };
}

// ---------------------------------------------------------------------------
// Проверка входящих условий
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, MAX_TEXT);
  return text ? text : undefined;
}

function cleanStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(value.map(cleanText).filter((item): item is string => item !== undefined))];
  return items.length > 0 ? items.slice(0, MAX_LIST) : undefined;
}

function cleanInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function cleanAges(value: unknown, max: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ages = value.map((item) => cleanInteger(item, 0, max)).filter((item): item is number => item !== undefined);
  return ages.length > 0 ? ages.slice(0, MAX_LIST) : undefined;
}

function cleanParticipants(value: unknown): Participants | undefined {
  if (!isRecord(value)) return undefined;
  const result: Participants = {};
  const total = cleanInteger(value.total, 1, MAX_PEOPLE);
  const adults = cleanInteger(value.adults, 0, MAX_PEOPLE);
  const children = cleanInteger(value.children_count, 0, MAX_PEOPLE);
  const childrenAges = cleanAges(value.children_ages, 17);
  const participantAges = cleanAges(value.participant_ages, 120);
  if (total !== undefined) result.total = total;
  if (adults !== undefined) result.adults = adults;
  if (children !== undefined) result.children_count = children;
  if (childrenAges) result.children_ages = childrenAges;
  if (participantAges) result.participant_ages = participantAges;
  return Object.keys(result).length > 0 ? result : undefined;
}

function cleanTime(value: unknown): TimeRange | undefined {
  if (!isRecord(value)) return undefined;
  const result: TimeRange = {};
  for (const key of ['start_from', 'start_to', 'fits_from', 'fits_to'] as const) {
    const item = value[key];
    if (typeof item === 'string' && isValidTime(item)) result[key] = item;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function cleanHard(value: unknown): HardConstraints {
  if (!isRecord(value)) return {};
  const hard: HardConstraints = {};

  const cities = cleanStrings(value.cities);
  if (cities) hard.cities = cities;
  const region = cleanText(value.region);
  if (region && !cities) hard.region = region;

  if (isRecord(value.date)) {
    const { from, to } = value.date;
    if (typeof from === 'string' && typeof to === 'string' && isValidDate(from) && isValidDate(to) && from <= to) {
      hard.date = { from, to };
    }
  }
  const time = cleanTime(value.time);
  if (time) hard.time = time;
  const participants = cleanParticipants(value.participants);
  if (participants) hard.participants = participants;

  const perPerson = typeof value.max_price_per_person === 'number' ? value.max_price_per_person : undefined;
  const total = typeof value.max_total_price === 'number' ? value.max_total_price : undefined;
  if (perPerson !== undefined && perPerson >= 0 && perPerson <= MAX_BUDGET) hard.max_price_per_person = perPerson;
  if (total !== undefined && total >= 0 && total <= MAX_BUDGET) hard.max_total_price = total;
  if (value.free_only === true) hard.free_only = true;

  const any = cleanStrings(value.categories_any);
  if (any) hard.categories_any = any;
  const exclude = cleanStrings(value.categories_exclude);
  if (exclude) hard.categories_exclude = exclude;
  const rating = cleanText(value.required_age_rating);
  if (rating) hard.required_age_rating = rating;
  for (const key of ['venue_query', 'geo_query', 'title_query', 'topic_query'] as const) {
    const text = cleanText(value[key]);
    if (text) hard[key] = text;
  }
  if (Array.isArray(value.statuses)) {
    const statuses = value.statuses.filter((item): item is ConstraintStatus =>
      CONSTRAINT_STATUSES.includes(item as ConstraintStatus),
    );
    if (statuses.length > 0) hard.statuses = [...new Set(statuses)];
  }
  return normalizeHard(hard);
}

function cleanSoft(value: unknown): SoftConstraints {
  if (!isRecord(value)) return {};
  const soft: SoftConstraints = {};
  const semantic = cleanText(value.semantic_query);
  if (semantic) soft.semantic_query = semantic;
  for (const key of ['preferences', 'preferred_categories', 'category_priority', 'avoid_categories'] as const) {
    const items = cleanStrings(value[key]);
    if (items) soft[key] = items;
  }
  if (value.price_direction === 'lower') soft.price_direction = 'lower';
  if (value.prefer_free === true) soft.prefer_free = true;
  if (value.less_travel === true) soft.less_travel = true;
  const audience = cleanText(value.audience);
  if (audience) soft.audience = audience;
  return soft;
}

/** Берёт из произвольного объекта только известные поля допустимого вида. */
export function sanitizeConstraints(value: unknown): Constraints {
  if (!isRecord(value)) return emptyConstraints();
  return { hard: cleanHard(value.hard), soft: cleanSoft(value.soft) };
}

export function sanitizePatch(value: unknown): ConstraintsPatch | null {
  if (!isRecord(value)) return null;
  const set = isRecord(value.set) ? value.set : {};
  const unset = Array.isArray(value.unset)
    ? value.unset.filter((item): item is string => typeof item === 'string' && /^(hard|soft)\.[A-Za-z0-9_]+$/.test(item))
    : [];
  return {
    reset: value.reset === true,
    set: { hard: cleanHard(set.hard), soft: cleanSoft(set.soft) },
    unset: unset.slice(0, 40),
  };
}

// ---------------------------------------------------------------------------
// Согласованность
// ---------------------------------------------------------------------------

/** Валюта есть ровно тогда, когда есть денежное ограничение; состав группы пересчитывается. */
function normalizeHard(input: HardConstraints): HardConstraints {
  const hard: HardConstraints = { ...input };
  if (hard.max_price_per_person !== undefined || hard.max_total_price !== undefined) hard.currency = 'RUB';
  else delete hard.currency;
  if (hard.cities && hard.cities.length > 0) delete hard.region;

  if (hard.participants) {
    const participants: Participants = { ...hard.participants };
    if (participants.children_ages && participants.children_ages.length > 0) {
      participants.children_count = Math.max(participants.children_count ?? 0, participants.children_ages.length);
    }
    if (participants.children_count === 0) {
      delete participants.children_count;
      delete participants.children_ages;
    }
    const children = participants.children_count ?? 0;
    if (participants.adults !== undefined) {
      participants.total = participants.adults + children;
    } else if (participants.total !== undefined && participants.total < children) {
      participants.total = children;
    }
    if (Object.keys(participants).length > 0) hard.participants = participants;
    else delete hard.participants;
  }
  return hard;
}

function deletePath(constraints: Constraints, path: string): void {
  const [group, key] = path.split('.');
  if (group === 'hard') delete (constraints.hard as Record<string, unknown>)[key];
  if (group === 'soft') delete (constraints.soft as Record<string, unknown>)[key];
}

function clone(constraints: Constraints): Constraints {
  return JSON.parse(JSON.stringify(constraints)) as Constraints;
}

/** Применяет правку чипа: сброс, снятие условий, затем установка новых. */
export function applyPatch(previous: Constraints, patch: ConstraintsPatch): Constraints {
  const next = patch.reset ? emptyConstraints() : clone(previous);
  for (const path of patch.unset) deletePath(next, path);
  // Снято денежное условие: снимаем и связанное с ним, чтобы не осталось «до 1000 и бесплатно».
  const setHard = patch.set.hard ?? {};
  if (setHard.max_price_per_person !== undefined) delete next.hard.max_total_price;
  if (setHard.max_total_price !== undefined) delete next.hard.max_price_per_person;
  if (setHard.region !== undefined) delete next.hard.cities;
  next.hard = normalizeHard({ ...next.hard, ...setHard });
  next.soft = { ...next.soft, ...(patch.set.soft ?? {}) };
  return next;
}

/** Добавляет к прежним условиям то, что извлечено из новой фразы. Неупомянутое сохраняется. */
export function applyParsed(previous: Constraints, parsed: ParsedMessage): Constraints {
  const next = parsed.reset ? emptyConstraints() : clone(previous);
  for (const path of parsed.unset) deletePath(next, path);

  const { participants: parsedParticipants, ...restHard } = parsed.hard;

  // Новое денежное условие заменяет прежнее целиком.
  if (PRICE_PATHS.some((path) => (restHard as Record<string, unknown>)[path.slice(5)] !== undefined)) {
    for (const path of PRICE_PATHS) deletePath(next, path);
  }
  if (restHard.cities) delete next.hard.region;
  if (restHard.region) delete next.hard.cities;
  Object.assign(next.hard, restHard);

  const participants: Participants = { ...(next.hard.participants ?? {}), ...(parsedParticipants ?? {}) };
  if (parsedParticipants?.total !== undefined && parsedParticipants.adults === undefined) {
    // Названо общее число людей: прежнее число взрослых могло устареть.
    delete participants.adults;
  }
  if (parsed.childrenAges.length > 0) {
    participants.children_ages = parsed.childrenAges;
    participants.children_count = parsed.childrenAges.length;
  }
  if (parsed.noChildren || parsed.skipAge) {
    delete participants.children_count;
    delete participants.children_ages;
  }
  if (Object.keys(participants).length > 0) next.hard.participants = participants;
  else delete next.hard.participants;

  const preferences = new Set([...(next.soft.preferences ?? []), ...(parsed.soft.preferences ?? [])]);
  // Возраст назван или дети не идут: вопрос о возрасте больше не нужен.
  if (parsed.childrenAges.length > 0 || parsed.noChildren || parsed.skipAge) preferences.delete('family_friendly');
  else if (parsed.childrenMentioned && !participants.children_ages?.length) preferences.add('family_friendly');

  const { preferences: _ignored, ...restSoft } = parsed.soft;
  void _ignored;
  Object.assign(next.soft, restSoft);
  if (preferences.size > 0) next.soft.preferences = [...preferences];
  else delete next.soft.preferences;
  if (parsed.skipAge) next.soft.audience = 'children';
  if (parsed.noChildren && next.soft.audience === 'children') delete next.soft.audience;

  next.hard = normalizeHard(next.hard);
  return next;
}

// ---------------------------------------------------------------------------
// Вопросы к условиям
// ---------------------------------------------------------------------------

/** В группе есть ребёнок, а возраст не назван: без него нельзя проверить возрастную метку. */
export function needsChildAge(constraints: Constraints): boolean {
  const participants = constraints.hard.participants;
  if (participants?.children_ages && participants.children_ages.length > 0) return false;
  if ((participants?.children_count ?? 0) > 0) return true;
  return constraints.soft.preferences?.includes('family_friendly') ?? false;
}

export function hasPlace(constraints: Constraints): boolean {
  return (constraints.hard.cities?.length ?? 0) > 0 || constraints.hard.region !== undefined;
}

/** Возраст самого младшего участника или null, если возрасты не названы. */
export function youngestAge(constraints: Constraints): number | null {
  const participants = constraints.hard.participants;
  const ages = [...(participants?.children_ages ?? []), ...(participants?.participant_ages ?? [])];
  return ages.length > 0 ? Math.min(...ages) : null;
}

/** Сколько взрослых и детей считать при проверке общего бюджета. */
export function partyOf(constraints: Constraints): { adults: number; children: number; adultsAssumed: boolean } {
  const participants = constraints.hard.participants ?? {};
  const children = participants.children_count ?? participants.children_ages?.length ?? 0;
  if (participants.adults !== undefined) return { adults: participants.adults, children, adultsAssumed: false };
  if (participants.total !== undefined) {
    return { adults: Math.max(participants.total - children, 0), children, adultsAssumed: false };
  }
  // Число взрослых не названо: считаем одного (с ребёнком или в одиночку).
  return { adults: 1, children, adultsAssumed: true };
}

// ---------------------------------------------------------------------------
// Перевод в условия поиска
// ---------------------------------------------------------------------------

function statusesToFilter(statuses: readonly ConstraintStatus[]): Pick<SearchFilters, 'statuses' | 'availability'> {
  const result = new Set<OccurrenceStatus>();
  let soldOut = false;
  for (const status of statuses) {
    if (status === 'sold_out') soldOut = true;
    else if (status === 'postponed') {
      result.add('postponed');
      result.add('rescheduled');
    } else result.add(status);
  }
  if (soldOut && result.size === 0) {
    result.add('scheduled');
    result.add('rescheduled');
  }
  return { statuses: [...result], availability: soldOut ? ['sold_out'] : [] };
}

/** Условия ассистента на языке поиска. Мягкие пожелания сюда не попадают: они только ранжируют. */
export function toFilters(constraints: Constraints): SearchFilters {
  const { hard, soft } = constraints;
  const filters = emptyFilters();
  filters.cities = [...(hard.cities ?? [])];
  filters.categories = [...(hard.categories_any ?? [])];
  filters.categories_exclude = [...(hard.categories_exclude ?? [])];
  if (hard.date) {
    filters.date_from = hard.date.from;
    filters.date_to = hard.date.to;
  }
  filters.time_from = hard.time?.start_from ?? null;
  filters.time_to = hard.time?.start_to ?? null;
  filters.fits_from = hard.time?.fits_from ?? null;
  filters.fits_to = hard.time?.fits_to ?? null;
  filters.price_max = hard.max_price_per_person ?? null;
  if (hard.max_total_price !== undefined) {
    const party = partyOf(constraints);
    filters.price_total_max = hard.max_total_price;
    filters.party = { adults: party.adults, children: party.children };
  }
  filters.free_only = hard.free_only === true;
  filters.age = youngestAge(constraints);
  if (hard.required_age_rating && isAgeRating(hard.required_age_rating)) {
    filters.age_ratings = [hard.required_age_rating];
  }
  if (soft.audience === 'children') filters.audience = 'kids';
  if (hard.statuses && hard.statuses.length > 0) {
    const mapped = statusesToFilter(hard.statuses);
    filters.statuses = mapped.statuses;
    filters.availability = mapped.availability;
    filters.statuses_explicit = true;
  }
  const text = [hard.title_query, hard.topic_query, hard.venue_query].filter(Boolean).join(' ').trim();
  filters.q = text ? text : null;
  return filters;
}

/**
 * Те же условия для каталога: ссылка «показать все». Возвращает null,
 * если часть условий в параметры каталога не переводится: неточная ссылка хуже её отсутствия.
 */
export function toEventsQuery(constraints: Constraints): EventsQuery | null {
  const { hard, soft } = constraints;
  if (hard.max_total_price !== undefined) return null;
  if (hard.categories_exclude?.length) return null;
  if (hard.time?.fits_from || hard.time?.fits_to) return null;
  if (hard.categories_any?.some((category) => !isCategoryId(category))) return null;
  if (hard.cities?.some((city) => !isCityId(city))) return null;
  if (hard.required_age_rating && !isAgeRating(hard.required_age_rating)) return null;
  if (hard.statuses?.includes('sold_out')) return null;

  const query: EventsQuery = {};
  if (hard.cities?.length) query.city = hard.cities as CityId[];
  if (hard.categories_any?.length) query.category = hard.categories_any as CategoryId[];
  if (hard.date) {
    query.date_from = hard.date.from;
    query.date_to = hard.date.to;
  }
  if (hard.time?.start_from) query.time_from = hard.time.start_from;
  if (hard.time?.start_to) query.time_to = hard.time.start_to;
  if (hard.max_price_per_person !== undefined) query.price_max = Math.floor(hard.max_price_per_person);
  if (hard.free_only) query.free_only = true;
  const age = youngestAge(constraints);
  if (age !== null) query.age = age;
  if (hard.required_age_rating) query.age_rating = [hard.required_age_rating as AgeRating];
  if (soft.audience === 'children') query.audience = 'kids';
  if (hard.statuses?.length) query.status = statusesToFilter(hard.statuses).statuses;
  const text = [hard.title_query, hard.topic_query, hard.venue_query].filter(Boolean).join(' ').trim();
  if (text) query.q = text;
  return query;
}
