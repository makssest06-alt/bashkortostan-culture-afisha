/**
 * Событие на проводе: форма контракта п. 8.1 ТЗ (contracts/event.schema.json).
 *
 * Внутри сайта событие хранит удобные интерфейсу части (venue объектом, тарифы
 * в копейках, сеансы с TimeValue). По сети оно ходит плоским, с полями п. 8.1 на верхнем
 * уровне и необязательными расширениями. toApiEvent превращает внутреннее событие
 * в контрактное (сервер), fromApiEvent собирает его обратно (клиент). Боевой бэкенд
 * отдаёт ту же контрактную форму, и интерфейс работает с ним без правок.
 *
 * Модуль без серверных зависимостей: его импортируют и обработчики API, и клиент.
 */

import { CITIES, getCity } from '../../data/dictionaries';
import { summarizePrice } from './price';
import { normalizeEventsList } from './wire-list';
import type {
  AfishaEvent,
  AgeLimit,
  AgeRating,
  AssistantResponse,
  AssistantResult,
  Availability,
  CategoryId,
  CityId,
  EventKind,
  EventListItem,
  EventReview,
  EventSource,
  EventStatus,
  EventsListResponse,
  EventsQuery,
  Occurrence,
  OccurrenceStatus,
  Offer,
  OfferAudience,
  SourceType,
  TimePrecision,
  TimeValue,
  Venue,
} from './types';

const TZ = 'Asia/Yekaterinburg' as const;

// ---------------------------------------------------------------------------
// Контрактные типы
// ---------------------------------------------------------------------------

export interface ApiOccurrence {
  id: string;
  date_start: string;
  date_end: string | null;
  time_precision: TimePrecision;
  status: OccurrenceStatus;
  status_verified: boolean;
  previous_date_start?: string;
  availability: Availability;
  is_past: boolean;
}

export interface ApiOffer {
  name?: string;
  /** Цена в рублях. null: цена этого тарифа не указана. */
  price: number | null;
  audience?: OfferAudience;
  is_free: boolean;
}

/** Событие п. 8.1 плюс расширения (city_id … review). */
export interface ApiEvent {
  id: string;
  title: string;
  normalized_title: string;
  category: CategoryId;
  tags: string[];
  date_start: string | null;
  date_end: string | null;
  duration_min: number | null;
  city: string;
  venue: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  description: string;
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  age_limit: AgeLimit | null;
  language: string | null;
  org_link: string | null;
  source_url: string;
  source_type: SourceType;
  source_hash: string;
  verified_at: string | null;
  confidence: number;
  status: EventStatus;
  dedup_key: string;
  created_at: string;
  updated_at: string;
  // Расширения
  city_id: CityId;
  venue_id: string;
  time_precision: TimePrecision;
  kind: EventKind;
  popularity: number;
  organizer: string | null;
  image: string | null;
  title_ba?: string;
  synthetic: boolean;
  sources: EventSource[];
  occurrences: ApiOccurrence[];
  offers: ApiOffer[];
  review?: EventReview;
}

export interface ApiEventListItem extends ApiEvent {
  matched_occurrence_ids: string[];
  primary_occurrence_id: string;
}

export type ApiEventsListResponse = Omit<EventsListResponse, 'items'> & { items: ApiEventListItem[] };

/** Расширения события сверх п. 8.1: контракт их не требует, бэк может их не присылать. */
type ApiEventExtension =
  | 'city_id'
  | 'venue_id'
  | 'time_precision'
  | 'kind'
  | 'popularity'
  | 'organizer'
  | 'image'
  | 'synthetic'
  | 'sources'
  | 'occurrences'
  | 'offers';

/** Событие, каким его может прислать бэк: обязательные поля п. 8.1 и любые из расширений. */
export type ApiEventInput = Omit<ApiEvent, ApiEventExtension> & Partial<Pick<ApiEvent, ApiEventExtension>>;

export type ApiEventListItemInput = ApiEventInput & Partial<Pick<ApiEventListItem, 'matched_occurrence_ids' | 'primary_occurrence_id'>>;

