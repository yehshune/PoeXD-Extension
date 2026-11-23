import { createSvgIcon, type SvgIconSpec } from '@/utils/safe-dom';
import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradePageMode,
  isLiveOrConsoleTradePage,
  type TradePageMode,
} from '@/utils/trade-page-mode';
import type { TradePageRole } from '@/utils/live-search-contract';
import { parsePoeFetchResultBatch } from '@/utils/event-contracts';
import type { ResultPricePresenter } from './result-price-presenter';
import { t } from '@/utils/i18n';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';

export type SortMode =
  | 'default'
  | 'price_asc'
  | 'price_desc'
  | 'potential_dps'
  | 'potential_pdps'
  | 'potential_edps'
  | 'potential_def'
  | 'potential_armour'
  | 'potential_evasion'
  | 'potential_es'
  | 'cp_ratio';

export interface SortExtraControlOption {
  key: string;
  label: string;
  onSelect: () => void;
}

export interface SortExtraControl {
  readonly type: 'weapon' | 'armour';
  getIcon(): SvgIconSpec;
  getTitle(): string;
  getHeader(): string;
  getOptions(): SortExtraControlOption[];
  getState(): {
    currentKey: string;
    titleText: string;
    headerText: string;
    isActive: boolean;
  };
}

export interface SortStatProvider {
  isActive(): boolean;
  getSortMetric(mode: SortMode, id: string): number | undefined;
  getLeadingControls(): SortExtraControl[];
}

const MISSING_ORIGINAL_INDEX = Number.MAX_SAFE_INTEGER;

const PRICE_DEPENDENT_SORT_MODES: ReadonlySet<SortMode> = new Set<SortMode>([
  'price_asc',
  'price_desc',
  'cp_ratio',
]);

const STAT_DEPENDENT_SORT_MODES: ReadonlySet<SortMode> = new Set<SortMode>([
  'potential_dps',
  'potential_pdps',
  'potential_edps',
  'potential_def',
  'potential_armour',
  'potential_evasion',
  'potential_es',
  'cp_ratio',
]);

function isPurePriceSortMode(mode: SortMode): mode is 'price_asc' | 'price_desc' {
  return mode === 'price_asc' || mode === 'price_desc';
}

function isPriceDependentSortMode(mode: SortMode): boolean {
  return PRICE_DEPENDENT_SORT_MODES.has(mode);
}

function isStatDependentSortMode(mode: SortMode): boolean {
  return STAT_DEPENDENT_SORT_MODES.has(mode);
}

const SORT_SVG: SvgIconSpec = {
  attrs: {
    width: '15',
    height: '15',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  },
  paths: ['m3 16 4 4 4-4', 'M7 20V4', 'm21 8-4-4-4 4', 'M17 4v16'],
};

const STYLE_ID = 'poexd-result-sort-controls-style';

/** 官方結果列上可點擊排序的欄位（詞綴、報價、物品等級等），點下去官方會帶新的 sort 重新查詢 */
const OFFICIAL_SORT_FIELD_SELECTOR = `${TRADE_RESULTS_SELECTOR} .row .s[data-field]`;

function getSortModeOptions(includeStatModes: boolean): Array<{
  key: SortMode;
  label: string;
}> {
  const base: Array<{ key: SortMode; label: string }> = [
    { key: 'default', label: t('normalizer.sort.default') },
    { key: 'price_asc', label: t('normalizer.sort.price_asc') },
    { key: 'price_desc', label: t('normalizer.sort.price_desc') },
  ];
  if (!includeStatModes) {
    return base;
  }
  return [
    ...base,
    { key: 'potential_dps', label: t('normalizer.sort.potential_dps') },
    { key: 'potential_pdps', label: t('normalizer.sort.potential_pdps') },
    { key: 'potential_edps', label: t('normalizer.sort.potential_edps') },
    { key: 'potential_def', label: t('normalizer.sort.potential_def') },
    { key: 'potential_armour', label: t('normalizer.sort.potential_armour') },
    { key: 'potential_evasion', label: t('normalizer.sort.potential_evasion') },
    { key: 'potential_es', label: t('normalizer.sort.potential_es') },
    { key: 'cp_ratio', label: t('normalizer.sort.cp_ratio') },
  ];
}

