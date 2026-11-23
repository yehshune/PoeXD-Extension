/**
 * 市集漢化的 MAIN world 執行期（ADR-0012）：在 document_start 由 manifest 宣告的腳本啟動。
 *
 * - 包住 `fetch`，四份 data API 等到 isolated world 送來 payload（或停用、逾時）才送出，
 *   讓官網開始渲染前就拿得到翻譯資料。
 * - 收到 payload 後把官方介面字典寫進全域 `__`（官網 `translate()` 每次顯示文字都讀它）。
 *   若 Vue app 已經掛載，對所有元件 `$forceUpdate()` 讓已顯示的文字重新取字。
 *
 * - payload 帶 data API 字典時，把四份 data API 的回應換成中文版（只換顯示文字，id 不變）。
 *
 * 只改頁面記憶體，不寫入官網的 localStorage / cookie，也不改送往 API 的請求內容。
 * 這支在頁面環境執行，只能 import 不依賴擴充 API 的模組。
 */
import {
  expandKnownItemFilters,
  getTradeDataKind,
  localizeTradeData,
  type TradeDataKind,
} from './market-translation-data';
import {
  createRequestMessage,
  isMarketTranslationMessage,
  isMarketTranslationPortMessage,
  type MarketTranslationPayload,
} from './market-translation-protocol';

/** 同源的四份 data API 回傳其種類，其他請求回傳 null */
export function getTradeDataRequestKind(
  input: RequestInfo | URL,
  baseHref: string,
): TradeDataKind | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (!raw) return null;
    const url = new URL(raw, baseHref);
    return url.origin === new URL(baseHref).origin ? getTradeDataKind(url.pathname) : null;
  } catch {
    return null;
  }
}

/** 請求的 origin + pathname（共用 items 回應的鍵）；無法解析時回傳 null */
function requestUrl(input: RequestInfo | URL, baseHref: string): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (!raw) return null;
    const url = new URL(raw, baseHref);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function isTradeDataRequest(input: RequestInfo | URL, baseHref: string): boolean {
  return getTradeDataRequestKind(input, baseHref) !== null;
}

/**
 * 把 data API 回應換成中文版；任何不符（停用、沒字典、錯誤狀態、不是 JSON）都回傳原回應。
 * 只換顯示文字，搜尋用的 id 不變（見 market-translation-data.ts）。
 */
