import { AGE_RATINGS, CATEGORIES, CITIES, DEFAULT_OCCURRENCE_STATUSES, isCategoryId, isCitySlug } from '../dictionaries.js';
import { computePartyCost, type EventsSearchFilters } from '../search.js';
import {
  TIMEZONE,
  addDays,
  formatDateRangeRu,
  formatRuDay,
  isValidYmd,
  localNow,
  weekdayInRu,
  weekdayName,
} from '../time.js';
import type { ApiEvent, OccurrenceStatus } from '../types.js';
import { parseDate, parseTime, type DateRange, type TimeRange } from './nlu-dates.js';
import { EXTRA_CATEGORY_LABELS, PREFERENCES, STOP_WORDS } from './nlu-lexicon.js';
import { createScanner, mentions, normalizeNluText, stemRu, take, tokenizeNlu, word } from './nlu-scanner.js';
import {
  parseAges,
  parseBudget,
  parseCategories,
  parseParty,
  parsePlace,
  parsePreferences,
  parseStatuses,
  parseVenueAndTopic,
  type ConstraintStatus,
} from './nlu-slots.js';
import type { ToolRuntime } from './tools.js';

export type ClarifyCode =
  | 'city'
  | 'date'
  | 'time'
  | 'child_age'
  | 'participants'
  | 'budget'
  | 'category'
  | 'audience'
  | 'location'
  | 'contradiction';

const UNRESOLVED_FIELDS = ['date', 'audience', 'budget'] as const;
type UnresolvedField = (typeof UNRESOLVED_FIELDS)[number];

export type UnsupportedAction =
  | 'purchase'
  | 'booking'
  | 'write_sql'
  | 'reveal_private_data'
  | 'reveal_system_prompt';

export interface ParticipantsConstraint {
  total?: number;
  adults?: number;
  children_count?: number;
  children_ages?: number[];
  participant_ages?: number[];
}

export interface Constraints {
  hard: {
    cities?: string[];
    region?: string;
    date?: DateRange;
    time?: TimeRange;
    participants?: ParticipantsConstraint;
    max_total_price?: number;
    max_price_per_person?: number;
    currency?: 'RUB';
    free_only?: boolean;
    categories_any?: string[];
    categories_exclude?: string[];
    required_age_rating?: string;
    venue_query?: string;
    geo_query?: string;
    title_query?: string;
    topic_query?: string;
    language?: string;
    venue_id?: string;
    statuses?: ConstraintStatus[];
  };
  soft: {
    semantic_query?: string;
    preferences?: string[];
    preferred_categories?: string[];
    category_priority?: string[];
    avoid_categories?: string[];
    price_direction?: 'lower';
    prefer_free?: boolean;
    less_travel?: boolean;
    audience?: string;
  };
  /** Открытые вопросы, которые нельзя восстановить из одних только hard/soft условий. */
  unresolved?: UnresolvedField[];
}

export interface ConstraintsPatch {
  reset?: boolean;
  set?: Partial<Constraints>;
  unset?: string[];
}

export interface AssistantHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  message?: string;
  previous?: Constraints;
  patch?: ConstraintsPatch;
  answering?: ClarifyCode;
  history?: AssistantHistoryItem[];
  limit?: number;
  user_ref?: string;
  channel?: 'telegram' | 'web' | 'api';
}

export interface AssistantChip {
  key: string;
  kind: string;
  label: string;
  value: string;
  removable: boolean;
  unset: string[];
}

export interface AssistantAssumption {
  key: string;
  text: string;
}

export interface AssistantClarify {
  code: ClarifyCode;
  pending: ClarifyCode[];
  question: string;
  quick_replies: string[];
}

export interface AssistantResultItem {
  event: ApiEvent;
  occurrence_id: string;
  reasons: string[];
  caveats: string[];
}

export interface AssistantResponsePayload {
  action: 'search' | 'clarify' | 'out_of_scope' | 'confirmation_required';
  message: string;
  constraints: Constraints;
  chips: AssistantChip[];
  assumptions: AssistantAssumption[];
  clarify?: AssistantClarify;
  results?: AssistantResultItem[];
  total?: number;
  hidden_unknown_price?: number;
  hidden_unknown_age?: number;
  relaxations?: unknown[];
  unsupported_actions?: UnsupportedAction[];
  events_query?: Record<string, unknown>;
  confirmation?: {
    confirmation_id: string;
    summary: string;
    expires_at: string;
  };
  reference_date: string;
  timezone: 'Asia/Yekaterinburg';
  engine: string;
  trace_id?: string;
}

export const MAX_MESSAGE_LENGTH = 1000;
export const DEFAULT_RESULT_LIMIT = 6;
export const MAX_RESULT_LIMIT = 12;

const MAX_LIST = 12;
const MAX_TEXT = 120;
const MAX_PEOPLE = 20;
const MAX_BUDGET = 1_000_000;
const CONSTRAINT_STATUSES: readonly ConstraintStatus[] = ['scheduled', 'cancelled', 'postponed', 'sold_out', 'unknown'];
const PRICE_PATHS = ['hard.max_price_per_person', 'hard.max_total_price', 'hard.free_only'];
const VALID_AGE_RATING_SET = new Set<string>(AGE_RATINGS.map((a) => a.id));

const SQL = word('sql|drop\\s+table|select\\s+\\*|delete\\s+from|insert\\s+into|truncate\\s+table');
const SYSTEM_PROMPT = word(
  'системн[а-я]+\\s+(?:промпт[а-я]*|инструкци[а-я]+|сообщени[а-я]+)|system\\s+prompt|промпт[а-я]*|' +
    '(?:покажи|выведи|раскрой|напечатай|повтори)\\s+(?:свои\\s+|твои\\s+)?(?:инструкци[а-я]+|правила|настройки)',
);
const PRIVATE_DATA = word(
  'секрет[а-я]*|парол[а-я]+|api[\\s_-]?key|ключ[а-я]*\\s+api|токен[а-я]*|персональн[а-я]+\\s+данн[а-я]+|' +
    '(?:чужие|личные)\\s+данные|переменн[а-я]+\\s+окружени[а-я]+',
);
const IGNORE_RULES = word(
  '(?:игнорируй|забудь|отмени|обойди|нарушь)\\s+(?:все\\s+)?(?:предыдущие\\s+|прошлые\\s+|свои\\s+)?(?:инструкци[а-я]+|правила|указания)|' +
    'ignore\\s+(?:all\\s+)?(?:previous\\s+|prior\\s+)?(?:instructions|rules)|jailbreak|режим\\s+разработчика|developer\\s+mode',
);
const OFF_TOPIC = word(
  'напиши|сочини|переведи|реши|посчитай|вычисли|анекдот[а-я]*|рецепт[а-я]*|погод[а-я]+|' +
    'курс\\s+(?:доллара|евро|валют[а-я]*)|кто\\s+так(?:ой|ая|ие)|что\\s+такое|сколько\\s+будет|эссе|реферат[а-я]*|' +
    'стих[а-я]*|код\\s+на|гороскоп[а-я]*|столица',
);
const DOMAIN = word(
  'куда|сходить|сходим|пойти|пойдем|посетить|афиш[а-я]*|событи[а-я]+|мероприяти[а-я]+|чем\\s+заняться|досуг[а-я]*|' +
    'отдохнуть|развлеч[а-я]+|билет[а-я]*|выходн[а-я]+|что\\s+(?:будет|идет|есть|посмотреть|интересного)|' +
    'что-нибудь|что-то|интересн[а-я]+|подбери|подбор[а-я]*|посоветуй|порекомендуй',
);
const PURCHASE = word(
  'куп(?:и|ить|ите|лю|им)|покуп[а-я]+|закаж[а-я]+|заказать|оформи[а-я]*|оплат[а-я]+|приобрет[а-я]+|приобрести',
);
const BOOKING = word('заброниру[а-я]+|забронир[а-я]+|бронь|брониру[а-я]+');
const RESET = word('начн(?:и|ем)\\s+(?:заново|сначала)|заново|сбрось(?:\\s+все)?|новый\\s+поиск|очисти[а-я]*|забудь\\s+все');
const DATE_UNSET = word('в\\s+любой\\s+день|любая\\s+дата|когда\\s+угодно|дата\\s+не\\s*важна|забудь\\s+про\\s+дат[а-я]+|без\\s+даты');
const TIME_UNSET = word('в\\s+любое\\s+время|время\\s+не\\s*важно|забудь\\s+про\\s+время');
const SKIP = word('неважно|не\\s+важно|люб(?:ой|ого)|не\\s+знаю|пропусти[а-я]*|не\\s+скажу|без\\s+разницы|все\\s+равно');
const ADULT_AUDIENCE = word('(?<!не )для\\s+взрослых(?!\\s+и\\s+(?:для\\s+)?(?:детей|подростков))|взросл(?:ая|ой|ую)\\s+аудитори(?:я|и|ю|ей)');
const CHILD_AUDIENCE = word('(?<!не )для\\s+детей(?!\\s+и\\s+(?:для\\s+)?взрослых)');
const TEEN_AUDIENCE = word('подростков[а-я]+|(?:для|с|со)\\s+подростк[а-я]+|подросткам|подростку');
const SUBSCRIBE_INTENT = word('подпиш[а-я]+|напомн[а-я]+|оповещ[а-я]+|рассылк[а-я]*|присылай\\s+нов[а-я]+');
const FEEDBACK_INTENT = word(
  'добавить\\s+свое\\s+(?:мероприятие|событие)|заявка\\s+организатора|сообщить\\s+об\\s+ошибке|написать\\s+организатору',
);
const GREETING = /^\s*(?:привет[а-я]*|здравствуй[а-я]*|добрый\s+(?:день|вечер)|доброе\s+утро|хай|салют|hello|hi)[\s!.,]*$/i;
const THANKS = /^\s*(?:спасибо|благодарю|понятно|хорошо|ясно|отлично|окей|ок)[\s!.,а-я]*$/i;
const GENERIC_WORD = /^(?:театр|спектакл|концерт|музе|выставк|выставок|фестивал|детск|музык|событи|мероприяти)/;

