import type {
  PoeContentToMainEventMap,
  PoeMainToContentEventMap,
} from '@/utils/event-protocol-types';
import './host-types';

export interface MainWorldBridge {
  dispatchEvent: <K extends keyof PoeMainToContentEventMap>(
    type: K,
    ...args: PoeMainToContentEventMap[K] extends void ? [] : [payload: PoeMainToContentEventMap[K]]
  ) => void;
  addListener: <K extends keyof PoeContentToMainEventMap>(
    type: K,
    callback: (payload: PoeContentToMainEventMap[K]) => void,
  ) => () => void;
}

function hasUrlChanged(
  prevHref: string | undefined,
  nextHref: string | undefined,
  targetUrl: unknown,
): boolean {
  if (prevHref && nextHref) {
    return prevHref !== nextHref;
  }
  if (targetUrl === undefined || targetUrl === null || targetUrl === '') {
    return false;
  }
  if (typeof targetUrl === 'string') {
    if (prevHref && (targetUrl === prevHref || prevHref.endsWith(targetUrl))) {
      return false;
    }
    return true;
  }
  return false;
}

function installHistoryInterceptor(options?: {
  windowObj?: Window;
  onHistoryChanged?: () => void;
  onRouteSync?: (navType?: 'pushState' | 'replaceState') => void;
}) {
  const win = options?.windowObj || window;
  const history = win.history;
  if (!history || history.__poexdHistoryPatched) return;
  history.__poexdHistoryPatched = true;

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  let isRouteSyncing = false;
  const dispatchRouteSync = (navType: 'pushState' | 'replaceState') => {
    if (isRouteSyncing) return;
    isRouteSyncing = true;
    try {
      options?.onRouteSync?.(navType);
    } finally {
      isRouteSyncing = false;
    }
  };

  history.pushState = function (...args) {
    const prevHref = win.location?.href;
    const result = originalPush.apply(this, args);
    const nextHref = win.location?.href;
    const urlChanged = hasUrlChanged(prevHref, nextHref, args[2]);

    if (urlChanged) {
      options?.onHistoryChanged?.();
      dispatchRouteSync('pushState');
    }
    return result;
  };

  history.replaceState = function (state, ...rest) {
    const prevHref = win.location?.href;
    const currentState = win.history.state;
    const poexdSessionId =
      typeof state === 'object' && state !== null && (state as any).__poexdSessionId
        ? (state as any).__poexdSessionId
        : currentState?.__poexdSessionId;
    const nextState =
      typeof state === 'object' && state !== null
        ? poexdSessionId
          ? { ...state, __poexdSessionId: poexdSessionId }
          : state
        : poexdSessionId
          ? { __poexdSessionId: poexdSessionId }
          : state;

    const result = originalReplace.call(this, nextState, ...rest);
    const nextHref = win.location?.href;
    const urlChanged = hasUrlChanged(prevHref, nextHref, rest[1]);

    if (urlChanged) {
      options?.onHistoryChanged?.();
      dispatchRouteSync('replaceState');
    }
    return result;
  };

  win.addEventListener('popstate', () => {
    dispatchRouteSync('pushState');
  });
}

export function bootstrapBridge(options?: {
  windowObj?: Window;
  documentObj?: Document;
  onRouteSync?: (navType?: 'pushState' | 'replaceState') => void;
}): MainWorldBridge | null {
  const doc = options?.documentObj || document;
  const win = options?.windowObj || window;

  const currentScript = doc.currentScript;
  const nextNonce = currentScript ? currentScript.getAttribute('data-nonce') : null;
  if (currentScript) {
    currentScript.removeAttribute('data-nonce');
  }

  // 阻斷無安全憑證的呼叫
  if (!nextNonce) {
    console.error('[PoeXD] Missing secure nonce. Initialization aborted.');
    return null;
  }

  let activeNonce = nextNonce;

  function dispatchEvent<K extends keyof PoeMainToContentEventMap>(
    type: K,
    ...args: PoeMainToContentEventMap[K] extends void ? [] : [payload: PoeMainToContentEventMap[K]]
  ) {
    win.dispatchEvent(
      new CustomEvent(type, {
        detail: {
          source: 'poexd',
          nonce: activeNonce,
          payload: args[0],
        },
      }),
    );
  }

  function addListener<K extends keyof PoeContentToMainEventMap>(
    type: K,
    callback: (payload: PoeContentToMainEventMap[K]) => void,
  ) {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        source?: string;
        nonce?: string;
        payload?: PoeContentToMainEventMap[K];
      }>;
      const data = customEvent.detail;
      if (!data || data.source !== 'poexd' || data.nonce !== activeNonce) {
        return;
      }
      callback(data.payload as PoeContentToMainEventMap[K]);
    };
    win.addEventListener(type, handler);
    return () => win.removeEventListener(type, handler);
  }

  // 若已安裝，執行 Nonce 旋轉並廣播現況事件，隨後退出
  if (win.__poexdInterceptorInstalled) {
    if (typeof win.__poexdUpdateNonce === 'function') {
      win.__poexdUpdateNonce(nextNonce);
    }
    dispatchEvent('poexd-history-changed');
    return null;
  }

  win.__poexdInterceptorInstalled = true;
  win.__poexdUpdateNonce = function (newNonce: string) {
    activeNonce = newNonce;
    console.log('[PoeXD Inject] Nonce updated successfully.');
  };

  installHistoryInterceptor({
    windowObj: win,
    onHistoryChanged: () => dispatchEvent('poexd-history-changed'),
    onRouteSync: options?.onRouteSync,
  });

  dispatchEvent('poexd-history-changed');

  return {
    dispatchEvent,
    addListener,
  };
}
