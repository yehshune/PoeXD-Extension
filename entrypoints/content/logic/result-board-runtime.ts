/**
 * 搜尋結果看板在一般頁上的接線（GLOSSARY.md「Result Board」、ADR-0018）：
 * - 官方 search / fetch 回應 → 看板狀態（`ResultBoardSession`）
 * - 「載入更多」一律觸發官方自己的按鈕（`ResultBoardLoader`）
 * - 定位、捷徑按鈕與官方過濾橫條委由內部 `ResultBoardDom`
 * - 前往藏身處狀態機與 whisper 配對委由內部 `ResultBoardTravel`
 *
 * 只在一般頁的搜尋模式啟用；側邊欄透過 `getResultBoardRuntime()` 取用。
 */
import { listenPoeEvent, parsePoeFetchResponse } from '@/utils/event-contracts';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { capturePinnedCardDom } from '@/utils/pinned-card-dom';
import { createPinnedItemSnapshot, type PinnedItemSnapshot } from '@/utils/pinned-items';
import {
  parseFetchFailure,
  parseSearchResultSummary,
  parseWhisperOutcome,
  readGoneFetchIds,
  readMissingFetchIds,
} from '@/utils/result-board/board-events';
import { ResultBoardLoader, type BatchOutcome } from '@/utils/result-board/board-loader';
import {
  ResultBoardSession,
  type BoardState,
  type CurrencyDisplay,
} from '@/utils/result-board/board-session';
import type { PoeVersion } from '@/utils/trade-context';
import { getTradeResultCache, type TradeResultCache } from '@/utils/trade-result-cache';
import {
  ResultBoardDom,
  findLoadMoreButton,
  findOfficialRow,
  readRowCurrency,
  type OfficialFilterSync,
} from './result-board-dom';
import {
  ResultBoardTravel,
  TRAVEL_COOLDOWN_MS,
  TRAVEL_REFRESH_TIMEOUT_MS,
  type TravelOutcome,
  type TravelPhase,
  type TravelStateMap,
} from './result-board-travel';

export {
  TRAVEL_COOLDOWN_MS,
  TRAVEL_REFRESH_TIMEOUT_MS,
  findOfficialRow,
  readRowCurrency,
  type OfficialFilterSync,
  type TravelOutcome,
  type TravelPhase,
  type TravelStateMap,
};

/** 官方一次 search 最多回傳的結果 id 數 */
export const OFFICIAL_RESULT_CAP = 100;
/** 官方結果列在 fetch 回應後才重繪，稍等再讀通貨圖示 */
const CURRENCY_SCAN_DELAY_MS = 300;

const fetchSearchId = (url: string): string | undefined => {
  try {
    return new URL(url, window.location.origin).searchParams.get('query') || undefined;
  } catch {
    return undefined;
  }
};

