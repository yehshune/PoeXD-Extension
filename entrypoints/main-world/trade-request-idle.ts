import { expectsInitialSearchResults } from '@/utils/trade-search-identity';

/**
 * 官方搜尋請求的閒置閘門（MAIN world）。
 *
 * 把 known stats、即時市集資料送給 content script 要序列化約 1.6 MB 的物件，會佔住主執行緒
 * 數百毫秒。官方 data API 回來後緊接著就是自動搜尋與抓取結果，若在這段期間序列化，會直接
 * 延後結果列出現。這裡讓這類工作等到：
 *
 * - 有自動搜尋的頁面已收到第一批結果（或搜尋零筆、逾時）；
 * - 沒有進行中的官方 search / fetch 請求；
 * - 主執行緒閒置（最晚 idleTimeoutMs）。
 */

/** search 回應後若沒有接著 fetch（零筆結果），等多久就視為首批結果已處理完 */
const SEARCH_WITHOUT_FETCH_MS = 1500;
/** 首批結果的等待上限：官方改版或請求失敗時也不能讓資料永遠不送 */
const INITIAL_RESULTS_MAX_WAIT_MS = 5000;
const IDLE_TIMEOUT_MS = 1000;

interface TradeRequestIdleState {
  inflight: number;
  initialResultsPending: boolean;
  queued: Set<() => void>;
  idleScheduled: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

let state: TradeRequestIdleState = createState(false);

function createState(initialResultsPending: boolean): TradeRequestIdleState {
  return {
    inflight: 0,
    initialResultsPending,
    queued: new Set(),
    idleScheduled: false,
    timers: [],
  };
}

function whenIdle(callback: () => void) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(callback, 0);
  }
}

function settleInitialResults(current: TradeRequestIdleState) {
  if (!current.initialResultsPending) return;
  current.initialResultsPending = false;
  current.timers.splice(0).forEach((timer) => clearTimeout(timer));
  flush(current);
}

function flush(current: TradeRequestIdleState = state) {
  if (current !== state) return;
  if (current.idleScheduled || current.queued.size === 0) return;
  if (current.inflight > 0 || current.initialResultsPending) return;
  current.idleScheduled = true;
  whenIdle(() => {
    current.idleScheduled = false;
    if (current !== state) return;
    // 閒置前官方又發出請求（例如 search 回來後接著 fetch）：等請求結束時再排
    if (current.inflight > 0 || current.initialResultsPending) return;
    const tasks = [...current.queued];
    current.queued.clear();
    for (const task of tasks) {
      try {
        task();
      } catch (error) {
        console.error('[PoeXD Inject] 延後執行的工作失敗:', error);
      }
    }
  });
}

/**
 * 依目前網址初始化：有自動搜尋時先等第一批結果。
 * 由 interceptor 啟動時呼叫一次；重複呼叫會重設狀態並丟棄尚未執行的工作。
 */
export function initTradeRequestIdle(href: string = window.location.href): void {
  state.timers.forEach((timer) => clearTimeout(timer));
  const next = createState(expectsInitialSearchResults(href));
  state = next;
  if (next.initialResultsPending) {
    next.timers.push(setTimeout(() => settleInitialResults(next), INITIAL_RESULTS_MAX_WAIT_MS));
  }
}

export type TradeRequestKind = 'search' | 'fetch';

/** 官方 search / fetch 請求開始時呼叫；回傳的函式在請求結束（成功或失敗）時呼叫，重複呼叫無效 */
export function trackTradeRequest(kind: TradeRequestKind): (outcome?: 'ok' | 'failed') => void {
  const current = state;
  current.inflight += 1;
  let ended = false;
  return (outcome = 'ok') => {
    if (ended) return;
    ended = true;
    current.inflight = Math.max(0, current.inflight - 1);
    if (current.initialResultsPending) {
      if (kind === 'fetch' || outcome === 'failed') {
        settleInitialResults(current);
      } else {
        // 零筆結果時官方不會接著 fetch；有結果時 fetch 會在這段時間內開始並結束
        current.timers.push(
          setTimeout(() => settleInitialResults(current), SEARCH_WITHOUT_FETCH_MS),
        );
      }
    }
    flush(current);
  };
}

/** 等官方搜尋請求閒置後執行；同一個函式在執行前重複排入只會執行一次 */
export function runWhenTradeRequestsIdle(task: () => void): void {
  state.queued.add(task);
  flush();
}

/** 測試用：回到初始狀態（沒有等待中的首批結果） */
export function resetTradeRequestIdleForTests(): void {
  state.timers.forEach((timer) => clearTimeout(timer));
  state = createState(false);
}
