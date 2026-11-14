import type { Database } from './adapter.js';
import { CITIES, SEED_VENUES } from '../domain/dictionaries.js';
import { dedupKey, normalizeTitle, sha256, uuidFromCode } from '../domain/identity.js';
import { addDays, formatRfc3339Local, localNow, localToMs, nextWeekday, TZ_OFFSET } from '../domain/time.js';
import type { EventStatus, SourceType } from '../domain/types.js';
import { SEED_EVENTS, type MockWeekday, type SeedEventSpec, type SeedSchedule } from './seed-data.js';

const WEEKDAY_INDEX: Record<MockWeekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const DEMO_SOURCE_TITLES: readonly { title: string; type: SourceType }[] = [
  { title: 'Демо-источник: афиша площадки', type: 'manual' },
  { title: 'Демо-источник: страница организатора', type: 'page' },
  { title: 'Демо-источник: открытые данные', type: 'api' },
  { title: 'Демо-источник: лента новостей площадки', type: 'rss' },
];

export interface SeedOptions {
  now?: Date;
  publicWebUrl?: string;
  forceReset?: boolean;
}

function resolveSchedule(spec: SeedSchedule, eventKind: string, today: string, nowMs: number, eventStatus: EventStatus) {
  const status = eventStatus === 'cancelled' ? 'cancelled' : (spec.status ?? 'scheduled');
  const statusVerified = status === 'unknown' ? false : (spec.status_is_verified ?? true);
  const availability = spec.availability ?? 'available';

  if (spec.kind === 'period') {
    const startYmd = addDays(today, spec.from_offset);
    const endYmd = addDays(today, spec.to_offset);
    return {
      date_start: `${startYmd}T00:00:00${TZ_OFFSET}`,
      date_end: `${endYmd}T00:00:00${TZ_OFFSET}`,
      time_precision: 'date' as const,
      duration_min: null as number | null,
      status,
      status_verified: statusVerified,
      previous_date_start: null as string | null,
      availability,
      is_future: endYmd >= today,
    };
  }

  let ymd: string;
  if (spec.kind === 'offset') {
    ymd = addDays(today, spec.day_offset);
  } else {
    ymd = nextWeekday(today, WEEKDAY_INDEX[spec.weekday]);
    const closesMs = localToMs(ymd, spec.time) + (eventKind === 'festival' && spec.duration_min ? spec.duration_min * 60_000 : 0);
    if (ymd === today && closesMs <= nowMs) {
      ymd = addDays(ymd, 7);
    }
    ymd = addDays(ymd, (spec.week ?? 0) * 7);
  }

  const startMs = localToMs(ymd, spec.time);
  const dateStart = `${ymd}T${spec.time}:00${TZ_OFFSET}`;
  const dateEnd = spec.duration_min ? formatRfc3339Local(startMs + spec.duration_min * 60_000) : null;
  const previousDateStart =
    spec.kind === 'offset' && spec.previous
      ? `${addDays(today, spec.previous.day_offset)}T${spec.previous.time}:00${TZ_OFFSET}`
      : null;

  const closesMs = startMs + (eventKind === 'festival' && spec.duration_min ? spec.duration_min * 60_000 : 0);
  return {
    date_start: dateStart,
    date_end: dateEnd,
    time_precision: 'minute' as const,
    duration_min: spec.duration_min ?? null,
    status,
    status_verified: statusVerified,
    previous_date_start: previousDateStart,
    availability,
    is_future: closesMs > nowMs,
  };
}

function summarizeSeedPrice(spec: SeedEventSpec) {
  if (spec.offers.length === 0) return { price_min: null, price_max: null, is_free: false };
  const general = spec.offers.filter((o) => !o.audience || o.audience === 'adult');
  const pool = general.length > 0 ? general : spec.offers;
  if (pool.every((o) => o.is_free === true)) return { price_min: 0, price_max: 0, is_free: true };
  const prices = pool.map((o) => o.rub).filter((p): p is number => p !== null);
  if (prices.length === 0) return { price_min: null, price_max: null, is_free: false };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === 0 && max === 0) return { price_min: 0, price_max: 0, is_free: true };
  return { price_min: min, price_max: max, is_free: false };
}

