import type { CriteriaOverlayOp } from '@/utils/criteria-overlay';
import { t } from '@/utils/i18n';
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
 * 把官方搜尋表單目前的內容寫進網址後回傳網址（見 GLOSSARY.md「Bookmark」、ADR-0010）。
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
    // 帶出實際原因（例如官方頁面沒有回應時要重新整理），而不是一律要使用者稍後再試
    const reason = error instanceof Error ? error.message.trim() : '';
    throw new Error(t('formUrlSync.failed', { reason: reason || t('formUrlSync.unknownReason') }), {
      cause: error,
    });
  }

  // Main World 會等官方 async save(true) 寫完網址才回覆 commit；此輪詢只是保險：
  // 等到網址變化，或表單本來就已同步而在時限內維持不變
  for (let elapsed = 0; elapsed < settleMs; elapsed += pollMs) {
    if (readUrl() !== before) return readUrl();
    await wait(pollMs);
  }
  return readUrl();
}
