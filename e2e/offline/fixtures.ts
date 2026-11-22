import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

/**
 * 離線 E2E：載入 `.output/chrome-mv3` 的建置，官方網站與所有外部請求都由本檔回放或擋下。
 * 不連真正的官方網站，所以不會遇到 Cloudflare，也不會消耗官方 API 的速率限制，可在 CI 執行。
 */

const ROOT = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = resolve(ROOT, process.env.POEXD_E2E_EXTENSION_DIR ?? '.output/chrome-mv3');
const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures');

export const TRADE2_SEARCH_URL = 'https://www.pathofexile.com/trade2/search/poe2/Standard';
export const TRADE1_SEARCH_ID = 'E2ESearch';
export const TRADE1_SEARCH_URL = `https://www.pathofexile.com/trade/search/Standard/${TRADE1_SEARCH_ID}`;

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), 'utf8');
}

interface FetchFixture {
  result: { id: string; item: { name?: string; typeLine: string } }[];
}

/** `record-fetch.ts` 從真實官方 API 錄下並去除個資的 PoE1 fetch 回應 */
export const POE1_FETCH: FetchFixture = JSON.parse(fixture('poe1-fetch.json'));

/** background 的價格換算向 poe.ninja 要的匯率；合成的固定值，以混沌石為基準 */
export const POE_NINJA_OVERVIEW = {
  core: { primary: 'chaos' },
  lines: [
    { id: 'chaos', primaryValue: 1 },
    { id: 'alch', primaryValue: 0.1 },
    { id: 'divine', primaryValue: 150 },
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

/** 依官方網址回傳替身頁或回放的 API；回傳 null 代表這個請求不該發生 */
function replay(url: URL, method: string, resourceType: string): Reply | null {
  if (url.hostname === 'poe.ninja' && url.pathname.endsWith('/economy/exchange/current/overview')) {
    return { json: POE_NINJA_OVERVIEW };
  }
  if (url.hostname.endsWith('poecdn.com') && url.pathname.endsWith('.png')) {
    return { png: BLANK_PNG };
  }
  if (!url.hostname.endsWith('pathofexile.com')) return null;
  const path = url.pathname;
  if (path.startsWith('/trade2/search/')) return { html: fixture('trade2-search.html') };
  if (path.startsWith('/trade/search/')) return { html: fixture('trade1-search.html') };
  if (method === 'POST' && path.startsWith('/api/trade/search/')) {
    const ids = POE1_FETCH.result.map((entry) => entry.id);
    return { json: { id: TRADE1_SEARCH_ID, complexity: 1, result: ids, total: ids.length } };
  }
  if (path.startsWith('/api/trade/fetch/')) {
    const wanted = new Set(decodeURIComponent(path.split('/').at(-1) ?? '').split(','));
    return { json: { result: POE1_FETCH.result.filter((entry) => wanted.has(entry.id)) } };
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
    const reply = replay(url, request.method(), request.resourceType());
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
  /** 頁面上未捕捉的例外與 console.error，測試結束時應為空 */
  pageErrors: string[];
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<OfflineOptions & OfflineFixtures & { context: BrowserContext }>({
  network: async ({}, use) => {
    await use({ blocked: [] });
  },
  context: async ({ network }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
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