export class ResultSortController {
  private enabled = true;
  private pageMode: TradePageMode = typeof window !== 'undefined' ? getTradePageMode() : 'search';
  private pageRole: TradePageRole = 'normal';
  private activeSearchId?: string;
  private originalOrder: string[] = [];
  private hasReorderedDom = false;
  private sortMode: SortMode = 'default';
  private statProvider?: SortStatProvider;
  private unsubRates?: () => void;
  private recentlyMovedRows = new Set<Element>();
  private hasRegisteredGlobalClick = false;
  public isReordering = false;

  constructor(
    private readonly version: PoeVersion,
    private readonly pricePresenter?: ResultPricePresenter,
    statProvider?: SortStatProvider,
  ) {
    this.statProvider = statProvider;
    if (typeof pricePresenter?.onRatesUpdated === 'function') {
      this.unsubRates = pricePresenter.onRatesUpdated(() => this.handleRatesUpdated());
    }
  }

  registerStatProvider(provider: SortStatProvider) {
    this.statProvider = provider;
  }

  public isRecentlyMovedRow(node: Node): boolean {
    return this.recentlyMovedRows.has(node as Element);
  }

  public isLiveOrConsole(): boolean {
    return isLiveOrConsoleTradePage(this.pageMode, this.pageRole);
  }

  private hasActiveStats(): boolean {
    return this.version === 'poe2' && Boolean(this.statProvider?.isActive());
  }

  private isFeatureActive(): boolean {
    if (!this.enabled || this.isLiveOrConsole()) return false;
    if (this.version === 'poe1') {
      return Boolean(this.pricePresenter?.isEnabled());
    }
    return this.hasActiveStats() || Boolean(this.pricePresenter?.isEnabled());
  }

  private handleRatesUpdated() {
    if (!this.isFeatureActive() || !isPriceDependentSortMode(this.sortMode)) return;
    const root = getResultsRoot();
    if (root) {
      this.reorderDomRows(root);
    }
  }

  onMetricsChanged() {
    if (!this.isFeatureActive()) return;
    this.updateControlsState();
    const root = getResultsRoot();
    if (root) {
      this.reorderDomRows(root);
    }
  }

  /** 新一次搜尋（即使與前一次同 searchId）：清空舊一輪的官方順序，避免 default 模式覆寫最新官方 DOM */
  handleSearchQuery(searchId: string) {
    if (this.isLiveOrConsole()) return;
    const isNewSearchId = searchId !== this.activeSearchId;
    this.activeSearchId = searchId;
    this.originalOrder = [];
    this.hasReorderedDom = false;
    if (isNewSearchId) {
      removeSortControls();
    }
  }

  handleFetchResponse(detail: string) {
    if (this.isLiveOrConsole()) return;
    const batch = parsePoeFetchResultBatch(detail);
    if (!batch?.searchId) return;
    const { searchId, results } = batch;

    if (searchId !== this.activeSearchId) {
      this.activeSearchId = searchId;
      this.originalOrder = [];
      this.hasReorderedDom = false;
      removeSortControls();
    }

    results.forEach((res) => {
      if (!res || typeof res !== 'object') return;
      const { id } = res as { id?: unknown };
      if (typeof id === 'string' && !this.originalOrder.includes(id)) {
        this.originalOrder.push(id);
      }
    });

    const root = getResultsRoot();
    if (root && this.isFeatureActive()) {
      this.apply(root);
    }
  }

