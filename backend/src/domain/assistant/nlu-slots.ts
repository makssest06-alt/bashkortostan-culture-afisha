import {
  AGE_PREFIXES,
  AMOUNT_WORDS,
  AMOUNT_WORD_PATTERN,
  CATEGORY_ALIASES,
  CATEGORY_PATTERNS,
  CITY_FUZZY_BASES,
  CITY_PATTERNS,
  NOT_IN_DEMO_CITIES,
  NUMBER_WORDS,
  NUMBER_WORD_PATTERN,
  OUTSIDE_CITIES,
  PREFERENCES,
  REGION_PATTERN,
} from './nlu-lexicon.js';
import { before, consume, find, levenshtein1, mentions, take, takeAll, word, type Scanner } from './nlu-scanner.js';
import type { NluAssumption } from './nlu-dates.js';

const MAX_CHILD_AGE = 17;
const MAX_BUDGET = 1_000_000;

export type ConstraintStatus = 'scheduled' | 'cancelled' | 'postponed' | 'sold_out' | 'unknown';

const CHILD_NOUN =
  'ребенк[а-я]+|ребенок|дочк[а-я]+|дочер[а-я]+|дочь|сын[а-я]*|малыш[а-я]*|внук[а-я]*|внучк[а-я]+|дет(?:ям|ьми|ей|и)|школьник[а-я]*|подросток|подростк[а-я]+';
const AGE_UNIT = 'лет(?:н[а-я]+)?|года|годик[а-я]*|годов|год';
const AGE_PREFIX_PATTERN = Object.keys(AGE_PREFIXES).sort((a, b) => b.length - a.length).join('|');

export interface ParsedAges {
  children: number[];
  self: number[];
}

function pushAge(target: number[], value: number): void {
  if (Number.isInteger(value) && value >= 0 && value <= MAX_CHILD_AGE) target.push(value);
}

export function parseAges(scanner: Scanner, acceptBareNumbers: boolean): ParsedAges {
  const children: number[] = [];
  const self: number[] = [];

  const own = take(scanner, word(`мне\\s+(\\d{1,2})(?:\\s*(?:${AGE_UNIT}))?`));
  if (own) self.push(Number(own[1]));

  const pair = take(scanner, word(`(\\d{1,2})\\s*(?:и|,)\\s*(\\d{1,2})\\s*(?:${AGE_UNIT})`));
  if (pair) {
    pushAge(children, Number(pair[1]));
    pushAge(children, Number(pair[2]));
  }

  for (const match of takeAll(scanner, word(`(?:до\\s+)?(\\d{1,2})\\s*-?\\s*(?:${AGE_UNIT})`))) {
    pushAge(children, Number(match[1]));
  }

  for (const match of takeAll(scanner, word(`(${NUMBER_WORD_PATTERN})\\s+(?:${AGE_UNIT})`))) {
    pushAge(children, NUMBER_WORDS[match[1]]);
  }

  for (const match of takeAll(scanner, word(`(${AGE_PREFIX_PATTERN})летн[а-я]+`))) {
    pushAge(children, AGE_PREFIXES[match[1]]);
  }

  if (take(scanner, word('полтора\\s+года|полутора\\s+лет|годовал[а-я]+'))) children.push(1);

  const afterNoun = find(scanner, word(`(?:${CHILD_NOUN})\\s+(\\d{1,2})(?:\\s*(?:и|,)\\s*(\\d{1,2}))?`));
  if (afterNoun && Number(afterNoun[1]) <= MAX_CHILD_AGE) {
    const numbers = afterNoun[0].replace(/^[^\d]+/, '');
    const start = afterNoun.index + afterNoun[0].length - numbers.length;
    scanner.rest = scanner.rest.slice(0, start) + ' '.repeat(numbers.length) + scanner.rest.slice(start + numbers.length);
    pushAge(children, Number(afterNoun[1]));
    if (afterNoun[2]) pushAge(children, Number(afterNoun[2]));
  }

  if (acceptBareNumbers && children.length === 0) {
    const bare = /^\s*(\d{1,2})(?:\s*(?:и|,)\s*(\d{1,2}))?\s*$/.exec(scanner.rest);
    if (bare) {
      pushAge(children, Number(bare[1]));
      if (bare[2]) pushAge(children, Number(bare[2]));
      if (children.length > 0) scanner.rest = ' '.repeat(scanner.rest.length);
    }
  }

  return { children, self };
}

