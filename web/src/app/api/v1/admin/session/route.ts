/**
 * Вход в админку.
 *   GET    состояние: режим (token, open, disabled), вошёл ли модератор и под каким именем;
 *   POST   { token, name } → cookie сессии (HttpOnly, SameSite=Strict); 10 попыток в 10 минут с одного адреса;
 *   DELETE выход.
 */

import {
  NAME_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  adminMode,
  cleanActor,
  isSecureRequest,
  requireAdmin,
  sessionValue,
  tokenMatches,
} from '../../../../../lib/admin/auth';
import { errorResponse, internalError, json, methodNotAllowed, preflight, requestIdOf } from '../../../../../lib/api/http';
import { clientIp, hitRate } from '../../../../../lib/api/rate-limit';

function cookie(name: string, value: string, maxAge: number, secure: boolean, httpOnly = true): string {
  return [`${name}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Strict', httpOnly ? 'HttpOnly' : '', secure ? 'Secure' : '']
    .filter(Boolean)
    .join('; ');
}

export function GET(request: Request): Response {
  const requestId = requestIdOf(request);
  const mode = adminMode();
  const auth = mode === 'disabled' ? null : requireAdmin(request, requestId);
  return json(
    { mode, authenticated: Boolean(auth?.ok), actor: auth?.ok ? auth.actor : null },
    { requestId, cache: 'no-store' },
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdOf(request);
  try {
    const mode = adminMode();
    if (mode === 'disabled') {
      return errorResponse(503, 'unavailable', 'Админка выключена: на сервере не задан ADMIN_TOKEN', undefined, { requestId });
    }
    const limit = hitRate(`admin-login:${clientIp(request)}`, 10, 10 * 60_000);
    if (!limit.ok) {
      return errorResponse(429, 'rate_limited', `Слишком много попыток входа. Попробуйте через ${Math.ceil(limit.retryAfter / 60)} мин.`, undefined, {
        requestId,
        headers: { 'Retry-After': String(limit.retryAfter) },
      });
    }
    let body: { token?: unknown; name?: unknown } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse(400, 'invalid_json', 'Ожидается JSON: { "token": "…", "name": "…" }', undefined, { requestId });
    }
    const name = cleanActor(typeof body.name === 'string' ? body.name : null, '');
    if (!name) {
      return errorResponse(400, 'validation_error', 'Укажите имя: оно попадёт в журнал изменений', [
        { field: 'name', message: 'Укажите имя: оно попадёт в журнал изменений' },
      ], { requestId });
    }
    if (mode === 'token' && !(typeof body.token === 'string' && tokenMatches(body.token))) {
      return errorResponse(401, 'unauthorized', 'Неверный токен модератора', [{ field: 'token', message: 'Неверный токен модератора' }], {
        requestId,
      });
    }
    const secure = isSecureRequest(request);
    const response = json({ mode, authenticated: true, actor: name }, { requestId });
    if (mode === 'token') response.headers.append('Set-Cookie', cookie(SESSION_COOKIE, sessionValue(), SESSION_MAX_AGE, secure));
    response.headers.append('Set-Cookie', cookie(NAME_COOKIE, encodeURIComponent(name), SESSION_MAX_AGE, secure));
    return response;
  } catch (error) {
    return internalError(error, requestId);
  }
}

export function DELETE(request: Request): Response {
  const requestId = requestIdOf(request);
  const secure = isSecureRequest(request);
  const response = json({ authenticated: false }, { requestId });
  response.headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0, secure));
  response.headers.append('Set-Cookie', cookie(NAME_COOKIE, '', 0, secure));
  return response;
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, POST, DELETE, OPTIONS');

export { notAllowed as PUT, notAllowed as PATCH };
