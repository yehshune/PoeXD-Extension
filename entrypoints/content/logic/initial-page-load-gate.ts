import { listenPoeEvent } from '@/utils/event-contracts';

/**
 * 官方頁面元件已掛載的特徵。`#trade` 底下的 loader、navigation 等是靜態 HTML，
 * 搜尋列與結果區要等官方程式啟動後才會出現。
 */
const APP_READY_SELECTOR = '#trade .search-bar, #trade .search-panel, #trade .results';

/** 總上限：任何訊號都沒來（官方改版、搜尋失敗）時也不能讓擴充永遠不初始化 */
const DEFAULT_MAX_WAIT_MS = 5000;
/** search 回應後沒有 fetch（零筆結果）時，最多再等多久就視為首批結果已處理完 */
const DEFAULT_SEARCH_WITHOUT_FETCH_MS = 1500;
/** 首批結果送達後，等主執行緒閒置再開始；這段時間官方正在渲染結果列 */
const DEFAULT_IDLE_TIMEOUT_MS = 1000;

export interface InitialPageLoadGateDeps {
  /** 官方頁面元件是否已掛載 */
  isAppReady: () => boolean;
  /** 在 DOM 變動時呼叫 callback，回傳取消函式 */
  observeDom: (callback: () => void) => () => void;
  listenFetchResponse: (callback: () => void) => () => void;
  listenSearchTriggered: (callback: () => void) => () => void;
  setTimer: (callback: () => void, ms: number) => () => void;
  /** 主執行緒閒置時呼叫 callback（最晚 timeoutMs），回傳取消函式 */
  whenIdle: (callback: () => void, timeoutMs: number) => () => void;
}

export interface InitialPageLoadGateOptions {
  /** 這一頁載入時官方會不會自動搜尋並抓取結果 */
  expectsInitialResults: boolean;
  maxWaitMs?: number;
  searchWithoutFetchMs?: number;
  idleTimeoutMs?: number;
}

export interface InitialPageLoadGate {
  /** 官方頁面完成首次載入（或逾時）後 resolve；cancel 後永不 resolve */
  readonly ready: Promise<void>;
  cancel(): void;
}

/**
 * 等官方頁面完成首次載入，再讓擴充做重的初始化（掛載側邊欄、注入篩選控制項）。
 *
 * 這些工作會佔住主執行緒一秒以上；若在 DOMContentLoaded 就做，官方程式拿不到執行時間，
 * 搜尋與結果列會晚兩秒以上才出現。條件：官方元件已掛載，且有自動搜尋時第一批結果已送達
 * （或搜尋零筆）；任何情況下最多等 maxWaitMs。
 *
 * 必須在 interceptor 注入時就建立，才不會漏掉在等待角色等非同步步驟期間送達的事件。
 */
export function createInitialPageLoadGate(
  options: InitialPageLoadGateOptions,
  deps: InitialPageLoadGateDeps = createBrowserDeps(),
): InitialPageLoadGate {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const searchWithoutFetchMs = options.searchWithoutFetchMs ?? DEFAULT_SEARCH_WITHOUT_FETCH_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  let settled = false;
  let appReady = deps.isAppReady();
  let resultsArrived = !options.expectsInitialResults;
  const cleanups: (() => void)[] = [];
  let cancelSearchTimer: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;

  const stopWatching = () => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    cancelSearchTimer?.();
    cancelSearchTimer = null;
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    stopWatching();
    cancelIdle = deps.whenIdle(() => {
      cancelIdle = null;
      resolveReady();
    }, idleTimeoutMs);
  };

  const check = () => {
    if (!settled && appReady && resultsArrived) finish();
  };

  if (!appReady) {
    cleanups.push(
      deps.observeDom(() => {
        if (appReady || !deps.isAppReady()) return;
        appReady = true;
        check();
      }),
    );
  }
  if (!resultsArrived) {
    cleanups.push(
      deps.listenFetchResponse(() => {
        resultsArrived = true;
        check();
      }),
      deps.listenSearchTriggered(() => {
        if (cancelSearchTimer) return;
        cancelSearchTimer = deps.setTimer(() => {
          cancelSearchTimer = null;
          resultsArrived = true;
          check();
        }, searchWithoutFetchMs);
      }),
    );
  }
  cleanups.push(deps.setTimer(finish, maxWaitMs));
  check();

  return {
    ready,
    cancel() {
      settled = true;
      stopWatching();
      cancelIdle?.();
      cancelIdle = null;
    },
  };
}

function createBrowserDeps(): InitialPageLoadGateDeps {
  return {
    isAppReady: () => document.querySelector(APP_READY_SELECTOR) !== null,
    observeDom: (callback) => {
      const observer = new MutationObserver(callback);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    listenFetchResponse: (callback) => listenPoeEvent('poexd-fetch-response', callback),
    listenSearchTriggered: (callback) => listenPoeEvent('poexd-search-triggered', callback),
    setTimer: (callback, ms) => {
      const id = setTimeout(callback, ms);
      return () => clearTimeout(id);
    },
    whenIdle: (callback, timeoutMs) => {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(callback, { timeout: timeoutMs });
        return () => cancelIdleCallback(id);
      }
      const id = setTimeout(callback, 0);
      return () => clearTimeout(id);
    },
  };
}
