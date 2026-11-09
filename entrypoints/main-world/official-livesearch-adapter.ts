import type {
  PoeLiveSearchCommandResultPayload,
  PoeLiveSearchEnsureContainerPayload,
  PoeLiveSearchRenderResultPayload,
  PoeLiveSearchResetUnreadPayload,
  PoeLiveSearchSyncTotalPayload,
} from '@/utils/event-protocol-types';
import {
  parsePoeLiveSearchRenderResult,
  serializePoeLiveSearchCommandResult,
} from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import type { HostResultBatch, HostSearchObject, HostVuexStore } from './host-types';
import { getVueStore } from './poe-runtime-reader';

/**
 * 檢查 Store 是否具備指定的官方 mutation
 * 依據 Vuex 既有 _mutations 註冊表進行確鑿判定
 */
export function hasStoreMutation(store: HostVuexStore, mutationName: string): boolean {
  const mutations = (store as Record<string, unknown>)._mutations as
    | Record<string, unknown>
    | undefined;
  if (!mutations || typeof mutations !== 'object') {
    return false;
  }
  return Boolean(mutations[mutationName]);
}

/**
 * 檢查官方 Vuex Store 是否已初始化並具備必要狀態結構與 mutation 註冊表
 */
export function isReady(store?: HostVuexStore | null): boolean {
  const s = store !== undefined ? store : getVueStore();
  if (!s || typeof s.commit !== 'function') return false;
  if (!s.state || typeof s.state !== 'object') return false;
  const mutations = (s as Record<string, unknown>)._mutations;
  if (!mutations || typeof mutations !== 'object') return false;
  return true;
}

export interface EnsureDisplayContainerResult {
  success: boolean;
  localId: string;
  error?: string;
}

/**
 * 建立或重用 synthetic displaySearch 容器並設為 active
 * 依據 Phase 2A/2B 確鑿契約：
 * - 執行前驗證官方 addSearchQuery 與 setSearchActive mutations
 * - localId 由 PoeXD Primary Runtime 提供，Adapter 不持有 session identity
 * - 若已存在則重用，不重複建立
 * - 不發起 /search 網路請求
 * - 建立後以實際 Store State 驗證，絕不依賴假性 fallback
 */