const TEXT = {
  scope:
    'Я помогаю только с афишей: подбираю события по дате, городу, цене и возрасту. Напишите, куда и когда хотите пойти.',
  refuse:
    'Этого я не делаю. Я подбираю события афиши: напишите, куда и когда хотите пойти, и я покажу подходящие.',
  purchase:
    'Купить билеты я не могу: покупка идёт на сайте организатора, кнопка есть в карточке события.',
  booking: 'Забронировать места я не могу: это делается на сайте организатора, ссылка есть в карточке события.',
  nothingNew: 'Новых условий в сообщении не нашёл, оставил прежние.',
  greeting: 'Здравствуйте!',
  askCity: 'В каком городе ищем?',
  askCityConflict: 'Один и тот же город указан и исключён. В каком городе всё-таки ищем?',
  askLocation: 'Я не знаю, где вы находитесь. В каком городе ищем?',
  askChildAge: 'Сколько лет ребёнку? От возраста зависит, какие события можно показать.',
  askChildrenAges: 'Сколько лет детям? Назовите возраст каждого: по нему проверю возрастные ограничения.',
  askDate: 'Эта дата уже прошла. На какой день подобрать события?',
  askVagueDate: 'На какой день или период подобрать события?',
  askAudience: 'Ищем детские события или события для взрослых?',
  askBudget: 'Ищем только бесплатные события или можно рассмотреть платные?',
  askContradiction: 'Указано, что детей не будет, но указан возраст ребёнка. Кто пойдёт на событие?',
  empty: 'По этим условиям событий нет. Ничего не выдумываю: ниже варианты, какое условие изменить.',
  emptyNoOptions: 'По этим условиям событий нет. Попробуйте изменить дату или город.',
} as const;

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'состоятся',
  cancelled: 'отменённые',
  postponed: 'перенесённые',
  sold_out: 'билеты кончились',
  unknown: 'статус не подтверждён',
};

export function maskPii(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '[phone]');
}

export function emptyConstraints(): Constraints {
  return { hard: {}, soft: {} };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, MAX_TEXT);
  return s ? s : undefined;
}

function cleanStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.map(cleanText).filter((x): x is string => x !== undefined))];
  return out.length > 0 ? out.slice(0, MAX_LIST) : undefined;
}

function cleanInt(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function cleanAges(v: unknown, max: number): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => cleanInt(x, 0, max)).filter((x): x is number => x !== undefined);
  return out.length > 0 ? out.slice(0, MAX_LIST) : undefined;
}

function cleanParticipants(v: unknown): ParticipantsConstraint | undefined {
  if (!isRecord(v)) return undefined;
  const p: ParticipantsConstraint = {};
  const total = cleanInt(v.total, 1, MAX_PEOPLE);
  const adults = cleanInt(v.adults, 0, MAX_PEOPLE);
  const childrenCount = cleanInt(v.children_count, 0, MAX_PEOPLE);
  const childrenAges = cleanAges(v.children_ages, 17);
  const participantAges = cleanAges(v.participant_ages, 120);
  if (total !== undefined) p.total = total;
  if (adults !== undefined) p.adults = adults;
  if (childrenCount !== undefined) p.children_count = childrenCount;
  if (childrenAges) p.children_ages = childrenAges;
  if (participantAges) p.participant_ages = participantAges;
  return Object.keys(p).length > 0 ? p : undefined;
}

function cleanTimeRange(v: unknown): TimeRange | undefined {
  if (!isRecord(v)) return undefined;
  const res: TimeRange = {};
  const isHm = (s: unknown): s is string => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
  for (const key of ['start_from', 'start_to', 'fits_from', 'fits_to'] as const) {
    if (isHm(v[key])) res[key] = v[key];
  }
  // Поддержка старого формата { from, to } для обратной совместимости
  if (res.start_from === undefined && isHm(v.from)) res.start_from = v.from;
  if (res.start_to === undefined && isHm(v.to)) res.start_to = v.to;
  return Object.keys(res).length > 0 ? res : undefined;
}

function normalizeHard(input: Constraints['hard']): Constraints['hard'] {
  const hard: Constraints['hard'] = { ...input };
  if (hard.max_price_per_person !== undefined || hard.max_total_price !== undefined) hard.currency = 'RUB';
  else delete hard.currency;
  if (hard.cities && hard.cities.length > 0) delete hard.region;

  if (hard.participants) {
    const p: ParticipantsConstraint = { ...hard.participants };
    if (p.children_ages && p.children_ages.length > 0) {
      p.children_count = Math.max(p.children_count ?? 0, p.children_ages.length);
    }
    if (p.children_count === 0) {
      delete p.children_count;
      delete p.children_ages;
    }
    const children = p.children_count ?? 0;
    if (p.adults !== undefined) {
      p.total = p.adults + children;
    } else if (p.total !== undefined && p.total < children) {
      p.total = children;
    }
    if (Object.keys(p).length > 0) hard.participants = p;
    else delete hard.participants;
  }
  return hard;
}

