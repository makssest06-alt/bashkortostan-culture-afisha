/**
 * GET /api/v1/dictionaries
 * Справочники: категории, города, возрастные метки, статусы с подписями на русском и башкирском.
 */

import { DICTIONARIES } from '../../../../data/dictionaries';
import { internalError, json, methodNotAllowed, preflight } from '../../../../lib/api/http';

export function GET(): Response {
  try {
    // Справочники меняются редко: их можно держать в кэше браузера пять минут.
    return json(DICTIONARIES, { cache: 'public, max-age=300' });
  } catch (error) {
    return internalError(error);
  }
}

export function OPTIONS(): Response {
  return preflight();
}

const notAllowed = methodNotAllowed('GET, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
