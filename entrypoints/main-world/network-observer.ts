import {
  serializePoeFetchResponse,
  serializePoeSearchQueryObserved,
} from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import { getVueStore, sendCurrentQuery, sendKnownStats } from './poe-runtime-reader';
import {
  cancelPendingSearchSubmission,
  completePendingSearchSubmission,
  markSearchSubmissionResponded,
  startPendingSearchSubmission,
} from './category-binding-manager';

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

export function installFetchInterceptor(bridge: MainWorldBridge, win: Window = window) {
  const originalFetch = win.fetch;
  if (!originalFetch) return;

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
      throw err;
    }

    if (url) {
      if (url.includes('/api/trade/fetch') || url.includes('/api/trade2/fetch')) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          bridge.dispatchEvent('poexd-fetch-response', serializePoeFetchResponse({ url, data }));
        } catch (e) {
          console.error('[PoeXD Inject] 攔截 fetch 解析錯誤:', e);
        }
      } else if (isSearch) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          const searchId = data.id;
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

      // 當初始化數據加載完畢後，發送官網屬性列表給擴充套件
      if (url.includes('/api/trade/data') || url.includes('/api/trade2/data')) {
        setTimeout(() => {
          sendKnownStats(bridge);
          sendCurrentQuery(bridge);
        }, 500);
      }
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
            const data =
              this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            const searchId = data?.id;
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
