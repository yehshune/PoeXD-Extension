import { describe, it, expect } from 'vitest';
import {
  createLiveSearchResumeStore,
  normalizeResumePlanData,
  normalizeResumeIdentity,
  getResumePlanStorageKey,
  type LiveSearchResumeStorage,
} from '@/utils/live-search-resume-store';

function createMockStorage(initialData: Record<string, unknown> = {}): LiveSearchResumeStorage & {
  store: Record<string, unknown>;
} {
  const store = { ...initialData };
  return {
    store,
    async get(keys: readonly string[]) {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        if (store[k] !== undefined) {
          result[k] = JSON.parse(JSON.stringify(store[k]));
        }
      }
      return result;
    },
    async set(values: Record<string, unknown>) {
      for (const [k, v] of Object.entries(values)) {
        store[k] = JSON.parse(JSON.stringify(v));
      }
    },
    async remove(keys: readonly string[]) {
      for (const k of keys) {
        delete store[k];
      }
    },
  };
}

describe('LiveSearch Resume Store', () => {
  it('1. PoE1 / PoE2 完全隔離且使用對應 versioned storage key', async () => {
    const mockStorage = createMockStorage();
    const poe1Store = createLiveSearchResumeStore('poe1', mockStorage);
    const poe2Store = createLiveSearchResumeStore('poe2', mockStorage);

    expect(getResumePlanStorageKey('poe1')).toBe('liveSearchResumePlan_poe1');
    expect(getResumePlanStorageKey('poe2')).toBe('liveSearchResumePlan_poe2');

    await poe1Store.addIdentities([
      { gameVersion: 'poe1', league: 'Standard', searchId: 'search111' },
    ]);
    await poe2Store.addIdentities([
      { gameVersion: 'poe2', league: 'Standard', searchId: 'search222' },
    ]);

    const poe1Res = await poe1Store.read();
    const poe2Res = await poe2Store.read();

    expect(poe1Res.ok).toBe(true);
    expect(poe2Res.ok).toBe(true);
    if (!poe1Res.ok || !poe2Res.ok) return;

    expect(poe1Res.value.identities).toHaveLength(1);
    expect(poe1Res.value.identities[0]).toEqual({
      gameVersion: 'poe1',
      league: 'standard',
      searchId: 'search111',
    });

    expect(poe2Res.value.identities).toHaveLength(1);
    expect(poe2Res.value.identities[0]).toEqual({
      gameVersion: 'poe2',
      league: 'standard',
      searchId: 'search222',
    });

    // Clear poe1 only affects poe1
    const clearResult = await poe1Store.clear();
    expect(clearResult).toBe(true);
    const poe1AfterClear = await poe1Store.read();
    const poe2AfterClear = await poe2Store.read();

    expect(poe1AfterClear.ok).toBe(true);
    if (poe1AfterClear.ok) {
      expect(poe1AfterClear.value.identities).toHaveLength(0);
    }
    expect(poe2AfterClear.ok).toBe(true);
    if (poe2AfterClear.ok) {
      expect(poe2AfterClear.value.identities).toHaveLength(1);
    }
    expect(mockStorage.store['liveSearchResumePlan_poe1']).toBeUndefined();
    expect(mockStorage.store['liveSearchResumePlan_poe2']).toBeDefined();
  });

  it('2. Structured identity normalization 與 duplicate canonical dedup', async () => {
    const mockStorage = createMockStorage();
    const store = createLiveSearchResumeStore('poe1', mockStorage);

    // 加入同一 canonical 但不同大小寫或有空白的項目
    await store.addIdentities([
      { gameVersion: 'poe1', league: ' Standard ', searchId: ' abc123 ' },
      { gameVersion: 'poe1', league: 'standard', searchId: 'abc123' },
    ]);

    const res = await store.read();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.identities).toHaveLength(1);
      expect(res.value.identities[0]).toEqual({
        gameVersion: 'poe1',
        league: 'standard',
        searchId: 'abc123',
      });
    }

    // 再次加入相同項目，應 idempotent
    const changed = await store.addIdentities([
      { gameVersion: 'poe1', league: 'STANDARD', searchId: 'abc123' },
    ]);
    expect(changed).toBe(false);
    const res2 = await store.read();
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.value.identities).toHaveLength(1);
    }
  });

  it('3. Malformed stored data 安全忽略與合法化 (Normalization & v1 migration)', () => {
    // 缺失或非合法物件
    expect(normalizeResumePlanData(null, 'poe1')).toEqual({ version: 2, identities: [] });
    expect(normalizeResumePlanData(undefined, 'poe1')).toEqual({ version: 2, identities: [] });
    expect(normalizeResumePlanData('invalid-string', 'poe1')).toEqual({
      version: 2,
      identities: [],
    });
    expect(normalizeResumePlanData({ version: 999, identities: [] }, 'poe1')).toEqual({
      version: 2,
      identities: [],
    });

    // 混合非法與合法 identity (包含 v1 格式資料升級為 v2)
    const raw = {
      version: 1,
      identities: [
        null,
        {},
        { gameVersion: 'wrong-ver', league: 'Standard', searchId: 's1' },
        { gameVersion: 'poe1', league: '', searchId: 's2' },
        { gameVersion: 'poe1', league: 'Standard', searchId: '' },
        { gameVersion: 'poe1', league: 'Standard', searchId: 'valid1' },
        { gameVersion: 'poe1', league: 'standard', searchId: 'valid1' }, // duplicate
        { gameVersion: 'poe1', league: 'Hardcore', searchId: 'valid2' },
      ],
    };

    const normalized = normalizeResumePlanData(raw, 'poe1');
    expect(normalized.version).toBe(2);
    expect(normalized.identities).toEqual([
      { gameVersion: 'poe1', league: 'standard', searchId: 'valid1' },
      { gameVersion: 'poe1', league: 'hardcore', searchId: 'valid2' },
    ]);
  });

  it('4. 并行寫入序列化 (Serialized Writes) 避免 lost-write', async () => {
    const mockStorage = createMockStorage();
    const store = createLiveSearchResumeStore('poe1', mockStorage);

    // 模擬快速並行呼叫 addIdentities
    await Promise.all([
      store.addIdentities([{ gameVersion: 'poe1', league: 'Standard', searchId: 'item1' }]),
      store.addIdentities([{ gameVersion: 'poe1', league: 'Standard', searchId: 'item2' }]),
      store.addIdentities([{ gameVersion: 'poe1', league: 'Standard', searchId: 'item3' }]),
    ]);

    const res = await store.read();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.identities).toHaveLength(3);
      const searchIds = res.value.identities.map((id) => id.searchId).sort();
      expect(searchIds).toEqual(['item1', 'item2', 'item3']);
    }
  });

  it('5. 訂閱者能即時收到變更通知', async () => {
    const mockStorage = createMockStorage();
    const store = createLiveSearchResumeStore('poe1', mockStorage);

    const receivedPlans: number[] = [];
    const unsub = store.subscribe((plan) => {
      receivedPlans.push(plan.identities.length);
    });

    await store.addIdentities([{ gameVersion: 'poe1', league: 'Standard', searchId: 'first' }]);
    await store.addIdentities([{ gameVersion: 'poe1', league: 'Standard', searchId: 'second' }]);
    await store.removeIdentities(['poe1:standard:first']);
    await store.clear();

    unsub();

    expect(receivedPlans).toContain(1);
    expect(receivedPlans).toContain(2);
    expect(receivedPlans).toContain(0);
  });

  it('6. [Regression] 讀取失敗時不建立空 Plan、zero set/remove，storage 恢復後再讀仍取得原 Plan', async () => {
    let shouldFailGet = true;
    let setCount = 0;
    let removeCount = 0;

    const initialPlan = {
      version: 1,
      identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'original_search' }],
    };

    const storage: LiveSearchResumeStorage = {
      async get(keys) {
        if (shouldFailGet) {
          throw new Error('Storage temporarily down');
        }
        return { liveSearchResumePlan_poe1: initialPlan };
      },
      async set(values) {
        setCount++;
      },
      async remove(keys) {
        removeCount++;
      },
    };

    const store = createLiveSearchResumeStore('poe1', storage);

    // 第一次讀取失敗
    const firstRead = await store.read();
    expect(firstRead.ok).toBe(false);

    // 讀取失敗時若嘗試 add/remove/prune，不得覆寫未知 storage
    const addResult = await store.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'new_item' },
    ]);
    expect(addResult).toBe(false);
    expect(setCount).toBe(0);
    expect(removeCount).toBe(0);

    // Storage 恢復
    shouldFailGet = false;

    // 再讀仍能成功取得原 Plan
    const secondRead = await store.read();
    expect(secondRead.ok).toBe(true);
    if (secondRead.ok) {
      expect(secondRead.value.identities).toHaveLength(1);
      expect(secondRead.value.identities[0].searchId).toBe('original_search');
    }
  });

  it('7. [Regression] fresh store 直接讀到既有 Plan，即使沒有任何 add/prune 也會主動通知訂閱者', async () => {
    const storage = createMockStorage({
      liveSearchResumePlan_poe1: {
        version: 1,
        identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'existing_1' }],
      },
    });

    const store = createLiveSearchResumeStore('poe1', storage);

    const received: number[] = [];
    store.subscribe((plan) => {
      received.push(plan.identities.length);
    });

    // 首次讀取
    const res = await store.read();
    expect(res.ok).toBe(true);
    // 訂閱者直接收到通知，不需要靠 add/prune
    expect(received).toContain(1);
  });

  it('8. [Regression] clear 時 remove 失敗：回報 false，原 Plan 仍存在，不清除快取', async () => {
    const storage: LiveSearchResumeStorage = {
      async get() {
        return {
          liveSearchResumePlan_poe1: {
            version: 1,
            identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'keep_me' }],
          },
        };
      },
      async set() {},
      async remove() {
        throw new Error('Disk write error');
      },
    };

    const store = createLiveSearchResumeStore('poe1', storage);
    const initial = await store.read();
    expect(initial.ok).toBe(true);

    const clearSuccess = await store.clear();
    expect(clearSuccess).toBe(false);

    // 快取與資料仍保留
    const afterFailedClear = await store.read();
    expect(afterFailedClear.ok).toBe(true);
    if (afterFailedClear.ok) {
      expect(afterFailedClear.value.identities).toHaveLength(1);
      expect(afterFailedClear.value.identities[0].searchId).toBe('keep_me');
    }
  });

  it('9. Per-League Intent Retention: 同一版本下 Standard 與 Hardcore Resume Intents 同時持久存在，同聯盟 append，跨聯盟不覆蓋', async () => {
    const mockStorage = createMockStorage();
    const store = createLiveSearchResumeStore('poe1', mockStorage);

    // 1. 原有 Standard A
    await store.addIdentities([{ gameVersion: 'poe1', league: 'Standard', searchId: 'search_A' }]);
    const plan1 = await store.read();
    expect(plan1.ok).toBe(true);
    if (plan1.ok) {
      expect(plan1.value.identities).toHaveLength(1);
      expect(plan1.value.identities[0].league).toBe('standard');
      expect(plan1.value.identities[0].searchId).toBe('search_A');
    }

    // 2. 啟用 Hardcore B -> Standard A 不被覆蓋，兩者同時持久存在
    await store.addIdentities([{ gameVersion: 'poe1', league: 'Hardcore', searchId: 'search_B' }]);
    const plan2 = await store.read();
    expect(plan2.ok).toBe(true);
    if (plan2.ok) {
      expect(plan2.value.identities).toHaveLength(2);
      expect(plan2.value.identities.map((id) => id.league)).toEqual(['standard', 'hardcore']);
      expect(plan2.value.identities.map((id) => id.searchId)).toEqual(['search_A', 'search_B']);
    }

    // 3. 再次啟用 Hardcore C -> Hardcore 聯盟 append -> Plan = Standard A + Hardcore B + Hardcore C
    await store.addIdentities([{ gameVersion: 'poe1', league: 'Hardcore', searchId: 'search_C' }]);
    const plan3 = await store.read();
    expect(plan3.ok).toBe(true);
    if (plan3.ok) {
      expect(plan3.value.identities).toHaveLength(3);
      expect(plan3.value.identities.map((id) => `${id.league}:${id.searchId}`)).toEqual([
        'standard:search_A',
        'hardcore:search_B',
        'hardcore:search_C',
      ]);
    }

    // 4. 使用者 Stop Hardcore B -> 僅刪除 Hardcore B，Standard A 與 Hardcore C 完整保留
    await store.removeIdentities([
      { gameVersion: 'poe1', league: 'Hardcore', searchId: 'search_B' },
    ]);
    const plan4 = await store.read();
    expect(plan4.ok).toBe(true);
    if (plan4.ok) {
      expect(plan4.value.identities).toHaveLength(2);
      expect(plan4.value.identities.map((id) => `${id.league}:${id.searchId}`)).toEqual([
        'standard:search_A',
        'hardcore:search_C',
      ]);
    }
  });

  it('10. 舊版 storage v1 格式在讀取與寫入時自動且無損遷移為 v2', async () => {
    const mockStorage = createMockStorage({
      liveSearchResumePlan_poe1: {
        version: 1,
        identities: [
          { gameVersion: 'poe1', league: 'Standard', searchId: 'legacy_A' },
          { gameVersion: 'poe1', league: 'Hardcore', searchId: 'legacy_B' },
        ],
      },
    });

    const store = createLiveSearchResumeStore('poe1', mockStorage);
    const readRes = await store.read();
    expect(readRes.ok).toBe(true);
    if (readRes.ok) {
      expect(readRes.value.version).toBe(2);
      expect(readRes.value.identities).toHaveLength(2);
      expect(readRes.value.identities.map((i) => i.searchId)).toEqual(['legacy_A', 'legacy_B']);
    }

    // 寫入新項目時，存回 storage 的 schema 必須為 version: 2
    await store.addIdentities([{ gameVersion: 'poe1', league: 'Standard', searchId: 'new_C' }]);
    const rawInStorage = mockStorage.store['liveSearchResumePlan_poe1'] as any;
    expect(rawInStorage.version).toBe(2);
    expect(rawInStorage.identities).toHaveLength(3);
  });

  it('11. pruneToAuthoritative with league option: 僅刪除指定聯盟內過期的項目，其他聯盟完整保留', async () => {
    const mockStorage = createMockStorage();
    const store = createLiveSearchResumeStore('poe1', mockStorage);

    await store.addIdentities([
      { gameVersion: 'poe1', league: 'Standard', searchId: 'std_keep' },
      { gameVersion: 'poe1', league: 'Standard', searchId: 'std_remove' },
      { gameVersion: 'poe1', league: 'Hardcore', searchId: 'hc_keep_safe' },
    ]);

    // 只給 std_keep，並指定 league: 'Standard'
    const validKeys = new Set(['poe1:standard:std_keep']);
    await store.pruneToAuthoritative(validKeys, { league: 'Standard' });

    const outcome = await store.read();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.identities).toHaveLength(2);
      expect(outcome.value.identities.map((id) => `${id.league}:${id.searchId}`)).toEqual([
        'standard:std_keep',
        'hardcore:hc_keep_safe',
      ]);
    }
  });
});