function cleanHard(v: unknown): Constraints['hard'] {
  if (!isRecord(v)) return {};
  const hard: Constraints['hard'] = {};
  const cities = cleanStrings(v.cities);
  if (cities) hard.cities = cities.filter(isCitySlug);
  if (hard.cities?.length === 0) delete hard.cities;

  const region = cleanText(v.region);
  if (region && !hard.cities) hard.region = region;

  if (isRecord(v.date)) {
    const { from, to } = v.date;
    if (typeof from === 'string' && typeof to === 'string' && isValidYmd(from) && isValidYmd(to) && from <= to) {
      hard.date = { from, to };
    }
  }
  const time = cleanTimeRange(v.time);
  if (time) hard.time = time;
  const participants = cleanParticipants(v.participants);
  if (participants) hard.participants = participants;

  if (typeof v.max_price_per_person === 'number' && v.max_price_per_person >= 0 && v.max_price_per_person <= MAX_BUDGET) {
    hard.max_price_per_person = v.max_price_per_person;
  }
  if (typeof v.max_total_price === 'number' && v.max_total_price >= 0 && v.max_total_price <= MAX_BUDGET) {
    hard.max_total_price = v.max_total_price;
  }
  if (v.free_only === true) hard.free_only = true;

  const any = cleanStrings(v.categories_any);
  if (any) hard.categories_any = any;
  const exclude = cleanStrings(v.categories_exclude);
  if (exclude) hard.categories_exclude = exclude;
  const rating = cleanText(v.required_age_rating);
  if (rating && VALID_AGE_RATING_SET.has(rating)) hard.required_age_rating = rating;
  for (const key of ['venue_query', 'geo_query', 'title_query', 'topic_query', 'language', 'venue_id'] as const) {
    const txt = cleanText(v[key]);
    if (txt) hard[key] = txt;
  }
  if (Array.isArray(v.statuses)) {
    const st = v.statuses.filter((x): x is ConstraintStatus => CONSTRAINT_STATUSES.includes(x as ConstraintStatus));
    if (st.length > 0) hard.statuses = [...new Set(st)];
  }
  return normalizeHard(hard);
}

function cleanSoft(v: unknown): Constraints['soft'] {
  if (!isRecord(v)) return {};
  const soft: Constraints['soft'] = {};
  const sem = cleanText(v.semantic_query);
  if (sem) soft.semantic_query = sem;
  for (const key of ['preferences', 'preferred_categories', 'category_priority', 'avoid_categories'] as const) {
    const items = cleanStrings(v[key]);
    if (items) soft[key] = items;
  }
  if (v.price_direction === 'lower') soft.price_direction = 'lower';
  if (v.prefer_free === true) soft.prefer_free = true;
  if (v.less_travel === true) soft.less_travel = true;
  const audience = cleanText(v.audience);
  if (audience) soft.audience = audience;
  return soft;
}

export function sanitizeConstraints(raw: unknown): Constraints {
  if (!isRecord(raw)) return emptyConstraints();
  const fields: unknown[] = Array.isArray(raw.unresolved) ? raw.unresolved : [];
  const unresolved = UNRESOLVED_FIELDS.filter((field) => fields.includes(field));
  return {
    hard: cleanHard(raw.hard),
    soft: cleanSoft(raw.soft),
    ...(unresolved.length > 0 ? { unresolved } : {}),
  };
}

function deletePath(constraints: Constraints, path: string): void {
  const [group, key] = path.split('.');
  if (group === 'hard') delete (constraints.hard as Record<string, unknown>)[key];
  if (group === 'soft') delete (constraints.soft as Record<string, unknown>)[key];
}

function cloneConstraints(c: Constraints): Constraints {
  return JSON.parse(JSON.stringify(c)) as Constraints;
}

function updateUnresolved(
  state: Constraints,
  resolved: readonly UnresolvedField[],
  added: readonly ClarifyCode[] = [],
): void {
  const fields = UNRESOLVED_FIELDS.filter((field) =>
    added.includes(field) || (state.unresolved?.includes(field) && !resolved.includes(field)),
  );
  if (fields.length > 0) state.unresolved = fields;
  else delete state.unresolved;
}

export function applyPatch(previous: Constraints, patch: ConstraintsPatch): Constraints {
  const next = patch.reset ? emptyConstraints() : cloneConstraints(previous);
  for (const path of patch.unset ?? []) {
    if (/^(hard|soft)\.[A-Za-z0-9_]+$/.test(path)) deletePath(next, path);
  }
  const setHard = patch.set?.hard ? cleanHard(patch.set.hard) : {};
  const setSoft = patch.set?.soft ? cleanSoft(patch.set.soft) : {};
  if (setHard.max_price_per_person !== undefined) delete next.hard.max_total_price;
  if (setHard.max_total_price !== undefined) delete next.hard.max_price_per_person;
  if (setHard.region !== undefined) delete next.hard.cities;
  next.hard = normalizeHard({ ...next.hard, ...setHard });
  next.soft = { ...next.soft, ...setSoft };
  const resolved: UnresolvedField[] = [];
  if (setHard.date || patch.unset?.includes('hard.date')) resolved.push('date');
  if (setSoft.audience || patch.unset?.includes('soft.audience')) resolved.push('audience');
  if (PRICE_PATHS.some((path) => patch.unset?.includes(path) || path.slice(5) in setHard)) resolved.push('budget');
  updateUnresolved(next, resolved);
  return next;
}

export function needsChildAge(c: Constraints): boolean {
  const p = c.hard.participants;
  if (p?.children_ages && p.children_ages.length > 0) return false;
  if ((p?.children_count ?? 0) > 0) return true;
  if (c.soft.audience === 'teenagers' && !(p?.participant_ages ?? []).some((age) => age < 18)) return true;
  return c.soft.preferences?.includes('family_friendly') ?? false;
}

export function hasPlace(c: Constraints): boolean {
  return (c.hard.cities?.length ?? 0) > 0 || c.hard.region !== undefined;
}

export function youngestAge(c: Constraints): number | null {
  const p = c.hard.participants;
  const ages = [...(p?.children_ages ?? []), ...(p?.participant_ages ?? [])];
  return ages.length > 0 ? Math.min(...ages) : null;
}

export function partyOf(c: Constraints): { adults: number; children: number; adultsAssumed: boolean } {
  const p = c.hard.participants ?? {};
  const children = p.children_count ?? p.children_ages?.length ?? 0;
  if (p.adults !== undefined) return { adults: p.adults, children, adultsAssumed: false };
  if (p.total !== undefined) return { adults: Math.max(p.total - children, 0), children, adultsAssumed: false };
  return { adults: 1, children, adultsAssumed: true };
}

function inVocabulary(token: string, vocabulary: readonly string[]): boolean {
  if (vocabulary.length === 0) return true;
  const base = stemRu(token);
  return vocabulary.some((entry) => entry.startsWith(base));
}

export interface ParseIntoResult {
  next: Constraints;
  pastDate: boolean;
  clarifications: ClarifyCode[];
  nearMe: boolean;
  outsideCity: string | null;
  notInDemoCity: string | null;
  unsupported: UnsupportedAction[];
  contradiction: boolean;
  understood: boolean;
  greeting: boolean;
  thanks: boolean;
  injection: boolean;
  offTopic: boolean;
  hasDomainIntent: boolean;
  subscribeIntent: boolean;
  feedbackIntent: boolean;
  notes: AssistantAssumption[];
}

