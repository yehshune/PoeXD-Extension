/**
 * 擴充功能依賴的官方交易頁面契約：DOM 選擇器與 Vuex store 形狀。
 *
 * 兩邊共用同一份清單：
 * - 實機金絲雀（`e2e/canary/official-page-canary.ts`）拿它檢查真正的官方頁面，官方改版時第一時間發現。
 * - 離線 E2E（`e2e/offline/contract.offline.ts`）拿 `offline: true` 的項目檢查替身頁，確保替身頁沒有和官方脫節。
 *
 * 新功能開始依賴官方的某個結構時，把它加進這裡；替身頁有實作的標成 `offline: true`。
 */

export interface DomCheck {
  readonly id: string;
  readonly selector: string;
  /** 依賴這個結構的擴充功能模組，失敗時方便追查 */
  readonly usedBy: string;
  /** 替身頁也有實作，離線 E2E 會檢查 */
  readonly offline: boolean;
}

/** 搜尋頁本身（不需要有結果） */
export const SEARCH_PAGE_DOM: readonly DomCheck[] = [
  {
    id: 'app-root',
    selector: '#trade',
    usedBy: 'initial-page-load-gate, poe-runtime-reader',
    offline: true,
  },
  {
    id: 'search-panel',
    selector: '#trade .search-panel',
    usedBy: 'live-search-console-host-guard',
    offline: true,
  },
  {
    id: 'search-name-input',
    selector: '.search-panel .search-bar .search-left input',
    usedBy: 'search-observation-session（搜尋紀錄名稱）',
    offline: true,
  },
  {
    id: 'search-advanced',
    selector: '.search-panel .search-advanced',
    usedBy: 'search-enter-commit, stat-group-template-slots',
    offline: true,
  },
  {
    id: 'search-controls',
    selector: '.search-panel .controls .search-btn',
    usedBy: 'live-search-console-host-guard',
    offline: false,
  },
  {
    id: 'results-root',
    selector: '#trade .results',
    usedBy: 'trade-results-root（結果列的所有功能）',
    offline: true,
  },
  {
    id: 'result-count-row',
    selector: '.results > .row.row-total',
    usedBy: 'result-board-runtime（結果數旁的看板捷徑）',
    offline: true,
  },
  {
    id: 'result-count-heading',
    selector: '.results .row-total h3',
    usedBy: 'market-translation-page（結果筆數標題中文化）',
    offline: false,
  },
  {
    id: 'result-layout-buttons',
    selector: '.results .row-total button[title]',
    usedBy: 'market-translation-page（結果版型按鈕提示中文化）',
    offline: false,
  },
  {
    id: 'resultset',
    selector: '.results .resultset',
    usedBy: 'result-board-runtime',
    offline: true,
  },
  {
    id: 'result-load-more',
    selector: '.results .load-more-btn',
    usedBy: 'result-board-runtime（批次載入更多）, two-column-layout（滑底自動載入）',
    offline: false,
  },
  {
    id: 'trade-wrapper',
    selector: '.container-fluid .content .wrapper',
    usedBy: 'two-column-layout（雙欄視窗鎖定與最大寬度置中）',
    offline: false,
  },
  {
    id: 'trade-navigation',
    selector: '#trade > .navigation',
    usedBy: 'two-column-layout, live-search-console-host-guard',
    offline: false,
  },
  {
    id: 'trade-top',
    selector: '#trade > .top',
    usedBy: 'two-column-layout（左側篩選欄容器）',
    offline: false,
  },
  {
    id: 'trade-vue3-portal',
    selector: '#trade > #vue3-portal',
    usedBy: 'two-column-layout（右欄結果掛載觀測）',
    offline: false,
  },
  {
    id: 'search-advanced-pane-blue',
    selector: '.search-panel .search-advanced-pane.blue',
    usedBy: 'two-column-layout（屬性過濾區）',
    offline: false,
  },
  {
    id: 'search-advanced-pane-brown',
    selector: '.search-panel .search-advanced-pane.brown',
    usedBy: 'two-column-layout（詞綴篩選區）',
    offline: false,
  },
];

/**
 * 結果列內部：只要有任一列符合就算通過（物品種類不同，結構也不同，例如通貨沒有詞綴）。
 * 選擇器相對於 `.results .resultset .row[data-id]`。
 */
export const RESULT_ROW_SELECTOR = '.results .resultset .row[data-id]';

