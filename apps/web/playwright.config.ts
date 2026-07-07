import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Musaed web app
 * Focus on RTL visual regression testing
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120000,
  },
  timeout: 60000,
  expect: {
    timeout: 15000,
    toHaveScreenshot: {
      maxDiffPixels: 50,
      maxDiffPixelRatio: 0.05,
    },
  },
});
