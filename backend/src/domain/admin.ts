import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import type { Database } from '../db/adapter.js';
import { seedDatabase } from '../db/seed.js';
import { CITIES, findCity, isCitySlug } from './dictionaries.js';
import { findEventByIdOrCode, loadAllEvents } from './events-repo.js';
import { etagMatches } from './http-helpers.js';
import {
  UUID_PATTERN,
  dedupKey,
  normalizeText,
  normalizeTitle,
  toVenueSlug,
} from './identity.js';
import { cleanupExpiredFeedback, KIND_LABEL, type FeedbackKind } from './feedback.js';
import { normalizeLanguage, parseDateField } from './imports.js';
import { TZ_OFFSET, formatRfc3339Local } from './time.js';
import type {
  AdminEvent,
  AgeLimit,
  ApiErrorDetail,
  ApiEvent,
  CategoryId,
  CityId,
  EventKind,
  EventStatus,
  TimePrecision,
} from './types.js';

export type AdminAuthResult =
  | { ok: true; actor: string }
  | { ok: false; status: 401; code: string; message: string };

function safeEquals(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

function sanitizeActor(raw: string | undefined): string | null {
  if (!raw) return null;
  let decoded = raw.trim();
  try {
    if (decoded.includes('%')) decoded = decodeURIComponent(decoded).trim();
  } catch {
    // Оставляем исходное значение, если percent-encoding некорректен
  }
  const normalized = decoded.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length < 2 || normalized.length > 64) return null;
  return /^[\p{L}\p{N}:._\- ]+$/u.test(normalized) ? normalized : null;
}

export function checkAdminAuth(
  headers: { authorization?: string; xActor?: string },
  config: AppConfig,
): AdminAuthResult {
  const auth = headers.authorization?.trim();
  const actorHint = sanitizeActor(headers.xActor);

  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    const token = match?.[1]?.trim() ?? '';
    if (!config.adminToken || !token || !safeEquals(token, config.adminToken)) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'Неверный токен администратора',
      };
    }
    return { ok: true, actor: actorHint ?? 'moderator:token' };
  }

  if (config.adminOpen) {
    return { ok: true, actor: actorHint ?? 'moderator:demo' };
  }

  return {
    ok: false,
    status: 401,
    code: 'unauthorized',
    message: 'Требуется заголовок Authorization: Bearer <ADMIN_TOKEN>',
  };
}

export interface AdminEventsQuery {
  status?: EventStatus;
  disputed?: boolean;
  source?: 'demo' | 'import';
  q?: string;
  page?: number;
  page_size?: number;
}

export async function listAdminEvents(
  db: Database,
  query: AdminEventsQuery,
  now: Date = new Date(),
) {
  const metaRes = await db.query<{
    id: string;
    merged_into: string | null;
    import_id: string | null;
  }>('SELECT id, merged_into, import_id FROM events');

  const mergedIds = new Set<string>();
  const importIdMap = new Map<string, string | null>();
  for (const r of metaRes.rows) {
    if (r.merged_into) mergedIds.add(r.id);
    importIdMap.set(r.id, r.import_id);
  }

  const { events } = await loadAllEvents(db, { now });
  const active = events.filter((ev) => !mergedIds.has(ev.id));

  const counts = {
    all: active.length,
    published: active.filter((e) => e.status === 'published').length,
    draft: active.filter((e) => e.status === 'draft').length,
    cancelled: active.filter((e) => e.status === 'cancelled').length,
    disputed: active.filter((e) => Boolean(e.review?.disputed)).length,
  };

  let filtered = active;
  if (query.status) {
    filtered = filtered.filter((e) => e.status === query.status);
  }
  if (query.disputed !== undefined) {
    filtered = filtered.filter((e) => Boolean(e.review?.disputed) === query.disputed);
  }
  if (query.source === 'demo') {
    filtered = filtered.filter((e) => e.synthetic && !importIdMap.get(e.id));
  } else if (query.source === 'import') {
    filtered = filtered.filter((e) => Boolean(importIdMap.get(e.id)) || e.source_type === 'import');
  }
  if (query.q) {
    const qNorm = normalizeText(query.q);
    filtered = filtered.filter((e) =>
      normalizeText(`${e.title} ${e.venue} ${e.city} ${e.description}`).includes(qNorm),
    );
  }

  const pageSize = Math.min(Math.max(1, query.page_size ?? 25), 100);
  const total = filtered.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, query.page ?? 1), Math.max(1, totalPages));
  const offset = (page - 1) * pageSize;

  const pageItems: AdminEvent[] = filtered.slice(offset, offset + pageSize).map((ev) => ({
    ...ev,
    etag: computeEventEtag(ev),
  }));

  return {
    items: pageItems,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    counts,
  };
}

