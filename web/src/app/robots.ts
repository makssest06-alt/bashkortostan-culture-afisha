import type { MetadataRoute } from 'next';

/** Публичные страницы не индексируют админку, API и dev-предпросмотр. */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3210').replace(/\/+$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api/', '/dev/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
