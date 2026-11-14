/**
 * Общие части обработчиков /api/v1: заголовки CORS, ответы JSON, ETag и ошибки.
 *
 * Публичный API открыт для любого сайта (Access-Control-Allow-Origin: *): так виджет
 * афиши работает на странице министерства и на сайтах партнёров. Публичные методы
 * не используют cookie. Админка ходит с токеном в заголовке Authorization или с cookie
 * своего сайта (SameSite=Strict), поэтому открытый CORS её не открывает чужим страницам.
 *
 * Каждый ответ несёт X-Request-Id, а ошибка приходит в одном формате:
 *   { "code": "validation_error", "message": "…", "details": [...], "request_id": "req_…" }
 */

import { createHash, randomUUID } from 'node:crypto';

import type { ApiErrorBody, ApiErrorDetail } from './types';

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, If-Match, If-None-Match, X-Request-Id, X-Assistant-Demo',
  'Access-Control-Expose-Headers': 'ETag, X-Request-Id, Retry-After, Location',
  'Access-Control-Max-Age': '86400',
};

/** Данные зависят от текущего времени, поэтому по умолчанию ответы не кэшируются. */
const NO_STORE = 'no-store';

/** Кэш справочников и карточек (п. 6.3): короткий, с ETag для повторной проверки. */
export const CACHE_CARD = 'public, max-age=60, must-revalidate';
export const CACHE_DICTIONARY = 'public, max-age=300, must-revalidate';

/** Идентификатор запроса: берётся из входящего X-Request-Id, если он безопасный, иначе новый. */
export function requestIdOf(request?: Request): string {
  const incoming = request?.headers.get('x-request-id');
  if (incoming && /^[A-Za-z0-9._:-]{8,64}$/.test(incoming)) return incoming;
  return `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export interface JsonOptions {
  status?: number;
  /** Значение Cache-Control. По умолчанию no-store. */
  cache?: string;
  requestId?: string;
  headers?: Record<string, string>;
}

export function json<T>(body: T, options: JsonOptions = {}): Response {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': options.cache ?? NO_STORE,
      'X-Request-Id': options.requestId ?? requestIdOf(),
      ...(options.headers ?? {}),
    },
  });
}

/** Слабый ETag по содержимому ответа. */
export function etagOf(body: unknown): string {
  return `W/"${createHash('sha1').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
}

/** Совпадает ли ETag с заголовком If-None-Match или If-Match (список через запятую, `*`). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (value: string) => value.trim().replace(/^W\//, '');
  return header.split(',').some((value) => value.trim() === '*' || bare(value) === bare(etag));
}

/**
 * Ответ с ETag: на повторный запрос с тем же If-None-Match приходит 304 без тела.
 * Так справочники и карточки можно перепроверять дёшево (п. 6.3 «Кеширование»).
 */
export function jsonWithEtag<T>(request: Request, body: T, cache: string, requestId?: string): Response {
  const etag = etagOf(body);
  const id = requestId ?? requestIdOf(request);
  if (etagMatches(request.headers.get('if-none-match'), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ...CORS_HEADERS, ETag: etag, 'Cache-Control': cache, 'X-Request-Id': id },
    });
  }
  return json(body, { cache, requestId: id, headers: { ETag: etag } });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: ApiErrorDetail[],
  options: { requestId?: string; headers?: Record<string, string> } = {},
): Response {
  const requestId = options.requestId ?? requestIdOf();
  const body: ApiErrorBody = { code, message, details: details ?? [], request_id: requestId };
  return json(body, { status, requestId, headers: options.headers });
}

/** Ошибка проверки параметров: 400 с перечнем полей. В message попадает первая причина. */
export function validationError(issues: ApiErrorDetail[], requestId?: string): Response {
  const first = issues[0]?.message ?? 'Параметры запроса не прошли проверку';
  return errorResponse(400, 'validation_error', first, issues, { requestId });
}

export function notFound(message: string, requestId?: string): Response {
  return errorResponse(404, 'not_found', message, undefined, { requestId });
}

/**
 * Обработчик для методов, которых у адреса нет: 405 в общем формате ошибок и с CORS.
 * Без него Next отвечает пустым 405 без заголовков, и браузер на чужом сайте
 * показывает сетевую ошибку вместо понятного сообщения.
 * @param allow разрешённые методы, как в заголовке Allow: 'GET, OPTIONS'.
 */
export function methodNotAllowed(allow: string): () => Response {
  return () =>
    errorResponse(405, 'method_not_allowed', `Этот адрес принимает только методы: ${allow}`, undefined, {
      headers: { Allow: allow },
    });
}

/** Структурная запись в журнал сервера: одна строка JSON, без персональных данных. */
export function logEvent(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** Неожиданный сбой: подробности остаются в журнале сервера, клиент их не видит. */
export function internalError(error: unknown, requestId?: string): Response {
  const id = requestId ?? requestIdOf();
  logEvent('error', 'api_internal_error', {
    request_id: id,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  return errorResponse(500, 'internal_error', 'Внутренняя ошибка сервера. Попробуйте повторить запрос.', undefined, {
    requestId: id,
  });
}

/** Ответ на предварительный запрос браузера (preflight). */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

/** Preflight админки: без публичных CORS-заголовков. */
export function preflightAdmin(): Response {
  return new Response(null, { status: 204, headers: { 'X-Content-Type-Options': 'nosniff' } });
}

/** Убирает публичные CORS-заголовки с ответов админки. */
export function stripCorsHeaders(response: Response): Response {
  for (const name of Object.keys(CORS_HEADERS)) response.headers.delete(name);
  return response;
}