function computeEventEtag(ev: ApiEvent): string {
  return `W/"${createHash('sha1').update(JSON.stringify(ev)).digest('base64url').slice(0, 27)}"`;
}

const IMMUTABLE_FIELDS = new Set(['id', 'source_hash', 'created_at', 'updated_at']);

const EventPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    title_ba: z.string().trim().max(200).nullable().optional(),
    category: z.enum(['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other']).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    date_start: z.string().min(10).nullable().optional(),
    date_end: z.string().min(10).nullable().optional(),
    duration_min: z.number().int().min(1).max(14400).nullable().optional(),
    time_precision: z.enum(['minute', 'date']).optional(),
    city: z.string().trim().min(1).optional(),
    city_id: z.string().trim().min(1).optional(),
    venue: z.string().trim().min(1).max(200).optional(),
    venue_id: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lon: z.number().min(-180).max(180).nullable().optional(),
    description: z.string().max(10000).optional(),
    price_min: z.number().int().min(0).max(1_000_000).nullable().optional(),
    price_max: z.number().int().min(0).max(1_000_000).nullable().optional(),
    is_free: z.boolean().optional(),
    age_limit: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(16), z.literal(18), z.null()]).optional(),
    language: z.string().regex(/^[a-z]{2,3}$/).nullable().optional(),
    org_link: z.string().url().nullable().optional(),
    source_url: z.string().url().optional(),
    status: z.enum(['published', 'draft', 'cancelled']).optional(),
    organizer: z.string().trim().max(200).nullable().optional(),
    kind: z.enum(['standalone', 'performance_run', 'exhibition', 'festival']).optional(),
    image: z.string().max(1000).nullable().optional(),
    review: z
      .object({
        disputed: z.boolean().optional(),
        reasons: z.array(z.string()).optional(),
      })
      .optional(),
    expected_updated_at: z.string().trim().min(10).optional(),
  })
  .strict();

function isValidRfc3339(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

function coercePatchInt(val: unknown): unknown {
  if (val === undefined || val === null || typeof val === 'number') return val;
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/\s+/g, '').replace(/(₽|руб\.?|р\.?|\+)$/i, '');
  if (!/^-?\d+$/.test(cleaned)) return val;
  return Number.parseInt(cleaned, 10);
}

function coercePatchFloat(val: unknown): unknown {
  if (val === undefined || val === null || typeof val === 'number') return val;
  if (typeof val !== 'string') return val;
  const trimmed = val.trim().replace(',', '.');
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : val;
}

function coercePatchDate(val: unknown): unknown {
  if (val === undefined || val === null || typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (isValidRfc3339(trimmed)) return trimmed;
  const parsed = parseDateField(trimmed, '');
  if (!parsed) return val;
  return `${parsed.ymd}T${parsed.hm ?? '00:00'}:00${TZ_OFFSET}`;
}

function normalizePatchPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const field of ['price_min', 'price_max', 'age_limit', 'duration_min'] as const) {
    if (field in out) out[field] = coercePatchInt(out[field]);
  }
  for (const field of ['lat', 'lon'] as const) {
    if (field in out) out[field] = coercePatchFloat(out[field]);
  }
  for (const field of ['date_start', 'date_end'] as const) {
    if (field in out) out[field] = coercePatchDate(out[field]);
  }
  if ('language' in out) {
    if (typeof out.language === 'string' && out.language.trim() === '') {
      out.language = null;
    } else if (out.language !== null && out.language !== undefined) {
      const normalized = normalizeLanguage(out.language);
      if (normalized) out.language = normalized;
    }
  }
  for (const field of ['title_ba', 'address', 'org_link', 'organizer', 'image'] as const) {
    if (typeof out[field] === 'string' && (out[field] as string).trim() === '') {
      out[field] = null;
    }
  }
  return out;
}