async function localizeResponse(
  response: Response,
  kind: TradeDataKind,
  payload: MarketTranslationPayload | null,
  loadItems?: () => Promise<unknown>,
): Promise<Response> {
  if (!payload?.data || !response.ok) return response;
  try {
    const original: unknown = await response.clone().json();
    const dictionary = { ...payload.data, ui: payload.ui };
    const options = { bilingual: payload.bilingual };
    let localized = localizeTradeData(kind, original, dictionary, options);
    if (kind === 'filters' && loadItems) {
      // items 讀不到時 knownItem 欄位維持官網原本的英文選項
      const items = await loadItems().catch(() => null);
      localized = expandKnownItemFilters(localized, items, dictionary, options);
    }
    if (localized === original) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    const rewritten = new Response(JSON.stringify(localized), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    Object.defineProperty(rewritten, 'url', { value: response.url });
    return rewritten;
  } catch {
    return response;
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

export function wrapFetchWithGate(
  win: Window,
  gate: PayloadGate,
  onDataResponse?: (payload: MarketTranslationPayload) => void,
): () => void {
  const originalFetch = win.fetch;
  if (typeof originalFetch !== 'function') return () => {};

  // items 回應由官網與 filters 改寫共用（knownItem 選項要用 items 展開），只送一次請求；
  // 每個使用者各取一份 clone，原回應本體不讀。
  const sharedItems = new Map<string, Promise<Response>>();
  const fetchItems = (url: string, send: () => Promise<Response>) => {
    let pending = sharedItems.get(url);
    if (!pending) {
      pending = send();
      sharedItems.set(url, pending);
      pending.catch(() => sharedItems.delete(url));
    }
    return pending.then((response) => response.clone());
  };

  const gatedFetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const kind = getTradeDataRequestKind(args[0], win.location.href);
    if (!kind) return originalFetch.apply(this, args);
    const payload = await gate.wait();
    const url = requestUrl(args[0], win.location.href);
    if (kind === 'items' && url) {
      const response = await fetchItems(url, () => originalFetch.apply(this, args));
      if (payload) onDataResponse?.(payload);
      return localizeResponse(response, kind, payload);
    }
    const response = await originalFetch.apply(this, args);
    const itemsUrl = kind === 'filters' && url ? url.replace(/\/filters$/, '/items') : null;
    const loadItems = itemsUrl
      ? () =>
          fetchItems(itemsUrl, () => originalFetch.call(win, itemsUrl)).then((items) =>
            items.ok ? items.json() : null,
          )
      : undefined;
    if (payload) onDataResponse?.(payload);
    return localizeResponse(response, kind, payload, loadItems);
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
  proxy?: {
    $forceUpdate?: () => void;
    static_?: Record<string, unknown> | null;
  } | null;
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

interface VueHostLike {
  _vnode?: VNodeLike | null;
  __vue_app__?: {
    _instance?: ComponentInstanceLike | null;
    _container?: { _vnode?: VNodeLike | null } | null;
  } | null;
}

function getVueRootInstance(host: VueHostLike): ComponentInstanceLike | null {
  return (
    host._vnode?.component ??
    host.__vue_app__?._container?._vnode?.component ??
    host.__vue_app__?._instance ??
    null
  );
}

function translateField(
  target: Record<string, unknown>,
  key: string,
  strings: Record<string, string>,
): number {
  const value = target[key];
  if (typeof value !== 'string') return 0;
  const translated = Object.prototype.hasOwnProperty.call(strings, value)
    ? strings[value]
    : undefined;
  if (typeof translated !== 'string' || translated === value) return 0;
  target[key] = translated;
  return 1;
}

function translateArrayField(
  list: unknown,
  keys: readonly string[],
  strings: Record<string, string>,
): number {
  if (!Array.isArray(list)) return 0;
  let updated = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    for (const key of keys) updated += translateField(record, key, strings);
  }
  return updated;
}

function hasMountedTradeStatic(doc: Document): boolean {
  const hosts = Array.from(doc.querySelectorAll('[data-v-app]'));
  return hosts.some((host) => {
    const state = getVueRootInstance(host as unknown as VueHostLike)?.proxy?.static_;
    return Boolean(state && typeof state === 'object');
  });
}

/**
 * 官網 bundle 的靜態初始選項（設定頁下拉、以物易物狀態、詞綴群組標題等）在 ES module
 * 頂層就會呼叫 `translate()`，並掛在 Trade 根元件 `proxy.static_` 上。
 * 若快取極快導致模組早於 `window.__` 求值，於此原地回填仍維持英文原鍵的欄位，
 * 讓後續掛載的設定頁與下拉元件直接讀到中文。
 */
export function localizeTradeStoreUi(doc: Document, strings: Record<string, string>): number {
  const hosts = Array.from(doc.querySelectorAll('[data-v-app]'));
  const visited = new Set<object>();
  let updated = 0;
  for (const host of hosts) {
    const state = getVueRootInstance(host as unknown as VueHostLike)?.proxy?.static_;
    if (!state || typeof state !== 'object' || visited.has(state)) continue;
    visited.add(state);
    try {
      const account = state.account;
      if (account && typeof account === 'object') {
        const accountRecord = account as Record<string, unknown>;
        updated += translateArrayField(accountRecord.status, ['text'], strings);
        updated += translateArrayField(accountRecord.languages, ['text'], strings);
        updated += translateField(accountRecord, 'statusRetrieving', strings);
      }
      updated += translateArrayField(state.exchangeStatus, ['text'], strings);
      updated += translateArrayField(state.searchBarLayouts, ['text'], strings);
      updated += translateArrayField(state.socketVariants, ['text'], strings);
      updated += translateArrayField(state.notifications, ['name'], strings);
      updated += translateArrayField(state.notificationVolumes, ['text'], strings);
      updated += translateArrayField(state.statGroups, ['title', 'tip'], strings);
    } catch {
      // 官網改版導致 static_ 結構不符時略過，不影響其餘翻譯
    }
  }
  return updated;
}

/** 對頁面上已掛載的 Vue 3 app 全部 `$forceUpdate()`；沒有掛載的 app 時回傳 false。 */
export function forceRerenderVueApps(doc: Document): boolean {
  const hosts = Array.from(doc.querySelectorAll('[data-v-app]'));
  let updated = false;
  for (const host of hosts) {
    const root = getVueRootInstance(host as unknown as VueHostLike);
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

const RESULTS_HEADING_PATTERN =
  /^(No results found|Showing 1 result|Showing (\d+) results)(?: \(([^()]+) matched\))?(?: \(max\))?$/;

function lookupUiString(strings: Record<string, string>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(strings, key)) return undefined;
  const value = strings[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 官網結果區由較新的 `#app` Vue 3 實例渲染（使用私有 `Symbol(locale)`，於英文站不讀 `window.__`）。
 * 依官方 `trade-ui.json` 字典原地轉換 `.row-total h3` 的筆數標題（零手寫字典，符合 ADR-0012）。
 */
export function translateResultsHeadingText(text: string, strings: Record<string, string>): string {
  const trimmed = text.trim();
  const match = RESULTS_HEADING_PATTERN.exec(trimmed);
  if (!match) return text;

  const [, base, count, matchedCount] = match;
  let result: string;
  if (count !== undefined) {
    const tpl = lookupUiString(strings, 'Showing {i} results');
    result = tpl ? tpl.replace(/\{i\}/g, count) : base;
  } else {
    result = lookupUiString(strings, base) ?? base;
  }

  if (matchedCount !== undefined) {
    const matchedTpl = lookupUiString(strings, '{i} matched');
    const matchedText = matchedTpl
      ? matchedTpl.replace(/\{i\}/g, matchedCount)
      : `${matchedCount} matched`;
    result += ` (${matchedText})`;
  }

  if (trimmed.endsWith(' (max)')) {
    const maxText = lookupUiString(strings, 'max') ?? 'max';
    result += ` (${maxText})`;
  }

  return result;
}

/**
 * 將官網 `#app` 結果區內未走 `window.__` 的介面文字（筆數標題、版型提示、載入更多、找不到物品）
 * 以官方 `trade-ui.json` 字典原地替換；字典缺鍵時保留原文。回傳更新節點數。
 */
export function localizeResultsAppDom(doc: Document, strings: Record<string, string>): number {
  let updated = 0;

  for (const h3 of Array.from(doc.querySelectorAll('.results .row-total h3'))) {
    const raw = h3.textContent ?? '';
    const next = translateResultsHeadingText(raw, strings);
    if (next !== raw) {
      h3.textContent = next;
      updated += 1;
    }
  }

  for (const button of Array.from(doc.querySelectorAll('.results .row-total button[title]'))) {
    const title = button.getAttribute('title');
    if (!title) continue;
    const translated = lookupUiString(strings, title);
    if (translated && translated !== title) {
      button.setAttribute('title', translated);
      updated += 1;
    }
  }

  for (const el of Array.from(
    doc.querySelectorAll('.results .load-more-btn span, .results .row.error h3'),
  )) {
    const raw = el.textContent ?? '';
    const translated = lookupUiString(strings, raw.trim());
    if (translated && translated !== raw) {
      el.textContent = translated;
      updated += 1;
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
  let staticUiChecked = false;
  let mountObserver: MutationObserver | null = null;
  let resultsObserver: MutationObserver | null = null;
  let activeUiStrings: Record<string, string> | null = null;
  let resultsSyncScheduled = false;
  const stopMountObserver = () => {
    mountObserver?.disconnect();
    mountObserver = null;
  };
  const stopResultsObserver = () => {
    resultsObserver?.disconnect();
    resultsObserver = null;
    activeUiStrings = null;
  };
  const scheduleResultsDomLocalization = () => {
    if (resultsSyncScheduled || !activeUiStrings) return;
    resultsSyncScheduled = true;
    queueMicrotask(() => {
      resultsSyncScheduled = false;
      if (!activeUiStrings) return;
      localizeResultsAppDom(win.document, activeUiStrings);
    });
  };
  const ensureResultsAppLocalized = (strings: Record<string, string>) => {
    activeUiStrings = strings;
    localizeResultsAppDom(win.document, strings);
    const Observer = (win as Window & typeof globalThis).MutationObserver;
    if (resultsObserver || typeof Observer !== 'function') return;
    const root = win.document.documentElement;
    if (!root) return;
    const observer = new Observer(() => {
      scheduleResultsDomLocalization();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    resultsObserver = observer;
  };
  const ensureTradeStaticUiLocalized = (strings: Record<string, string>) => {
    if (staticUiChecked) return;
    if (hasMountedTradeStatic(win.document)) {
      localizeTradeStoreUi(win.document, strings);
      staticUiChecked = true;
      stopMountObserver();
      return;
    }
    watchTradeMount(strings);
  };
  /**
   * 字典與 data API 常比 `#trade` 掛載更早到（實測 ui ~140ms、data ~740ms、掛載 ~820ms），
   * 上面的觸發點全在掛載前跑完而落空。Vue 3 掛載完成時才在容器設 `data-v-app`，
   * 監看這個屬性，掛好後立刻回填 static_。
   *
   * 不呼叫 forceRerenderVueApps：static_ 是 reactive，原地改欄位 Vue 就只會更新讀到它的元件；
   * 字典通常已在模組求值前寫入 window.__，此時只剩零星欄位要補，剛掛載完整樹重繪
   * 等於讓官方首屏再渲染一次（實測官方 Vue flush 由 ~110ms 增至 ~380ms）。
   */
  let pendingStrings: Record<string, string> | null = null;
  const watchTradeMount = (strings: Record<string, string>) => {
    pendingStrings = strings;
    const Observer = (win as Window & typeof globalThis).MutationObserver;
    if (mountObserver || typeof Observer !== 'function') return;
    const observer = new Observer(() => {
      if (staticUiChecked || !pendingStrings) return stopMountObserver();
      if (!hasMountedTradeStatic(win.document)) return;
      localizeTradeStoreUi(win.document, pendingStrings);
      staticUiChecked = true;
      stopMountObserver();
    });
    observer.observe(win.document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-v-app'],
    });
    mountObserver = observer;
  };
  const restoreFetch = wrapFetchWithGate(win, gate, (payload) => {
    // 官網 #trade 是非同步掛載，可能在 ui/payload 送達後才掛好；
    // 趁 data API 回應尚未交回 Vue（設定頁與 multiselect 尚未掛載）前補齊 proxy.static_
    ensureTradeStaticUiLocalized(payload.ui);
  });

  const receive = (data: unknown) => {
    if (!isMarketTranslationMessage(data)) return;
    const message = data;
    if (message.type === 'request' || gate.settled) return;
    if (message.type === 'ui') {
      applyUiDictionary(win, message.ui);
      ensureTradeStaticUiLocalized(message.ui);
      ensureResultsAppLocalized(message.ui);
      forceRerenderVueApps(win.document);
      return;
    }
    if (message.type === 'disabled') {
      gate.settle(null);
      return;
    }
    applyUiDictionary(win, message.payload.ui);
    gate.settle(message.payload);
    ensureTradeStaticUiLocalized(message.payload.ui);
    ensureResultsAppLocalized(message.payload.ui);
    forceRerenderVueApps(win.document);
  };

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== win) return;
    const [port] = event.ports ?? [];
    if (port && isMarketTranslationPortMessage(event.data)) {
      port.onmessage = (portEvent) => {
        port.close();
        receive(portEvent.data);
      };
      return;
    }
    receive(event.data);
  };

  win.addEventListener('message', handleMessage);
  win.postMessage(createRequestMessage(), win.location.origin);

  return () => {
    win.removeEventListener('message', handleMessage);
    stopMountObserver();
    stopResultsObserver();
    restoreFetch();
  };
}
