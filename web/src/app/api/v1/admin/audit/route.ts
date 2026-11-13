/** GET /api/v1/admin/audit: журнал изменений «кто, когда, что», новые сверху. Параметры: entity_id, page, page_size. */

import { intParam, withAdmin } from '../../../../../lib/admin/route-kit';
import { listAudit } from '../../../../../lib/admin/service';
import { json, methodNotAllowed, preflight } from '../../../../../lib/api/http';

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => {
    const params = new URL(request.url).searchParams;
    return json(
      listAudit({
        entity_id: params.get('entity_id')?.slice(0, 64) || undefined,
        page: intParam(params.get('page'), 1),
        page_size: intParam(params.get('page_size'), 50),
      }),
      { requestId },
    );
  });
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
