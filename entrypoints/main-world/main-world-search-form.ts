/**
 * MAIN world 的官方搜尋表單寫入入口。
 *
 * 外掛對官方表單的每一次寫入都必須維持同一組不變式，否則詞綴的物品分類、詞綴分組與 T 階按鈕會脫鉤：
 * 1. 在 Vuex `_withCommit` 內或經官方 mutation 修改表單。
 * 2. Vuex mutation 可能 clone payload，store 裡實際存放的物件要補回不可列舉的隱藏屬性
 *    （`poexdBindingId` / `poexdCategory` / `poexdModGroup`）。
 * 3. 把 Category Binding 寫進 sessionStorage，重新整理或導覽後才能還原。
 * 4. 等官方重新渲染後重新標記 DOM（`data-poexd-*`）。`_withCommit` 直接改 state 不會觸發
 *    `store.subscribe`，所以要自己排程；同一輪內的多次排程合併成一次。
 *
 * 這些步驟由這裡的操作在內部完成，呼叫端（bridge adapter）只負責事件協定，不需要也無法漏做。
 * 是否寫入 sessionStorage 依操作而定：示範詞綴不寫入（避免被存下來），改分類由 binding manager 寫入。
 */
import type { CriteriaOverlayOp } from '@/utils/criteria-overlay';
import {
  setFilterCategory,
  setFilterModGroup,
  updateSingleFilterCategory,
  updateSingleFilterModGroup,
} from './category-binding-manager';
import { saveAllCategoriesToSessionStorage, tagFilterDomElements } from './dom-tagger';
import type { HostFilterGroup, HostFilterItem, HostVuexStore } from './host-types';
import { getTradeRootComponent, getVueStore, type HostTradeRoot } from './poe-runtime-reader';

/** 官方重新渲染需要的時間；重新標記排在這之後 */
const RETAG_DELAY_MS = 20;

const getStats = (store: HostVuexStore): HostFilterGroup[] | undefined =>
  store.state?.persistent?.stats || store.state?.query?.stats;

// ───────────────────────────── Criteria Overlay 的表單操作 ─────────────────────────────

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

