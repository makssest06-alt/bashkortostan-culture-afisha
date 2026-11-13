import { CITIES, CATEGORIES } from '../dictionaries.js';
import { normalizeText } from '../identity.js';
import { addDays, formatRuDay, isValidYmd, localNow, nextWeekday, resolveDatePreset } from '../time.js';
import type { ApiEvent, ApiEventListItem, CategoryId, CityId, DatePreset } from '../types.js';
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

export interface Constraints {
  hard: {
    cities?: string[];
    region?: string;
    date?: { from: string; to: string; label?: string };
    time?: { from?: string; to?: string };
    participants?: {
      adults?: number;
      children_count?: number;
      children_ages?: number[];
      total?: number;
    };
    max_total_price?: number;
    max_price_per_person?: number;
    currency?: 'RUB';
    free_only?: boolean;
    categories_any?: string[];
    required_age_rating?: string;
    language?: string;
    topic_query?: string;
    venue_id?: string;
  };
  soft: {
    preferences?: string[];
    semantic_query?: string;
  };
}

export interface ConstraintsPatch {
  reset?: boolean;
  set?: Partial<Constraints>;
  unset?: string[];
}

export interface AssistantRequest {
  message?: string;
  previous?: Constraints;
  patch?: ConstraintsPatch;
  answering?: ClarifyCode;
  limit?: number;
  confirmation_token?: string;
  user_ref?: string;
  channel?: 'telegram' | 'web';
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
  unsupported_actions?: ('purchase' | 'booking')[];
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

export const MAX_MESSAGE_LENGTH = 500;
export const DEFAULT_RESULT_LIMIT = 6;
export const MAX_RESULT_LIMIT = 12;

const B1 = '(?<![А-ЯЁа-яёA-Za-z0-9])';
const B2 = '(?![А-ЯЁа-яёA-Za-z0-9])';

const CITY_MATCHERS: { slug: CityId; pattern: RegExp }[] = [
  { slug: 'ufa', pattern: new RegExp(`${B1}(?:уфа|уфе|уфу|уфой|уфимск[а-я]*)${B2}`, 'iu') },
  { slug: 'sterlitamak', pattern: new RegExp(`${B1}стерлитамак[аеу]?${B2}`, 'iu') },
  { slug: 'salavat', pattern: new RegExp(`${B1}салават[аеу]?${B2}`, 'iu') },
  { slug: 'neftekamsk', pattern: new RegExp(`${B1}нефтекамск[аеу]?${B2}`, 'iu') },
  { slug: 'oktyabrsky', pattern: new RegExp(`${B1}октябрьск[иоа][ймг][а-я]*${B2}`, 'iu') },
  { slug: 'beloretsk', pattern: new RegExp(`${B1}белорецк[аеу]?${B2}`, 'iu') },
  { slug: 'sibay', pattern: new RegExp(`${B1}сиба[йеюя]${B2}`, 'iu') },
  { slug: 'kumertau', pattern: new RegExp(`${B1}кумертау${B2}`, 'iu') },
];

const OUTSIDE_CITY_NAMES: { name: string; pattern: RegExp }[] = [
  { name: 'Москва', pattern: new RegExp(`${B1}москв[аеу]${B2}`, 'iu') },
  { name: 'Казань', pattern: new RegExp(`${B1}казан[ьи]${B2}`, 'iu') },
  { name: 'Санкт-Петербург', pattern: new RegExp(`${B1}(?:питер[ае]?|петербург[ае]?)${B2}`, 'iu') },
  { name: 'Екатеринбург', pattern: new RegExp(`${B1}екатеринбург[ае]?${B2}`, 'iu') },
  { name: 'Челябинск', pattern: new RegExp(`${B1}челябинск[ае]?${B2}`, 'iu') },
  { name: 'Сочи', pattern: new RegExp(`${B1}сочи${B2}`, 'iu') },
];

const CATEGORY_MATCHERS: { id: CategoryId; pattern: RegExp }[] = [
  { id: 'concert', pattern: new RegExp(`${B1}(?:концерт[а-я]*|музык[а-я]*|филармони[а-я]*|джаз[а-я]*|оркестр[а-я]*|песн[яи])${B2}`, 'iu') },
  { id: 'performance', pattern: new RegExp(`${B1}(?:спектакл[ьяей]*|театр[а-я]*|драм[аеу]|комеди[яию]|кукольный|опер[аеу]|балет[ае]?|пьес[аеу])${B2}`, 'iu') },
  { id: 'exhibition', pattern: new RegExp(`${B1}(?:выставк[а-я]*|музе[йяею]|галере[яию]|экспозиц[а-я]*|картин[а-я]*)${B2}`, 'iu') },
  { id: 'festival', pattern: new RegExp(`${B1}(?:фестивал[ьяей]*|праздник[а-я]*|сабанту[йяе]|ярмарк[аиу]|форум[а-я]*)${B2}`, 'iu') },
  { id: 'cinema', pattern: new RegExp(`${B1}(?:кино[а-я]*|фильм[а-я]*|кинопоказ[а-я]*|мультфильм[а-я]*)${B2}`, 'iu') },
  { id: 'excursion', pattern: new RegExp(`${B1}(?:экскурси[яиюй]*|квест[а-я]*|пешеходн[а-я]* прогулк[а-я]*|краевед[а-я]*)${B2}`, 'iu') },
  { id: 'other', pattern: new RegExp(`${B1}(?:мастер-?класс[а-я]*|лекци[яию]|воркшоп[а-я]*|творческ[а-я]* встреч[аиу])${B2}`, 'iu') },
];

const TOPIC_WORDS = ['джаз', 'рок', 'фольклор', 'курай', 'классик', 'этно', 'кукл', 'живопись', 'истори'];

export function maskPii(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '[phone]');
}

