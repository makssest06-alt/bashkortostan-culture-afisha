import { randomUUID } from 'node:crypto';

import {
  ApiErrorBodySchema,
  AssistantResponseSchema,
  CategoryListSchema,
  CityListSchema,
  EventListResponseSchema,
  EventSchema,
  HealthSchema,
  SubscriptionListSchema,
  SubscriptionSchema,
  VenueScheduleSchema,
  type AssistantResponse,
  type Category,
  type City,
  type Event,
  type EventListResponse,
  type Health,
  type Subscription,
  type VenueSchedule,
} from './types.js';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'contract';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly details: { field?: string; message: string }[];
  readonly userMessage: string;
  /** Идентификатор запроса для логов и кода обращения в интерфейсе. */
  readonly requestId: string | null;

  constructor(
    message: string,
    options: {
      kind: ApiErrorKind;
      status?: number | null;
      code?: string | null;
      details?: { field?: string; message: string }[];
      userMessage?: string;
      requestId?: string | null;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.details = options.details ?? [];
    this.userMessage = options.userMessage ?? 'Сервис афиши временно недоступен. Попробуйте ещё раз через минуту.';
    this.requestId = options.requestId ?? null;
  }
}

export type SearchSort = 'date' | 'price' | 'popularity';

export interface SearchEventsParams {
  q?: string | null;
  city?: string | null;
  category?: string | null;
  /** Пресет (`today`, `tomorrow`, `weekend`, `week`) или `ГГГГ-ММ-ДД`. */
  date?: string | null;
  /** Начало периода включительно, местная дата `ГГГГ-ММ-ДД`. */
  date_from?: string | null;
  /** Конец периода включительно, местная дата `ГГГГ-ММ-ДД`. */
  date_to?: string | null;
  /** Потолок цены за человека; события с неизвестной ценой не проходят. */
  price_max?: number | null;
  /** Только события с явной пометкой «бесплатно». */
  free?: boolean | null;
  /** Возраст посетителя; проходят события с `age_limit <= age`. */
  age?: number | null;
  /** Код площадки. */
  venue_id?: string | null;
  /** Язык мероприятия по ISO 639. */
  language?: string | null;
  page?: number;
  page_size?: number;
  sort?: SearchSort | null;
}

export interface SimilarEventsParams {
  city?: string | null;
  /** Пресет (`today`, `tomorrow`, `weekend`, `week`) или `ГГГГ-ММ-ДД`. */
  date?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  page?: number;
  page_size?: number;
}

export interface VenueScheduleParams {
  date_from: string;
  date_to: string;
}

export interface CreateSubscriptionInput {
  channel: 'telegram';
  user_ref: string;
  city: string | null;
  category: string | null;
  period: 'today' | 'tomorrow' | 'weekend' | 'week' | null;
}

export interface AssistantPatch {
  reset?: boolean;
  set?: Record<string, unknown>;
  unset?: string[];
}

export interface AssistantQueryInput {
  message?: string;
  previous?: Record<string, unknown> | null;
  patch?: AssistantPatch | null;
  /** Код уточнения, на который отвечает пользователь. */
  answering?: string | null;
  /** Не больше 12 реплик, как в контракте. */
  history?: { role: 'user' | 'assistant'; content: string }[];
  limit?: number;
  user_ref?: string;
  channel?: 'telegram' | 'web' | 'api';
}

export interface ApiClient {
  health: () => Promise<Health>;
  searchEvents: (params?: SearchEventsParams) => Promise<EventListResponse>;
  getEvent: (id: string) => Promise<Event>;
  getSimilarEvents: (id: string, params?: SimilarEventsParams) => Promise<EventListResponse>;
  getVenueSchedule: (venueId: string, params: VenueScheduleParams) => Promise<VenueSchedule>;
  getCities: () => Promise<City[]>;
  getCategories: () => Promise<Category[]>;
  listSubscriptions: (userRef: string) => Promise<Subscription[]>;
  createSubscription: (input: CreateSubscriptionInput) => Promise<Subscription>;
  deleteSubscription: (id: string, userRef: string) => Promise<void>;
  queryAssistant: (input: AssistantQueryInput) => Promise<AssistantResponse>;
  confirmAssistant: (
    confirmationId: string,
    decision: 'approve' | 'reject',
    userRef: string,
  ) => Promise<{ status?: string; message?: string }>;
}

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Повторы только для идемпотентных GET при сети, таймауте, 429 и 5xx. */
  retryAttempts?: number;
  fetchImpl?: typeof fetch;
}

