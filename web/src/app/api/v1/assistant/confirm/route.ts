/**
 * POST /api/v1/assistant/confirm
 * Подтверждение или отмена мутирующего действия ассистента (подписка или обращение).
 */

import { USES_REMOTE_API } from '../../../../../lib/api/config';
import { forwardToBackend } from '../../../../../lib/api/forward';
import {
  errorResponse,
  internalError,
  json,
  methodNotAllowed,
  preflight,
  validationError,
} from '../../../../../lib/api/http';

const CONFIRM_TIMEOUT_MS = 15_000;

export async function POST(request: Request): Promise<Response> {
  try {
    if (USES_REMOTE_API) {
      return await forwardToBackend(request, { timeoutMs: CONFIRM_TIMEOUT_MS });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'invalid_json', 'Тело запроса должно быть корректным JSON');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return validationError([{ field: 'body', message: 'Ожидался объект JSON' }]);
    }

    const record = body as Record<string, unknown>;
    const confirmationId = typeof record.confirmation_id === 'string' ? record.confirmation_id.trim() : '';
    if (confirmationId.length < 4) {
      return validationError([{ field: 'confirmation_id', message: 'Нужен confirmation_id' }]);
    }

    const rejected = record.decision === 'reject' || record.confirm === false;
    return json({
      status: rejected ? 'rejected' : 'confirmed',
      message: rejected ? 'Действие отменено.' : 'Подтверждено в демо-режиме.',
    });
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('POST, OPTIONS');

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