  private deactivateAndRestore() {
    const root = getResultsRoot();
    if (root) this.restoreOriginalDomOrder(root);
    removeSortControls();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.isFeatureActive()) {
      this.deactivateAndRestore();
      return;
    }
    const root = getResultsRoot();
    if (root) this.apply(root);
  }

  syncSupport() {
    if (!this.isFeatureActive()) {
      this.deactivateAndRestore();
      return;
    }

    const priceDisabled = Boolean(this.pricePresenter && !this.pricePresenter.isEnabled());
    const statsDisabled = !this.hasActiveStats();
    if (
      (priceDisabled && isPriceDependentSortMode(this.sortMode)) ||
      (statsDisabled && isStatDependentSortMode(this.sortMode))
    ) {
      this.restoreOriginalDomOrder();
    }

    const root = getResultsRoot();
    if (root) {
      this.apply(root);
    } else {
      this.updateControlsState();
    }
  }

  private restoreOriginalDomOrder(container?: Element | null) {
    this.sortMode = 'default';
    if (this.originalOrder.length === 0) return;
    const root = container || getResultsRoot();
    if (root) {
      this.reorderDomRows(root);
    }
    this.originalOrder = [];
  }

  private resetForLiveOrConsole() {
    this.restoreOriginalDomOrder();
    removeSortControls();
  }

  setPageRole(role: TradePageRole) {
    if (role === this.pageRole) return;
    this.pageRole = role;
    if (this.isLiveOrConsole()) {
      this.resetForLiveOrConsole();
    }
  }

  setPageMode(mode: TradePageMode) {
    if (mode === this.pageMode) return;
    this.pageMode = mode;
    if (this.isLiveOrConsole()) {
      this.resetForLiveOrConsole();
    }
  }

  setSortMode(mode: SortMode) {
    if (!this.isFeatureActive()) return;
    if (
      isPriceDependentSortMode(mode) &&
      (!this.pricePresenter || !this.pricePresenter.isEnabled())
    ) {
      return;
    }
    if (isStatDependentSortMode(mode) && !this.hasActiveStats()) {
      return;
    }
    this.sortMode = mode;
    this.updateControlsState();
    const root = getResultsRoot();
    if (root) {
      this.reorderDomRows(root);
    }
  }

  apply(_container: Element) {
    if (!this.isFeatureActive() || this.isReordering) {
      if (this.isLiveOrConsole()) {
        removeSortControls();
      }
      return;
    }

    this.ensureRowTotalControls();

    const resultsRoot = getResultsRoot();
    if (resultsRoot) {
      this.reorderDomRows(resultsRoot);
    }

    ensureSortControlsStyle();
  }

  applyBatch(rows: Element[]) {
    if (rows.length === 0) return;
    this.apply(rows[0]);
  }

  refreshLocale() {
    if (!this.isFeatureActive()) return;
    this.updateControlsState();
    const root = getResultsRoot();
    if (root) {
      this.apply(root);
    }
  }

  cleanup() {
    this.unsubRates?.();
    this.unsubRates = undefined;
    this.recentlyMovedRows.clear();
    this.restoreOriginalDomOrder();
    this.enabled = false;
    this.isReordering = false;
    this.activeSearchId = undefined;
    this.originalOrder = [];
    removeSortControls();
    this.unregisterGlobalClick();
    document.getElementById(STYLE_ID)?.remove();

    const root =
      typeof document !== 'undefined'
        ? (document.querySelector(TRADE_RESULTS_SELECTOR) as HTMLElement | null)
        : null;
    if (root) {
      root.style.display = '';
      root.style.flexDirection = '';
      const rows = resultRows(root);
      const rowsContainer = getRowsContainer(root);
      if (rowsContainer) {
        rowsContainer.style.display = '';
        rowsContainer.style.flexDirection = '';
        Array.from(rowsContainer.children).forEach((child) => {
          (child as HTMLElement).style.order = '';
        });
      }
      rows.forEach((r) => {
        (r as HTMLElement).style.order = '';
      });
    }
  }

  private ensureRowTotalControls() {
    const rowTotal = document.querySelector('.row.row-total');
    const resultsContainer = document.querySelector(TRADE_RESULTS_SELECTOR);
    const targetParent = rowTotal || resultsContainer;
    if (!targetParent) return;

    const includeStats = this.hasActiveStats();
    const expectedStatsFlag = includeStats ? '1' : '0';

    let controls = document.querySelector('.poexd-total-controls') as HTMLElement | null;
    if (
      controls &&
      ((controls.dataset?.poexdVersion && controls.dataset.poexdVersion !== this.version) ||
        (controls.dataset?.poexdHasStats && controls.dataset.poexdHasStats !== expectedStatsFlag))
    ) {
      controls.remove();
      controls = null;
    }

    if (!controls) {
      controls = this.buildRowTotalControls(includeStats);
      if (rowTotal) {
        rowTotal.prepend(controls);
      } else if (resultsContainer) {
        resultsContainer.insertAdjacentElement('beforebegin', controls);
      }
    } else if (rowTotal && controls.parentElement !== rowTotal) {
      rowTotal.prepend(controls);
    }

    if (rowTotal) syncWithNativeLayoutButtons(controls, rowTotal);
    this.registerGlobalClick();
    this.updateControlsState();
  }

  private readonly globalClickHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.poexd-btn-wrapper')) {
      document.querySelectorAll('.poexd-popover.poexd-open').forEach((el) => {
        el.classList.remove('poexd-open');
      });
    }
  };

  /**
   * 使用者點官方排序欄位代表要改用官方排序：擴充排序退回 default，
   * 並清空原始順序，讓官方重新查詢後的 fetch 順序成為新的基準（searchId 可能不變）。
   */
  private readonly officialSortClickHandler = (e: MouseEvent) => {
    if (this.sortMode === 'default' || !this.isFeatureActive()) return;
    const target = e.target as Element | null;
    if (!target?.closest?.(OFFICIAL_SORT_FIELD_SELECTOR)) return;
    this.sortMode = 'default';
    this.originalOrder = [];
    this.updateControlsState();
  };

  private registerGlobalClick() {
    if (this.hasRegisteredGlobalClick) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.hasRegisteredGlobalClick = true;
    document.addEventListener('click', this.globalClickHandler);
    document.addEventListener('click', this.officialSortClickHandler, true);
  }

  private unregisterGlobalClick() {
    if (!this.hasRegisteredGlobalClick) return;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this.globalClickHandler);
      document.removeEventListener('click', this.officialSortClickHandler, true);
    }
    this.hasRegisteredGlobalClick = false;
  }

  private buildRowTotalControls(includeStats: boolean): HTMLElement {
    const container = document.createElement('div');
    container.className = 'poexd-total-controls';
    if (container.dataset) {
      container.dataset.poexdVersion = this.version;
      container.dataset.poexdHasStats = includeStats ? '1' : '0';
    }

    if (includeStats && this.statProvider) {
      for (const extra of this.statProvider.getLeadingControls()) {
        container.appendChild(
          this.createControlDropdown(
            extra.type,
            extra.getIcon(),
            extra.getTitle(),
            extra.getHeader(),
            extra.getOptions(),
          ),
        );
      }
    }

    const sortItems = getSortModeOptions(includeStats).map((opt) => ({
      key: opt.key,
      label: opt.label,
      onSelect: () => this.setSortMode(opt.key),
    }));
    container.appendChild(
      this.createControlDropdown(
        'sort',
        SORT_SVG,
        t('normalizer.btn.sortTitle'),
        t('normalizer.btn.sortHeader'),
        sortItems,
      ),
    );

    return container;
  }

  private createControlDropdown(
    type: 'weapon' | 'armour' | 'sort',
    svgIcon: SvgIconSpec,
    title: string,
    headerText: string,
    items: Array<{ key: string; label: string; onSelect: () => void }>,
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `poexd-btn-wrapper poexd-${type}-wrapper`;
    wrapper.setAttribute('data-control', type);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `poexd-icon-btn poexd-${type}-btn`;
    btn.setAttribute('title', title);
    btn.appendChild(createSvgIcon(svgIcon));

    const popover = document.createElement('div');
    popover.className = `poexd-popover poexd-${type}-popover`;

    const header = document.createElement('div');
    header.className = 'poexd-popover-header';
    header.textContent = headerText;
    popover.appendChild(header);

    for (const item of items) {
      const itemEl = document.createElement('div');
      itemEl.className = 'poexd-popover-item';
      itemEl.setAttribute('data-value', item.key);
      const labelEl = document.createElement('span');
      labelEl.textContent = item.label;
      const checkMark = document.createElement('span');
      checkMark.className = 'poexd-check-mark';
      itemEl.append(labelEl, checkMark);
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        item.onSelect();
        popover.classList.remove('poexd-open');
      });
      popover.appendChild(itemEl);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = popover.classList.contains('poexd-open');
      document.querySelectorAll('.poexd-popover.poexd-open').forEach((el) => {
        el.classList.remove('poexd-open');
      });
      if (!isOpen) {
        popover.classList.add('poexd-open');
      }
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(popover);
    return wrapper;
  }

  private updateControlState(
    controls: Element,
    type: 'weapon' | 'armour' | 'sort',
    currentKey: string,
    options: Array<{ key: string; label: string }>,
    titleText: string,
    headerText: string,
    isActive: boolean,
    hiddenKeys?: ReadonlySet<string>,
  ) {
    const btn = controls.querySelector(`.poexd-${type}-btn`) as HTMLElement | null;
    if (btn) {
      btn.setAttribute('title', titleText);
      btn.classList.toggle('poexd-active', isActive);
    }
    const header = controls.querySelector(`.poexd-${type}-popover .poexd-popover-header`);
    if (header) {
      header.textContent = headerText;
    }
    controls.querySelectorAll(`.poexd-${type}-popover .poexd-popover-item`).forEach((item) => {
      const val = item.getAttribute('data-value');
      const isHidden = Boolean(hiddenKeys && val && hiddenKeys.has(val as SortMode));
      const htmlItem = item as HTMLElement;
      if (htmlItem.style) {
        htmlItem.style.display = isHidden ? 'none' : '';
      }
      const isSelected = val === currentKey;
      item.classList.toggle('poexd-selected', isSelected);
      const opt = options.find((o) => o.key === val);
      const textSpan = item.querySelector('span');
      if (textSpan && opt) {
        textSpan.textContent = opt.label;
      }
      const check = item.querySelector('.poexd-check-mark');
      if (check) check.textContent = isSelected ? '✓' : '';
    });
  }

  private updateControlsState() {
    const controls = document.querySelector('.poexd-total-controls');
    if (!controls) return;

    const includeStats = this.hasActiveStats();
    if (includeStats && this.statProvider) {
      for (const extra of this.statProvider.getLeadingControls()) {
        const state = extra.getState();
        this.updateControlState(
          controls,
          extra.type,
          state.currentKey,
          extra.getOptions(),
          state.titleText,
          state.headerText,
          state.isActive,
        );
      }
    }

    const sortOptions = getSortModeOptions(includeStats);
    const currentSortOpt = sortOptions.find((o) => o.key === this.sortMode);
    const hiddenSortKeys =
      !this.pricePresenter || !this.pricePresenter.isEnabled()
        ? PRICE_DEPENDENT_SORT_MODES
        : undefined;
    this.updateControlState(
      controls,
      'sort',
      this.sortMode,
      sortOptions,
      t('normalizer.activeSort', { label: currentSortOpt?.label || '' }),
      t('normalizer.btn.sortHeader'),
      this.sortMode !== 'default',
      hiddenSortKeys,
    );
  }

  /**
   * 真實 DOM 物理排序
   * 絕不修改容器的 display 與 flexDirection，100% 完整相容官方 layout-immersion、compact 與 compact-two 排版。
   * 透過 isReordering 與 recentlyMovedRows 避免 MutationObserver 重入，並保留 Vue 未載入佔位註解位置。
   */
  private reorderDomRows(container: Element) {
    if (this.isReordering) return;
    if (this.isLiveOrConsole() && this.originalOrder.length === 0) return;
    if (
      isPriceDependentSortMode(this.sortMode) &&
      (!this.pricePresenter || !this.pricePresenter.isEnabled())
    ) {
      return;
    }
    if (isStatDependentSortMode(this.sortMode) && !this.hasActiveStats()) {
      return;
    }
    const rows = resultRows(container);
    if (rows.length === 0) return;

    const rowsContainer = getRowsContainer(container);

    // 清理先前可能殘留之 display / flex / order 行內樣式，確保官方原生版型 100% 生效
    if (rowsContainer.style.display || rowsContainer.style.flexDirection) {
      rowsContainer.style.display = '';
      rowsContainer.style.flexDirection = '';
    }
    const htmlContainer = container as HTMLElement;
    if (htmlContainer.style.display || htmlContainer.style.flexDirection) {
      htmlContainer.style.display = '';
      htmlContainer.style.flexDirection = '';
    }
    rows.forEach((row) => {
      if ((row as HTMLElement).style.order) {
        (row as HTMLElement).style.order = '';
      }
    });

    let sortedRows: Element[] = [];

    if (this.sortMode !== 'default' && this.originalOrder.length === 0) {
      for (const row of rows) {
        const id = resolveRowId(row);
        if (id && !this.originalOrder.includes(id)) {
          this.originalOrder.push(id);
        }
      }
    }

    if (this.sortMode === 'default') {
      if (!this.hasReorderedDom) return;
      const orderIndexMap = new Map<string, number>();
      this.originalOrder.forEach((id, index) => orderIndexMap.set(id, index));
      const items = rows.map((row) => {
        const id = resolveRowId(row);
        const idx = orderIndexMap.get(id);
        return { row, idx: idx !== undefined ? idx : MISSING_ORIGINAL_INDEX };
      });
      items.sort((a, b) => a.idx - b.idx);
      sortedRows = items.map((i) => i.row);
      this.hasReorderedDom = false;
    } else if (isPurePriceSortMode(this.sortMode)) {
      this.hasReorderedDom = true;
      const direction = this.sortMode === 'price_asc' ? 'asc' : 'desc';
      const items = rows.map((row) => {
        const id = resolveRowId(row);
        const price = this.pricePresenter?.getPrimaryPrice(id);
        const val =
          typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined;
        return { row, val };
      });
      items.sort((a, b) => compareNullablePriceValues(a.val, b.val, direction));
      sortedRows = items.map((i) => i.row);
    } else {
      this.hasReorderedDom = true;
      const items = rows.map((row) => {
        const id = resolveRowId(row);
        const rawStat = this.statProvider?.getSortMetric(this.sortMode, id);
        let val = rawStat;
        if (this.sortMode === 'cp_ratio' && rawStat !== undefined) {
          const price = this.pricePresenter?.getPrimaryPrice(id);
          val =
            typeof price === 'number' && Number.isFinite(price) && price > 0 ? rawStat / price : 0;
        }
        return { row, val };
      });
      items.sort((a, b) => compareOptionalMetricDesc(a.val, b.val));
      sortedRows = items.map((i) => i.row);
    }

    const rowSet = new Set(rows);
    const containerChildren = Array.from(rowsContainer.children);
    const currentDomRows = containerChildren.filter((c) => rowSet.has(c));
    const isAlreadySorted =
      currentDomRows.length === sortedRows.length &&
      sortedRows.every((r, idx) => currentDomRows[idx] === r);
    if (isAlreadySorted) return;

    const sentinel = containerChildren.find((child) => {
      if (rowSet.has(child)) return false;
      return (
        child.matches?.('.controls') ||
        child.querySelector?.('.load-more-btn') ||
        child.className?.includes?.('controls') ||
        child.className?.includes?.('load-more')
      );
    });

    const lastCurrentRow = currentDomRows[currentDomRows.length - 1];
    const sentinelIdx = sentinel ? containerChildren.indexOf(sentinel) : -1;
    const lastRowIdx = lastCurrentRow ? containerChildren.indexOf(lastCurrentRow) : -1;
    const sentinelIsAfterRows = sentinelIdx === -1 || sentinelIdx > lastRowIdx;
    const endAnchor: Node | null =
      sentinelIsAfterRows && lastCurrentRow && 'nextSibling' in lastCurrentRow
        ? (lastCurrentRow as ChildNode).nextSibling
        : (sentinel ?? null);

    const currentIndexByRow = new Map<Element, number>();
    currentDomRows.forEach((row, index) => currentIndexByRow.set(row, index));
    const targetIndices = sortedRows.map((row) => currentIndexByRow.get(row) ?? -1);
    const keepInPlace = sentinelIsAfterRows
      ? computeLongestIncreasingPositions(targetIndices)
      : new Set<number>();

    const movedRows: Element[] = [];
    this.isReordering = true;
    try {
      let nextAnchor: Node | null = endAnchor;
      for (let i = sortedRows.length - 1; i >= 0; i--) {
        const row = sortedRows[i];
        if (!keepInPlace.has(i)) {
          if (typeof rowsContainer.insertBefore === 'function') {
            rowsContainer.insertBefore(row, nextAnchor);
          } else {
            rowsContainer.appendChild(row);
          }
          movedRows.push(row);
          this.recentlyMovedRows.add(row);
        }
        nextAnchor = row;
      }
    } finally {
      this.isReordering = false;
      if (movedRows.length > 0) {
        queueMicrotask(() => {
          for (const row of movedRows) {
            this.recentlyMovedRows.delete(row);
          }
        });
      }
    }
  }
}

