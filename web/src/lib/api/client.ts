/**
 * Типизированный клиент REST API афиши для клиентских компонентов и виджета.
 *
 *   import { listEvents, askAssistant } from '@/lib/api/client';
 *
 * В браузере функции ходят в /api/v1 через fetch. Если их вызвали на сервере
 * (например, из серверного компонента по ошибке), они берут данные напрямую
 * из ./server без сетевого запроса. Для серверного кода есть и прямой импорт:
 * `@/lib/api/server` с теми же именами функций.
 */

import { eventsQueryToParams } from './params';
import type {
  AfishaEvent,
  ApiErrorBody,
  ApiErrorDetail,
  AssistantRequest,
  AssistantResponse,
  Dictionaries,
  EventsListResponse,
  EventsQuery,
  FacetsResponse,
  HealthResponse,
} from './types';

export const API_BASE_PATH = '/api/v1';

export interface ClientOptions {
  /** Адрес сайта афиши для вызова с чужого домена: `https://afisha.example`. По умолчанию текущий сайт. */
  baseUrl?: string;
  /** Сигнал отмены: пригодится, когда пользователь быстро меняет фильтры. */
  signal?: AbortSignal;
}

/** Ошибка API: код ответа, машинный код и понятное сообщение. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string';
}

/** Нужно ли обойтись без сети: код выполняется на сервере и чужой адрес не задан. */
function runsOnServer(options: ClientOptions): boolean {
  return typeof window === 'undefined' && !options.baseUrl;
}

interface RequestSetup {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

async function request<T>(path: string, options: ClientOptions, setup: RequestSetup = {}): Promise<T> {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}${API_BASE_PATH}${path}`, {
      method: setup.method ?? 'GET',
      body: setup.body,
      signal: options.signal,
      headers: { Accept: 'application/json', ...(setup.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'network_error', 'Нет связи с афишей. Проверьте интернет и попробуйте ещё раз.');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new ApiClientError(response.status, body.error.code, body.error.message, body.error.details);
    }
    throw new ApiClientError(response.status, 'http_error', 'Афиша ответила ошибкой. Попробуйте ещё раз.');
  }
  return body as T;
}

function withQuery(path: string, query: EventsQuery): string {
  const search = eventsQueryToParams(query).toString();
  return search ? `${path}?${search}` : path;
}

/** Список событий с фильтрами, счётчиками и вариантами ослабить условия. */
export async function listEvents(query: EventsQuery = {}, options: ClientOptions = {}): Promise<EventsListResponse> {
  if (runsOnServer(options)) return (await import('./server')).listEvents(query);
  return request<EventsListResponse>(withQuery('/events', query), options);
}

/** Событие со всеми сеансами. null, если события нет (ответ 404). */
export async function getEvent(id: string, options: ClientOptions = {}): Promise<AfishaEvent | null> {
  if (runsOnServer(options)) return (await import('./server')).getEvent(id);
  try {
    return await request<AfishaEvent>(`/events/${encodeURIComponent(id)}`, options);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}

/** Справочники: категории, города, возрастные метки, статусы. */
export async function getDictionaries(options: ClientOptions = {}): Promise<Dictionaries> {
  if (runsOnServer(options)) return (await import('./server')).getDictionaries();
  return request<Dictionaries>('/dictionaries', options);
}

/** Число событий по городам, категориям, возрасту и цене. */
export async function getFacets(query: EventsQuery = {}, options: ClientOptions = {}): Promise<FacetsResponse> {
  if (runsOnServer(options)) return (await import('./server')).getFacets(query);
  return request<FacetsResponse>(withQuery('/facets', query), options);
}

/** Запрос к ассистенту: фраза, прежние условия или правка чипа. */
export async function askAssistant(
  payload: AssistantRequest,
  options: ClientOptions = {},
): Promise<AssistantResponse> {
  if (runsOnServer(options)) return (await import('./server')).askAssistant(payload);
  return request<AssistantResponse>('/assistant/query', options, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Проверка, что API отвечает. */
export async function getHealth(options: ClientOptions = {}): Promise<HealthResponse> {
  return request<HealthResponse>('/health', options);
}
