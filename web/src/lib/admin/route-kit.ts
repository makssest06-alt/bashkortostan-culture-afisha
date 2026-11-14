/**
 * Общая обвязка обработчиков /api/v1/admin/*: идентификатор запроса, проверка доступа,
 * журнал сервера и ответ 500 без подробностей наружу.
 */

import { USES_REMOTE_API } from '../api/config';
import { internalError, logEvent, requestIdOf } from '../api/http';
import { requireAdmin } from './auth';
import { forwardAdmin } from './forward';

export interface AdminContext {
  requestId: string;
  actor: string;
}

export async function withAdmin(
  request: Request,
  handler: (context: AdminContext) => Promise<Response> | Response,
): Promise<Response> {
  const requestId = requestIdOf(request);
  try {
    const auth = requireAdmin(request, requestId);
    if (!auth.ok) return auth.response;
    // Бэк подключён: данные админки живут в нём, сайт только проверяет сессию и пересылает запрос.
    const response = USES_REMOTE_API
      ? await forwardAdmin(request, requestId, auth.actor)
      : await handler({ requestId, actor: auth.actor });
    if (request.method !== 'GET') {
      // В журнал сервера идут метод, адрес и код ответа: без тела запроса и персональных данных.
      logEvent('info', 'admin_request', {
        request_id: requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
      });
    }
    return response;
  } catch (error) {
    return internalError(error, requestId);
  }
}

export function intParam(value: string | null, fallback: number): number {
  const number = Number.parseInt(value ?? '', 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