const NUM = '(\\d{1,3}(?:\\s\\d{3})+|\\d+)(?:[.,](\\d+))?';
const MULT = '(?:\\s*(тыс(?:яч[а-я]*|\\.)?|к|k))?';
const CURRENCY = '₽|руб(?:л[а-я]+)?\\.?|р\\.?';
const LIMIT =
  'до|не\\s+дороже|не\\s+больше|не\\s+более|максимум|в\\s+пределах|дешевле|бюджет(?:ом)?(?:\\s+(?:до|в))?|уложиться\\s+в|за';
const TOTAL_MARKER =
  'на\\s+(двоих|троих|четверых|пятерых|всех|нас|семью|всю\\s+семью|компанию|всю\\s+компанию)|общ(?:ий|им|его)\\s+бюджет[а-я]*|в\\s+сумме|на\\s+круг';
const FREE =
  'бесплатн[а-я]+|бесплатно|даром|за\\s+бесплатно|без\\s+платных\\s+билетов|вход\\s+свободн[а-я]+|свободн[а-я]+\\s+вход';
const FREE_IS_SOFT =
  '(?:желательно|хотелось\\s+бы|лучше|по\\s+возможности)\\s+(?:бы\\s+)?бесплатн|бесплатн[а-я]*,?\\s+(?:но\\s+)?(?:не\\s+обязательно|необязательно)';
const BUDGET_UNSET =
  '(?:забудь\\s+про|убери|сними|без)\\s+(?:бюджет[а-я]*|ограничени[а-я]+\\s+(?:по\\s+)?цен[а-я]+|лимит[а-я]*)|(?:бюджет|цена)\\s+(?:больше\\s+|уже\\s+)?не\\s*важ[а-я]+|люб(?:ая|ой)\\s+(?:цена|бюджет)|за\\s+любые\\s+деньги';
const PAID_ALLOWED = word('(?<!не )(?:можно|подойдут|рассмотрю|допускаются)\\s+(?:и\\s+)?платн[а-я]+');
const PAID = word('платн[а-я]+');
const FREE_ADJECTIVE = word('бесплатн[а-я]+');
const PEOPLE_BY_WORD: Record<string, number> = { двоих: 2, троих: 3, четверых: 4, пятерых: 5 };

export interface ParsedBudget {
  amount?: number;
  isTotal: boolean;
  people?: number;
  free?: 'hard' | 'soft';
  cheaper: boolean;
  unset: boolean;
  paidAllowed?: boolean;
  contradiction: boolean;
}

function toAmount(whole: string, fraction: string | undefined, multiplier: string | undefined): number {
  const base = Number(`${whole.replace(/\s/g, '')}${fraction ? `.${fraction}` : ''}`);
  return Math.round(multiplier ? base * 1000 : base);
}

