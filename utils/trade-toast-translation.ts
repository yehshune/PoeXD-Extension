/**
 * 官方交易網站 toast 與 Trade API 錯誤訊息的中文化。
 *
 * 兩層查找：
 * 1. 先查官方 `trade-ui.json`（台服／國服前端字典），可直接復用官方譯文（如 `Item no longer available`）。
 * 2. 查不到時再對照常見 Trade API 後端錯誤字典與帶參數樣板（例如限速剩餘秒數、帳號未在遊戲中）。
 *
 * 供兩處共用：
 * - 市集漢化監聽官方 `#trade .toast-container` 的 toast 節點（只改顯示文字，不動 API 回應 JSON）。
 * - 釘選物品前往藏身處（`usePinnedItems.ts`）回報官方 API 錯誤時同步中文化。
 */
import type { MarketTranslationLocale } from './market-translation';

export interface TradeToastTranslateOptions {
  /** 官方 `trade-ui.json` 字串表；未傳入時回退使用模組目前登錄的字典 */
  ui?: Readonly<Record<string, string>>;
  /** 中英並列顯示（官方 toast 依市集漢化設定，擴充內部 toast 預設關閉） */
  bilingual?: boolean;
}

interface LocalizedEntry {
  'zh-TW': string;
  'zh-CN': string;
}

const EXACT_API_ERRORS: Readonly<Record<string, LocalizedEntry>> = Object.freeze({
  'your account must be in-game to use this feature.': {
    'zh-TW': '您的帳號必須在遊戲中才能使用此功能。',
    'zh-CN': '您的账号必须在游戏中才能使用此功能。',
  },
  'your account must be in-game to use this feature': {
    'zh-TW': '您的帳號必須在遊戲中才能使用此功能。',
    'zh-CN': '您的账号必须在游戏中才能使用此功能。',
  },
  'item no longer available': {
    'zh-TW': '物品不存在',
    'zh-CN': '物品已不存在',
  },
  'item no longer available.': {
    'zh-TW': '物品不存在。',
    'zh-CN': '物品已不存在。',
  },
  'item is in demand': {
    'zh-TW': '商品需求十分競爭',
    'zh-CN': '商品需求十分竞争',
  },
  'in demand. teleport anyway?': {
    'zh-TW': '商品競爭中，仍要傳送嗎？',
    'zh-CN': '商品竞争中，仍要传送吗？',
  },
  'teleporting!': {
    'zh-TW': '正在傳送！',
    'zh-CN': '正在传送！',
  },
  'whisper sent!': {
    'zh-TW': '發送密語！',
    'zh-CN': '已发送密语！',
  },
  'resource not found': {
    'zh-TW': '找不到資源',
    'zh-CN': '找不到资源',
  },
  'resource not found.': {
    'zh-TW': '找不到資源。',
    'zh-CN': '找不到资源。',
  },
  'query has expired': {
    'zh-TW': '搜尋已過期',
    'zh-CN': '搜索已过期',
  },
  'query has expired.': {
    'zh-TW': '搜尋已過期。',
    'zh-CN': '搜索已过期。',
  },
  'invalid query': {
    'zh-TW': '無效請求',
    'zh-CN': '无效请求',
  },
  'invalid query.': {
    'zh-TW': '無效請求。',
    'zh-CN': '无效请求。',
  },
  'query is too complex': {
    'zh-TW': '搜尋條件過於複雜',
    'zh-CN': '搜索条件过于复杂',
  },
  'query is too complex.': {
    'zh-TW': '搜尋條件過於複雜。',
    'zh-CN': '搜索条件过于复杂。',
  },
  unauthorized: {
    'zh-TW': '未授權，請先登入帳號',
    'zh-CN': '未授权，请先登录账号',
  },
  forbidden: {
    'zh-TW': '存取遭拒',
    'zh-CN': '访问被拒绝',
  },
  'you must be logged in to use this feature.': {
    'zh-TW': '您必須登入帳號才能使用此功能。',
    'zh-CN': '您必须登录账号才能使用此功能。',
  },
  'you must be logged in to use this feature': {
    'zh-TW': '您必須登入帳號才能使用此功能。',
    'zh-CN': '您必须登录账号才能使用此功能。',
  },
  'the player is currently offline.': {
    'zh-TW': '該玩家目前不在線上。',
    'zh-CN': '该玩家当前不在线。',
  },
  'the player is currently afk.': {
    'zh-TW': '該玩家目前暫離（AFK）。',
    'zh-CN': '该玩家当前暂离（AFK）。',
  },
  'the player is currently in do not disturb mode.': {
    'zh-TW': '該玩家目前處於勿擾（DND）模式。',
    'zh-CN': '该玩家当前处于勿扰（DND）模式。',
  },
  'you have sent too many whispers. please wait before trying again.': {
    'zh-TW': '您發送了過多密語，請稍候再試。',
    'zh-CN': '您发送了过多密语，请稍候再试。',
  },
  'an error occurred. please try again later.': {
    'zh-TW': '發生錯誤，請稍候再嘗試。',
    'zh-CN': '发生错误，请稍后再试。',
  },
  'request cancelled': {
    'zh-TW': '請求已取消',
    'zh-CN': '请求已取消',
  },
  'unexpected response': {
    'zh-TW': '伺服器回傳了非預期的回應',
    'zh-CN': '服务器返回了非预期的响应',
  },
  'internal server error': {
    'zh-TW': '伺服器內部錯誤',
    'zh-CN': '服务器内部错误',
  },
  'service unavailable': {
    'zh-TW': '服務暫時無法使用',
    'zh-CN': '服务暂时不可用',
  },
});

