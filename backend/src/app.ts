import { Hono } from 'hono';

import type { AppConfig } from './config.js';
import type { Database } from './db/adapter.js';
import {
  getAgentTrace,
  listAgentTraces,
  listApplications,
  listAuditEntries,
  listAdminEvents,
  listModerationQueue,
  patchAdminEvent,
  patchApplicationStatus,
  resetDemoData,
  resolveModerationItem,
  checkAdminAuth,
} from './domain/admin.js';
import {
  confirmPendingAction,
  parseAssistantRequestBody,
  runAssistantPipeline,
} from './domain/assistant/index.js';
import {
  CATEGORIES,
  FULL_DICTIONARIES,
  isCitySlug,
} from './domain/dictionaries.js';
import { findEventByIdOrCode, loadAllEvents } from './domain/events-repo.js';
import { submitFeedback } from './domain/feedback.js';
import {
  CACHE_CARD,
  CACHE_DICTIONARY,
  CACHE_NO_STORE,
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  jsonWithEtag,
  resolveRequestId,
} from './domain/http-helpers.js';
import {
  detectImportFormat,
  listImports,
  MAX_IMPORT_BYTES,
  runImport,
} from './domain/imports.js';
import { SLUG_PATTERN } from './domain/identity.js';
import { clientIpFromHeaders, SlidingRateLimiter } from './domain/rate-limit.js';
import {
  buildCatalogRelaxations,
  buildAppliedFilters,
  computeOpenApiFacets,
  computeWebFacets,
  findSimilarEvents,
  parseEventsSearchParams,
  runCatalogSearch,
  toListItem,
} from './domain/search.js';
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
} from './domain/subscriptions.js';
import {
  daysBetween,
  formatRfc3339Local,
  isValidYmd,
  localNow,
  resolveDatePreset,
  TIMEZONE,
} from './domain/time.js';
import type { ApiEvent, CityId, DatePreset, EventStatus } from './domain/types.js';
import { logEvent } from './observability/logger.js';
import { MetricsRegistry } from './observability/metrics.js';

type Env = {
  Variables: {
    requestId: string;
    adminActor: string;
  };
};

export interface CreateAppOptions {
  db: Database;
  config: AppConfig;
  metrics?: MetricsRegistry;
  nowFn?: () => Date;
}

const KNOWN_ROUTE_METHODS: Array<{ pattern: RegExp; allow: string }> = [
  { pattern: /^\/api\/v1\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/health\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/metrics\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/metrics\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/events\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/events\/[^/]+\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/events\/[^/]+\/similar\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/venues\/[^/]+\/schedule\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/cities\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/venues\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/categories\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/dictionaries\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/facets\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/subscriptions\/?$/, allow: 'GET, POST, OPTIONS' },
  { pattern: /^\/api\/v1\/subscriptions\/[^/]+\/?$/, allow: 'DELETE, OPTIONS' },
  { pattern: /^\/api\/v1\/feedback\/?$/, allow: 'POST, OPTIONS' },
  { pattern: /^\/api\/v1\/assistant\/query\/?$/, allow: 'POST, OPTIONS' },
  { pattern: /^\/api\/v1\/assistant\/confirm\/?$/, allow: 'POST, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/events\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/events\/[^/]+\/?$/, allow: 'GET, PATCH, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/imports\/?$/, allow: 'GET, POST, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/moderation\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/moderation\/[^/]+\/resolve\/?$/, allow: 'POST, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/audit\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/applications\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/applications\/[^/]+\/?$/, allow: 'PATCH, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/reset\/?$/, allow: 'POST, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/traces\/?$/, allow: 'GET, OPTIONS' },
  { pattern: /^\/api\/v1\/admin\/traces\/[^/]+\/?$/, allow: 'GET, OPTIONS' },
];

function intParam(raw: string | undefined, fallback: number, min = 1, max = 100): number {
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Math.min(Math.max(min, n), max);
}

