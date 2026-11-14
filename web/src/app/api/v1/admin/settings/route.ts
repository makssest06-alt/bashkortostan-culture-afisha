/**
 * GET/PATCH /api/v1/admin/settings: «рубильник» ИИ-ассистента.
 * При подключённом бэке запрос пересылается в него (withAdmin) и состояние живёт в PostgreSQL.
 * На моках флаг хранится в памяти процесса сайта и влияет на мок-ассистента.
 */

import { setAiEnabled } from '../../../../../lib/admin/ai-flag';
import { withAdmin } from '../../../../../lib/admin/route-kit';
import { json, methodNotAllowed, preflightAdmin } from '../../../../../lib/api/http';

const MOCK_SETTINGS = {
  ai_enabled: true,
  ai_env_locked: false,
  engine: 'rules-v2',
  llm_configured: false,
  updated_at: null,
  updated_by: null,
};

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => json(MOCK_SETTINGS, { requestId }));
}

export function PATCH(request: Request): Promise<Response> {
  return withAdmin(request, async ({ requestId }) => {
    const body = (await request.json().catch(() => null)) as { ai_enabled?: unknown } | null;
    if (typeof body?.ai_enabled !== 'boolean') {
      return json(
        {
          code: 'validation_error',
          message: 'Поле ai_enabled должно быть true или false',
          details: [{ field: 'ai_enabled', message: 'Допустимо: true или false' }],
          request_id: requestId,
        },
        { requestId, status: 400 },
      );
    }
    setAiEnabled(body.ai_enabled);
    return json({ ...MOCK_SETTINGS, ai_enabled: body.ai_enabled }, { requestId });
  });
}

export function OPTIONS(): Response {
  return preflightAdmin();
}

const notAllowed = methodNotAllowed('GET, PATCH, OPTIONS');

export { notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };
