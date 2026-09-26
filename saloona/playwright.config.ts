import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the web preview build (sql.js database in the browser).
 * Uses the Chromium that is already installed on the machine/CI image when available.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Pixel 7'],
    viewport: { width: 360, height: 800 },
    locale: 'da-DK',
    timezoneId: 'Europe/Copenhagen',
    launchOptions: executablePath ? { executablePath } : {}
  },
  webServer: {
    command: 'npm run build:web && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
