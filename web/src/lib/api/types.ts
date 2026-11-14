/**
 * Публичные типы REST API афиши (/api/v1).
 *
 * Сейчас API отдаёт демонстрационные данные, но форма ответов та же,
 * что у будущего боевого API. Имена полей согласованы с контрактами команды:
 *   - contracts/event_identity.schema.json (Event, Occurrence, Offer, Venue);
 *   - evals/search/constraints.schema.json (условия hard/soft, patch, коды уточнений).
 *
 * В файле только типы: его безопасно импортировать откуда угодно.
 */

import type { Lang, LocalizedText } from '../i18n/lang';

export type { Lang, LocalizedText };

// ---------------------------------------------------------------------------
// Справочные идентификаторы
// ---------------------------------------------------------------------------

/** Семь категорий п. 8.1 ТЗ: концерт, спектакль, выставка, фестиваль, кино, экскурсия, другое. */
export type CategoryId = 'concert' | 'performance' | 'exhibition' | 'festival' | 'cinema' | 'excursion' | 'other';

/** Статус события п. 8.1: опубликовано, черновик, отменено. */
export type EventStatus = 'published' | 'draft' | 'cancelled';

/** Откуда взято событие (п. 8.1 source_type). */
export type SourceType = 'manual' | 'import' | 'rss' | 'api' | 'page';

/** Возрастное ограничение п. 8.1: только эти значения. */
export type AgeLimit = 0 | 6 | 12 | 16 | 18;

export type CityId =
  | 'ufa'
  | 'sterlitamak'
  | 'salavat'
  | 'neftekamsk'
  | 'oktyabrsky'
  | 'beloretsk'
  | 'sibay'
  | 'kumertau';

export type AgeRating = '0+' | '6+' | '12+' | '16+' | '18+';

/** Статус сеанса. `postponed`: новой даты нет. `rescheduled`: новая дата известна. */
export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'unknown';

export type Availability = 'available' | 'sold_out' | 'unknown';

/** `minute`: известны дата и время. `date`: известна только дата (выставка с периодом). */
export type TimePrecision = 'minute' | 'date';

export type PriceKind = 'free' | 'from' | 'unknown';

export type OfferAudience = 'adult' | 'child' | 'reduced';

export type EventKind = 'standalone' | 'performance_run' | 'exhibition' | 'festival';

export type Timezone = 'Asia/Yekaterinburg';

/** Что показывать на плашке сеанса: статус и наличие билетов сведены в одно значение. */
export type DisplayStatus =
  | 'scheduled'
  | 'cancelled'
  | 'postponed'
  | 'rescheduled'
  | 'sold_out'
  | 'unverified';

export type Tone = 'positive' | 'warning' | 'negative' | 'neutral';

// ---------------------------------------------------------------------------
// Событие
// ---------------------------------------------------------------------------

export interface TimeValue {
  /**
   * Локальное время площадки.
   * precision = minute: `2026-11-14T12:00:00+05:00`.
   * precision = date:   `2026-11-14` (время неизвестно, полночь не подставляется).
   */
  local: string;
  /** Момент в UTC. Для precision = date всегда null: его нельзя вычислить без догадок. */
  utc: string | null;
  timezone: Timezone;
  precision: TimePrecision;
}

export interface Occurrence {
  id: string;
  event_id: string;
  venue_id: string;
  start: TimeValue;
  /** Конец сеанса или последний день выставки. Отсутствует, если источник его не сообщил. */
  end?: TimeValue;
  status: OccurrenceStatus;
  /** false означает: статус взят без подтверждения источником. Для `unknown` всегда false. */
  status_is_verified: boolean;
  /** Прежнее начало перенесённого сеанса (status = rescheduled). */
  previous_start?: TimeValue;
  availability: Availability;
  /**
   * На сеанс уже не попасть: спектакль или концерт начался, выставка закрылась,
   * фестиваль закончился. В списки такие сеансы не попадают.
   */
  is_past: boolean;
}

export interface Venue {
  id: string;
  name: string;
  city: CityId;
  city_name: LocalizedText;
  /** Улица и дом. null, если адрес не подтверждён: тогда показываем только город. */
  address: string | null;
  lat?: number;
  lon?: number;
  /** Ссылка на поиск площадки на карте по названию и городу. Работает и без координат. */
  map_url: string;
}