const RATE_LIMIT_SECONDS_RE =
  /^rate limit exceeded(?:[;:,]\s*|\s+)please try again in (\d+)\s+seconds?\.?$/i;
const RATE_LIMIT_BARE_RE = /^rate limit exceeded\.?$/i;
const IN_GAME_RE = /^(?:your\s+)?account must be in-game(?: to .+)?\.?$/i;
const COMPOUND_PREFIX_RE = /^(resource not found|invalid query)[;:]\s*(.+)$/i;
const ERROR_PREFIX_RE = /^error:\s*(.+)$/i;

let sharedUiDictionary: Readonly<Record<string, string>> | undefined;

export function setTradeToastUiDictionary(ui: Readonly<Record<string, string>> | undefined): void {
  sharedUiDictionary = ui;
}

export function getTradeToastUiDictionary(): Readonly<Record<string, string>> | undefined {
  return sharedUiDictionary;
}

function lookupTranslation(
  trimmed: string,
  locale: MarketTranslationLocale,
  ui: Readonly<Record<string, string>> | undefined,
): string | undefined {
  // 1. 先查官方 trade-ui.json（精確比對）
  const official = ui?.[trimmed];
  if (typeof official === 'string' && official.length > 0 && official !== trimmed) {
    return official;
  }

  // 2. 常見 Trade API 錯誤完全比對（不分大小寫）
  const exact = EXACT_API_ERRORS[trimmed.toLowerCase()];
  if (exact) return exact[locale];

  // 3. 帶參數或複合格式樣板
  const rateLimitSeconds = RATE_LIMIT_SECONDS_RE.exec(trimmed);
  if (rateLimitSeconds) {
    const seconds = rateLimitSeconds[1];
    return locale === 'zh-CN'
      ? `请求过于频繁，请在 ${seconds} 秒后再试。`
      : `請求過於頻繁，請在 ${seconds} 秒後再試。`;
  }

  if (RATE_LIMIT_BARE_RE.test(trimmed)) {
    return locale === 'zh-CN' ? '请求过于频繁，请稍后再试。' : '請求過於頻繁，請稍候再試。';
  }

  if (IN_GAME_RE.test(trimmed)) {
    return locale === 'zh-CN'
      ? '您的账号必须在游戏中才能使用此功能。'
      : '您的帳號必須在遊戲中才能使用此功能。';
  }

  const compound = COMPOUND_PREFIX_RE.exec(trimmed);
  if (compound) {
    const head = EXACT_API_ERRORS[compound[1].toLowerCase()]?.[locale];
    if (head) {
      const tailRaw = compound[2].trim();
      const tail = lookupTranslation(tailRaw, locale, ui) ?? tailRaw;
      return `${head}；${tail}`;
    }
  }

  const errorPrefixed = ERROR_PREFIX_RE.exec(trimmed);
  if (errorPrefixed) {
    const innerRaw = errorPrefixed[1].trim();
    const inner = lookupTranslation(innerRaw, locale, ui);
    if (inner) {
      return locale === 'zh-CN' ? `错误：${inner}` : `錯誤：${inner}`;
    }
  }

  return undefined;
}

/** 翻譯單段官方 toast 或 Trade API 錯誤訊息；找不到對應譯文時原樣回傳 */
export function translateTradeApiMessage(
  raw: string,
  locale: MarketTranslationLocale,
  options: TradeToastTranslateOptions = {},
): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  const ui = options.ui ?? sharedUiDictionary;
  const translated = lookupTranslation(trimmed, locale, ui);
  if (!translated || translated === trimmed) return raw;

  const formatted = options.bilingual ? `${translated} (${trimmed})` : translated;
  const leading = raw.slice(0, raw.indexOf(trimmed));
  const trailing = raw.slice(raw.indexOf(trimmed) + trimmed.length);
  return `${leading}${formatted}${trailing}`;
}

const OFFICIAL_TOAST_CONTAINER_SELECTOR = '.toast-container, .poe-toast-container';

function translateTextNode(
  node: Text,
  locale: MarketTranslationLocale,
  options: TradeToastTranslateOptions,
): void {
  const current = node.nodeValue;
  if (!current || !current.trim()) return;
  const next = translateTradeApiMessage(current, locale, options);
  if (next !== current) {
    node.nodeValue = next;
  }
}

