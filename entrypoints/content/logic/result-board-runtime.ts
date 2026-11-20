/**
 * 搜尋結果看板在一般頁上的接線（CONTEXT.md「Result Board」、ADR-0018）：
 * - 官方 search / fetch 回應 → 看板狀態（`ResultBoardSession`）
 * - 「載入更多」一律觸發官方自己的按鈕（`ResultBoardLoader`）
 * - 定位、前往藏身處都操作官方結果列，不改動官方列表
 * - 官方「前往藏身處」的點擊與 whisper 回應 → 已前往／已售出標記
 * - 官方結果數旁的捷徑按鈕
 *
 * 只在一般頁的搜尋模式啟用；側邊欄透過 `getResultBoardRuntime()` 取用。
 */
import { dispatchPoeEvent, listenPoeEvent, parsePoeFetchResponse } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import {
  parseFetchFailure,
  parseSearchResultSummary,
  parseWhisperOutcome,
  readMissingFetchIds,
} from '@/utils/result-board/board-events';
import { ResultBoardLoader, type BatchOutcome } from '@/utils/result-board/board-loader';
import {
  ResultBoardSession,
  type BoardState,
  type CurrencyDisplay,
} from '@/utils/result-board/board-session';
import { getTradeResultCache, type TradeResultCache } from '@/utils/trade-result-cache';

/** 官方一次 search 最多回傳的結果 id 數 */
export const OFFICIAL_RESULT_CAP = 100;
/** 按下官方「前往藏身處」後，多久內收到的 whisper 回應算是那一筆的 */
const WHISPER_MATCH_WINDOW_MS = 20_000;
/** 官方 whisper 錯誤 code 1：物品已不存在（ADR-0017） */
const WHISPER_GONE_CODE = 1;
const LOCATE_HIGHLIGHT_MS = 2_000;
/** 官方結果列在 fetch 回應後才重繪，稍等再讀通貨圖示 */
const CURRENCY_SCAN_DELAY_MS = 300;

const STYLE_ID = 'poexd-result-board-style';
const SHORTCUT_CLASS = 'poexd-board-shortcut';
const LOCATE_CLASS = 'poexd-board-locate';
const ROW_SELECTOR = '.resultset .row[data-id]';

const STYLE_CONTENT = `
  .row.row-total > .${SHORTCUT_CLASS} {
    margin-left: 8px;
    padding: 2px 8px;
    border: 1px solid oklch(0.58 0.08 82.8);
    background: transparent;
    color: oklch(0.858 0.068 82.8);
    font-size: 12px;
    cursor: pointer;
  }
  .row.row-total > .${SHORTCUT_CLASS}:hover {
    background: oklch(0.58 0.08 82.8 / 0.2);
  }
  .resultset .row.${LOCATE_CLASS} {
    outline: 2px solid oklch(0.858 0.068 82.8);
    outline-offset: -2px;
    transition: outline-color 0.3s;
  }
`;

const fetchSearchId = (url: string): string | undefined => {
  try {
    return new URL(url, window.location.origin).searchParams.get('query') || undefined;
  } catch {
    return undefined;
  }
};