export function sanitizeConstraints(input: unknown): Constraints {
  const obj = input && typeof input === 'object' ? (input as Partial<Constraints>) : {};
  return {
    hard: obj.hard && typeof obj.hard === 'object' ? structuredClone(obj.hard) : {},
    soft: obj.soft && typeof obj.soft === 'object' ? structuredClone(obj.soft) : {},
  };
}

export function applyPatch(state: Constraints, patch: ConstraintsPatch): Constraints {
  let next = patch.reset ? { hard: {}, soft: {} } : sanitizeConstraints(state);
  if (patch.unset) {
    for (const path of patch.unset) {
      if (path === 'hard.cities') delete next.hard.cities;
      else if (path === 'hard.region') delete next.hard.region;
      else if (path === 'hard.date') delete next.hard.date;
      else if (path === 'hard.time') delete next.hard.time;
      else if (path === 'hard.participants') delete next.hard.participants;
      else if (path === 'hard.max_total_price') delete next.hard.max_total_price;
      else if (path === 'hard.max_price_per_person') delete next.hard.max_price_per_person;
      else if (path === 'hard.free_only') delete next.hard.free_only;
      else if (path === 'hard.categories_any') delete next.hard.categories_any;
      else if (path === 'hard.required_age_rating') delete next.hard.required_age_rating;
      else if (path === 'hard.language') delete next.hard.language;
      else if (path === 'hard.topic_query') delete next.hard.topic_query;
      else if (path === 'hard.venue_id') delete next.hard.venue_id;
      else if (path === 'soft.preferences') delete next.soft.preferences;
      else if (path === 'soft.semantic_query') delete next.soft.semantic_query;
    }
  }
  if (patch.set?.hard) next.hard = { ...next.hard, ...patch.set.hard };
  if (patch.set?.soft) next.soft = { ...next.soft, ...patch.set.soft };
  return next;
}