export async function seedDictionaries(db: Database): Promise<void> {
  for (let i = 0; i < CITIES.length; i += 1) {
    const c = CITIES[i];
    await db.query(
      `INSERT INTO cities (slug, name_ru, name_ba, name_in_ru, name_in_ba, lat, lon, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         name_ru = EXCLUDED.name_ru,
         name_ba = EXCLUDED.name_ba,
         name_in_ru = EXCLUDED.name_in_ru,
         name_in_ba = EXCLUDED.name_in_ba,
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         sort_order = EXCLUDED.sort_order`,
      [c.slug, c.name.ru, c.name.ba, c.name_in.ru, c.name_in.ba, c.lat, c.lon, i],
    );
  }

  for (const v of SEED_VENUES) {
    await db.query(
      `INSERT INTO venues (id, legacy_id, city_slug, name, address, lat, lon)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         legacy_id = EXCLUDED.legacy_id,
         city_slug = EXCLUDED.city_slug,
         name = EXCLUDED.name,
         address = EXCLUDED.address,
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon`,
      [v.id, v.legacy_id, v.city, v.name, v.address, v.lat ?? null, v.lon ?? null],
    );
  }
}

export async function seedDatabase(db: Database, options: SeedOptions = {}): Promise<{ seeded: boolean; eventsCount: number }> {
  await seedDictionaries(db);

  if (!options.forceReset) {
    const existing = await db.query<{ count: string | number }>('SELECT COUNT(*) AS count FROM events');
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      return { seeded: false, eventsCount: Number(existing.rows[0].count) };
    }
  } else {
    await db.exec('DELETE FROM events; DELETE FROM raw_records; DELETE FROM imports;');
  }

  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const { date: today } = localNow(now);
  const demoUrl = `${(options.publicWebUrl ?? 'http://localhost:3210').replace(/\/+$/, '')}/about#demo`;
  const cityBySlug = new Map(CITIES.map((c) => [c.slug, c]));
  const venueById = new Map(SEED_VENUES.map((v) => [v.id, v]));

  await db.transaction(async (tx) => {
    for (const spec of SEED_EVENTS) {
      const venue = venueById.get(spec.venue_id);
      if (!venue) throw new Error(`Seed error: unknown venue ${spec.venue_id}`);
      const city = cityBySlug.get(venue.city);
      if (!city) throw new Error(`Seed error: unknown city ${venue.city}`);

      const eventId = uuidFromCode(spec.id);
      const eventStatus: EventStatus = spec.status ?? 'published';
      const normalized = normalizeTitle(spec.title);
      const verifiedAt = formatRfc3339Local(nowMs - spec.checked_hours_ago * 3_600_000);
      const createdAt = formatRfc3339Local(nowMs - (spec.checked_hours_ago + 24 * 7) * 3_600_000);
      const { price_min, price_max, is_free } = summarizeSeedPrice(spec);

      const tags = [...(spec.tags ?? [])];
      if (is_free && !tags.includes('бесплатно')) tags.push('бесплатно');

      const seenStart = new Set<string>();
      const occurrences = spec.schedule
        .map((s, idx) => ({ resolved: resolveSchedule(s, spec.kind, today, nowMs, eventStatus), idx }))
        .filter(({ resolved }) => {
          if (seenStart.has(resolved.date_start)) return false;
          seenStart.add(resolved.date_start);
          return true;
        })
        .sort((a, b) => a.resolved.date_start.localeCompare(b.resolved.date_start));

      const primary =
        occurrences.find((o) => o.resolved.is_future && o.resolved.status !== 'cancelled')?.resolved ??
        occurrences.find((o) => o.resolved.is_future)?.resolved ??
        occurrences[occurrences.length - 1]?.resolved ??
        null;

      const dateStart = primary?.date_start ?? null;
      const dateEnd = primary?.date_end ?? null;
      const timePrecision = primary?.time_precision ?? 'minute';
      const durationMin = primary?.duration_min ?? null;
      const dedup = dedupKey(normalized, dateStart?.slice(0, 10) ?? null, venue.id);
      const sourceCount = Math.max(1, spec.sources_count);
      const primarySourceMeta = DEMO_SOURCE_TITLES[0];
      const primaryHash = sha256(`${spec.id}:0`);

      await tx.query(
        `INSERT INTO events (
          id, legacy_code, title, normalized_title, title_ba, description, category, tags,
          date_start, date_end, duration_min, time_precision,
          city_id, city, venue_id, venue, address, lat, lon,
          price_min, price_max, is_free, age_limit, language, org_link,
          source_url, source_type, source_hash, verified_at, confidence, status, dedup_key,
          kind, popularity, organizer, image, synthetic, disputed, review_reasons,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
          $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25,
          $26, $27, $28, $29, $30, $31, $32,
          $33, $34, $35, $36, $37, $38, $39::jsonb,
          $40, $41
        )`,
        [
          eventId,
          spec.id,
          spec.title,
          normalized,
          spec.title_ba ?? null,
          spec.description,
          spec.category,
          JSON.stringify(tags),
          dateStart,
          dateEnd,
          durationMin,
          timePrecision,
          city.slug,
          city.name.ru,
          venue.id,
          venue.name,
          venue.address,
          venue.lat ?? null,
          venue.lon ?? null,
          price_min,
          price_max,
          is_free,
          spec.age_limit,
          spec.language ?? null,
          spec.has_ticket_link ? demoUrl : null,
          demoUrl,
          primarySourceMeta.type,
          primaryHash,
          verifiedAt,
          spec.confidence ?? 0.95,
          eventStatus,
          dedup,
          spec.kind,
          spec.popularity,
          spec.organizer ?? null,
          spec.image,
          true,
          Boolean(spec.review),
          JSON.stringify(spec.review?.reasons ?? []),
          createdAt,
          verifiedAt,
        ],
      );

      for (let i = 0; i < occurrences.length; i += 1) {
        const occ = occurrences[i].resolved;
        const occId = `${spec.id.replace('evt_', 'occ_')}_${i + 1}`;
        await tx.query(
          `INSERT INTO event_occurrences (
            id, event_id, venue_id, date_start, date_end, time_precision,
            status, status_verified, previous_date_start, availability, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            occId,
            eventId,
            venue.id,
            occ.date_start,
            occ.date_end,
            occ.time_precision,
            occ.status,
            occ.status_verified,
            occ.previous_date_start,
            occ.availability,
            i,
          ],
        );
      }

      for (let i = 0; i < spec.offers.length; i += 1) {
        const off = spec.offers[i];
        const offId = `${spec.id.replace('evt_', 'off_')}_${i + 1}`;
        const offerIsFree = off.is_free === true;
        await tx.query(
          `INSERT INTO event_offers (id, event_id, name, price, audience, is_free, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [offId, eventId, off.name ?? null, offerIsFree ? 0 : off.rub, off.audience ?? null, offerIsFree, i],
        );
      }

      for (let i = 0; i < sourceCount; i += 1) {
        const entry = DEMO_SOURCE_TITLES[i % DEMO_SOURCE_TITLES.length];
        const sHash = sha256(`${spec.id}:${i}`);
        await tx.query(
          `INSERT INTO event_sources (event_id, source_url, source_type, source_hash, verified_at, title, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [eventId, demoUrl, entry.type, sHash, verifiedAt, entry.title, i === 0],
        );
      }

      await tx.query(
        `INSERT INTO raw_records (id, event_id, source_url, source_type, source_hash, raw_payload, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          uuidFromCode(`raw_${spec.id}`),
          eventId,
          demoUrl,
          primarySourceMeta.type,
          primaryHash,
          JSON.stringify(spec),
          verifiedAt,
        ],
      );
    }
  });

  return { seeded: true, eventsCount: SEED_EVENTS.length };
}
