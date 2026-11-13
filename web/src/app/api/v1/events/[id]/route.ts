/**
 * GET /api/v1/events/{id}
 * Карточка события со всеми сеансами, включая отменённые и перенесённые.
 */

import { findEvent } from '../../../../../lib/api/db';
import { internalError, json, methodNotAllowed, notFound, preflight } from '../../../../../lib/api/http';

const ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    // Обращение к запросу отключает статическое кэширование: даты считаются на каждый вызов.
    void request.url;
    const { id } = await context.params;
    const event = ID_PATTERN.test(id) ? findEvent(id) : null;
    if (!event) return notFound('Событие не найдено. Проверьте идентификатор или откройте каталог: /api/v1/events');
    return json(event);
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