export async function patchAdminEvent(
  db: Database,
  idOrCode: string,
  rawBody: unknown,
  ifMatchHeader: string | null | undefined,
  actor: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; event: AdminEvent; changes: { field: string; from: unknown; to: unknown }[] }
  | { ok: false; status: 400 | 404 | 409 | 412; code: string; message: string; details?: ApiErrorDetail[] }
> {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Тело правки должно быть JSON-объектом',
      details: [{ field: 'body', message: 'Ожидается объект с изменяемыми полями' }],
    };
  }

  const keys = Object.keys(rawBody as Record<string, unknown>);
  const mutableKeys = keys.filter((k) => k !== 'expected_updated_at');
  if (mutableKeys.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Передайте хотя бы одно поле для изменения',
      details: [{ field: 'body', message: 'Пустой объект правки' }],
    };
  }

  for (const key of keys) {
    if (IMMUTABLE_FIELDS.has(key)) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: `Поле «${key}» нельзя изменять вручную`,
        details: [{ field: key, message: 'Поле защищено от изменения' }],
      };
    }
  }

  const normalizedBody = normalizePatchPayload(rawBody as Record<string, unknown>);
  const parsed = EventPatchSchema.safeParse(normalizedBody);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Проверьте корректность изменённых полей',
      details: parsed.error.issues.map((i) => ({
        field: i.path.join('.') || 'body',
        message: i.message,
      })),
    };
  }

  const found = await findEventByIdOrCode(db, idOrCode, { includeDrafts: true, now });
  if (found.invalidId || !found.event) {
    return {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Событие не найдено',
    };
  }

  const current = found.event;
  const patch = parsed.data;
  if (!ifMatchHeader && !patch.expected_updated_at) {
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message: 'Передайте заголовок If-Match (ETag) или expected_updated_at для защиты от конфликта правок.',
    };
  }
  if (ifMatchHeader && !etagMatches(ifMatchHeader, current.etag)) {
    return {
      ok: false,
      status: 412,
      code: 'precondition_failed',
      message: 'Карточка была изменена другим пользователем. Обновите страницу и повторите правку.',
    };
  }
  if (patch.expected_updated_at && patch.expected_updated_at !== current.updated_at) {
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message: 'Карточка была изменена другим пользователем. Обновите страницу и повторите правку.',
    };
  }

  const details: ApiErrorDetail[] = [];

  if (patch.date_start !== undefined && patch.date_start !== null && !isValidRfc3339(patch.date_start)) {
    details.push({ field: 'date_start', message: 'Ожидается дата-время RFC 3339 (+05:00)' });
  }
  if (patch.date_end !== undefined && patch.date_end !== null && !isValidRfc3339(patch.date_end)) {
    details.push({ field: 'date_end', message: 'Ожидается дата-время RFC 3339 (+05:00)' });
  }

  let nextCityId: CityId = current.city_id;
  let nextCityName: string = current.city;
  if (patch.city_id !== undefined) {
    if (!isCitySlug(patch.city_id)) {
      details.push({ field: 'city_id', message: `Неизвестный код города «${patch.city_id}»` });
    } else {
      nextCityId = patch.city_id;
      nextCityName = CITIES.find((c) => c.slug === nextCityId)?.name.ru ?? current.city;
    }
  } else if (patch.city !== undefined) {
    const matchedCity = findCity(patch.city);
    if (matchedCity) {
      nextCityId = matchedCity.slug;
      nextCityName = matchedCity.name.ru;
    } else {
      nextCityName = patch.city;
    }
  }

  let nextPriceMin: number | null = patch.price_min !== undefined ? patch.price_min : current.price_min;
  let nextPriceMax: number | null = patch.price_max !== undefined ? patch.price_max : current.price_max;
  let nextIsFree: boolean = patch.is_free !== undefined ? patch.is_free : current.is_free;

  if (patch.is_free === true) {
    if (patch.price_min !== undefined && patch.price_min !== null && patch.price_min > 0) {
      details.push({ field: 'is_free', message: 'Для бесплатного события price_min должен быть 0' });
    }
    nextPriceMin = 0;
    nextPriceMax = 0;
    nextIsFree = true;
  } else if (patch.price_min !== undefined) {
    if (patch.price_min === null) {
      nextPriceMax = null;
      nextIsFree = false;
    } else {
      if (nextPriceMax === null || nextPriceMax < patch.price_min) {
        nextPriceMax = patch.price_min;
      }
      if (patch.is_free === false && patch.price_min === 0 && nextPriceMax === 0) {
        details.push({ field: 'is_free', message: 'При нулевой цене is_free должен быть true' });
      }
      nextIsFree = patch.price_min === 0 && nextPriceMax === 0;
    }
  } else if (patch.price_max !== undefined && nextPriceMin !== null && patch.price_max !== null && patch.price_max < nextPriceMin) {
    details.push({ field: 'price_max', message: 'price_max не может быть меньше price_min' });
  }

  if (details.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Ошибки проверки полей правки',
      details,
    };
  }

  const nextTitle = patch.title ?? current.title;
  const nextNormTitle = normalizeTitle(nextTitle);
  const nextDateStart = patch.date_start !== undefined ? patch.date_start : current.date_start;
  const nextDateEnd = patch.date_end !== undefined ? patch.date_end : current.date_end;
  const nextVenue = patch.venue ?? current.venue;
  const nextVenueId = patch.venue_id ? toVenueSlug(patch.venue_id) : current.venue_id;
  const nextStatus: EventStatus = patch.status ?? current.status;
  const nextTimePrecision: TimePrecision =
    patch.time_precision ??
    (nextDateStart && nextDateStart.includes('T00:00:00') ? current.time_precision : 'minute');

  const nextDisputed = patch.review?.disputed ?? current.review?.disputed ?? false;
  const nextReasons = patch.review?.reasons ?? current.review?.reasons ?? [];
  const nextDedup = dedupKey(nextNormTitle, nextDateStart ? nextDateStart.slice(0, 10) : null, nextVenueId);
  const nowIso = formatRfc3339Local(now);

  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const track = (field: string, fromVal: unknown, toVal: unknown) => {
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      changes.push({ field, from: fromVal, to: toVal });
    }
  };

  track('title', current.title, nextTitle);
  track('category', current.category, patch.category ?? current.category);
  track('status', current.status, nextStatus);
  track('price_min', current.price_min, nextPriceMin);
  track('price_max', current.price_max, nextPriceMax);
  track('is_free', current.is_free, nextIsFree);
  track('age_limit', current.age_limit, patch.age_limit !== undefined ? patch.age_limit : current.age_limit);
  track('description', current.description, patch.description ?? current.description);
  track('date_start', current.date_start, nextDateStart);
  track('date_end', current.date_end, nextDateEnd);
  track('address', current.address, patch.address !== undefined ? patch.address : current.address);
  track('org_link', current.org_link, patch.org_link !== undefined ? patch.org_link : current.org_link);
  track('language', current.language, patch.language !== undefined ? patch.language : current.language);
  track('city_id', current.city_id, nextCityId);
  track('venue', current.venue, nextVenue);

  await db.transaction(async (tx) => {
    if (patch.venue_id || patch.venue) {
      await tx.query(
        `INSERT INTO venues (id, city_slug, name, address, lat, lon)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          nextVenueId,
          nextCityId,
          nextVenue,
          patch.address !== undefined ? patch.address : current.address,
          patch.lat !== undefined ? patch.lat : current.lat,
          patch.lon !== undefined ? patch.lon : current.lon,
        ],
      );
    }

    await tx.query(
      `UPDATE events SET
         title = $2,
         normalized_title = $3,
         title_ba = $4,
         description = $5,
         category = $6,
         tags = $7::jsonb,
         date_start = $8,
         date_end = $9,
         duration_min = $10,
         time_precision = $11,
         city_id = $12,
         city = $13,
         venue_id = $14,
         venue = $15,
         address = $16,
         lat = $17,
         lon = $18,
         price_min = $19,
         price_max = $20,
         is_free = $21,
         age_limit = $22,
         language = $23,
         org_link = $24,
         source_url = $25,
         status = $26,
         dedup_key = $27,
         kind = $28,
         organizer = $29,
         image = $30,
         disputed = $31,
         review_reasons = $32::jsonb,
         updated_at = $33
       WHERE id = $1`,
      [
        current.id,
        nextTitle,
        nextNormTitle,
        patch.title_ba !== undefined ? patch.title_ba : (current.title_ba ?? null),
        patch.description ?? current.description,
        (patch.category ?? current.category) as CategoryId,
        JSON.stringify(patch.tags ?? current.tags),
        nextDateStart,
        nextDateEnd,
        patch.duration_min !== undefined ? patch.duration_min : current.duration_min,
        nextTimePrecision,
        nextCityId,
        nextCityName,
        nextVenueId,
        nextVenue,
        patch.address !== undefined ? patch.address : current.address,
        patch.lat !== undefined ? patch.lat : current.lat,
        patch.lon !== undefined ? patch.lon : current.lon,
        nextPriceMin,
        nextPriceMax,
        nextIsFree,
        (patch.age_limit !== undefined ? patch.age_limit : current.age_limit) as AgeLimit | null,
        patch.language !== undefined ? patch.language : current.language,
        patch.org_link !== undefined ? patch.org_link : current.org_link,
        patch.source_url ?? current.source_url,
        nextStatus,
        nextDedup,
        (patch.kind ?? current.kind) as EventKind,
        patch.organizer !== undefined ? patch.organizer : current.organizer,
        patch.image !== undefined ? patch.image : current.image,
        nextDisputed,
        JSON.stringify(nextReasons),
        nowIso,
      ],
    );

    if (patch.date_start !== undefined && nextDateStart) {
      await tx.query(
        `UPDATE event_occurrences SET date_start = $2, date_end = $3, time_precision = $4
         WHERE event_id = $1 AND sort_order = 0`,
        [current.id, nextDateStart, nextDateEnd, nextTimePrecision],
      );
    }

    if (patch.status !== undefined) {
      await tx.query(
        `UPDATE event_occurrences SET status = $2 WHERE event_id = $1`,
        [current.id, nextStatus === 'cancelled' ? 'cancelled' : 'scheduled'],
      );
    }

    if (changes.length > 0) {
      await tx.query(
        `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes)
         VALUES ($1, $2, $3, $4, 'event', $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          nowIso,
          actor,
          patch.status !== undefined && changes.length === 1 ? 'status' : 'update',
          current.id,
          nextTitle,
          JSON.stringify(changes),
        ],
      );
    }
  });

  const refreshed = await findEventByIdOrCode(db, current.id, { includeDrafts: true, now });
  return {
    ok: true,
    event: refreshed.event!,
    changes,
  };
}

