/**
 * 找相似（ADR-0020 Decision 6）的官方 store adapter：每一批結果是一個合成 search，由官方結果列表渲染。
 *
 * 官方 mutation 契約（2026-11-27 讀自官方 bundle 並實機驗證）：
 * - `addSearchQuery` 把新 search 放到 `transient.searches` 最前面；`live: false, status: false` 不會連 WebSocket。
 * - `addSearchResult` 以 localId 找 search、寫入 id／total，並把 `{ id: resultId, result, items }` 放到最前面；
 *   `items` 預先帶好時官方直接渲染，不發 `/fetch`。
 * - `setSearchActive({ localId })` 切換顯示中的 search；`removeCurrentSearch` 移除顯示中的 search 並清空 active。
 * - 官方「搜尋」會先移除顯示中的 search 再建立新的，所以停在合成 search 時按搜尋會取代它。
 *
 * 只動 `poexd_similar_` 前綴的 search；任何 mutation 失敗都以 `_withCommit` 還原到呼叫前的狀態。
 */
import { rpcFail } from '@/utils/cross-world-rpc';
import {
  isSimilarLocalId,
  type SimilarRestoreRequest,
  type SimilarShowBatchRequest,
  type SimilarShowBatchResponse,
  type SimilarStateResponse,
} from '@/utils/similar-search-rpc';
import type { MainWorldBridge } from './bridge-bootstrap';
import type { HostResultBatch, HostSearchObject, HostVuexStore } from './host-types';
import { hasStoreMutation } from './official-livesearch-adapter';
import { getVueStore } from './poe-runtime-reader';

type Outcome<T> = { success: true; data: T } | { success: false; error: string };

const SHOW_MUTATIONS = [
  'addSearchQuery',
  'clearSearchResults',
  'addSearchResult',
  'setSearchActive',
];
const RESTORE_MUTATIONS = ['setSearchActive', 'removeCurrentSearch'];

let batchSequence = 0;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function searchesOf(store: HostVuexStore): HostSearchObject[] {
  const searches = store.state?.transient?.searches;
  return Array.isArray(searches) ? searches : [];
}

const findSearch = (store: HostVuexStore, localId: string): HostSearchObject | undefined =>
  searchesOf(store).find((entry) => entry?.localId === localId);

const activeLocalIdOf = (store: HostVuexStore): string | null =>
  store.state?.transient?.search?.active?.localId ?? null;

function missingMutation(store: HostVuexStore, names: readonly string[]): string | undefined {
  return names.find((name) => !hasStoreMutation(store, name));
}

function usableStore(
  store: HostVuexStore | null,
  mutations: readonly string[],
): string | undefined {
  if (!store || typeof store.commit !== 'function' || typeof store._withCommit !== 'function') {
    return 'Vuex store unavailable';
  }
  const missing = missingMutation(store, mutations);
  return missing ? `Required official mutation missing: ${missing}` : undefined;
}

interface StoreSnapshot {
  searches: HostSearchObject[];
  active: HostSearchObject | null | undefined;
  target?: {
    search: HostSearchObject;
    id: HostSearchObject['id'];
    total: number;
    inexact: boolean;
    results: HostResultBatch[];
  };
}

function snapshotOf(store: HostVuexStore, target: HostSearchObject | undefined): StoreSnapshot {
  return {
    searches: [...searchesOf(store)],
    active: store.state?.transient?.search?.active,
    ...(target
      ? {
          target: {
            search: target,
            id: target.id,
            total: target.total,
            inexact: target.inexact,
            results: [...target.results],
          },
        }
      : {}),
  };
}

function rollback(store: HostVuexStore, snapshot: StoreSnapshot): void {
  store._withCommit(() => {
    const searches = searchesOf(store);
    searches.splice(0, searches.length, ...snapshot.searches);
    if (snapshot.target) {
      const { search, id, total, inexact, results } = snapshot.target;
      Object.assign(search, { id, total, inexact, results: [...results] });
    }
    const transientSearch = store.state?.transient?.search;
    if (transientSearch) transientSearch.active = snapshot.active;
  });
}

function fillBatch(store: HostVuexStore, params: SimilarShowBatchRequest): void {
  const ids = params.items.map((entry) => String(entry.id).trim());
  batchSequence += 1;
  store.commit('addSearchResult', {
    localId: params.localId,
    resultId: `${params.localId}_result_${batchSequence}`,
    id: params.searchId,
    result: ids,
    items: Object.fromEntries(params.items.map((entry, index) => [ids[index], entry])),
    total: params.total,
    inexact: params.inexact ?? false,
  });
  const batch = findSearch(store, params.localId)?.results[0];
  const filled =
    batch !== undefined &&
    batch.result.join('\n') === ids.join('\n') &&
    ids.every((id) => batch.items?.[id] !== undefined);
  if (!filled) throw new Error('addSearchResult no-op: batch was not rendered as given');
}

function activate(store: HostVuexStore, localId: string): void {
  store.commit('setSearchActive', { localId });
  if (activeLocalIdOf(store) !== localId) {
    throw new Error(`setSearchActive no-op: '${localId}' is not active`);
  }
}

