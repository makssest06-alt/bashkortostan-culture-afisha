/**
 * POST /api/v1/assistant/query
 * Подбор событий по фразе: уточнение, выдача с причинами или отказ на посторонний запрос.
 * Состояния на сервере нет: прежние условия клиент присылает в поле previous.
 */

import { runAssistant } from '../../../../../lib/api/assistant';
import { assistantUnavailable } from '../../../../../lib/api/assistant-availability';
import {
  errorResponse,
  internalError,
  json,
  methodNotAllowed,
  preflight,
  validationError,
} from '../../../../../lib/api/http';
import { parseAssistantRequest } from '../../../../../lib/api/nlu/request';
import { toApiAssistantResponse } from '../../../../../lib/api/wire';

/** Тело запроса с условиями и фразой укладывается в несколько килобайт. */
const MAX_BODY_LENGTH = 20_000;

export async function POST(request: Request): Promise<Response> {
  try {
    // Модель недоступна: сайт получает 503 и сам показывает обычный поиск с теми же фильтрами (п. 7.5).
    if (assistantUnavailable(request)) {
      return errorResponse(503, 'unavailable', 'ИИ временно недоступен. Поиск по фильтрам работает: GET /api/v1/events', undefined, {
        headers: { 'Retry-After': '60' },
      });
    }
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
    return json(toApiAssistantResponse(runAssistant(parsed.value)));
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('POST, OPTIONS');

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
