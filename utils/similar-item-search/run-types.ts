/**
 * Similar Item Search 執行流程（ADR-0020 Decision 5）的外部介面：Trade transport、批次、事件。
 */
import type { ScoredResult } from './similarity';
import type { SimilarSearchPhase } from './types';

export type TransportOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; rateLimited: boolean; error: string; status?: number };

export interface SimilarSearchResponse {
  id: string;
  result: string[];
  total: number;
  inexact?: boolean;
}

/** `/fetch` 回應的一筆結果 */
export interface FetchedResult {
  id: string;
  item: unknown;
  listing?: unknown;
}

/** 官方 search 與 fetch；由頁面端用使用者自己的登入狀態送出，並經過限速閘門 */
export interface SimilarTradeTransport {
  search(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TransportOutcome<SimilarSearchResponse>>;
  fetch(
    ids: readonly string[],
    searchId: string,
    signal?: AbortSignal,
  ): Promise<TransportOutcome<FetchedResult[]>>;
}

export type SimilarBatchKind = 'strict' | 'relaxed' | 'similarity';

export interface SimilarBatch {
  /** 批次內唯一鍵：`strict`、`relaxed-1`、`similarity` */
  key: string;
  kind: SimilarBatchKind;
  /** 來源搜尋的官方 id；依 Similarity 排序的那一批沒有 */
  searchId?: string;
  total: number;
  inexact: boolean;
  weightMin?: number;
  /** 依顯示順序；每筆都已取得物品 */
  results: ScoredResult<FetchedResult>[];
}

/**
 * - `enough`：找到 10 筆以上且沒被截斷
 * - `search-limit`：用完 4 次搜尋
 * - `exhausted`：沒有可以再放寬的條件
 * - `rate-limited`：官方回 429
 * - `aborted`：使用者開始官方搜尋或關閉面板
 * - `error`：其他請求失敗
 */
export type SimilarStopReason =
  | 'enough'
  | 'search-limit'
  | 'exhausted'
  | 'rate-limited'
  | 'aborted'
  | 'error';

export type SimilarRunEvent =
  | { type: 'searching'; at: number; phase: SimilarSearchPhase; search: number; weightMin?: number }
  | { type: 'batch'; at: number; batch: SimilarBatch }
  | { type: 'stopped'; at: number; reason: SimilarStopReason; error?: string };

export interface SimilarRunDeps {
  transport: SimilarTradeTransport;
  englishStatText: (statId: string) => string | undefined;
  signal?: AbortSignal;
  onEvent?: (event: SimilarRunEvent) => void;
  /** 取得的物品交給頁面的結果快取，讓釘選、PoB 複製與外部連結讀得到 */
  remember?: (results: readonly FetchedResult[], searchId: string) => void;
  /** 換算成神聖石的價格；提供時依 Similarity 排序的那一批會把價格算進去 */
  priceInDivine?: (result: FetchedResult) => number | undefined;
  now?: () => number;
}

export interface SimilarRunResult {
  batches: SimilarBatch[];
  reason: SimilarStopReason;
  error?: string;
  searches: number;
  fetched: number;
  /** 因複雜度上限沒帶入的參考 stat */
  dropped: string[];
}
