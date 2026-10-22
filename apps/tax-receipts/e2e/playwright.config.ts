import { defineConfig, devices } from '@playwright/test';
import { API_DIR, API_PORT, BASE_URL, WEB_DIR, WEB_PORT, e2eEnv } from './e2e-env.js';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // one shared, seeded database: run serially so tests do not race on it
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    // without these an action on a disabled or missing element waits
    // forever, which hangs the Playwright agents' browser sessions
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm exec tsx src/server.ts',
      cwd: API_DIR,
      env: e2eEnv,
      // `/`, not `/health`: the database is reset by globalSetup, which
      // Playwright runs only after the servers are up
      url: `http://127.0.0.1:${API_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      cwd: WEB_DIR,
      env: { ...e2eEnv, API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
