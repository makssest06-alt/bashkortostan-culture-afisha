/**
 * Разбор русской фразы в условия поиска. Правила без языковой модели:
 * это заглушка в формате будущего ассистента, поэтому результат детерминирован.
 *
 * Разборщик только извлекает то, что сказано. Решение, искать или уточнять,
 * принимает src/lib/api/assistant.ts.
 */

import { stem, tokenize } from '../text';
import type {
  AssistantAssumption,
  ClarifyCode,
  HardConstraints,
  SoftConstraints,
  UnsupportedAction,
} from '../types';
import { parseDate, parseTime } from './dates';
import { STOP_WORDS } from './lexicon';
import { createScanner, mentions, take, word } from './scanner';
import {
  parseAges,
  parseBudget,
  parseCategories,
  parseParty,
  parsePlace,
  parsePreferences,
  parseStatuses,
} from './slots';

export interface ParseContext {
  /** Сегодняшняя дата в поясе афиши. */
  today: string;
  /** На какой вопрос отвечает пользователь. */
  answering?: ClarifyCode;
  /** В прежних условиях есть ребёнок без возраста: голое число считается возрастом. */
  awaitingChildAge: boolean;
  /** Слова из названий и описаний каталога: по ним отбираются слова для поиска по смыслу. */
  vocabulary: readonly string[];
}

export interface ParsedMessage {
  hard: HardConstraints;
  soft: SoftConstraints;
  /** Пути условий, которые пользователь попросил снять. */
  unset: string[];
  reset: boolean;
  childrenAges: number[];
  selfAges: number[];
  childrenMentioned: boolean;
  noChildren: boolean;
  /** Пользователь отказался называть возраст ребёнка. */
  skipAge: boolean;
  pastDate: boolean;
  nearMe: boolean;
  outsideCity?: string;
  notInDemoCity?: string;
  unsupported: UnsupportedAction[];
  /** Попытка обойти правила или вытащить служебные сведения. */
  injection: boolean;
  /** Запрос не про афишу. */
  offTopic: boolean;
  greeting: boolean;
  thanks: boolean;
  /** Во фразе есть слова про досуг: «куда пойти», «афиша», «билеты». */
  hasDomainIntent: boolean;
  /** Из фразы удалось извлечь хотя бы одно условие. */
  understood: boolean;
  notes: AssistantAssumption[];
}

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
const GREETING = /^\s*(?:привет[а-я]*|здравствуй[а-я]*|добрый\s+(?:день|вечер)|доброе\s+утро|хай|салют|hello|hi)[\s!.,]*$/;
const THANKS = /^\s*(?:спасибо|благодарю|понятно|хорошо|ясно|отлично|окей|ок)[\s!.,а-я]*$/;

/** Слова-категории общего значения: в поиск по описанию они ничего не добавляют. */
const GENERIC_WORD = /^(?:театр|спектакл|концерт|музе|выставк|выставок|фестивал|детск|музык|событи|мероприяти)/;

function inVocabulary(token: string, vocabulary: readonly string[]): boolean {
  const base = stem(token);
  return vocabulary.some((entry) => entry.startsWith(base));
}