export function ensureDisplayContainer(
  params: PoeLiveSearchEnsureContainerPayload,
  store?: HostVuexStore | null,
): EnsureDisplayContainerResult {
  if (!params || typeof params.localId !== 'string' || !params.localId.trim()) {
    return { success: false, localId: '', error: 'Invalid localId: must be non-empty string' };
  }
  const localId = params.localId.trim();

  if (params.realm !== 'pc' && params.realm !== 'poe2') {
    return {
      success: false,
      localId,
      error: `Invalid realm: expected 'pc' | 'poe2', got '${String(params.realm)}'`,
    };
  }

  if (typeof params.league !== 'string' || !params.league.trim()) {
    return { success: false, localId, error: 'Invalid league: must be non-empty string' };
  }
  const league = params.league.trim();

  const s = store !== undefined ? store : getVueStore();
  if (!s || typeof s.commit !== 'function') {
    return { success: false, localId, error: 'Vuex store unavailable' };
  }

  // Host Capability Validation: 確保必要 mutations 存在
  if (!hasStoreMutation(s, 'addSearchQuery') || !hasStoreMutation(s, 'setSearchActive')) {
    return {
      success: false,
      localId,
      error: 'Required official mutations missing: addSearchQuery or setSearchActive',
    };
  }

  const searches = s.state?.transient?.searches;
  const searchList: HostSearchObject[] = Array.isArray(searches)
    ? searches
    : Object.values(searches || {});

  const existing = searchList.find((item) => item && item.localId === localId);
  if (existing) {
    const isContextChanged =
      existing.league !== league || existing.realm !== params.realm || Boolean(params.resetResults);

    const prevLeague = existing.league;
    const prevRealm = existing.realm;
    const prevResultsWasArray = Array.isArray(existing.results);
    const prevResults = prevResultsWasArray ? [...existing.results] : existing.results;
    const prevTotal = existing.total;
    const prevUnreadHits = existing.unreadHits;
    const prevActiveSearch = s.state?.transient?.search?.active;

    const rollbackContextRebind = () => {
      if (!isContextChanged || typeof s._withCommit !== 'function') return;
      s._withCommit(() => {
        existing.league = prevLeague;
        existing.realm = prevRealm;
        if (prevResultsWasArray && Array.isArray(existing.results)) {
          existing.results.splice(
            0,
            existing.results.length,
            ...(prevResults as HostResultBatch[]),
          );
        } else {
          existing.results = prevResults as HostResultBatch[];
        }
        existing.total = prevTotal;
        existing.unreadHits = prevUnreadHits;
        if (s.state?.transient?.search) {
          s.state.transient.search.active = prevActiveSearch;
        }
      });
    };

    if (isContextChanged) {
      if (typeof s._withCommit !== 'function') {
        return {
          success: false,
          localId,
          error: 'Vuex store missing _withCommit: display container rebind unavailable',
        };
      }
      s._withCommit(() => {
        existing.league = league;
        existing.realm = params.realm;
        if (Array.isArray(existing.results)) {
          existing.results.splice(0, existing.results.length);
        } else {
          existing.results = [];
        }
        existing.total = 0;
        existing.unreadHits = 0;
      });
    }

    if (s.state?.transient?.search?.active?.localId !== localId) {
      try {
        s.commit('setSearchActive', existing);
      } catch (err) {
        rollbackContextRebind();
        return {
          success: false,
          localId,
          error: `setSearchActive failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      // 驗證 active state 是否真正生效
      if (s.state?.transient?.search?.active?.localId !== localId) {
        rollbackContextRebind();
        return {
          success: false,
          localId,
          error: `setSearchActive no-op: container '${localId}' was not set as active search`,
        };
      }
    }
    return { success: true, localId };
  }

  const syntheticSearch: HostSearchObject = {
    localId,
    id: 'poexd_display_search',
    type: 'search',
    live: false, // 關鍵：設為 false 徹底杜絕官方 Vue runtime 自主建立 synthetic WebSocket
    status: false, // 對齊官方 Vuex addSearchQuery 之預設 status: !1
    realm: params.realm,
    league,
    results: [],
    total: 0,
    inexact: false,
    collapse: false,
    dirty: false,
    unreadHits: 0,
  };

  try {
    s.commit('addSearchQuery', syntheticSearch);
  } catch (err) {
    return {
      success: false,
      localId,
      error: `addSearchQuery failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const updatedSearches = s.state?.transient?.searches;
  const updatedList: HostSearchObject[] = Array.isArray(updatedSearches)
    ? updatedSearches
    : Object.values(updatedSearches || {});

  // 嚴格以實際 store state 驗證，移除 fallback 假象
  const target = updatedList.find((item) => item && item.localId === localId);
  if (!target) {
    return {
      success: false,
      localId,
      error: `addSearchQuery no-op: container ${localId} not found in state.transient.searches`,
    };
  }

  try {
    s.commit('setSearchActive', target);
  } catch (err) {
    return {
      success: false,
      localId,
      error: `setSearchActive failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 驗證 active state 是否真正生效，防止 mutation no-op / contract drift
  if (s.state?.transient?.search?.active?.localId !== localId) {
    return {
      success: false,
      localId,
      error: `setSearchActive no-op: container '${localId}' was not set as active search`,
    };
  }

  try {
    s.commit('showAdvancedSearch', false);
  } catch {
    // showAdvancedSearch mutation 可能在特定頁面狀態下不支援，安全略過
  }

  return { success: true, localId };
}

export interface RenderFetchedResultOutcome {
  success: boolean;
  error?: string;
}

/**
 * 單一同步原子操作：新增 Batch 並立即 Hydrate Item
 * 依據 Phase 2A/2B 確鑿契約：
 * 1. 同一同步 Main World call stack 內連續執行 addSearchResult 與 setItemForSearchResult
 * 2. 中間絕對禁止 await、Promise/microtask yield、timer
 * 3. setItemForSearchResult 之 itemId 必須為 Result Token，絕非 itemData.id
 * 4. 驗證必要 mutations 與 _withCommit 存在，任何失敗時透過 _withCommit 完整還原 pre-transaction state
 */
export function renderFetchedResult(
  params: PoeLiveSearchRenderResultPayload,
  store?: HostVuexStore | null,
): RenderFetchedResultOutcome {
  if (!params || typeof params !== 'object') {
    return { success: false, error: 'Malformed render parameters' };
  }

  const { localId, batchId, sourceSearchId, token, itemData, total } = params;

  if (typeof localId !== 'string' || !localId.trim()) {
    return { success: false, error: 'Invalid localId: must be non-empty string' };
  }
  if (typeof batchId !== 'string' || !batchId.trim()) {
    return { success: false, error: 'Invalid batchId: must be non-empty string' };
  }
  if (typeof sourceSearchId !== 'string' || !sourceSearchId.trim()) {
    return { success: false, error: 'Invalid sourceSearchId: must be non-empty string' };
  }
  if (typeof token !== 'string' || !token.trim()) {
    return { success: false, error: 'Invalid token: must be non-empty string' };
  }
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    return { success: false, error: 'Invalid total: must be non-negative finite number' };
  }
  if (!itemData || typeof itemData !== 'object') {
    return { success: false, error: 'Invalid itemData: must be non-null object' };
  }

  const s = store !== undefined ? store : getVueStore();
  if (!s || typeof s.commit !== 'function') {
    return { success: false, error: 'Vuex store unavailable' };
  }

  // Host Capability Validation: 確保必要 mutations 與 _withCommit 存在
  if (!hasStoreMutation(s, 'addSearchResult') || !hasStoreMutation(s, 'setItemForSearchResult')) {
    return {
      success: false,
      error: 'Required official mutations missing: addSearchResult or setItemForSearchResult',
    };
  }

  if (typeof s._withCommit !== 'function') {
    return {
      success: false,
      error: 'Vuex store missing _withCommit: safe transaction rollback unavailable',
    };
  }

  const searches = s.state?.transient?.searches;
  const searchList: HostSearchObject[] = Array.isArray(searches)
    ? searches
    : Object.values(searches || {});

  const container = searchList.find((item) => item && item.localId === localId.trim());
  if (!container) {
    return { success: false, error: `Display container not found: ${localId}` };
  }

  if (
    Array.isArray(container.results) &&
    container.results.some((b) => b && b.id === batchId.trim())
  ) {
    return { success: false, error: `Duplicate batchId: ${batchId}` };
  }

  const cleanBatchId = batchId.trim();
  const cleanLocalId = localId.trim();
  const cleanToken = token.trim();
  const cleanSourceId = sourceSearchId.trim();

  // 保存交易前完整狀態快照（涵蓋官方 addSearchResult 會修改之 id, inexact, total 與可能淘汰舊 batch 之 results）
  const preState = {
    id: container.id,
    inexact: container.inexact,
    total: container.total,
    results: Array.isArray(container.results) ? [...container.results] : [],
  };

  // 1. 同步原子第一階段：新增 Batch（直接提供 items 作為實機驗證之第一道零 Fetch 防護）
  try {
    s.commit('addSearchResult', {
      localId: cleanLocalId,
      resultId: cleanBatchId,
      id: cleanSourceId,
      result: [cleanToken],
      items: { [cleanToken]: itemData },
      total,
      inexact: false,
    });
  } catch (err) {
    rollbackToPreState(s, container, preState);
    return {
      success: false,
      error: `addSearchResult failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. 同步原子第二階段：立即 Hydrate Item
  try {
    s.commit('setItemForSearchResult', {
      localId: cleanLocalId,
      id: cleanBatchId,
      itemId: cleanToken, // LiveSearch Result Token (即 batch.items lookup key)
      itemData,
    });
  } catch (err) {
    // 同步 Rollback：透過 _withCommit 完整還原交易前狀態，杜絕半套 batch 與 state 破壞
    rollbackToPreState(s, container, preState);
    return {
      success: false,
      error: `setItemForSearchResult failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. 驗證注入成功：防範 setItemForSearchResult 是 no-op
  const createdBatch = container.results?.find((b) => b && b.id === cleanBatchId);
  if (!createdBatch || !createdBatch.items || createdBatch.items[cleanToken] === undefined) {
    rollbackToPreState(s, container, preState);
    return {
      success: false,
      error: `setItemForSearchResult no-op: itemData was not bound to batch.items[${cleanToken}]`,
    };
  }

  // 4. 展示筆數上限：淘汰最舊的批次，避免官方一次渲染過多結果卡片
  trimOldestBatches(s, container, cleanBatchId, params.maxResults);

  return { success: true };
}

/**
 * 依新批次插入位置判斷新舊方向（官方 unshift 新批次時最舊者在尾端），
 * 透過 _withCommit 移除超出上限的最舊批次。每個 Live Search 批次僅含一筆結果。
 */
export function trimOldestBatches(
  store: HostVuexStore,
  container: HostSearchObject,
  newestBatchId: string,
  maxResults: number | undefined,
): number {
  if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults <= 0) return 0;
  const results = container.results;
  if (!Array.isArray(results) || results.length <= maxResults) return 0;
  const overflow = results.length - maxResults;
  const newestIndex = results.findIndex((b) => b && b.id === newestBatchId);
  const newestAtFront = newestIndex <= results.length - 1 - newestIndex;
  store._withCommit(() => {
    if (newestAtFront) {
      results.splice(results.length - overflow, overflow);
    } else {
      results.splice(0, overflow);
    }
  });
  return overflow;
}

/**
 * 輔助函式：透過官方 _withCommit 同步還原至交易前完整狀態
 */
function rollbackToPreState(
  store: HostVuexStore,
  container: HostSearchObject,
  snapshot: {
    id: string | undefined;
    inexact: boolean;
    total: number;
    results: HostResultBatch[];
  },
): void {
  store._withCommit(() => {
    container.id = snapshot.id;
    container.inexact = snapshot.inexact;
    container.total = snapshot.total;
    if (Array.isArray(container.results)) {
      container.results.splice(0, container.results.length, ...snapshot.results);
    } else {
      container.results = [...snapshot.results];
    }
  });
}

export interface ResetUnreadHitsOutcome {
  success: boolean;
  error?: string;
}

/**
 * 重置當前 active 容器之未讀提示計數
 * 嚴格契約：
 * 1. 驗證 resetActiveUnreadHits mutation 存在
 * 2. 必須確認 localId 對應目前 active search 容器，否則拒絕且零 mutation
 */
export function resetUnreadHits(
  params: PoeLiveSearchResetUnreadPayload,
  store?: HostVuexStore | null,
): ResetUnreadHitsOutcome {
  if (!params || typeof params.localId !== 'string' || !params.localId.trim()) {
    return { success: false, error: 'Invalid localId: must be non-empty string' };
  }
  const localId = params.localId.trim();

  const s = store !== undefined ? store : getVueStore();
  if (!s || typeof s.commit !== 'function') {
    return { success: false, error: 'Vuex store unavailable' };
  }

  if (!hasStoreMutation(s, 'resetActiveUnreadHits')) {
    return { success: false, error: 'Required official mutation missing: resetActiveUnreadHits' };
  }

  const activeLocalId = s.state?.transient?.search?.active?.localId;
  if (!activeLocalId || activeLocalId !== localId) {
    return {
      success: false,
      error: `Cannot reset unread hits: container '${localId}' is not active (current active: '${activeLocalId || 'none'}')`,
    };
  }

  try {
    s.commit('resetActiveUnreadHits', undefined);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `resetActiveUnreadHits failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface SyncDisplayTotalOutcome {
  success: boolean;
  error?: string;
}

/**
 * 同步展示容器的結果總數（官方上方顯示之筆數），透過 _withCommit 直接寫入。
 * 僅作用於 PoeXD 建立之展示容器，不觸及其他官方搜尋。
 */
export function syncDisplayTotal(
  params: PoeLiveSearchSyncTotalPayload,
  store?: HostVuexStore | null,
): SyncDisplayTotalOutcome {
  if (!params || typeof params.localId !== 'string' || !params.localId.trim()) {
    return { success: false, error: 'Invalid localId: must be non-empty string' };
  }
  if (typeof params.total !== 'number' || !Number.isInteger(params.total) || params.total < 0) {
    return { success: false, error: 'Invalid total: must be non-negative integer' };
  }
  const s = store !== undefined ? store : getVueStore();
  if (!s || typeof s._withCommit !== 'function') {
    return { success: false, error: 'Vuex store unavailable' };
  }
  const searches = s.state?.transient?.searches;
  const searchList: HostSearchObject[] = Array.isArray(searches)
    ? searches
    : Object.values(searches || {});
  const container = searchList.find((item) => item && item.localId === params.localId.trim());
  if (!container) {
    return { success: false, error: `Display container not found: ${params.localId}` };
  }
  if (container.total !== params.total) {
    s._withCommit(() => {
      container.total = params.total;
    });
  }
  return { success: true };
}

/**
 * 掛載 LiveSearch Host Adapter 至 MainWorldBridge
 */
export function initOfficialLiveSearchAdapter(
  bridge: MainWorldBridge,
  storeProvider: () => HostVuexStore | null = getVueStore,
): () => void {
  const unsubs: Array<() => void> = [];

  // 1. 建立/重用 Display Container
  unsubs.push(
    bridge.addListener('poexd-livesearch-ensure-container', (payload) => {
      const dispatchOutcome = (res: EnsureDisplayContainerResult) => {
        if (payload?.requestId) {
          const resultPayload: PoeLiveSearchCommandResultPayload = {
            requestId: payload.requestId,
            command: 'ensure-container',
            success: res.success,
            error: res.error,
          };
          bridge.dispatchEvent(
            'poexd-livesearch-command-result',
            serializePoeLiveSearchCommandResult(resultPayload),
          );
        }
      };

      const executeWithStore = (store: HostVuexStore | null) => {
        let res: EnsureDisplayContainerResult;
        try {
          res = ensureDisplayContainer(payload, store);
        } catch (err) {
          res = {
            success: false,
            localId: payload?.localId || '',
            error: `Unhandled ensure error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        dispatchOutcome(res);
      };

      const initialStore = storeProvider();
      if (initialStore || storeProvider !== getVueStore) {
        executeWithStore(initialStore);
        return;
      }

      // 冷啟動初期官方 Vue Store (#trade.__vue__.$store) 可能尚在掛載中，短暫輪詢等待其就緒
      const startTime = Date.now();
      const pollTimer = setInterval(() => {
        const readyStore = storeProvider();
        if (readyStore || Date.now() - startTime >= 4000) {
          clearInterval(pollTimer);
          executeWithStore(readyStore);
        }
      }, 50);
    }),
  );

  // 2. 單一跨 world 命令：Render Fetched Result
  unsubs.push(
    bridge.addListener('poexd-livesearch-render-result', (wireString) => {
      let parsed: PoeLiveSearchRenderResultPayload | undefined;
      try {
        parsed = parsePoeLiveSearchRenderResult(wireString);
      } catch {
        // 安全忽略 JSON parse 例外
      }

      if (!parsed) {
        const resultPayload: PoeLiveSearchCommandResultPayload = {
          command: 'render-result',
          success: false,
          error: 'Malformed render-result wire payload',
        };
        bridge.dispatchEvent(
          'poexd-livesearch-command-result',
          serializePoeLiveSearchCommandResult(resultPayload),
        );
        return;
      }

      let res: RenderFetchedResultOutcome;
      try {
        res = renderFetchedResult(parsed, storeProvider());
      } catch (err) {
        res = {
          success: false,
          error: `Unhandled render error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (parsed.requestId) {
        const resultPayload: PoeLiveSearchCommandResultPayload = {
          requestId: parsed.requestId,
          command: 'render-result',
          success: res.success,
          error: res.error,
        };
        bridge.dispatchEvent(
          'poexd-livesearch-command-result',
          serializePoeLiveSearchCommandResult(resultPayload),
        );
      }
    }),
  );

  // 3. 重置未讀提示
  unsubs.push(
    bridge.addListener('poexd-livesearch-reset-unread', (payload) => {
      let res: ResetUnreadHitsOutcome;
      try {
        res = resetUnreadHits(payload, storeProvider());
      } catch (err) {
        res = {
          success: false,
          error: `Unhandled reset-unread error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (payload?.requestId) {
        const resultPayload: PoeLiveSearchCommandResultPayload = {
          requestId: payload.requestId,
          command: 'reset-unread',
          success: res.success,
          error: res.error,
        };
        bridge.dispatchEvent(
          'poexd-livesearch-command-result',
          serializePoeLiveSearchCommandResult(resultPayload),
        );
      }
    }),
  );

  // 4. 同步展示總數（依連線篩選連動）
  unsubs.push(
    bridge.addListener('poexd-livesearch-sync-total', (payload) => {
      let res: SyncDisplayTotalOutcome;
      try {
        res = syncDisplayTotal(payload, storeProvider());
      } catch (err) {
        res = {
          success: false,
          error: `Unhandled sync-total error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (payload?.requestId) {
        const resultPayload: PoeLiveSearchCommandResultPayload = {
          requestId: payload.requestId,
          command: 'sync-total',
          success: res.success,
          error: res.error,
        };
        bridge.dispatchEvent(
          'poexd-livesearch-command-result',
          serializePoeLiveSearchCommandResult(resultPayload),
        );
      }
    }),
  );

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
