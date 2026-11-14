/**
 * POST /api/v1/feedback: заявка организатора, уточнение к карточке или вопрос (п. 6.3).
 * Тело: { kind, event_id?, name, contact, organization?, text, website }. website это ловушка для ботов,
 * человек оставляет его пустым. Ответ 202 { id, status: "received" }.
 * Ограничение частоты: 5 обращений за 10 минут и 20 за сутки с одного адреса, дальше 429 и Retry-After.
 */

import { isHoneypotFilled, storeFeedback, validateFeedback } from '../../../../lib/api/feedback';
import {
  errorResponse,
  internalError,
  json,
  logEvent,
  methodNotAllowed,
  preflight,
  requestIdOf,
  validationError,
} from '../../../../lib/api/http';
import { clientIp, hitRate } from '../../../../lib/api/rate-limit';
import { USES_REMOTE_API } from '../../../../lib/api/config';
import { forwardToBackend, readLimitedBody } from '../../../../lib/api/forward';

const MAX_BODY = 10_000;

export async function POST(request: Request): Promise<Response> {
  // Бэк подключён (NEXT_PUBLIC_API_BASE_URL): ответ берётся из него, моки ниже не участвуют.
  if (USES_REMOTE_API) return forwardToBackend(request, { maxBodyBytes: MAX_BODY });

  const requestId = requestIdOf(request);
  try {
    const ip = clientIp(request);
    const burst = hitRate(`feedback:10m:${ip}`, 5, 10 * 60_000);
    const daily = burst.ok ? hitRate(`feedback:1d:${ip}`, 20, 24 * 60 * 60_000) : burst;
    if (!burst.ok || !daily.ok) {
      const wait = Math.max(burst.retryAfter, daily.retryAfter);
      const minutes = Math.ceil(wait / 60);
      return errorResponse(
        429,
        'rate_limited',
        `Слишком много обращений подряд. Попробуйте ещё раз через ${minutes} мин.`,
        undefined,
        { requestId, headers: { 'Retry-After': String(wait) } },
      );
    }

    const limited = await readLimitedBody(request, MAX_BODY);
    if (!limited.ok) {
      return errorResponse(413, 'payload_too_large', 'Обращение слишком длинное. Сократите текст до 2000 знаков', undefined, { requestId });
    }
    const raw = new TextDecoder().decode(limited.body);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return errorResponse(400, 'invalid_json', 'Форма пришла в непонятном виде. Обновите страницу и отправьте ещё раз', undefined, {
        requestId,
      });
    }

    // Ловушка заполнена: это бот. Отвечаем как обычно, чтобы он не учился обходить защиту, но ничего не сохраняем.
    if (isHoneypotFilled(body)) {
      logEvent('warn', 'feedback_honeypot', { request_id: requestId });
      return json({ id: `fb_${requestId.slice(4, 20)}`, status: 'received' }, { status: 202, requestId });
    }

    const parsed = validateFeedback(body);
    if (!parsed.ok) return validationError(parsed.issues, requestId);
    const application = storeFeedback(parsed.value);
    logEvent('info', 'feedback_received', { request_id: requestId, id: application.id, kind: application.kind });
    return json({ id: application.id, status: 'received' }, { status: 202, requestId });
  } catch (error) {
    return internalError(error, requestId);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('POST, OPTIONS');

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
