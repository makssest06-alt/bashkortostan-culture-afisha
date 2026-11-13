/**
 * Записи хранилища → события каталога. Импортированная или введённая вручную запись
 * становится событием с одним сеансом; правка модератора ложится поверх демо-события.
 */

import { getCity } from '../../data/dictionaries';
import { ageRatingOf, dedupKey, normalizeTitle } from '../api/identity';
import { summarizePrice } from '../api/price';
import type { AfishaEvent, EventSource, Occurrence, Offer, TimeValue, Venue } from '../api/types';
import type { EditableFields, EventPatch, StoredRecord } from './types';

const TZ = 'Asia/Yekaterinburg' as const;

function timeValue(iso: string, precision: 'minute' | 'date'): TimeValue {
  if (precision === 'date') return { local: iso.slice(0, 10), utc: null, timezone: TZ, precision };
  return { local: iso, utc: new Date(Date.parse(iso)).toISOString().replace('.000Z', 'Z'), timezone: TZ, precision };
}

/** Тарифы по цене п. 8.1: «бесплатно», «от» и «до» или пусто, если цена не указана. */
export function offersFromPrice(id: string, price: Pick<StoredRecord, 'price_min' | 'price_max' | 'is_free'>): Offer[] {
  if (price.is_free) return [{ id: `${id}_offer_1`, amount_minor: 0, currency: 'RUB', is_free: true }];
  if (price.price_min === null) return [];
  const offers: Offer[] = [{ id: `${id}_offer_1`, amount_minor: price.price_min * 100, currency: 'RUB', is_free: false }];
  if (price.price_max !== null && price.price_max !== price.price_min) {
    offers.push({ id: `${id}_offer_2`, amount_minor: price.price_max * 100, currency: 'RUB', is_free: false });
  }
  return offers;
}

function sourceName(sources: readonly EventSource[], url: string): string {
  if (sources[0]?.title) return sources[0].title;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Источник';
  }
}

/** Запись хранилища → событие каталога с одним сеансом. */
export function materializeRecord(record: StoredRecord, knownVenues: ReadonlyMap<string, Venue>, now: Date): AfishaEvent {
  const city = getCity(record.city_id);
  const known = knownVenues.get(record.venue_id);
  const venue: Venue = known
    ? { ...known, address: record.address ?? known.address }
    : {
        id: record.venue_id,
        name: record.venue,
        city: record.city_id,
        city_name: city?.name ?? { ru: record.city_id, ba: record.city_id },
        address: record.address,
        map_url: `https://yandex.ru/maps/?text=${encodeURIComponent(`${record.venue}, ${city?.name.ru ?? ''}`)}`,
        ...(record.lat !== null && record.lon !== null ? { lat: record.lat, lon: record.lon } : {}),
      };
  const start = timeValue(record.date_start, record.time_precision);
  const end = record.date_end ? timeValue(record.date_end, record.time_precision) : undefined;
  const closesAt = Date.parse(
    record.time_precision === 'date' ? `${(record.date_end ?? record.date_start).slice(0, 10)}T23:59:59+05:00` : record.date_start,
  );
  const occurrence: Occurrence = {
    id: `occ_${record.id.slice(0, 8)}_1`,
    event_id: record.id,
    venue_id: venue.id,
    start,
    status: record.status === 'cancelled' ? 'cancelled' : 'scheduled',
    status_is_verified: true,
    availability: 'unknown',
    is_past: closesAt <= now.getTime(),
  };
  if (end) occurrence.end = end;
  const offers = offersFromPrice(record.id, record);

  const event: AfishaEvent = {
    id: record.id,
    title: record.title,
    normalized_title: record.normalized_title,
    description: record.description,
    category: record.category,
    tags: [...record.tags],
    language: record.language,
    status: record.status,
    kind: 'standalone',
    age_limit: record.age_limit,
    age_rating: ageRatingOf(record.age_limit),
    date_start: record.date_start,
    date_end: record.date_end,
    duration_min: record.duration_min,
    time_precision: record.time_precision,
    price_min: record.price_min,
    price_max: record.price_max,
    is_free: record.is_free,
    source_url: record.source_url,
    source_type: record.source_type,
    source_hash: record.source_hash,
    verified_at: record.verified_at,
    confidence: record.confidence,
    dedup_key: record.dedup_key,
    created_at: record.created_at,
    updated_at: record.updated_at,
    sources: record.sources.map((source) => ({ ...source })),
    image: null,
    popularity: 30,
    occurrences: [occurrence],
    venue,
    offers,
    price_summary: summarizePrice(offers),
    source: {
      name: sourceName(record.sources, record.source_url),
      url: record.source_url,
      checked_at: record.verified_at ?? record.updated_at,
      sources_count: record.sources.length,
    },
    synthetic: false,
  };
  if (record.org_link) event.ticket_url = record.org_link;
  if (record.review) event.review = { ...record.review, reasons: [...record.review.reasons] };
  return event;
}