export interface Offer {
  id: string;
  /** Название тарифа, если оно есть: «Партер», «Балкон». */
  name?: string;
  /** Цена в копейках. null: цена этого предложения неизвестна. */
  amount_minor: number | null;
  currency: 'RUB';
  /** Для кого предложение. Не указано: общий билет. */
  audience?: OfferAudience;
  /** Бесплатно только по явному утверждению источника. Неизвестная цена бесплатной не считается. */
  is_free: boolean;
}

export interface PriceSummary {
  /** `free`: бесплатно. `from`: есть цена «от». `unknown`: цена не указана. */
  kind: PriceKind;
  /** Минимальная цена общего билета в копейках. Только для kind = from. */
  amount_minor?: number;
}

export interface SourceInfo {
  name: string;
  /** Ссылка на первоисточник. */
  url: string;
  /** Когда запись последний раз сверяли с источником, ISO 8601 в UTC. */
  checked_at: string;
  /** Из скольких источников сведена карточка (дедупликация). */
  sources_count: number;
}

/** Один источник карточки после дедупликации (п. 6.3: «в карточке виден список источников»). */
export interface EventSource {
  source_url: string;
  source_type: SourceType;
  source_hash: string;
  verified_at: string | null;
  /** Подпись источника для человека. */
  title?: string;
}

/** Пометка спорной карточки (п. 6.1: «спорные помечены»). */
export interface EventReview {
  disputed: boolean;
  reasons: string[];
  /** Карточка признана дублем и сведена в другую (решение модератора merge). */
  merged_into?: string;
}

/**
 * Событие внутри сайта. Поля п. 8.1 ТЗ лежат на верхнем уровне с теми же именами;
 * рядом остаются поля, на которых построен интерфейс (venue, offers, occurrences).
 * По сети событие ходит в форме контракта: см. ApiEvent в ./wire.
 */
export interface AfishaEvent {
  /** UUID (п. 8.1). */
  id: string;
  title: string;
  /** Название для дедупликации и поиска: нижний регистр, ё→е, без кавычек. */
  normalized_title: string;
  /** Название на башкирском, если оно есть в источнике. */
  title_ba?: string;
  description: string;
  category: CategoryId;
  /** Метки п. 8.1: «джаз», «дети», «бесплатно», «башкирский язык». */
  tags: string[];
  /** Язык мероприятия, если указан: ru, ba. */
  language: string | null;
  status: EventStatus;
  kind: EventKind;
  /** Возрастное ограничение числом п. 8.1. null: неизвестно, это не 0. */
  age_limit: AgeLimit | null;
  /** То же ограничение меткой для интерфейса: «6+». */
  age_rating: AgeRating | null;
  /** Начало ближайшего актуального сеанса (п. 8.1 date_start). null: актуальных сеансов нет. */
  date_start: string | null;
  date_end: string | null;
  duration_min: number | null;
  /** minute: время известно; date: только дата. */
  time_precision: TimePrecision;
  /** Цена в рублях п. 8.1. 0: бесплатно. null: цена не указана, это не «бесплатно». */
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  source_url: string;
  source_type: SourceType;
  /** Хеш исходной записи для идемпотентного импорта. */
  source_hash: string;
  verified_at: string | null;
  /** Уверенность извлечения 0–1. */
  confidence: number;
  dedup_key: string;
  created_at: string;
  updated_at: string;
  /** Все источники после дедупликации. Первый совпадает с source_url. */
  sources: EventSource[];
  review?: EventReview;
  /** Путь к картинке или null, если картинки нет. */
  image: string | null;
  organizer?: string;
  /** Условная популярность от 0 до 100 для сортировки. */
  popularity: number;
  /** Все сеансы события по возрастанию даты, включая прошедшие и отменённые. */
  occurrences: Occurrence[];
  venue: Venue;
  offers: Offer[];
  price_summary: PriceSummary;
  source: SourceInfo;
  /** Куда ведёт кнопка «Купить билет». Отсутствует, если ссылки нет. */
  ticket_url?: string;
  /** Признак демонстрационной записи. У импортированных и введённых вручную событий false. */
  synthetic: boolean;
}

