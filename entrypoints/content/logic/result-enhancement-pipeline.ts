import type { Preferences } from '@/utils/preferences';
import type { PoeVersion } from '@/utils/trade-context';
import { getTradePageMode, type TradePageMode } from '@/utils/trade-page-mode';
import type { TradePageRole } from '@/utils/live-search-contract';
import { createPinnedItemClient } from '@/utils/pinned-item-client';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { TRADE_RESULTS_SELECTOR, PAGE_GUIDE_MOCK_ATTR } from '@/utils/trade-results-root';
import { ResultPricePresenter } from './result-price-presenter';
import { ResultModHighlighter } from './result-mod-highlighter';
import { ResultItemNormalizer } from './result-item-normalizer';
import { ResultSortController } from './result-sort-controller';
import { ResultModQuickFilter } from './result-mod-quick-filter';
import { ResultPobCopy } from './result-pob-copy';
import { ResultPinButton } from './result-pin-button';
import { ResultExternalLinks } from './result-external-links';

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

export type ResultEnhancementScope = 'search-normal' | 'always';

export interface ResultEnhancement {
  readonly scope: ResultEnhancementScope;
  apply(target: Element): void;
  applyBatch?(rows: Element[]): void;
  applyPreferences?(snapshot: Readonly<Preferences>): void | Promise<void>;
  setPageMode?(mode: TradePageMode): void;
  setPageRole?(role: TradePageRole): void;
  cleanup?(): void;
}

export interface ResultEnhancementReorderGuard {
  readonly isReordering?: boolean;
  isRecentlyMovedRow?(node: Node): boolean;
}

export interface ResultEnhancementPipelineOptions {
  version: PoeVersion;
  enhancements: readonly ResultEnhancement[];
  reorderGuard?: ResultEnhancementReorderGuard;
  onFetchResponse?: (detail: string, league: string | undefined) => Promise<void> | void;
  onSearchQuery?: (searchId: string, criteria: unknown) => void;
}

/**
 * 統一管理官方結果列的 DOM 觀測、批次套用、偏好設定、頁面模式／角色、
 * fetch-to-cache 順序與釋放，取代淺層 DomFilter 與 runtime.ts 的 5 處手動 fan-out。
 */
export class ResultEnhancementPipeline {
  private frame?: number;
  private observerCleanups: (() => void)[] = [];
  private pageMode: TradePageMode = typeof window !== 'undefined' ? getTradePageMode() : 'search';
  private pageRole: TradePageRole = 'normal';
  private pendingRoots = new Set<Element>();
  private pendingRows = new Set<Element>();

  constructor(private readonly options: ResultEnhancementPipelineOptions) {}

  init() {
    this.stopObserving(); // 防重複初始化，僅清理上一次觀測器而不重置各增強狀態
    this.observeResultRows();
    console.log(`[PoeXD ResultPipeline] ready for ${this.options.version}`);
  }

  cleanup() {
    this.stopObserving();
    for (const enhancement of this.options.enhancements) {
      enhancement.cleanup?.();
    }
  }

  async applyPreferences(snapshot: Readonly<Preferences>) {
    for (const enhancement of this.options.enhancements) {
      await enhancement.applyPreferences?.(snapshot);
    }
  }

  setPageRole(role: TradePageRole) {
    for (const enhancement of this.options.enhancements) {
      enhancement.setPageRole?.(role);
    }
    if (role === this.pageRole) return;
    this.pageRole = role;
    const root = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.queueRoot(root);
  }

  setPageMode(mode: TradePageMode) {
    for (const enhancement of this.options.enhancements) {
      enhancement.setPageMode?.(mode);
    }
    if (mode === this.pageMode) return;
    this.pageMode = mode;
    const root = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.queueRoot(root);
  }

  async handleFetchResponse(detail: string, league: string | undefined) {
    await this.options.onFetchResponse?.(detail, league);
  }

  handleSearchQuery(searchId: string, criteria: unknown) {
    this.options.onSearchQuery?.(searchId, criteria);
  }

  private stopObserving() {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.pendingRoots.clear();
    this.pendingRows.clear();
    this.observerCleanups.forEach((cleanup) => cleanup());
    this.observerCleanups = [];
  }

  private observeResultRows() {
    const body = document.body;
    if (!body) {
      const timer = setTimeout(() => this.observeResultRows(), 200);
      this.observerCleanups.push(() => clearTimeout(timer));
      return;
    }
    const observer = new MutationObserver((mutations) => {
      if (this.options.reorderGuard?.isReordering) {
        return;
      }
      mutations.forEach((mutation) => {
        if (mutation.target instanceof Element && isIgnoredExtensionElement(mutation.target)) {
          return;
        }
        mutation.addedNodes.forEach((node) => {
          if (this.options.reorderGuard?.isRecentlyMovedRow?.(node)) return;
          this.collectAddedNode(node);
        });
      });
    });

    this.observerCleanups.push(() => observer.disconnect());
    observer.observe(body, { childList: true, subtree: true });
    const root = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.queueRoot(root);
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
    const active = this.options.enhancements.filter(
      (enhancement) => isSearchNormal || enhancement.scope === 'always',
    );

    roots.forEach((root) => {
      active.forEach((enhancement) => enhancement.apply(root));
    });

    const unrootedRows = rows.filter((row) => !roots.some((root) => root.contains(row)));
    if (unrootedRows.length === 0) return;

    const perRow = active.filter((enhancement) => typeof enhancement.applyBatch !== 'function');
    const batched = active.filter((enhancement) => typeof enhancement.applyBatch === 'function');

    unrootedRows.forEach((row) => {
      perRow.forEach((enhancement) => enhancement.apply(row));
    });
    batched.forEach((enhancement) => enhancement.applyBatch?.(unrootedRows));
  }
}

