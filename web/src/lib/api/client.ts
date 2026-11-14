/**
 * Типизированный клиент REST API афиши для клиентских компонентов и виджета.
 *
 *   import { listEvents, askAssistant } from '@/lib/api/client';
 *
 * Куда идут запросы, решает NEXT_PUBLIC_API_BASE_URL (./config):
 * - в браузере fetch всегда идёт на /api/v1 этого же сайта; при подключённом бэке сайт
 *   пересылает эти запросы в бэк, без бэка отвечают моки;
 * - на сервере при подключённом бэке fetch идёт прямо в `${адрес}/api/v1/...`, без бэка
 *   функции берут данные из ./server без сетевого запроса.
 * Для серверного кода есть прямой импорт `@/lib/api/server` с теми же именами функций.
 */

import type { ApplicationKind } from '../admin/types';
import { API_BASE_URL } from './config';
import { DICTIONARIES } from '../../data/dictionaries';
import { eventsQueryToParams } from './params';
import { fromApiAssistantResponse, fromApiEvent, fromApiEventsList } from './wire';
import type { ApiAssistantResponse, ApiEventInput, ApiEventsListInput } from './wire';
import type {
  AfishaEvent,
  ApiErrorBody,
  ApiErrorDetail,
  AssistantConfirmRequest,
  AssistantConfirmResponse,
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
  /** Адрес API без /api/v1: `https://afisha.example`. По умолчанию в браузере текущий сайт, на сервере NEXT_PUBLIC_API_BASE_URL. */
  baseUrl?: string;
  /** Сигнал отмены: пригодится, когда пользователь быстро меняет фильтры. */
  signal?: AbortSignal;
  /** Дополнительные заголовки запроса (например, демо-переключатель недоступности ассистента). */
  headers?: Record<string, string>;
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
  const body = value as { code?: unknown; message?: unknown };
  return typeof body.code === 'string' && typeof body.message === 'string';
}

/**
 * Браузер всегда ходит на адрес самого сайта: при подключённом бэке сайт пересылает /api/v1/* в него
 * (./forward.ts). Так бэку не нужен CORS и его адрес может быть внутренним, например http://api:8000.
 * Сервер сайта ходит в бэк напрямую.
 */
function baseOf(options: ClientOptions): string {
  const fallback = typeof window === 'undefined' ? API_BASE_URL : '';
  return (options.baseUrl ?? fallback).replace(/\/+$/, '');
}

/** Нужно ли обойтись без сети: код выполняется на сервере, а бэк не задан (сайт на моках). */
function runsOnServer(options: ClientOptions): boolean {
  return typeof window === 'undefined' && !baseOf(options);
}

interface RequestSetup {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

async function request<T>(path: string, options: ClientOptions, setup: RequestSetup = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseOf(options)}${API_BASE_PATH}${path}`, {
      method: setup.method ?? 'GET',
      body: setup.body,
      signal: options.signal,
      headers: { Accept: 'application/json', ...(options.headers ?? {}), ...(setup.headers ?? {}) },
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
      throw new ApiClientError(response.status, body.code, body.message, body.details);
    }
    throw new ApiClientError(response.status, 'http_error', 'Афиша ответила ошибкой. Попробуйте ещё раз.');
  }
  return body as T;
}

/** 404 или 405 на сам адрес метода: бэк этого метода не реализует (он вне контракта v1). */
function isMissingMethod(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 405);
}

function withQuery(path: string, query: EventsQuery): string {
  const search = eventsQueryToParams(query).toString();
  return search ? `${path}?${search}` : path;
}

/** Список событий с фильтрами, счётчиками и вариантами ослабить условия. */
export async function listEvents(query: EventsQuery = {}, options: ClientOptions = {}): Promise<EventsListResponse> {
  if (runsOnServer(options)) return (await import('./server')).listEvents(query);
  return fromApiEventsList(await request<ApiEventsListInput>(withQuery('/events', query), options), query);
}

/** Событие со всеми сеансами. null, если события нет (ответ 404). */
export async function getEvent(id: string, options: ClientOptions = {}): Promise<AfishaEvent | null> {
  if (runsOnServer(options)) return (await import('./server')).getEvent(id);
  try {
    return fromApiEvent(await request<ApiEventInput>(`/events/${encodeURIComponent(id)}`, options));
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}

/** Справочники: категории, города, возрастные метки, статусы. */
export async function getDictionaries(options: ClientOptions = {}): Promise<Dictionaries> {
  if (runsOnServer(options)) return (await import('./server')).getDictionaries();
  try {
    return await request<Dictionaries>('/dictionaries', options);
  } catch (error) {
    // Справочников нет в контракте v1: если бэк их не отдаёт, подписи берутся из сайта.
    if (isMissingMethod(error)) return DICTIONARIES;
    throw error;
  }
}

/** Число событий по городам, категориям, возрасту и цене. */
export async function getFacets(query: EventsQuery = {}, options: ClientOptions = {}): Promise<FacetsResponse> {
  if (runsOnServer(options)) return (await import('./server')).getFacets(query);
  try {
    return await request<FacetsResponse>(withQuery('/facets', query), options);
  } catch (error) {
    // Отдельного /facets нет в контракте v1: тогда счётчики берутся из расширения ответа списка.
    if (!isMissingMethod(error)) throw error;
    const list = await listEvents({ ...query, page: 1, page_size: 1 }, options);
    if (!list.facets) throw error;
    return list.facets;
  }
}

/** Запрос к ассистенту: фраза, прежние условия или правка чипа. */
export async function askAssistant(
  payload: AssistantRequest,
  options: ClientOptions = {},
): Promise<AssistantResponse> {
  if (runsOnServer(options)) return (await import('./server')).askAssistant(payload);
  const response = await request<ApiAssistantResponse>('/assistant/query', options, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return fromApiAssistantResponse(response);
}

/** Подтверждение или отмена мутирующего действия агента (подписка/заявка). */
export async function confirmAssistantAction(
  payload: AssistantConfirmRequest,
  options: ClientOptions = {},
): Promise<AssistantConfirmResponse> {
  return request<AssistantConfirmResponse>('/assistant/confirm', options, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Тело POST /feedback. `website` — ловушка для ботов: люди оставляют поле пустым. */
export interface FeedbackPayload {
  kind: ApplicationKind;
  event_id: string | null;
  name: string;
  contact: string;
  organization: string | null;
  text: string;
  website: string;
}

/** Ответ 202 на обращение: номер и статус. */
export interface FeedbackAccepted {
  id: string;
  status: string;
}

/** Заявка организатора, исправление или вопрос с формы сайта. Ошибки полей приходят в ApiClientError.details. */
export async function sendFeedback(payload: FeedbackPayload, options: ClientOptions = {}): Promise<FeedbackAccepted> {
  return request<FeedbackAccepted>('/feedback', options, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Проверка, что API отвечает. */
export async function getHealth(options: ClientOptions = {}): Promise<HealthResponse> {
  return request<HealthResponse>('/health', options);
}
