import type { CriteriaOverlayOp } from '@/utils/criteria-overlay';
import { createPoeEventCriteriaOverlayChannel } from './criteria-overlay-session';

export interface FormUrlSyncDeps {
  /** 以官方 mutation 寫入（空序列＝只呼叫根元件 `save(true)`）。 */
  commit?: (ops: readonly CriteriaOverlayOp[]) => Promise<void>;
  readUrl?: () => string;
  wait?: (ms: number) => Promise<void>;
  /** 等待官方更新網址的最長時間。 */
  settleMs?: number;
  pollMs?: number;
}

const SEARCH_ROUTE = /\/trade2?\/search\//;
const DEFAULT_SETTLE_MS = 300;
const DEFAULT_POLL_MS = 25;

/** 只有官方搜尋路由有可寫入網址的搜尋表單（通貨兌換不適用）。 */
export function isTradeSearchFormUrl(url: string): boolean {
  return SEARCH_ROUTE.test(url);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 把官方搜尋表單目前的內容寫進網址後回傳網址（見 CONTEXT.md「Bookmark」、ADR-0010）。
 * 官方網址不會隨每次表單修改更新，因此加入書籤前必須先同步；同步失敗時拋出錯誤，
 * 呼叫端不得退回儲存可能過時的網址。
 */
export async function syncFormToUrl(deps: FormUrlSyncDeps = {}): Promise<string> {
  const readUrl = deps.readUrl ?? (() => window.location.href);
  const before = readUrl();
  if (!isTradeSearchFormUrl(before)) return before;

  const commit = deps.commit ?? ((ops) => createPoeEventCriteriaOverlayChannel().commit(ops));
  const wait = deps.wait ?? sleep;
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;

  try {
    await commit([]);
  } catch (error) {
    console.warn('[PoeXD] 同步搜尋表單到網址失敗:', error);
    throw new Error('無法同步目前搜尋表單，書籤未儲存，請稍後再試');
  }

  // 官方 save(true) 可能非同步更新網址：等到網址變化，或表單本來就已同步而在時限內維持不變
  for (let elapsed = 0; elapsed < settleMs; elapsed += pollMs) {
    if (readUrl() !== before) return readUrl();
    await wait(pollMs);
  }
  return readUrl();
}
