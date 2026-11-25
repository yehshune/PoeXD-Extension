/**
 * Result Enhancement Host（加深後的結果增強宿主）。
 *
 * 坐在頁面唯一的 `TradeResultCache` 之上，統一負責：
 * - 單次解析 `/fetch` 回應並寫入 `TradeResultCache`
 * - 集中持有 `pageMode`、`pageRole`、`activeSearchId`、`MutationObserver` 與 rAF 批次排程
 * - 統一透過 `ResultEnhancementHostPort` 隔離所有外部副作用
 * - 驅動 8 個內部結果增強 adapter，並在模式切換與釋放時一致清理
 */
import { parsePoeFetchResultBatch } from '@/utils/event-contracts';
import type { TradePageRole } from '@/utils/live-search-contract';
import { createPobItemExporter } from '@/utils/pob-item-export';
import type { Preferences } from '@/utils/preferences';
import type { PoeVersion } from '@/utils/trade-context';
import { getTradePageMode, type TradePageMode } from '@/utils/trade-page-mode';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { PAGE_GUIDE_MOCK_ATTR, TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import {
  createBrowserResultEnhancementHostPort,
  type ResultEnhancementHostPort,
  type ResultFetchBatch,
} from './result-enhancement-host-port';
import { ResultExternalLinksAdapter } from './result-external-links';
import { ResultItemNormalizerAdapter } from './result-item-normalizer';
import { ResultModHighlighterAdapter } from './result-mod-highlighter';
import { ResultModQuickFilterAdapter } from './result-mod-quick-filter';
import { ResultPinButtonAdapter } from './result-pin-button';
import { ResultPobCopyAdapter } from './result-pob-copy';
import { ResultPricePresenterAdapter } from './result-price-presenter';
import { ResultSortControllerAdapter } from './result-sort-controller';

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

interface ResultEnhancer {
  readonly scope: ResultEnhancementScope;
  apply(target: Element): void;
  applyBatch?(rows: Element[]): void;
  applyPreferences?(snapshot: Readonly<Preferences>): void | Promise<void>;
  onScopeActiveChange?(active: boolean): void;
  cleanup(): void;
}

function extractPathname(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

export class ResultEnhancementHost {
  private frame?: number;
  private observerCleanups: (() => void)[] = [];
  private pageMode: TradePageMode;
  private pageRole: TradePageRole = 'normal';
  private activeSearchId?: string;
  private pendingRoots = new Set<Element>();
  private pendingRows = new Set<Element>();

  private readonly priceAdapter: ResultPricePresenterAdapter;
  private readonly normalizerAdapter: ResultItemNormalizerAdapter;
  private readonly sortAdapter: ResultSortControllerAdapter;
  private readonly modQuickFilterAdapter: ResultModQuickFilterAdapter;
  private readonly pobCopyAdapter: ResultPobCopyAdapter;
  private readonly externalLinksAdapter: ResultExternalLinksAdapter;
  private readonly modHighlighterAdapter: ResultModHighlighterAdapter;
  private readonly pinAdapter: ResultPinButtonAdapter;
  private readonly enhancers: readonly ResultEnhancer[];

  constructor(
    private readonly version: PoeVersion,
    private readonly resultCache: TradeResultCache,
    private readonly port: ResultEnhancementHostPort,
  ) {
    this.pageMode = getTradePageMode(extractPathname(port.getPageContext().href));

    const pobExporter = createPobItemExporter(version, {
      getPageLocale: () => port.getPageContext().pageLocale,
      loadLexicon: (v, locale) => port.loadLexicon(v, locale),
      writeClipboard: (text) => port.writeClipboard(text),
      notify: (message, tone) => port.notify(message, tone),
    });

    this.priceAdapter = new ResultPricePresenterAdapter(version, port, resultCache, () =>
      this.sortAdapter.onRatesUpdated(),
    );
    this.normalizerAdapter = new ResultItemNormalizerAdapter(
      version,
      port.doc,
      resultCache,
      () => this.sortAdapter.onMetricsChanged(),
      () => this.sortAdapter.isReordering,
    );
    this.sortAdapter = new ResultSortControllerAdapter(
      version,
      port.doc,
      this.priceAdapter,
      this.normalizerAdapter,
    );
    this.modQuickFilterAdapter = new ResultModQuickFilterAdapter(port);
    this.pobCopyAdapter = new ResultPobCopyAdapter(port.doc, resultCache, pobExporter);
    this.externalLinksAdapter = new ResultExternalLinksAdapter(
      version,
      port,
      resultCache,
      pobExporter,
    );
    this.modHighlighterAdapter = new ResultModHighlighterAdapter(port.doc);
    this.pinAdapter = new ResultPinButtonAdapter(version, port, resultCache);

    this.enhancers = [
      {
        scope: 'search-normal',
        apply: (target) => this.priceAdapter.apply(target),
        applyPreferences: async (snapshot) => {
          await this.priceAdapter.setEnabled(snapshot.enablePriceComparison);
          this.priceAdapter.refreshLocale();
        },
        onScopeActiveChange: (active) => this.priceAdapter.onScopeActiveChange(active),
        cleanup: () => this.priceAdapter.cleanup(),
      },
      {
        scope: 'search-normal',
        apply: (target) => this.normalizerAdapter.apply(target),
        applyBatch: (rows) => this.normalizerAdapter.applyBatch(rows),
        applyPreferences: (snapshot) => {
          this.normalizerAdapter.setEnabled(version === 'poe2' && snapshot.enableItemNormalizer);
          this.normalizerAdapter.refreshLocale();
        },
        onScopeActiveChange: (active) => this.normalizerAdapter.onScopeActiveChange(active),
        cleanup: () => this.normalizerAdapter.cleanup(),
      },
      {
        scope: 'search-normal',
        apply: (target) => this.sortAdapter.apply(target),
        applyBatch: (rows) => this.sortAdapter.applyBatch(rows),
        applyPreferences: (snapshot) => {
          this.sortAdapter.setEnabled(
            version === 'poe1'
              ? snapshot.enablePriceComparison
              : snapshot.enableItemNormalizer || snapshot.enablePriceComparison,
          );
          this.sortAdapter.syncSupport();
          this.sortAdapter.refreshLocale();
        },
        onScopeActiveChange: (active) => this.sortAdapter.onScopeActiveChange(active),
        cleanup: () => this.sortAdapter.cleanup(),
      },
      {
        scope: 'search-normal',
        apply: (target) => this.modQuickFilterAdapter.apply(target),
        applyPreferences: (snapshot) => {
          this.modQuickFilterAdapter.setEnabled(snapshot.enableResultModQuickFilter);
          this.modQuickFilterAdapter.refreshLocale();
        },
        onScopeActiveChange: (active) => this.modQuickFilterAdapter.onScopeActiveChange(active),
        cleanup: () => this.modQuickFilterAdapter.cleanup(),
      },
      {
        scope: 'search-normal',
        apply: (target) => this.pobCopyAdapter.apply(target),
        applyPreferences: (snapshot) => {
          this.pobCopyAdapter.setEnabled(snapshot.enableResultPobCopy);
          this.pobCopyAdapter.refreshLocale();
        },
        onScopeActiveChange: (active) => this.pobCopyAdapter.onScopeActiveChange(active),
        cleanup: () => this.pobCopyAdapter.cleanup(),
      },
      {
        scope: 'search-normal',
        apply: (target) => this.externalLinksAdapter.apply(target),
        applyPreferences: (snapshot) => {
          this.externalLinksAdapter.setEnabled(snapshot.enableResultExternalLinks);
          this.externalLinksAdapter.refreshLocale();
        },
        onScopeActiveChange: (active) => this.externalLinksAdapter.onScopeActiveChange(active),
        cleanup: () => this.externalLinksAdapter.cleanup(),
      },
      {
        scope: 'always',
        apply: (target) => this.modHighlighterAdapter.apply(target),
        applyPreferences: (snapshot) =>
          this.modHighlighterAdapter.setEnabled(snapshot.enableResultModHighlight),
        cleanup: () => this.modHighlighterAdapter.cleanup(),
      },
      {
        // 釘選在主控台與即時搜尋也提供
        scope: 'always',
        apply: (target) => this.pinAdapter.apply(target),
        applyPreferences: (snapshot) => {
          this.pinAdapter.setEnabled(snapshot.sidebarModulePinnedItems);
          this.pinAdapter.refreshLocale();
        },
        cleanup: () => this.pinAdapter.cleanup(),
      },
    ];

    if (!this.isSearchNormal()) {
      this.notifySearchNormalScopeChange(false);
    }
  }

  private isSearchNormal(): boolean {
    return this.pageMode === 'search' && this.pageRole !== 'live-search-primary';
  }

  init(): void {
    this.stopObserving(); // 防重複初始化，僅清理上一次觀測器而不重置各增強狀態
    this.observeResultRows();
    console.log(`[PoeXD ResultPipeline] ready for ${this.version}`);
  }

  cleanup(): void {
    this.stopObserving();
    this.activeSearchId = undefined;
    for (const enhancer of this.enhancers) {
      enhancer.cleanup();
    }
  }

  async applyPreferences(snapshot: Readonly<Preferences>): Promise<void> {
    for (const enhancer of this.enhancers) {
      await enhancer.applyPreferences?.(snapshot);
    }
  }

  setPageRole(role: TradePageRole): void {
    if (role === this.pageRole) return;
    const prevActive = this.isSearchNormal();
    this.pageRole = role;
    this.handleScopeTransition(prevActive);
  }

  setPageMode(mode: TradePageMode): void {
    if (mode === this.pageMode) return;
    const prevActive = this.isSearchNormal();
    this.pageMode = mode;
    this.handleScopeTransition(prevActive);
  }

  async handleFetchResponse(detail: string, league: string | undefined): Promise<void> {
    const parsed = parsePoeFetchResultBatch(detail);
    if (!parsed) return;

    this.resultCache.ingestBatch(parsed.results, {
      league,
      sourceSearchId: parsed.searchId,
    });

    if (this.isSearchNormal()) {
      if (parsed.searchId) {
        const isNewSearch = parsed.searchId !== this.activeSearchId;
        this.activeSearchId = parsed.searchId;
        const batch: ResultFetchBatch = {
          searchId: parsed.searchId,
          league,
          results: parsed.results,
          isNewSearch,
        };
        this.normalizerAdapter.onFetchBatch(batch);
        this.sortAdapter.onFetchBatch(batch);
        await this.priceAdapter.onFetchBatch(batch);
      }
      this.pobCopyAdapter.refresh();
      this.externalLinksAdapter.refresh();
    }

    this.pinAdapter.refresh();
  }

  handleSearchQuery(searchId: string, criteria: unknown): void {
    this.modHighlighterAdapter.handleSearchQuery(searchId, criteria);
  }

  handleSearchResultSummary(searchId: string): void {
    if (!this.isSearchNormal()) return;
    this.sortAdapter.handleNewSearch(searchId);
  }

  private handleScopeTransition(prevActive: boolean): void {
    const nextActive = this.isSearchNormal();
    if (prevActive !== nextActive) {
      this.notifySearchNormalScopeChange(nextActive);
      if (!nextActive) {
        this.activeSearchId = undefined;
      }
    }
    const root = this.port.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.queueRoot(root);
  }

  private notifySearchNormalScopeChange(active: boolean): void {
    for (const enhancer of this.enhancers) {
      if (enhancer.scope === 'search-normal') {
        enhancer.onScopeActiveChange?.(active);
      }
    }
  }

  private stopObserving(): void {
    if (this.frame !== undefined) {
      const cancelRaf =
        this.port.doc.defaultView?.cancelAnimationFrame ??
        (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : undefined);
      cancelRaf?.(this.frame);
      this.frame = undefined;
    }
    this.pendingRoots.clear();
    this.pendingRows.clear();
    this.observerCleanups.forEach((cleanup) => cleanup());
    this.observerCleanups = [];
  }

  private observeResultRows(): void {
    const body = this.port.doc.body;
    if (!body) {
      const timer = setTimeout(() => this.observeResultRows(), 200);
      this.observerCleanups.push(() => clearTimeout(timer));
      return;
    }
    const ObserverCtor = this.port.doc.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new ObserverCtor((mutations) => {
      if (this.sortAdapter.isReordering) {
        return;
      }
      mutations.forEach((mutation) => {
        if (
          mutation.target instanceof (this.port.doc.defaultView?.Element ?? Element) &&
          isIgnoredExtensionElement(mutation.target)
        ) {
          return;
        }
        mutation.addedNodes.forEach((node) => {
          if (this.sortAdapter.isRecentlyMovedRow(node)) return;
          this.collectAddedNode(node);
        });
      });
    });

    this.observerCleanups.push(() => observer.disconnect());
    observer.observe(body, { childList: true, subtree: true });
    const root = this.port.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.queueRoot(root);
  }

  private collectAddedNode(node: Node): void {
    const ElementCtor = this.port.doc.defaultView?.Element ?? Element;
    if (!(node instanceof ElementCtor)) return;
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

  private queueRoot(root: Element): void {
    this.pendingRoots.add(root);
    this.scheduleFlush();
  }

  private queueRow(row: Element): void {
    this.pendingRows.add(row);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.frame !== undefined) return;
    const raf =
      this.port.doc.defaultView?.requestAnimationFrame ??
      (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined);
    if (!raf) {
      this.flushPendingResults();
      return;
    }
    this.frame = raf(() => {
      this.frame = undefined;
      this.flushPendingResults();
    });
  }

  private flushPendingResults(): void {
    const roots = [...this.pendingRoots];
    const rows = [...this.pendingRows];
    this.pendingRoots.clear();
    this.pendingRows.clear();

    const isSearchNormal = this.isSearchNormal();
    const active = this.enhancers.filter(
      (enhancer) => isSearchNormal || enhancer.scope === 'always',
    );

    roots.forEach((root) => {
      active.forEach((enhancer) => enhancer.apply(root));
    });

    const unrootedRows = rows.filter((row) => !roots.some((root) => root.contains(row)));
    if (unrootedRows.length === 0) return;

    const perRow = active.filter((enhancer) => typeof enhancer.applyBatch !== 'function');
    const batched = active.filter((enhancer) => typeof enhancer.applyBatch === 'function');

    unrootedRows.forEach((row) => {
      perRow.forEach((enhancer) => enhancer.apply(row));
    });
    batched.forEach((enhancer) => enhancer.applyBatch?.(unrootedRows));
  }
}

export type ResultEnhancementPipeline = ResultEnhancementHost;

export function createResultEnhancementHost(
  version: PoeVersion,
  resultCache: TradeResultCache,
  port: ResultEnhancementHostPort,
): ResultEnhancementHost {
  return new ResultEnhancementHost(version, resultCache, port);
}

export function createDefaultResultEnhancementPipeline(
  version: PoeVersion,
  resultCache: TradeResultCache,
  portOverrides?: Partial<ResultEnhancementHostPort>,
): ResultEnhancementPipeline {
  return createResultEnhancementHost(
    version,
    resultCache,
    createBrowserResultEnhancementHostPort(version, portOverrides),
  );
}
