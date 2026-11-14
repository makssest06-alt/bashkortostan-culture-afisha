import type { MetadataRoute } from 'next';

/** Статические публичные разделы; карточки событий подтягиваются поиском и ссылками. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3210').replace(/\/+$/, '');
  const now = new Date();
  return ['/', '/events', '/ask', '/about', '/widget', '/developers'].map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === '/events' ? 'daily' : 'monthly',
    priority: path === '/' ? 1 : path === '/events' ? 0.9 : 0.6,
  }));
}
