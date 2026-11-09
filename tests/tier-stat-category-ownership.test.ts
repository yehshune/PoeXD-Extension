// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  ACTIVE_SESSION_STORAGE_KEY,
  batchUpdateAllCategories,
  clearAllFilterCategories,
  ensureActiveBindingSession,
  ensureFilterBindingId,
  getActiveSessionId,
  getOfficialCategorySnapshot,
  loadStoredBindings,
  persistBindings,
  reconcileFilterBindings,
  resetActiveBindingSessionForTest,
  rolloverBindingSession,
  setFilterCategory,
  setOfficialCategorySnapshot,
  startPendingSearchSubmission,
  cancelPendingSearchSubmission,
  completePendingSearchSubmission,
  markSearchSubmissionResponded,
  updateSingleFilterCategory,
} from '@/entrypoints/main-world/category-binding-manager';
import type {
  HostFilterGroup,
  HostFilterItem,
  HostVuexStore,
} from '@/entrypoints/main-world/host-types';
import { initPoeRuntimeMutation } from '@/entrypoints/main-world/poe-runtime-mutation';
import {
  resetOfficialCategoryBaselineForTest,
  setDomTaggerBridge,
  syncOfficialCategoryFromStore,
  stopDomTagger,
  syncDomTaggerRoute,
  tagFilterDomElements,
} from '@/entrypoints/main-world/dom-tagger';
import { installXhrInterceptor } from '@/entrypoints/main-world/network-observer';
import { listenPoeEvent } from '@/utils/event-contracts';

