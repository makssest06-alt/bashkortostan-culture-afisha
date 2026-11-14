import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { Database } from '../../db/adapter.js';
import type { MetricsRegistry } from '../../observability/metrics.js';
import { isCategoryId, isCitySlug, findCity } from '../dictionaries.js';
import { findEventByIdOrCode, loadAllEvents } from '../events-repo.js';
import { submitFeedback } from '../feedback.js';
import type { SlidingRateLimiter } from '../rate-limit.js';
import { maskPii } from './nlu.js';
import { UUID_PATTERN, SLUG_PATTERN } from '../identity.js';
import {
  buildCatalogRelaxations,
  computeOpenApiFacets,
  findSimilarEvents,
  parseEventsSearchParams,
  runCatalogSearch,
  toListItem,
  type EventsSearchFilters,
} from '../search.js';
import { createSubscription, USER_REF_PATTERN } from '../subscriptions.js';
import { daysBetween, formatRfc3339Local, isValidYmd, localNow } from '../time.js';
import type { ApiEvent, CategoryId, CityId, DatePreset } from '../types.js';

export const MAX_TOOL_CALLS_PER_ANSWER = 5;
export const DESCRIPTION_MAX_CHARS = 300;
/** P0-4: 5 минут достаточно, чтобы нажать «Подтвердить» в диалоге. */
export const CONFIRMATION_TTL_SECONDS = 300;
export const TOOL_TIMEOUT_MS = 3000;
/**
 * P0-4: 24 случайных байта (192 бита) вместо 6 (48 бит) — перебор токенов невозможен.
 * В БД хранится только SHA-256 хеш токена, сам токен не пишется.
 */
export const CONFIRMATION_TOKEN_BYTES = 24;

export interface ToolError {
  code:
    | 'invalid_arguments'
    | 'not_found'
    | 'already_exists'
    | 'rate_limited'
    | 'unavailable'
    | 'timeout'
    | 'internal_error'
    | 'step_limit_exceeded'
    | 'confirmation_declined'
    | 'confirmation_expired';
  message: string;
  retryable: boolean;
  http_status?: number;
  request_id?: string;
}

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };

export interface TraceStep {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  error_code?: string;
  duration_ms: number;
  returned_ids: string[];
}

export interface ToolRuntimeContext {
  requestId: string;
  userRef?: string;
  channel?: 'telegram' | 'web' | 'api';
  clientIp?: string;
  confirmationToken?: string;
  confirmPayload?: {
    name?: string;
    contact?: string;
    organization?: string | null;
  };
  rateLimiter?: SlidingRateLimiter;
  retentionDays?: number;
  metrics?: MetricsRegistry;
  now?: Date;
}

function newConfirmationToken(): { token: string; tokenHash: string } {
  const token = `cnf_${randomBytes(CONFIRMATION_TOKEN_BYTES).toString('base64url')}`;
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') };
}

