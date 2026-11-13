/**
 * GET /api/v1/events
 * Список событий с фильтрами, сортировкой, счётчиками и вариантами ослабить условия.
 */

import { internalError, json, methodNotAllowed, preflight, requestIdOf, validationError } from '../../../../lib/api/http';
import { parseEventsQuery } from '../../../../lib/api/params';
import { searchEvents } from '../../../../lib/api/search';
import { toApiEventsList } from '../../../../lib/api/wire';
import { USES_REMOTE_API } from '../../../../lib/api/config';
import { forwardToBackend } from '../../../../lib/api/forward';

export function GET(request: Request): Response | Promise<Response> {
  // Бэк подключён (NEXT_PUBLIC_API_BASE_URL): ответ берётся из него, моки ниже не участвуют.
  if (USES_REMOTE_API) return forwardToBackend(request);

  const requestId = requestIdOf(request);
  try {
    const parsed = parseEventsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return validationError(parsed.issues, requestId);
    // Событие уходит в форме контракта п. 8.1 (см. lib/api/wire.ts).
    return json(toApiEventsList(searchEvents(parsed.value)), { requestId });
  } catch (error) {
    return internalError(error, requestId);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