function getClientIp(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return '127.0.0.1';
  return clientIpFromHeaders(headers, '127.0.0.1');
}

function toWireEvent(ev: ApiEvent): ApiEvent {
  const clone = { ...ev } as Record<string, unknown>;
  delete clone.etag;
  delete clone.merged_into;
  return clone as unknown as ApiEvent;
}

export function createApp(options: CreateAppOptions) {
  const { db, config } = options;
  const metrics = options.metrics ?? new MetricsRegistry();
  const nowFn = options.nowFn ?? (() => new Date());
  const feedbackRateLimiter = new SlidingRateLimiter();
  const metricsRateLimiter = new SlidingRateLimiter();

  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const requestId = resolveRequestId(c.req.header('x-request-id'));
    c.set('requestId', requestId);

    if (c.req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          'X-Request-Id': requestId,
        },
      });
    }

    const startMs = Date.now();
    await next();
    const durationSeconds = (Date.now() - startMs) / 1000;
    const status = c.res.status;
    const path = new URL(c.req.url).pathname;

    metrics.observeHttp(c.req.method, path, status, durationSeconds);
    logEvent('info', 'http_request', {
      request_id: requestId,
      method: c.req.method,
      path,
      status,
      duration_ms: Math.round(durationSeconds * 1000),
    });
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? resolveRequestId(null);
    logEvent('error', 'unhandled_error', {
      request_id: requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(
      c,
      {
        code: 'internal_error',
        message: 'Внутренняя ошибка сервера',
        details: [],
        request_id: requestId,
      },
      { status: 500 },
    );
  });

  // --- Служебные маршруты ---

  app.get('/api/v1', (c) =>
    jsonResponse(c, {
      name: 'bashkortostan-culture-afisha-api',
      version: '1.0.0',
      timezone: TIMEZONE,
      endpoints: [
        '/api/v1/events',
        '/api/v1/events/{id}',
        '/api/v1/events/{id}/similar',
        '/api/v1/venues/{id}/schedule',
        '/api/v1/cities',
        '/api/v1/venues',
        '/api/v1/categories',
        '/api/v1/dictionaries',
        '/api/v1/facets',
        '/api/v1/subscriptions',
        '/api/v1/feedback',
        '/api/v1/assistant/query',
        '/api/v1/health',
        '/api/v1/metrics',
      ],
    }),
  );

  app.get('/api/v1/health', async (c) => {
    const now = nowFn();
    const dbOk = await db.ping();
    let eventsCount = 0;
    if (dbOk) {
      const cntRes = await db.query<{ cnt: string | number }>(
        "SELECT COUNT(*) AS cnt FROM events WHERE status = 'published' AND merged_into IS NULL",
      );
      eventsCount = Number(cntRes.rows[0]?.cnt ?? 0);
    }

    const modelStatus = config.assistantDisabled
      ? 'disabled'
      : config.llmApiKey
        ? 'ok'
        : 'disabled';
    const overallStatus = !dbOk || config.assistantDisabled ? 'degraded' : 'ok';

    return jsonResponse(
      c,
      {
        status: overallStatus,
        checks: {
          database: dbOk ? 'ok' : 'fail',
          model: modelStatus,
        },
        version: '1.0.0',
        data: db.driver,
        events: eventsCount,
        time: formatRfc3339Local(now),
        timezone: TIMEZONE,
      },
      { status: dbOk ? 200 : 503 },
    );
  });

  const handleMetrics = (c: any) => {
    const ip = getClientIp(c.req.raw.headers, config.trustProxy);
    const check = metricsRateLimiter.checkAndConsume(
      `metrics:${ip}`,
      config.metricsRatePerMinute,
      60_000,
      nowFn().getTime(),
    );
    if (!check.ok) {
      return errorResponse(c, 429, 'rate_limited', 'Слишком много запросов к /metrics', [], {
        'Retry-After': String(check.retryAfter),
      });
    }
    return new Response(metrics.formatPrometheus(), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': CACHE_NO_STORE,
        'X-Request-Id': c.get('requestId'),
      },
    });
  };
  app.get('/api/v1/metrics', handleMetrics);
  app.get('/metrics', handleMetrics);

  // --- Справочники и фасеты ---

  app.get('/api/v1/cities', async (c) => {
    const res = await db.query<{
      slug: string;
      name_ru: string;
      name_ba: string;
      lat: number;
      lon: number;
    }>('SELECT slug, name_ru, name_ba, lat, lon FROM cities ORDER BY sort_order ASC');
    return jsonWithEtag(
      c,
      {
        items: res.rows.map((r) => ({
          id: r.slug,
          name: r.name_ru,
          name_ba: r.name_ba,
          lat: r.lat,
          lon: r.lon,
        })),
      },
      CACHE_DICTIONARY,
    );
  });

  app.get('/api/v1/venues', async (c) => {
    const city = c.req.query('city')?.trim();
    if (city && !isCitySlug(city)) {
      return errorResponse(c, 400, 'validation_error', `Неизвестный город «${city}»`, [
        { field: 'city', message: 'Укажите код города из GET /cities' },
      ]);
    }
    const params: unknown[] = [];
    const where = city ? 'WHERE v.city_slug = $1' : '';
    if (city) params.push(city);

    const res = await db.query<{
      id: string;
      name: string;
      city_slug: string;
      city_name: string;
      address: string | null;
      lat: number | null;
      lon: number | null;
    }>(
      `SELECT v.id, v.name, v.city_slug, c.name_ru AS city_name, v.address, v.lat, v.lon
       FROM venues v JOIN cities c ON c.slug = v.city_slug
       ${where}
       ORDER BY v.id ASC`,
      params,
    );

    return jsonWithEtag(
      c,
      {
        items: res.rows.map((r) => ({
          id: r.id,
          name: r.name,
          city_id: r.city_slug,
          city: r.city_name,
          address: r.address,
          lat: r.lat,
          lon: r.lon,
        })),
      },
      CACHE_DICTIONARY,
    );
  });

  app.get('/api/v1/categories', (c) =>
    jsonWithEtag(
      c,
      {
        items: CATEGORIES.map((cat) => ({
          id: cat.id,
          name: cat.name.ru,
          name_ba: cat.name.ba,
        })),
      },
      CACHE_DICTIONARY,
    ),
  );

  app.get('/api/v1/dictionaries', (c) => jsonWithEtag(c, FULL_DICTIONARIES, CACHE_DICTIONARY));

  app.get('/api/v1/facets', async (c) => {
    const now = nowFn();
    const parsed = parseEventsSearchParams(new URL(c.req.url), now);
    if (!parsed.ok) {
      return errorResponse(c, 400, 'validation_error', 'Некорректные параметры фильтров', parsed.issues);
    }
    const { events } = await loadAllEvents(db, { statuses: ['published'], now });
    return jsonResponse(c, computeWebFacets(events, parsed.filters), { cache: CACHE_NO_STORE });
  });

  // --- События и расписание площадок ---

  app.get('/api/v1/events', async (c) => {
    const now = nowFn();
    const { date: today } = localNow(now);
    const parsed = parseEventsSearchParams(new URL(c.req.url), now);
    if (!parsed.ok) {
      return errorResponse(c, 400, 'validation_error', 'Проверьте параметры поиска событий', parsed.issues);
    }

    const f = parsed.filters;
    const { events } = await loadAllEvents(db, { statuses: ['published'], now });
    const searchOutcome = runCatalogSearch(events, f);
    const total = searchOutcome.matches.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / f.page_size);
    const offset = (f.page - 1) * f.page_size;
    const items = searchOutcome.matches.slice(offset, offset + f.page_size).map(toListItem);
    const facets = computeOpenApiFacets(events, f);
    const relaxations = total === 0 ? buildCatalogRelaxations(events, f, today) : [];

    return jsonWithEtag(
      c,
      {
        items,
        page: f.page,
        page_size: f.page_size,
        total,
        total_pages: totalPages,
        facets,
        applied: buildAppliedFilters(f),
        relaxations,
        hidden_unknown_price: searchOutcome.hidden_unknown_price,
        hidden_unknown_age: searchOutcome.hidden_unknown_age,
        reference_date: today,
        timezone: 'Asia/Yekaterinburg',
      },
      CACHE_NO_STORE,
    );
  });

  app.get('/api/v1/events/:id', async (c) => {
    const now = nowFn();
    const id = c.req.param('id');
    const found = await findEventByIdOrCode(db, id, { includeDrafts: false, now });
    if (found.invalidId) {
      return errorResponse(c, 400, 'validation_error', 'Идентификатор события должен быть корректным UUID', [
        { field: 'id', message: 'Неверный формат идентификатора' },
      ]);
    }
    if (!found.event) {
      return errorResponse(c, 404, 'not_found', 'Событие не найдено');
    }
    return jsonWithEtag(c, toWireEvent(found.event), CACHE_CARD);
  });

  app.get('/api/v1/events/:id/similar', async (c) => {
    const now = nowFn();
    const { date: today } = localNow(now);
    const id = c.req.param('id');
    const base = await findEventByIdOrCode(db, id, { includeDrafts: false, now });
    if (base.invalidId) {
      return errorResponse(c, 400, 'validation_error', 'Некорректный UUID события', [
        { field: 'id', message: 'Ожидается UUID события' },
      ]);
    }
    if (!base.event) {
      return errorResponse(c, 404, 'not_found', 'Событие не найдено');
    }

    const url = new URL(c.req.url);
    const citiesParam = url.searchParams.getAll('city').flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
    for (const citySlug of citiesParam) {
      if (!isCitySlug(citySlug)) {
        return errorResponse(c, 400, 'validation_error', `Неизвестный город «${citySlug}»`, [
          { field: 'city', message: 'Укажите код города из справочника' },
        ]);
      }
    }

    const dateParam = url.searchParams.get('date')?.trim();
    let dateFrom = url.searchParams.get('date_from')?.trim() ?? null;
    let dateTo = url.searchParams.get('date_to')?.trim() ?? null;
    if (dateParam) {
      if (dateParam === 'today' || dateParam === 'tomorrow' || dateParam === 'weekend' || dateParam === 'week') {
        const range = resolveDatePreset(dateParam as DatePreset, today);
        dateFrom = range.from;
        dateTo = range.to;
      } else if (isValidYmd(dateParam)) {
        dateFrom = dateParam;
        dateTo = dateParam;
      } else {
        return errorResponse(c, 400, 'validation_error', 'Некорректный параметр date', [
          { field: 'date', message: 'Ожидается today|tomorrow|weekend|week или YYYY-MM-DD' },
        ]);
      }
    }
    if ((dateFrom && !isValidYmd(dateFrom)) || (dateTo && !isValidYmd(dateTo))) {
      return errorResponse(c, 400, 'validation_error', 'Некорректный формат дат date_from/date_to');
    }

    const pageSize = intParam(url.searchParams.get('page_size') ?? undefined, 5, 1, 20);
    const { events } = await loadAllEvents(db, { statuses: ['published'], now });
    const items = findSimilarEvents(events, base.event, {
      cities: citiesParam.length > 0 ? (citiesParam as CityId[]) : undefined,
      date_from: dateFrom,
      date_to: dateTo,
      limit: pageSize,
    });

    return jsonWithEtag(
      c,
      {
        items,
        page: 1,
        page_size: pageSize,
        total: items.length,
        total_pages: items.length > 0 ? 1 : 0,
      },
      CACHE_CARD,
    );
  });

  app.get('/api/v1/venues/:id/schedule', async (c) => {
    const now = nowFn();
    const venueParam = c.req.param('id');
    if (!SLUG_PATTERN.test(venueParam) && !/^ven_[a-z0-9_]+$/i.test(venueParam)) {
      return errorResponse(c, 400, 'validation_error', 'Некорректный код площадки');
    }

    const dateFrom = c.req.query('date_from')?.trim() ?? '';
    const dateTo = c.req.query('date_to')?.trim() ?? '';
    if (!isValidYmd(dateFrom) || !isValidYmd(dateTo)) {
      return errorResponse(c, 400, 'validation_error', 'Параметры date_from и date_to обязательны в формате YYYY-MM-DD', [
        { field: 'date_from', message: 'Требуется YYYY-MM-DD' },
        { field: 'date_to', message: 'Требуется YYYY-MM-DD' },
      ]);
    }
    if (dateTo < dateFrom || daysBetween(dateFrom, dateTo) > 31) {
      return errorResponse(c, 400, 'validation_error', 'Период расписания площадки должен быть от 0 до 31 дня', [
        { field: 'date_to', message: 'Интервал не более 31 дня' },
      ]);
    }

    const venueRes = await db.query<{
      id: string;
      name: string;
      city_slug: string;
      city_name: string;
      address: string | null;
      lat: number | null;
      lon: number | null;
    }>(
      `SELECT v.id, v.name, v.city_slug, c.name_ru AS city_name, v.address, v.lat, v.lon
       FROM venues v JOIN cities c ON c.slug = v.city_slug
       WHERE v.id = $1 OR v.legacy_id = $1
       LIMIT 1`,
      [venueParam],
    );
    if (venueRes.rows.length === 0) {
      return errorResponse(c, 404, 'not_found', 'Площадка не найдена');
    }

    const v = venueRes.rows[0];
    const { events } = await loadAllEvents(db, { statuses: ['published'], now });
    const items = runCatalogSearch(events, {
      cities: [],
      categories: [],
      categories_exclude: [],
      date_preset: null,
      date_from: dateFrom,
      date_to: dateTo,
      time_from: null,
      time_to: null,
      price_max: null,
      free_only: false,
      age: null,
      age_ratings: [],
      audience: null,
      venue_id: v.id,
      language: null,
      statuses: ['scheduled', 'rescheduled'],
      statuses_explicit: false,
      q: null,
      sort: 'date',
      page: 1,
      page_size: 100,
    }).matches.map((m) => toWireEvent(m.event));

    return jsonWithEtag(
      c,
      {
        venue: {
          id: v.id,
          name: v.name,
          city_id: v.city_slug,
          city: v.city_name,
          address: v.address,
          lat: v.lat,
          lon: v.lon,
        },
        date_from: dateFrom,
        date_to: dateTo,
        items,
      },
      CACHE_CARD,
    );
  });

  // --- Подписки и обратная связь ---

  app.post('/api/v1/subscriptions', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'invalid_json', 'Тело запроса должно быть корректным JSON');
    }

    const res = await createSubscription(db, body, nowFn());
    if (!res.ok) {
      return errorResponse(c, res.status, res.code, res.message, res.details ?? []);
    }
    return jsonResponse(c, res.subscription, {
      status: 201,
      headers: { Location: `/api/v1/subscriptions/${res.subscription.id}` },
    });
  });

  app.get('/api/v1/subscriptions', async (c) => {
    const res = await listSubscriptions(db, c.req.query('user_ref'));
    if (!res.ok) {
      return errorResponse(c, res.status, res.code, res.message, res.details);
    }
    return jsonResponse(c, { items: res.items });
  });

  app.delete('/api/v1/subscriptions/:id', async (c) => {
    const res = await deleteSubscription(db, c.req.param('id'), c.req.query('user_ref'));
    if (!res.ok) {
      return errorResponse(c, res.status, res.code, res.message);
    }
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': CACHE_NO_STORE,
        'X-Request-Id': c.get('requestId'),
      },
    });
  });

  app.post('/api/v1/feedback', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'invalid_json', 'Тело запроса должно быть корректным JSON');
    }

    const ip = getClientIp(c.req.raw.headers, config.trustProxy);
    const res = await submitFeedback(db, body, {
      clientIp: ip,
      rateLimiter: feedbackRateLimiter,
      retentionDays: config.feedbackRetentionDays,
      metrics,
      now: nowFn(),
    });
    if (!res.ok) {
      const headers: Record<string, string> = {};
      if (res.retryAfterSeconds) headers['Retry-After'] = String(res.retryAfterSeconds);
      return errorResponse(c, res.status, res.code, res.message, res.details ?? [], headers);
    }
    return jsonResponse(c, { id: res.id, status: res.status }, { status: 202 });
  });

  // --- ИИ-ассистент ---

  app.post('/api/v1/assistant/query', async (c) => {
    if (config.assistantDisabled || c.req.header('x-assistant-demo') === 'unavailable') {
      return errorResponse(
        c,
        503,
        'unavailable',
        'ИИ временно недоступен. Поиск по фильтрам работает: GET /api/v1/events',
        [],
        { 'Retry-After': '60' },
      );
    }

    const rawText = await c.req.text();
    if (rawText.length > 20_000) {
      return errorResponse(c, 413, 'payload_too_large', 'Тело запроса не длиннее 20 000 символов');
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawText);
    } catch {
      return errorResponse(c, 400, 'invalid_json', 'Ожидается корректный JSON в теле запроса');
    }

    const parsed = parseAssistantRequestBody(rawJson);
    if (!parsed.ok) {
      return errorResponse(c, 400, 'validation_error', 'Проверьте параметры запроса ассистента', parsed.details);
    }

    const payload = await runAssistantPipeline(db, config, parsed.value, {
      requestId: c.get('requestId'),
      clientIp: getClientIp(c.req.raw.headers, config.trustProxy),
      rateLimiter: feedbackRateLimiter,
      metrics,
      now: nowFn(),
    });
    return jsonResponse(c, payload);
  });

  app.post('/api/v1/assistant/confirm', async (c) => {
    if (config.assistantDisabled || c.req.header('x-assistant-demo') === 'unavailable') {
      return errorResponse(c, 503, 'unavailable', 'ИИ временно недоступен', [], { 'Retry-After': '60' });
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'invalid_json', 'Ожидается JSON с полем confirmation_id');
    }

    const res = await confirmPendingAction(db, body, {
      requestId: c.get('requestId'),
      clientIp: getClientIp(c.req.raw.headers, config.trustProxy),
      rateLimiter: feedbackRateLimiter,
      retentionDays: config.feedbackRetentionDays,
      metrics,
      now: nowFn(),
    });

    if (!res.ok) {
      const status = res.error.http_status ?? 400;
      return errorResponse(c, status, res.error.code, res.error.message);
    }
    return jsonResponse(c, res.data);
  });

  // --- Админка (Bearer ADMIN_TOKEN или ADMIN_OPEN=1) ---

  app.use('/api/v1/admin/*', async (c, next) => {
    const auth = checkAdminAuth(
      {
        authorization: c.req.header('authorization'),
        xActor: c.req.header('x-actor'),
      },
      config,
    );
    if (!auth.ok) {
      return errorResponse(c, auth.status, auth.code, auth.message);
    }
    c.set('adminActor', auth.actor);
    await next();
  });

  app.get('/api/v1/admin/events', async (c) => {
    const status = c.req.query('status')?.trim();
    if (status && status !== 'published' && status !== 'draft' && status !== 'cancelled') {
      return errorResponse(c, 400, 'validation_error', 'Некорректный статус', [
        { field: 'status', message: 'Допустимо: published, draft, cancelled' },
      ]);
    }
    const disputedRaw = c.req.query('disputed');
    const sourceRaw = c.req.query('source');
    const result = await listAdminEvents(
      db,
      {
        status: status as EventStatus | undefined,
        disputed: disputedRaw === undefined || disputedRaw === '' ? undefined : disputedRaw === 'true',
        source: sourceRaw === 'demo' || sourceRaw === 'import' ? sourceRaw : undefined,
        q: c.req.query('q')?.slice(0, 100) || undefined,
        page: intParam(c.req.query('page'), 1, 1, 1000),
        page_size: intParam(c.req.query('page_size'), 25, 1, 100),
      },
      nowFn(),
    );
    return jsonResponse(c, result);
  });

  app.get('/api/v1/admin/events/:id', async (c) => {
    const found = await findEventByIdOrCode(db, c.req.param('id'), {
      includeDrafts: true,
      now: nowFn(),
    });
    if (found.invalidId || !found.event) {
      return errorResponse(c, 404, 'not_found', 'Событие не найдено');
    }
    return jsonResponse(c, found.event, { headers: { ETag: found.event.etag } });
  });

  app.patch('/api/v1/admin/events/:id', async (c) => {
    const raw = await c.req.text();
    if (raw.length > 50_000) {
      return errorResponse(c, 413, 'payload_too_large', 'Тело правки слишком большое');
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return errorResponse(c, 400, 'invalid_json', 'Ожидается корректный JSON в теле правки');
    }

    const res = await patchAdminEvent(
      db,
      c.req.param('id'),
      body,
      c.req.header('if-match'),
      c.get('adminActor'),
      nowFn(),
    );
    if (!res.ok) {
      return errorResponse(c, res.status, res.code, res.message, res.details ?? []);
    }
    return jsonResponse(
      c,
      {
        ...toWireEvent(res.event),
        event: res.event,
        changes: res.changes,
      },
      { headers: { ETag: res.event.etag } },
    );
  });

  app.get('/api/v1/admin/imports', async (c) => {
    const items = await listImports(db, intParam(c.req.query('limit'), 50, 1, 100));
    return jsonResponse(c, { items });
  });

  app.post('/api/v1/admin/imports', async (c) => {
    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (contentLength > MAX_IMPORT_BYTES + 64 * 1024) {
      return errorResponse(c, 413, 'payload_too_large', 'Файл импорта больше 5 МБ');
    }

    const contentType = c.req.header('content-type') ?? '';
    let bodyText = '';
    let fileName: string | null = c.req.query('file_name')?.slice(0, 200) ?? null;
    let fileType = contentType;

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) {
        return errorResponse(c, 400, 'validation_error', 'Выберите файл CSV или JSON в поле file', [
          { field: 'file', message: 'Поле file обязательно' },
        ]);
      }
      if (file.size > MAX_IMPORT_BYTES) {
        return errorResponse(c, 413, 'payload_too_large', 'Файл импорта больше 5 МБ');
      }
      bodyText = await file.text();
      fileName = file.name.slice(0, 200) || fileName;
      fileType = file.type;
    } else {
      bodyText = await c.req.text();
    }

    if (Buffer.byteLength(bodyText, 'utf8') > MAX_IMPORT_BYTES) {
      return errorResponse(c, 413, 'payload_too_large', 'Файл импорта больше 5 МБ');
    }

    const format = detectImportFormat(bodyText, fileName, fileType);
    try {
      const report = await runImport(db, {
        format,
        contentType: fileType,
        bodyText,
        fileName,
        actor: c.get('adminActor'),
        now: nowFn(),
      });
      metrics.incImportRows('added', report.added);
      metrics.incImportRows('updated', report.updated - report.merged);
      metrics.incImportRows('merged', report.merged);
      metrics.incImportRows('unchanged', report.unchanged);
      metrics.incImportRows('rejected', report.rejected.length);
      return jsonResponse(c, report);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return errorResponse(c, 400, 'invalid_json', 'Невалидный JSON в файле импорта');
      }
      return errorResponse(
        c,
        400,
        'validation_error',
        err instanceof Error ? err.message : 'Ошибка разбора файла импорта',
        [{ field: 'file', message: err instanceof Error ? err.message : 'Ошибка формата' }],
      );
    }
  });

  app.get('/api/v1/admin/moderation', async (c) => {
    const queue = await listModerationQueue(
      db,
      {
        page: intParam(c.req.query('page'), 1, 1, 1000),
        page_size: intParam(c.req.query('page_size'), 50, 1, 50),
      },
      nowFn(),
    );
    return jsonResponse(c, queue);
  });

  app.post('/api/v1/admin/moderation/:id/resolve', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, 'invalid_json', 'Ожидается JSON с полем action');
    }
    const res = await resolveModerationItem(
      db,
      c.req.param('id'),
      body,
      c.get('adminActor'),
      nowFn(),
    );
    if (!res.ok) {
      return errorResponse(c, res.status, res.code, res.message, res.details ?? []);
    }
    return jsonResponse(c, { event: res.event, changes: res.changes });
  });

  app.get('/api/v1/admin/audit', async (c) => {
    const res = await listAuditEntries(db, {
      entity_id: c.req.query('entity_id')?.slice(0, 64) || undefined,
      action: c.req.query('action')?.slice(0, 64) || undefined,
      page: intParam(c.req.query('page'), 1, 1, 1000),
      page_size: intParam(c.req.query('page_size'), 50, 1, 50),
    });
    return jsonResponse(c, res);
  });

  app.get('/api/v1/admin/applications', async (c) => {
    const status = c.req.query('status');
    return jsonResponse(c, await listApplications(db, status));
  });

  app.patch('/api/v1/admin/applications/:id', async (c) => {
    let body: { status?: unknown };
    try {
      body = (await c.req.json()) as { status?: unknown };
    } catch {
      return errorResponse(c, 400, 'invalid_json', 'Ожидается JSON с полем status');
    }
    if (body.status !== 'done' && body.status !== 'new') {
      return errorResponse(c, 400, 'validation_error', 'Статус обращения должен быть new или done', [
        { field: 'status', message: 'Допустимо: new, done' },
      ]);
    }
    const res = await patchApplicationStatus(
      db,
      c.req.param('id'),
      body.status,
      c.get('adminActor'),
      nowFn(),
    );
    if (!res.ok) {
      return errorResponse(c, res.status, res.code, res.message);
    }
    return jsonResponse(c, res.application);
  });

  app.post('/api/v1/admin/reset', async (c) => {
    const res = await resetDemoData(db, c.get('adminActor'), config.publicWebUrl, nowFn());
    return jsonResponse(c, res);
  });

  app.get('/api/v1/admin/traces', async (c) => {
    const res = await listAgentTraces(db, intParam(c.req.query('limit'), 50, 1, 100));
    return jsonResponse(c, res);
  });

  app.get('/api/v1/admin/traces/:id', async (c) => {
    const trace = await getAgentTrace(db, c.req.param('id'));
    if (!trace) {
      return errorResponse(c, 404, 'not_found', 'Трасса не найдена');
    }
    return jsonResponse(c, trace);
  });

  // --- 405 Method Not Allowed / 404 Not Found в общем формате Error ---

  app.all('*', (c) => {
    const path = new URL(c.req.url).pathname;
    const matched = KNOWN_ROUTE_METHODS.find((r) => r.pattern.test(path));
    if (matched) {
      return errorResponse(
        c,
        405,
        'method_not_allowed',
        `Метод ${c.req.method} не поддерживается для ${path}`,
        [],
        { Allow: matched.allow },
      );
    }
    return errorResponse(c, 404, 'not_found', `Маршрут ${path} не найден`);
  });

  return app;
}
