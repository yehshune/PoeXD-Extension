/**
 * 寬螢幕雙欄版面控制器（左：固定篩選欄；右：搜尋結果區）。
 *
 * 樣式定義位於 `./two-column-layout-styles`，純幾何計算位於 `@/utils/two-column-layout`。
 * 本模組專責 DOM 生命週期、尺寸／路由／結果容器觀測、分隔線拖曳、頂部標頭自動收合與
 * 右欄滑底自動觸發官方「讀取更多」橋接（全程避免在 scroll/wheel 熱路徑觸發同步排版）。
 */
import { listenPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import type { TradePageRole } from '@/utils/live-search-contract';
import type { TwoColumnMaxWidth } from '@/utils/preferences-contract';
import { createSvgIcon } from '@/utils/safe-dom';
import {
  TWO_COLUMN_COLUMN_GAP,
  TWO_COLUMN_DEFAULT_FILTER_WIDTH,
  TWO_COLUMN_DEFAULT_MAX_WIDTH,
  TWO_COLUMN_RESULTS_SINGLE_CARD_BREAKPOINT,
  TWO_COLUMN_SINGLE_ROW_CONTROLS_BREAKPOINT,
  TWO_COLUMN_SINGLE_ROW_SEARCH_BAR_BREAKPOINT,
  TWO_COLUMN_WIDE_FILTER_BREAKPOINT,
  clampTwoColumnFilterWidth,
  resolveTwoColumnGeometry,
  resolveTwoColumnMaxWidthPx,
  type TwoColumnGeometry,
} from '@/utils/two-column-layout';
import {
  TWO_COLUMN_ATTR,
  TWO_COLUMN_COLLAPSED_ATTR,
  TWO_COLUMN_COLLAPSE_BTN_CLASS,
  TWO_COLUMN_CONTROLS_ATTR,
  TWO_COLUMN_FILTERS_ATTR,
  TWO_COLUMN_HEADER_BACKDROP_CLASS,
  TWO_COLUMN_HEADER_OPEN_ATTR,
  TWO_COLUMN_HEADER_TAB_CLASS,
  TWO_COLUMN_HIDE_HEADER_ATTR,
  TWO_COLUMN_MAX_WIDTH_VAR,
  TWO_COLUMN_RESULTS_ATTR,
  TWO_COLUMN_SEARCH_BAR_ATTR,
  TWO_COLUMN_SPLITTER_CLASS,
  TWO_COLUMN_STYLE_ID,
  TWO_COLUMN_TOP_BTN_CLASS,
  TWO_COLUMN_WIDTH_VAR,
  buildTwoColumnLayoutCss,
} from './two-column-layout-styles';

export {
  TWO_COLUMN_ATTR,
  TWO_COLUMN_COLLAPSED_ATTR,
  TWO_COLUMN_COLLAPSE_BTN_CLASS,
  TWO_COLUMN_CONTROLS_ATTR,
  TWO_COLUMN_FILTERS_ATTR,
  TWO_COLUMN_HEADER_BACKDROP_CLASS,
  TWO_COLUMN_HEADER_OPEN_ATTR,
  TWO_COLUMN_HEADER_TAB_CLASS,
  TWO_COLUMN_HIDE_HEADER_ATTR,
  TWO_COLUMN_MAX_WIDTH_VAR,
  TWO_COLUMN_RESULTS_ATTR,
  TWO_COLUMN_SEARCH_BAR_ATTR,
  TWO_COLUMN_SPLITTER_CLASS,
  TWO_COLUMN_STYLE_ID,
  TWO_COLUMN_TOP_BTN_CLASS,
  TWO_COLUMN_WIDTH_VAR,
  buildTwoColumnLayoutCss,
};

const OFFICIAL_HEADER_SELECTOR =
  '.wrapper > #statusBar, .wrapper > .linkBack, .wrapper > .logo, .wrapper > .language-select';
const LOAD_MORE_BTN_SELECTOR = '.results .controls .load-more-btn, .results .load-more-btn';
const LOAD_MORE_TRIGGER_MARGIN_PX = 240;
const LOAD_MORE_COOLDOWN_MS = 1200;
const SCROLL_TOP_SHOW_THRESHOLD_PX = 320;
const NARROW_FILTER_PANE_BREAKPOINT = 460;
const HEADER_OPEN_DELAY_MS = 120;
const HEADER_CLOSE_DELAY_MS = 240;

const CHEVRON_SVG_ATTRS = {
  width: '14',
  height: '14',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2.2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

const CHEVRON_LEFT_PATHS = ['m15 18-6-6 6-6'] as const;
const CHEVRON_RIGHT_PATHS = ['m9 18 6-6-6-6'] as const;
const CHEVRON_DOWN_PATHS = ['m6 9 6 6 6-6'] as const;
const CHEVRON_UP_PATHS = ['m18 15-6-6-6 6'] as const;

export interface TwoColumnLayoutConfig {
  enabled?: boolean;
  pageRole?: TradePageRole;
  preferredFilterWidth?: number;
  maxWidth?: TwoColumnMaxWidth;
  autoHideHeader?: boolean;
}

export interface TwoColumnLayoutOptions {
  doc?: Document;
  win?: Window;
  now?: () => number;
  onFilterWidthCommit?: (width: number) => void;
}

export interface TwoColumnLayoutController {
  applyConfig(config: TwoColumnLayoutConfig): TwoColumnGeometry;
  refreshLocale(): void;
  sync(): TwoColumnGeometry;
  cleanup(): void;
}

export function createTwoColumnLayoutController(
  options: TwoColumnLayoutOptions = {},
): TwoColumnLayoutController {
  const doc = options.doc ?? document;
  const win = options.win ?? doc.defaultView ?? window;
  const now = options.now ?? Date.now;
  const onFilterWidthCommit = options.onFilterWidthCommit;

  let enabled = false;
  let pageRole: TradePageRole = 'normal';
  let preferredFilterWidth = TWO_COLUMN_DEFAULT_FILTER_WIDTH;
  let maxWidth: TwoColumnMaxWidth = TWO_COLUMN_DEFAULT_MAX_WIDTH;
  let autoHideHeader = true;
  let filtersCollapsed = false;
  let draggingWidth: number | null = null;
  let disposed = false;

  let styleEl: HTMLStyleElement | null = null;
  let splitterEl: HTMLDivElement | null = null;
  let collapseBtnEl: HTMLButtonElement | null = null;
  let headerTabEl: HTMLButtonElement | null = null;
  let headerBackdropEl: HTMLDivElement | null = null;
  let topBtnEl: HTMLButtonElement | null = null;
  let topBtnVisible = false;

  let resizeObserver: ResizeObserver | null = null;
  let observedContentEl: Element | null = null;
  let tradeObserver: MutationObserver | null = null;
  let observedTradeEl: Element | null = null;
  let portalObserver: MutationObserver | null = null;
  let observedPortalEl: Element | null = null;
  let bootstrapObserver: MutationObserver | null = null;

  // 右欄內部捲動橋接（自動觸發「讀取更多」＋回頂端按鈕）
  let observedResultsEl: HTMLElement | null = null;
  let resultsScrollCleanup: (() => void) | null = null;
  let resultsMutationObserver: MutationObserver | null = null;
  let loadMoreIntersectionObserver: IntersectionObserver | null = null;
  let observedLoadMoreBtn: HTMLButtonElement | null = null;
  let hasUserScrolledResults = false;
  let lastLoadMoreClickAt = 0;
  let scrollCheckRafId: number | null = null;

  // 頂部官方標頭自動收合 hover 狀態
  let headerOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let headerCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let headerHoverCleanups: (() => void)[] = [];

  let eventCleanups: (() => void)[] = [];
  let listenersAttached = false;
  let activeDragCleanup: (() => void) | null = null;

  const readContentWidth = (): number => {
    const content = doc.querySelector<HTMLElement>('.content');
    const measured = content?.getBoundingClientRect().width;
    if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
      return measured;
    }
    return win?.innerWidth ?? 0;
  };

  const readPathname = (): string => {
    try {
      return win?.location?.pathname ?? '';
    } catch {
      return '';
    }
  };

  const setRootAttr = (name: string, value: string | null) => {
    const root = doc.documentElement;
    if (value === null) {
      if (root.hasAttribute(name)) root.removeAttribute(name);
      return;
    }
    if (root.getAttribute(name) !== value) {
      root.setAttribute(name, value);
    }
  };

  /** 僅於左右欄寬度變動時同步響應式斷點旗標，避免在捲動容器上使用 container-type 影響合成捲動 */
  const syncResponsiveBreakpointAttrs = (leftWidth: number, resultsWidth: number) => {
    setRootAttr(
      TWO_COLUMN_SEARCH_BAR_ATTR,
      leftWidth >= TWO_COLUMN_SINGLE_ROW_SEARCH_BAR_BREAKPOINT ? 'single' : 'stacked',
    );
    setRootAttr(
      TWO_COLUMN_CONTROLS_ATTR,
      leftWidth >= TWO_COLUMN_SINGLE_ROW_CONTROLS_BREAKPOINT ? 'single' : 'stacked',
    );
    setRootAttr(
      TWO_COLUMN_FILTERS_ATTR,
      leftWidth >= TWO_COLUMN_WIDE_FILTER_BREAKPOINT
        ? 'wide'
        : leftWidth < NARROW_FILTER_PANE_BREAKPOINT
          ? 'narrow'
          : 'normal',
    );
    setRootAttr(
      TWO_COLUMN_RESULTS_ATTR,
      resultsWidth >= TWO_COLUMN_RESULTS_SINGLE_CARD_BREAKPOINT ? 'wide' : 'narrow',
    );
  };

  const clearResponsiveBreakpointAttrs = () => {
    setRootAttr(TWO_COLUMN_SEARCH_BAR_ATTR, null);
    setRootAttr(TWO_COLUMN_CONTROLS_ATTR, null);
    setRootAttr(TWO_COLUMN_FILTERS_ATTR, null);
    setRootAttr(TWO_COLUMN_RESULTS_ATTR, null);
  };

  const ensureStyle = () => {
    if (styleEl && styleEl.isConnected) return;
    const existing = doc.getElementById(TWO_COLUMN_STYLE_ID) as HTMLStyleElement | null;
    if (existing) {
      styleEl = existing;
      return;
    }
    styleEl = doc.createElement('style');
    styleEl.id = TWO_COLUMN_STYLE_ID;
    styleEl.textContent = buildTwoColumnLayoutCss();
    (doc.head || doc.documentElement)?.appendChild(styleEl);
  };

  const removeStyle = () => {
    styleEl?.remove();
    styleEl = null;
    doc.getElementById(TWO_COLUMN_STYLE_ID)?.remove();
  };

  const updateCollapseButtonUi = () => {
    if (!collapseBtnEl) return;
    const label = filtersCollapsed
      ? t('twoColumnLayout.expand.tooltip')
      : t('twoColumnLayout.collapse.tooltip');
    collapseBtnEl.title = label;
    collapseBtnEl.setAttribute('aria-label', label);
    collapseBtnEl.setAttribute('aria-expanded', String(!filtersCollapsed));
    collapseBtnEl.replaceChildren(
      createSvgIcon(
        {
          attrs: CHEVRON_SVG_ATTRS,
          paths: filtersCollapsed ? CHEVRON_RIGHT_PATHS : CHEVRON_LEFT_PATHS,
        },
        doc,
      ),
    );
  };

  const updateControlsLocale = () => {
    if (splitterEl) {
      const aria = t('twoColumnLayout.splitter.ariaLabel');
      splitterEl.setAttribute('aria-label', aria);
      splitterEl.title = aria;
    }
    if (headerTabEl) {
      const label = t('twoColumnLayout.headerPullTab.tooltip');
      headerTabEl.title = label;
      headerTabEl.setAttribute('aria-label', label);
    }
    if (topBtnEl) {
      const label = t('twoColumnLayout.scrollTop.tooltip');
      topBtnEl.title = label;
      topBtnEl.setAttribute('aria-label', label);
    }
    updateCollapseButtonUi();
  };

  const stopActiveDrag = () => {
    activeDragCleanup?.();
    activeDragCleanup = null;
    draggingWidth = null;
  };

  const detachSplitter = () => {
    stopActiveDrag();
    splitterEl?.remove();
    splitterEl = null;
    collapseBtnEl = null;
  };

  const clearHeaderTimers = () => {
    if (headerOpenTimer !== null) {
      clearTimeout(headerOpenTimer);
      headerOpenTimer = null;
    }
    if (headerCloseTimer !== null) {
      clearTimeout(headerCloseTimer);
      headerCloseTimer = null;
    }
  };

  const setHeaderRevealed = (open: boolean) => {
    setRootAttr(TWO_COLUMN_HEADER_OPEN_ATTR, open ? 'true' : null);
  };

  const scheduleHeaderOpen = (immediate = false) => {
    clearHeaderTimers();
    if (immediate) {
      setHeaderRevealed(true);
      return;
    }
    headerOpenTimer = setTimeout(() => {
      headerOpenTimer = null;
      if (!disposed) setHeaderRevealed(true);
    }, HEADER_OPEN_DELAY_MS);
  };

  const scheduleHeaderClose = () => {
    clearHeaderTimers();
    headerCloseTimer = setTimeout(() => {
      headerCloseTimer = null;
      if (!disposed) setHeaderRevealed(false);
    }, HEADER_CLOSE_DELAY_MS);
  };

  const detachHeaderControls = () => {
    clearHeaderTimers();
    setHeaderRevealed(false);
    headerHoverCleanups.forEach((fn) => fn());
    headerHoverCleanups = [];
    headerTabEl?.remove();
    headerTabEl = null;
    headerBackdropEl?.remove();
    headerBackdropEl = null;
  };

  const ensureHeaderControlsMounted = () => {
    if (!autoHideHeader) {
      setRootAttr(TWO_COLUMN_HIDE_HEADER_ATTR, null);
      detachHeaderControls();
      return;
    }

    const wrapper = doc.querySelector<HTMLElement>('.wrapper');
    if (!wrapper) {
      detachHeaderControls();
      return;
    }

    setRootAttr(TWO_COLUMN_HIDE_HEADER_ATTR, 'true');
    if (headerTabEl && headerTabEl.parentElement === wrapper && headerBackdropEl?.isConnected) {
      updateControlsLocale();
      return;
    }

    detachHeaderControls();

    const backdrop = doc.createElement('div');
    backdrop.className = TWO_COLUMN_HEADER_BACKDROP_CLASS;

    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.className = TWO_COLUMN_HEADER_TAB_CLASS;
    tab.appendChild(createSvgIcon({ attrs: CHEVRON_SVG_ATTRS, paths: CHEVRON_DOWN_PATHS }, doc));

    const onTabEnter = () => scheduleHeaderOpen(false);
    const onTabClick = (event: MouseEvent) => {
      event.preventDefault();
      scheduleHeaderOpen(true);
    };
    const onOverlayEnter = () => {
      clearHeaderTimers();
      setHeaderRevealed(true);
    };
    const onOverlayLeave = () => scheduleHeaderClose();

    tab.addEventListener('pointerenter', onTabEnter);
    tab.addEventListener('pointerleave', onOverlayLeave);
    tab.addEventListener('click', onTabClick);
    backdrop.addEventListener('pointerenter', onOverlayEnter);
    backdrop.addEventListener('pointerleave', onOverlayLeave);

    const cleanups: (() => void)[] = [
      () => tab.removeEventListener('pointerenter', onTabEnter),
      () => tab.removeEventListener('pointerleave', onOverlayLeave),
      () => tab.removeEventListener('click', onTabClick),
      () => backdrop.removeEventListener('pointerenter', onOverlayEnter),
      () => backdrop.removeEventListener('pointerleave', onOverlayLeave),
    ];

    doc.querySelectorAll<HTMLElement>(OFFICIAL_HEADER_SELECTOR).forEach((el) => {
      el.addEventListener('pointerenter', onOverlayEnter);
      el.addEventListener('pointerleave', onOverlayLeave);
      cleanups.push(() => {
        el.removeEventListener('pointerenter', onOverlayEnter);
        el.removeEventListener('pointerleave', onOverlayLeave);
      });
    });

    wrapper.prepend(backdrop);
    wrapper.prepend(tab);
    headerBackdropEl = backdrop;
    headerTabEl = tab;
    headerHoverCleanups = cleanups;
    updateControlsLocale();
  };

  const cancelPendingScrollRaf = () => {
    if (scrollCheckRafId !== null && typeof win?.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(scrollCheckRafId);
    }
    scrollCheckRafId = null;
  };

  const detachResultsBridge = () => {
    cancelPendingScrollRaf();
    resultsScrollCleanup?.();
    resultsScrollCleanup = null;
    resultsMutationObserver?.disconnect();
    resultsMutationObserver = null;
    loadMoreIntersectionObserver?.disconnect();
    loadMoreIntersectionObserver = null;
    observedLoadMoreBtn = null;
    observedResultsEl = null;
    hasUserScrolledResults = false;
    topBtnVisible = false;
    topBtnEl?.remove();
    topBtnEl = null;
  };

  const syncTopButtonVisibility = () => {
    if (!topBtnEl || !observedResultsEl) return;
    const shouldShow = observedResultsEl.scrollTop > SCROLL_TOP_SHOW_THRESHOLD_PX;
    if (shouldShow === topBtnVisible) return;
    topBtnVisible = shouldShow;
    if (shouldShow) {
      topBtnEl.setAttribute('data-visible', 'true');
    } else {
      topBtnEl.removeAttribute('data-visible');
    }
  };

  const maybeTriggerLoadMore = (forceFromIntersection = false) => {
    if (disposed || !observedResultsEl || !hasUserScrolledResults) return;
    const btn = observedLoadMoreBtn;
    if (!btn || !btn.isConnected || btn.disabled || btn.classList.contains('disabled')) return;
    if (btn.getAttribute('aria-disabled') === 'true') return;

    const currentTime = now();
    if (currentTime - lastLoadMoreClickAt < LOAD_MORE_COOLDOWN_MS) return;
    if (/\/live(?:\/|$)/i.test(readPathname())) return;

    const nearBottom =
      forceFromIntersection ||
      observedResultsEl.scrollTop + observedResultsEl.clientHeight >=
        observedResultsEl.scrollHeight - LOAD_MORE_TRIGGER_MARGIN_PX;
    if (!nearBottom) return;

    // 僅在確定要點擊的那一瞬間檢查一次可見性（1.2 秒最多一次），不在每幀 scroll 熱路徑呼叫 getComputedStyle
    const style = win?.getComputedStyle?.(btn);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return;

    lastLoadMoreClickAt = currentTime;
    btn.click();
  };

  const runScrollFrameCheck = () => {
    scrollCheckRafId = null;
    if (disposed || !observedResultsEl) return;
    syncTopButtonVisibility();
    maybeTriggerLoadMore(false);
  };

  const scheduleScrollFrameCheck = () => {
    if (scrollCheckRafId !== null) return;
    if (typeof win?.requestAnimationFrame === 'function') {
      scrollCheckRafId = win.requestAnimationFrame(runScrollFrameCheck);
    } else {
      runScrollFrameCheck();
    }
  };

  const reobserveLoadMoreButton = () => {
    if (!observedResultsEl) return;
    const btn = observedResultsEl.querySelector<HTMLButtonElement>(LOAD_MORE_BTN_SELECTOR);
    if (btn === observedLoadMoreBtn) return;

    if (observedLoadMoreBtn && loadMoreIntersectionObserver) {
      loadMoreIntersectionObserver.unobserve(observedLoadMoreBtn);
    }
    observedLoadMoreBtn = btn;
    if (btn && loadMoreIntersectionObserver) {
      loadMoreIntersectionObserver.observe(btn);
    }
  };

  const ensureResultsBridgeMounted = () => {
    const tradeEl = doc.querySelector<HTMLElement>('#trade');
    const resultsEl = doc.querySelector<HTMLElement>('#trade .results');
    if (!tradeEl || !resultsEl) {
      detachResultsBridge();
      return;
    }

    if (topBtnEl && topBtnEl.parentElement !== tradeEl) {
      topBtnEl.remove();
      topBtnEl = null;
      topBtnVisible = false;
    }
    if (!topBtnEl) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = TWO_COLUMN_TOP_BTN_CLASS;
      btn.appendChild(createSvgIcon({ attrs: CHEVRON_SVG_ATTRS, paths: CHEVRON_UP_PATHS }, doc));
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        observedResultsEl?.scrollTo({ top: 0, behavior: 'smooth' });
      });
      tradeEl.appendChild(btn);
      topBtnEl = btn;
      topBtnVisible = false;
      updateControlsLocale();
    }

    if (observedResultsEl === resultsEl) {
      reobserveLoadMoreButton();
      syncTopButtonVisibility();
      return;
    }

    cancelPendingScrollRaf();
    resultsScrollCleanup?.();
    resultsMutationObserver?.disconnect();
    loadMoreIntersectionObserver?.disconnect();
    observedLoadMoreBtn = null;
    observedResultsEl = resultsEl;
    hasUserScrolledResults = resultsEl.scrollTop > 0;

    // 熱路徑只更新布林並合併進單一 rAF，避免每幀 scroll/wheel 觸發同步排版導致卡頓
    const handleResultsScroll = () => {
      if (disposed || !observedResultsEl) return;
      hasUserScrolledResults = observedResultsEl.scrollTop > 0;
      scheduleScrollFrameCheck();
    };

    const handleResultsWheel = (event: WheelEvent) => {
      if (disposed || !observedResultsEl || event.deltaY <= 0) return;
      hasUserScrolledResults = true;
      scheduleScrollFrameCheck();
    };

    resultsEl.addEventListener('scroll', handleResultsScroll, { passive: true });
    resultsEl.addEventListener('wheel', handleResultsWheel, { passive: true });
    resultsScrollCleanup = () => {
      resultsEl.removeEventListener('scroll', handleResultsScroll);
      resultsEl.removeEventListener('wheel', handleResultsWheel);
    };

    if (typeof IntersectionObserver !== 'undefined') {
      loadMoreIntersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            maybeTriggerLoadMore(true);
          }
        },
        {
          root: resultsEl,
          rootMargin: `0px 0px ${LOAD_MORE_TRIGGER_MARGIN_PX}px 0px`,
          threshold: 0,
        },
      );
    }

    if (typeof MutationObserver !== 'undefined') {
      resultsMutationObserver = new MutationObserver(() => {
        if (!disposed) reobserveLoadMoreButton();
      });
      resultsMutationObserver.observe(resultsEl, { childList: true, subtree: true });
    }

    reobserveLoadMoreButton();
    syncTopButtonVisibility();
  };

  const startResizeDrag = (event: PointerEvent) => {
    if (filtersCollapsed || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest(`.${TWO_COLUMN_COLLAPSE_BTN_CLASS}`)) return;
    event.preventDefault();

    const startX = event.clientX;
    const contentWidth = readContentWidth();
    const { clamped: startWidth } = clampTwoColumnFilterWidth(
      preferredFilterWidth,
      contentWidth,
      maxWidth,
    );
    draggingWidth = startWidth;
    splitterEl?.setAttribute('data-resizing', 'true');
    const prevCursor = doc.body?.style.cursor ?? '';
    const prevUserSelect = doc.body?.style.userSelect ?? '';
    if (doc.body) {
      doc.body.style.cursor = 'col-resize';
      doc.body.style.userSelect = 'none';
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const currentContentWidth = readContentWidth();
      const { clamped } = clampTwoColumnFilterWidth(
        startWidth + delta,
        currentContentWidth,
        maxWidth,
      );
      draggingWidth = clamped;
      doc.documentElement.style.setProperty(TWO_COLUMN_WIDTH_VAR, `${clamped}px`);
      const maxWidthPx = resolveTwoColumnMaxWidthPx(maxWidth);
      const effectiveContainerWidth =
        maxWidthPx !== null ? Math.min(currentContentWidth, maxWidthPx) : currentContentWidth;
      const nextResultsWidth = Math.max(
        0,
        Math.floor(effectiveContainerWidth - clamped - TWO_COLUMN_COLUMN_GAP),
      );
      syncResponsiveBreakpointAttrs(clamped, nextResultsWidth);
    };

    const finishDrag = (commit: boolean) => {
      const finalWidth = draggingWidth;
      stopActiveDrag();
      splitterEl?.removeAttribute('data-resizing');
      if (doc.body) {
        doc.body.style.cursor = prevCursor;
        doc.body.style.userSelect = prevUserSelect;
      }
      if (commit && finalWidth !== null && finalWidth !== preferredFilterWidth) {
        preferredFilterWidth = finalWidth;
        onFilterWidthCommit?.(finalWidth);
      }
      sync();
    };

    const handleUp = () => finishDrag(true);
    const handleCancel = () => finishDrag(false);

    win.addEventListener('pointermove', handleMove);
    win.addEventListener('pointerup', handleUp);
    win.addEventListener('pointercancel', handleCancel);
    activeDragCleanup = () => {
      win.removeEventListener('pointermove', handleMove);
      win.removeEventListener('pointerup', handleUp);
      win.removeEventListener('pointercancel', handleCancel);
    };
  };

  const ensureSplitterMounted = () => {
    const topEl = doc.querySelector<HTMLElement>('#trade > .top');
    if (!topEl) {
      detachSplitter();
      return;
    }
    if (splitterEl && splitterEl.parentElement === topEl) {
      updateControlsLocale();
      return;
    }
    detachSplitter();

    const splitter = doc.createElement('div');
    splitter.className = TWO_COLUMN_SPLITTER_CLASS;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'vertical');

    const collapseBtn = doc.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = TWO_COLUMN_COLLAPSE_BTN_CLASS;
    collapseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      filtersCollapsed = !filtersCollapsed;
      sync();
    });

    splitter.addEventListener('pointerdown', startResizeDrag);
    splitter.addEventListener('dblclick', (event) => {
      if ((event.target as Element | null)?.closest(`.${TWO_COLUMN_COLLAPSE_BTN_CLASS}`)) return;
      event.preventDefault();
      if (filtersCollapsed) {
        filtersCollapsed = false;
      } else {
        preferredFilterWidth = TWO_COLUMN_DEFAULT_FILTER_WIDTH;
        onFilterWidthCommit?.(TWO_COLUMN_DEFAULT_FILTER_WIDTH);
      }
      sync();
    });
    splitter.addEventListener('click', (event) => {
      if (!filtersCollapsed) return;
      if ((event.target as Element | null)?.closest(`.${TWO_COLUMN_COLLAPSE_BTN_CLASS}`)) return;
      event.preventDefault();
      filtersCollapsed = false;
      sync();
    });

    splitter.appendChild(collapseBtn);
    topEl.appendChild(splitter);
    splitterEl = splitter;
    collapseBtnEl = collapseBtn;
    updateControlsLocale();
  };

  const observeHostContainers = () => {
    const contentEl = doc.querySelector('.content');
    if (contentEl && contentEl !== observedContentEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => {
        if (!disposed) sync();
      });
      resizeObserver.observe(contentEl);
      observedContentEl = contentEl;
    }

    if (typeof MutationObserver === 'undefined') return;

    const tradeEl = doc.querySelector('#trade');
    if (tradeEl) {
      if (bootstrapObserver) {
        bootstrapObserver.disconnect();
        bootstrapObserver = null;
      }
      if (tradeEl !== observedTradeEl) {
        tradeObserver?.disconnect();
        tradeObserver = new MutationObserver(() => {
          if (!disposed) sync();
        });
        tradeObserver.observe(tradeEl, { childList: true });
        observedTradeEl = tradeEl;
      }
      const portalEl = tradeEl.querySelector('#vue3-portal');
      if (portalEl && portalEl !== observedPortalEl) {
        portalObserver?.disconnect();
        portalObserver = new MutationObserver(() => {
          if (!disposed) ensureResultsBridgeMounted();
        });
        portalObserver.observe(portalEl, { childList: true });
        observedPortalEl = portalEl;
      }
    } else if (!bootstrapObserver && doc.body) {
      bootstrapObserver = new MutationObserver(() => {
        if (!disposed && doc.querySelector('#trade')) {
          sync();
        }
      });
      bootstrapObserver.observe(doc.body, { childList: true, subtree: true });
    }
  };

  const attachListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;

    const handleSync = () => {
      if (!disposed) sync();
    };
    win.addEventListener('resize', handleSync);
    win.addEventListener('popstate', handleSync);
    const stopHistory = listenPoeEvent('poexd-history-changed', handleSync);
    const stopCollapsed = listenPoeEvent('poexd-sidebar-collapsed-changed', handleSync);
    const stopWidthPreview = listenPoeEvent('poexd-sidebar-width-preview', handleSync);

    eventCleanups = [
      () => win.removeEventListener('resize', handleSync),
      () => win.removeEventListener('popstate', handleSync),
      stopHistory,
      stopCollapsed,
      stopWidthPreview,
    ];
  };

  const detachListeners = () => {
    if (!listenersAttached) return;
    listenersAttached = false;
    eventCleanups.forEach((fn) => fn());
    eventCleanups = [];
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedContentEl = null;
    tradeObserver?.disconnect();
    tradeObserver = null;
    observedTradeEl = null;
    portalObserver?.disconnect();
    portalObserver = null;
    observedPortalEl = null;
    bootstrapObserver?.disconnect();
    bootstrapObserver = null;
  };

  const clearHostState = () => {
    setRootAttr(TWO_COLUMN_ATTR, null);
    setRootAttr(TWO_COLUMN_COLLAPSED_ATTR, null);
    setRootAttr(TWO_COLUMN_HIDE_HEADER_ATTR, null);
    setRootAttr(TWO_COLUMN_HEADER_OPEN_ATTR, null);
    clearResponsiveBreakpointAttrs();
    doc.documentElement.style.removeProperty(TWO_COLUMN_WIDTH_VAR);
    doc.documentElement.style.removeProperty(TWO_COLUMN_MAX_WIDTH_VAR);
    detachSplitter();
    detachHeaderControls();
    detachResultsBridge();
  };

  const sync = (): TwoColumnGeometry => {
    if (disposed || !enabled) {
      clearHostState();
      removeStyle();
      detachListeners();
      return resolveTwoColumnGeometry({
        enabled: false,
        pageRole,
        pathname: readPathname(),
        contentWidth: 0,
        preferredFilterWidth,
        maxWidth,
        filtersCollapsed: false,
      });
    }

    attachListeners();
    observeHostContainers();

    const hasSearchPanel = Boolean(doc.querySelector('#trade > .top > .search-panel'));
    const geometry = resolveTwoColumnGeometry({
      enabled: enabled && hasSearchPanel,
      pageRole,
      pathname: readPathname(),
      contentWidth: readContentWidth(),
      preferredFilterWidth: draggingWidth ?? preferredFilterWidth,
      maxWidth,
      filtersCollapsed,
    });

    if (!geometry.active) {
      clearHostState();
      return geometry;
    }

    ensureStyle();
    setRootAttr(TWO_COLUMN_ATTR, 'active');
    setRootAttr(TWO_COLUMN_COLLAPSED_ATTR, geometry.filtersCollapsed ? 'true' : null);
    doc.documentElement.style.setProperty(TWO_COLUMN_WIDTH_VAR, `${geometry.leftWidth}px`);
    doc.documentElement.style.setProperty(TWO_COLUMN_MAX_WIDTH_VAR, geometry.maxWidthCss);
    syncResponsiveBreakpointAttrs(geometry.leftWidth, geometry.resultsWidth);
    ensureSplitterMounted();
    ensureHeaderControlsMounted();
    ensureResultsBridgeMounted();
    return geometry;
  };

  return {
    applyConfig(config: TwoColumnLayoutConfig): TwoColumnGeometry {
      if (config.pageRole !== undefined) pageRole = config.pageRole;
      if (
        config.preferredFilterWidth !== undefined &&
        Number.isFinite(config.preferredFilterWidth)
      ) {
        preferredFilterWidth = config.preferredFilterWidth;
      }
      if (config.maxWidth !== undefined) maxWidth = config.maxWidth;
      if (config.autoHideHeader !== undefined) autoHideHeader = config.autoHideHeader;
      if (config.enabled !== undefined) {
        enabled = config.enabled;
        if (!enabled) filtersCollapsed = false;
      }
      return sync();
    },
    refreshLocale() {
      updateControlsLocale();
    },
    sync,
    cleanup() {
      disposed = true;
      enabled = false;
      clearHostState();
      removeStyle();
      detachListeners();
    },
  };
}