/** Событие в списке: к карточке добавлены сеансы, которые прошли условия запроса. */
export interface EventListItem extends AfishaEvent {
  /** Подходящие сеансы по возрастанию даты. Всегда не пустой. */
  matched_occurrence_ids: string[];
  /** Ближайший подходящий сеанс: его дату и статус показывает карточка в списке. */
  primary_occurrence_id: string;
}

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

export interface CategoryEntry {
  id: CategoryId;
  /** Название раздела: «Концерты». */
  name: LocalizedText;
  /** Название одного события: «Концерт». */
  name_one: LocalizedText;
}

export interface CityEntry {
  slug: CityId;
  name: LocalizedText;
  /** Форма «где»: «в Уфе», «Өфөлә». */
  name_in: LocalizedText;
  /** Центр города: для карты, когда у площадки нет своих координат. */
  lat: number;
  lon: number;
}

export interface AgeRatingEntry {
  id: AgeRating;
  /** С какого возраста можно. */
  min_age: number;
  label: LocalizedText;
}

export interface StatusEntry {
  id: OccurrenceStatus;
  label: LocalizedText;
  tone: Tone;
}

export interface DisplayStatusEntry {
  id: DisplayStatus;
  label: LocalizedText;
  tone: Tone;
}

export interface AvailabilityEntry {
  id: Availability;
  label: LocalizedText;
  tone: Tone;
}

export interface OptionEntry<T extends string> {
  id: T;
  label: LocalizedText;
}

export interface Dictionaries {
  timezone: Timezone;
  currency: 'RUB';
  categories: CategoryEntry[];
  cities: CityEntry[];
  age_ratings: AgeRatingEntry[];
  statuses: StatusEntry[];
  display_statuses: DisplayStatusEntry[];
  availability: AvailabilityEntry[];
  price_kinds: OptionEntry<PriceKind>[];
  offer_audiences: OptionEntry<OfferAudience>[];
  sorts: OptionEntry<SortKey>[];
  date_presets: OptionEntry<DatePreset>[];
}

// ---------------------------------------------------------------------------
// Список событий
// ---------------------------------------------------------------------------

export type DatePreset = 'today' | 'tomorrow' | 'weekend' | 'week';

export type SortKey = 'date' | 'price' | 'popularity';

export type AudienceFilter = 'kids';

/** Параметры GET /api/v1/events. Все поля необязательные. */
export interface EventsQuery {
  city?: CityId[];
  category?: CategoryId[];
  /** Готовый период. Нельзя сочетать с date_from и date_to. */
  date?: DatePreset;
  /** Дата в формате ГГГГ-ММ-ДД, границы включаются. */
  date_from?: string;
  date_to?: string;
  /** Начало сеанса не раньше, ЧЧ:ММ. */
  time_from?: string;
  /** Начало сеанса не позже, ЧЧ:ММ. */
  time_to?: string;
  /** Цена за человека не больше, в рублях. События с неизвестной ценой не проходят. */
  price_max?: number;
  /** Только события с явной пометкой «бесплатно». */
  free_only?: boolean;
  /** Возраст ребёнка: проходят события с рейтингом не выше. Неизвестный рейтинг не проходит. */
  age?: number;
  /** Точное совпадение возрастной метки. */
  age_rating?: AgeRating[];
  /** `kids`: раздел «Детям» и события с рейтингом 0+ и 6+. */
  audience?: AudienceFilter;
  /** По умолчанию только scheduled и rescheduled. */
  status?: OccurrenceStatus[];
  /** Поиск по названию, описанию и площадке без учёта регистра и ё/е. */
  q?: string;
  sort?: SortKey;
  page?: number;
  page_size?: number;
}

export interface FacetEntry<T extends string> {
  id: T;
  name: LocalizedText;
  /** Сколько событий останется, если выбрать это значение при остальных условиях. */
  count: number;
}

export interface Facets {
  cities: FacetEntry<CityId>[];
  categories: FacetEntry<CategoryId>[];
  age_ratings: FacetEntry<AgeRating | 'unknown'>[];
  price: { free: number; paid: number; unknown: number };
  /** Событий при текущих условиях. */
  total: number;
}

export type FacetsResponse = Facets;

