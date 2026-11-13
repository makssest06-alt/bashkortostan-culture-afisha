/**
 * Проверка тела запроса к ассистенту (POST /api/v1/assistant/query).
 * Всё, что пришло от клиента, считается недоверенным: условия и правки
 * пересобираются из известных полей, лишнее отбрасывается.
 */

import type { ParseResult } from '../params';
import type { ApiErrorDetail, AssistantRequest, ClarifyCode } from '../types';
import { sanitizeConstraints, sanitizePatch } from './state';

export const MAX_MESSAGE_LENGTH = 500;
export const DEFAULT_RESULT_LIMIT = 6;
export const MAX_RESULT_LIMIT = 12;

const CLARIFY_CODES: readonly ClarifyCode[] = [
  'city',
  'date',
  'time',
  'child_age',
  'participants',
  'budget',
  'category',
  'audience',
  'location',
  'contradiction',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAssistantRequest(body: unknown): ParseResult<AssistantRequest> {
  const issues: ApiErrorDetail[] = [];
  if (!isRecord(body)) {
    return { ok: false, issues: [{ field: 'body', message: 'Тело запроса должно быть объектом JSON' }] };
  }
  const request: AssistantRequest = {};

  if (body.message !== undefined) {
    if (typeof body.message !== 'string') {
      issues.push({ field: 'message', message: 'Поле message должно быть строкой' });
    } else if (body.message.length > MAX_MESSAGE_LENGTH) {
      issues.push({ field: 'message', message: `Сообщение не длиннее ${MAX_MESSAGE_LENGTH} знаков` });
    } else if (body.message.trim()) {
      request.message = body.message.trim();
    }
  }

  if (body.previous !== undefined && body.previous !== null) {
    if (!isRecord(body.previous)) {
      issues.push({ field: 'previous', message: 'Поле previous должно быть объектом с полями hard и soft' });
    } else {
      request.previous = sanitizeConstraints(body.previous);
    }
  }

  if (body.patch !== undefined && body.patch !== null) {
    const patch = sanitizePatch(body.patch);
    if (!patch) issues.push({ field: 'patch', message: 'Поле patch должно быть объектом с полями reset, set и unset' });
    else request.patch = patch;
  }

  if (body.answering !== undefined && body.answering !== null) {
    if (typeof body.answering === 'string' && (CLARIFY_CODES as readonly string[]).includes(body.answering)) {
      request.answering = body.answering as ClarifyCode;
    } else {
      issues.push({ field: 'answering', message: `Поле answering принимает значения: ${CLARIFY_CODES.join(', ')}` });
    }
  }

  if (body.limit !== undefined && body.limit !== null) {
    const limit = body.limit;
    if (typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= MAX_RESULT_LIMIT) {
      request.limit = limit;
    } else {
      issues.push({ field: 'limit', message: `Поле limit должно быть целым числом от 1 до ${MAX_RESULT_LIMIT}` });
    }
  }

  if (issues.length === 0 && request.message === undefined && request.patch === undefined) {
    issues.push({ field: 'message', message: 'Нужна фраза в поле message или правка условий в поле patch' });
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: request };
}
