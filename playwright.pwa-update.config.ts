import { defineConfig, devices } from '@playwright/test'

// This suite creates two real production builds and its own disposable localhost origin.
// It intentionally does not use PLAYWRIGHT_BASE_URL or mutate a deployed site.
export default defineConfig({
  testDir: './scripts/pwa-test',
  testMatch: 'update.spec.ts',
  globalSetup: './scripts/pwa-test/build-updates.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  outputDir: 'test-results/pwa-update',
  use: { locale: 'ru-RU', timezoneId: 'Europe/Moscow', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'iphone-webkit', use: { ...devices['iPhone SE'], browserName: 'webkit' } },
  ],
})
