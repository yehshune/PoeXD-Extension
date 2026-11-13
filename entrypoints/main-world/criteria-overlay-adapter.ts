import {
  parsePoeCriteriaOverlayCommit,
  parsePoeCriteriaOverlayRead,
  serializePoeCriteriaOverlayCommitResult,
  serializePoeCriteriaOverlayReadResult,
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

/** 把表單條件欄位整批還原為備份內容（只在 ops 執行失敗時使用）。 */
function restoreSnapshot(store: HostVuexStore, backup: Record<string, unknown>) {
  const persistent = store.state?.persistent as Record<string, unknown> | undefined;
  if (!persistent) return;
  store._withCommit(() => {
    SNAPSHOT_KEYS.forEach((key) => {
      persistent[key] = JSON.parse(JSON.stringify(backup[key] ?? null));
    });
  });
}

function saveForm(store: HostVuexStore, root: HostTradeRoot | null) {
  if (typeof root?.save === 'function') {
    root.save(true);
  } else {
    store.commit('setSearchDirty', undefined);
  }
}

/**
 * 依序以官方 mutation 執行 ops，最後呼叫根元件 `save(true)` 同步網址、dirty 狀態與官方本機狀態。
 * 根元件不可用時退回只標記 dirty。任何一筆失敗時整批還原為執行前的表單，避免停在半套用狀態。
 */
export function executeCriteriaOverlayOps(
  store: HostVuexStore,
  root: HostTradeRoot | null,
  ops: readonly CriteriaOverlayOp[],
) {
  const backup = readCriteriaOverlaySnapshot(store);
  try {
    ops.forEach((op) => commitOp(store, root, op));
  } catch (error) {
    if (backup) restoreSnapshot(store, backup);
    throw error;
  } finally {
    saveForm(store, root);
  }
}

export function initCriteriaOverlayAdapter(bridge: MainWorldBridge) {
  const unsubRead = bridge.addListener('poexd-criteria-overlay-read', (detail) => {
    const request = parsePoeCriteriaOverlayRead(detail);
    if (!request) return;
    let snapshot: Record<string, unknown> | null = null;
    let error: string | undefined;
    try {
      snapshot = readCriteriaOverlaySnapshot(getVueStore());
      if (!snapshot) error = '找不到官方搜尋表單狀態';
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

  const unsubCommit = bridge.addListener('poexd-criteria-overlay-commit', (detail) => {
    const request = parsePoeCriteriaOverlayCommit(detail);
    if (!request) return;
    let error: string | undefined;
    try {
      const store = getVueStore();
      if (!store) throw new Error('找不到官方搜尋表單狀態');
      executeCriteriaOverlayOps(store, getTradeRootComponent(), request.ops);
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

  return () => {
    unsubRead();
    unsubCommit();
  };
}
