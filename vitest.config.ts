import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    globals: false,
    // Keep test runs entirely off the demo database and uploads directory.
    env: {
      DATA_DIR: './.test-data',
      SESSION_SECRET: 'test-session-secret-not-used-in-production',
    },
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
