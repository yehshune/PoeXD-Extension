import { defineConfig } from '@playwright/test';

/**
 * 實機 E2E：連上 `pnpm dev`（WXT dev）開啟的瀏覽器，在真實官方頁面驗證擴充功能。
 * 不自行啟動瀏覽器（會被 Cloudflare 判定為自動化），也不納入 `pnpm test`。
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  outputDir: './.results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: './.report', open: 'never' }]],
});
