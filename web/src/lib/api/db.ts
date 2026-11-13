/**
 * Слой данных: превращает демонстрационные записи в события формата API.
 *
 * Главная работа здесь: материализация дат. В заглушках хранятся только
 * смещения от «сегодня» и дни недели, а реальные даты вычисляются на каждый
 * запрос в поясе Asia/Yekaterinburg. Состояния между запросами нет.
 */

import { getCity } from '../../data/dictionaries';
import { MOCK_EVENTS, MOCK_SOURCE, MOCK_TICKET_URL, MOCK_VENUES } from '../../data/mock';
import type { MockEvent, MockOffer, MockSchedule, MockVenue, MockWeekday, MockWeekdaySession } from '../../data/mock';
import {
  addDays,
  dateValue,
  floorToMinute,
  localNow,
  localToMs,
  nextWeekday,
  startOfLocalDayMs,
  timedValue,
  valueDate,
} from './time';
import { ageLimitOf, dedupKey, normalizeTitle, sha256, timestampOf, uuidFromCode } from './identity';
import { summarizePrice } from './price';
import type { AfishaEvent, EventSource, Occurrence, Offer, TimeValue, Venue } from './types';

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MIN_DAY_OFFSET = -1;
const MAX_DAY_OFFSET = 21;

const WEEKDAY_INDEX: Record<MockWeekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export interface Catalog {
  events: AfishaEvent[];
  /** Сегодняшняя дата в поясе афиши. */
  today: string;
  /** Момент, от которого считались даты, округлённый до минуты. */
  now: Date;
}

// ---------------------------------------------------------------------------
// Площадки
// ---------------------------------------------------------------------------

function buildVenue(mock: MockVenue): Venue {
  const city = getCity(mock.city);
  if (!city) throw new Error(`Площадка ${mock.id}: неизвестный город ${mock.city}`);
  const venue: Venue = {
    id: mock.id,
    name: mock.name,
    city: mock.city,
    city_name: city.name,
    address: mock.address,
    map_url: `https://yandex.ru/maps/?text=${encodeURIComponent(`${mock.name}, ${city.name.ru}`)}`,
  };
  if (mock.lat !== undefined && mock.lon !== undefined) {
    venue.lat = mock.lat;
    venue.lon = mock.lon;
  }
  return venue;
}

const VENUES: ReadonlyMap<string, Venue> = new Map(MOCK_VENUES.map((mock) => [mock.id, buildVenue(mock)]));

export function getVenues(): Venue[] {
  return [...VENUES.values()];
}

// ---------------------------------------------------------------------------
// Цены
// ---------------------------------------------------------------------------

function buildOffers(event: MockEvent): Offer[] {
  return event.offers.map((mock: MockOffer, index): Offer => {
    const offer: Offer = {
      id: `${event.id.replace('evt_', 'off_')}_${index + 1}`,
      amount_minor: mock.rub === null ? null : Math.round(mock.rub * 100),
      currency: 'RUB',
      is_free: mock.is_free === true,
    };
    if (mock.name) offer.name = mock.name;
    if (mock.audience) offer.audience = mock.audience;
    return offer;
  });
}

export { summarizePrice };

// ---------------------------------------------------------------------------
// Сеансы
// ---------------------------------------------------------------------------

interface Clock {
  today: string;
  nowMs: number;
}

function assertOffset(eventId: string, offset: number): void {
  if (!Number.isInteger(offset) || offset < MIN_DAY_OFFSET || offset > MAX_DAY_OFFSET) {
    throw new Error(`Событие ${eventId}: смещение дня ${offset} вне диапазона от -1 до +21`);
  }
}

/** Конец сеанса: начало плюс длительность. Может перейти на следующие сутки. */
function endValue(date: string, time: string, durationMin: number): TimeValue {
  const endMs = localToMs(date, time) + durationMin * MS_MINUTE;
  const local = localNow(new Date(endMs));
  return timedValue(local.date, local.time);
}

/**
 * Момент, после которого на сеанс уже не попасть. Спектакль или концерт: его начало.
 * Фестиваль идёт весь день, и прийти можно в любое время, поэтому для него это конец.
 */
function closesAtMs(event: MockEvent, date: string, time: string, durationMin: number | undefined): number {
  const start = localToMs(date, time);
  return event.kind === 'festival' && durationMin ? start + durationMin * MS_MINUTE : start;
}

/** Дата сеанса, привязанного к дню недели. */
function resolveWeekdayDate(clock: Clock, event: MockEvent, spec: MockWeekdaySession): string {
  let date = nextWeekday(clock.today, WEEKDAY_INDEX[spec.weekday]);
  // Сегодняшний сеанс уже недоступен: показываем такой же через неделю.
  if (date === clock.today && closesAtMs(event, date, spec.time, spec.duration_min) <= clock.nowMs) {
    date = addDays(date, 7);
  }
  return addDays(date, (spec.week ?? 0) * 7);
}

