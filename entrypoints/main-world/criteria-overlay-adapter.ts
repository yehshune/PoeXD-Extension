import { rpcFail, type RpcDiagnostics } from '@/utils/cross-world-rpc';
import type { MainWorldBridge } from './bridge-bootstrap';
import { mainWorldSearchForm as form, readCriteriaOverlaySnapshot } from './main-world-search-form';
import { getTradeRootComponent, getVueStore, readKnownStatIds } from './poe-runtime-reader';

export type CriteriaOverlaySyncOutcome =
  | { ok: true; url: string; diagnostics: RpcDiagnostics }
  | { ok: false; error: string; diagnostics: RpcDiagnostics };

/** 只取路由前兩段（例如 `trade/search`），不帶聯盟與查詢內容。 */
function describeRoute(pathname: string): string {
  return pathname.split('/').filter(Boolean).slice(0, 2).join('/');
}

/**
 * 把目前搜尋表單寫進網址，不修改表單（見 GLOSSARY.md「Bookmark」、ADR-0010）。
 *
 * 優先用官方 `updateUrl()`（`history.replaceState`）：不標記 search dirty，官方「啟動即時搜尋」
 * 按鈕不會因加入書籤而隱藏；也不新增歷史紀錄，「上一頁」不會退回同步前並清空結果；
 * Category Binding 會延續同一個 session。官方沒有 `updateUrl` 時才退回 `save(true)`。
 *
 * 官方頁面尚未 `loaded` 時表單還不是使用者看到的內容，若照常回報成功，呼叫端會存到過時的網址，
 * 因此先檢查並回報明確的錯誤代碼。
 */
export async function syncCriteriaOverlayFormToUrl(): Promise<CriteriaOverlaySyncOutcome> {
  const startedAt = Date.now();
  const before = window.location.href;
  const store = getVueStore();
  const root = getTradeRootComponent();
  const diagnostics: RpcDiagnostics = {
    route: describeRoute(window.location.pathname),
    storeFound: !!store,
    rootFound: !!root,
    hasUpdateUrl: typeof root?.updateUrl === 'function',
    hasSave: typeof root?.save === 'function',
    loaded: typeof root?.loaded === 'boolean' ? root.loaded : null,
  };
  const fail = (error: string, cause?: unknown): CriteriaOverlaySyncOutcome => {
    const failed = { ...diagnostics, elapsedMs: Date.now() - startedAt };
    console.error('[PoeXD] 同步搜尋表單到網址失敗（Main World）:', error, failed, cause ?? '');
    return { ok: false, error, diagnostics: failed };
  };

  if (!store) return fail('FORM_STATE_NOT_FOUND');
  const updateUrl = typeof root?.updateUrl === 'function' ? root.updateUrl.bind(root) : null;
  const save = typeof root?.save === 'function' ? root.save.bind(root) : null;
  if (!root || (!updateUrl && !save)) return fail('TRADE_ROOT_NOT_FOUND');
  if (root.loaded === false) return fail('PAGE_NOT_LOADED');

  diagnostics.method = updateUrl ? 'updateUrl' : 'save';
  try {
    await (updateUrl ? updateUrl() : save!(true));
  } catch (cause) {
    return fail(cause instanceof Error && cause.message ? cause.message : 'SAVE_FAILED', cause);
  }

  try {
    form.persistBindings();
  } catch (error) {
    // 網址已寫入，類別綁定保存失敗不影響同步結果
    console.error('[PoeXD] 同步網址後保存詞綴類別失敗:', error);
  }

  const url = window.location.href;
  return {
    ok: true,
    url,
    diagnostics: { ...diagnostics, urlChanged: url !== before, elapsedMs: Date.now() - startedAt },
  };
}

export function initCriteriaOverlayAdapter(bridge: MainWorldBridge) {
  const unsubRead = bridge.handle('criteria-overlay.read', () => {
    const snapshot = readCriteriaOverlaySnapshot(getVueStore());
    if (!snapshot) return rpcFail('FORM_STATE_NOT_FOUND', 'FORM_STATE_NOT_FOUND');
    return {
      snapshot,
      knownStatIds: readKnownStatIds(),
    };
  });

  const unsubCommit = bridge.handle('criteria-overlay.commit', async ({ ops }) => {
    await form.applyOverlayOps(ops);
    return null;
  });

  const unsubSync = bridge.handle('criteria-overlay.sync', async () => {
    try {
      const outcome = await syncCriteriaOverlayFormToUrl();
      if (outcome.ok) return { url: outcome.url };
      return rpcFail(outcome.error, outcome.error, outcome.diagnostics);
    } catch (cause) {
      console.error('[PoeXD] 同步搜尋表單到網址時發生未預期錯誤:', cause);
      const message = cause instanceof Error && cause.message ? cause.message : 'SYNC_FAILED';
      return rpcFail(message, message, {});
    }
  });

  return () => {
    unsubRead();
    unsubCommit();
    unsubSync();
  };
}
