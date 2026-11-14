/**
 * Админка при подключённом бэке (NEXT_PUBLIC_API_BASE_URL задан).
 *
 * Страница /admin по-прежнему ходит в /api/v1/admin/* своего сайта и держит сессию в cookie.
 * Сайт проверяет cookie, а запрос пересылает в бэк с заголовком Authorization: Bearer ADMIN_TOKEN.
 * Токен остаётся на сервере сайта и в браузер не попадает; у сайта и бэка он должен совпадать.
 * Вход и выход (/api/v1/admin/session) обрабатывает сам сайт и в бэк не пересылает.
 */

import { forwardToBackend } from '../api/forward';
import { configuredAdminToken } from './auth';

/** Импорт большого файла бэк может разбирать дольше обычного запроса. */
const ADMIN_TIMEOUT_MS = 30_000;

export function forwardAdmin(request: Request, requestId: string, actor?: string): Promise<Response> {
  const token = configuredAdminToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (actor) headers['X-Actor'] = encodeURIComponent(actor);
  return forwardToBackend(request, {
    requestId,
    timeoutMs: ADMIN_TIMEOUT_MS,
    headers,
    maxBodyBytes: 6_000_000,
  });
}