/** Ответ списка, каким его может прислать бэк: обязательны только items и счётчики страниц. */
export type ApiEventsListInput = Partial<Omit<ApiEventsListResponse, 'items'>> & { items: ApiEventListItemInput[] };

export type ApiAssistantResult = Omit<AssistantResult, 'event'> & { event: ApiEventInput };

export type ApiAssistantResponse = Omit<AssistantResponse, 'results'> & { results?: ApiAssistantResult[] };

// ---------------------------------------------------------------------------
// Время
// ---------------------------------------------------------------------------

function timestampOf(value: TimeValue): string {
  return value.precision === 'minute' ? value.local : `${value.local}T00:00:00+05:00`;
}

function timeValueOf(timestamp: string, precision: TimePrecision): TimeValue {
  if (precision === 'date') return { local: timestamp.slice(0, 10), utc: null, timezone: TZ, precision };
  const ms = Date.parse(timestamp);
  return {
    local: timestamp,
    utc: Number.isNaN(ms) ? null : new Date(ms).toISOString().replace('.000Z', 'Z'),
    timezone: TZ,
    precision,
  };
}

// ---------------------------------------------------------------------------
// Внутреннее → контракт
// ---------------------------------------------------------------------------

function toApiOccurrence(occurrence: Occurrence): ApiOccurrence {
  const result: ApiOccurrence = {
    id: occurrence.id,
    date_start: timestampOf(occurrence.start),
    date_end: occurrence.end ? timestampOf(occurrence.end) : null,
    time_precision: occurrence.start.precision,
    status: occurrence.status,
    status_verified: occurrence.status_is_verified,
    availability: occurrence.availability,
    is_past: occurrence.is_past,
  };
  if (occurrence.previous_start) result.previous_date_start = timestampOf(occurrence.previous_start);
  return result;
}

function toApiOffer(offer: Offer): ApiOffer {
  const result: ApiOffer = {
    price: offer.amount_minor === null ? null : Math.round(offer.amount_minor / 100),
    is_free: offer.is_free,
  };
  if (offer.name) result.name = offer.name;
  if (offer.audience) result.audience = offer.audience;
  return result;
}

export function toApiEvent(event: AfishaEvent): ApiEvent {
  const result: ApiEvent = {
    id: event.id,
    title: event.title,
    normalized_title: event.normalized_title,
    category: event.category,
    tags: [...event.tags],
    date_start: event.date_start,
    date_end: event.date_end,
    duration_min: event.duration_min,
    city: event.venue.city_name.ru,
    venue: event.venue.name,
    address: event.venue.address,
    lat: event.venue.lat ?? null,
    lon: event.venue.lon ?? null,
    description: event.description,
    price_min: event.price_min,
    price_max: event.price_max,
    is_free: event.is_free,
    age_limit: event.age_limit,
    language: event.language,
    org_link: event.ticket_url ?? null,
    source_url: event.source_url,
    source_type: event.source_type,
    source_hash: event.source_hash,
    verified_at: event.verified_at,
    confidence: event.confidence,
    status: event.status,
    dedup_key: event.dedup_key,
    created_at: event.created_at,
    updated_at: event.updated_at,
    city_id: event.venue.city,
    venue_id: event.venue.id,
    time_precision: event.time_precision,
    kind: event.kind,
    popularity: event.popularity,
    organizer: event.organizer ?? null,
    image: event.image,
    synthetic: event.synthetic,
    sources: event.sources.map((source) => ({ ...source })),
    occurrences: event.occurrences.map(toApiOccurrence),
    offers: event.offers.map(toApiOffer),
  };
  if (event.title_ba) result.title_ba = event.title_ba;
  if (event.review) result.review = { ...event.review, reasons: [...event.review.reasons] };
  return result;
}

export function toApiListItem(item: EventListItem): ApiEventListItem {
  return {
    ...toApiEvent(item),
    matched_occurrence_ids: [...item.matched_occurrence_ids],
    primary_occurrence_id: item.primary_occurrence_id,
  };
}

