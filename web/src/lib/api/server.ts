/**
 * Данные афиши для серверных компонентов, generateMetadata и обработчиков маршрутов.
 *
 * Сайт на моках (NEXT_PUBLIC_API_BASE_URL пуст): данные берутся из каталога приложения без похода по HTTP.
 * Бэк задан: те же функции идут в него по HTTP через ./client, с тайм-аутом, чтобы зависший бэк
 * не держал страницу бесконечно.
 *
 * Имена и сигнатуры совпадают с клиентом из ./client: чтобы перейти
 * с сервера на браузер, достаточно сменить путь импорта.
 * В клиентские компоненты этот модуль не импортировать: он тянет за собой каталог.
 */

import { cache } from 'react';

import { DICTIONARIES } from '../../data/dictionaries';
import { runAssistant } from './assistant';
import * as remote from './client';
import { API_BASE_URL, USES_REMOTE_API } from './config';
import { findEvent } from './db';
import { getFacetCounts, searchEvents } from './search';
import type {
  AfishaEvent,
  AssistantRequest,
  AssistantResponse,
  Dictionaries,
  EventsListResponse,
  EventsQuery,
  FacetsResponse,
} from './types';

/** Сколько страница ждёт бэк. Ассистенту дано больше: модель отвечает медленнее каталога. */
const BACKEND_TIMEOUT_MS = 8_000;
const ASSISTANT_TIMEOUT_MS = 20_000;

function backend(timeoutMs = BACKEND_TIMEOUT_MS): remote.ClientOptions {
  return { baseUrl: API_BASE_URL, signal: AbortSignal.timeout(timeoutMs) };
}

/** Список событий с фильтрами. То же, что GET /api/v1/events. */
export async function listEvents(query: EventsQuery = {}): Promise<EventsListResponse> {
  if (USES_REMOTE_API) return remote.listEvents(query, backend());
  return searchEvents(query);
}

/**
 * Событие со всеми сеансами или null, если такого нет. То же, что GET /api/v1/events/{id}.
 * cache(): страница и generateMetadata берут событие одним запросом к бэку на один показ страницы.
 */
export const getEvent = cache(async (id: string): Promise<AfishaEvent | null> => {
  if (USES_REMOTE_API) return remote.getEvent(id, backend());
  return findEvent(id);
});

/** Справочники. То же, что GET /api/v1/dictionaries. */
export async function getDictionaries(): Promise<Dictionaries> {
  if (USES_REMOTE_API) return remote.getDictionaries(backend());
  return DICTIONARIES;
}

/** Счётчики по городам и категориям. То же, что GET /api/v1/facets. */
export async function getFacets(query: EventsQuery = {}): Promise<FacetsResponse> {
  if (USES_REMOTE_API) return remote.getFacets(query, backend());
  return getFacetCounts(query);
}

/** Ответ ассистента. То же, что POST /api/v1/assistant/query. */
export async function askAssistant(request: AssistantRequest): Promise<AssistantResponse> {
  if (USES_REMOTE_API) return remote.askAssistant(request, backend(ASSISTANT_TIMEOUT_MS));
  return runAssistant(request);
}
