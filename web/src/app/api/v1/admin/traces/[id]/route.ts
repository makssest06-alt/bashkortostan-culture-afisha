/**
 * GET /api/v1/admin/traces/{id}: полная трасса ответа ИИ-агента (план, вызовы инструментов, id оснований).
 */

import { withAdmin } from '../../../../../../lib/admin/route-kit';
import { methodNotAllowed, notFound, preflight } from '../../../../../../lib/api/http';

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => notFound('Трасса агента не найдена', requestId));
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