export function parseMessage(message: string, context: ParseContext): ParsedMessage {
  const scanner = createScanner(message);
  const result: ParsedMessage = {
    hard: {},
    soft: {},
    unset: [],
    reset: false,
    childrenAges: [],
    selfAges: [],
    childrenMentioned: false,
    noChildren: false,
    skipAge: false,
    pastDate: false,
    nearMe: false,
    unsupported: [],
    injection: false,
    offTopic: false,
    greeting: GREETING.test(scanner.full),
    thanks: THANKS.test(scanner.full),
    hasDomainIntent: mentions(scanner, DOMAIN),
    understood: false,
    notes: [],
  };

  // Безопасность проверяется по всей фразе и раньше любых условий.
  if (mentions(scanner, SQL)) result.unsupported.push('write_sql');
  if (mentions(scanner, SYSTEM_PROMPT)) result.unsupported.push('reveal_system_prompt');
  if (mentions(scanner, PRIVATE_DATA)) result.unsupported.push('reveal_private_data');
  if (result.unsupported.length > 0 || mentions(scanner, IGNORE_RULES)) {
    result.injection = true;
    if (result.unsupported.length === 0) result.unsupported.push('reveal_system_prompt');
    return result;
  }
  if (mentions(scanner, OFF_TOPIC) && !result.hasDomainIntent) {
    result.offTopic = true;
    return result;
  }

  if (take(scanner, RESET)) result.reset = true;
  if (take(scanner, PURCHASE)) result.unsupported.push('purchase');
  if (take(scanner, BOOKING)) result.unsupported.push('booking');

  // Порядок важен: даты и время забирают свои числа раньше возраста и бюджета.
  const date = parseDate(scanner, context.today);
  if (date.range) {
    result.hard.date = date.range;
    result.pastDate = date.past;
  }
  result.notes.push(...date.notes);

  const time = parseTime(scanner);
  if (time.time) result.hard.time = time.time;
  result.notes.push(...time.notes);

  const statuses = parseStatuses(scanner);
  if (statuses.statuses.length > 0) result.hard.statuses = statuses.statuses;
  if (statuses.ageRating) result.hard.required_age_rating = statuses.ageRating;

  const ages = parseAges(scanner, context.answering === 'child_age' || context.awaitingChildAge);
  result.childrenAges = ages.children;
  result.selfAges = ages.self;

  const budget = parseBudget(scanner);
  if (budget.unset) {
    result.unset.push('hard.max_price_per_person', 'hard.max_total_price', 'hard.currency', 'hard.free_only');
  }
  if (budget.amount !== undefined) {
    if (budget.isTotal) result.hard.max_total_price = budget.amount;
    else result.hard.max_price_per_person = budget.amount;
    result.hard.currency = 'RUB';
  }
  if (budget.free === 'hard') result.hard.free_only = true;
  if (budget.free === 'soft') {
    result.soft.prefer_free = true;
    result.soft.price_direction = 'lower';
  }
  if (budget.cheaper) result.soft.price_direction = 'lower';

  const party = parseParty(scanner);
  result.childrenMentioned = party.childrenMentioned || ages.children.length > 0;
  result.noChildren = party.noChildren;
  const participants: NonNullable<HardConstraints['participants']> = {};
  if (party.childrenCount !== undefined) participants.children_count = party.childrenCount;
  if (party.adults !== undefined) participants.adults = party.adults;
  const total = party.total ?? budget.people;
  if (total !== undefined) participants.total = total;
  if (ages.self.length > 0) {
    participants.participant_ages = ages.self;
    participants.total = participants.total ?? 1;
  }
  if (Object.keys(participants).length > 0) result.hard.participants = participants;

  const place = parsePlace(scanner);
  if (place.cities.length > 0) result.hard.cities = place.cities;
  else if (place.region) result.hard.region = 'bashkortostan';
  result.nearMe = place.nearMe;
  if (place.nearMe) result.soft.less_travel = true;
  if (place.outside) result.outsideCity = place.outside;
  if (place.notInDemo) result.notInDemoCity = place.notInDemo;

  const categories = parseCategories(scanner);
  if (categories.unset) result.unset.push('hard.categories_any', 'hard.categories_exclude');
  if (categories.any.length > 0) result.hard.categories_any = categories.any;
  if (categories.exclude.length > 0) result.hard.categories_exclude = categories.exclude;
  if (categories.avoid.length > 0) result.soft.avoid_categories = categories.avoid;
  if (categories.kids) result.soft.audience = 'children';

  const preferences = parsePreferences(scanner);
  if (preferences.ids.length > 0) result.soft.preferences = preferences.ids;

  if (take(scanner, DATE_UNSET)) result.unset.push('hard.date');
  if (take(scanner, TIME_UNSET)) result.unset.push('hard.time');

  const waitingForAge = context.answering === 'child_age' || context.awaitingChildAge;
  if (waitingForAge && ages.children.length === 0 && !party.noChildren && take(scanner, SKIP)) {
    result.skipAge = true;
  }

  // Что осталось: слова, которые есть в названиях и описаниях каталога.
  const leftover = tokenize(scanner.rest).filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  const specific = categories.words.flatMap((entry) => tokenize(entry)).filter((token) => !GENERIC_WORD.test(token));
  const semantic = [...new Set([...specific, ...leftover])].filter((token) => inVocabulary(token, context.vocabulary));
  if (semantic.length > 0) result.soft.semantic_query = semantic.join(' ');

  result.understood =
    Object.keys(result.hard).length > 0 ||
    Object.keys(result.soft).length > 0 ||
    result.unset.length > 0 ||
    result.reset ||
    result.childrenAges.length > 0 ||
    result.childrenMentioned ||
    result.noChildren ||
    result.skipAge ||
    place.region;

  return result;
}
