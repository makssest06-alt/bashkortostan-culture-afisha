/**
 * Адрес сайта для примеров кода: тот, по которому страницу открыли.
 * Так строка виджета и команды curl на /widget и /developers сразу рабочие:
 * на localhost они указывают на localhost, на боевом адресе на боевой.
 */

import { headers } from 'next/headers';

const SAFE_HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/i;
const FALLBACK_HOST = 'localhost:3210';

export async function getSiteOrigin(): Promise<string> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-host')?.split(',')[0]?.trim();
  const candidate = forwarded || store.get('host') || FALLBACK_HOST;
  // Заголовок Host присылает клиент: в код примера попадает только похожее на имя узла.
  const host = SAFE_HOST.test(candidate) ? candidate : FALLBACK_HOST;
  const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(host);
  const forwardedProto = store.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : local ? 'http' : 'https';
  return `${proto}://${host}`;
}
