import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each suite creates and drops its own database; running files serially
    // keeps `CREATE DATABASE ... TEMPLATE` from colliding on the template.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
