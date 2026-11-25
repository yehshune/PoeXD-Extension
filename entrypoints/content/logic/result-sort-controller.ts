/**
 * 結果列排序內部 adapter。
 *
 * 專注於排序模式狀態、原始順序追蹤、LIS 最小 DOM 移動與 `isReordering` / `recentlyMovedRows` 守衛；
 * 工具列與下拉選單 DOM 委派給 `result-sort-toolbar.ts`，並由 Host 統一協調價格與符文標準化資料。
 */
import { t } from '@/utils/i18n';
import type { SvgIconSpec } from '@/utils/safe-dom';
import type { PoeVersion } from '@/utils/trade-context';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import type { ResultFetchBatch } from './result-enhancement-host-port';
import {
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import { collectResultRows, resolveRowId } from './result-left-actions';
import {
  closeOpenPopovers,
  mountOrUpdateSortToolbar,
  removeSortToolbar,
  syncSortToolbarStates,
  type ToolbarDropdownOption,
  type ToolbarDropdownSpec,
  type ToolbarDropdownState,
} from './result-sort-toolbar';

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

export interface SortExtraControl {
  readonly type: 'weapon' | 'armour';
  getIcon(): SvgIconSpec;
  getTitle(): string;
  getHeader(): string;
  getOptions(): ToolbarDropdownOption[];
  getState(): {
    currentKey: string;
    titleText: string;
    headerText: string;
    isActive: boolean;
  };
}

export interface SortPriceSource {
  isEnabled(): boolean;
  getPrimaryPrice(id: string): number | undefined;
}

export interface SortStatSource {
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

export class ResultSortControllerAdapter {
  private enabled = true;
  private scopeActive = true;
  private activeSearchId?: string;
  private originalOrder: string[] = [];
  private hasReorderedDom = false;
  private sortMode: SortMode = 'default';
  private recentlyMovedRows = new Set<Element>();
  private hasRegisteredGlobalClick = false;
  public isReordering = false;

  constructor(
    private readonly version: PoeVersion,
    private readonly doc: Document,
    private readonly priceSource: SortPriceSource,
    private readonly statSource: SortStatSource,
  ) {}

  isRecentlyMovedRow(node: Node): boolean {
    return this.recentlyMovedRows.has(node as Element);
  }

  private hasActiveStats(): boolean {
    return this.version === 'poe2' && this.statSource.isActive();
  }

  private isFeatureActive(): boolean {
    if (!this.enabled || !this.scopeActive) return false;
    if (this.version === 'poe1') {
      return this.priceSource.isEnabled();
    }
    return this.hasActiveStats() || this.priceSource.isEnabled();
  }

  onRatesUpdated(): void {
    if (!this.isFeatureActive() || !isPriceDependentSortMode(this.sortMode)) return;
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.reorderDomRows(root);
  }

  onMetricsChanged(): void {
    if (!this.isFeatureActive()) return;
    this.updateControlsState();
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.reorderDomRows(root);
  }

  /** 真正的新一次 `/api/trade/search` 回應（即使與前一次同 searchId）：清空舊一輪官方順序 */
  handleNewSearch(searchId: string): void {
    if (!this.scopeActive) return;
    const isNewSearchId = searchId !== this.activeSearchId;
    this.activeSearchId = searchId;
    this.originalOrder = [];
    this.hasReorderedDom = false;
    if (isNewSearchId) {
      removeSortToolbar(this.doc);
    }
  }

  onFetchBatch(batch: ResultFetchBatch): void {
    if (!this.scopeActive) return;

    if (batch.isNewSearch || batch.searchId !== this.activeSearchId) {
      this.activeSearchId = batch.searchId;
      this.originalOrder = [];
      this.hasReorderedDom = false;
      removeSortToolbar(this.doc);
    }

    batch.results.forEach((res) => {
      if (!res || typeof res !== 'object') return;
      const { id } = res as { id?: unknown };
      if (typeof id === 'string' && !this.originalOrder.includes(id)) {
        this.originalOrder.push(id);
      }
    });

    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root && this.isFeatureActive()) {
      this.apply(root);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.isFeatureActive()) {
      this.deactivateAndRestore();
      return;
    }
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  syncSupport(): void {
    if (!this.isFeatureActive()) {
      this.deactivateAndRestore();
      return;
    }

    const priceDisabled = !this.priceSource.isEnabled();
    const statsDisabled = !this.hasActiveStats();
    if (
      (priceDisabled && isPriceDependentSortMode(this.sortMode)) ||
      (statsDisabled && isStatDependentSortMode(this.sortMode))
    ) {
      this.restoreOriginalDomOrder();
    }

    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) {
      this.apply(root);
    } else {
      this.updateControlsState();
    }
  }

  onScopeActiveChange(active: boolean): void {
    if (active === this.scopeActive) return;
    this.scopeActive = active;
    if (!active) {
      this.deactivateAndRestore();
    }
  }

  setSortMode(mode: SortMode): void {
    if (!this.isFeatureActive()) return;
    if (isPriceDependentSortMode(mode) && !this.priceSource.isEnabled()) return;
    if (isStatDependentSortMode(mode) && !this.hasActiveStats()) return;

    this.sortMode = mode;
    this.updateControlsState();
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.reorderDomRows(root);
  }

  apply(_container: Element): void {
    if (!this.isFeatureActive() || this.isReordering) {
      if (!this.scopeActive) {
        removeSortToolbar(this.doc);
      }
      return;
    }

    this.ensureToolbar();

    const resultsRoot = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (resultsRoot) {
      this.reorderDomRows(resultsRoot);
    }

    ensureResultEnhancementStyle('sort-controls', this.doc);
  }

  applyBatch(rows: Element[]): void {
    if (rows.length === 0) return;
    this.apply(rows[0]);
  }

  refreshLocale(): void {
    if (!this.isFeatureActive()) return;
    this.updateControlsState();
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  cleanup(): void {
    this.recentlyMovedRows.clear();
    this.restoreOriginalDomOrder();
    this.enabled = false;
    this.isReordering = false;
    this.activeSearchId = undefined;
    this.originalOrder = [];
    removeSortToolbar(this.doc);
    this.unregisterGlobalClick();
    removeResultEnhancementStyle('sort-controls', this.doc);

    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR) as HTMLElement | null;
    if (root) {
      root.style.display = '';
      root.style.flexDirection = '';
      const rows = collectResultRows(root);
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

  private deactivateAndRestore(): void {
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.restoreOriginalDomOrder(root);
    removeSortToolbar(this.doc);
  }

  private restoreOriginalDomOrder(container?: Element | null): void {
    this.sortMode = 'default';
    if (this.originalOrder.length === 0) return;
    const root = container || this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) {
      this.reorderDomRows(root);
    }
    this.originalOrder = [];
  }

  private ensureToolbar(): void {
    const includeStats = this.hasActiveStats();
    const specs: ToolbarDropdownSpec[] = [];

    if (includeStats) {
      for (const extra of this.statSource.getLeadingControls()) {
        specs.push({
          type: extra.type,
          icon: extra.getIcon(),
          title: extra.getTitle(),
          header: extra.getHeader(),
          options: extra.getOptions(),
        });
      }
    }

    specs.push({
      type: 'sort',
      icon: SORT_SVG,
      title: t('normalizer.btn.sortTitle'),
      header: t('normalizer.btn.sortHeader'),
      options: getSortModeOptions(includeStats).map((opt) => ({
        key: opt.key,
        label: opt.label,
        onSelect: () => this.setSortMode(opt.key),
      })),
    });

    const controls = mountOrUpdateSortToolbar(this.doc, this.version, includeStats, specs);
    if (!controls) return;
    this.registerGlobalClick();
    this.updateControlsState();
  }

  private updateControlsState(): void {
    const includeStats = this.hasActiveStats();
    const states: ToolbarDropdownState[] = [];

    if (includeStats) {
      for (const extra of this.statSource.getLeadingControls()) {
        const state = extra.getState();
        states.push({
          type: extra.type,
          currentKey: state.currentKey,
          options: extra.getOptions(),
          titleText: state.titleText,
          headerText: state.headerText,
          isActive: state.isActive,
        });
      }
    }

    const sortOptions = getSortModeOptions(includeStats);
    const currentSortOpt = sortOptions.find((o) => o.key === this.sortMode);
    states.push({
      type: 'sort',
      currentKey: this.sortMode,
      options: sortOptions,
      titleText: t('normalizer.activeSort', { label: currentSortOpt?.label || '' }),
      headerText: t('normalizer.btn.sortHeader'),
      isActive: this.sortMode !== 'default',
      hiddenKeys: !this.priceSource.isEnabled() ? PRICE_DEPENDENT_SORT_MODES : undefined,
    });

    syncSortToolbarStates(this.doc, states);
  }

  private readonly globalClickHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.poexd-btn-wrapper')) {
      closeOpenPopovers(this.doc);
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

  private registerGlobalClick(): void {
    if (this.hasRegisteredGlobalClick) return;
    if (typeof this.doc.addEventListener !== 'function') return;
    this.hasRegisteredGlobalClick = true;
    this.doc.addEventListener('click', this.globalClickHandler);
    this.doc.addEventListener('click', this.officialSortClickHandler, true);
  }

  private unregisterGlobalClick(): void {
    if (!this.hasRegisteredGlobalClick) return;
    if (typeof this.doc.removeEventListener === 'function') {
      this.doc.removeEventListener('click', this.globalClickHandler);
      this.doc.removeEventListener('click', this.officialSortClickHandler, true);
    }
    this.hasRegisteredGlobalClick = false;
  }

  /**
   * 真實 DOM 物理排序
   * 絕不修改容器的 display 與 flexDirection，完整相容官方 layout-immersion、compact 與 compact-two 排版。
   * 透過 isReordering 與 recentlyMovedRows 避免 MutationObserver 重入，並保留 Vue 未載入佔位註解位置。
   */
  private reorderDomRows(container: Element): void {
    if (this.isReordering) return;
    if (!this.scopeActive && this.originalOrder.length === 0) return;
    if (isPriceDependentSortMode(this.sortMode) && !this.priceSource.isEnabled()) return;
    if (isStatDependentSortMode(this.sortMode) && !this.hasActiveStats()) return;

    const rows = collectResultRows(container);
    if (rows.length === 0) return;

    const rowsContainer = getRowsContainer(container);

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
        const price = this.priceSource.getPrimaryPrice(id);
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
        const rawStat = this.statSource.getSortMetric(this.sortMode, id);
        let val = rawStat;
        if (this.sortMode === 'cp_ratio' && rawStat !== undefined) {
          const price = this.priceSource.getPrimaryPrice(id);
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

function compareOptionalMetricDesc(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
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