/** 建立（或覆寫）一批合成 search，照給定順序放入物品並設為顯示中 */
export function showSimilarBatch(
  params: SimilarShowBatchRequest,
  store: HostVuexStore | null,
): Outcome<SimilarShowBatchResponse> {
  const unusable = usableStore(store, SHOW_MUTATIONS);
  if (unusable || !store) return { success: false, error: unusable ?? 'Vuex store unavailable' };
  if (!isSimilarLocalId(params.localId)) {
    return { success: false, error: `Not a Similar Item Search localId: ${params.localId}` };
  }
  const existing = findSearch(store, params.localId);
  const previousLocalId = activeLocalIdOf(store);
  const snapshot = snapshotOf(store, existing);
  try {
    if (existing) {
      store.commit('clearSearchResults', { localId: params.localId });
    } else {
      store.commit('addSearchQuery', {
        localId: params.localId,
        type: 'search',
        realm: params.realm,
        league: params.league,
        id: params.searchId,
        live: false,
        status: false,
      });
      if (!findSearch(store, params.localId)) throw new Error('addSearchQuery no-op');
    }
    fillBatch(store, params);
    activate(store, params.localId);
  } catch (err) {
    rollback(store, snapshot);
    return { success: false, error: errorText(err) };
  }
  return { success: true, data: { localId: params.localId, previousLocalId } };
}

export function activateSimilarSearch(localId: string, store: HostVuexStore | null): Outcome<null> {
  const unusable = usableStore(store, ['setSearchActive']);
  if (unusable || !store) return { success: false, error: unusable ?? 'Vuex store unavailable' };
  if (!findSearch(store, localId)) return { success: false, error: `Search not found: ${localId}` };
  const snapshot = snapshotOf(store, undefined);
  try {
    activate(store, localId);
  } catch (err) {
    rollback(store, snapshot);
    return { success: false, error: errorText(err) };
  }
  return { success: true, data: null };
}

/** 移除合成 search（只動前綴相符的），再讓使用者的搜尋（沒指定時為原本顯示中的 search）顯示 */
export function restoreUserSearch(
  params: SimilarRestoreRequest,
  store: HostVuexStore | null,
): Outcome<{ restored: boolean }> {
  const unusable = usableStore(store, RESTORE_MUTATIONS);
  if (unusable || !store) return { success: false, error: unusable ?? 'Vuex store unavailable' };
  const previous = activeLocalIdOf(store);
  let failure: string | undefined;
  for (const localId of params.localIds.filter(isSimilarLocalId)) {
    if (!findSearch(store, localId)) continue;
    try {
      activate(store, localId);
      store.commit('removeCurrentSearch', undefined);
    } catch (err) {
      failure = errorText(err);
      break;
    }
  }
  // 沒指定使用者的搜尋時（例如官方搜尋已取代合成 search），切回原本顯示中的那個
  const home =
    params.homeLocalId ?? (isSimilarLocalId(previous) ? undefined : (previous ?? undefined));
  const restored =
    home !== undefined && findSearch(store, home) !== undefined && tryActivate(store, home);
  return failure ? { success: false, error: failure } : { success: true, data: { restored } };
}

function tryActivate(store: HostVuexStore, localId: string): boolean {
  try {
    activate(store, localId);
    return true;
  } catch {
    return false;
  }
}

/** 回報合成 search 是否還在，以及官方搜尋是否取代了顯示中的合成 search */
export function readSimilarState(
  localIds: readonly string[],
  store: HostVuexStore | null,
): SimilarStateResponse {
  const activeLocalId = store ? activeLocalIdOf(store) : null;
  const missing = localIds.filter((localId) => !store || !findSearch(store, localId));
  const showingOurs = activeLocalId !== null && localIds.includes(activeLocalId);
  return { activeLocalId, missing, replaced: missing.length > 0 && !showingOurs };
}

export function initOfficialSimilarSearchAdapter(
  bridge: MainWorldBridge,
  storeProvider: () => HostVuexStore | null = getVueStore,
): () => void {
  const unsubs = [
    bridge.handle('similar.show-batch', (payload) => {
      const outcome = showSimilarBatch(payload, storeProvider());
      return outcome.success ? outcome.data : rpcFail('SIMILAR_SHOW_BATCH_FAILED', outcome.error);
    }),
    bridge.handle('similar.activate', (payload) => {
      const outcome = activateSimilarSearch(payload.localId, storeProvider());
      return outcome.success ? null : rpcFail('SIMILAR_ACTIVATE_FAILED', outcome.error);
    }),
    bridge.handle('similar.restore', (payload) => {
      const outcome = restoreUserSearch(payload, storeProvider());
      return outcome.success ? outcome.data : rpcFail('SIMILAR_RESTORE_FAILED', outcome.error);
    }),
    bridge.handle('similar.state', (payload) =>
      readSimilarState(payload.localIds, storeProvider()),
    ),
  ];
  return () => {
    for (const unsub of unsubs) unsub();
  };
}
