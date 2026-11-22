import {
  parsePoeCriteriaOverlayCommit,
  parsePoeCriteriaOverlayRead,
  parsePoeCriteriaOverlaySync,
  serializePoeCriteriaOverlayCommitResult,
  serializePoeCriteriaOverlayReadResult,
  serializePoeCriteriaOverlaySyncResult,
  type PoeCriteriaOverlaySyncDiagnostics,
} from '@/utils/event-protocol-types';
import type { CriteriaOverlayOp } from '@/utils/criteria-overlay';
import type { MainWorldBridge } from './bridge-bootstrap';
import { saveAllCategoriesToSessionStorage, tagFilterDomElements } from './dom-tagger';
import type { HostVuexStore } from './host-types';
import {
  getTradeRootComponent,
  getVueStore,
  readKnownStatIds,
  type HostTradeRoot,
} from './poe-runtime-reader';

/** Criteria Overlay 擷取時讀取的 `state.persistent` 欄位。 */
const SNAPSHOT_KEYS = ['name', 'type', 'disc', 'term', 'status', 'filters', 'stats'] as const;

/**
 * 讀取官方搜尋表單的 JSON 快照。JSON 序列化會一併去除外掛加在 filter 上的
 * non-enumerable metadata（poexdCategory / poexdBindingId）。
 */
export function readCriteriaOverlaySnapshot(
  store: HostVuexStore | null,
): Record<string, unknown> | null {
  const persistent = store?.state?.persistent as Record<string, unknown> | undefined;
  if (!persistent) return null;
  const picked = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, persistent[key] ?? null]));
  return JSON.parse(JSON.stringify(picked));
}

function commitOp(store: HostVuexStore, root: HostTradeRoot | null, op: CriteriaOverlayOp) {
  switch (op.kind) {
    case 'setItem':
      return store.commit('setItem', { ...op.item });
    case 'setStatus':
      return store.commit('setStatus', op.status);
    case 'setPropertyFilter':
      // 官方 mutation 在 value 為空時刪除該欄位
      return store.commit('setPropertyFilter', {
        group: op.group,
        index: op.index,
        value: op.value ? { ...op.value } : {},
      });
    case 'setPropertyFilterGroupDisabled':
      if (typeof root?.setPropertyFilterGroupDisabled === 'function') {
        return root.setPropertyFilterGroupDisabled({ group: op.group, disable: op.disable });
      }
      return store.commit('setFilterGroupDisabled', {
        type: 'filters',
        group: op.group,
        disable: op.disable,
      });
    case 'pushStatGroup':
      return store.commit('pushStatGroup', {
        type: op.type,
        filters: JSON.parse(JSON.stringify(op.filters)),
      });
    case 'setStatGroupValue':
      return store.commit('setStatGroupValue', {
        group: op.group,
        value: op.value ? { ...op.value } : {},
      });
    case 'setStatGroupDisabled':
      return store.commit('setFilterGroupDisabled', {
        type: 'stats',
        group: op.group,
        disable: op.disable,
      });
    case 'setStatGroupFilters': {
      // 以官方 mutation 清空再逐一加入，群組留在原位
      const stats = (store.state?.persistent as { stats?: Array<{ filters?: unknown[] }> })?.stats;
      const current = stats?.[op.group]?.filters;
      if (!Array.isArray(current)) throw new Error(`stat group ${op.group} not found`);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        store.commit('removeStatFilter', { group: op.group, index });
      }
      op.filters.forEach((filter) =>
        store.commit('setStatFilter', {
          group: op.group,
          value: JSON.parse(JSON.stringify(filter)),
        }),
      );
      return;
    }
    case 'setStatFilter': {
      const payload: Record<string, unknown> = {
        group: op.group,
        value: JSON.parse(JSON.stringify(op.filter)),
      };
      if (op.index !== undefined) payload.index = op.index;
      return store.commit('setStatFilter', payload);
    }
    case 'removeStatGroup':
      return store.commit('removeStatGroup', { group: op.group });
  }
}