export function buildChips(constraints: Constraints): AssistantChip[] {
  const { hard, soft } = constraints;
  const chips: AssistantChip[] = [];

  if (hard.cities?.length) {
    const names = hard.cities.map((slug) => CITIES.find((c) => c.slug === slug)?.name.ru ?? slug).join(', ');
    chips.push({ key: 'hard.cities', kind: 'city', label: 'Город', value: names, removable: true, unset: ['hard.cities'] });
  } else if (hard.region) {
    chips.push({ key: 'hard.region', kind: 'city', label: 'Город', value: 'Вся республика', removable: true, unset: ['hard.region'] });
  }

  if (hard.date) {
    const value =
      hard.date.label ??
      (hard.date.from === hard.date.to
        ? formatRuDay(hard.date.from)
        : `${formatRuDay(hard.date.from)} — ${formatRuDay(hard.date.to)}`);
    chips.push({ key: 'hard.date', kind: 'date', label: 'Дата', value, removable: true, unset: ['hard.date'] });
  }

  if (hard.time && (hard.time.from || hard.time.to)) {
    const val =
      hard.time.from && hard.time.to
        ? `${hard.time.from}–${hard.time.to}`
        : hard.time.from
          ? `с ${hard.time.from}`
          : `до ${hard.time.to}`;
    chips.push({ key: 'hard.time', kind: 'time', label: 'Время', value: val, removable: true, unset: ['hard.time'] });
  }

  if (hard.free_only) {
    chips.push({ key: 'hard.free_only', kind: 'budget', label: 'Цена', value: 'Бесплатно', removable: true, unset: ['hard.free_only'] });
  } else if (hard.max_price_per_person !== undefined) {
    chips.push({
      key: 'hard.max_price_per_person',
      kind: 'budget',
      label: 'Бюджет',
      value: `до ${hard.max_price_per_person} ₽/чел.`,
      removable: true,
      unset: ['hard.max_price_per_person'],
    });
  } else if (hard.max_total_price !== undefined) {
    chips.push({
      key: 'hard.max_total_price',
      kind: 'budget',
      label: 'Бюджет',
      value: `до ${hard.max_total_price} ₽`,
      removable: true,
      unset: ['hard.max_total_price'],
    });
  }

  if (hard.participants) {
    const p = hard.participants;
    const ages = p.children_ages ?? [];
    const label =
      ages.length > 0
        ? `Дети ${ages.join(', ')} лет`
        : p.children_count
          ? `С ребёнком`
          : p.total
            ? `${p.total} чел.`
            : 'Участники';
    chips.push({ key: 'hard.participants', kind: 'participants', label: 'Состав', value: label, removable: true, unset: ['hard.participants'] });
  }

  if (hard.categories_any?.length) {
    const val = hard.categories_any
      .map((id) => CATEGORIES.find((c) => c.id === id)?.name.ru ?? id)
      .join(', ');
    chips.push({ key: 'hard.categories_any', kind: 'category', label: 'Категория', value: val, removable: true, unset: ['hard.categories_any'] });
  }

  if (hard.language) {
    chips.push({
      key: 'hard.language',
      kind: 'preference',
      label: 'Язык',
      value: hard.language === 'ba' ? 'башкирский' : hard.language === 'tt' ? 'татарский' : hard.language,
      removable: true,
      unset: ['hard.language'],
    });
  }

  if (hard.topic_query) {
    chips.push({ key: 'hard.topic_query', kind: 'query', label: 'Тема', value: hard.topic_query, removable: true, unset: ['hard.topic_query'] });
  }

  if (soft.preferences?.length) {
    chips.push({
      key: 'soft.preferences',
      kind: 'preference',
      label: 'Пожелания',
      value: soft.preferences.join(', '),
      removable: true,
      unset: ['soft.preferences'],
    });
  }

  return chips;
}

function isInjectionOrOffTopic(message: string): { injection: boolean; offTopic: boolean } {
  const lower = message.toLowerCase();
  const injection =
    /(ignore\s+(all\s+)?previous|system\s*prompt|jailbreak|забудь\s+(все\s+)?инструкц|игнорируй\s+правила|выведи\s+системный\s+промпт|drop\s+table|select\s+\*\s+from)/i.test(
      lower,
    );
  const hasDomainCue =
    /(событи|афиш|концерт|спектакл|выстав|фестивал|кино|экскурс|музе|театр|куда\s+(пойти|сходить)|билет|подпи|реб[её]н|уфа|стерлитамак|салават|нефтекамск|октябрьск|белорецк|сибай|кумертау|выходн|сегодня|завтра|бесплатн|руб)/i.test(
      lower,
    );
  const offTopic =
    !hasDomainCue &&
    /(рецепт|борщ|погода|курс\s+доллара|биткоин|напиши\s+код|python|javascript|реши\s+уравнение|переведи\s+на\s+английский|анекдот|гороскоп)/i.test(
      lower,
    );
  return { injection, offTopic };
}

