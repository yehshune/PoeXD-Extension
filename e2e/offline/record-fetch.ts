/**
 * 從 `pnpm dev` 的瀏覽器錄一份官方 `/api/trade/fetch` 回應，去除個資後存成離線 E2E 的 fixture。
 *
 * 用法：在 dev 瀏覽器開好一個有結果的 PoE1 搜尋頁，然後執行
 *   node e2e/offline/record-fetch.ts [筆數，預設 5]
 *
 * 只對畫面上已列出的物品重送一次 fetch（等同使用者捲動載入一頁），不會發出搜尋請求。
 * 只保存 API JSON，不保存官方網站的 HTML / JS / CSS。
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { resolveDevBrowserCdpUrl } from '../cdp-endpoint.ts';

const OUTPUT = resolve(import.meta.dirname, 'fixtures/poe1-fetch.json');
const TRADE1_SEARCH_URL = /pathofexile\.com\/trade\/search\//;

interface FetchResult {
  id: string;
  listing: Record<string, unknown> & {
    account?: Record<string, unknown>;
    stash?: Record<string, unknown>;
  };
  item: Record<string, unknown>;
}

/** 賣家帳號、角色、藏身處 token（JWT）與倉庫名稱一律換成假值；聯盟固定為 Standard */
export function scrubFetchResult(result: FetchResult, index: number): FetchResult {
  const {
    hideout_token: _token,
    whisper: _whisper,
    whisper_token: _whisperToken,
    ...listing
  } = result.listing;
  return {
    ...result,
    listing: {
      ...listing,
      account: { name: `E2ESeller#${1000 + index}`, online: null },
      ...(listing.stash ? { stash: { ...listing.stash, name: 'E2E Stash' } } : {}),
      hideout_token: 'e2e-hideout-token',
    },
    item: { ...result.item, league: 'Standard' },
  };
}

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 5);
  const browser = await chromium.connectOverCDP(await resolveDevBrowserCdpUrl());
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => TRADE1_SEARCH_URL.test(candidate.url()));
    if (!page)
      throw new Error(
        'dev 瀏覽器裡沒有 PoE1 搜尋頁（https://www.pathofexile.com/trade/search/...）',
      );

    const searchId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
    const ids: string[] = await page.evaluate(
      (max) =>
        Array.from(document.querySelectorAll('.results .row[data-id]'))
          .map((row) => row.getAttribute('data-id') ?? '')
          .filter(Boolean)
          .slice(0, max),
      limit,
    );
    if (ids.length === 0) throw new Error('搜尋頁上沒有結果列，請先完成一次搜尋');

    const body = await page.evaluate(
      async ({ ids, searchId }) => {
        const response = await fetch(`/api/trade/fetch/${ids.join(',')}?query=${searchId}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error(`fetch 回應 ${response.status}`);
        return response.json();
      },
      { ids, searchId },
    );
    const results = (body.result as FetchResult[]).map(scrubFetchResult);
    writeFileSync(OUTPUT, `${JSON.stringify({ result: results }, null, 2)}\n`);
    console.log(`已寫入 ${results.length} 筆到 ${OUTPUT}`);
  } finally {
    // 只中斷 CDP 連線，不關閉使用者的 dev 瀏覽器
    await browser.close();
  }
}

await main();
