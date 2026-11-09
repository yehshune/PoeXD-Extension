import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  getCurrentInstance,
  type Ref,
  type ComputedRef,
} from 'vue';
import type { BookmarkGroup } from '../bookmark-types';
import { getFolderSubtreeIds } from '@/utils/bookmark-collection';

export interface BookmarkStorageChange<T = unknown> {
  oldValue?: T;
  newValue?: T;
}

export interface UseBookmarkCollapseOptions {
  groups: Ref<readonly BookmarkGroup[]> | ComputedRef<readonly BookmarkGroup[]>;
  searchQuery: Ref<string> | ComputedRef<string>;
  storageKey: string;
  initSortable?: () => Promise<void> | void;
  isEditing?: (groupId: string) => boolean;
}

export function useBookmarkCollapse(options: UseBookmarkCollapseOptions) {
  const { groups, searchQuery, storageKey, initSortable, isEditing } = options;

  const collapsedGroupIds = ref<Set<string>>(new Set());

  const loadCollapsedGroups = async (): Promise<void> => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get([storageKey]);
      const stored = data[storageKey];
      const initialValues = Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === 'string')
        : [];
      collapsedGroupIds.value = new Set(initialValues);
    }
  };

  const saveCollapsedGroups = async (): Promise<void> => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [storageKey]: Array.from(collapsedGroupIds.value),
      });
    }
  };

  const handleStorageChange = (changes: Record<string, BookmarkStorageChange>) => {
    const change = changes[storageKey];
    if (change) {
      const nextValues = Array.isArray(change.newValue)
        ? change.newValue.filter((item): item is string => typeof item === 'string')
        : [];
      // 本分頁自己寫入後的回呼內容與目前狀態相同；略過可避免整棵樹因 Set 置換而全面重繪。
      const current = collapsedGroupIds.value;
      if (nextValues.length === current.size && nextValues.every((id) => current.has(id))) {
        return;
      }
      collapsedGroupIds.value = new Set(nextValues);
    }
  };

  if (getCurrentInstance()) {
    onMounted(() => {
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener(handleStorageChange);
      }
    });

    onUnmounted(() => {
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    });
  }

  const isGroupCollapsed = (id: string): boolean => {
    if (searchQuery.value.trim()) return false;
    return collapsedGroupIds.value.has(id);
  };

  const toggleGroupCollapse = async (id: string): Promise<void> => {
    if (isEditing && isEditing(id)) return;

    if (collapsedGroupIds.value.has(id)) {
      collapsedGroupIds.value.delete(id);
    } else {
      collapsedGroupIds.value.add(id);
    }
    await saveCollapsedGroups();
    // 摺疊/展開後 DOM 結構改變，需重新綁定 Sortable
    await initSortable?.();
  };

  const expandAll = async (): Promise<void> => {
    collapsedGroupIds.value.clear();
    await saveCollapsedGroups();
    await initSortable?.();
  };

  const collapseAll = async (): Promise<void> => {
    groups.value.forEach((g) => collapsedGroupIds.value.add(g.id));
    await saveCollapsedGroups();
    await initSortable?.();
  };

  const isAllCollapsed = computed((): boolean => {
    if (groups.value.length === 0) return true;
    return groups.value.every((g) => collapsedGroupIds.value.has(g.id));
  });

  const toggleExpandAll = (): void => {
    if (isAllCollapsed.value) {
      void expandAll();
    } else {
      void collapseAll();
    }
  };

  const hasSubtreeFolders = (rootFolderId: string): boolean => {
    const descendantIds = Array.from(getFolderSubtreeIds(groups.value, rootFolderId)).filter(
      (id) => id !== rootFolderId,
    );
    return descendantIds.length > 0;
  };

  const isSubtreeAllCollapsed = (rootFolderId: string): boolean => {
    const descendantIds = Array.from(getFolderSubtreeIds(groups.value, rootFolderId)).filter(
      (id) => id !== rootFolderId,
    );
    if (descendantIds.length === 0) return true;
    return descendantIds.every((id) => collapsedGroupIds.value.has(id));
  };

  const toggleSubtreeCollapse = async (rootFolderId: string): Promise<void> => {
    const descendantIds = Array.from(getFolderSubtreeIds(groups.value, rootFolderId)).filter(
      (id) => id !== rootFolderId,
    );
    if (descendantIds.length === 0) return;

    const allCollapsed = descendantIds.every((id) => collapsedGroupIds.value.has(id));
    if (allCollapsed) {
      collapsedGroupIds.value.delete(rootFolderId);
      descendantIds.forEach((id) => collapsedGroupIds.value.delete(id));
    } else {
      descendantIds.forEach((id) => collapsedGroupIds.value.add(id));
    }
    await saveCollapsedGroups();
    await initSortable?.();
  };

  return {
    collapsedGroupIds,
    loadCollapsedGroups,
    saveCollapsedGroups,
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
  };
}