function toWireEvent(ev: AdminEvent | ApiEvent): ApiEvent {
  const copy = { ...ev } as Record<string, unknown>;
  delete copy.etag;
  delete copy.merged_into;
  return copy as unknown as ApiEvent;
}

export async function listModerationQueue(
  db: Database,
  options: { page?: number; page_size?: number },
  now: Date = new Date(),
) {
  const mergedRes = await db.query<{ id: string }>(
    'SELECT id FROM events WHERE merged_into IS NOT NULL',
  );
  const mergedIds = new Set(mergedRes.rows.map((r) => r.id));

  const { events } = await loadAllEvents(db, { now });
  const active = events.filter((e) => !mergedIds.has(e.id));
  const queue = active
    .filter((e) => Boolean(e.review?.disputed))
    .sort((a, b) => a.confidence - b.confidence || b.updated_at.localeCompare(a.updated_at));

  const pageSize = Math.min(Math.max(1, options.page_size ?? 50), 50);
  const total = queue.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, options.page ?? 1), Math.max(1, totalPages));
  const slice = queue.slice((page - 1) * pageSize, page * pageSize);

  const items = slice.map((ev) => {
    const tokens = ev.normalized_title.split(' ').filter((w) => w.length >= 3);
    const candidates = active
      .filter((other) => {
        if (other.id === ev.id) return false;
        if (other.dedup_key === ev.dedup_key) return true;
        if (other.city_id !== ev.city_id) return false;
        const otherTokens = new Set(other.normalized_title.split(' ').filter((w) => w.length >= 3));
        const shared = tokens.filter((t) => otherTokens.has(t));
        return shared.length >= 2 || (tokens.length > 0 && shared.length === tokens.length);
      })
      .slice(0, 5)
      .map((other) => other.id);

    return {
      event: toWireEvent(ev),
      reasons: ev.review?.reasons ?? [],
      duplicate_candidates: candidates,
    };
  });

  return {
    items,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  };
}

