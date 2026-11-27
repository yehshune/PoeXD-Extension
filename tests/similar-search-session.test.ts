import { describe, expect, it, vi } from 'vitest';
import {
  HOME_BATCH_KEY,
  SimilarSearchSession,
  type SimilarSessionDeps,
} from '@/entrypoints/content/logic/similar-search-session';
import type { DisposableSimilarTransport } from '@/entrypoints/content/logic/similar-search-transport';
import { isSimilarSearchId } from '@/utils/similar-search-entry';
import type { SimilarShowBatchRequest } from '@/utils/similar-search-rpc';
import { TradeResultCache } from '@/utils/trade-result-cache';
import { chestResult, englishStatText } from './helpers/similar-search-fixtures';

const ANCHOR = { top: 10, left: 10, bottom: 40, right: 300 };

function setup(totals: number[] = [3, 40]) {
  const cache = new TradeResultCache();
  cache.ingestResult(chestResult('source', { life: 100, fire: 90, evasion: 50 }), {
    sourceSearchId: 'user-search',
  });
  let search = 0;
  const transport: DisposableSimilarTransport = {
    search: vi.fn(async () => {
      const total = totals[search++] ?? 0;
      const result = Array.from({ length: Math.min(total, 10) }, (_, n) => `r${search}_${n}`);
      return { ok: true as const, data: { id: `q${search}`, result, total } };
    }),
    fetch: vi.fn(async (ids: readonly string[]) => ({
      ok: true as const,
      data: ids.map((id) => chestResult(id, { life: 100, fire: 90, evasion: 50 })),
    })),
    dispose: vi.fn(),
  };
  const rpc = {
    show: vi.fn(async (request: SimilarShowBatchRequest) => ({
      ok: true as const,
      data: {
        localId: request.localId,
        previousLocalId: rpc.show.mock.calls.length === 1 ? 'search_1' : 'poexd_similar_x',
      },
    })),
    activate: vi.fn(async () => ({ ok: true as const, data: null })),
    restore: vi.fn(async () => ({ ok: true as const, data: { restored: true } })),
  };
  const notify = vi.fn();
  const deps: SimilarSessionDeps = {
    version: 'poe1',
    cache,
    getLeague: () => 'Covens',
    loadEnglishStats: async () => englishStatText,
    readStatus: async () => 'available',
    readPreferences: () => ({ tolerance: 80, scope: 'category', weaponMode: 'auto' }),
    createTransport: () => transport,
    rpc,
    notify,
    translate: (key) => key,
  };
  return { session: new SimilarSearchSession(deps), rpc, transport, cache, notify };
}

describe('SimilarSearchSession', () => {
  it('從結果列開啟：依 Source Item 建立草稿，販售狀態跟著頁面', async () => {
    const { session } = setup();
    expect(await session.open('source', ANCHOR)).toBe(true);
    const state = session.getState();
    expect(state).toMatchObject({
      open: true,
      phase: 'editing',
      anchor: ANCHOR,
      activeKey: HOME_BATCH_KEY,
    });
    expect(state.draft?.status).toBe('available');
    expect(state.draft?.stats.length).toBeGreaterThan(0);
  });

  it('不適用的物品只提示、不開面板', async () => {
    const { session, cache, notify } = setup();
    cache.ingestResult({
      ...chestResult('unique', {}),
      item: { ...chestResult('unique', {}).item, rarity: 'Unique' },
    });
    expect(await session.open('unique', ANCHOR)).toBe(false);
    expect(notify).toHaveBeenCalledWith('notEligible', 'default');
    expect(session.getState().open).toBe(false);
  });

  it('開始後每一批都交給官方 store 顯示，物品寫進快取，結束時停在依相似度那一批', async () => {
    const { session, rpc, cache } = setup();
    await session.open('source', ANCHOR);
    await session.start();
    const state = session.getState();
    expect(state.phase).toBe('done');
    expect(state.reason).toBe('enough');
    expect(state.batches.map((batch) => batch.key)).toEqual(['strict', 'relaxed-1', 'similarity']);
    expect(state.activeKey).toBe('similarity');
    expect(rpc.show.mock.calls.map(([request]) => request.localId)).toEqual([
      'poexd_similar_strict',
      'poexd_similar_relaxed-1',
      'poexd_similar_similarity',
    ]);
    expect(rpc.show.mock.calls[2][0].searchId).toBe('q1');
    expect(cache.get('r1_0')).toMatchObject({ sourceSearchId: 'q1', league: 'Covens' });
    expect(session.activeView()?.batch.key).toBe('similarity');
  });

  it('某一批顯示失敗時提示，依相似度那批仍帶第一個官方 search id', async () => {
    const { session, rpc, notify } = setup();
    rpc.show.mockImplementationOnce(
      async () =>
        ({
          ok: false as const,
          code: 'INVALID_REQUEST',
          error: 'invalid',
        }) as never,
    );
    await session.open('source', ANCHOR);
    await session.start();
    expect(notify).toHaveBeenCalledWith('renderFailed', 'error');
    expect(session.getState().batches.map((batch) => batch.key)).toEqual([
      'relaxed-1',
      'similarity',
    ]);
    expect(rpc.show.mock.calls[2][0].searchId).toBe('q1');
  });

  it('切換批次與回到我的搜尋；回到我的搜尋移除合成 search 並保留草稿', async () => {
    const { session, rpc } = setup();
    await session.open('source', ANCHOR);
    await session.start();
    await session.activate('strict');
    expect(rpc.activate).toHaveBeenLastCalledWith('poexd_similar_strict');
    await session.activate(HOME_BATCH_KEY);
    expect(rpc.activate).toHaveBeenLastCalledWith('search_1');
    expect(session.activeView()).toBeUndefined();

    await session.backToMySearch();
    expect(rpc.restore).toHaveBeenLastCalledWith({
      localIds: ['poexd_similar_strict', 'poexd_similar_relaxed-1', 'poexd_similar_similarity'],
      homeLocalId: 'search_1',
    });
    expect(session.getState()).toMatchObject({ phase: 'editing', batches: [], open: true });
    expect(session.getState().draft).toBeDefined();
  });

  it('使用者按官方搜尋時停止並移除其餘合成 search，不切走官方的新搜尋', async () => {
    const { session, rpc } = setup();
    await session.open('source', ANCHOR);
    await session.start();
    await session.handleOfficialSearch();
    expect(rpc.restore).toHaveBeenLastCalledWith({
      localIds: ['poexd_similar_strict', 'poexd_similar_relaxed-1', 'poexd_similar_similarity'],
    });
    expect(session.getState()).toMatchObject({ replaced: true, batches: [], phase: 'editing' });
  });

  it('關閉面板時移除合成 search；草稿調整在執行中不生效', async () => {
    const { session, rpc } = setup();
    await session.open('source', ANCHOR);
    session.updateDraft((draft) => ({ ...draft, tolerance: 60 }));
    expect(session.getState().draft?.tolerance).toBe(60);
    await session.start();
    await session.close();
    expect(rpc.restore).toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ open: false, batches: [] });
  });
});

describe('SimilarSearchSession 與結果看板', () => {
  it('每一批的官方 search id 都登記給結果看板略過', async () => {
    const { session } = setup();
    await session.open('source', ANCHOR);
    await session.start();
    expect(isSimilarSearchId('q1')).toBe(true);
    expect(isSimilarSearchId('q2')).toBe(true);
    expect(isSimilarSearchId('user-search')).toBe(false);
  });
});
