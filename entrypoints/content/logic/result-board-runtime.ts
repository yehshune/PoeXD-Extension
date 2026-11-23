/**
 * 搜尋結果看板在一般頁上的接線（GLOSSARY.md「Result Board」、ADR-0018）：
 * - 官方 search / fetch 回應 → 看板狀態（`ResultBoardSession`）
 * - 「載入更多」一律觸發官方自己的按鈕（`ResultBoardLoader`）
 * - 定位、前往藏身處都操作官方結果列，不改動官方列表；前往藏身處的連結過期時先按官方的
 *   「重新整理」，等官方按鈕恢復再前往
 * - 官方「前往藏身處」的點擊與 whisper 回應 → 已前往／已售出標記
 * - 官方結果數旁的捷徑按鈕
 *
 * 只在一般頁的搜尋模式啟用；側邊欄透過 `getResultBoardRuntime()` 取用。
 */
import { dispatchPoeEvent, listenPoeEvent, parsePoeFetchResponse } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { capturePinnedCardDom } from '@/utils/pinned-card-dom';
import { createPinnedItemSnapshot, type PinnedItemSnapshot } from '@/utils/pinned-items';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import {
  parseFetchFailure,
  parseSearchResultSummary,
  parseWhisperOutcome,
  readGoneFetchIds,
  readMissingFetchIds,
  type WhisperOutcome,
} from '@/utils/result-board/board-events';
import { ResultBoardLoader, type BatchOutcome } from '@/utils/result-board/board-loader';
import {
  ResultBoardSession,
  type BoardState,
  type CurrencyDisplay,
} from '@/utils/result-board/board-session';
import type { PoeVersion } from '@/utils/trade-context';
import { getTradeResultCache, type TradeResultCache } from '@/utils/trade-result-cache';
import { readOfficialRowCurrency } from '@/utils/trade-results-root';

/** 官方一次 search 最多回傳的結果 id 數 */
export const OFFICIAL_RESULT_CAP = 100;
/** 按下官方「前往藏身處」後，多久內收到的 whisper 回應算是那一筆的 */
const WHISPER_MATCH_WINDOW_MS = 20_000;
/** 官方 whisper 錯誤 code 1：物品已不存在（ADR-0017） */
const WHISPER_GONE_CODE = 1;
const LOCATE_HIGHLIGHT_MS = 2_000;
/** 官方結果列在 fetch 回應後才重繪，稍等再讀通貨圖示 */
const CURRENCY_SCAN_DELAY_MS = 300;
/** 等官方重新整理一筆結果、讓「前往藏身處」恢復可用的上限 */
export const TRAVEL_REFRESH_TIMEOUT_MS = 10_000;
const TRAVEL_REFRESH_POLL_MS = 100;

/**
 * 前往藏身處的結果：
 * - `travelled`：已按下官方按鈕
 * - `unavailable`：找不到結果列或沒有可用的按鈕（例如需要私訊的刊登）
 * - `busy`：連結過期、但正在載入更多，重新整理的 fetch 會和載入混在一起，先不處理
 * - `refresh-failed`：重新整理後按鈕仍未恢復（逾時、結果列消失或已下架）
 */
export type TravelOutcome = 'travelled' | 'unavailable' | 'busy' | 'refresh-failed';

const STYLE_ID = 'poexd-result-board-style';
const SHORTCUT_CLASS = 'poexd-board-shortcut';
const LOCATE_CLASS = 'poexd-board-locate';
const ROW_SELECTOR = '.resultset .row[data-id]';
const GONE_ROW_SELECTOR = '.row[data-id].gone';
/** 官方結果列上可納入看板搜尋的文字節點（品名、基底、詞綴、階級，排除按鈕與 UI 雜訊） */
const ENTRY_SEARCH_TEXT_SELECTOR =
  '.itemHeader .lc, .item-popup__header-line, .s.lc, [data-field^="stat."], .lc.l.pr, .lc.l.su';
