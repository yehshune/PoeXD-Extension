import {
  serializePoeFetchResponse,
  serializePoeSearchQueryObserved,
} from '@/utils/event-protocol-types';
import {
  readWhisperErrorCode,
  readWhisperSuccess,
  serializeFetchFailure,
  serializeSearchResultSummary,
  serializeWhisperOutcome,
  summarizeSearchResponse,
} from '@/utils/result-board/board-events';
import type { MainWorldBridge } from './bridge-bootstrap';
import {
  getVueStore,
  sendCurrentQuery,
  sendKnownStats,
  sendLiveTradeData,
} from './poe-runtime-reader';
import {
  cancelPendingSearchSubmission,
  completePendingSearchSubmission,
  markSearchSubmissionResponded,
  startPendingSearchSubmission,
} from './category-binding-manager';
import { runWhenTradeRequestsIdle, trackTradeRequest } from './trade-request-idle';

let consoleSearchGuardActive = false;

export function setConsoleSearchGuardActive(active: boolean): void {
  consoleSearchGuardActive = Boolean(active);
}

export function isConsoleSearchGuardActive(): boolean {
  return consoleSearchGuardActive;
}

export function isOfficialTradeSearchEndpoint(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.includes('/api/trade/search') || url.includes('/api/trade2/search');
}

function isOfficialTradeFetchEndpoint(url: string): boolean {
  return url.includes('/api/trade/fetch') || url.includes('/api/trade2/fetch');
}

/** 官方「前往藏身處」：`POST /api/trade/whisper` */
function isOfficialTradeWhisperEndpoint(url: string): boolean {
  return url.includes('/api/trade/whisper') || url.includes('/api/trade2/whisper');
}

function dispatchWhisperResult(bridge: MainWorldBridge, status: number, body: unknown) {
  const code = readWhisperErrorCode(body);
  const success = readWhisperSuccess(body);
  bridge.dispatchEvent(
    'poexd-whisper-outcome',
    serializeWhisperOutcome({
      status,
      ...(code !== undefined ? { code } : {}),
      ...(success !== undefined ? { success } : {}),
    }),
  );
}

async function dispatchWhisperOutcome(bridge: MainWorldBridge, response: Response) {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    body = undefined;
  }
  dispatchWhisperResult(bridge, response.status, body);
}

function dispatchSearchSummary(bridge: MainWorldBridge, data: unknown) {
  const summary = summarizeSearchResponse(data);
  if (summary) {
    bridge.dispatchEvent('poexd-search-result-summary', serializeSearchResultSummary(summary));
  }
}

/** XHR 的回應內容（JSON）；解析失敗時為 undefined */
function readXhrJson(xhr: XMLHttpRequest): unknown {
  try {
    return xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText);
  } catch {
    return undefined;
  }
}

export function installFetchInterceptor(bridge: MainWorldBridge, win: Window = window) {
  const originalFetch = win.fetch;
  if (!originalFetch) return;

  // 同一個函式重複排入只會執行一次：官網 4 支 data API 回應時只送一次
  const sendRuntimeData = () => {
    sendKnownStats(bridge);
    sendLiveTradeData(bridge);
    sendCurrentQuery(bridge);
  };

  win.fetch = async function (...args: Parameters<typeof originalFetch>) {
    const url =
      typeof args[0] === 'string'
        ? args[0]
        : args[0] && (args[0] as Request).url
          ? (args[0] as Request).url
          : '';

    const isSearch = isOfficialTradeSearchEndpoint(url);
    if (isSearch && consoleSearchGuardActive) {
      throw new Error('[PoeXD] 線上搜尋主控台已停用官方搜尋請求');
    }

    const isResultFetch = isOfficialTradeFetchEndpoint(url);
    const isWhisper = isOfficialTradeWhisperEndpoint(url);
    const endTradeRequest =
      isSearch || isResultFetch ? trackTradeRequest(isSearch ? 'search' : 'fetch') : null;

    let submissionReqId: number | null = null;
    if (isSearch) {
      let requestQuery: any = undefined;
      if (args[1] && (args[1] as RequestInit).body) {
        try {
          const bodyStr = String((args[1] as RequestInit).body);
          const parsed = JSON.parse(bodyStr);
          requestQuery = parsed.query || parsed;
        } catch {}
      }
      submissionReqId = startPendingSearchSubmission({
        query: requestQuery,
        hasResponded: false,
      });
    }

    let response: Response;
    try {
      const fetchPromise = originalFetch.apply(this, args);
      fetchPromise.then(
        () => {
          if (submissionReqId !== null) {
            markSearchSubmissionResponded(submissionReqId);
          }
        },
        () => {
          if (submissionReqId !== null) {
            cancelPendingSearchSubmission(submissionReqId);
          }
        },
      );
      response = await fetchPromise;
      if (isSearch && submissionReqId !== null) {
        if (!response.ok) {
          cancelPendingSearchSubmission(submissionReqId);
        } else {
          completePendingSearchSubmission(submissionReqId);
        }
      }
    } catch (err) {
      if (isSearch && submissionReqId !== null) {
        cancelPendingSearchSubmission(submissionReqId);
      }
      if (isWhisper) {
        dispatchWhisperResult(bridge, 0, undefined);
      }
      endTradeRequest?.('failed');
      throw err;
    }

    try {
      if (url) {
        if (isResultFetch && response.ok === false) {
          bridge.dispatchEvent(
            'poexd-fetch-failed',
            serializeFetchFailure({ url, status: response.status }),
          );
        } else if (isResultFetch) {
          try {
            const clone = response.clone();
            const data = await clone.json();
            bridge.dispatchEvent('poexd-fetch-response', serializePoeFetchResponse({ url, data }));
          } catch (e) {
            console.error('[PoeXD Inject] 攔截 fetch 解析錯誤:', e);
          }
        } else if (isWhisper) {
          await dispatchWhisperOutcome(bridge, response);
        } else if (isSearch) {
          try {
            const clone = response.clone();
            const data = await clone.json();
            const searchId = data.id;
            dispatchSearchSummary(bridge, data);
            const store = getVueStore();
            const query = store && store.state ? store.state.query || store.state.persistent : null;
            const queryJson = query
              ? JSON.stringify({ query })
              : args[1] && (args[1] as RequestInit).body
                ? String((args[1] as RequestInit).body)
                : '';
            if (searchId && queryJson) {
              bridge.dispatchEvent(
                'poexd-search-query-observed',
                serializePoeSearchQueryObserved({ searchId, queryJson, source: 'search-response' }),
              );
            }
          } catch (e) {
            console.error('[PoeXD Inject] 攔截 search response 錯誤:', e);
          }
          bridge.dispatchEvent('poexd-search-triggered');
        }

        // 官網初始化資料載入完畢後送出屬性列表；序列化很貴，等官方搜尋與首批結果處理完、主執行緒閒置時再送
        if (url.includes('/api/trade/data') || url.includes('/api/trade2/data')) {
          setTimeout(() => runWhenTradeRequestsIdle(sendRuntimeData), 500);
        }
      }
    } finally {
      endTradeRequest?.(response.ok === false ? 'failed' : 'ok');
    }
    return response;
  };
}