/** Какие условия реально применены, включая вычисленные даты и статусы по умолчанию. */
export interface AppliedFilters {
  city: CityId[];
  category: CategoryId[];
  date: DatePreset | null;
  date_from: string | null;
  date_to: string | null;
  time_from: string | null;
  time_to: string | null;
  price_max: number | null;
  free_only: boolean;
  age: number | null;
  age_rating: AgeRating[];
  audience: AudienceFilter | null;
  status: OccurrenceStatus[];
  q: string | null;
  sort: SortKey;
  /** Условия, которые задал пользователь: по ним считается счётчик активных фильтров. */
  active: (keyof EventsQuery)[];
}

/**
 * Коды ослабления условий. Первые девять совпадают с `allowed_relaxations`
 * из evals/search/constraints.schema.json. `query` добавлен для каталога:
 * снятие текстового поиска в общем списке команды пока не описано.
 */
export type RelaxationCode =
  | 'soft_preferences'
  | 'date'
  | 'time'
  | 'budget'
  | 'city'
  | 'venue'
  | 'category'
  | 'age'
  | 'status'
  | 'query';

export interface Relaxation {
  /** Главное изменённое условие. */
  code: RelaxationCode;
  /** Все изменённые условия. Больше одного, только если по одному ничего не находится. */
  codes: RelaxationCode[];
  /** Подпись без числа: «Без ограничения цены». Число результатов лежит в count. */
  label: LocalizedText;
  /** То же изменение на языке условий ассистента. */
  patch: ConstraintsPatch;
  /** Запрос каталога с уже ослабленным условием. Есть только в ответе списка событий. */
  query?: EventsQuery;
  /** Сколько событий найдётся после ослабления. Посчитано реальным поиском, всегда больше нуля. */
  count: number;
}

export interface EventsListResponse {
  items: EventListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  /** Счётчики фильтров. null: бэк их не прислал (в контракте это необязательное расширение). */
  facets: Facets | null;
  applied: AppliedFilters;
  /** Сколько событий подошло бы, но цена у них не указана. В выдачу они не попали. */
  hidden_unknown_price: number;
  /** Сколько событий подошло бы, но возрастное ограничение у них не указано. */
  hidden_unknown_age: number;
  /** Варианты ослабить условия. Заполняется, только когда total = 0. */
  relaxations: Relaxation[];
  /** Сегодняшняя дата в поясе афиши: от неё считались «сегодня» и «выходные». */
  reference_date: string;
  timezone: Timezone;
}

// ---------------------------------------------------------------------------
// Ассистент
// ---------------------------------------------------------------------------

export type AssistantAction = 'search' | 'clarify' | 'out_of_scope' | 'confirmation_required';

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

export type UnsupportedAction =
  | 'purchase'
  | 'booking'
  | 'write_sql'
  | 'reveal_private_data'
  | 'reveal_system_prompt';

export interface DateRange {
  from: string;
  to: string;
}

export interface TimeRange {
  /** Начало сеанса не раньше. */
  start_from?: string;
  /** Начало сеанса не позже. */
  start_to?: string;
  /** Сеанс должен целиком поместиться в интервал. */
  fits_from?: string;
  fits_to?: string;
}

export interface Participants {
  total?: number;
  adults?: number;
  children_count?: number;
  children_ages?: number[];
  participant_ages?: number[];
}

export type ConstraintStatus = 'scheduled' | 'cancelled' | 'postponed' | 'sold_out' | 'unknown';

/** Проверяемые условия: их применяет код, а не языковая модель. */
export interface HardConstraints {
  cities?: string[];
  region?: string;
  date?: DateRange;
  time?: TimeRange;
  participants?: Participants;
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
  statuses?: ConstraintStatus[];
}

