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
      // Billing under test: the webhook can be exercised with signed payloads,
      // but no price ids means checkout never reaches the network.
      STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_for_vitest',
      ADMIN_TOKEN: 'admin-token-for-vitest-only-0123456789',
      APP_URL: 'https://grantconsole.com',
    },
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
