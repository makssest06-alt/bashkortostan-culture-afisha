/**
 * GET /api/v1/events/{id}
 * Карточка события со всеми сеансами, включая отменённые и перенесённые.
 */

import { findEvent } from '../../../../../lib/api/db';
import {
  CACHE_CARD,
  internalError,
  jsonWithEtag,
  methodNotAllowed,
  notFound,
  preflight,
  requestIdOf,
} from '../../../../../lib/api/http';
import { toApiEvent } from '../../../../../lib/api/wire';
import { USES_REMOTE_API } from '../../../../../lib/api/config';
import { forwardToBackend } from '../../../../../lib/api/forward';

const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  // Бэк подключён (NEXT_PUBLIC_API_BASE_URL): ответ берётся из него, моки ниже не участвуют.
  if (USES_REMOTE_API) return forwardToBackend(request);

  const requestId = requestIdOf(request);
  try {
    const { id } = await context.params;
    const event = ID_PATTERN.test(id) ? findEvent(id) : null;
    if (!event) {
      return notFound('Событие не найдено. Проверьте идентификатор или откройте каталог: /api/v1/events', requestId);
    }
    // ETag по содержимому: повторный запрос с If-None-Match получает 304 (п. 6.3 «Кеширование»).
    return jsonWithEtag(request, toApiEvent(event), CACHE_CARD, requestId);
  } catch (error) {
    return internalError(error, requestId);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