/** Ограниченное представление события для контекста языковой модели (model_view из contracts/agent_tools.json). */export function toModelViewEvent(ev: ApiEvent): Record<string, unknown> {
  const rawDesc = (ev.description ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const trimmedDesc =
    rawDesc.length > DESCRIPTION_MAX_CHARS
      ? `${rawDesc.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
      : rawDesc;

  return {
    id: ev.id,
    title: ev.title,
    category: ev.category,
    tags: ev.tags,
    date_start: ev.date_start,
    date_end: ev.date_end,
    time_precision: ev.time_precision,
    duration_min: ev.duration_min,
    city: ev.city,
    venue: ev.venue,
    venue_id: ev.venue_id,
    address: ev.address,
    price_min: ev.price_min,
    price_max: ev.price_max,
    is_free: ev.is_free,
    age_limit: ev.age_limit,
    language: ev.language,
    status: ev.status,
    source_url: ev.source_url,
    org_link: ev.org_link,
    description: trimmedDesc ? `<untrusted_event_data>${trimmedDesc}</untrusted_event_data>` : '',
  };
}

export const AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_events',
      description:
        'Поиск опубликованных событий по фильтрам. Неизвестная цена или возраст не проходят фильтры price_max и age: смотри hidden_unknown_price и hidden_unknown_age. Если ничего не найдено, предложи варианты из relaxations.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          city: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }, maxItems: 5 },
          category: {
            type: 'array',
            items: { enum: ['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other'] },
            maxItems: 7,
          },
          date: { type: 'string', pattern: '^(today|tomorrow|weekend|week|[0-9]{4}-[0-9]{2}-[0-9]{2})$' },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
          time_from: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
          time_to: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
          fits_from: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
          fits_to: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
          category_exclude: {
            type: 'array',
            items: { enum: ['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other'] },
            maxItems: 7,
          },
          price_max: { type: 'integer', minimum: 0 },
          free: { type: 'boolean' },
          age: { type: 'integer', minimum: 0, maximum: 120 },
          age_rating: { type: 'array', items: { enum: ['0+', '6+', '12+', '16+', '18+'] }, maxItems: 5 },
          venue_id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
          language: { type: 'string', pattern: '^[a-z]{2,3}$' },
          q: { type: 'string', minLength: 1, maxLength: 200 },
          sort: { enum: ['date', 'price', 'popularity'] },
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_event',
      description: 'Полная карточка события по id. Отдаёт и отменённые события (помечай «Отменено»).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_similar',
      description: 'Похожие опубликованные события: та же категория или общие метки.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          city: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          date: { type: 'string' },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
          page_size: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_venue_schedule',
      description: 'Расписание площадки за период, не длиннее 31 дня.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['venue_id', 'date_from', 'date_to'],
        properties: {
          venue_id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'subscribe',
      description:
        'Подписка на новые события по городу, категории и периоду. Возвращает confirmation_required до подтверждения пользователем.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          city: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
          category: { enum: ['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other'] },
          period: { enum: ['today', 'tomorrow', 'weekend', 'week'] },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_feedback',
      description:
        'Заявка или вопрос организатору по событию. Возвращает confirmation_required до подтверждения пользователем.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          kind: { enum: ['organizer_application', 'correction', 'question'] },
          event_id: { type: 'string' },
          text: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
    },
  },
];

const SearchSchema = z
  .object({
    city: z.array(z.string().regex(SLUG_PATTERN)).max(5).optional(),
    category: z
      .array(z.enum(['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other']))
      .max(7)
      .optional(),
    date: z.string().regex(/^(today|tomorrow|weekend|week|[0-9]{4}-[0-9]{2}-[0-9]{2})$/).optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    time_from: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    time_to: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    fits_from: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    fits_to: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    category_exclude: z
      .array(z.enum(['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other']))
      .max(7)
      .optional(),
    price_max: z.number().int().min(0).optional(),
    free: z.boolean().optional(),
    age: z.number().int().min(0).max(120).optional(),
    age_rating: z.array(z.enum(['0+', '6+', '12+', '16+', '18+'])).max(5).optional(),
    venue_id: z.string().regex(SLUG_PATTERN).optional(),
    language: z.string().regex(/^[a-z]{2,3}$/).optional(),
    q: z.string().min(1).max(200).optional(),
    sort: z.enum(['date', 'price', 'popularity']).optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const SubscribeToolSchema = z
  .object({
    city: z.string().regex(SLUG_PATTERN).optional(),
    category: z.enum(['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other']).optional(),
    period: z.enum(['today', 'tomorrow', 'weekend', 'week']).optional(),
  })
  .strict();

const FeedbackToolSchema = z
  .object({
    kind: z.enum(['organizer_application', 'correction', 'question']).default('question'),
    event_id: z.string().optional(),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();

export class ToolRuntime {
  readonly steps: TraceStep[] = [];
  readonly groundedIds = new Set<string>();
  readonly groundedEvents = new Map<string, ApiEvent>();
  private callCount = 0;
  private readonly timeoutMs: number;

  constructor(
    private readonly db: Database,
    private readonly ctx: ToolRuntimeContext & { timeoutMs?: number },
  ) {
    this.timeoutMs = Math.max(50, ctx.timeoutMs ?? TOOL_TIMEOUT_MS);
  }

  get callsUsed(): number {
    return this.callCount;
  }

  async searchWithConstraints(filters: EventsSearchFilters, today: string) {
    const startMs = Date.now();
    const now = this.ctx.now ?? new Date();
    this.callCount += 1;
    const { events } = await loadAllEvents(this.db, { statuses: ['published'], now });
    const outcome = runCatalogSearch(events, filters);
    const items = outcome.matches.map(toListItem);
    const returnedIds = items.slice(0, filters.page_size).map((item) => item.id);
    for (const item of items.slice(0, filters.page_size)) {
      this.groundedIds.add(item.id);
      this.groundedEvents.set(item.id, item);
    }
    const relaxations = items.length === 0 ? buildCatalogRelaxations(events, filters, today) : [];
    this.steps.push({
      step: this.callCount,
      tool: 'search_events',
      args: {
        city: filters.cities,
        category: filters.categories,
        date_from: filters.date_from,
        date_to: filters.date_to,
        price_max: filters.price_max,
        max_total_price: filters.max_total_price ?? null,
        free_only: filters.free_only,
        age: filters.age,
        q: filters.q ? maskPii(filters.q).slice(0, 200) : null,
      },
      ok: true,
      duration_ms: Date.now() - startMs,
      returned_ids: returnedIds,
    });
    return { outcome, items, allEvents: events, relaxations };
  }

  async getAllPublishedEvents(): Promise<ApiEvent[]> {
    const now = this.ctx.now ?? new Date();
    const { events } = await loadAllEvents(this.db, { statuses: ['published'], now });
    return events;
  }

  async execute(name: string, rawArgs: unknown): Promise<ToolResult<unknown>> {
    const startMs = Date.now();
    this.callCount += 1;
    if (this.callCount > MAX_TOOL_CALLS_PER_ANSWER) {
      const err: ToolError = {
        code: 'step_limit_exceeded',
        message: `Превышен лимит вызовов инструментов за один ответ (${MAX_TOOL_CALLS_PER_ANSWER})`,
        retryable: false,
        request_id: this.ctx.requestId,
      };
      this.steps.push({
        step: this.callCount,
        tool: name,
        args: traceArgs(name, rawArgs),
        ok: false,
        error_code: err.code,
        duration_ms: Date.now() - startMs,
        returned_ids: [],
      });
      return { ok: false, error: err };
    }

    const returnedIds: string[] = [];

    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        this.dispatch(name, rawArgs, returnedIds),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(Object.assign(new Error(`Превышено время ожидания инструмента (${this.timeoutMs} мс)`), { code: 'timeout' }));
          }, this.timeoutMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      for (const id of returnedIds) this.groundedIds.add(id);
      this.steps.push({
        step: this.callCount,
        tool: name,
        args: traceArgs(name, rawArgs),
        ok: result.ok,
        ...(result.ok ? {} : { error_code: result.error.code }),
        duration_ms: Date.now() - startMs,
        returned_ids: returnedIds,
      });
      return result;
    } catch (error) {
      const isTimeout = Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'timeout');
      const err: ToolError = {
        code: isTimeout ? 'timeout' : 'internal_error',
        message: error instanceof Error ? error.message : 'Ошибка выполнения инструмента',
        retryable: isTimeout,
        http_status: isTimeout ? 504 : 500,
        request_id: this.ctx.requestId,
      };
      this.steps.push({
        step: this.callCount,
        tool: name,
        args: traceArgs(name, rawArgs),
        ok: false,
        error_code: err.code,
        duration_ms: Date.now() - startMs,
        returned_ids: [],
      });
      return { ok: false, error: err };
    }
  }

  private async dispatch(
    name: string,
    rawArgs: unknown,
    returnedIds: string[],
  ): Promise<ToolResult<unknown>> {
    const now = this.ctx.now ?? new Date();
    const { date: today } = localNow(now);

    if (name === 'search_events') {
      const parsed = SearchSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return invalidArgs('Некорректные фильтры search_events', this.ctx.requestId);
      }
      const p = parsed.data;
      const url = new URL('http://local/events');
      if (p.city?.length) url.searchParams.set('city', p.city.join(','));
      if (p.category?.length) url.searchParams.set('category', p.category.join(','));
      if (p.category_exclude?.length) url.searchParams.set('category_exclude', p.category_exclude.join(','));
      if (p.date) url.searchParams.set('date', p.date);
      if (p.date_from) url.searchParams.set('date_from', p.date_from);
      if (p.date_to) url.searchParams.set('date_to', p.date_to);
      if (p.time_from) url.searchParams.set('time_from', p.time_from);
      if (p.time_to) url.searchParams.set('time_to', p.time_to);
      if (p.fits_from) url.searchParams.set('fits_from', p.fits_from);
      if (p.fits_to) url.searchParams.set('fits_to', p.fits_to);
      if (p.price_max !== undefined) url.searchParams.set('price_max', String(p.price_max));
      if (p.free !== undefined) url.searchParams.set('free', String(p.free));
      if (p.age !== undefined) url.searchParams.set('age', String(p.age));
      if (p.age_rating?.length) url.searchParams.set('age_rating', p.age_rating.join(','));
      if (p.venue_id) url.searchParams.set('venue_id', p.venue_id);
      if (p.language) url.searchParams.set('language', p.language);
      if (p.q) url.searchParams.set('q', p.q);
      if (p.sort) url.searchParams.set('sort', p.sort);
      url.searchParams.set('page', String(p.page ?? 1));
      url.searchParams.set('page_size', String(p.page_size ?? 5));

      const validated = parseEventsSearchParams(url, now);
      if (!validated.ok) {
        return invalidArgs(validated.issues[0]?.message ?? 'Некорректные параметры поиска', this.ctx.requestId);
      }

      const { events } = await loadAllEvents(this.db, { statuses: ['published'], now });
      const searchOutcome = runCatalogSearch(events, validated.filters);
      const total = searchOutcome.matches.length;
      const pageSize = validated.filters.page_size;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
      const offset = (validated.filters.page - 1) * pageSize;
      const slice = searchOutcome.matches.slice(offset, offset + pageSize).map(toListItem);
      for (const item of slice) {
        returnedIds.push(item.id);
        this.groundedEvents.set(item.id, item);
      }

      const relaxations =
        total === 0 ? buildCatalogRelaxations(events, validated.filters, today) : [];
      const facets = computeOpenApiFacets(events, validated.filters);

      return {
        ok: true,
        data: {
          items: slice,
          page: validated.filters.page,
          page_size: pageSize,
          total,
          total_pages: totalPages,
          facets,
          relaxations,
          hidden_unknown_price: searchOutcome.hidden_unknown_price,
          hidden_unknown_age: searchOutcome.hidden_unknown_age,
        },
      };
    }

    if (name === 'get_event') {
      const id = (rawArgs as { id?: unknown })?.id;
      if (typeof id !== 'string') {
        return invalidArgs('Параметр id обязателен', this.ctx.requestId);
      }
      const res = await findEventByIdOrCode(this.db, id, { includeDrafts: false, now });
      if (res.invalidId) {
        return invalidArgs('Параметр id должен быть UUID события', this.ctx.requestId);
      }
      if (!res.event) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: 'Событие не найдено',
            retryable: false,
            http_status: 404,
            request_id: this.ctx.requestId,
          },
        };
      }
      returnedIds.push(res.event.id);
      this.groundedEvents.set(res.event.id, res.event);
      return { ok: true, data: res.event };
    }

    if (name === 'find_similar') {
      const body = rawArgs as Record<string, unknown>;
      const id = typeof body?.id === 'string' ? body.id : '';
      const baseRes = await findEventByIdOrCode(this.db, id, { includeDrafts: false, now });
      if (baseRes.invalidId) {
        return invalidArgs('Некорректный UUID исходного события', this.ctx.requestId);
      }
      if (!baseRes.event) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: 'Исходное событие не найдено',
            retryable: false,
            http_status: 404,
            request_id: this.ctx.requestId,
          },
        };
      }

      const cityOverride = Array.isArray(body.city)
        ? body.city.filter((c): c is CityId => typeof c === 'string' && isCitySlug(c))
        : undefined;
      const dateFrom = typeof body.date_from === 'string' && isValidYmd(body.date_from) ? body.date_from : null;
      const dateTo = typeof body.date_to === 'string' && isValidYmd(body.date_to) ? body.date_to : null;
      const pageSize =
        typeof body.page_size === 'number' && Number.isInteger(body.page_size)
          ? Math.min(Math.max(1, body.page_size), 10)
          : 5;

      const { events } = await loadAllEvents(this.db, { statuses: ['published'], now });
      const similar = findSimilarEvents(events, baseRes.event, {
        cities: cityOverride?.length ? cityOverride : undefined,
        date_from: dateFrom,
        date_to: dateTo,
        limit: pageSize,
      });
      for (const item of similar) {
        returnedIds.push(item.id);
        this.groundedEvents.set(item.id, item);
      }
      return {
        ok: true,
        data: {
          items: similar,
          page: 1,
          page_size: pageSize,
          total: similar.length,
          total_pages: similar.length > 0 ? 1 : 0,
        },
      };
    }

    if (name === 'get_venue_schedule') {
      const body = rawArgs as Record<string, unknown>;
      const venueId = typeof body?.venue_id === 'string' ? body.venue_id : '';
      const dateFrom = typeof body?.date_from === 'string' ? body.date_from : '';
      const dateTo = typeof body?.date_to === 'string' ? body.date_to : '';
      if (!SLUG_PATTERN.test(venueId) || !isValidYmd(dateFrom) || !isValidYmd(dateTo)) {
        return invalidArgs('Требуются venue_id, date_from и date_to в формате YYYY-MM-DD', this.ctx.requestId);
      }
      if (dateTo < dateFrom || daysBetween(dateFrom, dateTo) > 31) {
        return invalidArgs('Период расписания площадки должен быть от 0 до 31 дня', this.ctx.requestId);
      }
      const venueRes = await this.db.query<{
        id: string;
        name: string;
        city_slug: string;
        address: string | null;
        lat: number | null;
        lon: number | null;
      }>('SELECT id, name, city_slug, address, lat, lon FROM venues WHERE id = $1', [venueId]);
      if (venueRes.rows.length === 0) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: 'Площадка не найдена',
            retryable: false,
            http_status: 404,
            request_id: this.ctx.requestId,
          },
        };
      }
      const v = venueRes.rows[0];
      const cityName = findCity(v.city_slug)?.name.ru ?? v.city_slug;
      const { events } = await loadAllEvents(this.db, { statuses: ['published'], now });
      const matched = runCatalogSearch(
        events,
        {
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
          venue_id: venueId,
          language: null,
          statuses: ['scheduled', 'rescheduled'],
          statuses_explicit: false,
          q: null,
          sort: 'date',
          page: 1,
          page_size: 50,
        },
      ).matches.map((m) => m.event);
      for (const ev of matched) {
        returnedIds.push(ev.id);
        this.groundedEvents.set(ev.id, ev);
      }

      return {
        ok: true,
        data: {
          venue: {
            id: v.id,
            name: v.name,
            city_id: v.city_slug,
            city: cityName,
            address: v.address,
            lat: v.lat,
            lon: v.lon,
          },
          date_from: dateFrom,
          date_to: dateTo,
          items: matched,
        },
      };
    }

    if (name === 'subscribe') {
      const parsed = SubscribeToolSchema.safeParse(rawArgs);
      if (!parsed.success || (!parsed.data.city && !parsed.data.category && !parsed.data.period)) {
        return invalidArgs('Укажите хотя бы одно условие подписки: city, category или period', this.ctx.requestId);
      }
      const args = parsed.data;
      if (args.city && !isCitySlug(args.city)) {
        return invalidArgs(`Неизвестный город «${args.city}»`, this.ctx.requestId);
      }
      if (args.category && !isCategoryId(args.category)) {
        return invalidArgs(`Неизвестная категория «${args.category}»`, this.ctx.requestId);
      }

      const cityLabel = args.city ? findCity(args.city)?.name.ru ?? args.city : 'любой город';
      const catLabel = args.category ?? 'все категории';
      const periodLabel = args.period ?? 'любой период';
      const summary = `Подписка: ${cityLabel}, ${catLabel}, ${periodLabel}`;

      if (!this.ctx.confirmationToken) {
        // P0-4: подписка подтверждается только привязанным к user_ref токеном.
        if (!this.ctx.userRef) {
          return invalidArgs(
            'Для подписки через ассистента нужен user_ref в запросе (user_ref)',
            this.ctx.requestId,
          );
        }
        const { token, tokenHash } = newConfirmationToken();
        const expiresAt = formatRfc3339Local(now.getTime() + CONFIRMATION_TTL_SECONDS * 1000);
        await this.db.query(
          `INSERT INTO agent_confirmations (token, action, user_ref, payload, summary, expires_at)
           VALUES ($1, 'subscribe', $2, $3::jsonb, $4, $5)`,
          [tokenHash, this.ctx.userRef, JSON.stringify(args), summary, expiresAt],
        );
        return {
          ok: true,
          data: {
            status: 'confirmation_required',
            confirmation_id: token,
            summary,
            expires_at: expiresAt,
          },
        };
      }

      const subRes = await createSubscription(
        this.db,
        {
          channel: this.ctx.channel ?? 'web',
          user_ref: this.ctx.userRef ?? 'web_anonymous_user_0001',
          city: (args.city as CityId | undefined) ?? null,
          category: (args.category as CategoryId | undefined) ?? null,
          period: (args.period as DatePreset | undefined) ?? null,
        },
        now,
      );
      if (!subRes.ok) {
        return {
          ok: false,
          error: {
            code: subRes.status === 409 ? 'already_exists' : 'invalid_arguments',
            message: subRes.message,
            retryable: false,
            http_status: subRes.status,
            request_id: this.ctx.requestId,
          },
        };
      }
      return { ok: true, data: { status: 'done', subscription: subRes.subscription } };
    }

    if (name === 'save_feedback') {
      const parsed = FeedbackToolSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return invalidArgs('Укажите текст обращения (text) и корректный kind', this.ctx.requestId);
      }
      const args = parsed.data;
      if (args.event_id && !UUID_PATTERN.test(args.event_id) && !/^evt_[a-z0-9_]+$/i.test(args.event_id)) {
        return invalidArgs('Некорректный event_id для обращения', this.ctx.requestId);
      }
      const summary = args.event_id
        ? `Обращение (${args.kind}) по событию ${args.event_id}`
        : `Обращение (${args.kind})`;

      if (!this.ctx.confirmationToken) {
        const { token, tokenHash } = newConfirmationToken();
        const expiresAt = formatRfc3339Local(now.getTime() + CONFIRMATION_TTL_SECONDS * 1000);
        await this.db.query(
          `INSERT INTO agent_confirmations (token, action, user_ref, payload, summary, expires_at)
           VALUES ($1, 'save_feedback', $2, $3::jsonb, $4, $5)`,
          [tokenHash, this.ctx.userRef ?? null, JSON.stringify(args), summary, expiresAt],
        );
        return {
          ok: true,
          data: {
            status: 'confirmation_required',
            confirmation_id: token,
            summary,
            expires_at: expiresAt,
          },
        };
      }

      const fbRes = await submitFeedback(
        this.db,
        {
          kind: args.kind,
          event_id: args.event_id ?? null,
          ...(this.ctx.userRef ? { user_ref: this.ctx.userRef } : {}),
          name: this.ctx.confirmPayload?.name ?? 'Пользователь ассистента',
          contact: this.ctx.confirmPayload?.contact ?? 'не указан',
          organization: this.ctx.confirmPayload?.organization ?? null,
          text: args.text,
          website: '',
        },
        {
          clientIp: this.ctx.clientIp ?? '127.0.0.1',
          rateLimiter: this.ctx.rateLimiter,
          retentionDays: this.ctx.retentionDays,
          metrics: this.ctx.metrics,
          now,
        },
      );
      if (!fbRes.ok) {
        return {
          ok: false,
          error: {
            code: fbRes.status === 429 ? 'rate_limited' : 'invalid_arguments',
            message: fbRes.message,
            retryable: fbRes.status === 429,
            http_status: fbRes.status,
            request_id: this.ctx.requestId,
          },
        };
      }
      return {
        ok: true,
        data: { status: 'done', feedback: { id: fbRes.id, status: fbRes.status } },
      };
    }

    return invalidArgs(`Неизвестный инструмент «${name}»`, this.ctx.requestId);
  }
}

export async function confirmPendingAction(
  db: Database,
  body: unknown,
  ctx: Omit<ToolRuntimeContext, 'confirmationToken'>,
): Promise<ToolResult<unknown>> {
  const bodyObj = (body ?? {}) as Record<string, unknown>;
  const token = bodyObj.confirmation_id;
  if (typeof token !== 'string' || !token.startsWith('cnf_')) {
    return invalidArgs('Передайте корректный confirmation_id', ctx.requestId);
  }
  const requesterUserRef = typeof bodyObj.user_ref === 'string' ? bodyObj.user_ref.trim() : '';
  if (requesterUserRef && !USER_REF_PATTERN.test(requesterUserRef)) {
    return invalidArgs('Некорректный user_ref', ctx.requestId);
  }
  const rejected = bodyObj.confirm === false || bodyObj.decision === 'reject';
  // P0-4: ищем по хешу токена — в БД сам токен не хранится.
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const res = await db.query<{
    token: string;
    action: 'subscribe' | 'save_feedback';
    user_ref: string | null;
    payload: Record<string, unknown> | string;
    summary: string;
    expires_at: Date | string;
    used_at: Date | string | null;
  }>('SELECT * FROM agent_confirmations WHERE token = $1', [tokenHash]);

  if (res.rows.length === 0) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: 'Запрос на подтверждение не найден',
        retryable: false,
        http_status: 404,
        request_id: ctx.requestId,
      },
    };
  }

  const row = res.rows[0];
  if (row.used_at) {
    return {
      ok: false,
      error: {
        code: 'confirmation_expired',
        message: 'Токен подтверждения уже использован',
        retryable: false,
        http_status: 409,
        request_id: ctx.requestId,
      },
    };
  }

  const expMs = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at));
  const now = ctx.now ?? new Date();
  if (expMs <= now.getTime()) {
    return {
      ok: false,
      error: {
        code: 'confirmation_expired',
        message: 'Время подтверждения истекло',
        retryable: false,
        http_status: 410,
        request_id: ctx.requestId,
      },
    };
  }

  // P0-4: токен, созданный для конкретного user_ref, нельзя подтвердить чужим user_ref.
  if (row.user_ref) {
    if (!requesterUserRef) {
      return invalidArgs(
        'Для подтверждения действия нужен user_ref владельца',
        ctx.requestId,
      );
    }
    if (row.user_ref !== requesterUserRef) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: 'Запрос на подтверждение не найден',
          retryable: false,
          http_status: 404,
          request_id: ctx.requestId,
        },
      };
    }
  }

  const auditActor = requesterUserRef
    ? `assistant:user:${createHash('sha256').update(requesterUserRef).digest('hex').slice(0, 12)}`
    : 'assistant:anonymous';

  // Атомарно «забираем» токен до выполнения действия: два параллельных confirm
  // не смогут выполнить одно действие дважды.
  const claim = await db.query<{
    action: 'subscribe' | 'save_feedback';
    user_ref: string | null;
    payload: Record<string, unknown> | string;
    summary: string;
  }>(
    `UPDATE agent_confirmations
     SET used_at = $2
     WHERE token = $1
       AND used_at IS NULL
       AND expires_at > $2
     RETURNING action, user_ref, payload, summary`,
    [tokenHash, formatRfc3339Local(now)],
  );

  if (claim.rows.length === 0) {
    return {
      ok: false,
      error: {
        code: 'confirmation_expired',
        message: 'Токен подтверждения уже использован',
        retryable: false,
        http_status: 409,
        request_id: ctx.requestId,
      },
    };
  }

  const claimed = claim.rows[0];

  const writeAudit = async (decision: 'approve' | 'reject') => {
    await db.query(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes)
       VALUES ($1, $2, $3, 'confirm', 'agent_confirmation', $4, $5, $6::jsonb)`,
      [
        randomUUID(),
        formatRfc3339Local(now),
        auditActor,
        tokenHash,
        claimed.summary.slice(0, 200),
        JSON.stringify([
          { field: 'action', from: null, to: claimed.action },
          { field: 'decision', from: null, to: decision },
        ]),
      ],
    );
  };

  if (rejected) {
    await writeAudit('reject');
    return {
      ok: true,
      data: {
        status: 'rejected',
        message: 'Действие отменено пользователем',
      },
    };
  }

  const payloadObj =
    typeof claimed.payload === 'string'
      ? (JSON.parse(claimed.payload) as Record<string, unknown>)
      : claimed.payload;
  const confirmFields = bodyObj;
  const runtime = new ToolRuntime(db, {
    ...ctx,
    userRef: claimed.user_ref ?? ctx.userRef,
    confirmationToken: token,
    confirmPayload: {
      name: typeof confirmFields.name === 'string' ? confirmFields.name : undefined,
      contact: typeof confirmFields.contact === 'string' ? confirmFields.contact : undefined,
      organization: typeof confirmFields.organization === 'string' ? confirmFields.organization : null,
    },
  });

  const execRes = await runtime.execute(claimed.action, payloadObj);
  if (execRes.ok) {
    await writeAudit('approve');
  }
  return execRes;
}

function invalidArgs(message: string, requestId: string): ToolResult<never> {
  return {
    ok: false,
    error: {
      code: 'invalid_arguments',
      message,
      retryable: false,
      http_status: 400,
      request_id: requestId,
    },
  };
}

function safeArgsRecord(rawArgs: unknown): Record<string, unknown> {
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    return rawArgs as Record<string, unknown>;
  }
  return {};
}

/**
 * P1: в трассы не пишем сырые ПДн. Текст обращения сохраняем только длиной,
 * остальные строки маскируем от email/телефонов и ограничиваем 200 символами.
 */
function traceArgs(name: string, rawArgs: unknown): Record<string, unknown> {
  const args = safeArgsRecord(rawArgs);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      if (name === 'save_feedback' && key === 'text') {
        out[key] = `[redacted ${value.length} chars]`;
      } else if (['name', 'contact', 'phone', 'email', 'organization'].includes(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = maskPii(value).slice(0, 200);
      }
    } else if (Array.isArray(value)) {
      out[key] = value
        .slice(0, 20)
        .map((item) => (typeof item === 'string' ? maskPii(item).slice(0, 200) : item));
    } else {
      out[key] = value;
    }
  }
  return out;
}