export function createDefaultResultEnhancementPipeline(
  version: PoeVersion,
  resultCache: TradeResultCache,
): ResultEnhancementPipeline {
  const pricePresenter = new ResultPricePresenter(version);
  const modHighlighter = new ResultModHighlighter();
  const sortController = new ResultSortController(version, pricePresenter);
  const itemNormalizer = new ResultItemNormalizer(version, sortController);
  const modQuickFilter = new ResultModQuickFilter();
  const pobCopy = new ResultPobCopy(version, {}, resultCache);
  const resultPin = new ResultPinButton(version, resultCache, createPinnedItemClient(version));
  const externalLinks = new ResultExternalLinks(version, pobCopy);

  const enhancements: ResultEnhancement[] = [
    {
      scope: 'search-normal',
      apply: (target) => pricePresenter.apply(target),
      applyPreferences: async (snapshot) => {
        await pricePresenter.setEnabled(snapshot.enablePriceComparison);
        pricePresenter.refreshLocale?.();
      },
      setPageMode: (mode) => pricePresenter.setPageMode(mode),
      setPageRole: (role) => pricePresenter.setPageRole(role),
      cleanup: () => pricePresenter.cleanup(),
    },
    {
      scope: 'search-normal',
      apply: (target) => itemNormalizer.apply(target),
      applyBatch: (rows) => itemNormalizer.applyBatch(rows),
      applyPreferences: (snapshot) => {
        itemNormalizer.setEnabled(version === 'poe2' && snapshot.enableItemNormalizer);
        itemNormalizer.refreshLocale?.();
      },
      setPageMode: (mode) => itemNormalizer.setPageMode(mode),
      setPageRole: (role) => itemNormalizer.setPageRole(role),
      cleanup: () => itemNormalizer.cleanup(),
    },
    {
      scope: 'search-normal',
      apply: (target) => sortController.apply(target),
      applyBatch: (rows) => sortController.applyBatch(rows),
      applyPreferences: (snapshot) => {
        sortController.setEnabled(
          version === 'poe1'
            ? snapshot.enablePriceComparison
            : snapshot.enableItemNormalizer || snapshot.enablePriceComparison,
        );
        sortController.syncSupport();
        sortController.refreshLocale();
      },
      setPageMode: (mode) => sortController.setPageMode(mode),
      setPageRole: (role) => sortController.setPageRole(role),
      cleanup: () => sortController.cleanup(),
    },
    {
      scope: 'search-normal',
      apply: (target) => modQuickFilter.apply(target),
      applyPreferences: (snapshot) => {
        modQuickFilter.setEnabled(snapshot.enableResultModQuickFilter);
        modQuickFilter.refreshLocale();
      },
      setPageMode: (mode) => modQuickFilter.setPageMode(mode),
      setPageRole: (role) => modQuickFilter.setPageRole(role),
      cleanup: () => modQuickFilter.cleanup(),
    },
    {
      scope: 'search-normal',
      apply: (target) => pobCopy.apply(target),
      applyPreferences: (snapshot) => {
        pobCopy.setEnabled(snapshot.enableResultPobCopy);
        pobCopy.refreshLocale();
      },
      cleanup: () => pobCopy.cleanup(),
    },
    {
      scope: 'search-normal',
      apply: (target) => externalLinks.apply(target),
      applyPreferences: (snapshot) => {
        externalLinks.setEnabled(snapshot.enableResultExternalLinks);
        externalLinks.refreshLocale();
      },
      cleanup: () => externalLinks.cleanup(),
    },
    {
      scope: 'always',
      apply: (target) => modHighlighter.apply(target),
      applyPreferences: (snapshot) => modHighlighter.setEnabled(snapshot.enableResultModHighlight),
      cleanup: () => modHighlighter.cleanup(),
    },
    {
      // 釘選在主控台與即時搜尋也提供
      scope: 'always',
      apply: (target) => resultPin.apply(target),
      applyPreferences: (snapshot) => {
        resultPin.setEnabled(snapshot.sidebarModulePinnedItems);
        resultPin.refreshLocale();
      },
      cleanup: () => resultPin.cleanup(),
    },
  ];

  return new ResultEnhancementPipeline({
    version,
    enhancements,
    reorderGuard: sortController,
    onFetchResponse: async (detail, league) => {
      await Promise.all([
        pricePresenter.handleFetchResponse(detail, league),
        (async () => {
          await itemNormalizer.handleFetchResponse(detail);
          sortController.handleFetchResponse(detail);
        })(),
      ]);
      resultCache.ingestFetchResponse(detail, { league });
      pobCopy.refresh();
      resultPin.refresh();
      externalLinks.refresh();
    },
    onSearchQuery: (searchId, criteria) =>
      modHighlighter.handleSearchQuery(searchId, criteria as any),
  });
}
