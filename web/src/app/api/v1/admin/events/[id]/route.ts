/**
 * GET   /api/v1/admin/events/{id}: событие любого статуса с ETag.
 * PATCH /api/v1/admin/events/{id}: частичная правка полей и статуса. Заголовок If-Match с ETag
 *       защищает от затирания чужой правки: если событие успели изменить, ответ 412.
 */

import { withAdmin } from '../../../../../../lib/admin/route-kit';
import { editEvent, getAdminEvent } from '../../../../../../lib/admin/service';
import { errorResponse, json, methodNotAllowed, notFound, preflight } from '../../../../../../lib/api/http';

type Context = { params: Promise<{ id: string }> };

const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

export function GET(request: Request, context: Context): Promise<Response> {
  return withAdmin(request, async ({ requestId }) => {
    const { id } = await context.params;
    const event = ID_PATTERN.test(id) ? getAdminEvent(id) : null;
    if (!event) return notFound('Событие не найдено', requestId);
    return json(event, { requestId, headers: { ETag: event.etag } });
  });
}

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withAdmin(request, async ({ requestId, actor }) => {
    const { id } = await context.params;
    if (!ID_PATTERN.test(id)) return notFound('Событие не найдено', requestId);
    const raw = await request.text();
    if (raw.length > 20_000) return errorResponse(413, 'payload_too_large', 'Правка слишком большая', undefined, { requestId });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return errorResponse(400, 'invalid_json', 'Тело правки должно быть JSON-объектом с полями события', undefined, { requestId });
    }
    const result = editEvent(id, body, request.headers.get('if-match'), actor);
    if (!result.ok) return errorResponse(result.status, result.code, result.message, result.details, { requestId });
    return json({ event: result.event, changes: result.changes }, { requestId, headers: { ETag: result.event.etag } });
  });
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, PATCH, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };
