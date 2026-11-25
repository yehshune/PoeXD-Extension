/**
 * 在官方頁面主世界執行的唯讀探測函式。透過 `page.evaluate(fn, arg)` 序列化傳入，
 * 所以每個函式都必須自給自足：不能引用模組內其他變數或 import。
 */

export interface TradePageSummary {
  readonly title: string;
  readonly extensionMounted: boolean;
  readonly filtersHidden: boolean | null;
  readonly resultHeading: string | null;
  readonly rowCount: number;
  readonly loadMoreVisible: boolean;
  readonly liveSearchButton: string | null;
  readonly store: { realm?: string; league?: string; status?: string; searchId?: string } | null;
}

export function summarizeTradePage(): TradePageSummary {
  type VueHost = Element & { __vue_app__?: { config?: { globalProperties?: { $store?: any } } } };
  const host = document.querySelector('#trade') as VueHost | null;
  const state = host?.__vue_app__?.config?.globalProperties?.$store?.state;
  const advanced = document.querySelector('.search-panel .search-advanced');
  const text = (selector: string) =>
    (document.querySelector(selector) as HTMLElement | null)?.innerText.trim() || null;
  return {
    title: document.title,
    extensionMounted: Boolean(document.querySelector('poexd-sidebar-container')),
    filtersHidden: advanced ? advanced.classList.contains('search-advanced-hidden') : null,
    resultHeading: text('.results .row-total h3'),
    rowCount: document.querySelectorAll('.results .resultset .row[data-id]').length,
    loadMoreVisible: Boolean(document.querySelector('.results .load-more-btn')),
    liveSearchButton: text('.search-panel .controls .livesearch-btn'),
    store: state
      ? {
          realm: state.persistent?.realm,
          league: state.persistent?.league,
          status: state.persistent?.status,
          searchId: state.transient?.search?.id ?? state.persistent?.id ?? undefined,
        }
      : null,
  };
}

/**
 * 取官方 Vuex state 的某個路徑（例如 `persistent.stats`），並限制深度與陣列長度，避免輸出爆量。
 * 回傳 `undefined` 代表路徑不存在。
 */
export function snapshotStore(input: { path: string; depth: number; maxItems: number }): unknown {
  type VueHost = Element & { __vue_app__?: { config?: { globalProperties?: { $store?: any } } } };
  const app = ['#trade', '#app']
    .map((selector) => (document.querySelector(selector) as VueHost | null)?.__vue_app__)
    .find((candidate) => candidate?.config?.globalProperties?.$store);
  const state = app?.config?.globalProperties?.$store?.state;
  if (!state) throw new Error('找不到官方 Vuex store');
  const target = input.path
    .split('.')
    .filter(Boolean)
    .reduce<any>((node, key) => (node == null ? undefined : node[key]), state);
  const prune = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (depth <= 0) {
      return Array.isArray(value)
        ? `[Array(${value.length})]`
        : `{${Object.keys(value).join(', ')}}`;
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, input.maxItems).map((item) => prune(item, depth - 1));
      return value.length > input.maxItems
        ? [...items, `…另外 ${value.length - input.maxItems} 筆`]
        : items;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        prune(child, depth - 1),
      ]),
    );
  };
  return prune(target, input.depth);
}
