/**
 * GET /api/v1/dictionaries
 * Справочники: категории, города, возрастные метки, статусы с подписями на русском и башкирском.
 */

import { DICTIONARIES } from '../../../../data/dictionaries';
import { CACHE_DICTIONARY, internalError, jsonWithEtag, methodNotAllowed, preflight } from '../../../../lib/api/http';
import { USES_REMOTE_API } from '../../../../lib/api/config';
import { forwardToBackend } from '../../../../lib/api/forward';

export function GET(request: Request): Response | Promise<Response> {
  // Бэк подключён (NEXT_PUBLIC_API_BASE_URL): ответ берётся из него, моки ниже не участвуют.
  if (USES_REMOTE_API) return forwardToBackend(request);

  try {
    // Справочники меняются редко: пять минут в кэше и ETag для дешёвой перепроверки.
    return jsonWithEtag(request, DICTIONARIES, CACHE_DICTIONARY);
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