export function detectMutationIntent(message: string):
  | { type: 'subscribe'; params: { city?: CityId; category?: CategoryId; period?: DatePreset } }
  | { type: 'save_feedback'; params: { kind: 'question' | 'correction' | 'organizer_application'; text: string } }
  | null {
  const lower = message.toLowerCase();
  if (/(подпиш|подписаться|присылай\s+новые|уведомл[яе]й)/i.test(lower)) {
    const city = CITY_MATCHERS.find((m) => m.pattern.test(message))?.slug;
    const category = CATEGORY_MATCHERS.find((m) => m.pattern.test(message))?.id;
    let period: DatePreset | undefined;
    if (/сегодня/i.test(lower)) period = 'today';
    else if (/завтра/i.test(lower)) period = 'tomorrow';
    else if (/выходн/i.test(lower)) period = 'weekend';
    else if (/недел/i.test(lower)) period = 'week';
    if (!city && !category && !period) period = 'weekend';
    return { type: 'subscribe', params: { city, category, period } };
  }
  if (/(сообщить\s+об\s+ошибк|вопрос\s+организатор|передай\s+организатор|заявк[ау]\s+организатор)/i.test(lower)) {
    const kind = /ошибк/i.test(lower)
      ? 'correction'
      : /заявк/i.test(lower)
        ? 'organizer_application'
        : 'question';
    return { type: 'save_feedback', params: { kind, text: message.trim() } };
  }
  return null;
}

