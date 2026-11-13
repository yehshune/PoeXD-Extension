import type { PoeVersion } from '@/utils/trade-context';
import { getTradePageMode, type TradePageMode } from '@/utils/trade-page-mode';
import type { TradePageRole } from '@/utils/live-search-contract';
import type { ResultPricePresenter } from './result-price-presenter';
import type { ResultModHighlighter } from './result-mod-highlighter';
import type { ResultItemNormalizer } from './result-item-normalizer';
import type { ResultModQuickFilter } from './result-mod-quick-filter';

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
      if (this.itemNormalizer?.isReordering) return;
      mutations.forEach((mutation) => {
        if (
          mutation.target instanceof Element &&
          (mutation.target.closest('.poexd-price-comparison') ||
            mutation.target.closest('.poexd-result-mod-actions'))
        )
          return;
        mutation.addedNodes.forEach((node) => this.collectAddedNode(node));
      });
    });

    const disconnectObserver = () => observer.disconnect();
    this.cleanups.push(disconnectObserver);

    observer.observe(body, { childList: true, subtree: true });
    const root = document.querySelector('.results');
    if (root) this.queueRoot(root);
  }

  setPageRole(role: TradePageRole) {
    if (role === this.pageRole) return;
    this.pageRole = role;
    const root = document.querySelector('.results');
    if (!root) return;
    this.queueRoot(root);
  }

  setPageMode(mode: TradePageMode) {
    if (mode === this.pageMode) return;
    this.pageMode = mode;
    const root = document.querySelector('.results');
    if (!root) return;
    this.queueRoot(root);
  }

  private collectAddedNode(node: Node) {
    if (!(node instanceof Element)) return;
    if (node.closest('.poexd-price-comparison') || node.closest('.poexd-result-mod-actions'))
      return;
    const root = node.matches('.results') ? node : node.querySelector('.results');
    if (root) {
      this.queueRoot(root);
      return;
    }
    const ownerRow = node.matches('.row')
      ? node.closest('.results')
        ? node
        : null
      : node.closest('.results .row');
    if (ownerRow) this.queueRow(ownerRow);
    node.querySelectorAll('.row').forEach((row) => {
      if (row.closest('.results')) this.queueRow(row);
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
    roots.forEach((root) => this.applyResultEnhancements(root));
    rows
      .filter((row) => !roots.some((root) => root.contains(row)))
      .forEach((row) => this.applyResultEnhancements(row));
  }

  private applyResultEnhancements(root: Element) {
    if (this.pageMode === 'search' && this.pageRole !== 'live-search-primary') {
      this.pricePresenter?.apply(root);
      this.itemNormalizer?.apply(root);
      this.modQuickFilter?.apply(root);
    }
    this.modHighlighter?.apply(root);
  }
}
