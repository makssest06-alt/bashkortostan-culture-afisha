/**
 * GET /api/v1/facets
 * Число событий по городам, категориям, возрастным меткам и цене.
 * Принимает те же фильтры, что и /api/v1/events; без параметров считает по всему каталогу.
 */

import { internalError, json, methodNotAllowed, preflight, validationError } from '../../../../lib/api/http';
import { parseEventsQuery } from '../../../../lib/api/params';
import { getFacetCounts } from '../../../../lib/api/search';

export function GET(request: Request): Response {
  try {
    const parsed = parseEventsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return validationError(parsed.issues);
    return json(getFacetCounts(parsed.value));
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