export function parseIntoConstraints(
  message: string,
  prev: Constraints,
  options: { today: string; answering?: ClarifyCode; vocabulary?: readonly string[] },
): ParseIntoResult {
  const scanner = createScanner(message);
  const notes: AssistantAssumption[] = [];
  if (scanner.homoglyphFixed) {
    notes.push({
      key: 'mixed_script_normalization',
      text: 'латинские буквы в русском слове приведены к кириллице',
    });
  }

  const unsupported: UnsupportedAction[] = [];
  if (mentions(scanner, SQL)) unsupported.push('write_sql');
  if (mentions(scanner, SYSTEM_PROMPT)) unsupported.push('reveal_system_prompt');
  if (mentions(scanner, PRIVATE_DATA)) unsupported.push('reveal_private_data');

  const greeting = GREETING.test(scanner.full);
  const thanks = THANKS.test(scanner.full);
  const hasDomainIntent = mentions(scanner, DOMAIN);

  if (unsupported.length > 0 || mentions(scanner, IGNORE_RULES)) {
    if (unsupported.length === 0) unsupported.push('reveal_system_prompt');
    return {
      next: prev,
      pastDate: false,
      clarifications: [],
      nearMe: false,
      outsideCity: null,
      notInDemoCity: null,
      unsupported,
      contradiction: false,
      understood: false,
      greeting,
      thanks,
      injection: true,
      offTopic: false,
      hasDomainIntent,
      subscribeIntent: false,
      feedbackIntent: false,
      notes: [],
    };
  }

  if (mentions(scanner, OFF_TOPIC) && !hasDomainIntent) {
    return {
      next: prev,
      pastDate: false,
      clarifications: [],
      nearMe: false,
      outsideCity: null,
      notInDemoCity: null,
      unsupported,
      contradiction: false,
      understood: false,
      greeting,
      thanks,
      injection: false,
      offTopic: true,
      hasDomainIntent,
      subscribeIntent: false,
      feedbackIntent: false,
      notes: [],
    };
  }

  const subscribeIntent = Boolean(take(scanner, SUBSCRIBE_INTENT));
  const feedbackIntent = Boolean(take(scanner, FEEDBACK_INTENT));
  const reset = Boolean(take(scanner, RESET));
  if (take(scanner, PURCHASE)) unsupported.push('purchase');
  if (take(scanner, BOOKING)) unsupported.push('booking');

  const date = parseDate(scanner, options.today);
  notes.push(...date.notes);
  const time = parseTime(scanner);
  notes.push(...time.notes);
  const statuses = parseStatuses(scanner);
  const ages = parseAges(scanner, options.answering === 'child_age' || needsChildAge(prev));
  const budget = parseBudget(scanner);
  const resolvingAudience = options.answering === 'audience' || prev.unresolved?.includes('audience');
  const explicitKidsAudience = mentions(scanner, CHILD_AUDIENCE);
  const kidsReply = resolvingAudience && Boolean(take(scanner, CHILD_AUDIENCE));
  const party = parseParty(scanner);
  const place = parsePlace(scanner);
  notes.push(...place.notes);
  const categories = parseCategories(scanner);
  const adultAudience = Boolean(take(scanner, ADULT_AUDIENCE));
  const teenAudience = Boolean(take(scanner, TEEN_AUDIENCE));
  const venueTopic = parseVenueAndTopic(scanner, message);
  const preferences = parsePreferences(scanner);

  const parsedHard: Constraints['hard'] = {};
  const parsedSoft: Constraints['soft'] = {};
  const unset: string[] = [];
  const clarifications: ClarifyCode[] = [];

  if (date.range && !date.past) parsedHard.date = date.range;
  if (time.time) parsedHard.time = time.time;
  if (statuses.statuses.length > 0) parsedHard.statuses = statuses.statuses;
  if (statuses.ageRating) parsedHard.required_age_rating = statuses.ageRating;

  if (budget.unset || budget.contradiction) {
    unset.push(...PRICE_PATHS, 'hard.currency', 'soft.prefer_free', 'soft.price_direction');
  }
  if (budget.contradiction) clarifications.push('budget');
  else if (budget.amount !== undefined) {
    if (budget.isTotal) parsedHard.max_total_price = budget.amount;
    else parsedHard.max_price_per_person = budget.amount;
    parsedHard.currency = 'RUB';
  }
  if (budget.free === 'hard') parsedHard.free_only = true;
  if (budget.free === 'soft') {
    parsedSoft.prefer_free = true;
    parsedSoft.price_direction = 'lower';
  }
  if (budget.cheaper) parsedSoft.price_direction = 'lower';

  const participants: ParticipantsConstraint = {};
  if (party.childrenCount !== undefined) participants.children_count = party.childrenCount;
  if (party.adults !== undefined) participants.adults = party.adults;
  const totalPeople = party.total ?? budget.people;
  if (totalPeople !== undefined) participants.total = totalPeople;
  if (ages.self.length > 0) {
    participants.participant_ages = ages.self;
    participants.total = participants.total ?? 1;
  }
  if (Object.keys(participants).length > 0) parsedHard.participants = participants;

  const cityConflict = place.cities.some((city) => place.excludedCities.includes(city));
  if (cityConflict) {
    unset.push('hard.cities', 'hard.region');
    clarifications.push('city');
  } else if (place.cities.length > 0) parsedHard.cities = place.cities;
  else if (place.region && place.excludedCities.length === 0) parsedHard.region = 'bashkortostan';
  else if (place.excludedCities.length > 0) {
    const remaining = reset ? undefined : prev.hard.cities?.filter((city) => !place.excludedCities.includes(city));
    if (remaining?.length && !place.region) parsedHard.cities = remaining;
    else unset.push('hard.cities', 'hard.region');
  }
  if (place.nearMe) parsedSoft.less_travel = true;

  if (categories.unset) unset.push('hard.categories_any', 'hard.categories_exclude');
  if (categories.any.length > 0) parsedHard.categories_any = categories.any;
  if (categories.exclude.length > 0) parsedHard.categories_exclude = categories.exclude;
  if (categories.avoid.length > 0) parsedSoft.avoid_categories = categories.avoid;
  const kidsAudience = categories.kids || kidsReply;
  if (adultAudience && (kidsAudience || explicitKidsAudience || teenAudience)) {
    unset.push('soft.audience');
    clarifications.push('audience');
  } else if (adultAudience) parsedSoft.audience = 'adults';
  else if (teenAudience) parsedSoft.audience = 'teenagers';
  else if (kidsAudience) parsedSoft.audience = 'children';

  if (venueTopic.venue_query) parsedHard.venue_query = venueTopic.venue_query;
  if (venueTopic.geo_query) parsedHard.geo_query = venueTopic.geo_query;
  if (venueTopic.title_query) parsedHard.title_query = venueTopic.title_query;
  if (venueTopic.topic_query) parsedHard.topic_query = venueTopic.topic_query;

  if (preferences.ids.length > 0) parsedSoft.preferences = preferences.ids;

  const dateUnset = Boolean(take(scanner, DATE_UNSET));
  if (date.past || date.vague || dateUnset) unset.push('hard.date');
  if (date.past || (date.vague && !dateUnset)) clarifications.push('date');
  if (take(scanner, TIME_UNSET)) unset.push('hard.time');

  const waitingForAge = options.answering === 'child_age' || needsChildAge(prev);
  const skipAge = Boolean(waitingForAge && ages.children.length === 0 && !party.noChildren && take(scanner, SKIP));

  const vocab = options.vocabulary ?? [];
  const leftover = tokenizeNlu(scanner.rest).filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  const specific = categories.words.flatMap((entry) => tokenizeNlu(entry)).filter((token) => !GENERIC_WORD.test(token));
  const semantic = [...new Set([...specific, ...leftover])].filter((token) => inVocabulary(token, vocab));
  if (semantic.length > 0) parsedSoft.semantic_query = semantic.join(' ');

  const childrenMentioned = party.childrenMentioned || ages.children.length > 0;
  const contradiction = party.noChildren && ages.children.length > 0;

  const next = reset ? emptyConstraints() : cloneConstraints(prev);
  for (const path of unset) deletePath(next, path);

  const { participants: parsedP, ...restHard } = parsedHard;
  if (PRICE_PATHS.some((path) => (restHard as Record<string, unknown>)[path.slice(5)] !== undefined)) {
    for (const path of PRICE_PATHS) deletePath(next, path);
  }
  if (restHard.cities) delete next.hard.region;
  if (restHard.region) delete next.hard.cities;
  Object.assign(next.hard, restHard);

  const mergedP: ParticipantsConstraint = { ...(next.hard.participants ?? {}), ...(parsedP ?? {}) };
  if (parsedP?.total !== undefined && parsedP.adults === undefined) {
    delete mergedP.adults;
  }
  if (ages.children.length > 0) {
    mergedP.children_ages = ages.children;
    mergedP.children_count = ages.children.length;
  }
  if (party.noChildren || skipAge) {
    delete mergedP.children_count;
    delete mergedP.children_ages;
  }
  if (Object.keys(mergedP).length > 0) next.hard.participants = mergedP;
  else delete next.hard.participants;

  const prefSet = new Set([...(next.soft.preferences ?? []), ...(parsedSoft.preferences ?? [])]);
  if (ages.children.length > 0 || party.noChildren || skipAge) prefSet.delete('family_friendly');
  else if (childrenMentioned && !mergedP.children_ages?.length && !clarifications.includes('audience')) {
    prefSet.add('family_friendly');
  }

  const { preferences: _p, ...restSoft } = parsedSoft;
  void _p;
  Object.assign(next.soft, restSoft);
  if (prefSet.size > 0) next.soft.preferences = [...prefSet];
  else delete next.soft.preferences;
  if (skipAge) next.soft.audience = 'children';
  if (party.noChildren && (next.soft.audience === 'children' || next.soft.audience === 'teenagers')) {
    delete next.soft.audience;
  }

  const resolved: UnresolvedField[] = [];
  if (parsedHard.date || dateUnset) resolved.push('date');
  if (restSoft.audience || (resolvingAudience && party.noChildren)) resolved.push('audience');
  if (budget.amount !== undefined || budget.free || budget.unset) resolved.push('budget');
  updateUnresolved(next, resolved, clarifications);

  next.hard = normalizeHard(next.hard);

  const understood =
    Object.keys(parsedHard).length > 0 ||
    Object.keys(parsedSoft).length > 0 ||
    unset.length > 0 ||
    reset ||
    ages.children.length > 0 ||
    childrenMentioned ||
    party.noChildren ||
    skipAge ||
    place.region ||
    clarifications.length > 0 ||
    subscribeIntent ||
    feedbackIntent;

  return {
    next,
    pastDate: date.past,
    clarifications,
    nearMe: place.nearMe,
    outsideCity: place.outside ?? null,
    notInDemoCity: place.notInDemo ?? null,
    unsupported,
    contradiction,
    understood,
    greeting,
    thanks,
    injection: false,
    offTopic: false,
    hasDomainIntent,
    subscribeIntent,
    feedbackIntent,
    notes,
  };
}

