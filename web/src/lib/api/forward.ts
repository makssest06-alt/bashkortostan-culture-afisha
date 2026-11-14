/**
 * Пересылка запросов /api/v1/* сайта в бэк, когда задан NEXT_PUBLIC_API_BASE_URL (./config).
 *
 * Сайт работает шлюзом: браузер, виджет на чужих сайтах и примеры curl со страницы /developers
 * говорят только с сайтом, а бэк может быть закрыт снаружи (в docker compose это http://api:8000).
 *
 * В бэк уходят только заголовки, нужные по контракту. Cookie сайта не уходит никогда.
 * Адрес посетителя передаётся в X-Forwarded-For только за доверенным reverse proxy
 * (`TRUST_PROXY_CLIENT_IP=1`): клиентский заголовок не пересылается, иначе лимиты
 * частоты обходились бы его подменой. Без флага бэк берёт адрес сокета соединения.
 * Если бэк не ответил, сайт отвечает 503 unavailable в общем формате ошибок.
 */

import { API_BASE_URL } from './config';
import { CORS_HEADERS, errorResponse, logEvent, requestIdOf } from './http';

/** Заголовки запроса, которые сайт передаёт бэку. */
const REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'if-match', 'if-none-match', 'x-assistant-demo'];

/** Заголовки ответа бэка, которые сайт отдаёт дальше. CORS сайт ставит свои. */
const RESPONSE_HEADERS = ['content-type', 'etag', 'cache-control', 'last-modified', 'location', 'retry-after', 'x-request-id'];

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export interface ForwardOptions {
  requestId?: string;
  /** Дополнительные заголовки к бэку, например Authorization для админки. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Потолок тела запроса до чтения в память. */
  maxBodyBytes?: number;
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
  // P0-2: клиентский X-Forwarded-For не пересылается в бэк — его подделывает любой,
  // кто стучится на сайт напрямую. Адрес клиента ставим только за доверенным
  // reverse proxy (TRUST_PROXY_CLIENT_IP=1), беря правый элемент цепочки — его
  // дописал сам прокси. Без флага бэк видит адрес сокета сайта и считает лимиты по нему.
  const forwardedFor = trustedClientIpOf(request);
  if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor);
  // P0-5: подписки принимают user_ref только в Authorization: Bearer. Проксируем
  // этот заголовок лишь для публичного API подписок — на остальных путях он не нужен.
  if (/^\/api\/v1\/subscriptions(?:\/|$)/.test(new URL(request.url).pathname)) {
    const authorization = request.headers.get('authorization');
    if (authorization) headers.set('Authorization', authorization);
  }
  const url = new URL(request.url);
  headers.set('X-Forwarded-Host', request.headers.get('host') ?? url.host);
  headers.set('X-Forwarded-Proto', request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', ''));
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

/** Адрес клиента из доверенного reverse proxy; null, если доверия нет. */
function trustedClientIpOf(request: Request): string | null {
  if (process.env.TRUST_PROXY_CLIENT_IP !== '1') return null;
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (chain.length > 0) return chain[chain.length - 1];
  return request.headers.get('x-real-ip')?.trim() || null;
}

/** Читает тело с потолком, не доверяя только Content-Length (chunked). */
export async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: Uint8Array } | { ok: false }> {  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, body: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

export async function forwardToBackend(request: Request, options: ForwardOptions = {}): Promise<Response> {
  const requestId = options.requestId ?? requestIdOf(request);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let body: Uint8Array | undefined;
  if (hasBody) {
    const limited = await readLimitedBody(request, maxBodyBytes);
    if (!limited.ok) {
      return errorResponse(413, 'payload_too_large', 'Тело запроса слишком большое', undefined, { requestId });
    }
    body = limited.body;
  }
  let upstream: Response;
  try {
    // ArrayBuffer — валидный BodyInit; Uint8Array<ArrayBufferLike> в новых типах TS им не является.
    const bodyInit = body
      ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
      : undefined;
    upstream = await fetch(backendUrlOf(request), {
      method: request.method,
      headers: upstreamHeaders(request, requestId, options.headers ?? {}),
      body: bodyInit,
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
