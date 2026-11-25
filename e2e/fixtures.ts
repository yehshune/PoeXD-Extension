import { test as base, type Page } from '@playwright/test';
import {
  connectDevBrowser,
  ensureUsableViewport,
  findOrOpenTradePage,
  isCloudflareChallenge,
  waitForTradeReady,
} from './live/trade-page.ts';
import { TRADE_SEARCH_URL } from './live/trade-url.ts';

export interface TradeFixtures {
  tradePage: Page;
}

export const test = base.extend<TradeFixtures>({
  tradePage: async ({}, use, testInfo) => {
    const { browser } = await connectDevBrowser();
    try {
      const page = await findOrOpenTradePage(browser, process.env.POEXD_E2E_START_URL);
      await page.bringToFront();
      if (await isCloudflareChallenge(page)) {
        testInfo.skip(true, '目前停在 Cloudflare 驗證頁，請在 dev 瀏覽器手動通過後再執行');
      }
      await page.waitForURL(TRADE_SEARCH_URL);
      await waitForTradeReady(page, { extension: false });
      // 視窗最小化時點擊與版面量測都不可靠，暫時模擬桌面尺寸（斷線後恢復）
      await ensureUsableViewport(page);
      await use(page);
    } finally {
      // 只中斷 CDP 連線，不關閉使用者的 dev 瀏覽器
      await browser.close();
    }
  },
});

export { expect } from '@playwright/test';
