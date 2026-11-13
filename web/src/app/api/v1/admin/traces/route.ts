/**
 * GET /api/v1/admin/traces: список трасс ИИ-агента (запрос, движок/модель, шаги, стоимость).
 * При подключённом бэке проксируется в PostgreSQL; на моках возвращает пустой список.
 */

import { withAdmin } from '../../../../../lib/admin/route-kit';
import { json, methodNotAllowed, preflight } from '../../../../../lib/api/http';

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => json({ items: [], total: 0 }, { requestId }));
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