export const RESULT_ROW_DOM: readonly DomCheck[] = [
  {
    id: 'row-left',
    selector: ':scope > .left',
    usedBy: 'result-left-actions（PoB 複製、外部連結、釘選按鈕）',
    offline: true,
  },
  {
    id: 'row-item-popup',
    selector: ':scope > .middle .item-popup',
    usedBy: 'result-pob-copy, market-result-translator',
    offline: true,
  },
  {
    id: 'row-item-header',
    selector: '.item-popup__header-line',
    usedBy: 'market-result-translator, result-board-runtime（看板品名搜尋，含漢化後品名）',
    offline: true,
  },
  {
    id: 'row-stat-field',
    selector: '[data-field^="stat."]',
    usedBy: 'result-mod-quick-filter, market-result-translator, result-board-runtime',
    offline: true,
  },
  {
    id: 'row-mod-line-lc',
    selector: '.s.lc',
    usedBy: 'result-board-runtime（看板漢化詞綴搜尋）',
    offline: false,
  },
  {
    id: 'row-mod-tier-badge',
    selector: '.lc.l.pr, .lc.l.su',
    usedBy: 'result-board-runtime（看板階級搜尋）',
    offline: false,
  },
  {
    id: 'row-price-field',
    selector: '[data-field="price"]',
    usedBy: 'result-price-presenter, result-sort-controller',
    offline: true,
  },
  {
    id: 'row-price',
    selector: '.price',
    usedBy: 'result-price-presenter',
    offline: true,
  },
  {
    id: 'row-indexed-time',
    selector: '[data-field="indexed"] small',
    usedBy: 'market-result-translator',
    offline: false,
  },
];

/** 線上搜尋主控台寫入官方 Vuex store 時需要的 mutation（official-livesearch-adapter） */
export const STORE_MUTATIONS = [
  'addSearchQuery',
  'setSearchActive',
  'addSearchResult',
  'setItemForSearchResult',
] as const;

export interface CheckResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface PageInspection {
  readonly url: string;
  readonly rowCount: number;
  readonly results: readonly CheckResult[];
}

export interface InspectInput {
  readonly searchPage: readonly DomCheck[];
  readonly rowSelector: string;
  readonly row: readonly DomCheck[];
  readonly mutations: readonly string[];
  /** 頁面上沒有結果列時，結果列檢查記為失敗（true）或略過（false） */
  readonly requireRows: boolean;
}

/**
 * 在頁面裡執行（`page.evaluate`），所以不能引用模組內其他東西，所需資料全部從參數傳入。
 * 只讀取 DOM 與 store，不呼叫任何 mutation，也不發任何請求。
 */
export function inspectOfficialPage(input: InspectInput): PageInspection {
  const results: CheckResult[] = [];
  for (const check of input.searchPage) {
    const count = document.querySelectorAll(check.selector).length;
    results.push({ id: check.id, ok: count > 0, detail: `${check.selector} → ${count}` });
  }

  const rows = Array.from(document.querySelectorAll(input.rowSelector));
  for (const check of input.row) {
    if (rows.length === 0) {
      results.push({
        id: check.id,
        ok: !input.requireRows,
        detail: input.requireRows ? '頁面上沒有結果列' : '略過：頁面上沒有結果列',
      });
      continue;
    }
    const matched = rows.filter((row) => row.querySelector(check.selector) !== null).length;
    results.push({
      id: check.id,
      ok: matched > 0,
      detail: `${check.selector} → ${matched}/${rows.length} 列`,
    });
  }

  type Store = {
    state?: { transient?: { searches?: unknown; search?: Record<string, unknown> } };
    _mutations?: Record<string, unknown>;
    _withCommit?: unknown;
  };
  // 與 poe-runtime-reader 的 getVueStore 相同順序：Vue 2 的 `__vue__.$store`，再來是 Vue 3 的 app 全域屬性
  type VueHost = Element & {
    __vue__?: { $store?: Store };
    __vue_app__?: { config?: { globalProperties?: { $store?: Store } } };
  };
  let store: Store | undefined;
  let storePath = '';
  for (const selector of ['#trade', '.layout', '#app']) {
    const host = document.querySelector(selector) as VueHost | null;
    if (host?.__vue__?.$store) {
      store = host.__vue__.$store;
      storePath = `${selector}.__vue__.$store`;
    } else if (host?.__vue_app__?.config?.globalProperties?.$store) {
      store = host.__vue_app__.config.globalProperties.$store;
      storePath = `${selector}.__vue_app__.config.globalProperties.$store`;
    }
    if (store) break;
  }
  results.push({
    id: 'store',
    ok: Boolean(store),
    detail: store ? storePath : '#trade / .layout / #app 上都找不到 Vuex store',
  });
  if (store) {
    const transient = store.state?.transient;
    results.push({
      id: 'store-searches',
      ok: Array.isArray(transient?.searches),
      detail: `state.transient.searches 是 ${Array.isArray(transient?.searches) ? '陣列' : typeof transient?.searches}`,
    });
    results.push({
      id: 'store-active-search',
      ok: Boolean(transient?.search) && 'active' in (transient?.search ?? {}),
      detail: 'state.transient.search.active',
    });
    results.push({
      id: 'store-with-commit',
      ok: typeof store._withCommit === 'function',
      detail: `_withCommit 是 ${typeof store._withCommit}`,
    });
    const missing = input.mutations.filter((name) => !store._mutations?.[name]);
    results.push({
      id: 'store-mutations',
      ok: missing.length === 0,
      detail: missing.length === 0 ? input.mutations.join(', ') : `缺少 ${missing.join(', ')}`,
    });
  }

  return { url: location.origin + location.pathname, rowCount: rows.length, results };
}
