/** GET /api/v1/admin/applications: заявки и уточнения с формы сайта, новые сверху. Параметр status: new, done. */

import { withAdmin } from '../../../../../lib/admin/route-kit';
import { readState } from '../../../../../lib/admin/store';
import { json, methodNotAllowed, preflight } from '../../../../../lib/api/http';

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => {
    const status = new URL(request.url).searchParams.get('status');
    const items = [...readState().applications].reverse().filter((item) => !status || item.status === status);
    return json({ items, total: items.length }, { requestId });
  });
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