/** 把表單條件欄位整批還原為備份內容（ops 執行失敗、頁面導覽結束時使用）。 */
export function restoreCriteriaOverlaySnapshot(
  store: HostVuexStore,
  backup: Record<string, unknown>,
) {
  const persistent = store.state?.persistent as Record<string, unknown> | undefined;
  if (!persistent) return;
  store._withCommit(() => {
    SNAPSHOT_KEYS.forEach((key) => {
      persistent[key] = JSON.parse(JSON.stringify(backup[key] ?? null));
    });
  });
}

/**
 * 官方 `save(true)` 是 async：先 gzip `query`（CompressionStream）再 `history.pushState`，
 * 回傳的 promise 完成時網址才是最新的。
 */
function saveForm(store: HostVuexStore, root: HostTradeRoot | null): Promise<void> | void {
  if (typeof root?.save === 'function') {
    return root.save(true);
  }
  store.commit('setSearchDirty', undefined);
}

/**
 * 依序以官方 mutation 執行 ops，最後呼叫根元件 `save(true)` 同步網址、dirty 狀態與官方本機狀態。
 * 根元件不可用時退回只標記 dirty。任何一筆失敗時整批還原為執行前的表單，避免停在半套用狀態。
 * 回傳官方 save 的 promise（若有），呼叫端應等它完成後再回報，網址才會反映這次修改。
 */
export function executeCriteriaOverlayOps(
  store: HostVuexStore,
  root: HostTradeRoot | null,
  ops: readonly CriteriaOverlayOp[],
): Promise<void> | void {
  const backup = readCriteriaOverlaySnapshot(store);
  let saved: Promise<void> | void = undefined;
  try {
    ops.forEach((op) => commitOp(store, root, op));
  } catch (error) {
    if (backup) restoreCriteriaOverlaySnapshot(store, backup);
    throw error;
  } finally {
    saved = saveForm(store, root);
  }
  return saved;
}

export type CriteriaOverlaySyncOutcome =
  | { ok: true; url: string; diagnostics: PoeCriteriaOverlaySyncDiagnostics }
  | { ok: false; error: string; diagnostics: PoeCriteriaOverlaySyncDiagnostics };

/** 只取路由前兩段（例如 `trade/search`），不帶聯盟與查詢內容。 */
function describeRoute(pathname: string): string {
  return pathname.split('/').filter(Boolean).slice(0, 2).join('/');
}

/**
 * 以官方 `save(true)` 把目前搜尋表單寫進網址，不修改表單（見 GLOSSARY.md「Bookmark」、ADR-0010）。
 * 官方 `save` 在頁面尚未 `loaded` 時什麼都不做，若照常回報成功，呼叫端會存到過時的網址，
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
    hasSave: typeof root?.save === 'function',
    loaded: typeof root?.loaded === 'boolean' ? root.loaded : null,
  };
  const fail = (error: string, cause?: unknown): CriteriaOverlaySyncOutcome => {
    const failed = { ...diagnostics, elapsedMs: Date.now() - startedAt };
    console.error('[PoeXD] 同步搜尋表單到網址失敗（Main World）:', error, failed, cause ?? '');
    return { ok: false, error, diagnostics: failed };
  };

  if (!store) return fail('FORM_STATE_NOT_FOUND');
  if (!root || typeof root.save !== 'function') return fail('TRADE_ROOT_NOT_FOUND');
  if (root.loaded === false) return fail('PAGE_NOT_LOADED');

  try {
    await root.save(true);
  } catch (cause) {
    return fail(cause instanceof Error && cause.message ? cause.message : 'SAVE_FAILED', cause);
  }

  try {
    saveAllCategoriesToSessionStorage();
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
      const store = getVueStore();
      if (!store) throw new Error('FORM_STATE_NOT_FOUND');
      await executeCriteriaOverlayOps(store, getTradeRootComponent(), request.ops);
      saveAllCategoriesToSessionStorage();
      // 等官方重新渲染後，重新標記詞綴並計算類別綁定
      setTimeout(() => tagFilterDomElements(), 20);
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
