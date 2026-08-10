import { defineConfig, devices } from '@playwright/test';

const PORT = 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Browser tests run against the real production bundle served by the Express
 * server, using a dedicated data directory so the demo workspace is untouched.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    // DEMO_MODE is explicit here because the owner journey exercises the
    // one-click demo sign-in shortcut.
    command: `DATA_DIR=./.e2e-data PORT=${PORT} HOST=127.0.0.1 DEMO_MODE=true node dist/server/index.js`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
