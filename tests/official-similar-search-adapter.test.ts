// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import type { HostSearchObject, HostVuexStore } from '@/entrypoints/main-world/host-types';
import { initOfficialSimilarSearchAdapter } from '@/entrypoints/main-world/official-similar-search-adapter';
import { requestMainWorld } from '@/utils/cross-world-rpc';
import { setupTestMainWorldBridge } from './helpers/main-world-bridge-harness';

/** 依 2026-11-27 官方 bundle 的 mutation 實作模擬：以 localId 尋找 search、新 search 與新批次都放在最前面 */
function createOfficialStore() {
  const searches: HostSearchObject[] = [];
  const search: { active: HostSearchObject | null } = { active: null };
  const failing = new Set<string>();
  const find = (localId: unknown) => searches.find((entry) => entry.localId === localId);
  const handlers: Record<string, (payload: any) => void> = {
    addSearchQuery: (payload) => {
      searches.unshift({
        id: null,
        type: null,
        live: false,
        status: false,
        results: [],
        total: null,
        inexact: false,
        collapse: false,
        dirty: false,
        unreadHits: 0,
        ...payload,
      });
    },
    setSearchActive: (payload) => {
      search.active = payload?.localId ? (find(payload.localId) ?? null) : null;
    },
    addSearchResult: (payload) => {
      const target = find(payload.localId);
      if (!target) return;
      target.id = payload.id;
      target.inexact = target.inexact || payload.inexact;
      target.total = payload.total;
      target.results.unshift({
        id: payload.resultId,
        result: payload.result,
        items: payload.items || {},
        total: payload.total,
      });
    },
    clearSearchResults: (payload) => {
      const target = find(payload.localId);
      if (target) target.results = [];
    },
    removeCurrentSearch: () => {
      const current = search.active;
      if (!current) return;
      search.active = null;
      const index = searches.indexOf(current);
      if (index >= 0) searches.splice(index, 1);
    },
  };
  const store: HostVuexStore = {
    _mutations: Object.fromEntries(Object.keys(handlers).map((name) => [name, [() => {}]])),
    state: { transient: { searches, search } },
    _withCommit: vi.fn((fn: () => void) => fn()),
    commit: vi.fn((type: string, payload: unknown) => {
      if (failing.has(type)) throw new Error(`${type} exploded`);
      handlers[type]?.(payload);
    }),
  };
  return { store, searches, search, failing, find };
}

const item = (id: string) => ({ id, listing: { price: { amount: 1 } }, item: { name: id } });

