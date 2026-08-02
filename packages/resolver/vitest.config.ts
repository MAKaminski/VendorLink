import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'resolver', environment: 'node', include: ['test/**/*.test.ts'] },
});
