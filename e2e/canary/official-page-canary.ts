/**
 * 實機金絲雀：檢查真正的官方交易頁面仍符合擴充功能依賴的 DOM 與 Vuex 契約（e2e/official-page-contract.ts）。
 *
 * 用法：`pnpm dev` 開著，在 dev 瀏覽器開好一個有結果的官方搜尋頁（PoE1 或 PoE2），然後執行
 *   pnpm e2e:canary
 *
 * 只讀取已開啟分頁的 DOM 與 store：不開新分頁、不重新整理、不發任何請求，所以不會消耗官方 API 的速率限制。
 * 不放進 CI：CI 的瀏覽器過不了 Cloudflare。任一項失敗時以非零狀態碼結束。
 */
import { chromium, type Page } from '@playwright/test';
import { resolveDevBrowserCdpUrl } from '../cdp-endpoint.ts';
import {
  inspectOfficialPage,
  RESULT_ROW_DOM,
  RESULT_ROW_SELECTOR,
  SEARCH_PAGE_DOM,
  STORE_MUTATIONS,
  type DomCheck,
  type PageInspection,
} from '../official-page-contract.ts';

const OFFICIAL_SEARCH_PAGE = /^https:\/\/www\.pathofexile\.com\/trade2?\/search\//;

const USED_BY = new Map<string, string>(
  [...SEARCH_PAGE_DOM, ...RESULT_ROW_DOM].map((check: DomCheck) => [check.id, check.usedBy]),
);

async function inspect(page: Page): Promise<PageInspection> {
  return page.evaluate(inspectOfficialPage, {
    searchPage: SEARCH_PAGE_DOM,
    rowSelector: RESULT_ROW_SELECTOR,
    row: RESULT_ROW_DOM,
    mutations: STORE_MUTATIONS,
    requireRows: true,
  });
}

function report(inspection: PageInspection): number {
  console.log(`\n${inspection.url}（${inspection.rowCount} 列結果）`);
  let failures = 0;
  for (const result of inspection.results) {
    if (!result.ok) failures += 1;
    const usedBy = USED_BY.get(result.id);
    const suffix = !result.ok && usedBy ? `\n      影響：${usedBy}` : '';
    console.log(
      `  ${result.ok ? 'ok  ' : 'FAIL'} ${result.id.padEnd(20)} ${result.detail}${suffix}`,
    );
  }
  return failures;
}

async function main(): Promise<void> {
  const browser = await chromium.connectOverCDP(await resolveDevBrowserCdpUrl());
  try {
    const pages = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => OFFICIAL_SEARCH_PAGE.test(page.url()));
    if (pages.length === 0) {
      throw new Error(
        'dev 瀏覽器裡沒有官方搜尋頁（https://www.pathofexile.com/trade/search/... 或 /trade2/search/...）',
      );
    }
    let failures = 0;
    for (const page of pages) failures += report(await inspect(page));
    console.log(failures === 0 ? '\n官方頁面符合契約。' : `\n${failures} 項不符合契約。`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    // connectOverCDP 的 close 只中斷連線，不會關掉使用者的瀏覽器
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
