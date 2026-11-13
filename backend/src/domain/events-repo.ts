import type { QueryExecutor } from '../db/adapter.js';
import { UUID_PATTERN, computeEtagFallback } from './repo-utils.js';
import { formatRfc3339Local, localNow, localToMs } from './time.js';
import type {
  AdminEvent,
  ApiEvent,
  ApiEventSource,
  ApiOccurrence,
  ApiOffer,
  Availability,
  CategoryId,
  CityId,
  EventKind,
  EventStatus,
  OccurrenceStatus,
  OfferAudience,
  SourceType,
  TimePrecision,
} from './types.js';

interface EventRow {
  id: string;
  legacy_code: string | null;
  title: string;
  normalized_title: string;
  title_ba: string | null;
  description: string;
  category: CategoryId;
  tags: string[] | string;
  date_start: string | null;
  date_end: string | null;
  duration_min: number | null;
  time_precision: TimePrecision;
  city_id: CityId;
  city: string;
  venue_id: string;
  venue: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  age_limit: 0 | 6 | 12 | 16 | 18 | null;
  language: string | null;
  org_link: string | null;
  source_url: string;
  source_type: SourceType;
  source_hash: string;
  verified_at: string | null;
  confidence: number;
  status: EventStatus;
  dedup_key: string;
  kind: EventKind;
  popularity: number;
  organizer: string | null;
  image: string | null;
  synthetic: boolean;
  disputed: boolean;
  review_reasons: string[] | string;
  merged_into: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OccurrenceRow {
  id: string;
  event_id: string;
  venue_id: string;
  date_start: string;
  date_end: string | null;
  time_precision: TimePrecision;
  status: OccurrenceStatus;
  status_verified: boolean;
  previous_date_start: string | null;
  availability: Availability;
  sort_order: number;
}

interface OfferRow {
  id: string;
  event_id: string;
  name: string | null;
  price: number | null;
  audience: OfferAudience | null;
  is_free: boolean;
  sort_order: number;
}

interface SourceRow {
  event_id: string;
  source_url: string;
  source_type: SourceType;
  source_hash: string;
  verified_at: string | null;
  title: string | null;
  is_primary: boolean;
}

function parseJsonArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toIsoLocal(val: Date | string): string {
  if (val instanceof Date) return formatRfc3339Local(val);
  const parsed = Date.parse(val);
  if (!Number.isNaN(parsed)) return formatRfc3339Local(parsed);
  return val;
}

function computeIsPast(occ: OccurrenceRow, kind: EventKind, now: Date): boolean {
  const { date: today } = localNow(now);
  if (occ.time_precision === 'date') {
    const endYmd = (occ.date_end ?? occ.date_start).slice(0, 10);
    return endYmd < today;
  }
  const targetIso = kind === 'festival' && occ.date_end ? occ.date_end : occ.date_start;
  const targetMs = Date.parse(targetIso);
  if (!Number.isNaN(targetMs)) {
    return targetMs <= now.getTime();
  }
  return localToMs(occ.date_start.slice(0, 10), occ.date_start.slice(11, 16) || '00:00') <= now.getTime();
}

function hydrateEvents(
  rows: EventRow[],
  occRows: OccurrenceRow[],
  offerRows: OfferRow[],
  sourceRows: SourceRow[],
  now: Date,
): { events: ApiEvent[]; mergedIntoMap: Map<string, string | null> } {
  const occsByEvent = new Map<string, OccurrenceRow[]>();
  for (const r of occRows) {
    const arr = occsByEvent.get(r.event_id) ?? [];
    arr.push(r);
    occsByEvent.set(r.event_id, arr);
  }

  const offersByEvent = new Map<string, OfferRow[]>();
  for (const r of offerRows) {
    const arr = offersByEvent.get(r.event_id) ?? [];
    arr.push(r);
    offersByEvent.set(r.event_id, arr);
  }

  const sourcesByEvent = new Map<string, SourceRow[]>();
  for (const r of sourceRows) {
    const arr = sourcesByEvent.get(r.event_id) ?? [];
    arr.push(r);
    sourcesByEvent.set(r.event_id, arr);
  }

  const mergedIntoMap = new Map<string, string | null>();
  const events: ApiEvent[] = rows.map((row) => {
    mergedIntoMap.set(row.id, row.merged_into);

    const rawOccs = occsByEvent.get(row.id) ?? [];
    const occurrences: ApiOccurrence[] = rawOccs.map((occ) => {
      const effectiveStatus: OccurrenceStatus = row.status === 'cancelled' ? 'cancelled' : occ.status;
      const effectiveVerified = row.status === 'cancelled' ? true : occ.status_verified;
      const out: ApiOccurrence = {
        id: occ.id,
        date_start: occ.date_start,
        date_end: occ.date_end,
        time_precision: occ.time_precision,
        status: effectiveStatus,
        status_verified: effectiveVerified,
        availability: occ.availability,
        is_past: computeIsPast(occ, row.kind, now),
      };
      if (occ.previous_date_start) out.previous_date_start = occ.previous_date_start;
      return out;
    });

    const rawOffers = offersByEvent.get(row.id) ?? [];
    const offers: ApiOffer[] = rawOffers.map((off) => {
      const out: ApiOffer = {
        price: off.price === null ? null : Number(off.price),
        is_free: off.is_free,
      };
      if (off.name) out.name = off.name;
      if (off.audience) out.audience = off.audience;
      return out;
    });

    const rawSources = sourcesByEvent.get(row.id) ?? [];
    const sources: ApiEventSource[] =
      rawSources.length > 0
        ? rawSources.map((s) => {
            const out: ApiEventSource = {
              source_url: s.source_url,
              source_type: s.source_type,
              source_hash: s.source_hash,
              verified_at: s.verified_at,
            };
            if (s.title) out.title = s.title;
            return out;
          })
        : [
            {
              source_url: row.source_url,
              source_type: row.source_type,
              source_hash: row.source_hash,
              verified_at: row.verified_at,
            },
          ];

    const tags = [...new Set(parseJsonArray<string>(row.tags).filter((t) => typeof t === 'string' && t.length > 0))];
    const reasons = parseJsonArray<string>(row.review_reasons);

    const ev: ApiEvent = {
      id: row.id,
      title: row.title,
      normalized_title: row.normalized_title,
      category: row.category,
      tags,
      date_start: row.date_start,
      date_end: row.date_end,
      duration_min: row.duration_min === null ? null : Number(row.duration_min),
      city: row.city,
      venue: row.venue,
      address: row.address,
      lat: row.lat === null ? null : Number(row.lat),
      lon: row.lon === null ? null : Number(row.lon),
      description: row.description,
      price_min: row.price_min === null ? null : Number(row.price_min),
      price_max: row.price_max === null ? null : Number(row.price_max),
      is_free: row.is_free,
      age_limit: row.age_limit === null ? null : (Number(row.age_limit) as 0 | 6 | 12 | 16 | 18),
      language: row.language,
      org_link: row.org_link,
      source_url: row.source_url,
      source_type: row.source_type,
      source_hash: row.source_hash,
      verified_at: row.verified_at,
      confidence: Number(row.confidence),
      status: row.status,
      dedup_key: row.dedup_key,
      created_at: toIsoLocal(row.created_at),
      updated_at: toIsoLocal(row.updated_at),
      city_id: row.city_id,
      venue_id: row.venue_id,
      time_precision: row.time_precision,
      kind: row.kind,
      popularity: Number(row.popularity),
      organizer: row.organizer,
      image: row.image,
      synthetic: row.synthetic,
      sources,
      occurrences,
      offers,
    };

    if (row.title_ba !== null) ev.title_ba = row.title_ba;
    if (row.disputed || reasons.length > 0) {
      ev.review = { disputed: row.disputed, reasons };
    }
    return ev;
  });

  return { events, mergedIntoMap };
}

export async function loadAllEvents(
  db: QueryExecutor,
  options: { statuses?: EventStatus[]; now?: Date } = {},
): Promise<{ events: ApiEvent[]; mergedIntoMap: Map<string, string | null> }> {
  const now = options.now ?? new Date();
  let where = '';
  const params: unknown[] = [];
  if (options.statuses && options.statuses.length > 0) {
    where = 'WHERE status = ANY($1::text[])';
    params.push(options.statuses);
  }

  const eventsRes = await db.query<EventRow>(`SELECT * FROM events ${where} ORDER BY date_start ASC NULLS LAST, id ASC`, params);
  if (eventsRes.rows.length === 0) {
    return { events: [], mergedIntoMap: new Map() };
  }

  const ids = eventsRes.rows.map((r) => r.id);
  const [occRes, offerRes, srcRes] = await Promise.all([
    db.query<OccurrenceRow>(
      'SELECT * FROM event_occurrences WHERE event_id = ANY($1::uuid[]) ORDER BY sort_order ASC, date_start ASC',
      [ids],
    ),
    db.query<OfferRow>(
      'SELECT * FROM event_offers WHERE event_id = ANY($1::uuid[]) ORDER BY sort_order ASC, id ASC',
      [ids],
    ),
    db.query<SourceRow>(
      'SELECT * FROM event_sources WHERE event_id = ANY($1::uuid[]) ORDER BY is_primary DESC, id ASC',
      [ids],
    ),
  ]);

  return hydrateEvents(eventsRes.rows, occRes.rows, offerRes.rows, srcRes.rows, now);
}

export async function findEventByIdOrCode(
  db: QueryExecutor,
  idOrCode: string,
  options: { includeDrafts?: boolean; now?: Date } = {},
): Promise<{ event: AdminEvent | null; invalidId: boolean }> {
  const now = options.now ?? new Date();
  const isUuid = UUID_PATTERN.test(idOrCode);
  const isLegacy = /^[a-z0-9_-]{1,64}$/i.test(idOrCode);
  if (!isUuid && !isLegacy) {
    return { event: null, invalidId: true };
  }

  const res = isUuid
    ? await db.query<EventRow>('SELECT * FROM events WHERE id = $1', [idOrCode.toLowerCase()])
    : await db.query<EventRow>('SELECT * FROM events WHERE legacy_code = $1', [idOrCode]);

  if (res.rows.length === 0) return { event: null, invalidId: false };
  const row = res.rows[0];
  if (row.status === 'draft' && !options.includeDrafts) {
    return { event: null, invalidId: false };
  }

  const [occRes, offerRes, srcRes] = await Promise.all([
    db.query<OccurrenceRow>(
      'SELECT * FROM event_occurrences WHERE event_id = $1 ORDER BY sort_order ASC, date_start ASC',
      [row.id],
    ),
    db.query<OfferRow>('SELECT * FROM event_offers WHERE event_id = $1 ORDER BY sort_order ASC, id ASC', [row.id]),
    db.query<SourceRow>('SELECT * FROM event_sources WHERE event_id = $1 ORDER BY is_primary DESC, id ASC', [row.id]),
  ]);

  const { events, mergedIntoMap } = hydrateEvents([row], occRes.rows, offerRes.rows, srcRes.rows, now);
  const ev = events[0];
  const etag = computeEtagFallback(ev);
  const adminEv: AdminEvent = { ...ev, etag };
  const merged = mergedIntoMap.get(ev.id);
  if (merged) adminEv.merged_into = merged;
  return { event: adminEv, invalidId: false };
}
