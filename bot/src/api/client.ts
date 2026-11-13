import { randomUUID } from 'node:crypto';

import {
  ApiErrorBodySchema,
  CategoryListSchema,
  CityListSchema,
  EventListResponseSchema,
  EventSchema,
  HealthSchema,
  SubscriptionListSchema,
  SubscriptionSchema,
  type Category,
  type City,
  type Event,
  type EventListResponse,
  type Health,
  type Subscription,
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

export interface SearchEventsParams {
  q?: string | null;
  city?: string | null;
  category?: string | null;
  /** Пресет (`today`, `tomorrow`, `weekend`, `week`) или `ГГГГ-ММ-ДД`. */
  date?: string | null;
  /** Потолок цены за человека; события с неизвестной ценой не проходят. */
  price_max?: number | null;
  /** Только события с явной пометкой «бесплатно». */
  free?: boolean | null;
  page?: number;
  page_size?: number;
  sort?: 'date' | 'price' | 'popularity' | null;
}

export interface CreateSubscriptionInput {
  channel: 'telegram';
  user_ref: string;
  city: string | null;
  category: string | null;
  period: 'today' | 'tomorrow' | 'weekend' | 'week' | null;
}

export interface ApiClient {
  health: () => Promise<Health>;
  searchEvents: (params?: SearchEventsParams) => Promise<EventListResponse>;
  getEvent: (id: string) => Promise<Event>;
  getCities: () => Promise<City[]>;
  getCategories: () => Promise<Category[]>;
  listSubscriptions: (userRef: string) => Promise<Subscription[]>;
  createSubscription: (input: CreateSubscriptionInput) => Promise<Subscription>;
  deleteSubscription: (id: string, userRef: string) => Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
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

  async function request<T>(
    path: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
    init?: RequestInit,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const requestId = randomUUID();
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          accept: 'application/json',
          'x-request-id': requestId,
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...init?.headers,
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
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
      return undefined as T;
    }

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
      if (params.q?.trim()) query.set('q', params.q.trim().slice(0, 200));
      if (params.city) query.set('city', params.city);
      if (params.category) query.set('category', params.category);
      if (params.date) query.set('date', params.date);
      if (params.price_max !== null && params.price_max !== undefined) {
        query.set('price_max', String(params.price_max));
      }
      if (params.free === true) query.set('free', 'true');
      if (params.sort) query.set('sort', params.sort);
      query.set('page', String(params.page ?? 1));
      query.set('page_size', String(params.page_size ?? 5));
      return request(`/api/v1/events?${query.toString()}`, EventListResponseSchema);
    },

    async getEvent(id) {
      return request(`/api/v1/events/${encodeURIComponent(id)}`, EventSchema);
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
      const query = new URLSearchParams({ user_ref: userRef });
      const result = await request(`/api/v1/subscriptions?${query.toString()}`, SubscriptionListSchema);
      return result.items;
    },

    async createSubscription(input) {
      return request('/api/v1/subscriptions', SubscriptionSchema, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    async deleteSubscription(id, userRef) {
      const query = new URLSearchParams({ user_ref: userRef });
      await request(`/api/v1/subscriptions/${encodeURIComponent(id)}?${query.toString()}`, {
        safeParse: (value) => ({ success: true, data: value }),
      }, { method: 'DELETE' });
    },
  };
}