export function toApiEventsList(response: EventsListResponse): ApiEventsListResponse {
  return { ...response, items: response.items.map(toApiListItem) };
}

export function toApiAssistantResponse(response: AssistantResponse): ApiAssistantResponse {
  if (!response.results) return response as ApiAssistantResponse;
  return { ...response, results: response.results.map((result) => ({ ...result, event: toApiEvent(result.event) })) };
}

// ---------------------------------------------------------------------------
// Контракт → внутреннее
// ---------------------------------------------------------------------------

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е');
}

/** Город сайта по названию из п. 8.1, если бэк не прислал расширение city_id. */
function cityIdOf(event: ApiEventInput): CityId {
  if (event.city_id) return event.city_id;
  const name = normalizeName(event.city ?? '');
  const known = CITIES.find((city) => normalizeName(city.name.ru) === name || normalizeName(city.name.ba) === name);
  return (known?.slug ?? name) as CityId;
}

/** Короткий устойчивый хеш строки (FNV-1a): одинаковая площадка получает одинаковый код. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function venueIdOf(event: ApiEventInput): string {
  return event.venue_id ?? `venue_${shortHash(`${cityIdOf(event)}|${normalizeName(event.venue ?? '')}`)}`;
}

function timePrecisionOf(event: ApiEventInput): TimePrecision {
  if (event.time_precision) return event.time_precision;
  return event.date_start && event.date_start.includes('T') ? 'minute' : 'date';
}

/**
 * Сеанс из дат п. 8.1, если бэк не прислал расширение occurrences.
 * Статус «состоится» подтверждён, только если у события есть дата проверки.
 */
function occurrencesFromDates(event: ApiEventInput, now: number = Date.now()): ApiOccurrence[] {
  if (!event.date_start) return [];
  const precision = timePrecisionOf(event);
  const last = event.date_end ?? event.date_start;
  const endMs = precision === 'date' ? Date.parse(`${last.slice(0, 10)}T23:59:59+05:00`) : Date.parse(last);
  return [
    {
      id: `${event.id}_occ_1`,
      date_start: event.date_start,
      date_end: event.date_end,
      time_precision: precision,
      status: event.status === 'cancelled' ? 'cancelled' : 'scheduled',
      status_verified: event.verified_at !== null,
      availability: 'unknown',
      is_past: Number.isFinite(endMs) && endMs < now,
    },
  ];
}

function fromApiOccurrence(occurrence: ApiOccurrence, event: ApiEventInput): Occurrence {
  const result: Occurrence = {
    id: occurrence.id,
    event_id: event.id,
    venue_id: venueIdOf(event),
    start: timeValueOf(occurrence.date_start, occurrence.time_precision),
    status: occurrence.status,
    status_is_verified: occurrence.status_verified,
    availability: occurrence.availability,
    is_past: occurrence.is_past,
  };
  if (occurrence.date_end) result.end = timeValueOf(occurrence.date_end, occurrence.time_precision);
  if (occurrence.previous_date_start) {
    result.previous_start = timeValueOf(occurrence.previous_date_start, occurrence.time_precision);
  }
  return result;
}

function fromApiOffer(offer: ApiOffer, index: number, eventId: string): Offer {
  const result: Offer = {
    id: `${eventId}_offer_${index + 1}`,
    amount_minor: offer.price === null ? null : Math.round(offer.price * 100),
    currency: 'RUB',
    is_free: offer.is_free,
  };
  if (offer.name) result.name = offer.name;
  if (offer.audience) result.audience = offer.audience;
  return result;
}

/** Тарифы из цены п. 8.1, если сервер не прислал расширение offers. */
function offersFromPrice(event: ApiEventInput): ApiOffer[] {
  if (event.is_free) return [{ price: 0, is_free: true }];
  if (event.price_min === null) return [];
  const offers: ApiOffer[] = [{ price: event.price_min, is_free: false }];
  if (event.price_max !== null && event.price_max !== event.price_min) offers.push({ price: event.price_max, is_free: false });
  return offers;
}