describe('官方 store adapter：找相似的合成搜尋批次', () => {
  let bridge: MainWorldBridge;
  let teardown: () => void;
  let official: ReturnType<typeof createOfficialStore>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const userSearch = (): HostSearchObject => official.find('search_1') as HostSearchObject;

  beforeEach(() => {
    official = createOfficialStore();
    official.store.commit('addSearchQuery', {
      localId: 'search_1',
      type: 'search',
      realm: 'pc',
      league: 'Covens',
    });
    official.store.commit('addSearchResult', {
      localId: 'search_1',
      resultId: 'result_1',
      id: 'abc123',
      result: ['u1', 'u2'],
      items: { u1: item('u1') },
      total: 2,
      inexact: false,
    });
    official.store.commit('setSearchActive', { localId: 'search_1' });
    bridge = setupTestMainWorldBridge('official-similar-search-adapter');
    teardown = initOfficialSimilarSearchAdapter(bridge, () => official.store);
    fetchSpy = vi.spyOn(window, 'fetch');
  });

  afterEach(() => {
    teardown();
    vi.restoreAllMocks();
  });

  const showBatch = (localId: string, ids: string[], total = ids.length) =>
    requestMainWorld('similar.show-batch', {
      localId,
      realm: 'pc',
      league: 'Covens',
      searchId: `q_${localId}`,
      items: ids.map(item),
      total,
    });

  it('建立合成搜尋、照給定順序渲染並設為顯示中；不發請求、不動使用者的搜尋', async () => {
    const outcome = await showBatch('poexd_similar_strict', ['b', 'a', 'c'], 37);

    expect(outcome).toEqual({
      ok: true,
      data: { localId: 'poexd_similar_strict', previousLocalId: 'search_1' },
    });
    const synthetic = official.find('poexd_similar_strict');
    expect(synthetic).toMatchObject({
      live: false,
      status: false,
      id: 'q_poexd_similar_strict',
      total: 37,
    });
    expect(synthetic?.results).toHaveLength(1);
    expect(synthetic?.results[0].result).toEqual(['b', 'a', 'c']);
    expect(Object.keys(synthetic?.results[0].items ?? {})).toEqual(['b', 'a', 'c']);
    expect(official.search.active?.localId).toBe('poexd_similar_strict');
    expect(userSearch().results[0].result).toEqual(['u1', 'u2']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('同一批再次顯示時換成新的結果，不累積批次', async () => {
    await showBatch('poexd_similar_all', ['a']);
    await showBatch('poexd_similar_all', ['c', 'a']);
    const synthetic = official.find('poexd_similar_all');
    expect(synthetic?.results.map((batch) => batch.result)).toEqual([['c', 'a']]);
    expect(official.searches.filter((entry) => entry.localId === 'poexd_similar_all')).toHaveLength(
      1,
    );
  });

  it('在批次與使用者的搜尋之間切換，結果保持原樣', async () => {
    await showBatch('poexd_similar_strict', ['a']);
    const second = await showBatch('poexd_similar_relaxed_1', ['b']);
    expect(second).toMatchObject({ data: { previousLocalId: 'poexd_similar_strict' } });

    expect(await requestMainWorld('similar.activate', { localId: 'search_1' })).toEqual({
      ok: true,
      data: null,
    });
    expect(official.search.active?.localId).toBe('search_1');
    await requestMainWorld('similar.activate', { localId: 'poexd_similar_strict' });
    expect(official.search.active?.localId).toBe('poexd_similar_strict');
    expect(official.find('poexd_similar_strict')?.results[0].result).toEqual(['a']);
    expect(userSearch().results[0].result).toEqual(['u1', 'u2']);

    const missing = await requestMainWorld('similar.activate', { localId: 'poexd_similar_gone' });
    expect(missing).toMatchObject({ ok: false, code: 'SIMILAR_ACTIVATE_FAILED' });
    expect(official.search.active?.localId).toBe('poexd_similar_strict');
  });

  it('回到我的搜尋：移除所有合成搜尋並讓使用者的搜尋顯示', async () => {
    await showBatch('poexd_similar_strict', ['a']);
    await showBatch('poexd_similar_relaxed_1', ['b']);
    const outcome = await requestMainWorld('similar.restore', {
      localIds: ['poexd_similar_strict', 'poexd_similar_relaxed_1', 'search_1'],
      homeLocalId: 'search_1',
    });
    expect(outcome).toEqual({ ok: true, data: { restored: true } });
    expect(official.searches.map((entry) => entry.localId)).toEqual(['search_1']);
    expect(official.search.active?.localId).toBe('search_1');
    expect(userSearch().results[0].result).toEqual(['u1', 'u2']);
  });

  it('使用者的搜尋已不在時，只移除合成搜尋並回報沒有還原', async () => {
    await showBatch('poexd_similar_strict', ['a']);
    const outcome = await requestMainWorld('similar.restore', {
      localIds: ['poexd_similar_strict'],
      homeLocalId: 'search_9',
    });
    expect(outcome).toEqual({ ok: true, data: { restored: false } });
    expect(official.find('poexd_similar_strict')).toBeUndefined();
  });

  it('官方搜尋取代顯示中的合成搜尋時回報 replaced', async () => {
    await showBatch('poexd_similar_strict', ['a']);
    await showBatch('poexd_similar_relaxed_1', ['b']);
    const ids = ['poexd_similar_strict', 'poexd_similar_relaxed_1'];
    expect(await requestMainWorld('similar.state', { localIds: ids })).toEqual({
      ok: true,
      data: { activeLocalId: 'poexd_similar_relaxed_1', missing: [], replaced: false },
    });

    // 官方「搜尋」：移除目前的 search，再建立並顯示新的 search
    official.store.commit('removeCurrentSearch', undefined);
    official.store.commit('addSearchQuery', {
      localId: 'search_2',
      type: 'search',
      realm: 'pc',
      league: 'Covens',
    });
    official.store.commit('setSearchActive', { localId: 'search_2' });

    expect(await requestMainWorld('similar.state', { localIds: ids })).toEqual({
      ok: true,
      data: { activeLocalId: 'search_2', missing: ['poexd_similar_relaxed_1'], replaced: true },
    });
  });

  it('切回自己的搜尋不算被取代', async () => {
    await showBatch('poexd_similar_strict', ['a']);
    await requestMainWorld('similar.activate', { localId: 'search_1' });
    expect(
      await requestMainWorld('similar.state', { localIds: ['poexd_similar_strict'] }),
    ).toMatchObject({ data: { replaced: false, missing: [] } });
  });

  it('mutation 失敗時還原：移除建到一半的合成搜尋、使用者的搜尋保持顯示', async () => {
    official.failing.add('addSearchResult');
    const outcome = await showBatch('poexd_similar_strict', ['a']);
    expect(outcome).toMatchObject({ ok: false, code: 'SIMILAR_SHOW_BATCH_FAILED' });
    expect(official.find('poexd_similar_strict')).toBeUndefined();
    expect(official.search.active?.localId).toBe('search_1');
  });

  it('更新既有批次失敗時保留原本的結果', async () => {
    await showBatch('poexd_similar_all', ['a']);
    await requestMainWorld('similar.activate', { localId: 'search_1' });
    official.failing.add('setSearchActive');
    const outcome = await showBatch('poexd_similar_all', ['c']);
    expect(outcome).toMatchObject({ ok: false, code: 'SIMILAR_SHOW_BATCH_FAILED' });
    expect(official.find('poexd_similar_all')?.results.map((batch) => batch.result)).toEqual([
      ['a'],
    ]);
    expect(official.search.active?.localId).toBe('search_1');
  });

  it('只接受 PoeXD 前綴的合成搜尋代碼，缺少官方 mutation 時拒絕', async () => {
    const foreign = await showBatch('search_1', ['a']);
    expect(foreign).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    const noId = await requestMainWorld('similar.show-batch', {
      localId: 'poexd_similar_x',
      realm: 'pc',
      league: 'Covens',
      searchId: 'q',
      items: [{ name: 'no id' }],
      total: 1,
    });
    expect(noId).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    delete (official.store._mutations as Record<string, unknown>).clearSearchResults;
    const outcome = await showBatch('poexd_similar_strict', ['a']);
    expect(outcome).toMatchObject({ ok: false, code: 'SIMILAR_SHOW_BATCH_FAILED' });
    expect(official.searches.map((entry) => entry.localId)).toEqual(['search_1']);
  });
});