export function findOfficialRow(id: string, doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-id="${CSS.escape(id)}"]`);
}

/** 官方結果列上的通貨圖示與名稱；網址不是 PoE CDN 時不採用 */
export function readRowCurrency(row: Element): CurrencyDisplay | undefined {
  const img = row.querySelector<HTMLImageElement>('.price .currency-image img');
  const icon = img?.getAttribute('src') ?? undefined;
  if (!img || !isValidPoeCdnImageUrl(icon)) return undefined;
  const name =
    img.closest('.currency-image')?.querySelector(':scope > span')?.textContent?.trim() ||
    img.getAttribute('title') ||
    undefined;
  return { icon, ...(name ? { name: name.slice(0, 64) } : {}) };
}

function findLoadMoreButton(doc: Document): HTMLElement | null {
  const button = doc.querySelector<HTMLElement>('.results .load-more-btn, .load-more-btn');
  if (!button || button.hasAttribute('disabled') || button.classList.contains('disabled')) {
    return null;
  }
  return button;
}

export class ResultBoardRuntime {
  readonly session: ResultBoardSession;
  readonly loader: ResultBoardLoader;
  private enabled = false;
  private lastFetchSearchId: string | undefined;
  /** 已按下、還在等 whisper 回應的「前往藏身處」（依按下順序） */
  private pendingTravels: readonly { id: string; at: number }[] = [];
  /** 目前這次搜尋（搜尋 id 相同的重新搜尋也算新的一次） */
  private observedSearch: { searchId: string; startedAt: number } | undefined;
  private batchWaiter: ((outcome: BatchOutcome) => void) | undefined;
  private armedBatch: Promise<BatchOutcome> | undefined;
  private cleanups: (() => void)[] = [];
  private readonly highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
    const row = findOfficialRow(id, this.doc);
    if (!row) return false;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add(LOCATE_CLASS);
    clearTimeout(this.highlightTimers.get(id));
    this.highlightTimers.set(
      id,
      setTimeout(() => {
        row.classList.remove(LOCATE_CLASS);
        this.highlightTimers.delete(id);
      }, LOCATE_HIGHLIGHT_MS),
    );
    return true;
  }

  /** 按下官方結果列的「前往藏身處」；沒有可用的按鈕時回傳 false */
  travel(id: string): boolean {
    const button = findOfficialRow(id, this.doc)?.querySelector<HTMLElement>('.direct-btn');
    if (!button || button.hasAttribute('disabled') || button.classList.contains('disabled')) {
      return false;
    }
    button.click();
    return true;
  }

  /** 按下官方結果列上 PoeXD 的釘選按鈕（與在結果列上釘選相同）；沒有按鈕時回傳 false */
  pin(id: string): boolean {
    const button = findOfficialRow(id, this.doc)?.querySelector<HTMLElement>('.poexd-pin-btn');
    if (!button) return false;
    button.click();
    return true;
  }

  /** 官方結果數旁的捷徑按鈕；結果列重繪後重新放回去 */
  ensureShortcut(): void {
    if (!this.enabled) return;
    const rowTotal = this.doc.querySelector('.row.row-total');
    if (!rowTotal) return;
    const existing = rowTotal.querySelector<HTMLButtonElement>(`.${SHORTCUT_CLASS}`);
    const label = t('resultBoard.shortcut');
    if (existing) {
      if (existing.textContent !== label) existing.textContent = label;
      return;
    }
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = SHORTCUT_CLASS;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      dispatchPoeEvent('poexd-open-result-board');
    });
    rowTotal.appendChild(button);
  }

  cleanup(): void {
    this.setEnabled(false);
  }

  private attach(): void {
    this.ensureStyle();
    this.cleanups = [
      listenPoeEvent('poexd-search-result-summary', (detail) => {
        const summary = parseSearchResultSummary(detail);
        if (!summary) return;
        this.session.setSummary(summary);
        this.ensureShortcut();
      }),
      listenPoeEvent('poexd-fetch-response', (detail) => this.handleFetchResponse(detail)),
      listenPoeEvent('poexd-fetch-failed', (detail) => {
        const failure = parseFetchFailure(detail);
        if (failure) this.resolveBatch({ kind: 'failed', status: failure.status });
      }),
      listenPoeEvent('poexd-whisper-outcome', (detail) => {
        const outcome = parseWhisperOutcome(detail);
        if (outcome) this.handleWhisperOutcome(outcome.code);
      }),
      this.cache.subscribe(() => {
        this.session.observeFetch(this.lastFetchSearchId);
        this.ensureShortcut();
        this.scheduleCurrencyScan();
      }),
      this.session.subscribe((state) => this.handleSearchChange(state)),
    ];
    const { searchId, startedAt } = this.session.getState();
    this.observedSearch = { searchId, startedAt };
    this.doc.addEventListener('click', this.handleDocumentClick, true);
    this.cleanups.push(() => this.doc.removeEventListener('click', this.handleDocumentClick, true));
    this.adoptSearchFromUrl();
    this.ensureShortcut();
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
    this.session.skipMissing(searchId, readMissingFetchIds(payload.url, payload.data));
    this.resolveBatch({ kind: 'loaded' });
  }

  /** 換搜尋時停下進行中的載入、清掉上一次的停止原因與等待中的前往藏身處 */
  private handleSearchChange({ searchId, startedAt }: BoardState): void {
    const observed = this.observedSearch;
    if (observed?.searchId === searchId && observed.startedAt === startedAt) return;
    this.observedSearch = { searchId, startedAt };
    this.pendingTravels = [];
    this.loader.reset();
  }

  private detach(): void {
    this.loader.reset();
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.resolveBatch({ kind: 'timeout' });
    this.armedBatch = undefined;
    clearTimeout(this.currencyScanTimer);
    this.highlightTimers.forEach((timer) => clearTimeout(timer));
    this.highlightTimers.clear();
    this.doc.querySelectorAll(`.${SHORTCUT_CLASS}`).forEach((element) => element.remove());
    this.doc.querySelectorAll(`.${LOCATE_CLASS}`).forEach((element) => {
      element.classList.remove(LOCATE_CLASS);
    });
    this.doc.getElementById(STYLE_ID)?.remove();
  }

  private ensureStyle(): void {
    if (this.doc.getElementById(STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_CONTENT;
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
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

  /** 官方「前往藏身處」按鈕（直購刊登）：標記已前往，並等待 whisper 回應判斷是否已售出 */
  private readonly handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const button = target?.closest?.('.direct-btn');
    const row = button?.closest?.(ROW_SELECTOR);
    const id = row?.getAttribute('data-id');
    if (!id) return;
    this.session.markVisited(id);
    this.pendingTravels = [...this.pendingTravels, { id, at: this.now() }];
  };

  /** whisper 回應依序對應最早按下、且還在時限內的那一次「前往藏身處」 */
  private handleWhisperOutcome(code: number | undefined): void {
    const now = this.now();
    const [pending, ...rest] = this.pendingTravels.filter(
      (entry) => now - entry.at <= WHISPER_MATCH_WINDOW_MS,
    );
    this.pendingTravels = rest;
    if (pending && code === WHISPER_GONE_CODE) this.session.markSold(pending.id);
  }
}

let shared: ResultBoardRuntime | undefined;

/** runtime 與側邊欄共用的看板接線（同一個 content script 世界） */
export function getResultBoardRuntime(): ResultBoardRuntime {
  shared ??= new ResultBoardRuntime();
  return shared;
}
