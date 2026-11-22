/**
 * 效能量測腳本共用：連上已開啟遠端除錯的 Chrome，必要時先載入指定的 unpacked build。
 *
 * 量測對象是使用者真實的 Chrome profile：只開自己的分頁、結束時關掉，不碰既有的交易分頁。
 */
import { chromium } from '@playwright/test';

export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

/** 共用 CLI 選項（node:util parseArgs 格式） */
export const commonOptions = {
  url: { type: 'string' },
  cdp: { type: 'string', default: DEFAULT_CDP_URL },
  ext: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
};

export function requireTradeUrl(value) {
  if (!value)
    throw new Error(
      '缺少 --url（官方交易搜尋網址，例如 https://www.pathofexile.com/trade/search/<聯盟>/<查詢>）',
    );
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--url 不是合法網址：${value}`);
  }
  if (url.protocol !== 'https:' || !/\/trade2?\/search\//.test(url.pathname)) {
    throw new Error(`--url 必須是 https 的官方交易搜尋頁：${value}`);
  }
  return url.href;
}

/** 對瀏覽器層級 CDP 端點送出單一指令 */
async function sendBrowserCommand(cdpUrl, method, params = {}) {
  const response = await fetch(new URL('/json/version', cdpUrl));
  if (!response.ok) throw new Error(`無法讀取 ${cdpUrl}/json/version：HTTP ${response.status}`);
  const { webSocketDebuggerUrl } = await response.json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`無法連上 ${webSocketDebuggerUrl}`));
    });
    const message = await new Promise((resolve) => {
      ws.onmessage = (event) => resolve(JSON.parse(event.data));
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    if (message.error) throw new Error(`${method} 失敗：${JSON.stringify(message.error)}`);
    return message.result;
  } finally {
    ws.close();
  }
}

/** 連上 Chrome；給了 extPath 就先以 unpacked 方式載入該 build（同 id 會取代現有版本） */
export async function connect({ cdp, ext }) {
  if (ext) {
    const result = await sendBrowserCommand(cdp, 'Extensions.loadUnpacked', { path: ext });
    console.error(`已載入 unpacked build：${ext}${result?.id ? `（${result.id}）` : ''}`);
  }
  const browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome 沒有可用的 browser context');
  return { browser, context };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function median(values) {
  const sorted = values.filter((value) => typeof value === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : null;
}
