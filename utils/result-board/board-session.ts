/**
 * 一個市集頁上看板的狀態：目前的搜尋、帳本、暫時隱藏的賣家、已前往／已售出標記。
 *
 * 只存在記憶體；換搜尋時全部重來（GLOSSARY.md「Result Board」）。狀態是不可變的值，
 * 每次變更都換成新的物件並通知訂閱者。
 */
import type { TradeResultEntry } from '@/utils/trade-result-cache';
import type { SearchResultSummary } from './board-events';
import { appendToLedger, createLedger, skipInLedger, type BoardLedger } from './board-ledger';

export type BoardMark = 'visited' | 'sold';

/** 官方結果列上的通貨顯示（官方 fetch 回應沒有通貨圖示） */
export interface CurrencyDisplay {
  icon: string;
  name?: string;
}

export interface BoardState {
  /** 目前的搜尋；還沒看到任何搜尋時為空字串 */
  searchId: string;
  /** 官方 search 回應的摘要；沒觀察到時為 undefined */
  summary?: SearchResultSummary;
  ledger: BoardLedger;
  hiddenAccounts: ReadonlySet<string>;
  /** 以結果 id 為 key */
  marks: Readonly<Record<string, BoardMark>>;
  /**
   * 這次搜尋開始的時間：只收這之後才取得的結果。同樣條件重新搜尋時官方給的搜尋 id 不變，
   * 快取裡上一輪的結果不能混進來。從 fetch 接手的搜尋為 0（不知道何時開始）。
   */
  startedAt: number;
  /** 通貨代碼 → 圖示；從官方結果列學到，換搜尋時保留 */
  currencies: Readonly<Record<string, CurrencyDisplay>>;
}

export type BoardEntrySource = (searchId: string) => readonly TradeResultEntry[];

const emptyState = (
  searchId: string,
  startedAt: number,
  currencies: BoardState['currencies'],
): BoardState => ({
  searchId,
  ledger: createLedger(searchId),
  hiddenAccounts: new Set(),
  marks: {},
  startedAt,
  currencies,
});

export class ResultBoardSession {
  private state: BoardState = emptyState('', 0, {});
  private readonly listeners = new Set<(state: BoardState) => void>();

  constructor(
    private readonly readEntries: BoardEntrySource,
    private readonly now: () => number = Date.now,
  ) {}

  getState(): BoardState {
    return this.state;
  }

  subscribe(listener: (state: BoardState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 官方 search 回應：每次都是新的一次搜尋（即使搜尋 id 相同），看板重來 */
  setSummary(summary: SearchResultSummary): void {
    this.commit({
      ...emptyState(summary.searchId, this.now(), this.state.currencies),
      summary,
    });
  }

  /**
   * 官方 fetch 回應帶來的搜尋 id。沒觀察到 search 回應（例如擴充比官方搜尋晚載入）時，
   * 以 fetch 的搜尋 id 切換；同一個搜尋則只補進新結果。
   * 已有目前搜尋的摘要時，其他搜尋晚到的 fetch 一律忽略。
   */
  observeFetch(searchId: string | undefined): void {
    if (!searchId || this.isStale(searchId)) return;
    const base =
      searchId === this.state.searchId
        ? this.state
        : emptyState(searchId, 0, this.state.currencies);
    this.commit(this.withCacheEntries(base));
  }

  /** 這個搜尋 id 是不是已被目前的搜尋取代（有摘要才能確定） */
  isStale(searchId: string): boolean {
    return this.state.summary !== undefined && searchId !== this.state.searchId;
  }

  /** 官方 fetch 有要卻沒回傳的結果（已下架，官方回 null）：算進已取得，不會再出現 */
  skipMissing(searchId: string, ids: readonly string[]): void {
    if (ids.length === 0 || searchId !== this.state.searchId) return;
    const ledger = skipInLedger(this.state.ledger, ids);
    if (ledger !== this.state.ledger) this.commit({ ...this.state, ledger });
  }

  /** 記下新看到的通貨圖示（已知的不覆蓋） */
  learnCurrencies(found: Readonly<Record<string, CurrencyDisplay>>): void {
    const added = Object.entries(found).filter(
      ([code]) => !Object.hasOwn(this.state.currencies, code),
    );
    if (added.length === 0) return;
    this.commit({
      ...this.state,
      currencies: { ...this.state.currencies, ...Object.fromEntries(added) },
    });
  }

  hideSeller(account: string): void {
    if (this.state.hiddenAccounts.has(account)) return;
    this.commit({
      ...this.state,
      hiddenAccounts: new Set([...this.state.hiddenAccounts, account]),
    });
  }

  showSeller(account: string): void {
    if (!this.state.hiddenAccounts.has(account)) return;
    const next = new Set(this.state.hiddenAccounts);
    next.delete(account);
    this.commit({ ...this.state, hiddenAccounts: next });
  }

  showAllSellers(): void {
    if (this.state.hiddenAccounts.size === 0) return;
    this.commit({ ...this.state, hiddenAccounts: new Set() });
  }

  /** 已售出不會被改回已前往 */
  markVisited(id: string): void {
    if (this.state.marks[id]) return;
    this.commit({ ...this.state, marks: { ...this.state.marks, [id]: 'visited' } });
  }

  markSold(id: string): void {
    if (this.state.marks[id] === 'sold') return;
    this.commit({ ...this.state, marks: { ...this.state.marks, [id]: 'sold' } });
  }

  private withCacheEntries(state: BoardState): BoardState {
    if (!state.searchId) return state;
    const fresh = this.readEntries(state.searchId).filter(
      (entry) => entry.receivedAt >= state.startedAt,
    );
    const ledger = appendToLedger(state.ledger, fresh);
    return ledger === state.ledger ? state : { ...state, ledger };
  }

  private commit(next: BoardState): void {
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((listener) => {
      try {
        listener(next);
      } catch {
        // 一個訂閱者出錯不影響其他訂閱者
      }
    });
  }
}