export function parseBudget(scanner: Scanner): ParsedBudget {
  const result: ParsedBudget = { isTotal: false, cheaper: false, unset: false, contradiction: false };

  if (take(scanner, word(BUDGET_UNSET))) {
    result.unset = true;
    return result;
  }

  result.paidAllowed = Boolean(take(scanner, PAID_ALLOWED));

  const numeric = find(scanner, word(`(${LIMIT})(?:\\s*[-:])?\\s+${NUM}${MULT}(?:\\s*(${CURRENCY}))?`));
  if (numeric) {
    const [, limit, whole, fraction, multiplier, currency] = numeric;
    const amount = toAmount(whole, fraction, multiplier);
    const hasMoneySign = Boolean(multiplier) || Boolean(currency);
    const plausible = hasMoneySign || (limit !== 'за' && amount >= 50);
    if (plausible && amount > 0 && amount <= MAX_BUDGET) {
      consume(scanner, numeric);
      result.amount = amount;
    }
  }

  if (result.amount === undefined) {
    const words = take(scanner, word(`(?:${LIMIT})\\s+(${AMOUNT_WORD_PATTERN})(?:\\s*(?:${CURRENCY}))?`));
    if (words) result.amount = AMOUNT_WORDS[words[1].replace(/\s+/g, ' ')];
  }

  if (result.amount === undefined) {
    const bare = find(scanner, word(`${NUM}${MULT}\\s*(?:${CURRENCY})`));
    if (bare) {
      const amount = toAmount(bare[1], bare[2], bare[3]);
      if (amount > 0 && amount <= MAX_BUDGET) {
        consume(scanner, bare);
        result.amount = amount;
      }
    }
  }

  const total = word(TOTAL_MARKER).exec(scanner.full);
  if (total && result.amount !== undefined) {
    take(scanner, word(TOTAL_MARKER));
    result.isTotal = true;
    if (total[1] && PEOPLE_BY_WORD[total[1]]) result.people = PEOPLE_BY_WORD[total[1]];
  }

  if (find(scanner, PAID) && find(scanner, FREE_ADJECTIVE)) {
    takeAll(scanner, PAID);
    takeAll(scanner, FREE_ADJECTIVE);
    result.contradiction = true;
  } else if (take(scanner, word(FREE))) {
    result.free = mentions(scanner, new RegExp(FREE_IS_SOFT)) ? 'soft' : 'hard';
  }

  if (take(scanner, word('недорог[а-я]+|подешевле|дешевле|дешев[а-я]+|бюджетн[а-я]+|эконом[а-я]*'))) {
    result.cheaper = true;
  }

  return result;
}

const ONE_CHILD =
  'с\\s+(?:ребенком|дочкой|дочерью|дочуркой|сыном|сынишкой|сыночком|малышом|малышкой|внуком|внучкой|племянником|племянницей)|для\\s+(?:ребенка|дочки|дочери|сына|малыша|внука|внучки)|ребенку|ребенок|ребенка|дочке|сыну|малышу';
const MANY_CHILDREN =
  'с\\s+(двумя|тремя|четырьмя)?\\s*(?:детьми|детишками|внуками)|для\\s+детей|детям|дети|детей|школьник[а-я]+';
const NO_CHILDREN =
  'без\\s+детей|без\\s+ребенка|ребенок\\s+не\\s+(?:идет|пойдет)|дети\\s+не\\s+(?:идут|пойдут)|только\\s+взрослы[а-я]+|взрослой\\s+компанией';
const CHILDREN_BY_WORD: Record<string, number> = { двумя: 2, тремя: 3, четырьмя: 4 };

const GROUP_SIZES: readonly { size: number; pattern: string }[] = [
  {
    size: 2,
    pattern:
      'вдвоем|на\\s+двоих|для\\s+двоих|двое|парой|два\\s+билета|2\\s+билета|мы\\s+с\\s+(?:женой|мужем|девушкой|парнем|подругой|другом|мамой|папой)',
  },
  { size: 3, pattern: 'втроем|на\\s+троих|трое|три\\s+билета|3\\s+билета' },
  { size: 4, pattern: 'вчетвером|на\\s+четверых|четверо|четыре\\s+билета|4\\s+билета' },
  { size: 5, pattern: 'впятером|на\\s+пятерых|пятеро|пять\\s+билетов|5\\s+билетов' },
  { size: 1, pattern: 'я\\s+один|я\\s+одна|пойду\\s+одна?|в\\s+одиночку|для\\s+себя|один\\s+билет|1\\s+билет' },
];

export interface ParsedParty {
  childrenCount?: number;
  childrenMentioned: boolean;
  noChildren: boolean;
  total?: number;
  adults?: number;
}