/** 把表單條件欄位整批還原為備份內容（ops 執行失敗時使用）。 */
function restoreCriteriaOverlaySnapshot(store: HostVuexStore, backup: Record<string, unknown>) {
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

// ───────────────────────────── 隱藏屬性 ─────────────────────────────

/** Vuex mutation clone 了 payload 時，把 payload 上的隱藏屬性補到 store 裡實際存放的物件 */
function carryHiddenProps(source: HostFilterItem, stored: HostFilterItem | undefined): void {
  if (!stored || stored === source) return;
  if (source.poexdBindingId && !stored.poexdBindingId) {
    Object.defineProperty(stored, 'poexdBindingId', {
      value: source.poexdBindingId,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  if (source.poexdCategory && !stored.poexdCategory) {
    setFilterCategory(stored, source.poexdCategory);
  }
  if (source.poexdModGroup && !stored.poexdModGroup) {
    setFilterModGroup(stored, source.poexdModGroup);
  }
}

// ───────────────────────────── 表單操作 ─────────────────────────────

export interface MainWorldSearchFormDeps {
  getStore(): HostVuexStore | null;
  getRoot(): HostTradeRoot | null;
  /** 把目前表單的 Category Binding 寫進 sessionStorage */
  persist(): void;
  /** 依目前表單重新標記 DOM */
  retag(): void;
  schedule(task: () => void, delayMs: number): void;
}

export interface AddStatFilterInput {
  statId: string;
  groupIndex: number;
  min?: string;
  max?: string;
  category?: string;
  modGroup?: string;
}

export interface StatFilterMove {
  fromGroup: number;
  fromFilter: number;
  toGroup: number;
  toFilter: number;
}

export interface FilterBindingChange {
  bindingId: string;
  groupIndex?: number;
  filterIndex?: number;
  /** 設定物品分類；只給分類時會清除詞綴分組 */
  category?: string;
  modGroup?: string | null;
}

export function createMainWorldSearchForm(deps: MainWorldSearchFormDeps) {
  let retagScheduled = false;

  const scheduleRetag = () => {
    if (retagScheduled) return;
    retagScheduled = true;
    deps.schedule(() => {
      retagScheduled = false;
      deps.retag();
    }, RETAG_DELAY_MS);
  };

  /** 寫入完成後的固定步驟 */
  const afterWrite = ({ persist }: { persist: boolean }) => {
    if (persist) deps.persist();
    scheduleRetag();
  };

  return {
    /**
     * 在指定詞綴群組末端加入一條詞綴，帶上物品分類與詞綴分組。
     * 找不到 store 時回傳 false；找不到群組時記錄警告，仍照常寫入並重新標記。
     */
    addStatFilter(input: AddStatFilterInput): boolean {
      const store = deps.getStore();
      if (!store) {
        console.warn('[PoeXD] 找不到 Vuex store');
        return false;
      }
      const { statId, groupIndex, min, max, category, modGroup } = input;
      store._withCommit(() => {
        const stats = getStats(store);
        if (!stats || !stats[groupIndex]) {
          console.warn('[PoeXD] 找不到對應的 stats 群組');
          return;
        }
        const targetIndex = (stats[groupIndex].filters || []).length;
        const valueObj: HostFilterItem = { id: statId, disabled: false };
        if (category) setFilterCategory(valueObj, category);
        if (modGroup) setFilterModGroup(valueObj, modGroup);
        if (min !== undefined || max !== undefined) {
          valueObj.value = {};
          if (min !== undefined && min !== '') valueObj.value.min = Number(min);
          if (max !== undefined && max !== '') valueObj.value.max = Number(max);
        }
        store.commit('setStatFilter', { group: groupIndex, index: targetIndex, value: valueObj });
        carryHiddenProps(valueObj, stats[groupIndex]?.filters?.[targetIndex]);
      });
      afterWrite({ persist: true });
      return true;
    },

    /**
     * 更新一條詞綴的物品分類或詞綴分組（以 bindingId 定位，找不到就不動）。
     * binding manager 會自行寫入 sessionStorage；內容腳本會馬上讀 DOM 屬性，所以立即重新標記。
     */
    setFilterBinding(change: FilterBindingChange): boolean {
      const store = deps.getStore();
      if (!store) {
        console.warn('[PoeXD] 找不到 Vuex store');
        return false;
      }
      const stats = getStats(store);
      if (!stats) return false;
      const { bindingId, groupIndex, filterIndex, category, modGroup } = change;
      store._withCommit(() => {
        if (category !== undefined) {
          updateSingleFilterCategory(stats, { bindingId, groupIndex, filterIndex }, category);
          if (modGroup === undefined) updateSingleFilterModGroup(stats, { bindingId }, null);
        }
        if (modGroup !== undefined) updateSingleFilterModGroup(stats, { bindingId }, modGroup);
      });
      deps.retag();
      return true;
    },

    /** 拖放重新排序或跨群組移動一條詞綴；來源或目標不存在時不動並回傳 false */
    moveStatFilter(move: StatFilterMove): boolean {
      const store = deps.getStore();
      if (!store) {
        console.warn('[PoeXD] 找不到 Vuex store，無法移動詞綴');
        return false;
      }
      const stats = getStats(store);
      if (!stats) {
        console.warn('[PoeXD] 找不到 stats 陣列，無法移動詞綴');
        return false;
      }
      const { fromGroup, fromFilter, toGroup, toFilter } = move;
      const fromFilters = stats[fromGroup]?.filters;
      const toFilters = stats[toGroup]?.filters;
      if (!fromFilters || !toFilters || !fromFilters[fromFilter]) return false;
      store._withCommit(() => {
        // 先移出再插入：目標位置直接等於 toFilter
        const [movedFilter] = fromFilters.splice(fromFilter, 1);
        if (toFilter >= toFilters.length) toFilters.push(movedFilter);
        else toFilters.splice(toFilter, 0, movedFilter);
      });
      afterWrite({ persist: true });
      return true;
    },

    /**
     * 套用 Criteria Overlay：以官方 mutation 執行 ops 並等官方 save 完成。
     * 失敗時表單已整批還原，錯誤往外拋，不寫入也不重新標記。
     */
    async applyOverlayOps(ops: readonly CriteriaOverlayOp[]): Promise<void> {
      const store = deps.getStore();
      if (!store) throw new Error('FORM_STATE_NOT_FOUND');
      await executeCriteriaOverlayOps(store, deps.getRoot(), ops);
      afterWrite({ persist: true });
    },

    /**
     * 展開或收起官方篩選面板（官方 toggleSearch）。只在面板明確處於相反狀態時切換，
     * 回傳是否真的切換了；找不到 store 時回傳 null。
     */
    setAdvancedSearchHidden(hidden: boolean): boolean | null {
      const store = deps.getStore();
      if (!store) return null;
      if (store.state?.transient?.advancedSearchHidden !== !hidden) return false;
      store.commit('toggleSearch', undefined);
      scheduleRetag();
      return true;
    },

    /**
     * 推入一個只含示範詞綴的 `and` 群組，詞綴標記為示範並綁定物品分類。
     * 不寫入 sessionStorage，避免示範詞綴被存下來。回傳推入的群組（之後交給 removeStatGroups）。
     */
    addDemoStatGroup(statId: string, category: string): HostFilterGroup | null {
      const store = deps.getStore();
      if (!store) throw new Error('FORM_STATE_NOT_FOUND');
      store.commit('pushStatGroup', {
        type: 'and',
        filters: [{ id: statId, value: {}, disabled: false }],
      });
      const stats = getStats(store);
      const pushedGroup = stats?.[stats.length - 1] ?? null;
      const demoFilter = pushedGroup?.filters?.[0];
      if (demoFilter) {
        Object.defineProperty(demoFilter, 'poexdPageGuideDemo', {
          value: true,
          writable: true,
          enumerable: false,
          configurable: true,
        });
        setFilterCategory(demoFilter, category);
      }
      afterWrite({ persist: false });
      return pushedGroup;
    },

    /** 移除指定的詞綴群組（以物件身分比對），不動其他群組；有移除時寫入並重新標記 */
    removeStatGroups(groups: ReadonlySet<HostFilterGroup>): void {
      if (groups.size === 0) return;
      const store = deps.getStore();
      const persistentStats = store?.state?.persistent?.stats;
      if (!store || !Array.isArray(persistentStats)) return;
      store._withCommit(() => {
        for (let i = persistentStats.length - 1; i >= 0; i -= 1) {
          if (groups.has(persistentStats[i]!)) persistentStats.splice(i, 1);
        }
      });
      afterWrite({ persist: true });
    },

    /** 表單沒變、但網址或 session 換了之後（例如同步表單到網址），把目前的 Category Binding 寫入 */
    persistBindings(): void {
      deps.persist();
    },
  };
}

export type MainWorldSearchForm = ReturnType<typeof createMainWorldSearchForm>;

/** 正式環境使用的表單（官方頁面的 Vuex store 與 DOM） */
export const mainWorldSearchForm: MainWorldSearchForm = createMainWorldSearchForm({
  getStore: getVueStore,
  getRoot: getTradeRootComponent,
  persist: saveAllCategoriesToSessionStorage,
  retag: () => tagFilterDomElements(),
  schedule: (task, delayMs) => {
    setTimeout(task, delayMs);
  },
});
