import type { PoeVersion } from '@/utils/trade-context';
import { getTradePageMode, type TradePageMode } from '@/utils/trade-page-mode';
import type { TradePageRole } from '@/utils/live-search-contract';
import type { ResultPricePresenter } from './result-price-presenter';
import type { ResultModHighlighter } from './result-mod-highlighter';
import type { ResultItemNormalizer } from './result-item-normalizer';
import type { ResultSortController } from './result-sort-controller';
import type { ResultModQuickFilter } from './result-mod-quick-filter';
import type { ResultPobCopy } from './result-pob-copy';
import type { ResultPinButton } from './result-pin-button';
import type { ResultExternalLinks } from './result-external-links';
import { TRADE_RESULTS_SELECTOR, PAGE_GUIDE_MOCK_ATTR } from '@/utils/trade-results-root';

const IGNORED_EXTENSION_SELECTORS = [
  '.poexd-price-comparison',
  '.poexd-result-mod-actions',
  '.poexd-total-controls',
  '.poexd-left-badges',
  '.poexd-inline-override',
  '.poexd-left-actions',
  `[${PAGE_GUIDE_MOCK_ATTR}]`,
] as const;

function isIgnoredExtensionElement(element: Element): boolean {
  return IGNORED_EXTENSION_SELECTORS.some((selector) => element.closest(selector));
}

export class DomFilter {
  private observed = false;
  private frame?: number;
  private cleanups: (() => void)[] = [];
  private pageMode: TradePageMode = typeof window !== 'undefined' ? getTradePageMode() : 'search';
  private pageRole: TradePageRole = 'normal';
  private pendingRoots = new Set<Element>();
  private pendingRows = new Set<Element>();

  constructor(
    private readonly version: PoeVersion,
    private readonly pricePresenter?: ResultPricePresenter,
    private readonly modHighlighter?: ResultModHighlighter,
    private readonly itemNormalizer?: ResultItemNormalizer,
    private readonly modQuickFilter?: ResultModQuickFilter,
    private readonly pobCopy?: ResultPobCopy,
    private readonly externalLinks?: ResultExternalLinks,
    private readonly sortController?: ResultSortController,
    private readonly resultPin?: ResultPinButton,
  ) {}

  init() {
    this.cleanup(); // 防重複初始化，進行上一次監聽器的清理
    this.observeResultRows();
    this.observed = true;
    console.log(`[PoeXD DomFilter] DomFilter ready for ${this.version}`);
  }

  cleanup() {
    this.observed = false;
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.pendingRoots.clear();
    this.pendingRows.clear();
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
  }

  private observeResultRows() {
    const body = document.body;
    if (!body) {
      const t = setTimeout(() => this.observeResultRows(), 200);
      this.cleanups.push(() => clearTimeout(t));
      return;
    }
    const observer = new MutationObserver((mutations) => {
      if (this.sortController?.isReordering) {
        return;
      }
      mutations.forEach((mutation) => {
        if (mutation.target instanceof Element && isIgnoredExtensionElement(mutation.target)) {
          return;
        }
        mutation.addedNodes.forEach((node) => {
          if (this.sortController?.isRecentlyMovedRow?.(node)) return;
          this.collectAddedNode(node);
        });
      });
    });

    const disconnectObserver = () => observer.disconnect();
    this.cleanups.push(disconnectObserver);

    observer.observe(body, { childList: true, subtree: true });
    const root = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.queueRoot(root);
  }

  setPageRole(role: TradePageRole) {
    if (role === this.pageRole) return;
    this.pageRole = role;
    const root = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (!root) return;
    this.queueRoot(root);
  }

  setPageMode(mode: TradePageMode) {
    if (mode === this.pageMode) return;
    this.pageMode = mode;
    const root = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (!root) return;
    this.queueRoot(root);
  }

  private collectAddedNode(node: Node) {
    if (!(node instanceof Element)) return;
    if (isIgnoredExtensionElement(node)) return;
    const root = node.matches(TRADE_RESULTS_SELECTOR)
      ? node
      : node.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) {
      this.queueRoot(root);
      return;
    }
    const ownerRow = node.matches('.row')
      ? node.closest(TRADE_RESULTS_SELECTOR)
        ? node
        : null
      : node.closest(`${TRADE_RESULTS_SELECTOR} .row`);
    if (ownerRow) this.queueRow(ownerRow);
    node.querySelectorAll('.row').forEach((row) => {
      if (row.closest(TRADE_RESULTS_SELECTOR)) this.queueRow(row);
    });
  }

  private queueRoot(root: Element) {
    this.pendingRoots.add(root);
    this.scheduleFlush();
  }

  private queueRow(row: Element) {
    this.pendingRows.add(row);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.flushPendingResults();
    });
  }

  private flushPendingResults() {
    const roots = [...this.pendingRoots];
    const rows = [...this.pendingRows];
    this.pendingRoots.clear();
    this.pendingRows.clear();
    const isSearchNormal = this.pageMode === 'search' && this.pageRole !== 'live-search-primary';
    roots.forEach((root) => this.applyTargetEnhancements(root, isSearchNormal, true, true));
    const unrootedRows = rows.filter((row) => !roots.some((root) => root.contains(row)));
    if (unrootedRows.length === 0) return;

    const batchNormalizer =
      isSearchNormal && typeof this.itemNormalizer?.applyBatch === 'function'
        ? this.itemNormalizer
        : undefined;
    const batchSorter =
      isSearchNormal && typeof this.sortController?.applyBatch === 'function'
        ? this.sortController
        : undefined;
    unrootedRows.forEach((row) =>
      this.applyTargetEnhancements(row, isSearchNormal, !batchNormalizer, !batchSorter),
    );
    batchNormalizer?.applyBatch(unrootedRows);
    batchSorter?.applyBatch(unrootedRows);
  }

  private applyTargetEnhancements(
    target: Element,
    isSearchNormal: boolean,
    includeItemNormalizer: boolean,
    includeSortController: boolean,
  ) {
    if (isSearchNormal) {
      this.pricePresenter?.apply(target);
      if (includeItemNormalizer) {
        this.itemNormalizer?.apply(target);
      }
      if (includeSortController) {
        this.sortController?.apply(target);
      }
      this.modQuickFilter?.apply(target);
      this.pobCopy?.apply(target);
      this.externalLinks?.apply(target);
    }
    this.modHighlighter?.apply(target);
    // 釘選在主控台與即時搜尋也提供
    this.resultPin?.apply(target);
  }
}
