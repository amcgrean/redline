import { defineConfig, devices } from '@playwright/test';

/**
 * UI tests for the web app. The dev server is started here so `pnpm test:e2e` is
 * self-contained; in CI the same command runs after `playwright install chromium`.
 *
 * Fixture PDFs are not in the repo, so every spec builds the PDF it needs with pdf-lib.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  timeout: 60_000,
  // pdf.js first render can exceed 5 s when the suite runs in parallel against one dev server.
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  // pdf.js first render can exceed 5 s when the suite runs in parallel against one dev server.
  expect: { timeout: 15_000 },
  },
});