const NATIVE_LAYOUT_BTN_SELECTOR = '.layout-btn';
const NATIVE_LAYOUT_GAP_PX = 8;
const NATIVE_LAYOUT_PITCH_PX = 38;

// 顏色一律用 oklch()（主題契約不允許原始 hex 色碼）
const STYLE_CONTENT = `
  .row.row-total > .${SHORTCUT_CLASS} {
    position: absolute;
    top: var(--poexd-native-btn-top, 0px);
    right: var(--poexd-board-shortcut-right, 8px);
    box-sizing: border-box;
    height: var(--poexd-native-btn-size, 30px);
    padding: 0 12px;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid oklch(0.387 0 0);
    border-radius: 0;
    background: oklch(0.245 0.006 250 / 0.96);
    color: oklch(0.858 0.068 82.8);
    box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
    font-family: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif;
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .row.row-total > .${SHORTCUT_CLASS}:hover {
    background: oklch(0.295 0.006 250);
    border-color: oklch(0.52 0.04 76);
    color: oklch(0.95 0.025 82);
  }
  .row.row-total > .${SHORTCUT_CLASS}:active {
    background: oklch(0.19 0.005 250);
  }
  .row.row-total > .${SHORTCUT_CLASS}:focus-visible {
    outline: 1px solid oklch(0.858 0.068 82.8);
    outline-offset: 1px;
  }
  @media (max-width: 639px) {
    .row.row-total:has(> .${SHORTCUT_CLASS}) {
      padding-top: 38px;
    }
  }
  .resultset .row.${LOCATE_CLASS} {
    outline: 2px solid oklch(0.858 0.068 82.8);
    outline-offset: -2px;
    transition: outline-color 0.3s;
  }
`;

/** 依官方 `.layout-btn` 尺寸與位置避開右排切換鈕；未排版或測試環境則依按鈕數推算右距 */
function syncShortcutLayout(button: HTMLButtonElement, rowTotal: Element): void {
  const layoutButtons = Array.from(
    rowTotal.querySelectorAll<HTMLElement>(NATIVE_LAYOUT_BTN_SELECTOR),
  );
  const measuredButtons = layoutButtons.filter(
    (btn) => Number.isFinite(btn.offsetHeight) && btn.offsetHeight >= 16 && btn.offsetHeight <= 64,
  );
  const rowWidth = (rowTotal as HTMLElement).clientWidth;
  if (measuredButtons.length > 0 && Number.isFinite(rowWidth) && rowWidth > 0) {
    const first = measuredButtons[0];
    const top = Number.isFinite(first.offsetTop) ? first.offsetTop : 0;
    const minLeft = Math.min(...measuredButtons.map((btn) => btn.offsetLeft));
    const right = Math.max(NATIVE_LAYOUT_GAP_PX, rowWidth - minLeft + NATIVE_LAYOUT_GAP_PX);
    button.style.setProperty('--poexd-native-btn-size', `${first.offsetHeight}px`);
    button.style.setProperty('--poexd-native-btn-top', `${top}px`);
    button.style.setProperty('--poexd-board-shortcut-right', `${right}px`);
    return;
  }
  const fallbackRight =
    layoutButtons.length > 0
      ? NATIVE_LAYOUT_GAP_PX + layoutButtons.length * NATIVE_LAYOUT_PITCH_PX
      : NATIVE_LAYOUT_GAP_PX;
  button.style.setProperty('--poexd-board-shortcut-right', `${fallbackRight}px`);
}

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
  const raw = readOfficialRowCurrency(row);
  if (!raw?.icon || !isValidPoeCdnImageUrl(raw.icon)) return undefined;
  return { icon: raw.icon, ...(raw.name ? { name: raw.name.slice(0, 64) } : {}) };
}

const isUsable = (button: HTMLElement | null | undefined): button is HTMLElement =>
  !!button && !button.hasAttribute('disabled') && !button.classList.contains('disabled');

const findTravelButton = (row: Element | null): HTMLElement | null =>
  row?.querySelector<HTMLElement>('.direct-btn') ?? null;

