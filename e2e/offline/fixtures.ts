import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { startLiveSocketServer, type LiveSocketServer } from './live-socket-server.ts';

export type { LiveSocket } from './live-socket-server.ts';

/**
 * 離線 E2E：載入 `.output/chrome-mv3` 的建置，官方網站與所有外部請求都由本檔回放或擋下。
 * 不連真正的官方網站，所以不會遇到 Cloudflare，也不會消耗官方 API 的速率限制，可在 CI 執行。
 */

const ROOT = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = resolve(ROOT, process.env.POEXD_E2E_EXTENSION_DIR ?? '.output/chrome-mv3');
const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures');

/** PoE2 剛打開、還沒搜尋的空白搜尋頁（網址沒有 search id，替身頁不會自動搜尋） */
export const TRADE2_SEARCH_URL = 'https://www.pathofexile.com/trade2/search/poe2/Standard';
/** 官方的 search id 就是 query 物件 gzip 後的 Base64URL（以 `H4sI` 開頭），擴充功能會解碼取得搜尋條件 */
function searchIdFor(query: unknown): string {
  return gzipSync(JSON.stringify(query)).toString('base64url');
}

export const TRADE1_SEARCH_ID = searchIdFor({
  status: { option: 'online' },
  type: 'Coronal Leather',
  stats: [{ type: 'and', filters: [] }],
});
/** 替身頁在頁面上做第二次搜尋（SPA，不重新載入）時使用的 search id；只回傳最後兩筆結果 */
export const TRADE1_SECOND_SEARCH_ID = searchIdFor({
  status: { option: 'online' },
  type: 'Plated Greaves',
  stats: [{ type: 'and', filters: [] }],
});
export const TRADE1_SEARCH_URL = `https://www.pathofexile.com/trade/search/Standard/${TRADE1_SEARCH_ID}`;
export const TRADE2_SEARCH_ID = searchIdFor({
  status: { option: 'online' },
  stats: [{ type: 'and', filters: [] }],
});
/** 有結果的 PoE2 搜尋頁 */
export const TRADE2_RESULTS_URL = `${TRADE2_SEARCH_URL}/${TRADE2_SEARCH_ID}`;
/** 台服（Garena）的同一個搜尋：介面語系依網域判定為 zh-TW，且沒有價格換算 */
export const TRADE1_TW_SEARCH_URL = `https://pathofexile.tw/trade/search/Standard/${TRADE1_SEARCH_ID}`;

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), 'utf8');
}

interface FetchFixture {
  result: {
    id: string;
    item: { name?: string; typeLine: string };
    listing: { price: { amount: number; currency: string }; account: { name: string } };
  }[];
}

/** `record-fetch.ts` 從真實官方 API 錄下並去除個資的 PoE1 fetch 回應 */
export const POE1_FETCH: FetchFixture = JSON.parse(fixture('poe1-fetch.json'));
/** `record-fetch.ts poe2` 錄下的 PoE2 fetch 回應 */
export const POE2_FETCH: FetchFixture = JSON.parse(fixture('poe2-fetch.json'));

/** background 的價格換算向 poe.ninja 要的匯率；合成的固定值，以混沌石為基準 */
export const POE_NINJA_OVERVIEW = {
  core: { primary: 'chaos' },
  lines: [
    { id: 'chaos', primaryValue: 1 },
    { id: 'alch', primaryValue: 0.1 },
    { id: 'divine', primaryValue: 150 },
  ],
};

/** 官方 `/api/trade/data/leagues` 的合成回應；擴充功能只讀 id、text 與 realm */
export const TRADE_LEAGUES = {
  result: [
    { id: 'Standard', realm: 'pc', text: 'Standard' },
    { id: 'Hardcore', realm: 'pc', text: 'Hardcore' },
    { id: 'Standard', realm: 'poe2', text: 'Standard' },
  ],
};

/** PoE2 的匯率以崇高石為基準；換算一律換成崇高石，所以只有非崇高石標價的物品會顯示換算 */
export const POE2_NINJA_OVERVIEW = {
  core: { primary: 'exalted' },
  lines: [
    { id: 'exalted', primaryValue: 1 },
    { id: 'regal', primaryValue: 0.2 },
    { id: 'chaos', primaryValue: 40 },
    { id: 'divine', primaryValue: 400 },
  ],
};

/** 測試期間被擋下的外部請求，讓測試能確認沒有漏網的真實連線 */
export interface NetworkLog {
  blocked: string[];
}

type Reply = { html: string } | { json: unknown } | { png: Buffer };

/** 1×1 透明 PNG，代替官方 CDN 的物品與通貨圖示 */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** 各 search id 對應的結果，對照官方 `POST /api/trade/search` 回傳的 result 清單 */
export function searchResultIds(searchId: string): string[] {
  const ids = POE1_FETCH.result.map((entry) => entry.id);
  return searchId === TRADE1_SECOND_SEARCH_ID ? ids.slice(-2) : ids;
}

/**
 * 依官方網址回傳替身頁或回放的 API；回傳 null 代表這個請求不該發生。
 * 替身頁以 `x-e2e-search-id` 標頭指定這次搜尋要拿到哪個 search id（官方由伺服器決定）。
 */