function compareNullablePriceValues(
  a: number | undefined,
  b: number | undefined,
  direction: 'asc' | 'desc',
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return direction === 'asc' ? a - b : b - a;
}

function getRowsContainer(container: Element): HTMLElement {
  const firstRow = container.querySelector('.row[data-id], .row[id]');
  if (firstRow && firstRow.parentElement && container.contains(firstRow.parentElement)) {
    return firstRow.parentElement as HTMLElement;
  }
  return container as HTMLElement;
}

export function resultRows(container: Element): Element[] {
  const rows = Array.from(container.querySelectorAll('.row[data-id], .row[id]')).filter(
    (r) => !r.matches?.('.row-total, .controls'),
  );
  if (
    container.matches?.('.row[data-id], .row[id]') &&
    !container.matches?.('.row-total, .controls')
  ) {
    rows.unshift(container);
  }
  return rows;
}

function resolveRowId(row: Element): string {
  return row.getAttribute('data-id') || row.getAttribute('id') || '';
}

export function getResultsRoot(): Element | null {
  return typeof document !== 'undefined' ? document.querySelector(TRADE_RESULTS_SELECTOR) : null;
}

function compareOptionalMetricDesc(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}

function removeSortControls() {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll('.poexd-results-toolbar, .poexd-total-controls')
    .forEach((el) => el.remove());
}