function statusesToFilter(statuses: readonly ConstraintStatus[]): OccurrenceStatus[] {
  const result = new Set<OccurrenceStatus>();
  for (const st of statuses) {
    if (st === 'sold_out') continue;
    if (st === 'postponed') {
      result.add('postponed');
      result.add('rescheduled');
    } else {
      result.add(st);
    }
  }
  if (result.size === 0) {
    result.add('scheduled');
    result.add('rescheduled');
  }
  return [...result];
}

export function toCatalogFilters(c: Constraints, limit = DEFAULT_RESULT_LIMIT): EventsSearchFilters {
  const { hard, soft } = c;
  const mappedCategories = (hard.categories_any ?? []).filter(isCategoryId);
  const mappedExclude = (hard.categories_exclude ?? []).filter(isCategoryId);
  const statusesExplicit = Boolean(hard.statuses && hard.statuses.length > 0);
  const ageRatings = hard.required_age_rating ? [hard.required_age_rating] : [];
  const audience = soft.audience === 'children' ? 'kids' : null;
  const textParts = [hard.title_query, hard.topic_query, hard.venue_query].filter(Boolean);

  return {
    cities: (hard.cities ?? []).filter(isCitySlug),
    categories: mappedCategories,
    categories_exclude: mappedExclude,
    date_preset: null,
    date_from: hard.date?.from ?? null,
    date_to: hard.date?.to ?? null,
    time_from: hard.time?.start_from ?? null,
    time_to: hard.time?.start_to ?? null,
    fits_from: hard.time?.fits_from ?? null,
    fits_to: hard.time?.fits_to ?? null,
    price_max: hard.max_price_per_person ?? null,
    max_total_price: hard.max_total_price ?? null,
    participants: hard.participants ?? null,
    free_only: Boolean(hard.free_only),
    age: youngestAge(c),
    age_ratings: ageRatings,
    audience,
    venue_id: hard.venue_id ?? null,
    venue_query: hard.venue_query ?? null,
    geo_query: hard.geo_query ?? null,
    title_query: hard.title_query ?? null,
    topic_query: hard.topic_query ?? null,
    language: hard.language ?? null,
    statuses: statusesExplicit ? statusesToFilter(hard.statuses!) : [...DEFAULT_OCCURRENCE_STATUSES],
    statuses_explicit: statusesExplicit,
    q: textParts.length > 0 ? textParts.join(' ') : null,
    soft,
    sort: soft.price_direction === 'lower' || soft.prefer_free ? 'price' : 'date',
    page: 1,
    page_size: Math.min(Math.max(1, limit), MAX_RESULT_LIMIT),
  };
}

export function toEventsQuery(c: Constraints): Record<string, unknown> | undefined {
  const { hard, soft } = c;
  if (hard.max_total_price !== undefined) return undefined;
  if (hard.categories_exclude?.length) return undefined;
  if (hard.time?.fits_from || hard.time?.fits_to) return undefined;
  if (hard.categories_any?.some((cat) => !isCategoryId(cat))) return undefined;
  if (hard.cities?.some((city) => !isCitySlug(city))) return undefined;
  if (hard.required_age_rating && !VALID_AGE_RATING_SET.has(hard.required_age_rating)) return undefined;
  if (hard.statuses?.includes('sold_out')) return undefined;

  const q: Record<string, unknown> = {};
  if (hard.cities?.length) q.city = [...hard.cities];
  if (hard.categories_any?.length) q.category = [...hard.categories_any];
  if (hard.date) {
    q.date_from = hard.date.from;
    q.date_to = hard.date.to;
  }
  if (hard.time?.start_from) q.time_from = hard.time.start_from;
  if (hard.time?.start_to) q.time_to = hard.time.start_to;
  if (hard.max_price_per_person !== undefined) q.price_max = Math.floor(hard.max_price_per_person);
  if (hard.free_only) q.free_only = true;
  const age = youngestAge(c);
  if (age !== null) q.age = age;
  if (hard.required_age_rating) q.age_rating = [hard.required_age_rating];
  if (soft.audience === 'children') q.audience = 'kids';
  if (hard.statuses?.length) q.status = statusesToFilter(hard.statuses);
  const text = [hard.title_query, hard.topic_query, hard.venue_query].filter(Boolean).join(' ').trim();
  if (text) q.q = text;
  return q;
}

function categoryNameRu(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.name.ru ?? EXTRA_CATEGORY_LABELS[id] ?? id;
}

function cityNameRu(slug: string): string {
  return CITIES.find((c) => c.slug === slug)?.name.ru ?? slug;
}

function peopleLabel(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} человек`;
  if (mod10 === 1) return `${n} человек`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} человека`;
  return `${n} человек`;
}

