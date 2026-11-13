/**
 * GET /api/v1/admin/events: все события любого статуса для модератора.
 * Параметры: status (published, draft, cancelled), disputed (true, false), source (demo, import), q, page, page_size.
 */

import { withAdmin, intParam } from '../../../../../lib/admin/route-kit';
import { listAdminEvents } from '../../../../../lib/admin/service';
import { json, methodNotAllowed, preflight, validationError } from '../../../../../lib/api/http';
import type { EventStatus } from '../../../../../lib/api/types';

const STATUSES: readonly EventStatus[] = ['published', 'draft', 'cancelled'];

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => {
    const params = new URL(request.url).searchParams;
    const status = params.get('status');
    if (status && !STATUSES.includes(status as EventStatus)) {
      return validationError([{ field: 'status', message: 'Статус: published, draft или cancelled' }], requestId);
    }
    const disputed = params.get('disputed');
    const source = params.get('source');
    return json(
      listAdminEvents({
        status: (status as EventStatus) || undefined,
        disputed: disputed === null || disputed === '' ? undefined : disputed === 'true',
        source: source === 'demo' || source === 'import' ? source : undefined,
        q: params.get('q')?.slice(0, 100) || undefined,
        page: intParam(params.get('page'), 1),
        page_size: intParam(params.get('page_size'), 25),
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