export function parseParty(scanner: Scanner): ParsedParty {
  const result: ParsedParty = { childrenMentioned: false, noChildren: false };

  if (take(scanner, word(NO_CHILDREN))) {
    result.noChildren = true;
  } else {
    const many = take(scanner, word(MANY_CHILDREN));
    if (many) {
      result.childrenMentioned = true;
      if (many[1]) result.childrenCount = CHILDREN_BY_WORD[many[1]];
    }
    if (take(scanner, word(ONE_CHILD))) {
      result.childrenMentioned = true;
      result.childrenCount = result.childrenCount ?? 1;
    }
  }

  const adults = take(scanner, word(`(\\d|${NUMBER_WORD_PATTERN})\\s+взросл[а-я]+`));
  if (adults) {
    result.adults = /^\d$/.test(adults[1]) ? Number(adults[1]) : NUMBER_WORDS[adults[1]];
  }

  for (const { size, pattern } of GROUP_SIZES) {
    if (take(scanner, word(pattern))) {
      result.total = size;
      break;
    }
  }
  if (result.total === undefined) {
    const tickets = take(scanner, word('(\\d)\\s+билет[а-я]*'));
    if (tickets && Number(tickets[1]) > 0) result.total = Number(tickets[1]);
  }

  return result;
}

export interface ParsedPlace {
  cities: string[];
  excludedCities: string[];
  region: boolean;
  outside?: string;
  notInDemo?: string;
  nearMe: boolean;
  notes: NluAssumption[];
}

const NEGATION_BEFORE_PLACE = /(?:^|[^a-zа-я0-9])(?:кроме|не(?:\s+в)?)\s+$/;

export function parsePlace(scanner: Scanner): ParsedPlace {
  const result: ParsedPlace = { cities: [], excludedCities: [], region: false, nearMe: false, notes: [] };

  for (const { slug, pattern } of CITY_PATTERNS) {
    for (const match of takeAll(scanner, word(pattern))) {
      const cities = NEGATION_BEFORE_PLACE.test(before(scanner, match)) ? result.excludedCities : result.cities;
      if (!cities.includes(slug)) cities.push(slug);
    }
  }

  // Fuzzy 1-typo city lookup for long Bashkortostan city names (e.g. "Стерлитомак")
  if (result.cities.length === 0) {
    for (const match of scanner.rest.matchAll(/(?<![a-zа-я0-9])[a-zа-я]{7,}(?![a-zа-я0-9])/g)) {
      const token = match[0];
      const cities = NEGATION_BEFORE_PLACE.test(before(scanner, match)) ? result.excludedCities : result.cities;
      for (const entry of CITY_FUZZY_BASES) {
        if (entry.bases.some((b) => levenshtein1(token, b) <= 1)) {
          if (!cities.includes(entry.slug)) cities.push(entry.slug);
          result.notes.push({ key: 'city_typo_corrected', text: `распознана опечатка в названии города («${token}»)` });
          break;
        }
      }
      if (result.cities.length > 0) break;
    }
  }

  if (take(scanner, word(REGION_PATTERN))) result.region = true;

  for (const { name, pattern } of OUTSIDE_CITIES) {
    if (take(scanner, word(pattern))) result.outside = result.outside ?? name;
  }
  for (const { name, pattern } of NOT_IN_DEMO_CITIES) {
    if (take(scanner, word(pattern))) result.notInDemo = result.notInDemo ?? name;
  }

  if (take(scanner, word('рядом\\s+со\\s+мной|поблизости|недалеко(?:\\s+от\\s+меня)?|рядом\\s+с\\s+домом|возле\\s+меня'))) {
    result.nearMe = true;
  }
  return result;
}

export interface ParsedCategories {
  any: string[];
  exclude: string[];
  avoid: string[];
  words: string[];
  unset: boolean;
  kids: boolean;
}

const NEGATION_BEFORE_CATEGORY = /(?:^|[^a-zа-я0-9])(?:кроме|только\s+не|но\s+не|не|без)\s+$/;
const DISLIKE_BEFORE_CATEGORY = /(?:^|[^a-zа-я0-9])не\s+(?:очень\s+|особо\s+)?(?:люблю|любим|хочу|хочется)\s+$/;
const CATEGORY_UNSET = 'люб(?:ая|ую)\\s+категори[а-я]+|что\\s+угодно|неважно\\s+что|забудь\\s+про\\s+категори[а-я]+';