export class ResultBoardRuntime {
  readonly session: ResultBoardSession;
  readonly loader: ResultBoardLoader;
  private readonly dom: ResultBoardDom;
  private readonly travelController: ResultBoardTravel;
  private enabled = false;
  private lastFetchSearchId: string | undefined;
  /** 目前這次搜尋（搜尋 id 相同的重新搜尋也算新的一次） */
  private observedSearch: { searchId: string; startedAt: number } | undefined;
  private batchWaiter: ((outcome: BatchOutcome) => void) | undefined;
  private armedBatch: Promise<BatchOutcome> | undefined;
  private cleanups: (() => void)[] = [];
  private currencyScanTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly cache: TradeResultCache = getTradeResultCache(),
    private readonly doc: Document = document,
    private readonly now: () => number = Date.now,
  ) {
    this.session = new ResultBoardSession(
      (searchId) => this.cache.entriesForSearch(searchId),
      this.now,
    );
    this.loader = new ResultBoardLoader({
      clickLoadMore: () => this.clickLoadMore(),
      waitForBatch: (timeoutMs) => this.waitForBatch(timeoutMs),
      pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isComplete: () => this.isComplete(),
      currentSearchId: () => this.session.getState().searchId,
    });
    this.dom = new ResultBoardDom(this.doc);
    this.travelController = new ResultBoardTravel({
      doc: this.doc,
      now: this.now,
      isEnabled: () => this.enabled,
      isLoaderRunning: () => this.loader.getState().running,
      markVisited: (id) => this.session.markVisited(id),
      markSold: (id) => this.session.markSold(id),
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.attach();
    else this.detach();
  }

  /** 已取得官方 search 回傳的全部結果（最多 100） */
  isComplete(): boolean {
    const { summary, ledger } = this.session.getState();
    const retrieved = ledger.entries.length + ledger.skippedIds.length;
    if (summary) return retrieved >= Math.min(summary.resultCount, OFFICIAL_RESULT_CAP);
    return findLoadMoreButton(this.doc) === null;
  }

  /** 捲到官方結果列並短暫高亮；找不到時回傳 false */
  locate(id: string): boolean {
    return this.dom.locate(id);
  }

  getTravelStates(): TravelStateMap {
    return this.travelController.getStates();
  }

  subscribeTravelStates(listener: (states: TravelStateMap) => void): () => void {
    return this.travelController.subscribe(listener);
  }

  /** 按下官方結果列的「前往藏身處」；連結過期時先重新整理再前往 */
  travel(id: string, onRefreshing?: () => void): Promise<TravelOutcome> {
    return this.travelController.travel(id, onRefreshing);
  }

  /** 讀取官方結果列上的顯示文字（含市集漢化後的品名、基底、詞綴與階級）供看板搜尋 */
  readEntrySearchLines(id: string): readonly string[] {
    return this.dom.readEntrySearchLines(id);
  }

  /** 按下官方結果列上 PoeXD 的釘選按鈕（與在結果列上釘選相同）；沒有按鈕時回傳 false */
  pin(id: string): boolean {
    return this.dom.clickPin(id);
  }

  /** 官方結果數列的捷徑按鈕；結果列重繪後重新放回去並避開官方 layout-btn */
  ensureShortcut(): void {
    if (!this.enabled) return;
    this.dom.ensureShortcut();
  }

  hideSeller(account: string): void {
    this.session.hideSeller(account);
  }

  showAllSellers(): void {
    this.session.showAllSellers();
  }

  loadNext(): void {
    void this.loader.loadNext();
  }

  loadBatches(batches: number): void {
    void this.loader.loadBatches(batches);
  }

  loadAll(): void {
    void this.loader.loadAll();
  }

  stopLoading(): void {
    this.loader.stop();
  }

  /** 同步暫時過濾左側官方結果列（純 CSS 隱藏未命中列＋頂部還原橫條） */
  syncOfficialFilter(filter: OfficialFilterSync | null): void {
    this.dom.syncOfficialFilter(filter, this.enabled, (id) => this.session.markSold(id));
  }

  /** 擷取展開檢視用的官方卡片快照（封裝官方 DOM 與快取讀取，避免 UI 直接跨 seam 擷取） */
  captureCardSnapshot(
    id: string,
    version: PoeVersion,
    resolveLeague: (entryLeague?: string) => string | undefined,
  ): PinnedItemSnapshot | undefined {
    const entry = this.cache.get(id);
    const league = resolveLeague(entry?.league);
    if (!entry || !league) return undefined;
    const row = findOfficialRow(id, this.doc);
    return createPinnedItemSnapshot(
      entry,
      {
        gameVersion: version,
        origin: window.location.origin,
        league,
        sourceSearchId: entry.sourceSearchId,
        locale: resolvePageLocale(),
        card: row ? capturePinnedCardDom(row) : undefined,
      },
      this.now(),
    );
  }

  cleanup(): void {
    this.setEnabled(false);
  }

  private attach(): void {
    this.dom.ensureStyle();
    const onSold = (id: string) => this.session.markSold(id);
    this.cleanups = [
      listenPoeEvent('poexd-search-result-summary', (detail) => {
        const summary = parseSearchResultSummary(detail);
        if (!summary) return;
        this.session.setSummary(summary);
        this.ensureShortcut();
        this.dom.ensureGoneObserver(onSold);
      }),
      listenPoeEvent('poexd-fetch-response', (detail) => this.handleFetchResponse(detail)),
      listenPoeEvent('poexd-fetch-failed', (detail) => {
        const failure = parseFetchFailure(detail);
        if (failure) this.resolveBatch({ kind: 'failed', status: failure.status });
      }),
      listenPoeEvent('poexd-whisper-outcome', (detail) => {
        const outcome = parseWhisperOutcome(detail);
        if (outcome) this.travelController.handleWhisperOutcome(outcome);
      }),
      this.cache.subscribe(() => {
        this.session.observeFetch(this.lastFetchSearchId);
        this.ensureShortcut();
        this.dom.ensureGoneObserver(onSold);
        this.scheduleCurrencyScan();
      }),
      this.session.subscribe((state) => {
        this.travelController.syncMarks(state.marks);
        this.handleSearchChange(state);
      }),
    ];
    const { searchId, startedAt } = this.session.getState();
    this.observedSearch = { searchId, startedAt };
    this.doc.addEventListener('click', this.travelController.handleDocumentClick, true);
    this.cleanups.push(() =>
      this.doc.removeEventListener('click', this.travelController.handleDocumentClick, true),
    );
    this.adoptSearchFromUrl();
    this.ensureShortcut();
    this.dom.ensureGoneObserver(onSold);
    this.scanCurrencies();
  }

  private scheduleCurrencyScan(): void {
    clearTimeout(this.currencyScanTimer);
    this.currencyScanTimer = setTimeout(() => this.scanCurrencies(), CURRENCY_SCAN_DELAY_MS);
  }

  /** 看板上還不知道圖示的通貨，從官方結果列讀一次 */
  private scanCurrencies(): void {
    const { ledger, currencies } = this.session.getState();
    const found: Record<string, CurrencyDisplay> = {};
    for (const entry of ledger.entries) {
      const code = entry.price?.currency;
      if (!code || Object.hasOwn(currencies, code) || Object.hasOwn(found, code)) continue;
      const row = findOfficialRow(entry.id, this.doc);
      const display = row ? readRowCurrency(row) : undefined;
      if (display) found[code] = display;
    }
    this.session.learnCurrencies(found);
  }

  /** 啟用前官方已經搜尋過：以網址上的搜尋 id 接手快取裡已有的結果 */
  private adoptSearchFromUrl(): void {
    if (this.session.getState().searchId) return;
    const match = /\/(?:search|live)\/[^/]+\/([^/?#]+)/.exec(this.doc.location?.pathname ?? '');
    const searchId = match ? decodeURIComponent(match[1]) : undefined;
    if (searchId && this.cache.entriesForSearch(searchId).length > 0) {
      this.session.observeFetch(searchId);
    }
  }

  /**
   * 官方 fetch 回應：這一批算載入完成（結果由快取通知補進帳本），
   * 並把官方回 null 的已下架結果記為已取得。其他搜尋晚到的回應不算。
   */
  private handleFetchResponse(detail: unknown): void {
    const payload = parsePoeFetchResponse(detail);
    const searchId = payload ? fetchSearchId(payload.url) : undefined;
    if (!payload || !searchId || this.session.isStale(searchId)) return;
    this.lastFetchSearchId = searchId;
    this.session.observeFetch(searchId);
    const missingIds = readMissingFetchIds(payload.url, payload.data);
    this.session.skipMissing(searchId, missingIds);
    const knownIds = new Set(this.session.getState().ledger.entries.map((entry) => entry.id));
    for (const id of readGoneFetchIds(payload.data)) {
      this.session.markSold(id);
    }
    for (const id of missingIds) {
      if (knownIds.has(id)) this.session.markSold(id);
    }
    if (this.enabled) this.dom.ensureGoneObserver((id) => this.session.markSold(id));
    this.resolveBatch({ kind: 'loaded' });
  }

  /** 換搜尋時停下進行中的載入、清掉上一次的停止原因、同步過濾與等待中的前往藏身處 */
  private handleSearchChange({ searchId, startedAt }: BoardState): void {
    const observed = this.observedSearch;
    if (observed?.searchId === searchId && observed.startedAt === startedAt) return;
    this.observedSearch = { searchId, startedAt };
    this.travelController.reset();
    this.loader.reset();
    this.syncOfficialFilter(null);
  }

  private detach(): void {
    this.loader.reset();
    this.travelController.reset();
    this.dom.cleanup();
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.resolveBatch({ kind: 'timeout' });
    this.armedBatch = undefined;
    clearTimeout(this.currencyScanTimer);
  }

  /** 先建立等待，再按官方按鈕：官方回應再快也不會漏接 */
  private clickLoadMore(): boolean {
    const button = findLoadMoreButton(this.doc);
    if (!button) return false;
    this.armBatch();
    button.click();
    return true;
  }

  private armBatch(): Promise<BatchOutcome> {
    this.resolveBatch({ kind: 'timeout' });
    const promise = new Promise<BatchOutcome>((resolve) => {
      this.batchWaiter = resolve;
    });
    this.armedBatch = promise;
    return promise;
  }

  private waitForBatch(timeoutMs: number): Promise<BatchOutcome> {
    const promise = this.armedBatch ?? this.armBatch();
    this.armedBatch = undefined;
    const timer = setTimeout(() => this.resolveBatch({ kind: 'timeout' }), timeoutMs);
    return promise.finally(() => clearTimeout(timer));
  }

  private resolveBatch(outcome: BatchOutcome): void {
    const waiter = this.batchWaiter;
    this.batchWaiter = undefined;
    waiter?.(outcome);
  }
}

let shared: ResultBoardRuntime | undefined;

/** runtime 與側邊欄共用的看板接線（同一個 content script 世界） */
export function getResultBoardRuntime(): ResultBoardRuntime {
  shared ??= new ResultBoardRuntime();
  return shared;
}
