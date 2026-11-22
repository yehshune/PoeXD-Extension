import { defineConfig } from '@playwright/test';

// 讓 context.route 也攔得到擴充功能 background（service worker）發出的請求，例如 poe.ninja 匯率
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

/**
 * 離線 E2E：自行啟動 Chromium 載入建置好的擴充功能，官方頁面與 API 全部回放。
 * 執行前需先 `pnpm wxt build -b chrome`；`pnpm e2e:offline` 會一併處理。
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.offline.ts',
  outputDir: '../.results-offline',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  use: { trace: 'retain-on-failure' },
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: '../.report-offline', open: 'never' }]]
    : [['list']],
});
