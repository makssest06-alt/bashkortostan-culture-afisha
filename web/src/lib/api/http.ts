/**
 * Общие части обработчиков /api/v1: заголовки CORS, ответы JSON и ошибки.
 *
 * API открыт для любого сайта (Access-Control-Allow-Origin: *): так виджет
 * афиши работает на странице министерства и на сайтах партнёров. API только
 * читает данные и не использует cookie, поэтому открытый CORS здесь безопасен.
 */

import type { ApiErrorBody, ApiErrorDetail } from './types';

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

/** Данные зависят от текущего времени, поэтому по умолчанию ответы не кэшируются. */
const NO_STORE = 'no-store';

export interface JsonOptions {
  status?: number;
  /** Значение Cache-Control. По умолчанию no-store. */
  cache?: string;
}

export function json<T>(body: T, options: JsonOptions = {}): Response {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': options.cache ?? NO_STORE,
    },
  });
}

export function errorResponse(status: number, code: string, message: string, details?: ApiErrorDetail[]): Response {
  const body: ApiErrorBody = { error: { code, message } };
  if (details && details.length > 0) body.error.details = details;
  return json(body, { status });
}

/** Ошибка проверки параметров: 400 с перечнем полей. В message попадает первая причина. */
export function validationError(issues: ApiErrorDetail[]): Response {
  const first = issues[0]?.message ?? 'Параметры запроса не прошли проверку';
  return errorResponse(400, 'validation_error', first, issues);
}

export function notFound(message: string): Response {
  return errorResponse(404, 'not_found', message);
}

/**
 * Обработчик для методов, которых у адреса нет: 405 в общем формате ошибок и с CORS.
 * Без него Next отвечает пустым 405 без заголовков, и браузер на чужом сайте
 * показывает сетевую ошибку вместо понятного сообщения.
 * @param allow разрешённые методы, как в заголовке Allow: 'GET, OPTIONS'.
 */
export function methodNotAllowed(allow: string): () => Response {
  return () => {
    const response = errorResponse(405, 'method_not_allowed', `Этот адрес принимает только методы: ${allow}`);
    response.headers.set('Allow', allow);
    return response;
  };
}

/** Неожиданный сбой: подробности остаются в журнале сервера, клиент их не видит. */
export function internalError(error: unknown): Response {
  console.error('[api/v1] внутренняя ошибка', error);
  return errorResponse(500, 'internal_error', 'Внутренняя ошибка сервера. Попробуйте повторить запрос.');
}

/** Ответ на предварительный запрос браузера (preflight). */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}