function translateToastSubtree(
  root: Node,
  locale: MarketTranslationLocale,
  options: TradeToastTranslateOptions,
): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, locale, options);
    return;
  }
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (!walker) return;
  let current = walker.nextNode();
  while (current) {
    translateTextNode(current as Text, locale, options);
    current = walker.nextNode();
  }
}

/**
 * 監聽官方市集頁的 `.toast-container` 與 `.poe-toast-container`，將出現的 toast 文字中文化。
 *
 * 效能與生命週期控管：
 * - 若啟動時 `body` 或 `#trade` 尚未掛載，短暫等待它們出現後立即中斷全頁啟動監聽。
 * - 之後只對 `document.body`、`#trade`、`#vue3-portal` 開啟 `subtree: false`（僅看直接子節點），
 *   結果列與搜尋表單的大量 DOM 變動完全不會觸發回呼。
 * - 各 toast 容器的 observer 存於 `Map`，容器被官網移出 DOM 時立即 `disconnect()` 並回收。
 */
export function observeOfficialTradeToasts(
  doc: Document,
  config: {
    locale: MarketTranslationLocale;
    ui?: Readonly<Record<string, string>>;
    bilingual?: boolean;
  },
): () => void {
  let disposed = false;
  const containerObservers = new Map<Element, MutationObserver>();
  const shallowHostObservers = new Map<Element, MutationObserver>();
  let bootstrapObserver: MutationObserver | undefined;

  const options: TradeToastTranslateOptions = {
    ui: config.ui,
    bilingual: config.bilingual,
  };

  const detachFromContainer = (container: Element) => {
    const observer = containerObservers.get(container);
    if (!observer) return;
    observer.disconnect();
    containerObservers.delete(container);
  };

  const attachToContainer = (container: Element) => {
    if (disposed || containerObservers.has(container)) return;
    translateToastSubtree(container, config.locale, options);
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
          translateTextNode(mutation.target as Text, config.locale, options);
          continue;
        }
        for (const added of mutation.addedNodes) {
          translateToastSubtree(added, config.locale, options);
        }
      }
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    containerObservers.set(container, observer);
  };

  const scanAddedElement = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.id === 'vue3-portal') {
      observeShallowHost(el);
    }
    if (el.matches(OFFICIAL_TOAST_CONTAINER_SELECTOR)) {
      attachToContainer(el);
    }
    el.querySelectorAll(OFFICIAL_TOAST_CONTAINER_SELECTOR).forEach(attachToContainer);
  };

  const scanRemovedElement = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (containerObservers.has(el)) {
      detachFromContainer(el);
    }
    for (const tracked of Array.from(containerObservers.keys())) {
      if (el.contains(tracked)) {
        detachFromContainer(tracked);
      }
    }
    const hostObs = shallowHostObservers.get(el);
    if (hostObs) {
      hostObs.disconnect();
      shallowHostObservers.delete(el);
    }
  };

  const observeShallowHost = (host: Element | null) => {
    if (disposed || !host || shallowHostObservers.has(host)) return;
    host.querySelectorAll(OFFICIAL_TOAST_CONTAINER_SELECTOR).forEach(attachToContainer);
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const removed of mutation.removedNodes) {
          scanRemovedElement(removed);
        }
        for (const added of mutation.addedNodes) {
          scanAddedElement(added);
        }
      }
    });
    observer.observe(host, { childList: true, subtree: false });
    shallowHostObservers.set(host, observer);
  };

  const bindKnownHosts = (): boolean => {
    const body = doc.body;
    const trade = doc.getElementById('trade');
    const portal = doc.getElementById('vue3-portal');
    if (body) observeShallowHost(body);
    if (trade) {
      observeShallowHost(trade);
      // 舊版 .toast-container 位在 #trade 的第一個匿名包裝 div 下
      const tradeWrapper = trade.firstElementChild;
      if (tradeWrapper && !tradeWrapper.id && !tradeWrapper.className) {
        observeShallowHost(tradeWrapper);
      }
    }
    if (portal) observeShallowHost(portal);
    return Boolean(body && trade);
  };

  const ready = bindKnownHosts();
  if (!ready && typeof MutationObserver !== 'undefined' && doc.documentElement) {
    bootstrapObserver = new MutationObserver(() => {
      if (bindKnownHosts()) {
        bootstrapObserver?.disconnect();
        bootstrapObserver = undefined;
      }
    });
    bootstrapObserver.observe(doc.documentElement, { childList: true, subtree: true });
  }

  return () => {
    disposed = true;
    bootstrapObserver?.disconnect();
    bootstrapObserver = undefined;
    for (const observer of shallowHostObservers.values()) {
      observer.disconnect();
    }
    shallowHostObservers.clear();
    for (const observer of containerObservers.values()) {
      observer.disconnect();
    }
    containerObservers.clear();
  };
}