export function parseIntoConstraints(
  message: string,
  prev: Constraints,
  options: { today: string; answering?: ClarifyCode },
): {
  next: Constraints;
  pastDate: boolean;
  nearMe: boolean;
  outsideCity: string | null;
  unsupported: ('purchase' | 'booking')[];
  understood: boolean;
  greeting: boolean;
} {
  const next = sanitizeConstraints(prev);
  const lower = normalizeText(message);
  let understood = false;
  let pastDate = false;
  let nearMe = false;
  let outsideCity: string | null = null;
  const unsupported: ('purchase' | 'booking')[] = [];

  const greeting = /^(привет|здравствуй|здравствуйте|добрый\s+(день|вечер|утро))[\s!,.]*$/iu.test(message.trim()) ||
    /^(привет|здравствуй|здравствуйте)/iu.test(lower);

  if (/(куп(?:ить|и)\s+билет|оплат|заказ[а-я]*\s+билет)/iu.test(lower)) unsupported.push('purchase');
  if (/(забронир|бронь)/iu.test(lower)) unsupported.push('booking');

  for (const out of OUTSIDE_CITY_NAMES) {
    if (out.pattern.test(message)) outsideCity = out.name;
  }

  // Cities & region
  const foundCities: string[] = [];
  for (const cm of CITY_MATCHERS) {
    if (cm.pattern.test(message)) foundCities.push(cm.slug);
  }
  if (foundCities.length > 0) {
    next.hard.cities = foundCities;
    delete next.hard.region;
    understood = true;
  } else if (/(вся\s+республика|по\s+республике|весь\s+башкортостан|по\s+башкирии|любой\s+город)/iu.test(lower)) {
    next.hard.region = 'bashkortostan';
    delete next.hard.cities;
    understood = true;
  } else if (/(рядом\s+со\s+мной|поблизости|недалеко\s+от\s+меня)/iu.test(lower)) {
    nearMe = true;
    understood = true;
  }

  // Dates
  if (/сегодня/iu.test(lower)) {
    const r = resolveDatePreset('today', options.today);
    next.hard.date = { ...r, label: 'Сегодня' };
    understood = true;
  } else if (/послезавтра/iu.test(lower)) {
    const d = addDays(options.today, 2);
    next.hard.date = { from: d, to: d, label: formatRuDay(d) };
    understood = true;
  } else if (/завтра/iu.test(lower)) {
    const r = resolveDatePreset('tomorrow', options.today);
    next.hard.date = { ...r, label: 'Завтра' };
    understood = true;
  } else if (/на\s+выходных|выходные/iu.test(lower)) {
    const r = resolveDatePreset('weekend', options.today);
    next.hard.date = { ...r, label: 'На выходных' };
    understood = true;
  } else if (/на\s+этой\s+неделе|на\s+неделе|ближайшие\s+7\s+дней/iu.test(lower)) {
    const r = resolveDatePreset('week', options.today);
    next.hard.date = { ...r, label: 'На неделе' };
    understood = true;
  } else if (/в\s+субботу/iu.test(lower)) {
    const sat = nextWeekday(options.today, 6);
    next.hard.date = { from: sat, to: sat, label: formatRuDay(sat) };
    understood = true;
  } else if (/в\s+воскресенье/iu.test(lower)) {
    const sun = nextWeekday(options.today, 0);
    next.hard.date = { from: sun, to: sun, label: formatRuDay(sun) };
    understood = true;
  } else if (/в\s+пятницу/iu.test(lower)) {
    const fri = nextWeekday(options.today, 5);
    next.hard.date = { from: fri, to: fri, label: formatRuDay(fri) };
    understood = true;
  } else if (/вчера|позавчера/iu.test(lower)) {
    pastDate = true;
    understood = true;
  } else {
    const isoDate = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(message);
    if (isoDate && isValidYmd(isoDate[1])) {
      if (isoDate[1] < options.today) pastDate = true;
      else next.hard.date = { from: isoDate[1], to: isoDate[1] };
      understood = true;
    }
  }

  // Time
  const afterMatch = /после\s+(\d{1,2})(?::(\d{2}))?/iu.exec(lower);
  const beforeMatch = /до\s+(\d{1,2})(?::(\d{2}))?\s*(?:час|вечер|утр|$)/iu.exec(lower);
  if (afterMatch) {
    const hh = String(Math.min(23, Number(afterMatch[1]))).padStart(2, '0');
    const mm = afterMatch[2] ?? '00';
    next.hard.time = { ...(next.hard.time ?? {}), from: `${hh}:${mm}` };
    understood = true;
  } else if (/вечером|вечерн/iu.test(lower)) {
    next.hard.time = { from: '17:00', to: '23:59' };
    understood = true;
  } else if (/днем|днём/iu.test(lower)) {
    next.hard.time = { from: '12:00', to: '18:00' };
    understood = true;
  } else if (/утром/iu.test(lower)) {
    next.hard.time = { from: '06:00', to: '12:00' };
    understood = true;
  }
  if (beforeMatch && !/руб|₽/i.test(lower.slice(beforeMatch.index, beforeMatch.index + 20))) {
    const hh = String(Math.min(23, Number(beforeMatch[1]))).padStart(2, '0');
    const mm = beforeMatch[2] ?? '00';
    next.hard.time = { ...(next.hard.time ?? {}), to: `${hh}:${mm}` };
    understood = true;
  }

  // Budget
  if (/бесплатн|вход\s+свободный|даром/iu.test(lower)) {
    next.hard.free_only = true;
    delete next.hard.max_price_per_person;
    delete next.hard.max_total_price;
    understood = true;
  } else {
    const priceMatch = /(?:до|не\s+дороже|бюджет)\s+(\d{2,6})\s*(?:руб|р\b|₽)/iu.exec(lower);
    if (priceMatch) {
      const amount = Number(priceMatch[1]);
      next.hard.max_price_per_person = amount;
      delete next.hard.free_only;
      understood = true;
    }
  }

  // Participants & child age
  if (/без\s+детей/iu.test(lower)) {
    if (next.hard.participants) {
      delete next.hard.participants.children_count;
      delete next.hard.participants.children_ages;
      if (Object.keys(next.hard.participants).length === 0) delete next.hard.participants;
    }
    understood = true;
  } else {
    const ageNums: number[] = [];
    const ageRegex = /(\d{1,2})\s*(?:год(?:а|ик)?|лет)/giu;
    let m: RegExpExecArray | null;
    while ((m = ageRegex.exec(lower)) !== null) {
      const age = Number(m[1]);
      if (age >= 0 && age <= 17) ageNums.push(age);
    }
    if (options.answering === 'child_age' && ageNums.length === 0 && /^\d{1,2}$/.test(lower)) {
      const n = Number(lower);
      if (n <= 17) ageNums.push(n);
    }
    if (ageNums.length > 0) {
      next.hard.participants = {
        ...(next.hard.participants ?? {}),
        children_count: ageNums.length,
        children_ages: ageNums,
      };
      understood = true;
    } else if (/(с\s+ребенк|с\s+детьм|семьей|для\s+детей|детск)/iu.test(lower)) {
      next.hard.participants = {
        ...(next.hard.participants ?? {}),
        children_count: next.hard.participants?.children_count ?? 1,
      };
      understood = true;
    }
  }

  // Categories
  const cats: string[] = [];
  for (const cm of CATEGORY_MATCHERS) {
    if (cm.pattern.test(message)) cats.push(cm.id);
  }
  if (cats.length > 0) {
    next.hard.categories_any = cats;
    understood = true;
  }

  // Language
  if (/на\s+башкирск|башкирском\s+языке/iu.test(lower)) {
    next.hard.language = 'ba';
    understood = true;
  } else if (/на\s+татарск/iu.test(lower)) {
    next.hard.language = 'tt';
    understood = true;
  }

  // Topic keywords
  const matchedTopic = TOPIC_WORDS.find((w) => lower.includes(w));
  if (matchedTopic && cats.length === 0) {
    next.hard.topic_query = matchedTopic;
    understood = true;
  }

  if (/(куда\s+сходить|что\s+посмотреть|афиша|подбери|покажи|события)/iu.test(lower)) {
    understood = true;
  }

  return { next, pastDate, nearMe, outsideCity, unsupported, understood, greeting };
}

