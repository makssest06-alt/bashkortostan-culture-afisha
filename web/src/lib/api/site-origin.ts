/**
 * Публичный origin сайта. Если задан PUBLIC_WEB_URL, он приоритетнее заголовков
 * запроса: Host/X-Forwarded-Host контролирует клиент/прокси, и подставлять их
 * в canonical/OG/примеры кода без проверки нельзя.
 */

export function configuredSiteOrigin(value = process.env.PUBLIC_WEB_URL): URL | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}
