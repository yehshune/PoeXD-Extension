import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { BookmarkGroup } from '../bookmark-types';
import { getFolderSubtreeIds } from '@/utils/bookmark-collection';

export interface BookmarkStorageChange<T = unknown> {
  oldValue?: T;
  newValue?: T;
}

export interface BookmarkCollapseDeps {
  groups: Ref<readonly BookmarkGroup[]> | ComputedRef<readonly BookmarkGroup[]>;
  searchQuery: Ref<string> | ComputedRef<string>;
  storageKey: string;
  isEditing?: (groupId: string) => boolean;
}

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Workspace 內部的收合部件；收合狀態的變動由 Workspace 的樹狀態反應式同步，不需呼叫任何 sortable。 */
export function createBookmarkCollapse(deps: BookmarkCollapseDeps) {
  const { groups, searchQuery, storageKey, isEditing } = deps;

  const collapsedGroupIds = ref<Set<string>>(new Set());

  const load = async (): Promise<void> => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get([storageKey]);
      collapsedGroupIds.value = new Set(toStringList(data[storageKey]));
    }
  };

  const save = async (): Promise<void> => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [storageKey]: Array.from(collapsedGroupIds.value) });
    }
  };

  const handleStorageChange = (changes: Record<string, BookmarkStorageChange>) => {
    const change = changes[storageKey];
    if (!change) return;
    const nextValues = toStringList(change.newValue);
    // 本分頁自己寫入後的回呼內容與目前狀態相同；略過可避免整棵樹因 Set 置換而全面重繪。
    const current = collapsedGroupIds.value;
    if (nextValues.length === current.size && nextValues.every((id) => current.has(id))) return;
    collapsedGroupIds.value = new Set(nextValues);
  };

  /** 監聽其他分頁寫入；回傳取消監聽。 */
  const watchStorage = (): (() => void) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  };

  const isGroupCollapsed = (id: string): boolean => {
    if (searchQuery.value.trim()) return false;
    return collapsedGroupIds.value.has(id);
  };

  const descendantsOf = (rootFolderId: string): string[] =>
    Array.from(getFolderSubtreeIds(groups.value, rootFolderId)).filter(
      (id) => id !== rootFolderId,
    );

  const toggleGroupCollapse = async (id: string): Promise<void> => {
    if (isEditing && isEditing(id)) return;
    if (collapsedGroupIds.value.has(id)) {
      collapsedGroupIds.value.delete(id);
    } else {
      collapsedGroupIds.value.add(id);
    }
    await save();
  };

  const expandAll = async (): Promise<void> => {
    collapsedGroupIds.value.clear();
    await save();
  };

  const collapseAll = async (): Promise<void> => {
    groups.value.forEach((g) => collapsedGroupIds.value.add(g.id));
    await save();
  };

  const isAllCollapsed = computed((): boolean => {
    if (groups.value.length === 0) return true;
    return groups.value.every((g) => collapsedGroupIds.value.has(g.id));
  });

  const toggleExpandAll = (): void => {
    if (isAllCollapsed.value) void expandAll();
    else void collapseAll();
  };

  const hasSubtreeFolders = (rootFolderId: string): boolean =>
    descendantsOf(rootFolderId).length > 0;

  const isSubtreeAllCollapsed = (rootFolderId: string): boolean => {
    const descendantIds = descendantsOf(rootFolderId);
    if (descendantIds.length === 0) return true;
    return descendantIds.every((id) => collapsedGroupIds.value.has(id));
  };

  const toggleSubtreeCollapse = async (rootFolderId: string): Promise<void> => {
    const descendantIds = descendantsOf(rootFolderId);
    if (descendantIds.length === 0) return;
    if (descendantIds.every((id) => collapsedGroupIds.value.has(id))) {
      collapsedGroupIds.value.delete(rootFolderId);
      descendantIds.forEach((id) => collapsedGroupIds.value.delete(id));
    } else {
      descendantIds.forEach((id) => collapsedGroupIds.value.add(id));
    }
    await save();
  };

  /** 展開指定資料夾並寫入（新增子項後用來確保看得到）。 */
  const reveal = async (id: string): Promise<void> => {
    collapsedGroupIds.value.delete(id);
    await save();
  };

  return {
    collapsedGroupIds,
    load,
    watchStorage,
    handleStorageChange,
    isGroupCollapsed,
    toggleGroupCollapse,
    expandAll,
    collapseAll,
    toggleExpandAll,
    isAllCollapsed,
    hasSubtreeFolders,
    isSubtreeAllCollapsed,
    toggleSubtreeCollapse,
    reveal,
  };
}
