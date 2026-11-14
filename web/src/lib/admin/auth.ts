/**
 * Доступ к админке.
 *
 * Режимы:
 *   token     задан ADMIN_TOKEN (от 12 знаков в dev, от 32 в production): вход по токену, сессия в cookie HttpOnly + SameSite=Strict,
 *             или заголовок Authorization: Bearer <токен> для скриптов;
 *   open      локальная разработка без токена: админка открыта, над ней пометка «демо»;
 *   disabled  боевая сборка без токена: админка выключена, чтобы чужие не правили афишу.
 *
 * Для запросов по cookie, которые меняют данные, проверяется Origin: страница с другого
 * сайта не сможет отправить правку от имени модератора (CSRF).
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { errorResponse } from '../api/http';

export const SESSION_COOKIE = 'afisha_admin';
export const NAME_COOKIE = 'afisha_admin_name';
export const SESSION_MAX_AGE = 12 * 60 * 60;

export type AdminMode = 'token' | 'open' | 'disabled';

/** Заглушка из .env.example. Скопированный без правки пример не должен открывать админку известным всем токеном. */
export const EXAMPLE_ADMIN_TOKEN = 'change-me-to-a-long-random-string';

/** Токен модератора из ADMIN_TOKEN; заглушка из примера считается незаданным токеном. */
export function configuredAdminToken(): string | undefined {
  const token = process.env.ADMIN_TOKEN?.trim();
  return token && token !== EXAMPLE_ADMIN_TOKEN ? token : undefined;
}

export function adminMode(): AdminMode {
  const token = configuredAdminToken();
  // В production токен должен быть не короче 32 символов, как в бэкенде.
  const minLength = process.env.NODE_ENV === 'production' ? 32 : 12;
  if (token && token.length >= minLength) return 'token';
  // Открытая админка — только вне production. ADMIN_OPEN=1 в бою игнорируется.
  if (process.env.NODE_ENV !== 'production' && process.env.ADMIN_OPEN === '1') return 'open';
  return 'disabled';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** Значение cookie сессии: хеш токена, сам токен в браузер не попадает. */
export function sessionValue(): string {
  return digest(`afisha-admin-session:${configuredAdminToken() ?? ''}`).toString('hex');
}

export function tokenMatches(candidate: string): boolean {
  const token = configuredAdminToken();
  return Boolean(token) && safeEqual(candidate.trim(), token as string);
}

function cookieOf(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** Имя модератора для журнала: из cookie, без управляющих символов, до 60 знаков. */
export function cleanActor(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // оставляем как есть
  }
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
  return clean || fallback;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request): boolean {
  return request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
}

export type AdminAuth = { ok: true; actor: string; via: 'token' | 'cookie' | 'open' } | { ok: false; response: Response };

const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Проверка доступа к методу /api/v1/admin/*. */
export function requireAdmin(request: Request, requestId: string): AdminAuth {
  const mode = adminMode();
  if (mode === 'disabled') {
    return {
      ok: false,
      response: errorResponse(503, 'unavailable', 'Админка выключена: на сервере не задан ADMIN_TOKEN', undefined, { requestId }),
    };
  }
  const name = cleanActor(cookieOf(request, NAME_COOKIE), '');
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    if (mode === 'token' && tokenMatches(bearer)) return { ok: true, actor: cleanActor(request.headers.get('x-actor'), 'api'), via: 'token' };
    if (mode === 'open') return { ok: true, actor: cleanActor(request.headers.get('x-actor'), 'api'), via: 'open' };
    return { ok: false, response: errorResponse(401, 'unauthorized', 'Неверный токен модератора', undefined, { requestId }) };
  }

  const viaCookie = mode === 'token' && cookieOf(request, SESSION_COOKIE) === sessionValue();
  if (mode === 'token' && !viaCookie) {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'Войдите в админку: нужен токен модератора', undefined, { requestId }) };
  }
  if (UNSAFE.has(request.method) && !sameOrigin(request)) {
    return {
      ok: false,
      response: errorResponse(403, 'forbidden', 'Запрос пришёл не со страницы админки. Обновите страницу и повторите', undefined, {
        requestId,
      }),
    };
  }
  return { ok: true, actor: name || (mode === 'open' ? 'модератор (демо)' : 'модератор'), via: viaCookie ? 'cookie' : 'open' };
}
