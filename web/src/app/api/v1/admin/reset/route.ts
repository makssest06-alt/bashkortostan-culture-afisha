/** POST /api/v1/admin/reset: вернуть демо-данные к исходному виду. Журнал сохраняется, сброс в нём записан. */

import { withAdmin } from '../../../../../lib/admin/route-kit';
import { resetDemo } from '../../../../../lib/admin/service';
import { json, methodNotAllowed, preflightAdmin } from '../../../../../lib/api/http';

export function POST(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId, actor }) => {
    resetDemo(actor);
    return json({ reset: true }, { requestId });
  });
}

export function OPTIONS(): Response {
  return preflightAdmin();
}

const notAllowed = methodNotAllowed('POST, OPTIONS');

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
