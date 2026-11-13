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
    { method: 'GET', path: '/api/v1/health', description: 'Проверка работы API' },
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
