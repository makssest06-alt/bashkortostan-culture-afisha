/**
 * GET /api/v1
 * Оглавление API: какие методы есть и откуда сейчас берутся данные.
 */

import { internalError, json, methodNotAllowed, preflight } from '../../../lib/api/http';
import { TIMEZONE } from '../../../lib/api/time';
import type { ApiIndexResponse } from '../../../lib/api/types';

const INDEX: ApiIndexResponse = {
  name: 'Афиша культуры Башкортостана',
  version: 'v1',
  data: 'mock',
  timezone: TIMEZONE,
  docs: '/developers',
  endpoints: [
    { method: 'GET', path: '/api/v1/events', description: 'Список событий с фильтрами, сортировкой и счётчиками' },
    { method: 'GET', path: '/api/v1/events/{id}', description: 'Карточка события со всеми сеансами' },
    { method: 'GET', path: '/api/v1/dictionaries', description: 'Справочники: категории, города, возрастные метки, статусы' },
    { method: 'GET', path: '/api/v1/facets', description: 'Число событий по городам, категориям, возрасту и цене' },
    { method: 'POST', path: '/api/v1/assistant/query', description: 'Подбор событий по свободной фразе' },
    { method: 'POST', path: '/api/v1/feedback', description: 'Заявка организатора, уточнение к карточке или вопрос' },
    { method: 'GET', path: '/api/v1/health', description: 'Проверка работы API' },
    { method: 'GET', path: '/api/v1/admin/events', description: 'Админка: все события любого статуса (Bearer-токен модератора)' },
    { method: 'PATCH', path: '/api/v1/admin/events/{id}', description: 'Админка: правка полей и статуса, заголовок If-Match' },
    { method: 'POST', path: '/api/v1/admin/imports', description: 'Админка: импорт CSV или JSON с отчётом' },
    { method: 'GET', path: '/api/v1/admin/moderation', description: 'Админка: очередь спорных карточек' },
    { method: 'POST', path: '/api/v1/admin/moderation/{id}/resolve', description: 'Админка: решение по спорной карточке' },
    { method: 'GET', path: '/api/v1/admin/audit', description: 'Админка: журнал изменений' },
  ],
};

export function GET(): Response {
  try {
    return json(INDEX, { cache: 'public, max-age=300' });
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
