/**
 * 連上 `pnpm dev` 開的瀏覽器並取得官方搜尋分頁。實機 E2E fixture 與 `pnpm poe` CLI 共用。
 *
 * 原則：只中斷 CDP 連線、不關使用者的瀏覽器；不自動處理 Cloudflare 驗證。
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { resolveDevBrowserCdpUrl } from '../cdp-endpoint.ts';
import { DEFAULT_START_URLS, isTradeSearchUrl } from './trade-url.ts';

/** 擴充 content script 掛上的 shadow host；出現代表擴充已注入這個分頁 */
export const EXTENSION_HOST_SELECTOR = 'poexd-sidebar-container';

export interface DevBrowserConnection {
  readonly browser: Browser;
  readonly cdpUrl: string;
}

export async function connectDevBrowser(): Promise<DevBrowserConnection> {
  const cdpUrl = await resolveDevBrowserCdpUrl();
  try {
    return { browser: await chromium.connectOverCDP(cdpUrl), cdpUrl };
  } catch (error) {
    throw new Error(
      `無法連上 ${cdpUrl}。請先執行 \`pnpm dev\` 並保持瀏覽器開啟。\n${String(error)}`,
    );
  }
}

/** 連線、執行、一定中斷連線（`browser.close()` 對 connectOverCDP 只會斷線） */
export async function withDevBrowser<T>(
  run: (conn: DevBrowserConnection) => Promise<T>,
): Promise<T> {
  const conn = await connectDevBrowser();
  try {
    return await run(conn);
  } finally {
    await conn.browser.close();
  }
}

export function allPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

export function tradePages(browser: Browser): Page[] {
  return allPages(browser).filter((page) => isTradeSearchUrl(page.url()));
}

/** 依 `index`（tradePages 的順序）挑分頁；沒指定時取第一個 */
export function pickTradePage(browser: Browser, index?: number): Page | null {
  const pages = tradePages(browser);
  if (index !== undefined && index >= pages.length) {
    throw new Error(`只有 ${pages.length} 個官方搜尋分頁，--tab ${index} 超出範圍`);
  }
  return pages[index ?? 0] ?? null;
}

export async function requireTradePage(browser: Browser, index?: number): Promise<Page> {
  const page = pickTradePage(browser, index);
  if (!page) {
    throw new Error('dev 瀏覽器裡沒有官方搜尋頁；先執行 `pnpm poe open poe2`（或 poe1、完整網址）');
  }
  return page;
}

/** 依 URL 子字串從所有分頁挑出符合的分頁（支援檢查 pobb.in 等非交易分頁） */
export async function requirePageByUrl(browser: Browser, substring: string): Promise<Page> {
  const matched = allPages(browser).find((page) => page.url().includes(substring));
  if (!matched) {
    throw new Error(`dev 瀏覽器裡找不到網址包含「${substring}」的分頁`);
  }
  return matched;
}

/** 測試用：找現有搜尋頁，沒有就以第一個分頁前往起始網址 */
export async function findOrOpenTradePage(browser: Browser, startUrl?: string): Promise<Page> {
  const existing = pickTradePage(browser);
  if (existing) return existing;
  const page = allPages(browser)[0] ?? (await browser.contexts()[0].newPage());
  await page.goto(startUrl ?? DEFAULT_START_URLS.poe2);
  return page;
}

/** Cloudflare 驗證頁的特徵；遇到時請使用者在 dev 瀏覽器手動通過 */
export async function isCloudflareChallenge(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => '');
  if (/just a moment|請稍候|attention required/i.test(title)) return true;
  return (await page.locator('#challenge-form, #cf-challenge-running, .cf-turnstile').count()) > 0;
}

const MIN_VIEWPORT = { width: 1200, height: 600 };
const FALLBACK_VIEWPORT = { width: 1600, height: 1000 };

/**
 * dev 瀏覽器視窗最小化或很小時，暫時模擬一般桌面尺寸，讓截圖與版面量測有意義。
 * 模擬綁在這次 CDP 連線上，斷線後瀏覽器自動恢復原本尺寸。回傳說明文字，沒調整時回傳 null。
 */
export async function ensureUsableViewport(page: Page): Promise<string | null> {
  const [width, height] = await page.evaluate(() => [innerWidth, innerHeight]);
  if (width >= MIN_VIEWPORT.width && height >= MIN_VIEWPORT.height) return null;
  await page.setViewportSize(FALLBACK_VIEWPORT);
  return `視窗只有 ${width}×${height}，本次暫時模擬 ${FALLBACK_VIEWPORT.width}×${FALLBACK_VIEWPORT.height}（斷線後恢復）`;
}

export interface ReadyOptions {
  /** 一併等待擴充注入（預設 true） */
  readonly extension?: boolean;
  readonly timeout?: number;
}

/** 等官方 Vue app 與（預設）擴充都就緒；卡在 Cloudflare 時丟出可讀的錯誤 */
export async function waitForTradeReady(page: Page, options: ReadyOptions = {}): Promise<void> {
  const timeout = options.timeout ?? 20_000;
  if (await isCloudflareChallenge(page)) {
    throw new Error('目前停在 Cloudflare 驗證頁，請在 dev 瀏覽器手動通過後再執行');
  }
  await page.locator('#trade').waitFor({ timeout });
  if (options.extension ?? true) {
    await page.locator(EXTENSION_HOST_SELECTOR).first().waitFor({ state: 'attached', timeout });
  }
}