function yearsLabel(age: number): string {
  const mod100 = age % 100;
  const mod10 = age % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${age} лет`;
  if (mod10 === 1) return `${age} год`;
  if (mod10 >= 2 && mod10 <= 4) return `${age} года`;
  return `${age} лет`;
}

function participantsLabel(p: ParticipantsConstraint, waitingForAge: boolean): string {
  const parts: string[] = [];
  const ages = p.children_ages ?? [];
  const children = p.children_count ?? ages.length;

  if (p.adults !== undefined && p.adults > 0) {
    parts.push(p.adults === 1 ? '1 взрослый' : `${p.adults} взрослых`);
  } else if (p.total !== undefined && children === 0) {
    parts.push(peopleLabel(p.total));
  }

  if (ages.length === 1) parts.push(`ребёнок ${yearsLabel(ages[0])}`);
  else if (ages.length > 1) parts.push(`дети ${ages.join(' и ')} лет`);
  else if (children === 1) parts.push(waitingForAge ? 'с ребёнком, возраст не указан' : 'с ребёнком');
  else if (children > 1) parts.push(`детей: ${children}`);

  if (p.participant_ages?.length) {
    parts.push(`возраст ${p.participant_ages.map(yearsLabel).join(', ')}`);
  }
  return parts.join(', ');
}

export function buildChips(c: Constraints): AssistantChip[] {
  const { hard, soft } = c;
  const chips: AssistantChip[] = [];
  const add = (chip: Omit<AssistantChip, 'removable' | 'unset'> & { unset?: string[] }) => {
    chips.push({ ...chip, removable: true, unset: chip.unset ?? [chip.key] });
  };

  if (hard.cities?.length) {
    add({ key: 'hard.cities', kind: 'city', label: 'Город', value: hard.cities.map(cityNameRu).join(', ') });
  } else if (hard.region) {
    add({ key: 'hard.region', kind: 'city', label: 'Город', value: 'Вся республика' });
  }

  if (hard.date) {
    add({
      key: 'hard.date',
      kind: 'date',
      label: 'Дата',
      value: formatDateRangeRu(hard.date.from, hard.date.to),
    });
  }

  if (hard.time) {
    const { start_from: from, start_to: to, fits_from: fFrom, fits_to: fTo } = hard.time;
    let value = '';
    if (fFrom || fTo) value = `в интервале ${fFrom ?? '00:00'}–${fTo ?? '23:59'}`;
    else if (from && to) value = `начало с ${from} до ${to}`;
    else if (from) value = `начало после ${from}`;
    else if (to) value = `начало до ${to}`;
    if (value) add({ key: 'hard.time', kind: 'time', label: 'Время', value });
  }

  const p = hard.participants;
  const waitingForAge = Boolean((p?.children_count ?? 0) > 0 && !(p?.children_ages && p.children_ages.length > 0));
  if (p) {
    const val = participantsLabel(p, waitingForAge);
    if (val) add({ key: 'hard.participants', kind: 'participants', label: 'Кто идёт', value: val });
  }

  if (hard.free_only) {
    add({ key: 'hard.free_only', kind: 'budget', label: 'Цена', value: 'только бесплатно' });
  } else if (hard.max_price_per_person !== undefined) {
    add({
      key: 'hard.max_price_per_person',
      kind: 'budget',
      label: 'Бюджет',
      value: `до ${hard.max_price_per_person} ₽ за человека`,
      unset: ['hard.max_price_per_person', 'hard.currency'],
    });
  } else if (hard.max_total_price !== undefined) {
    add({
      key: 'hard.max_total_price',
      kind: 'budget',
      label: 'Бюджет',
      value: `до ${hard.max_total_price} ₽ на всех`,
      unset: ['hard.max_total_price', 'hard.currency'],
    });
  }

  if (hard.categories_any?.length) {
    add({ key: 'hard.categories_any', kind: 'category', label: 'Категория', value: hard.categories_any.map(categoryNameRu).join(', ') });
  }
  if (hard.categories_exclude?.length) {
    add({ key: 'hard.categories_exclude', kind: 'category', label: 'Кроме', value: hard.categories_exclude.map(categoryNameRu).join(', ') });
  }
  if (hard.required_age_rating) {
    add({ key: 'hard.required_age_rating', kind: 'age_rating', label: 'Возрастная метка', value: hard.required_age_rating });
  }
  if (hard.venue_query) add({ key: 'hard.venue_query', kind: 'query', label: 'Площадка', value: hard.venue_query });
  if (hard.geo_query) add({ key: 'hard.geo_query', kind: 'city', label: 'Район', value: hard.geo_query });
  if (hard.title_query) add({ key: 'hard.title_query', kind: 'query', label: 'Название', value: hard.title_query });
  if (hard.topic_query) add({ key: 'hard.topic_query', kind: 'query', label: 'Тема', value: hard.topic_query });
  if (hard.statuses?.length) {
    add({
      key: 'hard.statuses',
      kind: 'status',
      label: 'Статус',
      value: hard.statuses.map((s) => STATUS_LABELS[s] ?? s).join(', '),
    });
  }

  const hasKids = (p?.children_count ?? 0) > 0;
  const prefLabels = (soft.preferences ?? [])
    .filter((id) => !(id === 'family_friendly' && hasKids))
    .map((id) => PREFERENCES.find((entry) => entry.id === id)?.label ?? id)
    .filter(Boolean);
  if (prefLabels.length > 0) {
    add({ key: 'soft.preferences', kind: 'preference', label: 'Пожелание', value: prefLabels.join(', ') });
  }
  if (soft.audience === 'children') {
    add({ key: 'soft.audience', kind: 'preference', label: 'Для кого', value: 'детские события' });
  }
  if (soft.prefer_free) {
    add({ key: 'soft.prefer_free', kind: 'preference', label: 'Пожелание', value: 'лучше бесплатно' });
  } else if (soft.price_direction === 'lower') {
    add({ key: 'soft.price_direction', kind: 'preference', label: 'Пожелание', value: 'подешевле' });
  }
  if (soft.avoid_categories?.length) {
    add({ key: 'soft.avoid_categories', kind: 'preference', label: 'Лучше без', value: soft.avoid_categories.map(categoryNameRu).join(', ') });
  }
  if (soft.semantic_query) {
    add({ key: 'soft.semantic_query', kind: 'query', label: 'По словам', value: soft.semantic_query });
  }

  return chips;
}

export function buildAssumptions(
  c: Constraints,
  today: string,
  notes: readonly AssistantAssumption[],
  options: { searching: boolean },
): AssistantAssumption[] {
  const { hard } = c;
  const result: AssistantAssumption[] = [];

  if (hard.date) {
    const range = formatDateRangeRu(hard.date.from, hard.date.to);
    if (hard.date.from === hard.date.to) {
      if (hard.date.from === today) result.push({ key: 'date_resolved', text: `сегодня = ${range}` });
      else if (hard.date.from === addDays(today, 1)) result.push({ key: 'date_resolved', text: `завтра = ${range}` });
      else if (hard.date.from > today && hard.date.from <= addDays(today, 13)) {
        result.push({ key: 'date_resolved', text: `${weekdayName(hard.date.from)} = ${range}` });
      }
    } else if (new Date(Date.parse(`${hard.date.from}T12:00:00Z`)).getUTCDay() === 6 && hard.date.to === addDays(hard.date.from, 1)) {
      result.push({ key: 'date_resolved', text: `выходные = ${range}` });
    }
  } else if (options.searching) {
    result.push({ key: 'date_not_set', text: 'дата не названа: показываю ближайшие даты каталога' });
  }

  const time = hard.time;
  if (time?.start_from === '18:00' && time.start_to === '23:00') {
    result.push({ key: 'evening_18_23', text: 'вечером = начало с 18:00 до 23:00' });
  } else if (time?.start_from === '06:00' && time.start_to === '12:00') {
    result.push({ key: 'morning_06_12', text: 'утром = начало с 6:00 до 12:00' });
  } else if (time?.start_from === '12:00' && time.start_to === '18:00') {
    result.push({ key: 'day_12_18', text: 'днём = начало с 12:00 до 18:00' });
  }

  if (hard.max_price_per_person !== undefined) {
    result.push({ key: 'price_per_person_by_default', text: `до ${hard.max_price_per_person} ₽ за человека` });
  }
  if (hard.max_total_price !== undefined) {
    const party = partyOf(c);
    const people = party.adults + party.children;
    result.push({
      key: party.adultsAssumed ? 'party_assumed' : 'total_budget',
      text: party.adultsAssumed
        ? `бюджет на всех: считаю ${peopleLabel(people)}, из них взрослых ${party.adults}`
        : `бюджет на всех: ${peopleLabel(people)}`,
    });
  }

  const ages = hard.participants?.children_ages ?? [];
  if (ages.length > 1) {
    result.push({ key: 'youngest_child', text: `возрастную метку проверяю по младшему: ${yearsLabel(Math.min(...ages))}` });
  }

  if (options.searching && !hard.statuses?.length) {
    result.push({
      key: 'default_scheduled_disclosed',
      text: 'отменённые сеансы и сеансы с неподтверждённым статусом скрыты',
    });
  }

  for (const note of notes) {
    if (!result.some((x) => x.key === note.key)) result.push(note);
  }
  return result;
}

export function buildReasons(event: ApiEvent, occId: string, c: Constraints, today: string): string[] {
  const { hard, soft } = c;
  const occ = event.occurrences.find((o) => o.id === occId) ?? event.occurrences[0];
  const reasons: string[] = [];

  if (occ) {
    const ymd = occ.date_start.slice(0, 10);
    const hm = occ.time_precision === 'minute' ? occ.date_start.slice(11, 16) : null;
    if (hm) {
      if (ymd === today) reasons.push(`сегодня в ${hm}`);
      else if (ymd === addDays(today, 1)) reasons.push(`завтра в ${hm}`);
      else reasons.push(`${weekdayInRu(ymd)}, ${formatRuDay(ymd)}, в ${hm}`);
    } else {
      reasons.push(formatRuDay(ymd));
    }
  }

  const age = youngestAge(c);
  if (age !== null && event.age_limit !== null && event.age_limit <= age) {
    reasons.push(`подходит по возрасту: ${event.age_limit}+`);
  }

  if (hard.free_only && event.is_free) {
    reasons.push('вход бесплатный');
  } else if (hard.max_price_per_person !== undefined) {
    if (event.is_free) reasons.push('вход бесплатный, в бюджете');
    else if (event.price_min !== null) reasons.push(`цена от ${event.price_min} ₽, в бюджете`);
  } else if (hard.max_total_price !== undefined) {
    const cost = computePartyCost(event, hard.participants);
    const party = partyOf(c);
    if (cost !== null) {
      reasons.push(
        cost === 0
          ? 'вход бесплатный, в бюджете'
          : `на ${peopleLabel(party.adults + party.children)} от ${cost} ₽, в бюджете`,
      );
    }
  } else if (soft.prefer_free && event.is_free) {
    reasons.push('вход бесплатный');
  }

  if (hard.cities?.length) {
    reasons.push(`${event.city}: ${event.venue}`);
  }
  if (hard.categories_any?.includes(event.category)) {
    reasons.push(`раздел «${categoryNameRu(event.category)}»`);
  }

  const hay = normalizeNluText(`${event.title} ${event.description} ${event.tags.join(' ')}`);
  for (const id of soft.preferences ?? []) {
    const pref = PREFERENCES.find((p) => p.id === id);
    if (!pref) continue;
    const ev = pref.evidence.find((e) => hay.includes(e));
    if (ev) reasons.push(`в описании: «${ev}»`);
  }

  if (soft.semantic_query) {
    const hit = tokenizeNlu(soft.semantic_query).find((t) => hay.includes(stemRu(t)));
    if (hit) reasons.push(`по вашим словам: «${hit}»`);
  }

  return [...new Set(reasons)];
}

export function buildCaveats(event: ApiEvent, occId: string): string[] {
  const occ = event.occurrences.find((o) => o.id === occId) ?? event.occurrences[0];
  const caveats: string[] = [];
  if (occ?.availability === 'sold_out') caveats.push('билеты на этот сеанс кончились');
  if (occ?.status === 'rescheduled') caveats.push('сеанс перенесён: проверьте новую дату');
  if (occ?.status === 'cancelled' || event.status === 'cancelled') caveats.push('сеанс отменён');
  if (occ?.status === 'postponed') caveats.push('сеанс перенесён, новая дата не объявлена');
  if (occ?.status === 'unknown') caveats.push('статус сеанса не подтверждён');
  if (event.price_min === null && !event.is_free) caveats.push('цена не указана');
  return caveats;
}

function replayHistory(
  history: readonly AssistantHistoryItem[] | undefined,
  today: string,
  vocabulary: readonly string[],
): Constraints {
  let state = emptyConstraints();
  if (!history?.length) return state;
  for (const turn of history.slice(-10)) {
    if (turn.role === 'user' && turn.content.trim()) {
      const p = parseIntoConstraints(turn.content, state, { today, vocabulary });
      if (!p.injection && !p.offTopic) state = p.next;
    }
  }
  return state;
}

function eventsWord(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'событий';
  if (mod10 === 1) return 'событие';
  if (mod10 >= 2 && mod10 <= 4) return 'события';
  return 'событий';
}

export async function runDeterministicAssistant(
  request: AssistantRequest,
  runtime: ToolRuntime,
  now: Date = new Date(),
  engineName = 'rules-v2',
): Promise<AssistantResponsePayload> {
  const { date: today } = localNow(now);
  const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_RESULT_LIMIT), MAX_RESULT_LIMIT);

  // Строим словарь каталога для более точного semantic_query
  const publishedEvents = await runtime.getAllPublishedEvents();
  const vocabSet = new Set<string>();
  for (const ev of publishedEvents) {
    for (const tok of tokenizeNlu(`${ev.title} ${ev.description} ${ev.tags.join(' ')}`)) {
      vocabSet.add(tok);
    }
  }
  const vocabulary = [...vocabSet];

  let state = request.previous
    ? sanitizeConstraints(request.previous)
    : replayHistory(request.history, today, vocabulary);

  if (request.patch) {
    state = applyPatch(state, request.patch);
  }

  const message = (request.message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
  let parsed: ParseIntoResult | null = null;
  let nothingNew = false;

  if (message) {
    parsed = parseIntoConstraints(message, state, {
      today,
      answering: request.answering,
      vocabulary,
    });

    const isEmptyState = Object.keys(state.hard).length === 0 && Object.keys(state.soft).length === 0;
    const silent =
      !parsed.understood && !parsed.greeting && !parsed.hasDomainIntent && parsed.unsupported.length === 0;

    if (parsed.injection || parsed.offTopic || (silent && !parsed.thanks && isEmptyState)) {
      return {
        action: 'out_of_scope',
        message: parsed.injection ? TEXT.refuse : TEXT.scope,
        constraints: state,
        chips: buildChips(state),
        assumptions: [],
        ...(parsed.unsupported.length > 0 ? { unsupported_actions: parsed.unsupported } : {}),
        reference_date: today,
        timezone: TIMEZONE,
        engine: engineName,
      };
    }

    nothingNew = silent && !isEmptyState;
    state = parsed.next;

    // Запись в БД (подписка/заявка) строго через подтверждение пользователя (Human-in-the-Loop)
    if (parsed.subscribeIntent) {
      const subRes = await runtime.execute('subscribe', {
        ...(state.hard.cities?.[0] ? { city: state.hard.cities[0] } : {}),
        ...(state.hard.categories_any?.[0] && isCategoryId(state.hard.categories_any[0])
          ? { category: state.hard.categories_any[0] }
          : {}),
        period: 'weekend',
      });
      if (subRes.ok) {
        const d = subRes.data as { status?: string; confirmation_id?: string; summary?: string; expires_at?: string };
        if (d.status === 'confirmation_required' && d.confirmation_id) {
          return {
            action: 'confirmation_required',
            message: `Подтвердите оформление подписки: ${d.summary}`,
            constraints: state,
            chips: buildChips(state),
            assumptions: buildAssumptions(state, today, parsed.notes, { searching: false }),
            confirmation: {
              confirmation_id: d.confirmation_id,
              summary: d.summary ?? 'Подписка на обновления афиши',
              expires_at: d.expires_at ?? '',
            },
            reference_date: today,
            timezone: TIMEZONE,
            engine: engineName,
          };
        }
      }
    }

    if (parsed.feedbackIntent) {
      const fbRes = await runtime.execute('save_feedback', {
        kind: /ошибк/i.test(message) ? 'correction' : 'organizer_application',
        text: message,
      });
      if (fbRes.ok) {
        const d = fbRes.data as { confirmation_id?: string; summary?: string; expires_at?: string };
        if (d.confirmation_id) {
          return {
            action: 'confirmation_required',
            message: `Подтвердите отправку обращения: ${d.summary}`,
            constraints: state,
            chips: buildChips(state),
            assumptions: buildAssumptions(state, today, parsed.notes, { searching: false }),
            confirmation: {
              confirmation_id: d.confirmation_id,
              summary: d.summary ?? 'Обращение организатора',
              expires_at: d.expires_at ?? '',
            },
            reference_date: today,
            timezone: TIMEZONE,
            engine: engineName,
          };
        }
      }
    }
  }

  const pending = [...new Set<ClarifyCode>([...(parsed?.clarifications ?? []), ...(state.unresolved ?? [])])];
  if (parsed?.contradiction) pending.unshift('contradiction');
  if (!hasPlace(state) && !pending.includes('city')) pending.push(parsed?.nearMe ? 'location' : 'city');
  if (needsChildAge(state)) pending.push('child_age');

  const unsupported = parsed?.unsupported ?? [];
  const prefixParts: string[] = [];
  if (parsed?.greeting) prefixParts.push(TEXT.greeting);
  if (unsupported.includes('purchase')) prefixParts.push(TEXT.purchase);
  else if (unsupported.includes('booking')) prefixParts.push(TEXT.booking);
  if (parsed?.outsideCity) {
    prefixParts.push(`Город ${parsed.outsideCity} за пределами афиши: здесь только события Башкортостана.`);
  } else if (parsed?.notInDemoCity) {
    prefixParts.push(`В демо-каталоге пока нет событий в городе ${parsed.notInDemoCity}.`);
  }
  if (nothingNew) prefixParts.push(TEXT.nothingNew);

  if (pending.length > 0) {
    const code = pending[0];
    let clarify: AssistantClarify;
    if (code === 'contradiction') {
      clarify = {
        code,
        pending,
        question: TEXT.askContradiction,
        quick_replies: ['Иду без детей'],
      };
    } else if (code === 'budget') {
      clarify = {
        code,
        pending,
        question: TEXT.askBudget,
        quick_replies: ['Только бесплатно', 'Любая цена'],
      };
    } else if (code === 'audience') {
      clarify = {
        code,
        pending,
        question: TEXT.askAudience,
        quick_replies: ['Для детей', 'Для взрослых'],
      };
    } else if (code === 'date') {
      clarify = {
        code,
        pending,
        question: parsed?.pastDate ? TEXT.askDate : TEXT.askVagueDate,
        quick_replies: ['Сегодня', 'Завтра', 'На выходных'],
      };
    } else if (code === 'child_age') {
      const count = state.hard.participants?.children_count;
      const teen = state.soft.audience === 'teenagers';
      const replies = teen ? ['12 лет', '14 лет', '16 лет', '17 лет'] : ['3 года', '5 лет', '7 лет', '10 лет', '14 лет'];
      if (count === undefined) replies.push('Иду без детей');
      clarify = {
        code,
        pending,
        question: teen && (count ?? 1) === 1
          ? 'Сколько лет подростку? По возрасту проверю, какие события подходят.'
          : count === 1 ? TEXT.askChildAge : TEXT.askChildrenAges,
        quick_replies: replies,
      };
    } else {
      clarify = {
        code,
        pending,
        question: code === 'location' ? TEXT.askLocation : parsed?.clarifications.includes('city')
          ? TEXT.askCityConflict
          : TEXT.askCity,
        quick_replies: [...CITIES.map((c) => c.name.ru), 'Вся республика'],
      };
    }

    return {
      action: 'clarify',
      message: [...prefixParts, clarify.question].join(' '),
      constraints: state,
      chips: buildChips(state),
      assumptions: buildAssumptions(state, today, parsed?.notes ?? [], { searching: false }),
      clarify,
      ...(unsupported.length > 0 ? { unsupported_actions: unsupported } : {}),
      reference_date: today,
      timezone: TIMEZONE,
      engine: engineName,
    };
  }

  const filters = toCatalogFilters(state, limit);
  const searched = await runtime.searchWithConstraints(filters, today);
  const total = searched.outcome.matches.length;
  const results: AssistantResultItem[] = searched.items.slice(0, limit).map((item) => ({
    event: item,
    occurrence_id: item.primary_occurrence_id,
    reasons: buildReasons(item, item.primary_occurrence_id, state, today),
    caveats: buildCaveats(item, item.primary_occurrence_id),
  }));

  const missingCat = (state.hard.categories_any ?? []).find((cat) => EXTRA_CATEGORY_LABELS[cat]);
  let summary: string;
  if (total === 0) {
    const parts: string[] = [];
    if (missingCat) parts.push(`Раздела «${EXTRA_CATEGORY_LABELS[missingCat]}» в афише пока нет.`);
    parts.push(searched.relaxations.length > 0 ? TEXT.empty : TEXT.emptyNoOptions);
    summary = parts.join(' ');
  } else if (total > results.length) {
    summary = `Нашлось ${total} ${eventsWord(total)}. Показываю ${results.length}: самые подходящие.`;
  } else {
    summary = `Нашлось ${total} ${eventsWord(total)} по вашим условиям.`;
  }

  const hiddenParts: string[] = [];
  if (searched.outcome.hidden_unknown_price > 0) {
    hiddenParts.push(`Ещё ${searched.outcome.hidden_unknown_price} не показываю: цена у них не указана.`);
  }
  if (searched.outcome.hidden_unknown_age > 0) {
    hiddenParts.push(`Ещё ${searched.outcome.hidden_unknown_age} не показываю: возрастное ограничение не указано.`);
  }

  const eventsQuery = toEventsQuery(state);

  return {
    action: 'search',
    message: [...prefixParts, summary, ...hiddenParts].join(' '),
    constraints: state,
    chips: buildChips(state),
    assumptions: buildAssumptions(state, today, parsed?.notes ?? [], { searching: true }),
    results,
    total,
    hidden_unknown_price: searched.outcome.hidden_unknown_price,
    hidden_unknown_age: searched.outcome.hidden_unknown_age,
    ...(total === 0 ? { relaxations: searched.relaxations } : {}),
    ...(unsupported.length > 0 ? { unsupported_actions: unsupported } : {}),
    ...(eventsQuery ? { events_query: eventsQuery } : {}),
    reference_date: today,
    timezone: TIMEZONE,
    engine: engineName,
  };
}
