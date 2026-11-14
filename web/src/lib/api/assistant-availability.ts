/**
 * Доступность ассистента (п. 7.5 «Резервный режим»). Модель считается недоступной, если:
 *   - на сервере задано ASSISTANT_DISABLED=1 (модель выключена, кончился бюджет);
 *   - запрос пришёл с заголовком X-Assistant-Demo: unavailable (переключатель для демонстрации на /ask).
 * Тогда POST /api/v1/assistant/query отвечает 503 unavailable, а сайт сам переходит на обычный поиск.
 */

import { isAiEnabled } from '../admin/ai-flag';

export const DEMO_HEADER = 'x-assistant-demo';
export const DEMO_UNAVAILABLE = 'unavailable';

export function assistantDisabled(): boolean {
  return process.env.ASSISTANT_DISABLED === '1';
}

export function assistantUnavailable(request?: Request): boolean {
  return (
    assistantDisabled() ||
    !isAiEnabled() ||
    request?.headers.get(DEMO_HEADER) === DEMO_UNAVAILABLE
  );
}