function buildOccurrence(event: MockEvent, spec: MockSchedule, index: number, clock: Clock): Occurrence {
  const status = spec.status ?? 'scheduled';
  const base = {
    id: `${event.id.replace('evt_', 'occ_')}_${index + 1}`,
    event_id: uuidFromCode(event.id),
    venue_id: event.venue_id,
    status,
    status_is_verified: status === 'unknown' ? false : (spec.status_is_verified ?? true),
    availability: spec.availability ?? 'available',
  };

  if (spec.kind === 'period') {
    assertOffset(event.id, spec.from_offset);
    assertOffset(event.id, spec.to_offset);
    const end = dateValue(addDays(clock.today, spec.to_offset));
    return {
      ...base,
      start: dateValue(addDays(clock.today, spec.from_offset)),
      end,
      is_past: valueDate(end) < clock.today,
    };
  }

  let date: string;
  if (spec.kind === 'offset') {
    assertOffset(event.id, spec.day_offset);
    date = addDays(clock.today, spec.day_offset);
  } else {
    date = resolveWeekdayDate(clock, event, spec);
  }

  const occurrence: Occurrence = {
    ...base,
    start: timedValue(date, spec.time),
    is_past: closesAtMs(event, date, spec.time, spec.duration_min) <= clock.nowMs,
  };
  if (spec.duration_min) occurrence.end = endValue(date, spec.time, spec.duration_min);
  if (spec.kind === 'offset' && spec.previous) {
    assertOffset(event.id, spec.previous.day_offset);
    occurrence.previous_start = timedValue(addDays(clock.today, spec.previous.day_offset), spec.previous.time);
  }
  return occurrence;
}

/** Момент начала для сортировки. У выставки с периодом это начало первого дня. */
export function startMs(value: TimeValue): number {
  if (value.precision === 'minute' && value.utc) return Date.parse(value.utc);
  return startOfLocalDayMs(valueDate(value));
}