function toSearchToolArgs(c: Constraints, limit: number): Record<string, unknown> {
  const args: Record<string, unknown> = { page_size: Math.min(limit, 10) };
  if (c.hard.cities?.length) args.city = c.hard.cities;
  if (c.hard.categories_any?.length) args.category = c.hard.categories_any;
  if (c.hard.date) {
    args.date_from = c.hard.date.from;
    args.date_to = c.hard.date.to;
  }
  if (c.hard.time?.from) args.time_from = c.hard.time.from;
  if (c.hard.time?.to) args.time_to = c.hard.time.to;
  if (c.hard.free_only) args.free = true;
  else if (c.hard.max_price_per_person !== undefined) args.price_max = c.hard.max_price_per_person;
  else if (c.hard.max_total_price !== undefined) args.price_max = c.hard.max_total_price;

  const ages = c.hard.participants?.children_ages ?? [];
  if (ages.length > 0) args.age = Math.min(...ages);
  if (c.hard.language) args.language = c.hard.language;
  if (c.hard.topic_query) args.q = c.hard.topic_query;
  return args;
}

function buildReasonsForEvent(ev: ApiEventListItem, c: Constraints): string[] {
  const reasons: string[] = [];
  if (c.hard.cities?.includes(ev.city_id)) {
    reasons.push(`Проходит в городе ${ev.city}`);
  }
  if (c.hard.categories_any?.includes(ev.category)) {
    const catName = CATEGORIES.find((x) => x.id === ev.category)?.name_one.ru ?? ev.category;
    reasons.push(`Категория: ${catName.toLowerCase()}`);
  }
  if (ev.is_free) {
    reasons.push('Вход свободный');
  } else if (ev.price_min !== null) {
    reasons.push(`Билеты от ${ev.price_min} ₽`);
  }
  if (ev.age_limit !== null) {
    reasons.push(`Возрастное ограничение: ${ev.age_limit}+`);
  }
  return reasons.slice(0, 4);
}

