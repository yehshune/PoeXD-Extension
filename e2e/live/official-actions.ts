/**
 * 官方交易頁的常用操作。標成「會發請求」的操作會消耗官方 API 速率限制，請只在需要時呼叫。
 * 官方文字會被擴充中文化，所以一律以 class 判斷狀態，不比對按鈕文字。
 */
import type { Locator, Page, Response } from '@playwright/test';

const SEARCH_API = /\/api\/trade2?\/search\//;
const FETCH_API = /\/api\/trade2?\/fetch\//;
const RESULT_ROW = '.results .resultset .row[data-id]';
const RESULT_EMPTY_OR_ERROR = '.results .row.error, .results .row-total';

export const LAYOUTS = ['compact', 'compact-two', 'immersion'] as const;
export type ResultLayout = (typeof LAYOUTS)[number];

export interface ActionResult {
  readonly action: string;
  readonly detail: string;
}

/**
 * 以 DOM `click()` 觸發官方按鈕。不用 Playwright 的座標點擊：擴充側欄會蓋住部分官方區域，
 * dev 瀏覽器視窗很小或在背景時，可點擊性檢查也會一直重試到逾時。
 */
async function domClick(locator: Locator): Promise<void> {
  await locator
    .first()
    .evaluate((el) => (el as HTMLElement).click(), undefined, { timeout: 10_000 });
}

function describeResponse(response: Response): string {
  const status = response.status();
  return status === 429 ? '429（官方速率限制，請稍後再試）' : String(status);
}

/** 會發請求：按官方「搜尋」並等到結果或錯誤列出現 */
export async function runSearch(page: Page): Promise<ActionResult> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => SEARCH_API.test(r.url()) && r.request().method() === 'POST', {
      timeout: 15_000,
    }),
    domClick(page.locator('.search-panel .controls .search-btn')),
  ]);
  // 搜尋 API 只回傳 id 清單，結果列要等官方再打 fetch API 才會出現
  const body = (await response.json().catch(() => null)) as {
    result?: unknown[];
    total?: number;
  } | null;
  const hits = Array.isArray(body?.result) ? body.result.length : 0;
  await page
    .locator(hits > 0 ? RESULT_ROW : RESULT_EMPTY_OR_ERROR)
    .first()
    .waitFor({ timeout: 15_000 });
  return {
    action: 'search',
    detail: `search API ${describeResponse(response)}，${body?.total ?? '?'} 筆符合`,
  };
}

/** 會發請求：按「載入更多」並等 fetch 回應 */
export async function loadMore(page: Page): Promise<ActionResult> {
  const button = page.locator('.results .load-more-btn');
  if ((await button.count()) === 0) return { action: 'load-more', detail: '沒有載入更多按鈕' };
  const [response] = await Promise.all([
    page.waitForResponse((r) => FETCH_API.test(r.url()), { timeout: 15_000 }),
    domClick(button),
  ]);
  return { action: 'load-more', detail: `fetch API ${describeResponse(response)}` };
}

/** 展開或收合官方篩選區；狀態已符合時不動作 */
export async function setFiltersVisible(page: Page, visible: boolean): Promise<ActionResult> {
  const advanced = page.locator('.search-panel .search-advanced');
  const isHidden = async () =>
    (await advanced.getAttribute('class'))?.includes('search-advanced-hidden');
  if ((await isHidden()) === !visible) {
    return { action: 'filters', detail: `已是${visible ? '展開' : '收合'}狀態` };
  }
  await domClick(page.locator('.search-panel .toggle-search-btn'));
  await page.waitForFunction(
    (wantHidden) =>
      document
        .querySelector('.search-panel .search-advanced')
        ?.classList.contains('search-advanced-hidden') === wantHidden,
    !visible,
  );
  return { action: 'filters', detail: visible ? '已展開' : '已收合' };
}

/** 會發請求（開啟時）：切換官方線上搜尋，以網址是否帶 `/live` 判斷狀態 */
export async function setLiveSearch(page: Page, on: boolean): Promise<ActionResult> {
  const isLive = () => /\/live(?:$|[?#])/.test(page.url());
  if (isLive() === on) return { action: 'live', detail: `已是${on ? '開啟' : '關閉'}狀態` };
  await domClick(page.locator('.search-panel .controls .livesearch-btn'));
  await page.waitForURL((url) => /\/live(?:$|[?#])/.test(url.href) === on, { timeout: 15_000 });
  return { action: 'live', detail: on ? '已開啟線上搜尋' : '已關閉線上搜尋' };
}

/** 切換結果版型（需要已有結果） */
export async function setLayout(page: Page, layout: ResultLayout): Promise<ActionResult> {
  const button = page.locator(`.results .row-total .layout-btn.layout-${layout}`);
  if ((await button.count()) === 0) throw new Error('找不到版型按鈕；需要先有搜尋結果');
  await domClick(button);
  return { action: 'layout', detail: `已切換為 ${layout}` };
}

/** 按官方「清除」重設篩選條件（不發請求） */
export async function clearSearch(page: Page): Promise<ActionResult> {
  await domClick(page.locator('.search-panel .controls .clear-btn'));
  return { action: 'clear', detail: '已清除篩選條件' };
}
