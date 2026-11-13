/**
 * POST /api/v1/assistant/query
 * Подбор событий по фразе: уточнение, выдача с причинами или отказ на посторонний запрос.
 * Состояния на сервере нет: прежние условия клиент присылает в поле previous.
 */

import { runAssistant } from '../../../../../lib/api/assistant';
import {
  errorResponse,
  internalError,
  json,
  methodNotAllowed,
  preflight,
  validationError,
} from '../../../../../lib/api/http';
import { parseAssistantRequest } from '../../../../../lib/api/nlu/request';

/** Тело запроса с условиями и фразой укладывается в несколько килобайт. */
const MAX_BODY_LENGTH = 20_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_LENGTH) {
      return errorResponse(413, 'payload_too_large', 'Тело запроса слишком большое: не больше 20 000 знаков');
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return errorResponse(400, 'invalid_json', 'Тело запроса должно быть корректным JSON, например {"message": "куда пойти в субботу"}');
    }

    const parsed = parseAssistantRequest(body);
    if (!parsed.ok) return validationError(parsed.issues);
    return json(runAssistant(parsed.value));
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('POST, OPTIONS');

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
