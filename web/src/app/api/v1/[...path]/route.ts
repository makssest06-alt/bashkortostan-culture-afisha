/**
 * Любой другой адрес под /api/v1.
 *
 * Сайт на моках: ответ 404 в общем формате ошибок и с заголовками CORS. Без этого файла
 * браузер на чужом сайте получил бы HTML-страницу без CORS и показал бы сетевую ошибку
 * вместо понятного сообщения.
 *
 * Бэк подключён (NEXT_PUBLIC_API_BASE_URL): методы контракта, которых нет в моках сайта
 * (/cities, /venues, /categories, /subscriptions, /events/{id}/similar…), пересылаются в бэк.
 * Админка сюда не пересылается: её пути идут только через проверку сессии (lib/admin/route-kit.ts).
 * /metrics тоже остаётся внутренним адресом бэка и через сайт наружу не открывается.
 */

import { USES_REMOTE_API } from '../../../../lib/api/config';
import { forwardToBackend } from '../../../../lib/api/forward';
import { notFound, preflight } from '../../../../lib/api/http';

const MESSAGE = 'Такого метода нет. Список методов: GET /api/v1';

/** Первые части пути, которые сайт никогда не пересылает без своей проверки. */
const NOT_FORWARDED = new Set(['admin', 'metrics']);

type Context = { params: Promise<{ path?: string[] }> };

async function respond(request: Request, context: Context): Promise<Response> {
  if (USES_REMOTE_API) {
    const { path = [] } = await context.params;
    if (path.length && !NOT_FORWARDED.has(path[0])) return forwardToBackend(request);
  }
  return notFound(MESSAGE);
}

export { respond as GET, respond as POST, respond as PUT, respond as PATCH, respond as DELETE };

export function OPTIONS(): Response {
  return preflight();
}