function syncWithNativeLayoutButtons(controls: HTMLElement, rowTotal: Element) {
  if (controls.dataset?.poexdLayoutSynced === '1') return;
  const nativeBtn = rowTotal.querySelector<HTMLElement>('.layout-btn');
  if (!nativeBtn) return;
  const size = nativeBtn.offsetHeight;
  if (!Number.isFinite(size) || size < 16 || size > 64) return;
  const top = Number.isFinite(nativeBtn.offsetTop) ? nativeBtn.offsetTop : 0;
  const sizeValue = `${size}px`;
  const topValue = `${top}px`;
  if (controls.style.getPropertyValue('--poexd-native-btn-size') !== sizeValue) {
    controls.style.setProperty('--poexd-native-btn-size', sizeValue);
  }
  if (controls.style.getPropertyValue('--poexd-native-btn-top') !== topValue) {
    controls.style.setProperty('--poexd-native-btn-top', topValue);
  }
  if (controls.dataset) {
    controls.dataset.poexdLayoutSynced = '1';
  }
}

function computeLongestIncreasingPositions(values: number[]): Set<number> {
  const n = values.length;
  const tails: number[] = [];
  const tailPos: number[] = [];
  const prevPos = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const val = values[i];
    if (val < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = val;
    tailPos[lo] = i;
    if (lo > 0) prevPos[i] = tailPos[lo - 1];
  }

  const kept = new Set<number>();
  let cur = tailPos.length > 0 ? tailPos[tailPos.length - 1] : -1;
  while (cur !== -1) {
    kept.add(cur);
    cur = prevPos[cur];
  }
  return kept;
}

function ensureSortControlsStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .poexd-total-controls {
      --poexd-fx-bg: oklch(0.19 0.005 250 / 0.92);
      --poexd-fx-surface: oklch(0.235 0.005 250 / 0.96);
      --poexd-fx-surface-hover: oklch(0.295 0.006 250);
      --poexd-fx-border: oklch(0.387 0 0);
      --poexd-fx-border-strong: oklch(0.52 0.04 76);
      --poexd-fx-fg: oklch(0.913 0 0);
      --poexd-fx-gold: oklch(0.858 0.068 82.8);
      --poexd-fx-muted: oklch(0.67 0.048 76);
      --poexd-fx-primary: oklch(0.45 0.075 268);
      --poexd-fx-primary-bg: oklch(0.295 0.062 246 / 0.96);
      --poexd-fx-primary-bg-hover: oklch(0.345 0.075 246);
      --poexd-fx-accent-fg: oklch(0.95 0.025 82);
      --poexd-fx-radius: 0px;
      --poexd-fx-font: Verdana, Arial, Helvetica, sans-serif;
      --poexd-fx-font-display: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif;
      --poexd-native-btn-size: 30px;
      --poexd-native-btn-top: 0px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      z-index: 50;
      margin: 0 12px 0 0;
      flex-shrink: 0;
      font-family: var(--poexd-fx-font);
      line-height: 1;
    }
    .row.row-total > .poexd-total-controls {
      position: absolute;
      top: var(--poexd-native-btn-top);
      left: 8px;
      height: var(--poexd-native-btn-size);
      margin: 0;
    }
    .poexd-total-controls .poexd-btn-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      height: 100%;
    }
    .poexd-total-controls .poexd-icon-btn {
      all: unset;
      box-sizing: border-box;
      width: var(--poexd-native-btn-size);
      height: var(--poexd-native-btn-size);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--poexd-fx-bg);
      border: 1px solid oklch(0.35 0.018 76 / 0.85);
      border-radius: var(--poexd-fx-radius);
      color: var(--poexd-fx-muted);
      cursor: pointer;
      box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
      transition:
        background-color 0.12s ease,
        border-color 0.12s ease,
        color 0.12s ease;
    }
    .poexd-total-controls .poexd-icon-btn:hover {
      background: var(--poexd-fx-surface-hover);
      border-color: var(--poexd-fx-border-strong);
      color: var(--poexd-fx-gold);
    }
    .poexd-total-controls .poexd-icon-btn:focus-visible {
      outline: 1px solid var(--poexd-fx-gold);
      outline-offset: 1px;
    }
    .poexd-total-controls .poexd-icon-btn.poexd-active {
      background: var(--poexd-fx-primary-bg);
      border-color: var(--poexd-fx-primary);
      color: var(--poexd-fx-gold);
    }
    .poexd-total-controls .poexd-icon-btn.poexd-active:hover {
      background: var(--poexd-fx-primary-bg-hover);
      border-color: oklch(0.58 0.085 268);
      color: var(--poexd-fx-accent-fg);
    }
    .poexd-total-controls .poexd-icon-btn svg {
      width: 15px;
      height: 15px;
      pointer-events: none;
    }
    .poexd-total-controls .poexd-popover {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      min-width: 220px;
      box-sizing: border-box;
      background: oklch(0.175 0.005 250 / 0.98);
      border: 1px solid var(--poexd-fx-border);
      border-radius: var(--poexd-fx-radius);
      padding: 3px;
      box-shadow: 0 8px 22px oklch(0 0 0 / 0.72);
      z-index: 99999;
      font-family: var(--poexd-fx-font);
      text-align: left;
    }
    .poexd-total-controls .poexd-popover.poexd-open {
      display: block;
    }
    .poexd-total-controls .poexd-popover-header {
      margin: 0 -3px 3px;
      padding: 5px 10px;
      font-family: var(--poexd-fx-font-display);
      font-size: 11px;
      font-weight: 400;
      line-height: 1.3;
      color: var(--poexd-fx-muted);
      border-bottom: 1px solid oklch(0.32 0.012 76 / 0.7);
      letter-spacing: 0.04em;
    }
    .poexd-total-controls .poexd-popover-item {
      padding: 5px 8px;
      border-radius: var(--poexd-fx-radius);
      font-size: 12px;
      line-height: 1.4;
      color: var(--poexd-fx-fg);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition:
        background-color 0.12s ease,
        color 0.12s ease;
      user-select: none;
      white-space: nowrap;
    }
    .poexd-total-controls .poexd-popover-item:hover {
      background: var(--poexd-fx-primary-bg);
      color: var(--poexd-fx-accent-fg);
    }
    .poexd-total-controls .poexd-popover-item.poexd-selected {
      color: var(--poexd-fx-gold);
      font-weight: 600;
    }
    .poexd-total-controls .poexd-check-mark {
      font-size: 12px;
      color: var(--poexd-fx-gold);
      font-weight: 700;
      margin-left: 12px;
    }
  `;
  document.head.appendChild(style);
}
