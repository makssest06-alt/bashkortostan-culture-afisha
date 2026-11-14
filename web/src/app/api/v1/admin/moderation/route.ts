/** GET /api/v1/admin/moderation: очередь спорных карточек, сначала с наименьшей уверенностью. */

import { intParam, withAdmin } from '../../../../../lib/admin/route-kit';
import { moderationQueue } from '../../../../../lib/admin/service';
import { json, methodNotAllowed, preflightAdmin } from '../../../../../lib/api/http';

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => {
    const params = new URL(request.url).searchParams;
    return json(moderationQueue({ page: intParam(params.get('page'), 1), page_size: intParam(params.get('page_size'), 50) }), {
      requestId,
    });
  });
}

export function OPTIONS(): Response {
  return preflightAdmin();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