const ModerationResolveSchema = z
  .object({
    action: z.enum(['publish', 'keep_draft', 'cancel', 'merge']),
    merge_into: z.string().optional(),
    comment: z.string().max(500).nullable().optional(),
  })
  .strict();

export async function resolveModerationItem(
  db: Database,
  idOrCode: string,
  rawBody: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; event: ApiEvent; changes: { field: string; from: unknown; to: unknown }[] }
  | { ok: false; status: 400 | 404; code: string; message: string; details?: ApiErrorDetail[] }
> {
  const parsed = ModerationResolveSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Некорректное решение модерации',
      details: parsed.error.issues.map((i) => ({
        field: i.path.join('.') || 'body',
        message: i.message,
      })),
    };
  }

  const found = await findEventByIdOrCode(db, idOrCode, { includeDrafts: true, now });
  if (found.invalidId || !found.event) {
    return { ok: false, status: 404, code: 'not_found', message: 'Событие не найдено' };
  }
  const sourceEv = found.event;
  const { action, merge_into, comment } = parsed.data;
  const nowIso = formatRfc3339Local(now);

  if (action === 'merge') {
    if (!merge_into || (!UUID_PATTERN.test(merge_into) && !/^evt_[a-z0-9_]+$/i.test(merge_into))) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'Для слияния укажите UUID целевой карточки (merge_into)',
        details: [{ field: 'merge_into', message: 'Ожидается UUID события' }],
      };
    }

    const targetFound = await findEventByIdOrCode(db, merge_into, { includeDrafts: true, now });
    if (!targetFound.event) {
      return {
        ok: false,
        status: 404,
        code: 'not_found',
        message: 'Целевая карточка для слияния не найдена',
      };
    }
    if (targetFound.event.id === sourceEv.id) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'Нельзя слить карточку саму с собой',
        details: [{ field: 'merge_into', message: 'Укажите другое событие' }],
      };
    }

    const targetEv = targetFound.event;
    await db.transaction(async (tx) => {
      // Переносим источники на целевую карточку
      for (const src of sourceEv.sources) {
        await tx.query(
          `INSERT INTO event_sources (event_id, source_url, source_type, source_hash, verified_at, title, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6, FALSE)
           ON CONFLICT (event_id, source_hash) DO NOTHING`,
          [targetEv.id, src.source_url, src.source_type, src.source_hash, src.verified_at, src.title ?? null],
        );
      }

      // Дозаполняем пустые поля целевой карточки
      await tx.query(
        `UPDATE events SET
           description = CASE WHEN description = '' THEN $2 ELSE description END,
           address = COALESCE(address, $3),
           price_min = COALESCE(price_min, $4),
           price_max = COALESCE(price_max, $5),
           is_free = is_free OR ($6 AND price_min IS NULL),
           age_limit = COALESCE(age_limit, $7),
           organizer = COALESCE(organizer, $8),
           org_link = COALESCE(org_link, $9),
           updated_at = $10
         WHERE id = $1`,
        [
          targetEv.id,
          sourceEv.description,
          sourceEv.address,
          sourceEv.price_min,
          sourceEv.price_max,
          sourceEv.is_free,
          sourceEv.age_limit,
          sourceEv.organizer,
          sourceEv.org_link,
          nowIso,
        ],
      );

      await tx.query(
        `UPDATE events SET
           status = 'cancelled',
           disputed = FALSE,
           review_reasons = '[]'::jsonb,
           merged_into = $2,
           updated_at = $3
         WHERE id = $1`,
        [sourceEv.id, targetEv.id, nowIso],
      );
      await tx.query(
        `UPDATE event_occurrences SET status = 'cancelled' WHERE event_id = $1`,
        [sourceEv.id],
      );

      await tx.query(
        `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes, note)
         VALUES ($1, $2, $3, 'merge', 'event', $4, $5, $6::jsonb, $7)`,
        [
          randomUUID(),
          nowIso,
          actor,
          sourceEv.id,
          sourceEv.title,
          JSON.stringify([{ field: 'merged_into', from: null, to: targetEv.id }]),
          comment ?? `Слито в ${targetEv.id}`,
        ],
      );
    });

    const refreshedTarget = await findEventByIdOrCode(db, targetEv.id, { includeDrafts: true, now });
    return {
      ok: true,
      event: toWireEvent(refreshedTarget.event!),
      changes: [{ field: 'merged_into', from: null, to: targetEv.id }],
    };
  }

  const nextStatus: EventStatus =
    action === 'publish' ? 'published' : action === 'cancel' ? 'cancelled' : 'draft';
  const changes: { field: string; from: unknown; to: unknown }[] = [
    { field: 'status', from: sourceEv.status, to: nextStatus },
    { field: 'review.disputed', from: sourceEv.review?.disputed ?? false, to: false },
  ];

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE events SET status = $2, disputed = FALSE, review_reasons = '[]'::jsonb, updated_at = $3 WHERE id = $1`,
      [sourceEv.id, nextStatus, nowIso],
    );
    if (nextStatus === 'cancelled') {
      await tx.query(`UPDATE event_occurrences SET status = 'cancelled' WHERE event_id = $1`, [sourceEv.id]);
    }
    await tx.query(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes, note)
       VALUES ($1, $2, $3, 'moderation', 'event', $4, $5, $6::jsonb, $7)`,
      [randomUUID(), nowIso, actor, sourceEv.id, sourceEv.title, JSON.stringify(changes), comment ?? null],
    );
  });

  const refreshed = await findEventByIdOrCode(db, sourceEv.id, { includeDrafts: true, now });
  return {
    ok: true,
    event: toWireEvent(refreshed.event!),
    changes,
  };
}

