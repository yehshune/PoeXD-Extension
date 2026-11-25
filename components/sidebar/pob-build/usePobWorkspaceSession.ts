import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import {
  applyResolvedEntrySearch,
  cloneEntrySearchSelection,
  isSelectionDraftModified,
  normalizeSelectionForEntry,
  resolveEntrySearch,
  selectionFromRowState,
  type BuildSearchDefaults,
  type EntrySearchSelection,
} from '@/utils/pob-entry-search';
import type { ShoppingEntry } from '@/utils/pob-shopping-list';
import type { BuildView, ShoppingGroup, ShoppingRow, SocketContent } from './usePobBuild';

export type ShoppingCategory = 'all' | 'gear' | 'flask' | 'jewel' | 'gem';
export type ConcreteShoppingCategory = Exclude<ShoppingCategory, 'all'>;
export type ViewMode = 'list' | 'gear';

export const VIEW_MODES: readonly ViewMode[] = ['list', 'gear'];
export const CATEGORY_ORDER: readonly ConcreteShoppingCategory[] = [
  'gear',
  'flask',
  'jewel',
  'gem',
];

export const HOVER_OPEN_DELAY_MS = 150;
export const HOVER_WARM_WINDOW_MS = 300;

export interface ActivePreviewTarget {
  buildId: string;
  key: string;
  /** 從插槽點開的寶石或珠寶，所屬分組收合時也照樣顯示 */
  fromSocket?: boolean;
}

export interface ActivePreview {
  buildId: string;
  row: ShoppingRow;
}

export interface SavedActiveDraft {
  buildId: string;
  rowKey: string;
  selection: EntrySearchSelection | undefined;
}

export interface PobWorkspaceTimer {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PobWorkspaceSessionOptions {
  builds: Readonly<Ref<readonly BuildView[]>>;
  searchQuery: Readonly<Ref<string>>;
  formatRowDetail: (entry: ShoppingEntry) => string;
  timers?: PobWorkspaceTimer;
}

export interface PobWorkspaceSession<TAnchor = unknown> {
  // Workspace projection
  isFiltering: ComputedRef<boolean>;
  visibleBuilds: ComputedRef<BuildView[]>;
  entryCategory: (entry: ShoppingEntry) => ConcreteShoppingCategory;
  buildCategories: (build: BuildView) => ConcreteShoppingCategory[];
  activeCategory: (build: BuildView) => ShoppingCategory;
  setActiveCategory: (buildId: string, category: ShoppingCategory) => void;
  filteredGroups: (build: BuildView) => ShoppingGroup[];
  equipmentRows: (build: BuildView) => ShoppingRow[];
  hasEquipment: (build: BuildView) => boolean;
  viewMode: (build: BuildView) => ViewMode;
  isGearView: (build: BuildView) => boolean;
  setViewMode: (buildId: string, mode: ViewMode) => void;
  listGroups: (build: BuildView) => ShoppingGroup[];
  isGroupCollapsed: (build: BuildView, groupId: string) => boolean;
  toggleGroupCollapsed: (buildId: string, groupId: string) => void;
  canSearch: (row: ShoppingRow) => boolean;
  canPreview: (row: ShoppingRow) => boolean;

  // Preview state machine
  previewPinned: Readonly<Ref<boolean>>;
  activePreviewTarget: Readonly<Ref<ActivePreviewTarget | null>>;
  previewAnchor: Readonly<Ref<TAnchor | null>>;
  activePreview: ComputedRef<ActivePreview | null>;
  activePreviewDefaults: ComputedRef<BuildSearchDefaults>;
  isPreviewOpen: ComputedRef<boolean>;
  isPreviewActive: (buildId: string, key: string) => boolean;
  hoverPreview: (buildId: string, row: ShoppingRow, anchor: TAnchor | null) => void;
  leavePreviewTrigger: () => void;
  pinPreview: () => void;
  togglePreview: (buildId: string, key: string, anchor: TAnchor | null) => void;
  selectSocketContent: (build: BuildView, content: SocketContent, anchor: TAnchor | null) => void;
  closePreview: () => void;

