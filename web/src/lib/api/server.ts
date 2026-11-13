/**
 * Прямой доступ к данным афиши без похода по HTTP.
 * Для серверных компонентов, generateMetadata и обработчиков маршрутов.
 *
 * Имена и сигнатуры совпадают с клиентом из ./client: чтобы перейти
 * с сервера на браузер, достаточно сменить путь импорта.
 * В клиентские компоненты этот модуль не импортировать: он тянет за собой каталог.
 */

import { DICTIONARIES } from '../../data/dictionaries';
import { runAssistant } from './assistant';
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

/** Список событий с фильтрами. То же, что GET /api/v1/events. */
export async function listEvents(query: EventsQuery = {}): Promise<EventsListResponse> {
  return searchEvents(query);
}

/** Событие со всеми сеансами или null, если такого нет. То же, что GET /api/v1/events/{id}. */
export async function getEvent(id: string): Promise<AfishaEvent | null> {
  return findEvent(id);
}

/** Справочники. То же, что GET /api/v1/dictionaries. */
export async function getDictionaries(): Promise<Dictionaries> {
  return DICTIONARIES;
}

/** Счётчики по городам и категориям. То же, что GET /api/v1/facets. */
export async function getFacets(query: EventsQuery = {}): Promise<FacetsResponse> {
  return getFacetCounts(query);
}

/** Ответ ассистента. То же, что POST /api/v1/assistant/query. */
export async function askAssistant(request: AssistantRequest): Promise<AssistantResponse> {
  return runAssistant(request);
}
