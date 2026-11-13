import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Корень проекта задан явно: в домашнем каталоге есть посторонний package-lock.json,
 * и без этого Next выбирает корнем рабочего пространства не тот каталог.
 */
const projectRoot = path.resolve(process.cwd());

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
