/**
 * 市集漢化的 MAIN world 執行期（ADR-0012）：在 document_start 由 manifest 宣告的腳本啟動。
 *
 * - 包住 `fetch`，四份 data API 等到 isolated world 送來 payload（或停用、逾時）才送出，
 *   讓官網開始渲染前就拿得到翻譯資料。
 * - 收到 payload 後把官方介面字典寫進全域 `__`（官網 `translate()` 每次顯示文字都讀它）。
 *   若 Vue app 已經掛載，對所有元件 `$forceUpdate()` 讓已顯示的文字重新取字。
 *
 * 只改頁面記憶體，不寫入官網的 localStorage / cookie，也不改送往 API 的請求內容。
 * 這支在頁面環境執行，只能 import 不依賴擴充 API 的模組。
 */
import {
  createRequestMessage,
  isMarketTranslationMessage,
  type MarketTranslationPayload,
} from './market-translation-protocol';

const DATA_API_PATH = /^\/api\/trade2?\/data\/(?:items|stats|static|filters)$/;

export function isTradeDataRequest(input: RequestInfo | URL, baseHref: string): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (!raw) return false;
    const url = new URL(raw, baseHref);
    return url.origin === new URL(baseHref).origin && DATA_API_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export interface PayloadGate {
  /** 第一次呼叫生效：payload 代表翻譯、null 代表停用 */
  settle(payload: MarketTranslationPayload | null): void;
  /** 回傳已決定的結果；尚未決定時最多等 timeoutMs，逾時回傳 null */
  wait(): Promise<MarketTranslationPayload | null>;
  readonly settled: boolean;
}

export function createPayloadGate(timeoutMs: number): PayloadGate {
  let settled = false;
  let resolveSettled: (value: MarketTranslationPayload | null) => void = () => {};
  const settledPromise = new Promise<MarketTranslationPayload | null>((resolve) => {
    resolveSettled = resolve;
  });

  return {
    settle(payload) {
      if (settled) return;
      settled = true;
      resolveSettled(payload);
    },
    wait() {
      if (settled) return settledPromise;
      return Promise.race([
        settledPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
    },
    get settled() {
      return settled;
    },
  };
}

export function wrapFetchWithGate(win: Window, gate: PayloadGate): () => void {
  const originalFetch = win.fetch;
  if (typeof originalFetch !== 'function') return () => {};

  const gatedFetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    if (isTradeDataRequest(args[0], win.location.href)) await gate.wait();
    return originalFetch.apply(this, args);
  };
  win.fetch = gatedFetch as typeof fetch;
  return () => {
    if (win.fetch === gatedFetch) win.fetch = originalFetch;
  };
}

/** 寫入全域 `__`；已有 `__`（例如其他翻譯擴充）時只補缺的鍵。回傳新增的鍵數。 */
export function applyUiDictionary(win: Window, strings: Record<string, string>): number {
  const host = win as unknown as { __?: Record<string, string> };
  const existing = host.__;
  if (!existing || typeof existing !== 'object') {
    host.__ = { ...strings };
    return Object.keys(strings).length;
  }
  let added = 0;
  for (const [key, value] of Object.entries(strings)) {
    if (!(key in existing)) {
      existing[key] = value;
      added += 1;
    }
  }
  return added;
}

interface VNodeLike {
  component?: ComponentInstanceLike | null;
  children?: unknown;
}

interface ComponentInstanceLike {
  proxy?: { $forceUpdate?: () => void } | null;
  subTree?: VNodeLike | null;
}

function forceUpdateTree(instance: ComponentInstanceLike, visited: Set<unknown>): void {
  if (visited.has(instance)) return;
  visited.add(instance);
  instance.proxy?.$forceUpdate?.();
  if (instance.subTree) visitVNode(instance.subTree, visited);
}

function visitVNode(vnode: unknown, visited: Set<unknown>): void {
  if (!vnode || typeof vnode !== 'object') return;
  const node = vnode as VNodeLike;
  if (node.component) forceUpdateTree(node.component, visited);
  if (Array.isArray(node.children)) {
    for (const child of node.children) visitVNode(child, visited);
  }
}

/** 對頁面上已掛載的 Vue 3 app 全部 `$forceUpdate()`；沒有掛載的 app 時回傳 false。 */
export function forceRerenderVueApps(doc: Document): boolean {
  const hosts = Array.from(doc.querySelectorAll('[data-v-app]'));
  let updated = false;
  for (const host of hosts) {
    const root = (host as unknown as { __vue_app__?: { _instance?: ComponentInstanceLike } })
      .__vue_app__?._instance;
    if (!root) continue;
    try {
      forceUpdateTree(root, new Set());
      updated = true;
    } catch {
      // 官網改版導致結構不符時放棄重繪：只影響已顯示的文字，之後的渲染仍會讀到 `__`
    }
  }
  return updated;
}

export interface MarketTranslationPageOptions {
  /** data API 最多等待 payload 的時間（毫秒） */
  timeoutMs: number;
}

export function startMarketTranslationPage(
  win: Window,
  options: MarketTranslationPageOptions,
): () => void {
  const gate = createPayloadGate(options.timeoutMs);
  const restoreFetch = wrapFetchWithGate(win, gate);

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== win || !isMarketTranslationMessage(event.data)) return;
    const message = event.data;
    if (message.type === 'request' || gate.settled) return;
    if (message.type === 'disabled') {
      gate.settle(null);
      return;
    }
    applyUiDictionary(win, message.payload.ui);
    gate.settle(message.payload);
    forceRerenderVueApps(win.document);
  };

  win.addEventListener('message', handleMessage);
  win.postMessage(createRequestMessage(), win.location.origin);

  return () => {
    win.removeEventListener('message', handleMessage);
    restoreFetch();
  };
}
