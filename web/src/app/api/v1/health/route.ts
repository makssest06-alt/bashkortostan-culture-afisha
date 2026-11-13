/**
 * GET /api/v1/health
 * Проверка, что API отвечает, и откуда сейчас берутся данные.
 */

import { countEvents } from '../../../../lib/api/db';
import { internalError, json, methodNotAllowed, preflight } from '../../../../lib/api/http';
import { TIMEZONE } from '../../../../lib/api/time';
import type { HealthResponse } from '../../../../lib/api/types';

export function GET(request: Request): Response {
  try {
    // Обращение к запросу отключает статическое кэширование: время в ответе всегда текущее.
    void request.url;
    const body: HealthResponse = {
      status: 'ok',
      version: 'v1',
      data: 'mock',
      events: countEvents(),
      time: new Date().toISOString(),
      timezone: TIMEZONE,
    };
    return json(body);
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