function replay(
  url: URL,
  method: string,
  resourceType: string,
  headers: Record<string, string>,
): Reply | null {
  if (url.hostname === 'poe.ninja' && url.pathname.endsWith('/economy/exchange/current/overview')) {
    return { json: url.pathname.startsWith('/poe2/') ? POE2_NINJA_OVERVIEW : POE_NINJA_OVERVIEW };
  }
  if (url.hostname.endsWith('poecdn.com') && url.pathname.endsWith('.png')) {
    return { png: BLANK_PNG };
  }
  // 國際服與台服（Garena）的官方網站共用同一套前端，替身頁與 API 回放相同
  if (!/(^|\.)pathofexile\.(com|tw)$/.test(url.hostname)) return null;
  const path = url.pathname;
  // Trade root 是線上搜尋主控台開啟的頁面，替身頁在這裡只掛官方 store、不自動搜尋
  if (/^\/trade\/?$/.test(path) || /^\/trade2?\/search\//.test(path)) {
    return { html: fixture('trade-search.html') };
  }
  if (/^\/api\/trade2?\/data\/leagues$/.test(path)) return { json: TRADE_LEAGUES };
  if (method === 'POST' && path.startsWith('/api/trade/search/')) {
    const id = headers['x-e2e-search-id'] || TRADE1_SEARCH_ID;
    const ids = searchResultIds(id);
    return { json: { id, complexity: 1, result: ids, total: ids.length } };
  }
  if (method === 'POST' && path.startsWith('/api/trade2/search/poe2/')) {
    const id = headers['x-e2e-search-id'] || TRADE2_SEARCH_ID;
    const ids = POE2_FETCH.result.map((entry) => entry.id);
    return { json: { id, complexity: 1, result: ids, total: ids.length } };
  }
  const fetched = /^\/api\/(trade2?)\/fetch\/([^/]+)$/.exec(path);
  if (fetched) {
    const wanted = new Set(decodeURIComponent(fetched[2]).split(','));
    const source = fetched[1] === 'trade2' ? POE2_FETCH : POE1_FETCH;
    return { json: { result: source.result.filter((entry) => wanted.has(entry.id)) } };
  }
  if (resourceType === 'document') return { html: fixture('non-trade.html') };
  return null;
}

async function installNetworkSandbox(context: BrowserContext, log: NetworkLog): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'chrome-extension:') {
      await route.continue();
      return;
    }
    const reply = replay(url, request.method(), request.resourceType(), request.headers());
    if (!reply) {
      log.blocked.push(`${request.method()} ${url.href}`);
      await route.abort('blockedbyclient');
      return;
    }
    if ('html' in reply) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: reply.html,
      });
    } else if ('png' in reply) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: reply.png });
    } else {
      await route.fulfill({ status: 200, json: reply.json });
    }
  });
}

/**
 * 全新安裝時 background 會在 `runtime.onInstalled` 寫入初始導覽狀態，第一次展開側邊欄就會跳出導覽。
 * 等那筆狀態寫入後再標成已完成，避免與 onInstalled 競速。
 */
async function completeOnboarding(serviceWorker: Worker): Promise<void> {
  await serviceWorker.evaluate(async () => {
    const key = 'poexdOnboarding';
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await chrome.storage.local.get(key))[key]) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await chrome.storage.local.set({ [key]: { tourPending: false, expandHintPending: false } });
  });
}

export interface OfflineOptions {
  /** 保留全新安裝的導覽狀態；預設 false，測試直接從已完成導覽開始 */
  freshInstall: boolean;
}

export interface OfflineFixtures {
  network: NetworkLog;
  /** 官方即時搜尋 WebSocket 的本機替身 */
  liveSockets: Omit<LiveSocketServer, 'port' | 'close'>;
  /** 頁面上未捕捉的例外與 console.error，測試結束時應為空 */
  pageErrors: string[];
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<OfflineOptions & OfflineFixtures & { context: BrowserContext }>({
  network: async ({}, use) => {
    await use({ blocked: [] });
  },
  liveSockets: async ({ network }, use) => {
    const server = await startLiveSocketServer({
      blocked: network.blocked,
      documentFor: (url) => {
        const reply = replay(url, 'GET', 'document', {});
        return reply && 'html' in reply ? reply.html : null;
      },
    });
    await use(server);
    await server.close();
  },
  context: async ({ network, liveSockets }, use) => {
    const { port } = liveSockets as LiveSocketServer;
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      locale: 'en-US',
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        // 一般請求在 DNS 之前就被 context.route 回放或擋下。會真的連線的只剩 context.route 攔不到的：
        // content script 的 WebSocket，以及擴充功能以 chrome.tabs.create 開分頁的第一次導覽。
        // 官方網域導到本機替身，其餘一律解析失敗，確保不會連到任何真正的網站。
        `--host-resolver-rules=MAP www.pathofexile.com 127.0.0.1:${port}, MAP * ~NOTFOUND`,
        '--ignore-certificate-errors',
      ],
    });
    await installNetworkSandbox(context, network);
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers().find((sw) => sw.url().endsWith('/background.js')) ??
      (await context.waitForEvent('serviceworker', {
        predicate: (sw) => sw.url().endsWith('/background.js'),
      }));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  freshInstall: [false, { option: true }],
  page: async ({ context, serviceWorker, freshInstall }, use) => {
    if (!freshInstall) await completeOnboarding(serviceWorker);
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
    });
    await use(errors);
  },
});

export { expect } from '@playwright/test';
