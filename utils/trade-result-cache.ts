/**
 * 目前市集頁收到的官方結果（`/fetch` 回應的 `{ id, item, listing }`），只存在記憶體。
 *
 * 一般頁面由 MAIN world 攔截官方 fetch 送進來；線上搜尋主控台由 PoeXD 自己的 `/fetch` 送進來。
 * PoB 複製、外部連結與釘選都從這裡讀取。內容是頁面送來的不可信輸入，取用端各自驗證。
 * `listing` 內的 token 只留在記憶體，不可寫入儲存或 log。
 */
import { parsePoeFetchResponse } from './event-contracts';

/** 即時搜尋會不斷收到新物品，只保留最近的這麼多筆 */
export const TRADE_RESULT_CACHE_LIMIT = 500;

export interface TradeResultEntry {
  id: string;
  item: unknown;
  listing: unknown;
  /** 取得這筆結果時的搜尋 id（`/fetch?query=`），不明時為 undefined */
  sourceSearchId?: string;
  league?: string;
  receivedAt: number;
}

export interface TradeResultContext {
  sourceSearchId?: string;
  league?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readQueryParam(url: string): string | undefined {
  try {
    const value = new URL(url, 'https://www.pathofexile.com').searchParams.get('query');
    return value || undefined;
  } catch {
    return undefined;
  }
}

export type TradeResultListener = () => void;

export class TradeResultCache {
  private readonly entries = new Map<string, TradeResultEntry>();
  private readonly listeners = new Set<TradeResultListener>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 處理 MAIN world 送來的 `poexd-fetch-response`；回傳是否加入任何結果 */
  ingestFetchResponse(detail: unknown, context: Omit<TradeResultContext, 'sourceSearchId'> = {}) {
    const payload = parsePoeFetchResponse(detail);
    const data = payload?.data;
    const results = isRecord(data) ? data.result : undefined;
    if (!payload || !Array.isArray(results)) return false;
    const sourceSearchId = readQueryParam(payload.url);
    let added = false;
    for (const raw of results) {
      added = this.ingestResult(raw, { ...context, sourceSearchId }) || added;
    }
    if (added) this.notify();
    return added;
  }

  /** 加入單筆 `{ id, item, listing }`；格式不符時忽略 */
  ingestResult(raw: unknown, context: TradeResultContext = {}): boolean {
    if (!isRecord(raw)) return false;
    const { id, item, listing } = raw;
    if (typeof id !== 'string' || !id || !isRecord(item)) return false;
    this.entries.delete(id);
    this.entries.set(id, {
      id,
      item,
      listing: isRecord(listing) ? listing : undefined,
      ...(context.sourceSearchId ? { sourceSearchId: context.sourceSearchId } : {}),
      ...(context.league ? { league: context.league } : {}),
      receivedAt: this.now(),
    });
    while (this.entries.size > TRADE_RESULT_CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }

  get(id: string): TradeResultEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  clear(): void {
    this.entries.clear();
    this.notify();
  }

  /** 某個搜尋目前留在快取裡的結果，依收到的順序 */
  entriesForSearch(searchId: string): TradeResultEntry[] {
    return Array.from(this.entries.values()).filter((entry) => entry.sourceSearchId === searchId);
  }

  /** 官方 fetch 回應加入結果、或快取清空時通知；回傳取消訂閱 */
  subscribe(listener: TradeResultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('[PoeXD] 結果快取訂閱者處理失敗:', error);
      }
    });
  }
}

let shared: TradeResultCache | undefined;

/** 同一個 content script 世界（runtime 與 Sidebar）共用的快取 */
export function getTradeResultCache(): TradeResultCache {
  shared ??= new TradeResultCache();
  return shared;
}
