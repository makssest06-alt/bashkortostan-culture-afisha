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
  // Переносимая сборка для сервера: .next/standalone с server.js и только нужными модулями.
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
