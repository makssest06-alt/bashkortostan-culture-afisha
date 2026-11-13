/**
 * POST /api/v1/admin/moderation/{id}/resolve: решение по спорной карточке.
 * Тело: { "action": "publish" | "keep_draft" | "cancel" | "merge", "merge_into": "<uuid>", "comment": "…" }.
 */

import { withAdmin } from '../../../../../../../lib/admin/route-kit';
import { resolveDisputed } from '../../../../../../../lib/admin/service';
import type { ModerationAction } from '../../../../../../../lib/admin/service';
import { errorResponse, json, methodNotAllowed, notFound, preflight, validationError } from '../../../../../../../lib/api/http';

const ACTIONS: readonly ModerationAction[] = ['publish', 'keep_draft', 'cancel', 'merge'];

export function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAdmin(request, async ({ requestId, actor }) => {
    const { id } = await context.params;
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) return notFound('Событие не найдено', requestId);
    let body: { action?: unknown; comment?: unknown; merge_into?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse(400, 'invalid_json', 'Ожидается JSON: { "action": "publish" }', undefined, { requestId });
    }
    if (!ACTIONS.includes(body.action as ModerationAction)) {
      return validationError([{ field: 'action', message: 'Решение: publish, keep_draft, cancel или merge' }], requestId);
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim() || null : null;
    const mergeInto = typeof body.merge_into === 'string' ? body.merge_into.slice(0, 64) : null;
    const result = resolveDisputed(id, body.action as ModerationAction, comment, actor, new Date(), mergeInto);
    if (!result.ok) return errorResponse(result.status, result.code, result.message, result.details, { requestId });
    return json({ event: result.event, changes: result.changes }, { requestId });
  });
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('POST, OPTIONS');

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