export function installXhrInterceptor(bridge: MainWorldBridge, win: Window = window) {
  const Xhr =
    (win as any).XMLHttpRequest ||
    (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : undefined);
  if (!Xhr || !Xhr.prototype) return;

  const originalOpen = Xhr.prototype.open;
  const originalSend = Xhr.prototype.send;
  const requestUrls = new WeakMap<XMLHttpRequest, string>();

  Xhr.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...args: [async?: boolean, username?: string | null, password?: string | null]
  ) {
    requestUrls.set(this, typeof url === 'string' ? url : url.toString());
    return originalOpen.call(
      this,
      method,
      url,
      ...(args as [boolean, string | null, string | null]),
    );
  };

  Xhr.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const url = requestUrls.get(this) || '';
    const isSearch = isOfficialTradeSearchEndpoint(url);
    if (isSearch && consoleSearchGuardActive) {
      queueMicrotask(() => {
        try {
          this.dispatchEvent(new Event('error'));
        } catch {}
      });
      return;
    }

    let submissionReqId: number | null = null;

    if (isOfficialTradeWhisperEndpoint(url)) {
      this.addEventListener(
        'load',
        function (this: XMLHttpRequest) {
          dispatchWhisperResult(bridge, this.status, readXhrJson(this));
        },
        { once: true },
      );
      const dispatchFailedWhisper = () => dispatchWhisperResult(bridge, 0, undefined);
      this.addEventListener('error', dispatchFailedWhisper, { once: true });
      this.addEventListener('abort', dispatchFailedWhisper, { once: true });
    }

    if (isSearch) {
      let requestQuery: any = undefined;
      if (typeof body === 'string') {
        try {
          const parsed = JSON.parse(body);
          requestQuery = parsed.query || parsed;
        } catch {}
      }
      submissionReqId = startPendingSearchSubmission({
        query: requestQuery,
        isResponded: () =>
          this.readyState === 4 || (typeof this.status === 'number' && this.status > 0),
      });
      const currentReqId = submissionReqId;
      const queryJson = typeof body === 'string' ? body : '';

      // loadend 在 load / error / abort 之後觸發，官方的 load handler 已經發出後續 fetch
      const endTradeRequest = trackTradeRequest('search');
      this.addEventListener(
        'loadend',
        function (this: XMLHttpRequest) {
          const isSuccess =
            typeof this.status === 'number' ? this.status >= 200 && this.status < 300 : false;
          endTradeRequest(isSuccess ? 'ok' : 'failed');
        },
        { once: true },
      );

      this.addEventListener(
        'load',
        function (this: XMLHttpRequest) {
          const isSuccess =
            typeof this.status === 'number' ? this.status >= 200 && this.status < 300 : true;
          if (isSuccess) {
            completePendingSearchSubmission(currentReqId);
          } else {
            cancelPendingSearchSubmission(currentReqId);
          }

          try {
            const data = readXhrJson(this) as { id?: unknown } | undefined;
            if (isSuccess) dispatchSearchSummary(bridge, data);
            const searchId = typeof data?.id === 'string' ? data.id : undefined;
            if (searchId && queryJson) {
              bridge.dispatchEvent(
                'poexd-search-query-observed',
                serializePoeSearchQueryObserved({ searchId, queryJson, source: 'search-response' }),
              );
            }
          } catch (e) {
            console.error('[PoeXD Inject] 攔截 XHR search response 錯誤:', e);
          }
          bridge.dispatchEvent('poexd-search-triggered');
        },
        { once: true },
      );

      this.addEventListener(
        'error',
        () => {
          cancelPendingSearchSubmission(currentReqId);
        },
        { once: true },
      );

      this.addEventListener(
        'abort',
        () => {
          cancelPendingSearchSubmission(currentReqId);
        },
        { once: true },
      );
    }
    return originalSend.call(this, body);
  };
}

export function initNetworkObserver(bridge: MainWorldBridge, win: Window = window) {
  bridge.addListener('poexd-livesearch-console-guard', (payload) => {
    setConsoleSearchGuardActive(Boolean(payload?.active));
  });
  installFetchInterceptor(bridge, win);
  installXhrInterceptor(bridge, win);
}