interface AuditRow {
  id: string;
  at: Date | string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_title: string | null;
  changes: unknown;
  import_id: string | null;
  note: string | null;
}

export async function listAuditEntries(
  db: Database,
  options: { entity_id?: string; action?: string; page?: number; page_size?: number },
) {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (options.entity_id) {
    params.push(options.entity_id);
    conds.push(`entity_id = $${params.length}`);
  }
  if (options.action) {
    params.push(options.action);
    conds.push(`action = $${params.length}`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const allRes = await db.query<AuditRow>(`SELECT * FROM audit_log ${where} ORDER BY at DESC`, params);

  const pageSize = Math.min(Math.max(1, options.page_size ?? 50), 50);
  const total = allRes.rows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, options.page ?? 1), Math.max(1, totalPages));
  const slice = allRes.rows.slice((page - 1) * pageSize, page * pageSize);

  const items = slice.map((r) => {
    let changes = r.changes;
    if (typeof changes === 'string') {
      try {
        changes = JSON.parse(changes);
      } catch {
        changes = [];
      }
    }
    return {
      id: r.id,
      at: r.at instanceof Date ? formatRfc3339Local(r.at) : String(r.at),
      actor: r.actor,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      ...(r.entity_title ? { entity_title: r.entity_title } : {}),
      changes: Array.isArray(changes) ? changes : [],
      import_id: r.import_id,
      ...(r.note ? { note: r.note } : {}),
    };
  });

  return {
    items,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  };
}

