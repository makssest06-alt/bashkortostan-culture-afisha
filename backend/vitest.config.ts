import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
