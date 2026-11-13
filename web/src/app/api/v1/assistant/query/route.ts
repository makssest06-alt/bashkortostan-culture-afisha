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
import { USES_REMOTE_API } from '../../../../../lib/api/config';
import { forwardToBackend } from '../../../../../lib/api/forward';

/** Модель отвечает медленнее каталога: бэку ассистента дано больше времени. */
const ASSISTANT_TIMEOUT_MS = 25_000;

/** Тело запроса с условиями и фразой укладывается в несколько килобайт. */
const MAX_BODY_LENGTH = 20_000;

export async function POST(request: Request): Promise<Response> {
  try {
    // Модель недоступна: сайт получает 503 и сам показывает обычный поиск с теми же фильтрами (п. 7.5).
    // Переключатель работает и при подключённом бэке: так резервный режим можно показать без его участия.
    if (assistantUnavailable(request)) {
      return errorResponse(503, 'unavailable', 'ИИ временно недоступен. Поиск по фильтрам работает: GET /api/v1/events', undefined, {
        headers: { 'Retry-After': '60' },
      });
    }
    // Бэк подключён (NEXT_PUBLIC_API_BASE_URL): ответ берётся из него, моки ниже не участвуют.
    if (USES_REMOTE_API) {
      const forwarded = await forwardToBackend(request, { timeoutMs: ASSISTANT_TIMEOUT_MS });
      if (forwarded.status !== 404 && forwarded.status !== 405) return forwarded;
      // Ассистента нет в контракте v1. Если бэк его не реализует, сайт показывает обычный поиск, как при недоступной модели.
      return errorResponse(503, 'unavailable', 'ИИ-подбор пока не подключён. Поиск по фильтрам работает: GET /api/v1/events', undefined, {
        headers: { 'Retry-After': '3600' },
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
