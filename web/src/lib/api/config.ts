/**
 * Откуда сайт берёт данные.
 *
 *   NEXT_PUBLIC_API_BASE_URL=https://api.afisha.example   сайт ходит в бэк: https://api.afisha.example/api/v1/...
 *   NEXT_PUBLIC_API_BASE_URL=                              сайт работает на моках из этого же приложения (src/app/api/v1)
 *
 * Адрес можно указать и с /api/v1 на конце: префикс срезается, клиент добавляет его сам.
 * К бэку ходит только сервер сайта: страницы напрямую, а запросы браузера и виджета к /api/v1/* сайта
 * пересылаются (./forward.ts, ../admin/forward.ts). Поэтому адрес достаточно сделать доступным
 * с сервера сайта (в docker compose это http://api:8000), CORS на бэке не нужен.
 * Переменная с приставкой NEXT_PUBLIC_ вшивается в сборку: после смены нужно заново выполнить `next build`
 * (в Docker это аргумент сборки, см. web/Dockerfile).
 *
 * Неверный адрес не превращается молча в моки: сборка и страницы падают с понятной ошибкой.
 */

const API_PREFIX = /\/api\/v1$/;

/** Приводит адрес бэка к виду `https://host[:port][/путь]` без слэша и /api/v1 на конце. Пустая строка значит «моки». */
export function normalizeApiBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL: «${value}» не похож на адрес. Нужен вид https://api.example или http://localhost:8000`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL: адрес должен начинаться с http:// или https://, сейчас «${value}»`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL: в адресе бэка не должно быть параметров, якоря, логина и пароля');
  }
  const path = url.pathname.replace(/\/+$/, '').replace(API_PREFIX, '');
  return `${url.origin}${path}`;
}

/** Адрес бэка или пустая строка, если сайт работает на моках. */
export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

/** true, когда данные идут из внешнего бэка, а не из моков приложения. */
export const USES_REMOTE_API = API_BASE_URL !== '';