interface EventCacheEntry {
  etag: string;
  data: Event;
  expiresAt: number;
}

/**
 * Кеш карточек событий. В пределах TTL повторный просмотр не ходит в сеть,
 * после TTL идёт ревалидация `If-None-Match`: 304 продлевает TTL и отдаёт кеш,
 * 200 (новый ETag) обновляет и данные, и метку.
 */
const EVENT_CACHE_TTL_MS = 60_000;
const EVENT_CACHE_MAX = 200;
const eventCache = new Map<string, EventCacheEntry>();

function cacheEvent(key: string, event: Event, etag: string | null): void {
  if (!etag) return;
  if (eventCache.size >= EVENT_CACHE_MAX && !eventCache.has(key)) {
    const oldest = eventCache.keys().next().value;
    if (oldest !== undefined) eventCache.delete(oldest);
  }
  eventCache.set(key, { etag, data: event, expiresAt: Date.now() + EVENT_CACHE_TTL_MS });
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '').replace(/\/+$/, '');
}

function describeContractIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || 'response'}: ${issue.message}`)
    .join('; ');
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryAttempts = Math.max(0, Math.min(5, options.retryAttempts ?? 0));

  function isIdempotent(init?: RequestInit): boolean {
    const method = (init?.method ?? 'GET').toUpperCase();
    return method === 'GET' || method === 'HEAD';
  }

  /** Разумный максимум ожидания внутри обработки сообщения. */
  const MAX_RETRY_WAIT_MS = 5_000;

  function retryDelay(attempt: number): number {
    return Math.min(1_500, 200 * 2 ** attempt) + Math.floor(Math.random() * 100);
  }

  /** `Retry-After` в секундах или HTTP-дате; null — заголовка нет/он битый. */
  function retryAfterMs(response: Response): number | null {
    const raw = response.headers.get('retry-after')?.trim();
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(raw);
    if (Number.isNaN(date)) return null;
    return Math.max(0, date - Date.now());
  }

  async function fetchWithRetry(
    url: string,
    init: RequestInit,
    requestId: string,
  ): Promise<Response> {
    const attempts = isIdempotent(init) ? retryAttempts : 0;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          ...init,
          headers: { 'x-request-id': requestId, ...init.headers },
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        lastError = error;
        if (attempt === attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
        continue;
      }

      const retriable =
        response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (!retriable || attempt === attempts) return response;

      // Если сервер просит ждать дольше, чем пользователь готов ждать в чате,
      // не спим внутри обработчика: отдаём 429 и понятное сообщение.
      const retryAfter = response.status === 429 ? retryAfterMs(response) : null;
      if (retryAfter !== null && retryAfter > MAX_RETRY_WAIT_MS) return response;

      // Тело ответа не нужно: соединение освобождаем чтением.
      await response.text().catch(() => '');
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfter ?? retryDelay(attempt)),
      );
    }
    throw lastError ?? new Error('Не удалось выполнить запрос');
  }

  async function request<T>(
    path: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
    init?: RequestInit,
    hooks?: {
      /** Вызывается на 200/204 до разбора тела — например, чтобы прочитать ETag. */
      onOk?: (response: Response) => void;
      /** Вызывается на 304; вернуть данные из кеша или undefined, чтобы считать 304 ошибкой. */
      onNotModified?: () => T | undefined;
    },
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const requestId = randomUUID();
    let response: Response;
    try {
      response = await fetchWithRetry(
        url,
        {
          ...init,
          headers: {
            accept: 'application/json',
            ...(init?.body ? { 'content-type': 'application/json' } : {}),
            ...init?.headers,
          },
        },
        requestId,
      );
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new ApiError(timedOut ? 'API не ответил за отведённое время' : 'Не удалось связаться с API', {
        kind: timedOut ? 'timeout' : 'network',
        requestId,
        cause: error,
        userMessage: timedOut
          ? 'Сервис афиши отвечает слишком долго. Попробуйте ещё раз через минуту.'
          : 'Сервис афиши сейчас недоступен. Попробуйте ещё раз через минуту.',
      });
    }

    const responseRequestId = response.headers.get('x-request-id') ?? requestId;

    if (response.status === 304) {
      const cached = hooks?.onNotModified?.();
      if (cached !== undefined) return cached;
      throw new ApiError('API вернул 304, но кеша для этого ответа нет', {
        kind: 'contract',
        status: 304,
        requestId: responseRequestId,
      });
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      const parsedError = ApiErrorBodySchema.safeParse(body);
      const errorBody = parsedError.success ? parsedError.data : null;
      const code = errorBody?.code ?? null;
      let userMessage = errorBody?.message ?? 'Сервис афиши вернул ошибку. Попробуйте ещё раз.';

      if (response.status === 404 && code === 'not_found') {
        userMessage = errorBody?.message ?? 'Запись не найдена.';
      } else if (response.status === 409) {
        userMessage = 'Такая подписка уже оформлена.';
      } else if (response.status === 400 && code === 'validation_error') {
        userMessage = errorBody?.message ?? 'Проверьте параметры запроса.';
      }

      throw new ApiError(`API ${response.status}${code ? ` ${code}` : ''}: ${errorBody?.message ?? 'без описания'}`, {
        kind: 'http',
        status: response.status,
        code,
        details: errorBody?.details ?? [],
        userMessage,
        requestId: errorBody?.request_id ?? responseRequestId,
      });
    }

    if (response.status === 204) {
      hooks?.onOk?.(response);
      return undefined as T;
    }

    hooks?.onOk?.(response);

    const raw = await response.text();
    let payload: unknown;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch (error) {
      throw new ApiError('API вернул не JSON', {
        kind: 'contract',
        status: response.status,
        requestId: responseRequestId,
        cause: error,
      });
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(`Ответ API не соответствует контракту: ${describeContractIssues(parsed.error.issues)}`, {
        kind: 'contract',
        status: response.status,
        requestId: responseRequestId,
      });
    }
    return parsed.data;
  }

  return {
    async health() {
      return request('/api/v1/health', HealthSchema);
    },

    async searchEvents(params = {}) {
      const query = new URLSearchParams();
      // Контракт допускает 200 знаков, но бэкенд PR #19 режет запрос на 100.
      // Ограничиваем здесь, чтобы одинаково работать с обоими.
      if (params.q?.trim()) query.set('q', params.q.trim().slice(0, 100));
      if (params.city) query.set('city', params.city);
      if (params.category) query.set('category', params.category);
      // API запрещает смешивать конкретную дату и период. Период важнее:
      // он приходит из явного выбора «с 20 по 25», а дата — из пресета.
      if (params.date_from || params.date_to) {
        if (params.date_from) query.set('date_from', params.date_from);
        if (params.date_to) query.set('date_to', params.date_to);
      } else if (params.date) {
        query.set('date', params.date);
      }
      if (params.price_max !== null && params.price_max !== undefined) {
        query.set('price_max', String(params.price_max));
      }
      if (params.free === true) query.set('free', 'true');
      if (params.age !== null && params.age !== undefined) {
        query.set('age', String(params.age));
      }
      if (params.venue_id) query.set('venue_id', params.venue_id);
      if (params.language) query.set('language', params.language);
      if (params.sort) query.set('sort', params.sort);
      query.set('page', String(params.page ?? 1));
      query.set('page_size', String(params.page_size ?? 5));
      return request(`/api/v1/events?${query.toString()}`, EventListResponseSchema);
    },

    async getEvent(id) {
      const key = encodeURIComponent(id);
      const cached = eventCache.get(key);
      // Свежая запись отдаётся без сети; устаревшая ревалидируется по ETag.
      if (cached && cached.expiresAt > Date.now()) return cached.data;

      let etag: string | null = null;
      let revalidated = false;
      const event = await request(
        `/api/v1/events/${key}`,
        EventSchema,
        cached ? { headers: { 'if-none-match': cached.etag } } : undefined,
        {
          onOk: (response) => {
            etag = response.headers.get('etag');
          },
          onNotModified: () => {
            if (cached) {
              eventCache.set(key, { ...cached, expiresAt: Date.now() + EVENT_CACHE_TTL_MS });
              revalidated = true;
              return cached.data;
            }
            return undefined;
          },
        },
      );
      if (!revalidated) cacheEvent(key, event, etag);
      return event;
    },

    async getSimilarEvents(id, params = {}) {
      const query = new URLSearchParams();
      if (params.city) query.set('city', params.city);
      if (params.date_from || params.date_to) {
        if (params.date_from) query.set('date_from', params.date_from);
        if (params.date_to) query.set('date_to', params.date_to);
      } else if (params.date) {
        query.set('date', params.date);
      }
      query.set('page', String(params.page ?? 1));
      query.set('page_size', String(params.page_size ?? 5));
      return request(
        `/api/v1/events/${encodeURIComponent(id)}/similar?${query.toString()}`,
        EventListResponseSchema,
      );
    },

    async getVenueSchedule(venueId, params) {
      const query = new URLSearchParams({
        date_from: params.date_from,
        date_to: params.date_to,
      });
      return request(
        `/api/v1/venues/${encodeURIComponent(venueId)}/schedule?${query.toString()}`,
        VenueScheduleSchema,
      );
    },

    async getCities() {
      const result = await request('/api/v1/cities', CityListSchema);
      return result.items;
    },

    async getCategories() {
      const result = await request('/api/v1/categories', CategoryListSchema);
      return result.items;
    },

    async listSubscriptions(userRef) {
      // P0-5: user_ref уходит заголовком Authorization, а не в query string.
      const result = await request('/api/v1/subscriptions', SubscriptionListSchema, {
        headers: { authorization: `Bearer ${userRef}` },
      });
      return result.items;
    },

    async createSubscription(input) {
      return request('/api/v1/subscriptions', SubscriptionSchema, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    async deleteSubscription(id, userRef) {
      await request(
        `/api/v1/subscriptions/${encodeURIComponent(id)}`,
        {
          safeParse: (value) => ({ success: true, data: value }),
        },
        { method: 'DELETE', headers: { authorization: `Bearer ${userRef}` } },
      );
    },

    async queryAssistant(input) {
      return request('/api/v1/assistant/query', AssistantResponseSchema, {
        method: 'POST',
        body: JSON.stringify({
          ...(input.message !== undefined ? { message: input.message } : {}),
          ...(input.previous ? { previous: input.previous } : {}),
          ...(input.patch ? { patch: input.patch } : {}),
          ...(input.answering ? { answering: input.answering } : {}),
          ...(input.history?.length ? { history: input.history.slice(-12) } : {}),
          limit: input.limit ?? 6,
          ...(input.user_ref ? { user_ref: input.user_ref } : {}),
          channel: input.channel ?? 'telegram',
        }),
      });
    },

    async confirmAssistant(confirmationId, decision, userRef) {
      return request(
        '/api/v1/assistant/confirm',
        {
          safeParse: (value) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              return { success: true as const, data: value as { status?: string; message?: string } };
            }
            return { success: true as const, data: {} };
          },
        },
        {
          method: 'POST',
          body: JSON.stringify({ confirmation_id: confirmationId, user_ref: userRef, decision }),
        },
      );
    },
  };
}