/** Пожелания: влияют на порядок выдачи и объяснения, но события не отсекают. */
export interface SoftConstraints {
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

export interface Constraints {
  hard: HardConstraints;
  soft: SoftConstraints;
}

/** Правка условий без текста: так работают чипы. Пути в unset: `hard.date`, `soft.preferences`. */
export interface ConstraintsPatch {
  reset: boolean;
  set: { hard?: HardConstraints; soft?: SoftConstraints };
  unset: string[];
}

export interface AssistantHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantConfirmation {
  confirmation_id: string;
  summary: string;
  expires_at: string;
}

export interface AssistantConfirmRequest {
  confirmation_id: string;
  /** Владелец подтверждения: токен привязан к user_ref, чужой получит 404. */
  user_ref?: string;
  confirm?: boolean;
  decision?: 'approve' | 'reject';
}

export interface AssistantConfirmResponse {
  status: string;
  message?: string;
  subscription_id?: string;
  feedback_id?: string;
}

export interface AssistantRequest {
  /** Фраза пользователя. Нужна фраза или patch. */
  message?: string;
  /** Условия из прошлого ответа: с ними диалог продолжается. */
  previous?: Constraints;
  /** Правка чипа без текста. */
  patch?: ConstraintsPatch;
  /** На какой вопрос отвечает пользователь: `clarify.code` из прошлого ответа. */
  answering?: ClarifyCode;
  /** История последних реплик диалога (для памяти агента без previous). */
  history?: AssistantHistoryItem[];
  /** Сколько событий вернуть, от 1 до 12. По умолчанию 6. */
  limit?: number;
  user_ref?: string;
  channel?: 'telegram' | 'web' | 'api';
}

export type ChipKind =
  | 'city'
  | 'date'
  | 'time'
  | 'budget'
  | 'participants'
  | 'category'
  | 'age_rating'
  | 'status'
  | 'preference'
  | 'query';

export interface AssistantChip {
  /** Путь условия: `hard.cities`. Уникален в пределах ответа. */
  key: string;
  kind: ChipKind;
  /** Что это за условие: «Город». */
  label: string;
  /** Как его понял ассистент: «Уфа». */
  value: string;
  removable: boolean;
  /** Что передать в `patch.unset`, чтобы снять условие. */
  unset: string[];
}

export interface AssistantAssumption {
  key: string;
  text: string;
}

export interface AssistantClarify {
  /** Главный вопрос. */
  code: ClarifyCode;
  /** Все недостающие сведения по порядку вопросов. */
  pending: ClarifyCode[];
  question: string;
  /** Готовые ответы: отправляются как обычная фраза. */
  quick_replies: string[];
}

export interface AssistantResult {
  event: AfishaEvent;
  /** Конкретный сеанс, который прошёл проверку условий. */
  occurrence_id: string;
  /** Почему подходит. Только факты из полей события и сеанса. */
  reasons: string[];
  /** На что обратить внимание: например, билеты на сеанс кончились. */
  caveats: string[];
}

export interface AssistantResponse {
  action: AssistantAction;
  /** Короткая реплика ассистента. */
  message: string;
  /** Полное текущее состояние условий: его передают в `previous` следующего запроса. */
  constraints: Constraints;
  chips: AssistantChip[];
  assumptions: AssistantAssumption[];
  clarify?: AssistantClarify;
  confirmation?: AssistantConfirmation;
  results?: AssistantResult[];
  /** Сколько всего событий прошло условия. Может быть больше длины results. */
  total?: number;
  hidden_unknown_price?: number;
  hidden_unknown_age?: number;
  /** Заполняется, когда action = search и ничего не найдено. */
  relaxations?: Relaxation[];
  unsupported_actions?: UnsupportedAction[];
  /** Те же условия для каталога: ссылка «показать все». Нет, если условия в каталог не переводятся. */
  events_query?: EventsQuery;
  trace_id?: string;
  reference_date: string;
  timezone: Timezone;
  /** Кто разбирал фразу (правила или LLM-модель). */
  engine: string;
}

// ---------------------------------------------------------------------------
// Служебное
// ---------------------------------------------------------------------------

export interface ApiErrorDetail {
  field: string;
  message: string;
}

/** Единый формат ошибки API: { code, message, details, request_id }. */
export interface ApiErrorBody {
  code: string;
  /** Понятный жителю текст по-русски: его можно показать как есть. */
  message: string;
  /** Ошибки по полям. Пустой массив, если ошибка не про конкретные поля. */
  details: ApiErrorDetail[];
  /** Идентификатор запроса для сквозной трассировки; тот же в заголовке X-Request-Id. */
  request_id: string;
}

export interface ApiEndpointInfo {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
}

/** Ответ GET /api/v1: оглавление методов. */
export interface ApiIndexResponse {
  name: string;
  version: 'v1';
  /** Источник данных: сейчас заглушки. */
  data: 'mock';
  timezone: Timezone;
  /** Страница с описанием API на сайте. */
  docs: string;
  endpoints: ApiEndpointInfo[];
}

export interface HealthResponse {
  status: 'ok';
  version: 'v1';
  /** Источник данных: сейчас заглушки. */
  data: 'mock';
  events: number;
  time: string;
  timezone: Timezone;
}