function expandCategoryAliases(ids: readonly string[]): string[] {
  const result: string[] = [];
  for (const id of ids) {
    for (const expanded of CATEGORY_ALIASES[id] ?? [id]) {
      if (!result.includes(expanded)) result.push(expanded);
    }
  }
  return result;
}

export function parseCategories(scanner: Scanner): ParsedCategories {
  const result: ParsedCategories = {
    any: [],
    exclude: [],
    avoid: [],
    words: [],
    unset: false,
    kids: false,
  };
  if (take(scanner, word(CATEGORY_UNSET))) {
    result.unset = true;
    return result;
  }

  for (const { id, pattern } of CATEGORY_PATTERNS) {
    for (const match of takeAll(scanner, word(pattern))) {
      if (DISLIKE_BEFORE_CATEGORY.test(before(scanner, match, 24))) {
        if (!result.avoid.includes(id)) result.avoid.push(id);
        continue;
      }
      if (NEGATION_BEFORE_CATEGORY.test(before(scanner, match))) {
        if (!result.exclude.includes(id)) result.exclude.push(id);
        continue;
      }
      if (!result.any.includes(id)) result.any.push(id);
      result.words.push(match[0].trim());
    }
  }

  result.kids = result.any.includes('kids');
  result.any = expandCategoryAliases(result.any.filter((id) => id !== 'kids'));
  result.exclude = expandCategoryAliases(result.exclude.filter((id) => id !== 'kids'));
  result.avoid = expandCategoryAliases(result.avoid.filter((id) => id !== 'kids'));
  return result;
}

export function parseVenueAndTopic(scanner: Scanner): {
  venue_query?: string;
  geo_query?: string;
  topic_query?: string;
} {
  const out: { venue_query?: string; geo_query?: string; title_query?: string; topic_query?: string } = {};

  const venueMatch = take(
    scanner,
    word('(?:гкз\\s+башкортостан|башдрамтеатр[а-я]*|молодежн[а-я]+\\s+театр[а-я]*|театр[а-я]*\\s+кукол|театр[а-я]*\\s+опер[а-я]+|дк\\s+нефтяник|филармони[а-я]+|советск[а-я]+\\s+площад[а-я]+)'),
  );
  if (venueMatch) out.venue_query = venueMatch[0].trim();

  const geoMatch = take(scanner, word('(?:в\\s+)?(черниковк[а-я]+|сипайлово|дем[ае]|центр[ае]?\\s+уфы|проспект[ае]?\\s+октября)'));
  if (geoMatch) out.geo_query = geoMatch[1].trim();

  if (take(scanner, word('(?:по\\s+)?пушкинск[а-я]+\\s+карт[а-я]+'))) {
    out.topic_query = 'Пушкинская карта';
  }

  return out;
}

export interface ParsedPreferences {
  ids: string[];
  phrases: string[];
}

export function parsePreferences(scanner: Scanner): ParsedPreferences {
  const result: ParsedPreferences = { ids: [], phrases: [] };
  for (const { id, pattern } of PREFERENCES) {
    const match = take(scanner, word(pattern));
    if (!match) continue;
    result.ids.push(id);
    result.phrases.push(match[0].trim());
  }
  return result;
}

export interface ParsedStatuses {
  statuses: ConstraintStatus[];
  ageRating?: string;
}

export function parseStatuses(scanner: Scanner): ParsedStatuses {
  const result: ParsedStatuses = { statuses: [] };
  if (take(scanner, word('отменен[а-я]*|отмененн[а-я]+|отмен[ауы]'))) result.statuses.push('cancelled');
  if (take(scanner, word('перенесен[а-я]*|перенесенн[а-я]+|перенос[а-я]*'))) result.statuses.push('postponed');
  if (take(scanner, word('распродан[а-я]*|солд-?аут'))) result.statuses.push('sold_out');

  const rating = take(scanner, /(?<![a-zа-я0-9])(0|6|12|16|18)\s*\+/);
  if (rating) result.ageRating = `${rating[1]}+`;
  return result;
}