describe('Tier Stat Category Ownership & Lifecycle Contracts', () => {
  const searchId = 'test-tier-ownership-search-id';
  let mockStore: HostVuexStore;
  let listeners: Map<string, (payload: any) => void>;
  let mockBridge: any;
  let cleanupMutation: () => void;
  let originalPush: any;
  let originalReplace: any;

  beforeEach(() => {
    (globalThis as any).chrome = {
      runtime: {
        getURL: vi.fn((path: string) => path),
      },
    };
    resetActiveBindingSessionForTest();
    sessionStorage.clear();
    document.body.innerHTML = '';
    listeners = new Map();

    originalPush = window.history.pushState.bind(window.history);
    originalReplace = window.history.replaceState.bind(window.history);

    window.history.pushState = function (...args) {
      originalPush(...args);
      syncDomTaggerRoute('pushState');
    };

    window.history.replaceState = function (...args) {
      originalReplace(...args);
      syncDomTaggerRoute('replaceState');
    };

    mockBridge = {
      addListener: vi.fn((event: string, cb: (payload: any) => void) => {
        listeners.set(event, cb);
        return () => listeners.delete(event);
      }),
      dispatchEvent: vi.fn(),
    };

    mockStore = {
      state: {
        persistent: {
          stats: [
            {
              filters: [],
            },
          ],
        },
      },
      _withCommit: vi.fn((fn: () => void) => fn()),
      commit: vi.fn(),
    };

    const tradeEl = document.createElement('div');
    tradeEl.id = 'trade';
    (tradeEl as any).__vue__ = {
      $store: mockStore,
    };
    document.body.appendChild(tradeEl);

    // 設定 URL searchId
    window.history.replaceState(null, '', `/trade/search/Standard/${searchId}`);

    resetOfficialCategoryBaselineForTest();
    setDomTaggerBridge(mockBridge);
    cleanupMutation = initPoeRuntimeMutation(mockBridge);
  });

  afterEach(() => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
    setDomTaggerBridge(null);
    resetOfficialCategoryBaselineForTest();
    cleanupMutation?.();
    stopDomTagger();
    resetActiveBindingSessionForTest();
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('1. Official category: batch updates all filters when official category truly changes', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];

    // 初始透過 official category 初始化為 bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    reconcileFilterBindings(stats, 'bow');
    expect(filterA.poexdCategory).toBe('bow');
    expect(filterB.poexdCategory).toBe('bow');

    // 官方道具大類變更為 helmet
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' } } } },
    });

    // A/B 全部批次更新為 helmet
    expect(filterA.poexdCategory).toBe('helmet');
    expect(filterB.poexdCategory).toBe('helmet');

    // 驗證 persistence 亦更新為 helmet
    const stored = loadStoredBindings();
    expect(stored.every((b) => b.category === 'helmet')).toBe(true);
  });

  it('2. Manual override: isolates per-filter manual category change from other filters and survives rerender', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];

    reconcileFilterBindings(stats, 'bow');
    expect(filterA.poexdCategory).toBe('bow');
    expect(filterB.poexdCategory).toBe('bow');

    // Filter A 手動改為 helmet
    const updateHandler = listeners.get('poexd-update-stat-category');
    expect(updateHandler).toBeDefined();
    updateHandler!({
      groupIndex: 0,
      filterIndex: 0,
      bindingId: filterA.poexdBindingId,
      category: 'helmet',
    });

    expect(filterA.poexdCategory).toBe('helmet');
    expect(filterB.poexdCategory).toBe('bow');

    // 模擬 DOM/Vuex rerender (重新 reconcile)
    reconcileFilterBindings(stats, 'bow');
    expect(filterA.poexdCategory).toBe('helmet');
    expect(filterB.poexdCategory).toBe('bow');
  });

  it('3. Official change after manual override: batch update overrides previous manual state', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];

    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    reconcileFilterBindings(stats, 'bow');

    // A 手動改 helmet
    const updateHandler = listeners.get('poexd-update-stat-category');
    updateHandler!({
      bindingId: filterA.poexdBindingId,
      groupIndex: 0,
      filterIndex: 0,
      category: 'helmet',
    });
    expect(filterA.poexdCategory).toBe('helmet');
    expect(filterB.poexdCategory).toBe('bow');

    // 官方真正改成 body-armour
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'armour.chest' } } } },
    });

    // A/B 皆轉為 body-armour
    expect(filterA.poexdCategory).toBe('body-armour');
    expect(filterB.poexdCategory).toBe('body-armour');
  });

  it('4. No mutation on read: read/suggestion path never dispatches category mutation or writes persistence', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterWithoutCat: HostFilterItem = { id: 'explicit.stat_raw', disabled: false };
    stats[0].filters = [filterWithoutCat];

    // 純讀取狀態（無官方 category fallback，無 stored memory）
    const storedBefore = loadStoredBindings();
    expect(storedBefore).toHaveLength(0);

    // 僅建立 bindingId，不隨意寫入 category
    ensureFilterBindingId(filterWithoutCat);
    expect(filterWithoutCat.poexdCategory).toBeUndefined();

    // 檢查 persistence: 未產生 category 記錄
    const storedAfter = loadStoredBindings();
    expect(storedAfter).toHaveLength(0);
  });

  it('5. Reorder: category stays with logical filter on reorder, independent of groupIndex/filterIndex', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];

    reconcileFilterBindings(stats);
    setFilterCategory(filterA, 'bow');
    setFilterCategory(filterB, 'helmet');
    persistBindings(stats);

    // 執行 reorder: 將 A 與 B 對調位置 (B 到 index 0, A 到 index 1)
    stats[0].filters = [filterB, filterA];

    // 重新 reconcile
    reconcileFilterBindings(stats);

    // 斷言：A 仍為 bow，B 仍為 helmet，不因位置對調而錯配
    expect(stats[0].filters[0].poexdCategory).toBe('helmet'); // filterB
    expect(stats[0].filters[1].poexdCategory).toBe('bow'); // filterA
  });

  it('6. Delete / Insert index drift: inserting or deleting filters preserves other filters categories', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];

    reconcileFilterBindings(stats);
    setFilterCategory(filterA, 'bow');
    setFilterCategory(filterB, 'helmet');
    persistBindings(stats);

    // 在 A 之前插入一個全新 filterC
    const filterC: HostFilterItem = { id: 'explicit.stat_c', disabled: false };
    stats[0].filters = [filterC, filterA, filterB];
    reconcileFilterBindings(stats);

    expect(filterA.poexdCategory).toBe('bow');
    expect(filterB.poexdCategory).toBe('helmet');

    // 刪除 filterC 與 filterA，僅留 filterB (現在是 index 0)
    stats[0].filters = [filterB];
    reconcileFilterBindings(stats);

    // 斷言：filterB 移至 index 0 後 category 依然是 helmet，未丟失也未變成 bow
    expect(filterB.poexdCategory).toBe('helmet');
  });

  it('7. Vuex object replacement / DOM rerender: restores logical categories via semantic match without index reliance', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const originalFilter: HostFilterItem = { id: 'explicit.stat_res', disabled: false };
    stats[0].filters = [originalFilter];

    reconcileFilterBindings(stats);
    setFilterCategory(originalFilter, 'ring');
    persistBindings(stats);

    // 模擬 Vuex 物件全量重建（如 F5 刷新或官方 Store reset），新物件無 poexdBindingId
    const freshFilter: HostFilterItem = { id: 'explicit.stat_res', disabled: false };
    stats[0].filters = [freshFilter];

    expect(freshFilter.poexdBindingId).toBeUndefined();
    expect(freshFilter.poexdCategory).toBeUndefined();

    // 執行 reconciliation
    reconcileFilterBindings(stats);

    // 斷言：語意匹配成功還原 category
    expect(freshFilter.poexdCategory).toBe('ring');
    expect(freshFilter.poexdBindingId).toBeDefined();
  });

  it('8. Serialization invariant: poexdCategory and poexdBindingId are strictly non-enumerable', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterItem: HostFilterItem = {
      id: 'explicit.stat_test',
      disabled: false,
      value: { min: 10 },
    };
    stats[0].filters = [filterItem];

    reconcileFilterBindings(stats);
    setFilterCategory(filterItem, 'wand');

    // 檢查屬性可枚舉性
    expect(filterItem.poexdCategory).toBe('wand');
    expect(filterItem.poexdBindingId).toBeDefined();

    // 1. Object.keys 不包含任何 poexd 內部中繼資料
    const keys = Object.keys(filterItem);
    expect(keys).not.toContain('poexdCategory');
    expect(keys).not.toContain('poexdBindingId');

    // 2. JSON.stringify(query) 不包含任何 poexd 內部中繼資料，不污染官方 API payload
    const serialized = JSON.stringify(mockStore.state!.persistent);
    expect(serialized).not.toContain('poexdCategory');
    expect(serialized).not.toContain('poexdBindingId');
    expect(serialized).not.toContain('wand');
  });

  it('9. Official Category Change Detection: initial baseline dispatches state notification to consumer, temporary unavailable does not reset baseline, true transition dispatches once', () => {
    const bowQuery = {
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    };
    const helmetQuery = {
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' } } } },
    };

    // 1. 初次載入 (null -> bow): 建立 baseline，向 UI consumer 派發當前 state notification
    syncOfficialCategoryFromStore(bowQuery);
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: 'bow',
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    mockBridge.dispatchEvent.mockClear();

    // 2. Query 暫時 unavailable (bow -> unavailable): 如頁面局部重繪，未有 category option
    syncOfficialCategoryFromStore({});
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
    // Baseline 依然保留為 bow，不被 unavailable 清除
    expect(getOfficialCategorySnapshot()).toBe('bow');

    // 3. 恢復為 bow (unavailable -> bow): 再次出現同值，因 baseline 為 bow，不觸發 change
    syncOfficialCategoryFromStore(bowQuery);
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
    expect(getOfficialCategorySnapshot()).toBe('bow');

    // 4. 真正變更為頭盔 (bow -> helmet): 派發一次 poexd-equipment-type-changed
    syncOfficialCategoryFromStore(helmetQuery);
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: 'helmet',
    });
    expect(getOfficialCategorySnapshot()).toBe('helmet');

    // 5. 再次檢驗：若未變動則不重送
    mockBridge.dispatchEvent.mockClear();
    syncOfficialCategoryFromStore(helmetQuery);
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
  });

  it('10. Tier manual update: forbids index fallback and uses bindingId as strict mutation identity', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];

    reconcileFilterBindings(stats, 'bow');
    expect(filterA.poexdBindingId).toBeDefined();
    expect(filterB.poexdBindingId).toBeDefined();
    expect(filterA.poexdCategory).toBe('bow');
    expect(filterB.poexdCategory).toBe('bow');

    // A. 模擬傳入 stale / 不存在的 bindingId，但附帶 valid groupIndex/filterIndex (例如 index 0)
    const staleResult = updateSingleFilterCategory(
      stats,
      { bindingId: 'stale-binding-nonexistent', groupIndex: 0, filterIndex: 0 },
      'helmet',
    );
    // 斷言：找不到 bindingId 時立即回傳 false，絕不 fallback 篡改 index 0 上的 filterA！
    expect(staleResult).toBe(false);
    expect(filterA.poexdCategory).toBe('bow');

    // B. 模擬 Dialog 開啟後發生 DOM/Vuex index drift（filterA 被刪除，filterB 移至 index 0）
    const targetBindingId = filterB.poexdBindingId!;
    // 刪除 filterA
    stats[0].filters = [filterB];

    // Dialog 提交時帶入開啟時記住的舊 index (groupIndex: 0, filterIndex: 1)，但 bindingId 正確
    const validResult = updateSingleFilterCategory(
      stats,
      { bindingId: targetBindingId, groupIndex: 0, filterIndex: 1 },
      'body-armour',
    );
    // 斷言：即便 index 1 已不存在（越界），藉由 bindingId 仍精確更新 filterB
    expect(validResult).toBe(true);
    expect(filterB.poexdCategory).toBe('body-armour');
  });

  it('11. Stale persisted binding reattachment: deleted filter is immediately purged and cannot hijack newly added filter with same statId', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    stats[0].filters = [filterA];

    reconcileFilterBindings(stats, 'bow');
    expect(filterA.poexdCategory).toBe('bow');
    const oldBindingId = filterA.poexdBindingId!;

    // 刪除 Filter A
    stats[0].filters = [];
    // 重新 reconcile/persist（模擬刪除後的同步）
    reconcileFilterBindings(stats, 'bow');

    // 驗證 persistence 已經完全清除該已刪除 filter 的 binding
    const stored = loadStoredBindings();
    expect(stored.find((b) => b.bindingId === oldBindingId)).toBeUndefined();
    expect(stored).toHaveLength(0);

    // 官方分類改為 helmet
    // 使用者重新新增一個相同 statId 的 filter（如 explicit.stat_life）
    const filterNew: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    stats[0].filters = [filterNew];

    reconcileFilterBindings(stats, 'helmet');

    // 斷言：全新 filter 不得吃到舊的 'bow'，必須獲得新 bindingId 且 category 遵循當前官方 'helmet'
    expect(filterNew.poexdBindingId).toBeDefined();
    expect(filterNew.poexdBindingId).not.toBe(oldBindingId);
    expect(filterNew.poexdCategory).toBe('helmet');
  });

  it('12. Duplicate same statId semantic fallback: safely restores when categories agree, prevents silent mis-bind when categories conflict', () => {
    // 情況 A：同 statId 且分類完全一致 (Agree)
    const statsA: HostFilterGroup[] = [
      {
        filters: [
          { id: 'explicit.stat_res', disabled: false },
          { id: 'explicit.stat_res', disabled: false },
        ],
      },
    ];
    reconcileFilterBindings(statsA, 'ring');
    expect(statsA[0].filters![0].poexdCategory).toBe('ring');
    expect(statsA[0].filters![1].poexdCategory).toBe('ring');
    expect(statsA[0].filters![0].poexdBindingId).not.toBe(statsA[0].filters![1].poexdBindingId);

    // 模擬 F5 刷新（Vuex 物件重建，無 bindingId）
    const freshAgreeStats: HostFilterGroup[] = [
      {
        filters: [
          { id: 'explicit.stat_res', disabled: false },
          { id: 'explicit.stat_res', disabled: false },
        ],
      },
    ];
    reconcileFilterBindings(freshAgreeStats);
    // 斷言：分類完全一致時，兩者均安全還原為 'ring'
    expect(freshAgreeStats[0].filters![0].poexdCategory).toBe('ring');
    expect(freshAgreeStats[0].filters![1].poexdCategory).toBe('ring');

    // 情況 B：同 statId 但歷史分類衝突 (Conflict)
    // 直接在 persistence 中模擬歷史記錄存在同 statId 但不同 category ('bow' vs 'boots')
    sessionStorage.setItem(
      ACTIVE_SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sessionId: 'search-conflict',
        league: 'Standard',
        mode: 'search',
        bindings: [
          { bindingId: 'b-1', statId: 'explicit.stat_conflict', category: 'bow' },
          { bindingId: 'b-2', statId: 'explicit.stat_conflict', category: 'boots' },
        ],
      }),
    );
    resetActiveBindingSessionForTest(true);

    const conflictStats: HostFilterGroup[] = [
      {
        filters: [
          { id: 'explicit.stat_conflict', disabled: false },
          { id: 'explicit.stat_conflict', disabled: false },
        ],
      },
    ];
    // 傳入當前官方分類 'body-armour'
    reconcileFilterBindings(conflictStats, 'body-armour');

    // 斷言：由於歷史分類衝突（無法確定哪個對應哪個），絕不隨機瞎猜（避免 silent mis-bind）
    // 兩者皆由當前 official category 初始化，且具備獨立 bindingId
    expect(conflictStats[0].filters![0].poexdCategory).toBe('body-armour');
    expect(conflictStats[0].filters![1].poexdCategory).toBe('body-armour');
    expect(conflictStats[0].filters![0].poexdBindingId).toBeDefined();
    expect(conflictStats[0].filters![1].poexdBindingId).toBeDefined();
    expect(conflictStats[0].filters![0].poexdBindingId).not.toBe(
      conflictStats[0].filters![1].poexdBindingId,
    );
  });

  it('13. PoE official adds filter: snapshot initializes new filter with official category without batch resetting existing filters', () => {
    // 官方 baseline: bow (known_category)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });

    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [filterA];

    // 初始化 filterA 並手動覆寫為 helmet
    tagFilterDomElements();
    setFilterCategory(filterA, 'helmet');
    persistBindings(stats);
    expect(filterA.poexdCategory).toBe('helmet');

    // PoE 官方 UI 新增 filterB，B 沒有任何 PoeXD metadata
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];

    // 執行實際 tagger / reconciliation lifecycle
    tagFilterDomElements();

    // 斷言：
    // 1. A 仍然為 helmet (manual override 不被官方 snapshot 洗掉)
    expect(filterA.poexdCategory).toBe('helmet');
    // 2. B 建立新的 bindingId
    expect(filterB.poexdBindingId).toBeDefined();
    expect(filterB.poexdBindingId).not.toBe(filterA.poexdBindingId);
    // 3. B 自動取得當下官方 snapshot (bow)
    expect(filterB.poexdCategory).toBe('bow');
    // 4. B 被 persistence 保存
    const stored = loadStoredBindings();
    expect(stored.find((b) => b.bindingId === filterB.poexdBindingId)?.category).toBe('bow');
    expect(stored.find((b) => b.bindingId === filterA.poexdBindingId)?.category).toBe('helmet');
  });

  it('14. Vuex object replacement: historical binding takes precedence over official category fallback', () => {
    // 官方目前 bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });

    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [filterA];

    tagFilterDomElements();
    setFilterCategory(filterA, 'helmet');
    persistBindings(stats);
    const originalBindingId = filterA.poexdBindingId;

    // Vuex 將 A object replacement，新 object 沒有 PoeXD metadata
    const freshFilterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [freshFilterA];
    expect(freshFilterA.poexdBindingId).toBeUndefined();
    expect(freshFilterA.poexdCategory).toBeUndefined();

    // 執行 tagger / reconciliation
    tagFilterDomElements();

    // 斷言：A 恢復為 helmet，不得因 official snapshot=bow 變回 bow
    expect(freshFilterA.poexdCategory).toBe('helmet');
    expect(freshFilterA.poexdBindingId).toBe(originalBindingId);
  });

  it('15. Initial baseline: initial official detection establishes snapshot without batch updating existing filters', () => {
    // 模擬已存在手動設為 ring 的 filter
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_res', disabled: false };
    stats[0].filters = [filterA];
    setFilterCategory(filterA, 'ring');
    persistBindings(stats);

    // 首次執行官方 category 解析 (baseline)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });

    // 斷言：
    // 1. Snapshot 更新為 bow
    expect(getOfficialCategorySnapshot()).toBe('bow');
    // 2. 向 UI consumer 發布 initial baseline state notification
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: 'bow',
    });
    // 3. 既有 manual category 不變（不 batch overwrite）
    expect(filterA.poexdCategory).toBe('ring');
  });

  it('16. True change: transition bow -> helmet updates snapshot, batches existing filters, and initializes subsequent filters with helmet', () => {
    // 建立 baseline bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });

    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    expect(filterA.poexdCategory).toBe('bow');

    mockBridge.dispatchEvent.mockClear();

    // 模擬官方類別真正改為 helmet
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' } } } },
    });

    // 斷言：
    // 1. Current snapshot 更新為 helmet
    expect(getOfficialCategorySnapshot()).toBe('helmet');
    // 2. 派發 poexd-equipment-type-changed
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: 'helmet',
    });
    // 3. 既有 filters 全數 batch 為 helmet
    expect(filterA.poexdCategory).toBe('helmet');

    // 4. 後續由 PoE 官方新增的新 filter 也初始化為 helmet
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters.push(filterB);
    tagFilterDomElements();

    expect(filterB.poexdCategory).toBe('helmet');
  });

  it('17. Temporary unavailable: bow -> temporary null -> bow preserves valid snapshot and protects filter categories', () => {
    // 建立 baseline bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    mockBridge.dispatchEvent.mockClear();

    // 模擬 query 暫態 unavailable（例如過渡態 query）
    syncOfficialCategoryFromStore({});

    // 斷言：不派發 changed，snapshot 依然為 bow
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
    expect(getOfficialCategorySnapshot()).toBe('bow');

    // 恢復為 bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });

    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
    expect(getOfficialCategorySnapshot()).toBe('bow');
  });

  it('18. Regression Scenario A: Tier min/max + URL mutation preserves bindingId and category without generating new bindingId or clearing category', () => {
    // 初始狀態：statId = explicit.stat_life, bindingId = A, category = bucklers
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = {
      id: 'explicit.stat_life',
      disabled: false,
      value: { min: 10 },
    };
    stats[0].filters = [filterA];

    reconcileFilterBindings(stats);
    setFilterCategory(filterA, 'bucklers');
    persistBindings(stats);
    tagFilterDomElements();

    const originalBindingId = filterA.poexdBindingId;
    expect(originalBindingId).toBeDefined();
    expect(filterA.poexdCategory).toBe('bucklers');

    // 模擬使用者在 T 階下拉選單點擊 min/max/T階數值：
    // 1. PoE 修改 query state
    // 2. PoE 更新 URL (pushState/replaceState 產生新 slug)
    window.history.replaceState(null, '', '/trade/search/Standard/new-search-slug-after-min-max');

    // 3. Vuex store 執行 filter object replacement（全新物件，無不可枚舉屬性）
    const freshFilterA: HostFilterItem = {
      id: 'explicit.stat_life',
      disabled: false,
      value: { min: 25 },
    };
    stats[0].filters = [freshFilterA];
    expect(freshFilterA.poexdBindingId).toBeUndefined();
    expect(freshFilterA.poexdCategory).toBeUndefined();

    // 4. DOM rerender 與 tagger / reconciliation 觸發
    tagFilterDomElements();

    // 斷言：URL 改變絕不中斷 session，logical filter 必須維持原 bindingId 與 category，絕不生成新 bindingId 或清為 null！
    expect(freshFilterA.poexdBindingId).toBe(originalBindingId);
    expect(freshFilterA.poexdCategory).toBe('bucklers');
  });

  it('19. Regression Scenario B: Continuous multiple query edits with frequent URL mutations preserve binding and category throughout', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_res', disabled: false };
    stats[0].filters = [filterA];

    tagFilterDomElements();
    setFilterCategory(filterA, 'boots');
    persistBindings(stats);
    const originalBindingId = filterA.poexdBindingId;

    // 連續多次 query 編輯：
    // 1. min 10 -> 20, URL 變更
    window.history.replaceState(null, '', '/trade/search/Standard/slug_min_20');
    stats[0].filters[0].value = { min: 20 };
    tagFilterDomElements();
    expect(stats[0].filters[0].poexdBindingId).toBe(originalBindingId);
    expect(stats[0].filters[0].poexdCategory).toBe('boots');

    // 2. max 30 -> 40, URL 變更
    window.history.replaceState(null, '', '/trade/search/Standard/slug_max_40');
    stats[0].filters[0].value = { min: 20, max: 40 };
    tagFilterDomElements();
    expect(stats[0].filters[0].poexdBindingId).toBe(originalBindingId);
    expect(stats[0].filters[0].poexdCategory).toBe('boots');

    // 3. Tier T2 -> T1 (帶動 Vuex replacement), URL 再次變更
    window.history.replaceState(null, '', '/trade/search/Standard/slug_tier_t1');
    const replacedFilter: HostFilterItem = {
      id: 'explicit.stat_res',
      disabled: false,
      value: { min: 45, max: 48 },
    };
    stats[0].filters = [replacedFilter];
    tagFilterDomElements();

    expect(replacedFilter.poexdBindingId).toBe(originalBindingId);
    expect(replacedFilter.poexdCategory).toBe('boots');
  });

  it('20. Regression Scenario C: True new filter in same active session gets fresh bindingId and current official category snapshot', () => {
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' } } } },
    });

    const stats = mockStore.state!.persistent!.stats!;
    const filterOld: HostFilterItem = { id: 'explicit.stat_old', disabled: false };
    stats[0].filters = [filterOld];
    tagFilterDomElements();
    setFilterCategory(filterOld, 'bucklers');
    persistBindings(stats);

    const oldBindingId = filterOld.poexdBindingId;

    // 新增另一個全新 filter
    const filterNew: HostFilterItem = { id: 'explicit.stat_new', disabled: false };
    stats[0].filters = [filterOld, filterNew];
    tagFilterDomElements();

    // 斷言：
    // 舊 filter 完全不受影響
    expect(filterOld.poexdBindingId).toBe(oldBindingId);
    expect(filterOld.poexdCategory).toBe('bucklers');

    // 新 filter 建立全新 bindingId，並以官方 snapshot (helmet) 初始化
    expect(filterNew.poexdBindingId).toBeDefined();
    expect(filterNew.poexdBindingId).not.toBe(oldBindingId);
    expect(filterNew.poexdCategory).toBe('helmet');
  });

  it('21. Regression Scenario D: Truly different search (same league pushState navigation) isolates category bindings', () => {
    // 搜尋 A (Standard 聯盟)
    const statsA = mockStore.state!.persistent!.stats!;
    const filterLifeA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsA[0].filters = [filterLifeA];
    tagFilterDomElements();
    setFilterCategory(filterLifeA, 'boots');
    persistBindings(statsA);

    const sessionAId = getActiveSessionId();
    expect(filterLifeA.poexdCategory).toBe('boots');

    // 使用者在同聯盟 (Standard) 下透過 pushState 載入另一個全新搜尋 (Search B)
    window.history.pushState(null, '', '/trade/search/Standard/search_b');
    syncDomTaggerRoute('pushState');

    const sessionBId = getActiveSessionId();
    expect(sessionBId).not.toBe(sessionAId);
    expect(loadStoredBindings()).toHaveLength(0);

    // 搜尋 B 中也有同一個通用詞綴 stat_life
    const statsB: HostFilterGroup[] = [
      {
        filters: [{ id: 'explicit.stat_life', disabled: false }],
      },
    ];
    reconcileFilterBindings(statsB);

    // 斷言：搜尋 A 的 boots 分類絕不得靜默套用到搜尋 B
    expect(statsB[0].filters![0].poexdCategory).toBeUndefined();
    expect(statsB[0].filters![0].poexdBindingId).not.toBe(filterLifeA.poexdBindingId);
  });

  it('22. Regression Scenario E: Reload recovery preserves bindings and categories without assuming static URL', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_speed', disabled: false };
    stats[0].filters = [filterA];

    tagFilterDomElements();
    setFilterCategory(filterA, 'boots');
    persistBindings(stats);
    const savedBindingId = filterA.poexdBindingId;

    // 模擬編輯後 URL 多次變更
    window.history.replaceState(null, '', '/trade/search/Standard/slug_after_many_edits');

    // 模擬 F5 重新整理（記憶體全清，保留 sessionStorage）
    resetActiveBindingSessionForTest(true);

    // 重新整理後頁面重新載入，Vuex 重新生成全新 filter 物件
    const reloadedFilter: HostFilterItem = { id: 'explicit.stat_speed', disabled: false };
    stats[0].filters = [reloadedFilter];

    // 重新整理後的初始化流程
    tagFilterDomElements();

    // 斷言：即便利動前 URL 已多次變更，重新整理仍精確還原原 bindingId 與 category
    expect(reloadedFilter.poexdBindingId).toBe(savedBindingId);
    expect(reloadedFilter.poexdCategory).toBe('boots');
  });

  it('23. Regression Scenario F: Official Any clears existing filter categories while preserving bindingIds, and subsequent change batches correctly', () => {
    // 初始狀態：官方為 bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];
    tagFilterDomElements();

    const bindingIdA = filterA.poexdBindingId;
    const bindingIdB = filterB.poexdBindingId;
    expect(filterA.poexdCategory).toBe('bow');
    expect(filterB.poexdCategory).toBe('bow');

    mockBridge.dispatchEvent.mockClear();

    // 1. 官方道具大類變更為 Any / 任何 (known cleared)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: '' } } } },
    });

    // 斷言：
    // - snapshot 變為 null
    expect(getOfficialCategorySnapshot()).toBeNull();
    // - dispatchEvent 派發 type: null
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: null,
    });
    // - 所有既有 filter 的 category 被清空
    expect(filterA.poexdCategory).toBeUndefined();
    expect(filterB.poexdCategory).toBeUndefined();
    // - 重要 Invariant：bindingId 嚴格保持不變！
    expect(filterA.poexdBindingId).toBe(bindingIdA);
    expect(filterB.poexdBindingId).toBe(bindingIdB);

    mockBridge.dispatchEvent.mockClear();

    // 2. 官方道具大類隨後再變更為 helmet
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' } } } },
    });

    // 斷言：
    // - dispatchEvent 派發 type: helmet
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: 'helmet',
    });
    // - 所有既有 filter 批次更新為 helmet
    expect(filterA.poexdCategory).toBe('helmet');
    expect(filterB.poexdCategory).toBe('helmet');
    // - bindingId 依然保持不變！
    expect(filterA.poexdBindingId).toBe(bindingIdA);
    expect(filterB.poexdBindingId).toBe(bindingIdB);
  });

  it('24. Regression Scenario G: Temporary unavailable DOM preserves snapshot and bindings without false change event', () => {
    // 建立 baseline
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    mockBridge.dispatchEvent.mockClear();

    // 模擬 query 暫態缺失/unavailable
    syncOfficialCategoryFromStore({});

    // 斷言：unavailable 狀態下 baseline 不變，絕不觸發 changed 事件
    expect(getOfficialCategorySnapshot()).toBe('bow');
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();

    // 模擬 query 恢復（弓）
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });

    // 斷言：同值恢復不觸發 changed 事件，狀態完全穩定
    expect(getOfficialCategorySnapshot()).toBe('bow');
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
  });

  it('25. Regression Scenario H: Clear -> Object replacement preserves bindingId and maintains unbound category', () => {
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();

    const originalBindingId = filterA.poexdBindingId;
    expect(originalBindingId).toBeDefined();
    expect(filterA.poexdCategory).toBe('bow');

    // 官方選擇 Any / 任何 (known cleared)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: '' } } } },
    });

    expect(filterA.poexdCategory).toBeUndefined();
    expect(filterA.poexdBindingId).toBe(originalBindingId);

    // 驗證 persistence 保存了 category 為 null 的 unbound binding
    const storedAfterClear = loadStoredBindings();
    const storedItem = storedAfterClear.find((b) => b.bindingId === originalBindingId);
    expect(storedItem).toBeDefined();
    expect(storedItem?.category).toBeNull();

    // 模擬 PoE 進行 Vuex filter object replacement（全新物件，無不可枚舉屬性）
    const freshFilterA: HostFilterItem = {
      id: 'explicit.stat_a',
      disabled: false,
      value: { min: 10 },
    };
    stats[0].filters = [freshFilterA];
    expect(freshFilterA.poexdBindingId).toBeUndefined();
    expect(freshFilterA.poexdCategory).toBeUndefined();

    // 觸發 tagFilterDomElements (reconciliation)
    tagFilterDomElements();

    // 斷言：
    // 1. bindingId 保持為原 bindingId，不產生新 bindingId
    expect(freshFilterA.poexdBindingId).toBe(originalBindingId);
    // 2. category 維持 unbound (undefined)，不被誤填為 official snapshot
    expect(freshFilterA.poexdCategory).toBeUndefined();
  });

  it('26. Regression Scenario I: Clear -> Reload preserves bindingId and unbound state across reload', () => {
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_speed', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();

    const originalBindingId = filterA.poexdBindingId;
    expect(filterA.poexdCategory).toBe('bow');

    // 官方選擇 Any (known cleared)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: '' } } } },
    });

    expect(filterA.poexdCategory).toBeUndefined();

    // 模擬 F5 重新整理（記憶體重置，保留 sessionStorage）
    resetActiveBindingSessionForTest(true);

    // 重新整理後 Vuex 載入全新 filter 物件
    const reloadedFilter: HostFilterItem = { id: 'explicit.stat_speed', disabled: false };
    stats[0].filters = [reloadedFilter];

    tagFilterDomElements();

    // 斷言：
    // 1. 還原後維持原 bindingId
    expect(reloadedFilter.poexdBindingId).toBe(originalBindingId);
    // 2. category 仍為 unbound (undefined)，不被自動賦予任何 category
    expect(reloadedFilter.poexdCategory).toBeUndefined();
    // 3. persistence 中仍為 category: null
    const stored = loadStoredBindings();
    expect(stored.find((b) => b.bindingId === originalBindingId)?.category).toBeNull();
  });

  it('27. Regression Scenario J: Unknown mapping does not clear snapshot or bindings; explicit Any clears snapshot and categories', () => {
    // 建立 baseline (弓 -> bow)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    expect(filterA.poexdCategory).toBe('bow');

    mockBridge.dispatchEvent.mockClear();

    // 1. 模擬 query 為未知 option（官方未來新 category 或非預期 option）
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'future_unknown_category' } } } },
    });

    // 斷言：非空未知分類視為 unavailable，不得 dispatch change，snapshot 與 filter category 嚴格保持不變！
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
    expect(getOfficialCategorySnapshot()).toBe('bow');
    expect(filterA.poexdCategory).toBe('bow');

    // 2. 模擬使用者明確選擇「任何」(Any / known cleared)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: '' } } } },
    });

    // 斷言：明確 Any 觸發 changed 事件 (type: null)，snapshot 清空
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: null,
    });
    expect(getOfficialCategorySnapshot()).toBeNull();
    expect(filterA.poexdCategory).toBeUndefined();
  });

  it('28. Regression Scenario K: Navigating away from search (e.g. /trade/exchange) triggers session rollover and stops dom tagger', () => {
    // 初始於 search 路由
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'boots');
    persistBindings(stats);

    const initialSessionId = getActiveSessionId();
    expect(filterA.poexdCategory).toBe('boots');

    // 導航到 exchange 模式
    window.history.pushState(null, '', '/trade/exchange/Standard');
    syncDomTaggerRoute('pushState');

    // 斷言：
    // 1. session rollover 產生新 sessionId
    const rolledSessionId = getActiveSessionId();
    expect(rolledSessionId).not.toBe(initialSessionId);
    // 2. session 模式更新為 exchange 且 bindings 已清空
    const session = ensureActiveBindingSession();
    expect(session.mode).toBe('exchange');
    expect(session.bindings).toHaveLength(0);
  });

  it('29. Regression Scenario L: Search submission with new search slug does not rollover session', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'boots');
    persistBindings(stats);

    const initialSessionId = getActiveSessionId();
    expect(filterA.poexdCategory).toBe('boots');

    // 模擬使用者點擊搜尋按鈕送出
    const submittedSlug = 'search_result_slug_123';
    startPendingSearchSubmission();

    // PoE 前端更新 URL
    window.history.pushState(null, '', `/trade/search/Standard/${submittedSlug}`);
    syncDomTaggerRoute('pushState');

    // 斷言：同搜尋送出結果不 rollover session！
    expect(getActiveSessionId()).toBe(initialSessionId);
    expect(filterA.poexdCategory).toBe('boots');
  });

  it('30. Regression Scenario M: activeSearchSubmissionId is one-shot transition token and does not linger to exempt subsequent navigation back to X', () => {
    // 初始於 Session A
    const statsA = mockStore.state!.persistent!.stats!;
    const filterLifeA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsA[0].filters = [filterLifeA];
    tagFilterDomElements();
    setFilterCategory(filterLifeA, 'boots');
    persistBindings(statsA);

    const sessionAId = getActiveSessionId();
    expect(filterLifeA.poexdCategory).toBe('boots');

    // 1. 提交搜尋
    startPendingSearchSubmission();

    // 2. PoE 前端更新 URL 至 X (一次性過渡)
    window.history.pushState(null, '', '/trade/search/Standard/submission_X');
    syncDomTaggerRoute('pushState');

    // 驗證：Session A 延續，未 rollover，且 token 已被 consume
    expect(getActiveSessionId()).toBe(sessionAId);
    expect(filterLifeA.poexdCategory).toBe('boots');

    // 3. 使用者之後切換至 Search B
    window.history.pushState(null, '', '/trade/search/Standard/search_B');
    syncDomTaggerRoute('pushState');

    // 驗證：切換到 B 觸發 rollover
    const sessionBId = getActiveSessionId();
    expect(sessionBId).not.toBe(sessionAId);

    // 4. 使用者按上一頁（或 pushState 回到 submission_X）
    window.history.pushState(null, '', '/trade/search/Standard/submission_X');
    syncDomTaggerRoute('pushState');

    // 斷言：絕不得因 stale submission token 而把 Session B 延續至 X！必須再次 rollover！
    const sessionX2Id = getActiveSessionId();
    expect(sessionX2Id).not.toBe(sessionBId);
  });

  it('31. Regression Scenario N: Same-league new document navigation (e.g. pasting Search B) does not restore Search A bindings', () => {
    // Search A in Standard
    const statsA = mockStore.state!.persistent!.stats!;
    const filterLifeA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsA[0].filters = [filterLifeA];
    tagFilterDomElements();
    setFilterCategory(filterLifeA, 'boots');
    persistBindings(statsA);

    const sessionAId = getActiveSessionId();
    const bindingAId = filterLifeA.poexdBindingId;
    expect(filterLifeA.poexdCategory).toBe('boots');

    // 模擬使用者貼入或開啟另一份 Search B (同為 Standard 聯盟)
    // 進行 document navigation (全新初始化，sessionStorage 仍留存 A，但 history.state 為 null / 新 navigation)
    resetActiveBindingSessionForTest(true); // 保留 sessionStorage
    // 設置新導航之 URL 與乾淨的 history.state (模擬 document navigation，history.state 為 null)
    window.history.replaceState(null, '', '/trade/search/Standard/search_b');

    // 搜尋 B 中也有同一個通用詞綴 stat_life
    const statsB = mockStore.state!.persistent!.stats!;
    const filterLifeB: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsB[0].filters = [filterLifeB];

    // 初始化 Search B
    tagFilterDomElements();

    // 斷言：
    // 1. 產生全新 session，不沿用 A 的 sessionId
    expect(getActiveSessionId()).not.toBe(sessionAId);
    // 2. B 不繼承 A 的 bindingId
    expect(filterLifeB.poexdBindingId).toBeDefined();
    expect(filterLifeB.poexdBindingId).not.toBe(bindingAId);
    // 3. B 不繼承 boots 分類
    expect(filterLifeB.poexdCategory).toBeUndefined();
  });

  it('32. Regression Scenario O: Same edited search reload (F5 across multiple min/max URL mutations) restores bindings and category', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = {
      id: 'explicit.stat_life',
      disabled: false,
      value: { min: 10 },
    };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'bucklers');
    persistBindings(stats);

    const initialSessionId = getActiveSessionId();
    const initialBindingId = filterA.poexdBindingId;
    expect(filterA.poexdCategory).toBe('bucklers');

    // 連續多次 min/max 編輯，PoE 使用 replaceState 更新 URL
    window.history.replaceState(null, '', '/trade/search/Standard/slug_min_20');
    syncDomTaggerRoute('replaceState');
    stats[0].filters[0].value = { min: 20 };
    tagFilterDomElements();

    window.history.replaceState(null, '', '/trade/search/Standard/slug_max_40');
    syncDomTaggerRoute('replaceState');
    stats[0].filters[0].value = { min: 20, max: 40 };
    tagFilterDomElements();

    // 模擬 F5 reload（重置記憶體 activeBindingSession，保留 sessionStorage 與 history.state）
    // 在 real browser 中，reload 保留 window.history.state，window.history.state.__poexdSessionId 依然存在
    resetActiveBindingSessionForTest(true);
    // 模擬 Vuex 重新建立 filter 物件
    const reloadedFilter: HostFilterItem = {
      id: 'explicit.stat_life',
      disabled: false,
      value: { min: 20, max: 40 },
    };
    stats[0].filters = [reloadedFilter];

    // 重新整理後的初始化流程
    tagFilterDomElements();

    // 斷言：原 bindingId 與 category 完美恢復！
    expect(getActiveSessionId()).toBe(initialSessionId);
    expect(reloadedFilter.poexdBindingId).toBe(initialBindingId);
    expect(reloadedFilter.poexdCategory).toBe('bucklers');
  });

  it('33. Regression Scenario A: API ID differs from encoded URL slug (data.id = api_123, slug = H4sIA_query) preserves session, bindingId, and category', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'boots');
    persistBindings(stats);

    const initialSessionId = getActiveSessionId();
    const initialBindingId = filterA.poexdBindingId;
    expect(filterA.poexdCategory).toBe('boots');

    // 模擬搜尋發送：在發送邊界建立 pending submission，API 回傳 data.id = 'api_123'
    startPendingSearchSubmission();

    // PoE 前端更新 URL 至 encoded query slug（與 API 回傳之 data.id 完全不同）
    const encodedSlug = 'H4sIA_encoded_query_hash_example';
    window.history.pushState(null, '', `/trade/search/Standard/${encodedSlug}`);
    syncDomTaggerRoute('pushState');

    // 斷言：
    // 1. Session ID 維持不變（不因 slug !== data.id 而 rollover）
    expect(getActiveSessionId()).toBe(initialSessionId);
    // 2. bindingId 維持不變
    expect(filterA.poexdBindingId).toBe(initialBindingId);
    // 3. Category 維持 boots 不變
    expect(filterA.poexdCategory).toBe('boots');
  });

  it('34. Regression Scenario B: XHR ordering race (Host response handler updates history before PoeXD observation listener) preserves session without rollover', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_res', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'helmets');
    persistBindings(stats);

    const initialSessionId = getActiveSessionId();
    expect(filterA.poexdCategory).toBe('helmets');

    let hostRanFirst = false;
    let poexdRan = false;

    class OrderingFakeXhr {
      status = 200;
      responseType = 'json';
      response = { id: 'api_xhr_race_123' };
      private listeners: Record<string, Function[]> = {};
      onload: (() => void) | null = null;

      open(_method: string, _url: string) {}
      addEventListener(type: string, fn: Function) {
        (this.listeners[type] ||= []).push(fn);
      }
      send(_body?: any) {
        // 模擬伺服器回傳：Host 註冊在 onload 的回呼先執行並更新 history
        if (this.onload) {
          hostRanFirst = true;
          this.onload();
        }
        // PoeXD 的 load 監聽函式隨後執行
        this.listeners.load?.forEach((fn) => {
          poexdRan = true;
          fn.call(this);
        });
      }
    }

    const fakeWindow = { XMLHttpRequest: OrderingFakeXhr } as any;
    const bridgeStub = { dispatchEvent: vi.fn(), addListener: vi.fn() } as any;
    installXhrInterceptor(bridgeStub, fakeWindow);

    const xhr = new fakeWindow.XMLHttpRequest();
    xhr.open('POST', 'https://www.pathofexile.com/api/trade/search/Standard');
    xhr.onload = () => {
      // Host 在 PoeXD load 監聽器執行前就呼叫了 pushState
      window.history.pushState(null, '', '/trade/search/Standard/H4sIA_xhr_slug');
      syncDomTaggerRoute('pushState');
    };

    xhr.send(JSON.stringify({ query: mockStore.state!.persistent }));

    // 斷言：
    expect(hostRanFirst).toBe(true);
    expect(poexdRan).toBe(true);
    // 即使 Host 先執行，由於 pending submission 已在 xhr.send 前建立，因此不發生 rollover！
    expect(getActiveSessionId()).toBe(initialSessionId);
    expect(filterA.poexdCategory).toBe('helmets');
  });

  it('35. Regression Scenario C: Pending token is strictly one-shot (consumed transition cannot exempt a subsequent unrelated navigation)', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_str', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'gloves');
    persistBindings(stats);

    const initialSessionId = getActiveSessionId();
    expect(filterA.poexdCategory).toBe('gloves');

    // 1. 發起搜尋請求
    startPendingSearchSubmission();

    // 2. 正常搜尋結果過渡至 slug_1（消耗 token）
    window.history.pushState(null, '', '/trade/search/Standard/slug_1');
    syncDomTaggerRoute('pushState');

    // 驗證 token 已被消耗且 session 延續
    expect(getActiveSessionId()).toBe(initialSessionId);
    expect(filterA.poexdCategory).toBe('gloves');

    // 3. 隨後使用者點擊不相關的外部連結或書籤（unrelated pushState 至 search_B）
    window.history.pushState(null, '', '/trade/search/Standard/search_B');
    syncDomTaggerRoute('pushState');

    // 斷言：token 已被消耗，絕不得延續原 session，必須 rollover！
    const newSessionId = getActiveSessionId();
    expect(newSessionId).not.toBe(initialSessionId);

    // 4. 新 session 的 filter 不繼承 gloves 分類
    const filterB: HostFilterItem = { id: 'explicit.stat_str', disabled: false };
    stats[0].filters = [filterB];
    tagFilterDomElements();
    expect(filterB.poexdCategory).toBeUndefined();
  });

  it('36. Regression Scenario D: Failed, aborted, or expired search request does not linger to exempt subsequent navigation', () => {
    vi.useFakeTimers();
    try {
      const stats = mockStore.state!.persistent!.stats!;
      const filterA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
      stats[0].filters = [filterA];
      tagFilterDomElements();
      setFilterCategory(filterA, 'body-armour');
      persistBindings(stats);

      const sessionAId = getActiveSessionId();
      expect(filterA.poexdCategory).toBe('body-armour');

      // 情況 1：搜尋請求失敗 (error / abort) 立即被 cancel
      const reqId1 = startPendingSearchSubmission();
      cancelPendingSearchSubmission(reqId1);

      // 隨後發生 pushState 導航至 search_error_dest
      window.history.pushState(null, '', '/trade/search/Standard/search_error_dest');
      syncDomTaggerRoute('pushState');

      // 斷言：由於已 cancel，不得豁免，必須 rollover！
      const sessionAfterError = getActiveSessionId();
      expect(sessionAfterError).not.toBe(sessionAId);

      // 情況 2：搜尋成功返回但未觸發 URL 變更，短暫過渡期後過期
      const reqId2 = startPendingSearchSubmission();
      completePendingSearchSubmission(reqId2, 100); // 100ms 後過期

      // 前進 150ms 確保已過期
      vi.advanceTimersByTime(150);

      // 隨後使用者導航至 search_expired_dest
      window.history.pushState(null, '', '/trade/search/Standard/search_expired_dest');
      syncDomTaggerRoute('pushState');

      // 斷言：已過期之請求不得豁免導航，必須再次 rollover！
      const sessionAfterExpired = getActiveSessionId();
      expect(sessionAfterExpired).not.toBe(sessionAfterError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('37. Regression Scenario E: Concurrent search requests handle race cleanly without corrupting session continuation', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_mana', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'rings');
    persistBindings(stats);

    const sessionAId = getActiveSessionId();
    expect(filterA.poexdCategory).toBe('rings');

    // 模擬使用者連續點擊兩次搜尋，Request 1 與 Request 2 先後在 flight 中
    const reqId1 = startPendingSearchSubmission();
    const reqId2 = startPendingSearchSubmission();

    // Request 1 遭到瀏覽器 abort 取消
    cancelPendingSearchSubmission(reqId1);

    // 斷言：Request 1 的取消不得破壞 Request 2 的 pending submission
    // 當 Request 2 的結果到達並更新 URL
    window.history.pushState(null, '', '/trade/search/Standard/result_slug_2');
    syncDomTaggerRoute('pushState');

    // 斷言：Request 2 成功延續 Session A！
    expect(getActiveSessionId()).toBe(sessionAId);
    expect(filterA.poexdCategory).toBe('rings');

    // 同時驗證：該次過渡已消耗 Request 2，隨後無關的 pushState 必須 rollover
    window.history.pushState(null, '', '/trade/search/Standard/unrelated_search');
    syncDomTaggerRoute('pushState');
    expect(getActiveSessionId()).not.toBe(sessionAId);
  });

  it('38. Protection A: In-flight request does not exempt unrelated navigation to Search B (B triggers rollover and does not inherit A bindings)', () => {
    // 1. 處於 Search A
    const statsA = mockStore.state!.persistent!.stats!;
    const filterLifeA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsA[0].filters = [filterLifeA];
    tagFilterDomElements();
    setFilterCategory(filterLifeA, 'boots');
    persistBindings(statsA);

    const sessionAId = getActiveSessionId();
    expect(filterLifeA.poexdCategory).toBe('boots');

    // 2. Search A 發出 search 請求，請求尚在 flight 中（未收到 response）
    startPendingSearchSubmission({
      query: { stats: [{ filters: [{ id: 'explicit.stat_life' }] }] },
      hasResponded: false,
    });

    // 3. 在 Request A 尚未完成前，使用者真正切到 Search B（例如點擊書籤或歷史紀錄）
    // 模擬切換到 Search B：Vuex 載入 Search B 的條件（例如 stat_mana）
    const statsB: HostFilterGroup[] = [
      { type: 'and', filters: [{ id: 'explicit.stat_mana', disabled: false }] },
    ];
    mockStore.state!.persistent!.stats = statsB;

    window.history.pushState(null, '', '/trade/search/Standard/search_B_slug');
    syncDomTaggerRoute('pushState');

    // 斷言：
    // 1. Search B 必須 rollover 建立新 session，不得被 Request A 的 in-flight token 豁免！
    const sessionBId = getActiveSessionId();
    expect(sessionBId).not.toBe(sessionAId);

    // 2. Search B 的 filter 不繼承 Search A 的 boots 分類
    tagFilterDomElements();
    expect(statsB[0].filters![0].poexdCategory).toBeUndefined();
  });

  it('39. Protection B: Two successful concurrent submissions both transition without premature deletion or false rollover', () => {
    // 處於初始 Session
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'helmets');
    persistBindings(stats);

    const sessionId = getActiveSessionId();
    expect(filterA.poexdCategory).toBe('helmets');

    const query1 = {
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_life', value: { min: 10 } }] }],
    };
    const query2 = {
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_life', value: { min: 20 } }] }],
    };

    // Request 1 與 Request 2 先後送出，都在 flight 中
    const reqId1 = startPendingSearchSubmission({ query: query1, hasResponded: false });
    const reqId2 = startPendingSearchSubmission({ query: query2, hasResponded: false });

    // 兩個請求都成功返回
    markSearchSubmissionResponded(reqId1);
    markSearchSubmissionResponded(reqId2);

    // 1. 第一個 transition 到達（對應 query1）
    mockStore.state!.persistent!.stats = query1.stats as any;
    window.history.pushState(null, '', '/trade/search/Standard/slug_query_1');
    syncDomTaggerRoute('pushState');

    // 斷言：第一個 transition 成功延續 session，且絕不提前刪除 Request 2！
    expect(getActiveSessionId()).toBe(sessionId);
    expect(filterA.poexdCategory).toBe('helmets');

    // 2. 第二個合法 transition 到達（對應 query2）
    mockStore.state!.persistent!.stats = query2.stats as any;
    window.history.pushState(null, '', '/trade/search/Standard/slug_query_2');
    syncDomTaggerRoute('pushState');

    // 斷言：第二個 transition 依然持有 token，成功延續 session，不發生錯誤 rollover！
    expect(getActiveSessionId()).toBe(sessionId);
    expect(filterA.poexdCategory).toBe('helmets');

    // 3. 隨後的不相關導航因為 token 已全部消耗，必須 rollover
    window.history.pushState(null, '', '/trade/search/Standard/unrelated_navigation');
    syncDomTaggerRoute('pushState');
    expect(getActiveSessionId()).not.toBe(sessionId);
  });

  it('40. Fail-closed A: Missing pending request fingerprint fails closed and triggers rollover on unrelated navigation', () => {
    const statsA = mockStore.state!.persistent!.stats!;
    const filterLifeA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsA[0].filters = [filterLifeA];
    tagFilterDomElements();
    setFilterCategory(filterLifeA, 'boots');
    persistBindings(statsA);

    const sessionAId = getActiveSessionId();
    expect(filterLifeA.poexdCategory).toBe('boots');

    // 建立一個沒有有效 query 指紋的 pending request (query 為 null)
    startPendingSearchSubmission({ query: null, hasResponded: true });

    // 隨後發生導航至 Search B
    window.history.pushState(null, '', '/trade/search/Standard/search_B_slug');
    syncDomTaggerRoute('pushState');

    // 斷言：指紋缺失時嚴格 fail-closed，必須 rollover！
    expect(getActiveSessionId()).not.toBe(sessionAId);
  });

  it('41. Fail-closed B: Valid pending fingerprint but unavailable transition fingerprint fails closed and triggers rollover', () => {
    const statsA = mockStore.state!.persistent!.stats!;
    const filterLifeA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsA[0].filters = [filterLifeA];
    tagFilterDomElements();
    setFilterCategory(filterLifeA, 'boots');
    persistBindings(statsA);

    const sessionAId = getActiveSessionId();
    expect(filterLifeA.poexdCategory).toBe('boots');

    // 有效的 pending fingerprint
    startPendingSearchSubmission({
      query: { stats: [{ filters: [{ id: 'explicit.stat_life' }] }] },
      hasResponded: true,
    });

    // 過渡發生時，Vuex store 的 query 暫時不可讀（為 undefined / null）
    mockStore.state!.persistent = undefined as any;
    mockStore.state!.query = undefined as any;

    window.history.pushState(null, '', '/trade/search/Standard/slug_next');
    syncDomTaggerRoute('pushState');

    // 斷言：過渡指紋缺失時嚴格 fail-closed，不得消費 token，必須 rollover！
    expect(getActiveSessionId()).not.toBe(sessionAId);
  });

  it('42. Fail-closed C: Fingerprint mismatch triggers rollover and does not mistakenly consume pending token', () => {
    const statsA = mockStore.state!.persistent!.stats!;
    const filterLifeA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    statsA[0].filters = [filterLifeA];
    tagFilterDomElements();
    setFilterCategory(filterLifeA, 'boots');
    persistBindings(statsA);

    const sessionAId = getActiveSessionId();

    const query1 = { stats: [{ type: 'and', filters: [{ id: 'explicit.stat_life' }] }] };
    startPendingSearchSubmission({ query: query1, hasResponded: true });

    // 發生一個條件不相符的過渡 (queryMismatch)
    const queryMismatch = { stats: [{ type: 'and', filters: [{ id: 'explicit.stat_res' }] }] };
    mockStore.state!.persistent = queryMismatch as any;

    window.history.pushState(null, '', '/trade/search/Standard/mismatch_slug');
    syncDomTaggerRoute('pushState');

    // 斷言：指紋不相符必須 rollover！
    expect(getActiveSessionId()).not.toBe(sessionAId);
  });

  it('43. Concurrent Out-of-Order (B then A): When responses arrive out of order, both transitions succeed without false rollover', () => {
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_life', disabled: false };
    stats[0].filters = [filterA];
    tagFilterDomElements();
    setFilterCategory(filterA, 'helmets');
    persistBindings(stats);

    const initialSessionId = getActiveSessionId();
    expect(filterA.poexdCategory).toBe('helmets');

    const queryA = {
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_life', value: { min: 10 } }] }],
    };
    const queryB = {
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_life', value: { min: 20 } }] }],
    };

    // Request A 與 Request B 同時送出
    const reqIdA = startPendingSearchSubmission({ query: queryA, hasResponded: false });
    const reqIdB = startPendingSearchSubmission({ query: queryB, hasResponded: false });

    // 兩者皆成功返回
    markSearchSubmissionResponded(reqIdA);
    markSearchSubmissionResponded(reqIdB);

    // 1. Request B 的過渡反向先到達 (B transition arrives first)
    mockStore.state!.persistent!.stats = queryB.stats as any;
    window.history.pushState(null, '', '/trade/search/Standard/slug_B');
    syncDomTaggerRoute('pushState');

    // 斷言：B 成功延續 session，且 Request A 依然保留在 pending 隊列中！
    expect(getActiveSessionId()).toBe(initialSessionId);
    expect(filterA.poexdCategory).toBe('helmets');

    // 2. Request A 的過渡後到達 (A transition arrives second)
    mockStore.state!.persistent!.stats = queryA.stats as any;
    window.history.pushState(null, '', '/trade/search/Standard/slug_A');
    syncDomTaggerRoute('pushState');

    // 斷言：A 依然順利對齊指紋並延續 session，不造成 false rollover！
    expect(getActiveSessionId()).toBe(initialSessionId);
    expect(filterA.poexdCategory).toBe('helmets');

    // 3. 隨後的不相關導航因為 token 已全部消耗，必須 rollover
    window.history.pushState(null, '', '/trade/search/Standard/unrelated_slug');
    syncDomTaggerRoute('pushState');
    expect(getActiveSessionId()).not.toBe(initialSessionId);
  });

  it('44. Late subscriber / initial state delivery: Main World baseline established before consumer mounts delivers current official category and initial clear', () => {
    // 1. Main World 先建立 bow baseline
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    mockBridge.dispatchEvent.mockClear();

    // 2. 模擬 FilterPane late-subscribe (掛載時派發 poexd-request-official-category)
    const requestHandler = listeners.get('poexd-request-official-category');
    expect(requestHandler).toBeDefined();

    requestHandler!(undefined);

    // 3. 斷言：Main World 立即回傳當前 snapshot (bow)
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: 'bow',
    });

    mockBridge.dispatchEvent.mockClear();

    // 4. 切換為明確 Any (known cleared)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: '' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBeNull();
    mockBridge.dispatchEvent.mockClear();

    // 5. 再次 late-subscribe 請求
    requestHandler!(undefined);

    // 斷言：回傳 type: null (initial clear)
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: null,
    });
  });

  it('45. Vuex subscribe lifecycle across route transitions: search -> exchange -> search -> exchange -> search preserves single category subscriber without subscription leaks', () => {
    let observerTriggerCount = 0;
    const subscribers: Array<(mutation: unknown, state: unknown) => void> = [];

    const testStore: HostVuexStore = {
      state: {
        persistent: {
          stats: [{ filters: [] }],
        },
      },
      _withCommit: vi.fn((fn: () => void) => fn()),
      commit: vi.fn(),
      subscribe: vi.fn((fn: (mutation: unknown, state: unknown) => void) => {
        subscribers.push(fn);
        return () => {
          const idx = subscribers.indexOf(fn);
          if (idx !== -1) subscribers.splice(idx, 1);
        };
      }),
    };

    const tradeEl = document.getElementById('trade');
    if (tradeEl) {
      (tradeEl as any).__vue__ = { $store: testStore };
    }

    // 1. 初始 search
    window.history.replaceState(null, '', '/trade/search/Standard/search_slug_1');
    syncDomTaggerRoute('replaceState');
    tagFilterDomElements();
    expect(subscribers.length).toBe(1);

    // 2. 切換至 exchange
    window.history.pushState(null, '', '/trade/exchange/Standard');
    syncDomTaggerRoute('pushState');
    expect(subscribers.length).toBe(0);

    // 3. 回到 search
    window.history.pushState(null, '', '/trade/search/Standard/search_slug_2');
    syncDomTaggerRoute('pushState');
    tagFilterDomElements();
    expect(subscribers.length).toBe(1);

    // 4. 再次切換至 exchange
    window.history.pushState(null, '', '/trade/exchange/Standard');
    syncDomTaggerRoute('pushState');
    expect(subscribers.length).toBe(0);

    // 5. 再次回到 search
    window.history.pushState(null, '', '/trade/search/Standard/search_slug_3');
    syncDomTaggerRoute('pushState');
    tagFilterDomElements();
    expect(subscribers.length).toBe(1);

    // 6. 模擬 Vuex mutation 觸發
    observerTriggerCount = 0;
    subscribers.forEach((cb) => {
      observerTriggerCount += 1;
      cb({}, {});
    });

    // 斷言：同一 mutation 確切只觸發一次 category observer，未累積重複 subscriptions
    expect(observerTriggerCount).toBe(1);
    expect(subscribers.length).toBe(1);
  });

  it('46. Request before baseline -> first trustworthy state = weapon.bow: consumer eventually receives bow and existing manual per-filter categories are preserved', () => {
    // 1. officialCategorySnapshot 尚未建立
    expect(getOfficialCategorySnapshot()).toBeNull();

    // 模擬既有手動 filter (例如已綁定 ring)
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_manual', disabled: false };
    stats[0].filters = [filterA];
    setFilterCategory(filterA, 'ring');
    persistBindings(stats);

    // 2. FilterPane consumer 先送 poexd-request-official-category
    const requestHandler = listeners.get('poexd-request-official-category');
    expect(requestHandler).toBeDefined();

    mockBridge.dispatchEvent.mockClear();
    // 3. 此時 structured query 尚 unavailable
    requestHandler!(undefined);

    // 斷言：此時不可派發 false clear (type: null)
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();

    // 4. 之後 Main World 第一次取得 weapon.bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });

    // 5. consumer 最終必須收到 bow
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: 'bow',
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    // 6. existing manual per-filter categories 不得被 initial baseline batch overwrite
    expect(filterA.poexdCategory).toBe('ring');
  });

  it('47. Request before baseline -> first trustworthy state = known_cleared: consumer eventually receives null state and manual filters are not wiped', () => {
    // 1. officialCategorySnapshot 尚未建立
    expect(getOfficialCategorySnapshot()).toBeNull();

    // 模擬既有手動 filter (例如已綁定 ring)
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_manual', disabled: false };
    stats[0].filters = [filterA];
    setFilterCategory(filterA, 'ring');
    persistBindings(stats);

    // 2. FilterPane consumer 先送 poexd-request-official-category (此時 query unavailable)
    const requestHandler = listeners.get('poexd-request-official-category');
    expect(requestHandler).toBeDefined();

    mockBridge.dispatchEvent.mockClear();
    requestHandler!(undefined);
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();

    // 3. 之後 Main World 第一次取得 clear state (例如 Any)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: '' } } } },
    });

    // 4. consumer 最終收到 clear / null state
    expect(mockBridge.dispatchEvent).toHaveBeenCalledWith('poexd-equipment-type-changed', {
      type: null,
    });
    expect(getOfficialCategorySnapshot()).toBeNull();

    // 5. existing manual per-filter categories 不被 initial baseline 清除
    expect(filterA.poexdCategory).toBe('ring');
  });

  it('48. Broad official category protection: transition from baseline bow to broad weapon preserves bow snapshot, does not batch overwrite filters, and does not fire false clear', () => {
    // 1. 建立 baseline bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterManual: HostFilterItem = { id: 'explicit.stat_m', disabled: false };
    stats[0].filters = [filterA, filterManual];
    setFilterCategory(filterA, 'bow');
    setFilterCategory(filterManual, 'ring'); // 手動覆寫為 ring
    persistBindings(stats);

    mockBridge.dispatchEvent.mockClear();

    // 2. Structured query 改為 broad weapon (Any Weapon)
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon' } } } },
    });

    // 斷言：
    // - snapshot 依然保留為 bow（不被 broad option 清除或改寫為劍）
    expect(getOfficialCategorySnapshot()).toBe('bow');
    // - 不觸發 dispatchEvent（未派發 false clear 或 false transition）
    expect(mockBridge.dispatchEvent).not.toHaveBeenCalled();
    // - existing manual / per-filter categories 不被 batch overwrite
    expect(filterA.poexdCategory).toBe('bow');
    expect(filterManual.poexdCategory).toBe('ring');
  });

  it('49. Snapshot eligibility: unavailable/broad official query preserves last trusted snapshot but keeps newly added filters unbound', () => {
    // 1. 建立可信 baseline: weapon.bow -> snapshot = bow
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBe('bow');

    // 2. existing filter A: category = bow
    // 3. existing filter B: manual category = ring
    const stats = mockStore.state!.persistent!.stats!;
    const filterA: HostFilterItem = { id: 'explicit.stat_a', disabled: false };
    const filterB: HostFilterItem = { id: 'explicit.stat_b', disabled: false };
    stats[0].filters = [filterA, filterB];
    tagFilterDomElements();
    expect(filterA.poexdCategory).toBe('bow');
    expect(filterB.poexdCategory).toBe('bow');

    // 將 filter B 手動覆寫為 ring
    setFilterCategory(filterB, 'ring');
    persistBindings(stats);
    expect(filterB.poexdCategory).toBe('ring');

    const bindingIdA = filterA.poexdBindingId;
    const bindingIdB = filterB.poexdBindingId;

    // 4. 官方改成: weapon (Any Weapon) -> resolver = unavailable
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon' } } } },
    });

    // 確認：
    // - snapshot 仍為 bow
    expect(getOfficialCategorySnapshot()).toBe('bow');
    // - A 仍 bow
    expect(filterA.poexdCategory).toBe('bow');
    // - B 仍 ring
    expect(filterB.poexdCategory).toBe('ring');

    // 5. 此時 PoE 新增真正的新 filter C
    const filterC: HostFilterItem = { id: 'explicit.stat_c', disabled: false };
    stats[0].filters = [filterA, filterB, filterC];

    // 執行實際 tagFilterDomElements / reconcileFilterBindings lifecycle
    tagFilterDomElements();

    // 確認：
    // - C 取得新的 bindingId
    expect(filterC.poexdBindingId).toBeDefined();
    expect(filterC.poexdBindingId).not.toBe(bindingIdA);
    expect(filterC.poexdBindingId).not.toBe(bindingIdB);
    // - C 不得取得 bow
    expect(filterC.poexdCategory).not.toBe('bow');
    // - C 保持 unbound / category undefined
    expect(filterC.poexdCategory).toBeUndefined();
    // - A/B 完全不變
    expect(filterA.poexdBindingId).toBe(bindingIdA);
    expect(filterA.poexdCategory).toBe('bow');
    expect(filterB.poexdBindingId).toBe(bindingIdB);
    expect(filterB.poexdCategory).toBe('ring');
    // - snapshot 仍為 bow
    expect(getOfficialCategorySnapshot()).toBe('bow');

    // 6. 之後官方真正改成: armour.helmet
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' } } } },
    });

    // 確認依既有 official-change contract 正常 batch 更新
    expect(getOfficialCategorySnapshot()).toBe('helmet');
    expect(filterA.poexdCategory).toBe('helmet');
    expect(filterB.poexdCategory).toBe('helmet');
    expect(filterC.poexdCategory).toBe('helmet');
  });

  it('50. Initial unavailable protection: new filter added before any trusted category is established stays unbound', () => {
    // 尚無可信 category (initial unavailable)
    resetOfficialCategoryBaselineForTest();
    syncOfficialCategoryFromStore({
      filters: { type_filters: { filters: { category: { option: 'weapon' } } } },
    });
    expect(getOfficialCategorySnapshot()).toBeNull();

    // 新 filter
    const stats = mockStore.state!.persistent!.stats!;
    const filterNew: HostFilterItem = { id: 'explicit.stat_init', disabled: false };
    stats[0].filters = [filterNew];

    tagFilterDomElements();

    // 不得任意初始化 category
    expect(filterNew.poexdBindingId).toBeDefined();
    expect(filterNew.poexdCategory).toBeUndefined();
    expect(getOfficialCategorySnapshot()).toBeNull();
  });
});
