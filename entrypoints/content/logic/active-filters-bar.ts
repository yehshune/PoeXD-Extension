/**
 * 官方藍區（屬性過濾 `.search-advanced-pane.blue`）頂部精簡檢視切換列：
 * - 「只看已填屬性」：純 CSS `:has(.modified, :focus-within)` 即時隱藏空白群組與空白欄位，
 *   完全不碰官方 `.toggle-btn`（Vuex `disabled` 狀態）與查詢 payload。
 * - 尊重官方勾選／展開語意（選項 A）：
 *   - 已勾選（`.expanded`）且有填值的群組維持展開，只顯示有填值的列。
 *   - 有填值但暫時取消勾選（不進查詢 payload）的群組，保留官方原本的折疊標題列方便隨時重新勾回，絕不強制展開內容。
 *   - 計數器僅統計「已勾選生效中」的已填屬性列數。
 * - 點擊官方「清除」按鈕時自動關閉「只看已填屬性」，避免清空後停在空白檢視。
 *
 * 外觀屬 `visual-class-reset-contract.md` §2.2 Host-Native PoE Controls 例外，
 * 採方角與官方暗黑／暖金 `oklch()` 色階，不隨 PoeXD 側邊欄主題變色。
 */
import { t } from '@/utils/i18n';
import { createSvgIcon } from '@/utils/safe-dom';
import { CONSOLE_RESULT_ONLY_ATTR } from './live-search-console-host-guard';

export const ACTIVE_FILTERS_STYLE_ID = 'poexd-active-filters-bar-style';
export const ACTIVE_FILTERS_ONLY_ATTR = 'data-poexd-active-filters-only';
export const ACTIVE_FILTERS_BAR_CLASS = 'poexd-active-filters-bar';
export const ACTIVE_FILTERS_TOGGLE_CLASS = 'poexd-active-filters-toggle';
export const ACTIVE_FILTERS_EMPTY_CLASS = 'poexd-active-filters-empty';
export const ACTIVE_FILTERS_SHOW_ALL_BTN_CLASS = 'poexd-active-filters-show-all-btn';

const BLUE_PANE_SELECTOR = '.search-advanced-pane.blue';
const BLUE_GROUP_SELECTOR = ':scope > .filter-group';
const OFFICIAL_CLEAR_BTN_SELECTOR = '#trade .search-panel > .controls .clear-btn';

