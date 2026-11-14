import path from 'node:path';
import type { NextConfig } from 'next';

import { normalizeApiBaseUrl } from './src/lib/api/config';

/**
 * Корень проекта задан явно: в домашнем каталоге есть посторонний package-lock.json,
 * и без этого Next выбирает корнем рабочего пространства не тот каталог.
 */
const projectRoot = path.resolve(process.cwd());

// Адрес бэка проверяется до сборки: опечатка в NEXT_PUBLIC_API_BASE_URL роняет `next build`
// с понятной ошибкой, а не превращает сайт молча в моки. Пересылка запросов в бэк: src/lib/api/forward.ts.
normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // P2: базовые security headers. CSP здесь только frame-ancestors/base-uri/object-src —
  // не ломает inline-бутстрап Next и закрывает clickjacking.
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    if (process.env.NODE_ENV === 'production') {
      common.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      });
    }
    return [
      { source: '/(.*)', headers: common },
      {
        // Виджет /widget должен встраиваться на чужие сайты, поэтому frame-запрет только у админки.
        source: '/admin/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
      {
        source: '/api/v1/admin/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
  // Переносимая сборка для сервера: .next/standalone с server.js и только нужными модулями.
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
