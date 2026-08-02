import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'email', environment: 'node', include: ['test/**/*.test.ts'] },
});
