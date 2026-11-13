/**
 * Любой другой адрес под /api/v1: ответ 404 в общем формате ошибок и с заголовками CORS.
 * Без этого файла браузер на чужом сайте получил бы HTML-страницу без CORS
 * и показал бы сетевую ошибку вместо понятного сообщения.
 */

import { notFound, preflight } from '../../../../lib/api/http';

const MESSAGE = 'Такого метода нет. Список методов: GET /api/v1';

function respond(): Response {
  return notFound(MESSAGE);
}

export { respond as GET, respond as POST, respond as PUT, respond as PATCH, respond as DELETE };

export function OPTIONS(): Response {
  return preflight();
}