  // Instance-scoped per-entry draft store
  activeEffectiveRow: ComputedRef<ShoppingRow | null>;
  isActiveDraftModified: ComputedRef<boolean>;
  updateActiveDraft: (update: (draft: EntrySearchSelection) => EntrySearchSelection) => void;
  saveActiveDraft: () => SavedActiveDraft | null;
  discardActiveDraft: () => void;
  clearDraft: (buildId: string, rowKey: string) => void;

  // Lifecycle
  dispose: () => void;
}

const DEFAULT_TIMERS: PobWorkspaceTimer = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const compositeKey = (buildId: string, key: string): string => `${buildId}\u0000${key}`;

/** 有存回的搜尋或有條件時才能送主控台、加書籤 */
export const canSearchPobRow = (row: ShoppingRow): boolean =>
  row.searchOverride || row.query !== null;

/** 有詞綴、存回搜尋，或是可以搜尋的寶石（調整等級／品質）時才提供預覽／微調彈窗 */
const canPreviewPobRow = (row: ShoppingRow): boolean =>
  row.kind === 'gem'
    ? Boolean(row.query !== null || row.searchOverride)
    : Boolean(row.mods?.length || row.searchOverride);

const entryCategoryOf = (entry: ShoppingEntry): ConcreteShoppingCategory => {
  if (entry.kind === 'gem') return 'gem';
  const slot = entry.slot ?? '';
  if (slot.startsWith('Flask')) return 'flask';
  if (slot.includes('Jewel') || slot.includes('Abyssal Socket')) return 'jewel';
  return 'gear';
};

/**
 * PoB 工作區投影、預覽 hover/pin/插槽狀態機與執行個體層級草稿暫存的單一深層模組。
 * 不依賴 DOM，錨點以不透明型別 `TAnchor` 傳遞，計時器透過可注入介面驅動。
 */
export function usePobWorkspaceSession<TAnchor = unknown>(
  options: PobWorkspaceSessionOptions,
): PobWorkspaceSession<TAnchor> {
  const { builds, searchQuery, formatRowDetail } = options;
  const timers = options.timers ?? DEFAULT_TIMERS;

  /** 群組收合狀態（key = `${buildId}\0${groupId}`）；只在這個工作階段內記憶 */
  const collapsedGroups = ref<ReadonlySet<string>>(new Set());
  const activeCategoryByBuild = ref<Record<string, ShoppingCategory>>({});
  /** 清單或裝備欄檢視（預設裝備欄；每個 build 各自記住，只在本次開啟期間） */
  const viewModeByBuild = ref<Record<string, ViewMode>>({});

  /** 目前在右側 Popover 檢視／調整詞綴的項目 */
  const activePreviewTarget = ref<ActivePreviewTarget | null>(null);
  const previewAnchor = shallowRef<TAnchor | null>(null);
  const previewPinned = ref(false);

  /** Popover 內的暫存微調草稿；作用域限定於本工作階段，避免跨卸載或跨測試洩漏 */
  const draftsByTarget = shallowRef<ReadonlyMap<string, EntrySearchSelection>>(new Map());

  let hoverOpenTimer: unknown;
  let hoverWarmTimer: unknown;
  let hoverWarm = false;

  const clearHoverOpenTimer = () => {
    if (hoverOpenTimer !== undefined) {
      timers.clearTimeout(hoverOpenTimer);
      hoverOpenTimer = undefined;
    }
  };

  const clearHoverWarm = () => {
    if (hoverWarmTimer !== undefined) {
      timers.clearTimeout(hoverWarmTimer);
      hoverWarmTimer = undefined;
    }
    hoverWarm = false;
  };

  const startHoverWarmWindow = () => {
    clearHoverWarm();
    hoverWarm = true;
    hoverWarmTimer = timers.setTimeout(() => {
      hoverWarmTimer = undefined;
      hoverWarm = false;
    }, HOVER_WARM_WINDOW_MS);
  };

  const isFiltering = computed(() => searchQuery.value.trim().length > 0);

  const visibleBuilds = computed<BuildView[]>(() => {
    const needle = searchQuery.value.trim().toLowerCase();
    if (!needle) return [...builds.value];
    return builds.value
      .map((build) => ({
        ...build,
        groups: build.groups
          .map((group) => ({
            ...group,
            rows: group.rows.filter(
              (entry) =>
                entry.label.toLowerCase().includes(needle) ||
                // 名稱以顯示語言呈現，英文原名也要找得到
                entry.englishName.toLowerCase().includes(needle) ||
                formatRowDetail(entry).toLowerCase().includes(needle),
            ),
          }))
          .filter((group) => group.rows.length > 0),
      }))
      .filter((build) => build.groups.length > 0);
  });

  const buildCategories = (build: BuildView): ConcreteShoppingCategory[] => {
    const present = new Set<ConcreteShoppingCategory>();
    for (const group of build.groups) {
      for (const row of group.rows) present.add(entryCategoryOf(row));
    }
    return CATEGORY_ORDER.filter((cat) => present.has(cat));
  };

  const activeCategory = (build: BuildView): ShoppingCategory => {
    const selected = activeCategoryByBuild.value[build.id] ?? 'all';
    if (selected === 'all') return 'all';
    return buildCategories(build).includes(selected) ? selected : 'all';
  };

  const setActiveCategory = (buildId: string, category: ShoppingCategory) => {
    activeCategoryByBuild.value = { ...activeCategoryByBuild.value, [buildId]: category };
  };

  const filteredGroups = (build: BuildView): ShoppingGroup[] => {
    if (isFiltering.value) return build.groups;
    const category = activeCategory(build);
    if (category === 'all') return build.groups;
    return build.groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => entryCategoryOf(row) === category),
      }))
      .filter((group) => group.rows.length > 0);
  };

  const equipmentRows = (build: BuildView): ShoppingRow[] =>
    build.groups.find((group) => group.kind === 'equipment')?.rows ?? [];

  const hasEquipment = (build: BuildView): boolean => equipmentRows(build).length > 0;

  const viewMode = (build: BuildView): ViewMode =>
    hasEquipment(build) ? (viewModeByBuild.value[build.id] ?? 'gear') : 'list';

  /** 搜尋時一律用清單，才看得到符合的寶石與裝備 */
  const isGearView = (build: BuildView): boolean =>
    !isFiltering.value && viewMode(build) === 'gear';

  /** 清單要畫的分組：裝備欄檢視時裝備改畫在格子裡，只剩寶石 */
  const listGroups = (build: BuildView): ShoppingGroup[] =>
    isGearView(build)
      ? build.groups.filter((group) => group.kind === 'gem')
      : filteredGroups(build);

  const isGroupCollapsed = (build: BuildView, groupId: string): boolean =>
    !isFiltering.value &&
    activeCategory(build) === 'all' &&
    collapsedGroups.value.has(compositeKey(build.id, groupId));

  const toggleGroupCollapsed = (buildId: string, groupId: string) => {
    const key = compositeKey(buildId, groupId);
    const next = new Set(collapsedGroups.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedGroups.value = next;
  };

  /** 由可見清單即時查出目前預覽的項目，詞綴／數值更新時 Popover 同步反映，列消失時自動關閉 */
  const activePreview = computed<ActivePreview | null>(() => {
    const target = activePreviewTarget.value;
    if (!target) return null;
    const build = visibleBuilds.value.find((entry) => entry.id === target.buildId);
    if (!build || (build.collapsed && !isFiltering.value)) return null;
    if (isGearView(build)) {
      const found = equipmentRows(build).find((entry) => entry.key === target.key);
      if (found) return { buildId: build.id, row: found };
    }
    for (const group of listGroups(build)) {
      if (isGroupCollapsed(build, group.id) && !target.fromSocket) continue;
      const found = group.rows.find((entry) => entry.key === target.key);
      if (found) return { buildId: build.id, row: found };
    }
    return null;
  });

  /** 預覽中的項目所屬 build 的整體搜尋設定 */
  const activePreviewDefaults = computed<BuildSearchDefaults>(
    () =>
      builds.value.find((build) => build.id === activePreview.value?.buildId)?.searchDefaults ?? {},
  );

  const isPreviewOpen = computed(() => activePreview.value !== null);

  const isPreviewActive = (buildId: string, key: string): boolean =>
    activePreview.value?.buildId === buildId && activePreview.value?.row.key === key;

  const closePreview = () => {
    clearHoverOpenTimer();
    clearHoverWarm();
    previewPinned.value = false;
    activePreviewTarget.value = null;
    previewAnchor.value = null;
  };

  const setViewMode = (buildId: string, mode: ViewMode) => {
    if (activePreviewTarget.value?.buildId === buildId) closePreview();
    viewModeByBuild.value = { ...viewModeByBuild.value, [buildId]: mode };
  };

  /**
   * 滑鼠移入格子（或清單的圖示、調整按鈕）稍停即開啟預覽，移開物品立即關閉；
   * 移出後短時間內（HOVER_WARM_WINDOW_MS）再移入下一件物品則免延遲直接切換，方便連續掃視。
   * 點擊該項目（或在預覽框內操作）才會固定開著，固定時不受其他項目的 hover 干擾，
   * 直到點外面、按關閉或再點一次。
   */
  const hoverPreview = (buildId: string, row: ShoppingRow, anchor: TAnchor | null) => {
    if (previewPinned.value || !canPreviewPobRow(row) || isPreviewActive(buildId, row.key)) return;
    if (anchor == null) return;
    clearHoverOpenTimer();
    if (hoverWarm) {
      clearHoverWarm();
      previewAnchor.value = anchor;
      activePreviewTarget.value = { buildId, key: row.key };
      return;
    }
    hoverOpenTimer = timers.setTimeout(() => {
      hoverOpenTimer = undefined;
      if (previewPinned.value) return;
      previewAnchor.value = anchor;
      activePreviewTarget.value = { buildId, key: row.key };
    }, HOVER_OPEN_DELAY_MS);
  };

  const leavePreviewTrigger = () => {
    clearHoverOpenTimer();
    if (previewPinned.value || !activePreviewTarget.value) return;
    closePreview();
    startHoverWarmWindow();
  };

  const pinPreview = () => {
    clearHoverWarm();
    previewPinned.value = true;
  };

  const openOrTogglePreview = (
    buildId: string,
    key: string,
    anchor: TAnchor | null,
    fromSocket = false,
  ) => {
    if (isPreviewActive(buildId, key)) {
      if (!previewPinned.value) {
        pinPreview();
        if (fromSocket && activePreviewTarget.value && !activePreviewTarget.value.fromSocket) {
          activePreviewTarget.value = { ...activePreviewTarget.value, fromSocket: true };
        }
        return;
      }
      closePreview();
      return;
    }
    if (anchor == null) return;
    clearHoverOpenTimer();
    clearHoverWarm();
    previewPinned.value = true;
    previewAnchor.value = anchor;
    activePreviewTarget.value = fromSocket ? { buildId, key, fromSocket: true } : { buildId, key };
  };

  const togglePreview = (buildId: string, key: string, anchor: TAnchor | null) => {
    openOrTogglePreview(buildId, key, anchor, false);
  };

  /** 點裝備插槽裡的寶石或深淵珠寶：開關它的設定框，位置對齊所在的裝備格 */
  const selectSocketContent = (
    build: BuildView,
    content: SocketContent,
    anchor: TAnchor | null,
  ) => {
    const key = content.rowKey;
    if (!key) return;
    const row = build.groups.flatMap((group) => group.rows).find((entry) => entry.key === key);
    if (!row || !canPreviewPobRow(row)) return;
    openOrTogglePreview(build.id, key, anchor, true);
  };

  const stopActivePreviewWatch = watch(
    activePreview,
    (value) => {
      if (!value && activePreviewTarget.value) {
        closePreview();
      }
    },
    { flush: 'sync' },
  );

  // 進入或離開搜尋過濾時，裝備欄與清單檢視會互換、原錨點脫離 DOM，先收合預覽
  const stopFilteringWatch = watch(
    isFiltering,
    () => {
      if (activePreviewTarget.value) closePreview();
    },
    { flush: 'sync' },
  );

  const activeDraft = computed<EntrySearchSelection | null>(() => {
    const active = activePreview.value;
    if (!active) return null;
    return draftsByTarget.value.get(compositeKey(active.buildId, active.row.key)) ?? null;
  });

  const activeEffectiveRow = computed<ShoppingRow | null>(() => {
    const active = activePreview.value;
    if (!active) return null;
    const draft = activeDraft.value;
    if (!draft) return active.row;
    return {
      ...applyResolvedEntrySearch(
        active.row,
        resolveEntrySearch(active.row, draft, activePreviewDefaults.value),
      ),
      searchSelection: draft,
    };
  });

  const isActiveDraftModified = computed(() =>
    Boolean(
      activePreview.value &&
      activeEffectiveRow.value &&
      isSelectionDraftModified(activePreview.value.row, activeEffectiveRow.value),
    ),
  );

  const clearDraft = (buildId: string, rowKey: string) => {
    const key = compositeKey(buildId, rowKey);
    if (!draftsByTarget.value.has(key)) return;
    const next = new Map(draftsByTarget.value);
    next.delete(key);
    draftsByTarget.value = next;
  };

  const updateActiveDraft = (update: (draft: EntrySearchSelection) => EntrySearchSelection) => {
    const active = activePreview.value;
    if (!active) return;
    const key = compositeKey(active.buildId, active.row.key);
    const existing = draftsByTarget.value.get(key);
    const current = existing
      ? cloneEntrySearchSelection(existing)
      : selectionFromRowState(active.row, activePreviewDefaults.value);
    const nextDraft = update(current);
    const next = new Map(draftsByTarget.value);
    next.set(key, cloneEntrySearchSelection(nextDraft));
    draftsByTarget.value = next;
  };

  const saveActiveDraft = (): SavedActiveDraft | null => {
    const active = activePreview.value;
    const draft = activeDraft.value;
    if (!active || !draft) return null;
    const normalized = normalizeSelectionForEntry(active.row, draft, activePreviewDefaults.value);
    clearDraft(active.buildId, active.row.key);
    return {
      buildId: active.buildId,
      rowKey: active.row.key,
      selection: normalized,
    };
  };

  const discardActiveDraft = () => {
    const active = activePreview.value;
    if (!active) return;
    clearDraft(active.buildId, active.row.key);
  };

  const dispose = () => {
    closePreview();
    stopActivePreviewWatch();
    stopFilteringWatch();
    draftsByTarget.value = new Map();
  };

  return {
    isFiltering,
    visibleBuilds,
    entryCategory: entryCategoryOf,
    buildCategories,
    activeCategory,
    setActiveCategory,
    filteredGroups,
    equipmentRows,
    hasEquipment,
    viewMode,
    isGearView,
    setViewMode,
    listGroups,
    isGroupCollapsed,
    toggleGroupCollapsed,
    canSearch: canSearchPobRow,
    canPreview: canPreviewPobRow,
    previewPinned,
    activePreviewTarget,
    previewAnchor,
    activePreview,
    activePreviewDefaults,
    isPreviewOpen,
    isPreviewActive,
    hoverPreview,
    leavePreviewTrigger,
    pinPreview,
    togglePreview,
    selectSocketContent,
    closePreview,
    activeEffectiveRow,
    isActiveDraftModified,
    updateActiveDraft,
    saveActiveDraft,
    discardActiveDraft,
    clearDraft,
    dispose,
  };
}