/** 官方在連結過期時把按鈕標成 `expired disabled`（提示 "Item must be refreshed"） */
const isExpired = (button: HTMLElement | null): boolean =>
  !!button && button.classList.contains('expired');

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
  private goneObserver: MutationObserver | undefined;
  private observedResultset: Element | null = null;

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

  /**
   * 按下官方結果列的「前往藏身處」。連結過期時先按官方的「重新整理」（只重新取得這一筆），
   * 等按鈕恢復可用再按；`onRefreshing` 在開始等待重新整理時呼叫一次。
   */
  async travel(id: string, onRefreshing?: () => void): Promise<TravelOutcome> {
    const row = findOfficialRow(id, this.doc);
    const button = findTravelButton(row);
    if (isUsable(button)) {
      button.click();
      return 'travelled';
    }
    if (!row || !isExpired(button)) return 'unavailable';
    if (this.loader.getState().running) return 'busy';

    // 已經在重新整理（例如連按兩次）就只等，不再送一次
    if (!row.classList.contains('refreshing')) {
      const refresh = row.querySelector<HTMLElement>('button.refresh');
      if (!isUsable(refresh)) return 'unavailable';
      refresh.click();
    }
    onRefreshing?.();

    const refreshed = await this.waitForTravelButton(id);
    if (!refreshed) return 'refresh-failed';
    refreshed.click();
    return 'travelled';
  }

  /** 等官方重新整理完：同一筆結果列的按鈕不再過期且可用；結果列消失或逾時則放棄 */
  private async waitForTravelButton(id: string): Promise<HTMLElement | undefined> {
    for (let waited = 0; waited < TRAVEL_REFRESH_TIMEOUT_MS; waited += TRAVEL_REFRESH_POLL_MS) {
      await new Promise((resolve) => setTimeout(resolve, TRAVEL_REFRESH_POLL_MS));
      if (!this.enabled) return undefined;
      const row = findOfficialRow(id, this.doc);
      if (!row) return undefined;
      const button = findTravelButton(row);
      if (!row.classList.contains('refreshing') && !isExpired(button) && isUsable(button)) {
        return button;
      }
    }
    return undefined;
  }

  /** 讀取官方結果列上的顯示文字（含市集漢化後的品名、基底、詞綴與階級）供看板搜尋 */
  readEntrySearchLines(id: string): readonly string[] {
    const row = findOfficialRow(id, this.doc);
    if (!row) return [];
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const el of row.querySelectorAll(ENTRY_SEARCH_TEXT_SELECTOR)) {
      const text = el.textContent?.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      lines.push(text);
    }
    return lines;
  }

  /** 按下官方結果列上 PoeXD 的釘選按鈕（與在結果列上釘選相同）；沒有按鈕時回傳 false */
  pin(id: string): boolean {
    const button = findOfficialRow(id, this.doc)?.querySelector<HTMLElement>('.poexd-pin-btn');
    if (!button) return false;
    button.click();
    return true;
  }

  /** 官方結果數列的捷徑按鈕；結果列重繪後重新放回去並避開官方 layout-btn */
  ensureShortcut(): void {
    if (!this.enabled) return;
    const rowTotal = this.doc.querySelector('.row.row-total');
    if (!rowTotal) return;
    const existing = rowTotal.querySelector<HTMLButtonElement>(`.${SHORTCUT_CLASS}`);
    const label = t('resultBoard.shortcut');
    if (existing) {
      if (existing.textContent !== label) existing.textContent = label;
      syncShortcutLayout(existing, rowTotal);
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
    syncShortcutLayout(button, rowTotal);
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
    this.ensureStyle();
    this.cleanups = [
      listenPoeEvent('poexd-search-result-summary', (detail) => {
        const summary = parseSearchResultSummary(detail);
        if (!summary) return;
        this.session.setSummary(summary);
        this.ensureShortcut();
        this.ensureGoneObserver();
      }),
      listenPoeEvent('poexd-fetch-response', (detail) => this.handleFetchResponse(detail)),
      listenPoeEvent('poexd-fetch-failed', (detail) => {
        const failure = parseFetchFailure(detail);
        if (failure) this.resolveBatch({ kind: 'failed', status: failure.status });
      }),
      listenPoeEvent('poexd-whisper-outcome', (detail) => {
        const outcome = parseWhisperOutcome(detail);
        if (outcome) this.handleWhisperOutcome(outcome);
      }),
      this.cache.subscribe(() => {
        this.session.observeFetch(this.lastFetchSearchId);
        this.ensureShortcut();
        this.ensureGoneObserver();
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
    this.ensureGoneObserver();
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
    this.ensureGoneObserver();
    this.resolveBatch({ kind: 'loaded' });
  }

  /** 只觀察 `.resultset` 的 `.row` 新增與 `class` 變更，同步官方「Item no longer available」(.gone) */
  private ensureGoneObserver(): void {
    if (!this.enabled) return;
    const resultset = this.doc.querySelector('.resultset');
    if (!resultset) {
      this.disconnectGoneObserver();
      return;
    }
    if (resultset === this.observedResultset) return;
    this.disconnectGoneObserver();
    this.observedResultset = resultset;
    const Observer = this.doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    if (typeof Observer === 'function') {
      this.goneObserver = new Observer((mutations) => this.handleResultsetMutations(mutations));
      this.goneObserver.observe(resultset, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    this.scanGoneRows(resultset);
  }

  private disconnectGoneObserver(): void {
    this.goneObserver?.disconnect();
    this.goneObserver = undefined;
    this.observedResultset = null;
  }

  private handleResultsetMutations(mutations: readonly MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target.nodeType === 1) {
          const el = target as Element;
          if (el.classList.contains('row') && el.classList.contains('gone')) {
            const id = el.getAttribute('data-id');
            if (id) this.session.markSold(id);
          }
        }
        continue;
      }
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          const el = node as Element;
          if (el.classList.contains('row') && el.classList.contains('gone')) {
            const id = el.getAttribute('data-id');
            if (id) this.session.markSold(id);
          } else {
            this.scanGoneRows(el);
          }
        }
      }
    }
  }

  private scanGoneRows(root: Element): void {
    for (const row of root.querySelectorAll(GONE_ROW_SELECTOR)) {
      const id = row.getAttribute('data-id');
      if (id) this.session.markSold(id);
    }
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
    this.disconnectGoneObserver();
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

  /** 官方「前往藏身處」按鈕（直購刊登）：記下待確認請求，等 whisper 回應成功才標記已前往／已售出 */
  private readonly handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const button = target?.closest?.('.direct-btn') as HTMLElement | null;
    if (!isUsable(button) || isExpired(button)) return;
    const row = button.closest?.(ROW_SELECTOR);
    const id = row?.getAttribute('data-id');
    if (!id) return;
    this.pendingTravels = [...this.pendingTravels, { id, at: this.now() }];
  };

  /** whisper 回應依序對應最早按下、且還在時限內的那一次「前往藏身處」 */
  private handleWhisperOutcome(outcome: WhisperOutcome): void {
    const now = this.now();
    const [pending, ...rest] = this.pendingTravels.filter(
      (entry) => now - entry.at <= WHISPER_MATCH_WINDOW_MS,
    );
    this.pendingTravels = rest;
    if (!pending) return;
    if (outcome.code === WHISPER_GONE_CODE) {
      this.session.markSold(pending.id);
      return;
    }
    if (outcome.status >= 200 && outcome.status < 300 && outcome.success === true) {
      this.session.markVisited(pending.id);
    }
  }
}

let shared: ResultBoardRuntime | undefined;

/** runtime 與側邊欄共用的看板接線（同一個 content script 世界） */
export function getResultBoardRuntime(): ResultBoardRuntime {
  shared ??= new ResultBoardRuntime();
  return shared;
}
