import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: 'output/playwright/results',
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    }
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 14 Pro Max'], viewport: { width: 430, height: 932 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } }
  ],
  webServer: {
    command: 'WRANGLER_LOG_PATH=/tmp/memento-wrangler-playwright.log npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
