// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import type { HostSearchObject, HostVuexStore } from '@/entrypoints/main-world/host-types';
import {
  ensureDisplayContainer,
  initOfficialLiveSearchAdapter,
  isReady,
  renderFetchedResult,
  resetUnreadHits,
} from '@/entrypoints/main-world/official-livesearch-adapter';
import { requestMainWorld } from '@/utils/cross-world-rpc';
import { setupTestMainWorldBridge } from './helpers/main-world-bridge-harness';

describe('OfficialLiveSearchAdapter Foundation (Phase 2B)', () => {
  let mockStore: HostVuexStore;
  let searches: HostSearchObject[];
  let activeSearch: HostSearchObject | null;
  let commitHistory: Array<{ type: string; payload: unknown }>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    searches = [];
    activeSearch = null;
    commitHistory = [];

    mockStore = {
      _mutations: {
        addSearchQuery: [() => {}],
        setSearchActive: [() => {}],
        addSearchResult: [() => {}],
        setItemForSearchResult: [() => {}],
        resetActiveUnreadHits: [() => {}],
      },
      state: {
        transient: {
          searches,
          search: {
            active: activeSearch,
          },
        },
      },
      _withCommit: vi.fn((fn: () => void) => fn()),
      commit: vi.fn((type: string, payload: unknown) => {
        commitHistory.push({ type, payload });
        if (type === 'addSearchQuery') {
          searches.unshift(payload as HostSearchObject);
        } else if (type === 'setSearchActive') {
          activeSearch = payload as HostSearchObject;
          if (mockStore.state?.transient?.search) {
            mockStore.state.transient.search.active = activeSearch;
          }
        } else if (type === 'addSearchResult') {
          const p = payload as {
            localId: string;
            resultId: string;
            id: string;
            result: string[];
            items?: Record<string, unknown>;
            total: number;
          };
          const container = searches.find((s) => s.localId === p.localId);
          if (container) {
            container.results = container.results || [];
            container.results.unshift({
              id: p.resultId,
              result: p.result,
              items: p.items ? { ...p.items } : {},
              total: p.total,
            });
          }
        } else if (type === 'setItemForSearchResult') {
          const p = payload as { localId: string; id: string; itemId: string; itemData: unknown };
          const container = searches.find((s) => s.localId === p.localId);
          const batch = container?.results?.find((b) => b.id === p.id);
          if (batch) {
            batch.items = batch.items || {};
            batch.items[p.itemId] = p.itemData;
          }
        }
      }),
    };

    fetchSpy = vi.spyOn(window, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Ready Detection (isReady)', () => {
    it('returns true when valid vuex store is available', () => {
      expect(isReady(mockStore)).toBe(true);
    });

    it('returns false when store is null or missing commit', () => {
      expect(isReady(null)).toBe(false);
      expect(isReady({} as any)).toBe(false);
      expect(isReady({ commit: 'not a fn' } as any)).toBe(false);
    });
  });

  describe('2. Ensure Display Container (ensureDisplayContainer)', () => {
    it('creates synthetic search container with confirmed shape on first call and sets active', () => {
      const res = ensureDisplayContainer(
        {
          localId: 'poexd_live_container_1',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );

      expect(res.success).toBe(true);
      expect(res.localId).toBe('poexd_live_container_1');

      // 檢查 addSearchQuery 呼叫與 shape
      expect(mockStore.commit).toHaveBeenCalledWith(
        'addSearchQuery',
        expect.objectContaining({
          localId: 'poexd_live_container_1',
          id: 'poexd_display_search',
          type: 'search',
          live: false,
          status: false,
          realm: 'pc',
          league: 'Standard',
          results: [],
          total: 0,
        }),
      );

      // 檢查 setSearchActive 呼叫
      expect(mockStore.commit).toHaveBeenCalledWith(
        'setSearchActive',
        expect.objectContaining({
          localId: 'poexd_live_container_1',
        }),
      );

      // 檢查 realm 為 pc
      expect(searches[0].realm).toBe('pc');

      // 斷言不發起任何 fetch 網路請求
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('supports PoE 2 realm=poe2 accurately', () => {
      const res = ensureDisplayContainer(
        {
          localId: 'poexd_live_poe2_1',
          league: 'Forbidden Rites',
          realm: 'poe2',
        },
        mockStore,
      );

      expect(res.success).toBe(true);
      expect(searches[0].realm).toBe('poe2');
      expect(searches[0].league).toBe('Forbidden Rites');
    });

    it('reuses existing container when called again with same localId without duplicating', () => {
      // 第一次建立
      ensureDisplayContainer(
        {
          localId: 'poexd_reused_container',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );
      expect(searches.length).toBe(1);

      // 第二次呼叫相同 localId
      const res2 = ensureDisplayContainer(
        {
          localId: 'poexd_reused_container',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );

      expect(res2.success).toBe(true);
      expect(searches.length).toBe(1); // 絕不重複新增
      // addSearchQuery 僅呼叫過 1 次
      const addQueryCalls = (mockStore.commit as any).mock.calls.filter(
        (c: any[]) => c[0] === 'addSearchQuery',
      );
      expect(addQueryCalls.length).toBe(1);
    });

    it('[Regression] rebinds context and clears old results/total/unreadHits when existing container is called with different league', () => {
      // 1. 先建立 Standard 容器
      ensureDisplayContainer(
        {
          localId: 'poexd_live_rebind_test',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );

      const container = searches.find((s) => s.localId === 'poexd_live_rebind_test')!;
      expect(container).toBeDefined();
      expect(container.league).toBe('Standard');

      // 模擬在 Standard 下注入舊搜尋結果與未讀數
      container.results = [
        {
          id: 'batch_old_std',
          item: { id: 'old_item' },
          items: { old_token: { id: 'old_item' } },
        } as any,
      ];
      container.total = 1;
      container.unreadHits = 1;

      // 2. 切換聯盟至 Hardcore 重新 ensureDisplayContainer
      const res = ensureDisplayContainer(
        {
          localId: 'poexd_live_rebind_test',
          league: 'Hardcore',
          realm: 'pc',
        },
        mockStore,
      );

      expect(res.success).toBe(true);
      expect(searches.length).toBe(1); // 保持同一容器實體
      expect(container.league).toBe('Hardcore');
      expect(container.realm).toBe('pc');
      expect(container.results).toHaveLength(0); // 舊結果已徹底清空，杜絕跨聯盟污染
      expect(container.total).toBe(0);
      expect(container.unreadHits).toBe(0);
      expect(container.live).toBe(false);
    });

    it('[Regression] fails safely with zero mutation when _withCommit is missing during context rebind', () => {
      ensureDisplayContainer(
        {
          localId: 'poexd_rebind_no_withcommit',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );

      const container = searches.find((s) => s.localId === 'poexd_rebind_no_withcommit')!;
      container.results = [{ id: 'old_batch' } as any];
      container.total = 5;
      container.unreadHits = 3;

      // 移除 _withCommit capability
      const origWithCommit = (mockStore as any)._withCommit;
      delete (mockStore as any)._withCommit;

      try {
        const res = ensureDisplayContainer(
          {
            localId: 'poexd_rebind_no_withcommit',
            league: 'Hardcore',
            realm: 'pc',
          },
          mockStore,
        );

        expect(res.success).toBe(false);
        expect(res.error).toContain('_withCommit');

        // 關鍵：保證零部分 mutation (Zero Mutation Guarantee)
        expect(container.league).toBe('Standard');
        expect(container.results).toHaveLength(1);
        expect(container.total).toBe(5);
        expect(container.unreadHits).toBe(3);
      } finally {
        (mockStore as any)._withCommit = origWithCommit;
      }
    });

    it('[Regression] rolls back context rebind via _withCommit when setSearchActive throws on non-active existing container', () => {
      ensureDisplayContainer(
        {
          localId: 'poexd_rebind_throw_rollback',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );

      const container = searches.find((s) => s.localId === 'poexd_rebind_throw_rollback')!;
      const oldBatch = {
        id: 'batch_std_old',
        result: ['tok_1'],
        items: { tok_1: { id: 'item_1' } },
        total: 3,
      };
      container.results = [oldBatch as any];
      const originalResultsRef = container.results;
      container.total = 3;
      container.unreadHits = 2;

      // 設為非 active search，使下次 ensureDisplayContainer 觸發 setSearchActive
      mockStore.state!.transient!.search!.active = null;
      (mockStore._withCommit as any).mockClear();

      const origCommit = mockStore.commit;
      mockStore.commit = vi.fn((type: string, payload: unknown) => {
        if (type === 'setSearchActive') {
          throw new Error('setSearchActive mutation crashed');
        }
        return origCommit(type, payload);
      });

      const res = ensureDisplayContainer(
        {
          localId: 'poexd_rebind_throw_rollback',
          league: 'Hardcore',
          realm: 'poe2',
          resetResults: true,
        },
        mockStore,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('setSearchActive failed');

      // 驗證完整回滾至 Standard 原狀態，且透過 _withCommit 執行
      expect(mockStore._withCommit).toHaveBeenCalledTimes(2);
      expect(container.league).toBe('Standard');
      expect(container.realm).toBe('pc');
      expect(container.results).toBe(originalResultsRef);
      expect(container.results).toEqual([oldBatch]);
      expect(container.total).toBe(3);
      expect(container.unreadHits).toBe(2);
      expect(mockStore.state?.transient?.search?.active).toBeNull();
    });

    it('[Regression] rolls back context rebind via _withCommit when setSearchActive is a no-op on non-active existing container', () => {
      ensureDisplayContainer(
        {
          localId: 'poexd_rebind_noop_rollback',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );

      const container = searches.find((s) => s.localId === 'poexd_rebind_noop_rollback')!;
      const oldBatch = {
        id: 'batch_std_noop',
        result: ['tok_2'],
        items: { tok_2: { id: 'item_2' } },
        total: 4,
      };
      container.results = [oldBatch as any];
      const originalResultsRef = container.results;
      container.total = 4;
      container.unreadHits = 1;

      // 設為非 active search
      mockStore.state!.transient!.search!.active = null;
      (mockStore._withCommit as any).mockClear();

      const origCommit = mockStore.commit;
      mockStore.commit = vi.fn((type: string, payload: unknown) => {
        if (type === 'setSearchActive') {
          // 模擬 no-op：不更新 active search
          return;
        }
        return origCommit(type, payload);
      });

      const res = ensureDisplayContainer(
        {
          localId: 'poexd_rebind_noop_rollback',
          league: 'Hardcore',
          realm: 'poe2',
          resetResults: true,
        },
        mockStore,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('setSearchActive no-op');

      // 驗證完整回滾至 Standard 原狀態，且透過 _withCommit 執行
      expect(mockStore._withCommit).toHaveBeenCalledTimes(2);
      expect(container.league).toBe('Standard');
      expect(container.realm).toBe('pc');
      expect(container.results).toBe(originalResultsRef);
      expect(container.results).toEqual([oldBatch]);
      expect(container.total).toBe(4);
      expect(container.unreadHits).toBe(1);
      expect(mockStore.state?.transient?.search?.active).toBeNull();
    });

    it('rejects invalid parameters gracefully without modifying store', () => {
      const resBadRealm = ensureDisplayContainer(
        { localId: 'test', league: 'Standard', realm: 'invalid' as any },
        mockStore,
      );
      expect(resBadRealm.success).toBe(false);
      expect(mockStore.commit).not.toHaveBeenCalled();

      const resEmptyId = ensureDisplayContainer(
        { localId: '', league: 'Standard', realm: 'pc' },
        mockStore,
      );
      expect(resEmptyId.success).toBe(false);
      expect(mockStore.commit).not.toHaveBeenCalled();
    });

    it('fails with zero mutations when required official mutation is missing from store', () => {
      // 刻意移除 addSearchQuery
      delete (mockStore as any)._mutations.addSearchQuery;

      const res = ensureDisplayContainer(
        { localId: 'test_missing_mut', league: 'Standard', realm: 'pc' },
        mockStore,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('Required official mutations missing');
      expect(mockStore.commit).not.toHaveBeenCalled();
      expect(searches.length).toBe(0);
    });

    it('fails and commits zero setSearchActive when addSearchQuery is a no-op', () => {
      // 模擬 addSearchQuery 是 no-op，未實際將 container 加入 searches
      mockStore.commit = vi.fn((type: string) => {
        // no-op: 不執行 searches.unshift
      });

      const res = ensureDisplayContainer(
        { localId: 'test_noop', league: 'Standard', realm: 'pc' },
        mockStore,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('addSearchQuery no-op');
      // 確保沒有誤把 target 當作成功而呼叫 setSearchActive
      expect(mockStore.commit).toHaveBeenCalledWith('addSearchQuery', expect.anything());
      expect(mockStore.commit).not.toHaveBeenCalledWith('setSearchActive', expect.anything());
    });

    it('fails when setSearchActive is a no-op on container creation and does not call showAdvancedSearch', () => {
      // 模擬 addSearchQuery 成功但 setSearchActive 為 no-op（active.localId 未更新）
      mockStore.commit = vi.fn((type: string, payload: unknown) => {
        if (type === 'addSearchQuery') {
          searches.unshift(payload as HostSearchObject);
        } else if (type === 'setSearchActive') {
          // no-op: 不更新 mockStore.state.transient.search.active
        }
      });

      const res = ensureDisplayContainer(
        { localId: 'test_active_noop', league: 'Standard', realm: 'pc' },
        mockStore,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('setSearchActive no-op');
      expect(mockStore.commit).toHaveBeenCalledWith('setSearchActive', expect.anything());
      expect(mockStore.commit).not.toHaveBeenCalledWith('showAdvancedSearch', expect.anything());
    });

    it('fails when setSearchActive is a no-op on container reuse', () => {
      // 先建立既有容器
      searches.push({
        localId: 'reused_active_noop',
        type: 'search',
        live: true,
        status: 'connected',
        realm: 'pc',
        league: 'Standard',
        results: [],
        total: 0,
        inexact: false,
        collapse: false,
        dirty: false,
        unreadHits: 0,
      });

      // 模擬 setSearchActive 為 no-op
      mockStore.commit = vi.fn(() => {});

      const res = ensureDisplayContainer(
        { localId: 'reused_active_noop', league: 'Standard', realm: 'pc' },
        mockStore,
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('setSearchActive no-op');
      expect(mockStore.commit).toHaveBeenCalledWith('setSearchActive', expect.anything());
    });
  });

  describe('3. Render Fetched Result (renderFetchedResult)', () => {
    const fakeItemData = {
      id: 'item_data_unique_hash_64hex',
      item: { name: 'Rift Coat', typeLine: '高級皮甲' },
      listing: { price: { amount: 10, currency: 'exalted' } },
    };
    const resultToken = 'jwt_or_hex_result_token_abc123';

    beforeEach(() => {
      // 先建立 target container
      ensureDisplayContainer(
        {
          localId: 'target_container',
          league: 'Standard',
          realm: 'pc',
        },
        mockStore,
      );
      commitHistory = [];
    });

    it('commits addSearchResult and setItemForSearchResult in the SAME synchronous call stack', () => {
      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'batch_alpha',
          sourceSearchId: 'search_id_source_a',
          token: resultToken,
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(true);

      // 檢查提交紀錄：必須剛好為 2 次官方 commit，且順序不可顛倒
      expect(commitHistory.length).toBe(2);
      expect(commitHistory[0].type).toBe('addSearchResult');
      expect(commitHistory[1].type).toBe('setItemForSearchResult');

      // 檢查 addSearchResult payload
      expect(commitHistory[0].payload).toEqual({
        localId: 'target_container',
        resultId: 'batch_alpha',
        id: 'search_id_source_a',
        result: [fakeItemData.id],
        items: { [fakeItemData.id]: fakeItemData },
        total: 1,
        inexact: false,
      });

      // 檢查 setItemForSearchResult payload
      // 關鍵契約：itemId 為 itemData.id（官方重新整理、轉圈與已售出標記都以物品 id 定位），不是 Result Token
      expect(commitHistory[1].payload).toEqual({
        localId: 'target_container',
        id: 'batch_alpha',
        itemId: fakeItemData.id,
        itemData: fakeItemData,
      });
      expect((commitHistory[1].payload as any).itemId).not.toBe(resultToken);

      // 檢查 store 內部響應式 batch.items 是否已被精確寫入
      const container = searches.find((s) => s.localId === 'target_container');
      const batch = container?.results?.find((b) => b.id === 'batch_alpha');
      expect(batch?.items?.[fakeItemData.id]).toBe(fakeItemData);
      expect(batch?.items?.[resultToken]).toBeUndefined();

      // 斷言不發起任何 fetch 或 WebSocket
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects itemData without a string id and leaves the store untouched', () => {
      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'batch_no_id',
          sourceSearchId: 'search_id_source_a',
          token: resultToken,
          itemData: { item: { name: 'No id' } },
          total: 1,
        },
        mockStore,
      );
      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('itemData.id');
      expect(commitHistory.length).toBe(0);
    });

    it('rejects duplicate batchId and does not corrupt store', () => {
      // 第一次 render
      renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'duplicate_batch_id',
          sourceSearchId: 'src_1',
          token: 'token_1',
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      const commitCountBefore = commitHistory.length;

      // 第二次以相同 batchId 嘗試
      const duplicateOutcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'duplicate_batch_id',
          sourceSearchId: 'src_2',
          token: 'token_2',
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(duplicateOutcome.success).toBe(false);
      expect(duplicateOutcome.error).toContain('Duplicate batchId');
      // 第二次被拒絕，未引發任何新 commit
      expect(commitHistory.length).toBe(commitCountBefore);
    });

    it('fails safely when container is not found and commits zero mutations', () => {
      const outcome = renderFetchedResult(
        {
          localId: 'non_existent_container',
          batchId: 'batch_x',
          sourceSearchId: 'src_1',
          token: 'token_1',
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('Display container not found');
      expect(commitHistory.length).toBe(0);
    });

    it('rejects malformed payload without touching store', () => {
      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: '',
          sourceSearchId: 'src_1',
          token: '',
          itemData: null as any,
          total: -1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(commitHistory.length).toBe(0);
    });

    it('fails with zero mutations when required official mutation is missing from store', () => {
      delete (mockStore as any)._mutations.setItemForSearchResult;

      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'batch_no_mut',
          sourceSearchId: 'src_1',
          token: resultToken,
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('Required official mutations missing');
      expect(commitHistory.length).toBe(0);
    });

    it('rolls back batch from container when setItemForSearchResult throws an exception', () => {
      // 模擬 addSearchResult 正常建立 batch，但 setItemForSearchResult 拋出例外
      const origCommit = mockStore.commit;
      mockStore.commit = vi.fn((type: string, payload: unknown) => {
        if (type === 'setItemForSearchResult') {
          throw new Error('Simulated setItemForSearchResult Vuex internal error');
        }
        origCommit(type, payload);
      });

      const container = searches.find((s) => s.localId === 'target_container');
      expect(container).toBeDefined();

      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'batch_failing_hydrate',
          sourceSearchId: 'src_fail',
          token: resultToken,
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('setItemForSearchResult failed');
      // 關鍵驗證：target container 絕不得留下該未 hydrate 成功的半套 batch！
      const lingeringBatch = container?.results?.find((b) => b && b.id === 'batch_failing_hydrate');
      expect(lingeringBatch).toBeUndefined();
    });

    it('rolls back batch from container when itemData is not bound to batch (no-op)', () => {
      // 模擬官方未能將 item 綁定至 batch.items[token]（例如 addSearchResult 忽視 items 且 setItemForSearchResult 為 no-op）
      const origCommit = mockStore.commit;
      mockStore.commit = vi.fn((type: string, payload: unknown) => {
        if (type === 'addSearchResult') {
          const p = payload as any;
          const container = searches.find((s) => s.localId === p.localId);
          if (container) {
            container.results = container.results || [];
            container.results.unshift({
              id: p.resultId,
              result: p.result,
              items: {}, // 未初始化 items
              total: p.total,
            });
          }
          return;
        }
        if (type === 'setItemForSearchResult') {
          // no-op: 不執行 batch.items[token] 賦值
          return;
        }
        origCommit(type, payload);
      });

      const container = searches.find((s) => s.localId === 'target_container');

      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'batch_noop_hydrate',
          sourceSearchId: 'src_noop',
          token: resultToken,
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('setItemForSearchResult no-op');
      // 關鍵驗證：半套 batch 同步被 rollback 移除
      const lingeringBatch = container?.results?.find((b) => b && b.id === 'batch_noop_hydrate');
      expect(lingeringBatch).toBeUndefined();
    });

    it('fails with zero commits when _withCommit is missing from store', () => {
      delete (mockStore as any)._withCommit;

      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'batch_no_withcommit',
          sourceSearchId: 'src_1',
          token: resultToken,
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('Vuex store missing _withCommit');
      expect(commitHistory.length).toBe(0);
    });

    it('restores full pre-transaction state including id, inexact, total, and popped batches when addSearchResult throws', () => {
      const container = searches.find((s) => s.localId === 'target_container')!;
      // 設定初始前置狀態
      container.id = 'pre_search_id';
      container.inexact = false;
      container.total = 10;
      const oldBatchA = { id: 'old_batch_a', result: ['t1'], items: { t1: {} }, total: 5 };
      const oldBatchB = { id: 'old_batch_b', result: ['t2'], items: { t2: {} }, total: 5 };
      container.results = [oldBatchA, oldBatchB];

      // 模擬 addSearchResult 執行部分修改後拋出異常（例如改了 id 與 pop 了尾端 batch）
      mockStore.commit = vi.fn((type: string) => {
        if (type === 'addSearchResult') {
          container.id = 'mutated_midway_id';
          container.inexact = true;
          container.total = 999;
          container.results!.pop(); // 模擬官方內部拋出前已 pop 舊 batch
          throw new Error('Simulated addSearchResult midway error');
        }
      });

      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'batch_fail_add',
          sourceSearchId: 'mutated_midway_id',
          token: resultToken,
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('addSearchResult failed');
      // 驗證完整 pre-transaction state 還原
      expect(mockStore._withCommit).toHaveBeenCalled();
      expect(container.id).toBe('pre_search_id');
      expect(container.inexact).toBe(false);
      expect(container.total).toBe(10);
      expect(container.results).toEqual([oldBatchA, oldBatchB]);
    });

    it('restores full pre-transaction state including id, inexact, total, and popped batches when setItemForSearchResult throws', () => {
      const container = searches.find((s) => s.localId === 'target_container')!;
      // 設定初始前置狀態
      container.id = 'pre_search_id_2';
      container.inexact = false;
      container.total = 2;
      const oldBatch1 = { id: 'old_1', result: ['o1'], items: { o1: {} }, total: 1 };
      const oldBatch2 = { id: 'old_2', result: ['o2'], items: { o2: {} }, total: 1 };
      container.results = [oldBatch1, oldBatch2];

      // 模擬官方真實 addSearchResult 行為：更新 id, inexact, total, unshift 新 batch, 並 pop 舊 batch
      mockStore.commit = vi.fn((type: string, payload: any) => {
        if (type === 'addSearchResult') {
          container.id = payload.id;
          container.inexact = true;
          container.total = 2; // 總數因 limit 保持在 2
          container.results!.unshift({
            id: payload.resultId,
            result: payload.result,
            items: {},
            total: payload.total,
          });
          container.results!.pop(); // 官方淘汰了 oldBatch2
        } else if (type === 'setItemForSearchResult') {
          throw new Error('Simulated setItemForSearchResult fatal crash');
        }
      });

      const outcome = renderFetchedResult(
        {
          localId: 'target_container',
          batchId: 'new_batch_fail',
          sourceSearchId: 'new_search_id_polluted',
          token: resultToken,
          itemData: fakeItemData,
          total: 1,
        },
        mockStore,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('setItemForSearchResult failed');
      // 驗證完整 pre-transaction state 還原
      expect(mockStore._withCommit).toHaveBeenCalled();
      expect(container.id).toBe('pre_search_id_2');
      expect(container.inexact).toBe(false);
      expect(container.total).toBe(2);
      expect(container.results).toEqual([oldBatch1, oldBatch2]);
      // 確保未殘留新 batch
      expect(container.results?.some((b) => b.id === 'new_batch_fail')).toBe(false);
    });
  });

  describe('4. Reset Unread Hits (resetUnreadHits)', () => {
    it('commits resetActiveUnreadHits when target container is active', () => {
      // 設置 active container 的 localId 為 'container_1'
      const activeObj: HostSearchObject = {
        localId: 'container_1',
        type: 'search',
        live: true,
        status: 'connected',
        realm: 'pc',
        league: 'Standard',
        results: [],
        total: 0,
        inexact: false,
        collapse: false,
        dirty: false,
        unreadHits: 5,
      };
      searches.push(activeObj);
      mockStore.state!.transient!.search!.active = activeObj;

      const res = resetUnreadHits({ localId: 'container_1' }, mockStore);
      expect(res.success).toBe(true);
      expect(mockStore.commit).toHaveBeenCalledWith('resetActiveUnreadHits', undefined);
    });

    it('fails and commits zero mutations when localId does not match active container', () => {
      // 設置 active container 為 other_container
      mockStore.state!.transient!.search!.active = {
        localId: 'other_container',
      } as any;

      const res = resetUnreadHits({ localId: 'inactive_container' }, mockStore);
      expect(res.success).toBe(false);
      expect(res.error).toContain('is not active');
      expect(mockStore.commit).not.toHaveBeenCalled();
    });

    it('fails with zero mutations when resetActiveUnreadHits mutation is missing from store', () => {
      delete (mockStore as any)._mutations.resetActiveUnreadHits;

      mockStore.state!.transient!.search!.active = {
        localId: 'container_1',
      } as any;

      const res = resetUnreadHits({ localId: 'container_1' }, mockStore);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Required official mutation missing');
      expect(mockStore.commit).not.toHaveBeenCalled();
    });
  });

  describe('5. Cross-World Bridge Integration (Cross-World RPC seam)', () => {
    let bridge: MainWorldBridge;
    let teardown: () => void;

    beforeEach(() => {
      bridge = setupTestMainWorldBridge('official-livesearch-adapter-nonce');
      teardown = initOfficialLiveSearchAdapter(bridge, () => mockStore);
    });

    afterEach(() => {
      teardown();
    });

    it('handles livesearch.ensure-container over Cross-World RPC', async () => {
      const outcome = await requestMainWorld('livesearch.ensure-container', {
        localId: 'poexd_bridge_container',
        league: 'Standard',
        realm: 'pc',
      });

      expect(mockStore.commit).toHaveBeenCalledWith('addSearchQuery', expect.anything());
      expect(outcome).toEqual({
        ok: true,
        data: { localId: 'poexd_bridge_container' },
      });
    });

    it('handles livesearch.render-result synchronously over Cross-World RPC', async () => {
      ensureDisplayContainer(
        { localId: 'bridge_display_container', league: 'Standard', realm: 'pc' },
        mockStore,
      );

      const outcome = await requestMainWorld('livesearch.render-result', {
        localId: 'bridge_display_container',
        batchId: 'bridge_batch_1',
        sourceSearchId: 'src_search_bridge',
        token: 'token_bridge_123',
        itemData: { id: 'item_raw_id', item: { name: 'Test Bow' } },
        total: 1,
      });

      expect(mockStore.commit).toHaveBeenCalledWith('addSearchResult', expect.anything());
      expect(mockStore.commit).toHaveBeenCalledWith(
        'setItemForSearchResult',
        expect.objectContaining({
          itemId: 'item_raw_id',
        }),
      );
      expect(outcome).toEqual({ ok: true, data: null });
    });

    it('rejects malformed render-result payload immediately with INVALID_REQUEST', async () => {
      const outcome = await requestMainWorld('livesearch.render-result', {
        localId: '',
        batchId: '',
        sourceSearchId: '',
        token: '',
        itemData: null,
        total: -1,
      });

      expect(outcome).toMatchObject({
        ok: false,
        code: 'INVALID_REQUEST',
      });
    });

    it('returns structured failure without uncaught exception when setItemForSearchResult throws', async () => {
      ensureDisplayContainer(
        { localId: 'bridge_display_container_fail', league: 'Standard', realm: 'pc' },
        mockStore,
      );

      const origCommit = mockStore.commit;
      mockStore.commit = vi.fn((type: string, payload: unknown) => {
        if (type === 'setItemForSearchResult') {
          throw new Error('Simulated bridge setItem error');
        }
        origCommit(type, payload);
      });

      const outcome = await requestMainWorld('livesearch.render-result', {
        localId: 'bridge_display_container_fail',
        batchId: 'bridge_batch_fail',
        sourceSearchId: 'src_search_fail',
        token: 'token_fail_123',
        itemData: { id: 'item_fail_id' },
        total: 1,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toContain('Simulated bridge setItem error');
      }
    });
  });
});
