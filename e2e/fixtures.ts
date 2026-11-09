import { chromium, test as base, type Browser, type Page } from '@playwright/test';

const CDP_URL = `http://127.0.0.1:${process.env.POEXD_CDP_PORT ?? 9222}`;
const TRADE_SEARCH_URL = /pathofexile\.(com|tw)\/trade2?\/search\//;

/** Cloudflare 驗證頁的特徵；遇到時請使用者在 dev 瀏覽器手動通過，不自動處理。 */
async function isCloudflareChallenge(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => '');
  if (/just a moment|請稍候|attention required/i.test(title)) return true;
  return (await page.locator('#challenge-form, #cf-challenge-running, .cf-turnstile').count()) > 0;
}

async function connect(): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(CDP_URL);
  } catch (error) {
    throw new Error(
      `無法連上 ${CDP_URL}。請先執行 \`pnpm dev\` 並保持瀏覽器開啟。\n${String(error)}`,
    );
  }
}

/** 找出 dev 瀏覽器裡已開啟的官方搜尋頁；沒有就以第一個分頁前往起始網址。 */
async function findTradePage(browser: Browser): Promise<Page> {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const existing = pages.find((page) => TRADE_SEARCH_URL.test(page.url()));
  if (existing) return existing;
  const page = pages[0] ?? (await browser.contexts()[0].newPage());
  await page.goto(
    process.env.POEXD_E2E_START_URL ?? 'https://www.pathofexile.com/trade2/search/poe2',
  );
  return page;
}

export interface TradeFixtures {
  tradePage: Page;
}

export const test = base.extend<TradeFixtures>({
  tradePage: async ({}, use, testInfo) => {
    const browser = await connect();
    try {
      const page = await findTradePage(browser);
      await page.bringToFront();
      if (await isCloudflareChallenge(page)) {
        testInfo.skip(true, '目前停在 Cloudflare 驗證頁，請在 dev 瀏覽器手動通過後再執行');
      }
      await page.waitForURL(TRADE_SEARCH_URL);
      await page.locator('#trade').waitFor();
      await use(page);
    } finally {
      // 只中斷 CDP 連線，不關閉使用者的 dev 瀏覽器
      await browser.close();
    }
  },
});

export { expect } from '@playwright/test';
