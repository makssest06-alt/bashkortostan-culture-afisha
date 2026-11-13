/** PATCH /api/v1/admin/applications/{id}: отметить обращение обработанным. Тело: { "status": "done" | "new" }. */

import { randomUUID } from 'node:crypto';

import { withAdmin } from '../../../../../../lib/admin/route-kit';
import { mutate, readState } from '../../../../../../lib/admin/store';
import { KIND_LABEL } from '../../../../../../lib/api/feedback';
import { errorResponse, json, methodNotAllowed, notFound, preflight, validationError } from '../../../../../../lib/api/http';

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAdmin(request, async ({ requestId, actor }) => {
    const { id } = await context.params;
    const current = readState().applications.find((item) => item.id === id);
    if (!current) return notFound('Обращение не найдено: возможно, оно удалено по сроку хранения', requestId);
    let body: { status?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse(400, 'invalid_json', 'Ожидается JSON: { "status": "done" }', undefined, { requestId });
    }
    if (body.status !== 'done' && body.status !== 'new') {
      return validationError([{ field: 'status', message: 'Статус обращения: done или new' }], requestId);
    }
    const status = body.status;
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    mutate((state) => {
      state.applications = state.applications.map((item) => (item.id === id ? { ...item, status } : item));
      state.audit.push({
        id: `aud_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        at,
        actor,
        action: 'application',
        entity_type: 'application',
        entity_id: id,
        entity_title: KIND_LABEL[current.kind],
        changes: [{ field: 'status', from: current.status === 'done' ? 'обработано' : 'новое', to: status === 'done' ? 'обработано' : 'новое' }],
      });
    });
    return json({ ...current, status }, { requestId });
  });
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('PATCH, OPTIONS');

export { notAllowed as GET, notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };
