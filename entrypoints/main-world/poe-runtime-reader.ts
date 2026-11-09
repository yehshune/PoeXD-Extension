import {
  serializePoeKnownStats,
  serializePoeSearchQueryObserved,
} from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import type { HostVueInstance, HostVuexStore } from './host-types';

export function getVueStore(): HostVuexStore | null {
  if (typeof document === 'undefined') return null;
  const elements = ['#trade', '.layout', '#app', 'body', '.search-advanced-items'];
  for (const sel of elements) {
    const el = document.querySelector(sel) as
      | (Element & { __vue__?: HostVueInstance; __vue_app__?: HostVueInstance })
      | null;
    if (el) {
      if (el.__vue__ && el.__vue__.$store) return el.__vue__.$store;
      if (el.__vue_app__ && el.__vue_app__.config?.globalProperties?.$store) {
        return el.__vue_app__.config.globalProperties.$store;
      }

      if (el.__vue__) {
        const queue: HostVueInstance[] = [el.__vue__];
        const visited = new Set<HostVueInstance>();
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item || visited.has(item)) continue;
          visited.add(item);
          if (item.$store) return item.$store;
          if (item.$children) {
            queue.push(...item.$children);
          }
        }
      }
    }
  }
  return null;
}

/** 官方 Trade 根元件（提供 `save`、`setPropertyFilterGroupDisabled` 等方法）。 */
export interface HostTradeRoot {
  save?: (dirty?: boolean) => void;
  setPropertyFilterGroupDisabled?: (payload: { group: string; disable: boolean }) => void;
}

/**
 * 取得官方 Trade 根元件 proxy。Vue 3 掛在 `__vue_app__._container._vnode.component.proxy`，
 * Vue 2 則為 `#trade.__vue__`。找不到時回傳 null。
 */
export function getTradeRootComponent(): HostTradeRoot | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('#trade') as
    | (Element & { __vue__?: unknown; __vue_app__?: any; _vnode?: any })
    | null;
  if (!el) return null;
  const app = el.__vue_app__;
  const component = app?._container?._vnode?.component ?? el._vnode?.component ?? app?._instance;
  const root = component?.proxy ?? el.__vue__;
  return root && typeof root === 'object' ? (root as HostTradeRoot) : null;
}

/** 讀取官方已知 stat id 清單；無法取得時回傳 null。 */
export function readKnownStatIds(): string[] | null {
  const known = findKnownStatsFlat();
  return known ? Object.keys(known) : null;
}

export function sendKnownStats(bridge: MainWorldBridge) {
  const knownStatsFlat = findKnownStatsFlat();
  if (knownStatsFlat) {
    bridge.dispatchEvent('poexd-known-stats', serializePoeKnownStats(knownStatsFlat));
  }
}

function findKnownStatsFlat() {
  if (typeof document === 'undefined') return undefined;
  const tradeEl = document.querySelector('#trade') as
    | (Element & { __vue__?: HostVueInstance; __vue_app__?: HostVueInstance })
    | null;
  const app = tradeEl?.__vue__ || (tradeEl?.parentElement as any)?.__vue__ || tradeEl?.__vue_app__;
  let staticData = app?._data?.static_ || app?.static;
  if (!staticData && app) {
    const queue: HostVueInstance[] = [app];
    const visited = new Set<HostVueInstance>();
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || visited.has(item)) continue;
      visited.add(item);
      if (item.static_ || item.static) {
        staticData = item.static_ || item.static;
        break;
      }
      if (item.$children) queue.push(...item.$children);
    }
  }

  if (!staticData) {
    // Vue 3：靜態資料掛在根元件 proxy 上
    const root = getTradeRootComponent() as HostVueInstance | null;
    staticData = root?.static_ || root?.static;
  }
  return staticData?.knownStatsFlat;
}

export function sendCurrentQuery(bridge: MainWorldBridge) {
  try {
    const store = getVueStore();
    if (!store) {
      console.warn('[PoeXD Inject] sendCurrentQuery: 找不到 Vuex store');
      return;
    }
    if (!store.state) {
      console.warn('[PoeXD Inject] sendCurrentQuery: Vuex store 沒有 state');
      return;
    }

    const query = store.state.query || store.state.persistent;
    if (!query) {
      console.warn(
        '[PoeXD Inject] sendCurrentQuery: Vuex store 沒有 state.query 或 state.persistent',
      );
      return;
    }

    const queryJson = JSON.stringify({ query });
    bridge.dispatchEvent(
      'poexd-search-query-observed',
      serializePoeSearchQueryObserved({ queryJson, source: 'current-query' }),
    );
  } catch (e) {
    console.error('[PoeXD Inject] sendCurrentQuery 錯誤:', e);
  }
}

export function initPoeRuntimeReader(bridge: MainWorldBridge) {
  // 輪詢嘗試抓取，防範 SPA 延遲初始化
  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    const tradeEl = document.querySelector('#trade') as
      | (Element & { __vue__?: HostVueInstance; __vue_app__?: HostVueInstance })
      | null;
    const app =
      tradeEl?.__vue__ || (tradeEl?.parentElement as any)?.__vue__ || tradeEl?.__vue_app__;
    const staticData = app?._data?.static_ || app?.static;
    if ((staticData && staticData.knownStatsFlat) || attempts >= 30) {
      clearInterval(pollInterval);
      if (staticData && staticData.knownStatsFlat) {
        sendKnownStats(bridge);
        sendCurrentQuery(bridge);
      }
    }
  }, 300);

  // 監聽側邊欄主動請求 known stats
  bridge.addListener('poexd-request-known-stats', () => {
    sendKnownStats(bridge);
  });
}
