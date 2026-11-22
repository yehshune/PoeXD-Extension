import {
  parsePoeCriteriaOverlayCommit,
  parsePoeCriteriaOverlayRead,
  parsePoeCriteriaOverlaySync,
  serializePoeCriteriaOverlayCommitResult,
  serializePoeCriteriaOverlayReadResult,
  serializePoeCriteriaOverlaySyncResult,
  type PoeCriteriaOverlaySyncDiagnostics,
} from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import { mainWorldSearchForm as form, readCriteriaOverlaySnapshot } from './main-world-search-form';
import { getTradeRootComponent, getVueStore, readKnownStatIds } from './poe-runtime-reader';

export type CriteriaOverlaySyncOutcome =
  | { ok: true; url: string; diagnostics: PoeCriteriaOverlaySyncDiagnostics }
  | { ok: false; error: string; diagnostics: PoeCriteriaOverlaySyncDiagnostics };

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
  const diagnostics: PoeCriteriaOverlaySyncDiagnostics = {
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
  const unsubRead = bridge.addListener('poexd-criteria-overlay-read', (detail) => {
    const request = parsePoeCriteriaOverlayRead(detail);
    if (!request) return;
    let snapshot: Record<string, unknown> | null = null;
    let error: string | undefined;
    try {
      snapshot = readCriteriaOverlaySnapshot(getVueStore());
      if (!snapshot) error = 'FORM_STATE_NOT_FOUND';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    bridge.dispatchEvent(
      'poexd-criteria-overlay-read-result',
      serializePoeCriteriaOverlayReadResult({
        requestId: request.requestId,
        snapshot,
        knownStatIds: snapshot ? readKnownStatIds() : null,
        ...(error ? { error } : {}),
      }),
    );
  });

  const unsubCommit = bridge.addListener('poexd-criteria-overlay-commit', async (detail) => {
    const request = parsePoeCriteriaOverlayCommit(detail);
    if (!request) return;
    let error: string | undefined;
    try {
      await form.applyOverlayOps(request.ops);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    bridge.dispatchEvent(
      'poexd-criteria-overlay-commit-result',
      serializePoeCriteriaOverlayCommitResult({
        requestId: request.requestId,
        success: !error,
        ...(error ? { error } : {}),
      }),
    );
  });

  const unsubSync = bridge.addListener('poexd-criteria-overlay-sync', async (detail) => {
    const request = parsePoeCriteriaOverlaySync(detail);
    if (!request) return;
    let outcome: CriteriaOverlaySyncOutcome;
    try {
      outcome = await syncCriteriaOverlayFormToUrl();
    } catch (cause) {
      // 任何未預期的例外都要回覆，否則 Content World 只能等到逾時
      console.error('[PoeXD] 同步搜尋表單到網址時發生未預期錯誤:', cause);
      outcome = {
        ok: false,
        error: cause instanceof Error && cause.message ? cause.message : 'SYNC_FAILED',
        diagnostics: {},
      };
    }
    bridge.dispatchEvent(
      'poexd-criteria-overlay-sync-result',
      serializePoeCriteriaOverlaySyncResult(
        outcome.ok
          ? { requestId: request.requestId, success: true, url: outcome.url }
          : {
              requestId: request.requestId,
              success: false,
              error: outcome.error,
              diagnostics: outcome.diagnostics,
            },
      ),
    );
  });

  return () => {
    unsubRead();
    unsubCommit();
    unsubSync();
  };
}