function buildCaveatsForEvent(ev: ApiEventListItem): string[] {
  const caveats: string[] = [];
  if (ev.status === 'cancelled') caveats.push('Событие отменено');
  const occ = ev.occurrences.find((o) => o.id === ev.primary_occurrence_id);
  if (occ?.availability === 'sold_out') caveats.push('Билеты на ближайший сеанс закончились');
  if (ev.price_min === null && !ev.is_free) caveats.push('Цена уточняется на странице организатора');
  if (ev.age_limit === null) caveats.push('Возрастное ограничение источником не указано');
  return caveats;
}

export async function runDeterministicAssistant(
  request: AssistantRequest,
  runtime: ToolRuntime,
  now: Date = new Date(),
  engine = 'rules-v1',
): Promise<AssistantResponsePayload> {
  const { date: today } = localNow(now);
  const limit = Math.min(Math.max(1, request.limit ?? DEFAULT_RESULT_LIMIT), MAX_RESULT_LIMIT);

  let state = request.previous ? sanitizeConstraints(request.previous) : { hard: {}, soft: {} };
  if (request.patch) state = applyPatch(state, request.patch);

  const message = (request.message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);

  if (message) {
    const { injection, offTopic } = isInjectionOrOffTopic(message);
    if (injection || offTopic) {
      return {
        action: 'out_of_scope',
        message: injection
          ? 'Этого я не делаю. Я помогаю только подбирать события культуры Башкортостана.'
          : 'Я помогаю только с афишей: подбираю события по городу, дате, цене и возрасту.',
        constraints: state,
        chips: buildChips(state),
        assumptions: [],
        reference_date: today,
        timezone: 'Asia/Yekaterinburg',
        engine,
      };
    }

    const mutation = detectMutationIntent(message);
    if (mutation) {
      const toolRes = await runtime.execute(mutation.type, mutation.params);
      if (toolRes.ok) {
        const data = toolRes.data as {
          status: string;
          confirmation_id?: string;
          summary?: string;
          expires_at?: string;
        };
        if (data.status === 'confirmation_required') {
          return {
            action: 'confirmation_required',
            message: `Подтвердите действие: ${data.summary}`,
            constraints: state,
            chips: buildChips(state),
            assumptions: [],
            confirmation: {
              confirmation_id: data.confirmation_id!,
              summary: data.summary!,
              expires_at: data.expires_at!,
            },
            reference_date: today,
            timezone: 'Asia/Yekaterinburg',
            engine,
          };
        }
      }
    }
  }

  let pastDate = false;
  let nearMe = false;
  let outsideCity: string | null = null;
  let unsupported: ('purchase' | 'booking')[] = [];

  if (message) {
    const parsed = parseIntoConstraints(message, state, { today, answering: request.answering });
    state = parsed.next;
    pastDate = parsed.pastDate;
    nearMe = parsed.nearMe;
    outsideCity = parsed.outsideCity;
    unsupported = parsed.unsupported;

    if (!parsed.understood && !parsed.greeting && unsupported.length === 0 && Object.keys(state.hard).length === 0) {
      return {
        action: 'out_of_scope',
        message: 'Я помогаю с афишей Башкортостана. Напишите город, дату или интересное вам событие.',
        constraints: state,
        chips: buildChips(state),
        assumptions: [],
        reference_date: today,
        timezone: 'Asia/Yekaterinburg',
        engine,
      };
    }
  }

  const pending: ClarifyCode[] = [];
  if (pastDate) pending.push('date');
  const hasPlace = Boolean(state.hard.cities?.length || state.hard.region);
  if (!hasPlace) pending.push(nearMe ? 'location' : 'city');
  const p = state.hard.participants;
  if (p?.children_count && (!p.children_ages || p.children_ages.length === 0)) {
    pending.push('child_age');
  }

  if (pending.length > 0) {
    const first = pending[0];
    const clarify: AssistantClarify =
      first === 'date'
        ? {
            code: 'date',
            pending,
            question: 'Эта дата уже прошла. На какой день подобрать события?',
            quick_replies: ['Сегодня', 'Завтра', 'На выходных'],
          }
        : first === 'child_age'
          ? {
              code: 'child_age',
              pending,
              question: 'Сколько лет ребёнку? От возраста зависят возрастные ограничения.',
              quick_replies: ['3 года', '5 лет', '7 лет', '10 лет', 'Иду без детей'],
            }
          : {
              code: first,
              pending,
              question:
                first === 'location'
                  ? 'Я не знаю, где вы находитесь. В каком городе ищем?'
                  : 'В каком городе ищем?',
              quick_replies: [...CITIES.map((c) => c.name.ru), 'Вся республика'],
            };

    const note = outsideCity ? `Город ${outsideCity} за пределами афиши Башкортостана. ` : '';
    return {
      action: 'clarify',
      message: `${note}${clarify.question}`,
      constraints: state,
      chips: buildChips(state),
      assumptions: [],
      clarify,
      ...(unsupported.length ? { unsupported_actions: unsupported } : {}),
      reference_date: today,
      timezone: 'Asia/Yekaterinburg',
      engine,
    };
  }

  const searchArgs = toSearchToolArgs(state, limit);
  const toolRes = await runtime.execute('search_events', searchArgs);
  if (!toolRes.ok) {
    return {
      action: 'search',
      message: toolRes.error.message,
      constraints: state,
      chips: buildChips(state),
      assumptions: [],
      results: [],
      total: 0,
      reference_date: today,
      timezone: 'Asia/Yekaterinburg',
      engine,
    };
  }

  const data = toolRes.data as {
    items: ApiEventListItem[];
    total: number;
    relaxations: unknown[];
    hidden_unknown_price: number;
    hidden_unknown_age: number;
  };

  const results: AssistantResultItem[] = data.items.slice(0, limit).map((item) => ({
    event: item,
    occurrence_id: item.primary_occurrence_id,
    reasons: buildReasonsForEvent(item, state),
    caveats: buildCaveatsForEvent(item),
  }));

  const parts: string[] = [];
  if (unsupported.includes('purchase')) {
    parts.push('Купить билеты я не могу: ссылка на оплату есть в карточке события.');
  }
  if (unsupported.includes('booking')) {
    parts.push('Забронировать места я не могу: обратитесь по ссылке организатора в карточке.');
  }
  if (data.total === 0) {
    parts.push(
      data.relaxations.length > 0
        ? 'По этим условиям событий нет. Ниже варианты, какое условие можно ослабить.'
        : 'По этим условиям событий нет. Попробуйте изменить город или дату.',
    );
  } else {
    parts.push(
      data.total > results.length
        ? `Нашлось ${data.total} событий. Показываю ${results.length} самых подходящих.`
        : `Нашлось ${data.total} событий по вашим условиям.`,
    );
  }
  if (data.hidden_unknown_price > 0) {
    parts.push(`Ещё ${data.hidden_unknown_price} не показываю: цена у них не указана.`);
  }
  if (data.hidden_unknown_age > 0) {
    parts.push(`Ещё ${data.hidden_unknown_age} не показываю: возрастное ограничение не указано.`);
  }

  const eventsQuery: Record<string, unknown> = {};
  if (state.hard.cities?.length) eventsQuery.city = state.hard.cities;
  if (state.hard.categories_any?.length) eventsQuery.category = state.hard.categories_any;
  if (state.hard.date) {
    eventsQuery.date_from = state.hard.date.from;
    eventsQuery.date_to = state.hard.date.to;
  }
  if (state.hard.free_only) eventsQuery.free_only = true;
  else if (state.hard.max_price_per_person !== undefined) eventsQuery.price_max = state.hard.max_price_per_person;

  return {
    action: 'search',
    message: parts.join(' '),
    constraints: state,
    chips: buildChips(state),
    assumptions: [],
    results,
    total: data.total,
    hidden_unknown_price: data.hidden_unknown_price,
    hidden_unknown_age: data.hidden_unknown_age,
    ...(data.total === 0 ? { relaxations: data.relaxations } : {}),
    ...(unsupported.length ? { unsupported_actions: unsupported } : {}),
    ...(Object.keys(eventsQuery).length ? { events_query: eventsQuery } : {}),
    reference_date: today,
    timezone: 'Asia/Yekaterinburg',
    engine,
  };
}