interface FeedbackRow {
  id: string;
  created_at: Date | string;
  kind: FeedbackKind;
  event_id: string | null;
  event_title: string | null;
  name: string;
  contact: string;
  organization: string | null;
  text: string;
  status: 'new' | 'done';
}

export async function listApplications(db: Database, statusFilter?: string | null) {
  await cleanupExpiredFeedback(db);
  const params: unknown[] = [];
  const where = statusFilter === 'new' || statusFilter === 'done' ? 'WHERE status = $1' : '';
  if (where) params.push(statusFilter);

  const res = await db.query<FeedbackRow>(
    `SELECT id, created_at, kind, event_id, event_title, name, contact, organization, text, status
     FROM feedback ${where} ORDER BY created_at DESC`,
    params,
  );

  const items = res.rows.map((r) => ({
    id: r.id,
    at: r.created_at instanceof Date ? formatRfc3339Local(r.created_at) : String(r.created_at),
    kind: r.kind,
    event_id: r.event_id,
    event_title: r.event_title,
    name: r.name,
    contact: r.contact,
    organization: r.organization,
    text: r.text,
    status: r.status,
  }));

  return { items, total: items.length };
}

export async function patchApplicationStatus(
  db: Database,
  id: string,
  status: 'new' | 'done',
  actor: string,
  now: Date = new Date(),
) {
  if (!UUID_PATTERN.test(id)) {
    return { ok: false as const, status: 404 as const, code: 'not_found', message: 'Обращение не найдено' };
  }
  const existing = await db.query<FeedbackRow>(
    'SELECT id, created_at, kind, event_id, event_title, name, contact, organization, text, status FROM feedback WHERE id = $1',
    [id.toLowerCase()],
  );
  if (existing.rows.length === 0) {
    return {
      ok: false as const,
      status: 404 as const,
      code: 'not_found',
      message: 'Обращение не найдено: возможно, оно удалено по сроку хранения',
    };
  }
  const cur = existing.rows[0];
  const nowIso = formatRfc3339Local(now);

  await db.transaction(async (tx) => {
    await tx.query('UPDATE feedback SET status = $2 WHERE id = $1', [cur.id, status]);
    await tx.query(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes)
       VALUES ($1, $2, $3, 'application', 'application', $4, $5, $6::jsonb)`,
      [
        randomUUID(),
        nowIso,
        actor,
        cur.id,
        KIND_LABEL[cur.kind],
        JSON.stringify([
          {
            field: 'status',
            from: cur.status === 'done' ? 'обработано' : 'новое',
            to: status === 'done' ? 'обработано' : 'новое',
          },
        ]),
      ],
    );
  });

  return {
    ok: true as const,
    application: {
      id: cur.id,
      at: cur.created_at instanceof Date ? formatRfc3339Local(cur.created_at) : String(cur.created_at),
      kind: cur.kind,
      event_id: cur.event_id,
      event_title: cur.event_title,
      name: cur.name,
      contact: cur.contact,
      organization: cur.organization,
      text: cur.text,
      status,
    },
  };
}

export async function resetDemoData(
  db: Database,
  actor: string,
  publicWebUrl: string,
  now: Date = new Date(),
) {
  const result = await seedDatabase(db, { forceReset: true, publicWebUrl, now });
  await db.query(
    `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes)
     VALUES ($1, $2, $3, 'reset', 'system', 'catalog', 'Демо-каталог', $4::jsonb)`,
    [
      randomUUID(),
      formatRfc3339Local(now),
      actor,
      JSON.stringify([{ field: 'events', from: 'custom', to: result.eventsCount }]),
    ],
  );
  return { reset: true, events: result.eventsCount };
}

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

function normalizeTraceRow(row: Record<string, unknown>, includeDetails: boolean) {
  const base = {
    id: String(row.id),
    request_id: String(row.request_id),
    created_at:
      row.created_at instanceof Date ? formatRfc3339Local(row.created_at) : String(row.created_at),
    channel: typeof row.channel === 'string' && row.channel ? row.channel : 'web',
    user_ref: row.user_ref ? String(row.user_ref) : null,
    engine: String(row.engine),
    model: row.model ? String(row.model) : null,
    prompt_version: row.prompt_version ? String(row.prompt_version) : null,
    action: String(row.action),
    user_query_masked: String(row.user_query_masked ?? ''),
    duration_ms: Number(row.duration_ms ?? 0),
    cost_rub:
      row.cost_rub !== null && row.cost_rub !== undefined && Number.isFinite(Number(row.cost_rub))
        ? Number(row.cost_rub)
        : null,
    fallback_used: Boolean(row.fallback_used),
    error: row.error ? String(row.error) : null,
    grounding_ids: parseJsonField<string[]>(row.grounding_ids, []),
    token_usage: parseJsonField<{ prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null>(
      row.token_usage,
      null,
    ),
  };

  if (!includeDetails) return base;
  return {
    ...base,
    steps: parseJsonField<unknown[]>(row.steps, []),
    plan: parseJsonField<Record<string, unknown> | null>(row.plan, null),
  };
}

export async function listAgentTraces(db: Database, limit = 50) {
  const clamped = Math.min(Math.max(1, limit), 100);
  const [res, countRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT id, request_id, created_at, channel, user_ref, engine, model, prompt_version,
              action, user_query_masked, duration_ms, grounding_ids, token_usage, cost_rub, fallback_used, error
       FROM agent_traces ORDER BY created_at DESC LIMIT $1`,
      [clamped],
    ),
    db.query<{ cnt: string | number }>('SELECT COUNT(*) AS cnt FROM agent_traces'),
  ]);
  const total = Number(countRes.rows[0]?.cnt ?? res.rows.length);
  return {
    items: res.rows.map((row) => normalizeTraceRow(row, false)),
    total,
  };
}

export async function getAgentTrace(db: Database, id: string) {
  if (!UUID_PATTERN.test(id)) return null;
  const res = await db.query<Record<string, unknown>>('SELECT * FROM agent_traces WHERE id = $1', [
    id.toLowerCase(),
  ]);
  if (!res.rows[0]) return null;
  return normalizeTraceRow(res.rows[0], true);
}