function fromApiVenue(event: ApiEventInput): Venue {
  const cityId = cityIdOf(event);
  const city = getCity(cityId);
  const cityName = city?.name ?? { ru: event.city, ba: event.city };
  const venue: Venue = {
    id: venueIdOf(event),
    name: event.venue,
    city: cityId,
    city_name: cityName,
    address: event.address,
    map_url: `https://yandex.ru/maps/?text=${encodeURIComponent(`${event.venue}, ${cityName.ru}`)}`,
  };
  if (event.lat !== null && event.lon !== null) {
    venue.lat = event.lat;
    venue.lon = event.lon;
  }
  return venue;
}

export function fromApiEvent(event: ApiEventInput): AfishaEvent {
  const offers = (event.offers ?? offersFromPrice(event)).map((offer, index) => fromApiOffer(offer, index, event.id));
  const sources = event.sources?.length
    ? event.sources.map((source) => ({ ...source }))
    : [{ source_url: event.source_url, source_type: event.source_type, source_hash: event.source_hash, verified_at: event.verified_at }];
  const result: AfishaEvent = {
    id: event.id,
    title: event.title,
    normalized_title: event.normalized_title,
    description: event.description,
    category: event.category,
    tags: [...(event.tags ?? [])],
    language: event.language,
    status: event.status,
    kind: event.kind ?? 'standalone',
    age_limit: event.age_limit,
    age_rating: event.age_limit === null ? null : (`${event.age_limit}+` as AgeRating),
    date_start: event.date_start,
    date_end: event.date_end,
    duration_min: event.duration_min,
    time_precision: timePrecisionOf(event),
    price_min: event.price_min,
    price_max: event.price_max,
    is_free: event.is_free,
    source_url: event.source_url,
    source_type: event.source_type,
    source_hash: event.source_hash,
    verified_at: event.verified_at,
    confidence: event.confidence,
    dedup_key: event.dedup_key,
    created_at: event.created_at,
    updated_at: event.updated_at,
    sources,
    image: event.image ?? null,
    popularity: event.popularity ?? 0,
    occurrences: (event.occurrences?.length ? event.occurrences : occurrencesFromDates(event)).map((occurrence) =>
      fromApiOccurrence(occurrence, event),
    ),
    venue: fromApiVenue(event),
    offers,
    price_summary: summarizePrice(offers),
    source: {
      name: sources[0]?.title ?? 'Источник',
      url: event.source_url,
      checked_at: event.verified_at ?? event.updated_at,
      sources_count: sources.length,
    },
    synthetic: event.synthetic ?? false,
  };
  if (event.title_ba) result.title_ba = event.title_ba;
  if (event.organizer) result.organizer = event.organizer;
  if (event.org_link) result.ticket_url = event.org_link;
  if (event.review) result.review = { ...event.review, reasons: [...event.review.reasons] };
  return result;
}

/**
 * Элемент списка. Без расширений бэка подходящими считаются будущие сеансы (или все, если будущих нет),
 * а показывается первый из них.
 */
export function fromApiListItem(item: ApiEventListItemInput): EventListItem {
  const event = fromApiEvent(item);
  const upcoming = event.occurrences.filter((occurrence) => !occurrence.is_past);
  const matched = item.matched_occurrence_ids?.length
    ? [...item.matched_occurrence_ids]
    : (upcoming.length ? upcoming : event.occurrences).map((occurrence) => occurrence.id);
  return { ...event, matched_occurrence_ids: matched, primary_occurrence_id: item.primary_occurrence_id ?? matched[0] ?? '' };
}

/** Список событий. query — что сайт отправил: из него восстанавливаются применённые условия, если бэк их не вернул. */
export function fromApiEventsList(response: ApiEventsListInput, query: EventsQuery = {}): EventsListResponse {
  return normalizeEventsList(response as unknown as Record<string, unknown>, response.items.map(fromApiListItem), query);
}

export function fromApiAssistantResponse(response: ApiAssistantResponse): AssistantResponse {
  if (!response.results) return response as AssistantResponse;
  return { ...response, results: response.results.map((result) => ({ ...result, event: fromApiEvent(result.event) })) };
}