const ICON_SVG_ATTRS = {
  width: '12',
  height: '12',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2.1',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

const FUNNEL_ICON_PATHS = ['M22 3H2l8 9.46V19l4 2v-8.54L22 3z'] as const;

const ACTIVE_ONLY_SCOPE = `html[${ACTIVE_FILTERS_ONLY_ATTR}="true"]:not([${CONSOLE_RESULT_ONLY_ATTR}="true"])`;
const HOST_VISIBLE_SCOPE = `html:not([${CONSOLE_RESULT_ONLY_ATTR}="true"])`;

/** 判斷藍區屬性群組目前是否處於官方勾選啟用狀態（會進入查詢 payload） */
export function isBlueGroupEnabled(groupEl: Element): boolean {
  if (!groupEl.classList.contains('expanded')) return false;
  const toggleBtn = groupEl.querySelector('.filter-group-header .toggle-btn');
  if (toggleBtn?.classList.contains('off')) return false;
  return true;
}

/** 僅計算已勾選生效中群組內的已填屬性列數（同一列多個輸入框如插槽僅計 1 列） */
export function countActiveBlueFilters(bluePane: Element | null | undefined): number {
  if (!bluePane) return 0;
  let count = 0;
  bluePane.querySelectorAll(BLUE_GROUP_SELECTOR).forEach((groupEl) => {
    if (!isBlueGroupEnabled(groupEl)) return;
    groupEl.querySelectorAll(':scope > .filter-group-body > .filter').forEach((filterEl) => {
      if (filterEl.querySelector('.modified')) count += 1;
    });
  });
  return count;
}

export function buildActiveFiltersBarCss(): string {
  return `
    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_BAR_CLASS} {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 6px !important;
      width: 100% !important;
      margin: 0 0 6px !important;
      padding: 0 !important;
      box-sizing: border-box !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_BAR_CLASS} > .${ACTIVE_FILTERS_TOGGLE_CLASS} {
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      height: 24px !important;
      padding: 0 8px !important;
      margin: 0 !important;
      border-radius: 0 !important;
      border: 1px solid oklch(0.32 0.008 250) !important;
      background: oklch(0.175 0.005 250) !important;
      color: oklch(0.84 0.012 80) !important;
      font-family: Verdana, Arial, Helvetica, sans-serif !important;
      font-size: 11px !important;
      line-height: 1 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      box-sizing: border-box !important;
      transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_BAR_CLASS} > .${ACTIVE_FILTERS_TOGGLE_CLASS}:hover {
      background: oklch(0.24 0.007 250) !important;
      border-color: oklch(0.46 0.025 78) !important;
      color: oklch(0.95 0.02 82) !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_BAR_CLASS} > .${ACTIVE_FILTERS_TOGGLE_CLASS}:focus-visible {
      outline: none !important;
      box-shadow: inset 0 0 0 1px oklch(0.654 0.055 78) !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_BAR_CLASS} > .${ACTIVE_FILTERS_TOGGLE_CLASS}[data-active="true"] {
      background: oklch(0.24 0.028 78) !important;
      border-color: oklch(0.62 0.058 78) !important;
      color: oklch(0.9 0.068 82.8) !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_BAR_CLASS} > .${ACTIVE_FILTERS_TOGGLE_CLASS}[data-active="true"]:hover {
      background: oklch(0.285 0.035 78) !important;
      border-color: oklch(0.7 0.065 78) !important;
      color: oklch(0.96 0.04 82.8) !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_EMPTY_CLASS} {
      display: none !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      width: 100% !important;
      padding: 8px 10px !important;
      margin: 0 0 6px !important;
      box-sizing: border-box !important;
      border: 1px solid oklch(0.28 0.008 250) !important;
      background: oklch(0.145 0.005 250) !important;
      color: oklch(0.72 0.01 80) !important;
      font-size: 12px !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_EMPTY_CLASS} > .${ACTIVE_FILTERS_SHOW_ALL_BTN_CLASS} {
      flex: 0 0 auto !important;
      height: 22px !important;
      padding: 0 8px !important;
      border-radius: 0 !important;
      border: 1px solid oklch(0.45 0.04 78) !important;
      background: oklch(0.22 0.018 78) !important;
      color: oklch(0.88 0.06 82.8) !important;
      font-size: 11px !important;
      cursor: pointer !important;
    }

    ${HOST_VISIBLE_SCOPE} ${BLUE_PANE_SELECTOR} > .${ACTIVE_FILTERS_EMPTY_CLASS} > .${ACTIVE_FILTERS_SHOW_ALL_BTN_CLASS}:hover {
      background: oklch(0.28 0.028 78) !important;
      border-color: oklch(0.6 0.055 78) !important;
      color: oklch(0.96 0.035 82.8) !important;
    }

    /* 只看已填屬性：隱藏完全無填值且未聚焦的空白群組；尊重官方勾選／展開狀態，不強制展開已取消勾選的群組內容 */
    ${ACTIVE_ONLY_SCOPE} ${BLUE_PANE_SELECTOR} > .filter-group:not(:has(.filter-group-body .modified, .filter-group-body :focus-within)) {
      display: none !important;
    }

    ${ACTIVE_ONLY_SCOPE} ${BLUE_PANE_SELECTOR} > .filter-group.expanded > .filter-group-body > .filter:not(:has(.modified, :focus-within)) {
      display: none !important;
    }

    ${ACTIVE_ONLY_SCOPE} ${BLUE_PANE_SELECTOR} > .filter-group.expanded > .filter-group-body > .filter:has(.modified, :focus-within) {
      width: 100% !important;
      flex: 0 0 100% !important;
      float: none !important;
      margin-left: 0 !important;
      box-sizing: border-box !important;
    }

    ${ACTIVE_ONLY_SCOPE} ${BLUE_PANE_SELECTOR}:not(:has(> .filter-group .filter-group-body :is(.modified, :focus-within))) > .${ACTIVE_FILTERS_EMPTY_CLASS} {
      display: flex !important;
    }

    html[${CONSOLE_RESULT_ONLY_ATTR}="true"] .${ACTIVE_FILTERS_BAR_CLASS},
    html[${CONSOLE_RESULT_ONLY_ATTR}="true"] .${ACTIVE_FILTERS_EMPTY_CLASS} {
      display: none !important;
    }
  `;
}

export interface ActiveFiltersBarController {
  sync(): void;
  refreshLocale(): void;
  cleanup(): void;
}

export interface ActiveFiltersBarOptions {
  doc?: Document;
}

export function createActiveFiltersBar(
  options: ActiveFiltersBarOptions = {},
): ActiveFiltersBarController {
  const doc = options.doc ?? document;

  let activeOnly = false;
  let styleEl: HTMLStyleElement | null = null;
  let observedBluePane: HTMLElement | null = null;
  let barEl: HTMLDivElement | null = null;
  let toggleBtnEl: HTMLButtonElement | null = null;
  let toggleLabelEl: HTMLSpanElement | null = null;
  let emptyEl: HTMLDivElement | null = null;
  let emptyTextEl: HTMLSpanElement | null = null;
  let showAllBtnEl: HTMLButtonElement | null = null;

  let paneObserver: MutationObserver | null = null;
  let paneUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let clearListenerAttached = false;

  const setRootActiveAttr = (enabled: boolean) => {
    const root = doc.documentElement;
    if (enabled) {
      if (root.getAttribute(ACTIVE_FILTERS_ONLY_ATTR) !== 'true') {
        root.setAttribute(ACTIVE_FILTERS_ONLY_ATTR, 'true');
      }
    } else if (root.hasAttribute(ACTIVE_FILTERS_ONLY_ATTR)) {
      root.removeAttribute(ACTIVE_FILTERS_ONLY_ATTR);
    }
  };

  const ensureStyle = () => {
    if (styleEl && styleEl.isConnected) return;
    const existing = doc.getElementById(ACTIVE_FILTERS_STYLE_ID) as HTMLStyleElement | null;
    if (existing) {
      styleEl = existing;
      return;
    }
    styleEl = doc.createElement('style');
    styleEl.id = ACTIVE_FILTERS_STYLE_ID;
    styleEl.textContent = buildActiveFiltersBarCss();
    (doc.head || doc.documentElement)?.appendChild(styleEl);
  };

  const removeStyle = () => {
    styleEl?.remove();
    styleEl = null;
    doc.getElementById(ACTIVE_FILTERS_STYLE_ID)?.remove();
  };

  const updateBarUi = () => {
    const activeCount = countActiveBlueFilters(observedBluePane);
    if (toggleBtnEl && toggleLabelEl) {
      const label =
        activeCount > 0
          ? t('activeFiltersBar.toggleWithCount', { count: String(activeCount) })
          : t('activeFiltersBar.toggle');
      toggleLabelEl.textContent = label;
      toggleBtnEl.setAttribute('aria-pressed', String(activeOnly));
      toggleBtnEl.setAttribute('data-active', activeOnly ? 'true' : 'false');
      toggleBtnEl.title = activeOnly
        ? t('activeFiltersBar.showAllTooltip')
        : t('activeFiltersBar.onlyActiveTooltip');
    }

    if (emptyTextEl) {
      emptyTextEl.textContent = t('activeFiltersBar.emptyHint');
    }
    if (showAllBtnEl) {
      showAllBtnEl.textContent = t('activeFiltersBar.showAll');
    }
  };

  const setActiveOnly = (next: boolean) => {
    if (activeOnly === next) return;
    activeOnly = next;
    setRootActiveAttr(activeOnly);
    updateBarUi();
  };

  const scheduleUiRefresh = () => {
    if (paneUpdateTimer !== null) return;
    paneUpdateTimer = setTimeout(() => {
      paneUpdateTimer = null;
      updateBarUi();
    }, 40);
  };

  const handleDocumentClick = (event: Event) => {
    if (!activeOnly) return;
    const target = event.target as Element | null;
    if (!target?.closest(OFFICIAL_CLEAR_BTN_SELECTOR)) return;
    setActiveOnly(false);
  };

  const attachClearListener = () => {
    if (clearListenerAttached) return;
    clearListenerAttached = true;
    doc.addEventListener('click', handleDocumentClick, true);
  };

  const detachClearListener = () => {
    if (!clearListenerAttached) return;
    clearListenerAttached = false;
    doc.removeEventListener('click', handleDocumentClick, true);
  };

  const detachBar = () => {
    if (paneUpdateTimer !== null) {
      clearTimeout(paneUpdateTimer);
      paneUpdateTimer = null;
    }
    paneObserver?.disconnect();
    paneObserver = null;
    barEl?.remove();
    barEl = null;
    toggleBtnEl = null;
    toggleLabelEl = null;
    emptyEl?.remove();
    emptyEl = null;
    emptyTextEl = null;
    showAllBtnEl = null;
    observedBluePane = null;
  };

  const mountOnBluePane = (bluePane: HTMLElement) => {
    detachBar();
    observedBluePane = bluePane;
    ensureStyle();
    attachClearListener();

    const bar = doc.createElement('div');
    bar.className = ACTIVE_FILTERS_BAR_CLASS;

    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = ACTIVE_FILTERS_TOGGLE_CLASS;
    const toggleLabel = doc.createElement('span');
    toggleBtn.append(
      createSvgIcon({ attrs: ICON_SVG_ATTRS, paths: FUNNEL_ICON_PATHS }, doc),
      toggleLabel,
    );
    toggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveOnly(!activeOnly);
    });

    bar.append(toggleBtn);

    const empty = doc.createElement('div');
    empty.className = ACTIVE_FILTERS_EMPTY_CLASS;
    const emptyText = doc.createElement('span');
    const showAllBtn = doc.createElement('button');
    showAllBtn.type = 'button';
    showAllBtn.className = ACTIVE_FILTERS_SHOW_ALL_BTN_CLASS;
    showAllBtn.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveOnly(false);
    });
    empty.append(emptyText, showAllBtn);

    bluePane.prepend(empty);
    bluePane.prepend(bar);

    barEl = bar;
    toggleBtnEl = toggleBtn;
    toggleLabelEl = toggleLabel;
    emptyEl = empty;
    emptyTextEl = emptyText;
    showAllBtnEl = showAllBtn;

    if (typeof MutationObserver !== 'undefined') {
      paneObserver = new MutationObserver(() => scheduleUiRefresh());
      paneObserver.observe(bluePane, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }

    updateBarUi();
  };

  return {
    sync() {
      const bluePane = doc.querySelector<HTMLElement>(BLUE_PANE_SELECTOR);
      if (!bluePane) {
        detachBar();
        setRootActiveAttr(false);
        return;
      }
      if (observedBluePane === bluePane && barEl?.isConnected && emptyEl?.isConnected) {
        updateBarUi();
        return;
      }
      mountOnBluePane(bluePane);
    },
    refreshLocale() {
      updateBarUi();
    },
    cleanup() {
      activeOnly = false;
      setRootActiveAttr(false);
      detachClearListener();
      detachBar();
      removeStyle();
    },
  };
}