function buildOccurrences(event: MockEvent, clock: Clock): Occurrence[] {
  const seen = new Set<string>();
  const result: Occurrence[] = [];
  event.schedule.forEach((spec, index) => {
    const occurrence = buildOccurrence(event, spec, index, clock);
    // Смещение и день недели могут дать один и тот же сеанс: оставляем первый.
    if (seen.has(occurrence.start.local)) return;
    seen.add(occurrence.start.local);
    result.push(occurrence);
  });
  return result.sort((a, b) => startMs(a.start) - startMs(b.start) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// События
// ---------------------------------------------------------------------------

function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/**
 * Ближайший актуальный сеанс: не прошедший и не отменённый. Если таких нет,
 * берётся ближайший не прошедший, иначе последний. Его даты становятся date_start и date_end события.
 */
export function primaryOccurrenceOf(occurrences: readonly Occurrence[]): Occurrence | null {
  return (
    occurrences.find((item) => !item.is_past && item.status !== 'cancelled') ??
    occurrences.find((item) => !item.is_past) ??
    occurrences[occurrences.length - 1] ??
    null
  );
}

/** Цена п. 8.1 по общим билетам: price_min, price_max и is_free. Неизвестная цена остаётся null. */
export function priceFields(offers: readonly Offer[]): Pick<AfishaEvent, 'price_min' | 'price_max' | 'is_free'> {
  const summary = summarizePrice(offers);
  if (summary.kind === 'free') return { price_min: 0, price_max: 0, is_free: true };
  if (summary.kind === 'unknown') return { price_min: null, price_max: null, is_free: false };
  const general = offers.filter((offer) => offer.audience === undefined || offer.audience === 'adult');
  const amounts = (general.length > 0 ? general : offers)
    .filter((offer) => !offer.is_free && offer.amount_minor !== null)
    .map((offer) => Math.round((offer.amount_minor as number) / 100));
  return { price_min: Math.min(...amounts), price_max: Math.max(...amounts), is_free: false };
}

/** Даты события п. 8.1 по ближайшему актуальному сеансу. */
export function dateFields(
  occurrences: readonly Occurrence[],
): Pick<AfishaEvent, 'date_start' | 'date_end' | 'duration_min' | 'time_precision'> {
  const primary = primaryOccurrenceOf(occurrences);
  if (!primary) return { date_start: null, date_end: null, duration_min: null, time_precision: 'minute' };
  const end = primary.end ?? null;
  const duration =
    primary.start.precision === 'minute' && end?.precision === 'minute' && primary.start.utc && end.utc
      ? Math.round((Date.parse(end.utc) - Date.parse(primary.start.utc)) / MS_MINUTE)
      : null;
  return {
    date_start: timestampOf(primary.start),
    date_end: end ? timestampOf(end) : null,
    duration_min: duration,
    time_precision: primary.start.precision,
  };
}

/** Подписи демо-источников: сведённые дубли видны в блоке «Источники», и все честно помечены как демо. */
const DEMO_SOURCE_TITLES: readonly { title: string; type: EventSource['source_type'] }[] = [
  { title: `${MOCK_SOURCE.name}: афиша площадки`, type: 'manual' },
  { title: `${MOCK_SOURCE.name}: страница организатора`, type: 'page' },
  { title: `${MOCK_SOURCE.name}: открытые данные`, type: 'api' },
  { title: `${MOCK_SOURCE.name}: лента новостей площадки`, type: 'rss' },
];

function demoSources(mock: MockEvent, verifiedAt: string): EventSource[] {
  const count = Math.max(1, mock.sources_count);
  return Array.from({ length: count }, (_, index) => {
    const entry = DEMO_SOURCE_TITLES[index % DEMO_SOURCE_TITLES.length];
    return {
      source_url: MOCK_SOURCE.url,
      source_type: entry.type,
      source_hash: sha256(`${mock.id}:${index}`),
      verified_at: verifiedAt,
      title: entry.title,
    };
  });
}

function buildEvent(mock: MockEvent, clock: Clock): AfishaEvent {
  const venue = VENUES.get(mock.venue_id);
  if (!venue) throw new Error(`Событие ${mock.id}: неизвестная площадка ${mock.venue_id}`);
  const offers = buildOffers(mock);
  const occurrences = buildOccurrences(mock, clock);
  const verifiedAt = isoUtc(clock.nowMs - mock.checked_hours_ago * MS_HOUR);
  const prices = priceFields(offers);
  const dates = dateFields(occurrences);
  const normalized = normalizeTitle(mock.title);
  const tags = [...(mock.tags ?? [])];
  if (prices.is_free && !tags.includes('бесплатно')) tags.push('бесплатно');
  const sources = demoSources(mock, verifiedAt);

  const event: AfishaEvent = {
    id: uuidFromCode(mock.id),
    title: mock.title,
    normalized_title: normalized,
    description: mock.description,
    category: mock.category,
    tags,
    language: mock.language ?? null,
    status: mock.status ?? 'published',
    kind: mock.kind,
    age_limit: ageLimitOf(mock.age_rating),
    age_rating: mock.age_rating,
    ...dates,
    ...prices,
    source_url: sources[0].source_url,
    source_type: sources[0].source_type,
    source_hash: sources[0].source_hash,
    verified_at: verifiedAt,
    confidence: mock.confidence ?? 0.95,
    dedup_key: dedupKey(normalized, dates.date_start?.slice(0, 10) ?? null, mock.venue_id),
    created_at: isoUtc(clock.nowMs - (mock.checked_hours_ago + 24 * 7) * MS_HOUR),
    updated_at: verifiedAt,
    sources,
    image: mock.image,
    popularity: mock.popularity,
    occurrences,
    venue,
    offers,
    price_summary: summarizePrice(offers),
    source: {
      name: sources[0].title ?? MOCK_SOURCE.name,
      url: sources[0].source_url,
      checked_at: verifiedAt,
      sources_count: sources.length,
    },
    synthetic: true,
  };
  if (mock.review) event.review = { disputed: true, reasons: [...mock.review.reasons] };
  if (mock.title_ba) event.title_ba = mock.title_ba;
  if (mock.organizer) event.organizer = mock.organizer;
  if (mock.has_ticket_link) event.ticket_url = MOCK_TICKET_URL;
  return event;
}

/** Загружает весь каталог с датами, вычисленными от переданного момента. */
export function loadCatalog(now: Date = new Date()): Catalog {
  const floored = floorToMinute(now);
  const clock: Clock = { today: localNow(floored).date, nowMs: floored.getTime() };
  return {
    events: MOCK_EVENTS.map((mock) => buildEvent(mock, clock)),
    today: clock.today,
    now: floored,
  };
}

export function loadEvents(now: Date = new Date()): AfishaEvent[] {
  return loadCatalog(now).events;
}

/** Код демо-записи → UUID. Старые ссылки вида evt_demo_t4 продолжают находить событие. */
const LEGACY_IDS: ReadonlyMap<string, string> = new Map(MOCK_EVENTS.map((mock) => [mock.id, uuidFromCode(mock.id)]));

/** UUID события по любому идентификатору: UUID как есть, старый код переводится. */
export function resolveEventId(id: string): string {
  return LEGACY_IDS.get(id) ?? id;
}

/** Событие по идентификатору (UUID или старый код) со всеми сеансами или null. */
export function findEvent(id: string, now: Date = new Date()): AfishaEvent | null {
  const uuid = resolveEventId(id);
  return loadCatalog(now).events.find((event) => event.id === uuid) ?? null;
}

export function countEvents(): number {
  return MOCK_EVENTS.length;
}

/** Идентификаторы всех событий: пригодится для generateStaticParams и карты сайта. */
export function listEventIds(): string[] {
  return MOCK_EVENTS.map((event) => uuidFromCode(event.id));
}
