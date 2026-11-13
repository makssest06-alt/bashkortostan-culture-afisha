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

import { getCity } from '../../data/dictionaries';
import { summarizePrice } from './price';
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

export type ApiAssistantResult = Omit<AssistantResult, 'event'> & { event: ApiEvent };

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

function fromApiOccurrence(occurrence: ApiOccurrence, event: ApiEvent): Occurrence {
  const result: Occurrence = {
    id: occurrence.id,
    event_id: event.id,
    venue_id: event.venue_id,
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
function offersFromPrice(event: ApiEvent): ApiOffer[] {
  if (event.is_free) return [{ price: 0, is_free: true }];
  if (event.price_min === null) return [];
  const offers: ApiOffer[] = [{ price: event.price_min, is_free: false }];
  if (event.price_max !== null && event.price_max !== event.price_min) offers.push({ price: event.price_max, is_free: false });
  return offers;
}

function fromApiVenue(event: ApiEvent): Venue {
  const city = getCity(event.city_id);
  const cityName = city?.name ?? { ru: event.city, ba: event.city };
  const venue: Venue = {
    id: event.venue_id,
    name: event.venue,
    city: event.city_id,
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

export function fromApiEvent(event: ApiEvent): AfishaEvent {
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
    time_precision: event.time_precision ?? 'minute',
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
    occurrences: (event.occurrences ?? []).map((occurrence) => fromApiOccurrence(occurrence, event)),
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

export function fromApiListItem(item: ApiEventListItem): EventListItem {
  return {
    ...fromApiEvent(item),
    matched_occurrence_ids: [...item.matched_occurrence_ids],
    primary_occurrence_id: item.primary_occurrence_id,
  };
}

export function fromApiEventsList(response: ApiEventsListResponse): EventsListResponse {
  return { ...response, items: response.items.map(fromApiListItem) };
}

export function fromApiAssistantResponse(response: ApiAssistantResponse): AssistantResponse {
  if (!response.results) return response as AssistantResponse;
  return { ...response, results: response.results.map((result) => ({ ...result, event: fromApiEvent(result.event) })) };
}
