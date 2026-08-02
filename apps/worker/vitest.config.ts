import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'worker',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
