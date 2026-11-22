/**
 * 從 `pnpm dev` 的瀏覽器錄一份官方 fetch 回應，去除個資後存成離線 E2E 的 fixture。
 *
 * 用法：在 dev 瀏覽器開好一個有結果的搜尋頁，然後執行
 *   node e2e/offline/record-fetch.ts [poe1|poe2，預設 poe1] [筆數，預設 5]
 *
 * 只對畫面上已列出的物品重送一次 fetch（等同使用者捲動載入一頁），不會發出搜尋請求。
 * 只保存 API JSON，不保存官方網站的 HTML / JS / CSS。
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { resolveDevBrowserCdpUrl } from '../cdp-endpoint.ts';

type Game = 'poe1' | 'poe2';

const GAMES: Record<Game, { searchPage: RegExp; fetchPath: string; realm: string }> = {
  poe1: {
    searchPage: /pathofexile\.com\/trade\/search\//,
    fetchPath: '/api/trade/fetch/',
    realm: '',
  },
  poe2: {
    searchPage: /pathofexile\.com\/trade2\/search\/poe2\//,
    fetchPath: '/api/trade2/fetch/',
    realm: '&realm=poe2',
  },
};

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
  const game: Game = process.argv[2] === 'poe2' ? 'poe2' : 'poe1';
  const limitArg =
    process.argv[2] === 'poe1' || process.argv[2] === 'poe2' ? process.argv[3] : process.argv[2];
  const limit = Number(limitArg ?? 5);
  const { searchPage, fetchPath, realm } = GAMES[game];
  const output = resolve(import.meta.dirname, `fixtures/${game}-fetch.json`);
  const browser = await chromium.connectOverCDP(await resolveDevBrowserCdpUrl());
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => searchPage.test(candidate.url()));
    if (!page)
      throw new Error(
        `dev 瀏覽器裡沒有 ${game === 'poe2' ? 'PoE2 搜尋頁（/trade2/search/poe2/...）' : 'PoE1 搜尋頁（/trade/search/...）'}`,
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
      async ({ ids, searchId, fetchPath, realm }) => {
        const response = await fetch(`${fetchPath}${ids.join(',')}?query=${searchId}${realm}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error(`fetch 回應 ${response.status}`);
        return response.json();
      },
      { ids, searchId, fetchPath, realm },
    );
    const results = (body.result as FetchResult[]).map(scrubFetchResult);
    writeFileSync(output, `${JSON.stringify({ result: results }, null, 2)}\n`);
    console.log(`已寫入 ${results.length} 筆到 ${output}`);
  } finally {
    // 只中斷 CDP 連線，不關閉使用者的 dev 瀏覽器
    await browser.close();
  }
}

await main();