/** Правка модератора поверх демо-события. Даты демо-события не меняются: они считаются от сегодня. */
export function applyPatch(event: AfishaEvent, patch: EventPatch): AfishaEvent {
  const fields = patch.fields;
  const next: AfishaEvent = { ...event, updated_at: patch.updated_at };
  if (fields.title !== undefined) {
    next.title = fields.title;
    next.normalized_title = normalizeTitle(fields.title);
    next.dedup_key = dedupKey(next.normalized_title, next.date_start?.slice(0, 10) ?? null, next.venue.id);
  }
  if (fields.description !== undefined) next.description = fields.description;
  if (fields.category !== undefined) next.category = fields.category;
  if (fields.tags !== undefined) next.tags = [...fields.tags];
  if (fields.language !== undefined) next.language = fields.language;
  if (fields.age_limit !== undefined) {
    next.age_limit = fields.age_limit;
    next.age_rating = ageRatingOf(fields.age_limit);
  }
  if (fields.address !== undefined) next.venue = { ...next.venue, address: fields.address };
  if (fields.org_link !== undefined) {
    if (fields.org_link) next.ticket_url = fields.org_link;
    else delete next.ticket_url;
  }
  if (fields.source_url !== undefined) {
    next.source_url = fields.source_url;
    next.sources = [{ ...next.sources[0], source_url: fields.source_url }, ...next.sources.slice(1)];
    next.source = { ...next.source, url: fields.source_url };
  }
  if (fields.price_min !== undefined || fields.price_max !== undefined || fields.is_free !== undefined) {
    const price = {
      price_min: fields.price_min !== undefined ? fields.price_min : next.price_min,
      price_max: fields.price_max !== undefined ? fields.price_max : next.price_max,
      is_free: fields.is_free !== undefined ? fields.is_free : next.is_free,
    };
    if (price.price_min !== null && price.price_max === null) price.price_max = price.price_min;
    // «0 — бесплатно» (п. 8.1): нулевая цена и признак бесплатности всегда согласованы.
    if (price.price_min === 0 && price.price_max === 0) price.is_free = true;
    if (price.is_free) {
      price.price_min = 0;
      price.price_max = 0;
    }
    Object.assign(next, price);
    next.offers = offersFromPrice(next.id, price);
    next.price_summary = summarizePrice(next.offers);
    const tags = next.tags.filter((tag) => tag !== 'бесплатно');
    next.tags = price.is_free ? [...tags, 'бесплатно'] : tags;
  }
  if (fields.status !== undefined) next.status = fields.status;
  if (patch.review) next.review = { ...patch.review, reasons: [...patch.review.reasons] };
  if (patch.extra_sources?.length) {
    next.sources = [...next.sources, ...patch.extra_sources.filter((extra) => !next.sources.some((s) => s.source_hash === extra.source_hash))];
    next.source = { ...next.source, sources_count: next.sources.length };
  }
  return next;
}

/** Правка модератора для записи хранилища: поля меняются в самой записи. */
export function applyEditToRecord(record: StoredRecord, fields: EditableFields, at: string): StoredRecord {
  const next: StoredRecord = { ...record, updated_at: at };
  for (const [key, value] of Object.entries(fields) as [keyof EditableFields, unknown][]) {
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (fields.title !== undefined || fields.date_start !== undefined) {
    next.normalized_title = normalizeTitle(next.title);
    next.dedup_key = dedupKey(next.normalized_title, next.date_start.slice(0, 10), next.venue_id);
  }
  if (fields.date_start !== undefined) next.time_precision = fields.date_start.includes('T00:00:00') ? record.time_precision : 'minute';
  if (next.price_min !== null && next.price_max === null) next.price_max = next.price_min;
  if (next.price_min === 0 && next.price_max === 0) next.is_free = true;
  if (next.is_free) {
    next.price_min = 0;
    next.price_max = 0;
  }
  const tags = next.tags.filter((tag) => tag !== 'бесплатно');
  next.tags = next.is_free ? [...tags, 'бесплатно'] : tags;
  if (fields.source_url !== undefined) {
    next.sources = [{ ...next.sources[0], source_url: fields.source_url }, ...next.sources.slice(1)];
  }
  return next;
}
