/**
 * Пересылка запросов /api/v1/* сайта в бэк, когда задан NEXT_PUBLIC_API_BASE_URL (./config).
 *
 * Сайт работает шлюзом: браузер, виджет на чужих сайтах и примеры curl со страницы /developers
 * говорят только с сайтом, а бэк может быть закрыт снаружи (в docker compose это http://api:8000).
 *
 * В бэк уходят только заголовки, нужные по контракту. Cookie сайта не уходит никогда.
 * Адрес посетителя передаётся в X-Forwarded-For: по нему бэк считает лимиты частоты,
 * иначе все посетители выглядели бы для бэка одним адресом сервера сайта.
 * Если бэк не ответил, сайт отвечает 503 unavailable в общем формате ошибок.
 */

import { API_BASE_URL } from './config';
import { CORS_HEADERS, errorResponse, logEvent, requestIdOf } from './http';

/** Заголовки запроса, которые сайт передаёт бэку. */
const REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'if-match', 'if-none-match', 'x-assistant-demo'];

/** Заголовки ответа бэка, которые сайт отдаёт дальше. CORS сайт ставит свои. */
const RESPONSE_HEADERS = ['content-type', 'etag', 'cache-control', 'last-modified', 'location', 'retry-after', 'x-request-id'];

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ForwardOptions {
  requestId?: string;
  /** Дополнительные заголовки к бэку, например Authorization для админки. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Адрес в бэке для запроса к сайту: тот же путь /api/v1/... и те же параметры. */
export function backendUrlOf(request: Request, base: string = API_BASE_URL): string {
  const { pathname, search } = new URL(request.url);
  return `${base}${pathname}${search}`;
}

function upstreamHeaders(request: Request, requestId: string, extra: Record<string, string>): Headers {
  const headers = new Headers({ 'X-Request-Id': requestId });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const forwardedFor = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor);
  const url = new URL(request.url);
  headers.set('X-Forwarded-Host', request.headers.get('host') ?? url.host);
  headers.set('X-Forwarded-Proto', request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', ''));
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

export async function forwardToBackend(request: Request, options: ForwardOptions = {}): Promise<Response> {
  const requestId = options.requestId ?? requestIdOf(request);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(backendUrlOf(request), {
      method: request.method,
      headers: upstreamHeaders(request, requestId, options.headers ?? {}),
      body: hasBody ? await request.arrayBuffer() : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch (error) {
    // В журнал идут адрес и причина, без тела запроса и заголовков.
    logEvent('error', 'backend_unreachable', {
      request_id: requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return errorResponse(503, 'unavailable', 'Бэк афиши не отвечает. Попробуйте позже.', undefined, { requestId });
  }

  const headers = new Headers(CORS_HEADERS);
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('x-request-id')) headers.set('X-Request-Id', requestId);
  const empty = request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
  return new Response(empty ? null : await upstream.arrayBuffer(), { status: upstream.status, headers });
}
