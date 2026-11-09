import {
  ref,
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  getCurrentInstance,
  type Ref,
  type ComputedRef,
} from 'vue';
import type { Bookmark, BookmarkGroup } from '../bookmark-types';
import { getFolderAncestors } from '@/utils/bookmark-collection';

const EMPTY_BOOKMARKS: readonly Bookmark[] = Object.freeze([]);

export interface UseBookmarkSearchOptions {
  groups: Ref<readonly BookmarkGroup[]> | ComputedRef<readonly BookmarkGroup[]>;
  bookmarks: Ref<readonly Bookmark[]> | ComputedRef<readonly Bookmark[]>;
}

export function useBookmarkSearch(options: UseBookmarkSearchOptions) {
  const { groups, bookmarks } = options;

  const searchQuery = ref('');
  const isSearchVisible = ref(false);
  const searchInputRef = ref<HTMLInputElement | { $el?: HTMLInputElement } | null>(null);

  const openSearch = (): void => {
    isSearchVisible.value = true;
    void nextTick(() => {
      const target = searchInputRef.value;
      const input = target instanceof HTMLInputElement ? target : target?.$el;
      input?.focus();
    });
  };

  const closeSearch = (): void => {
    isSearchVisible.value = false;
    searchQuery.value = '';
  };

  const toggleSearch = (): void => {
    if (isSearchVisible.value) {
      closeSearch();
    } else {
      openSearch();
    }
  };

  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isSearchVisible.value) {
      closeSearch();
    }
  };

  if (getCurrentInstance()) {
    onMounted(() => {
      if (typeof window !== 'undefined') {
        window.addEventListener('keydown', handleKeydown);
      }
    });

    onUnmounted(() => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeydown);
      }
    });
  }

  const filteredGroups = computed<readonly BookmarkGroup[]>(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return groups.value;

    const matchingFolderIds = new Set(
      groups.value.filter((g) => g.name.toLowerCase().includes(query)).map((g) => g.id),
    );
    const matchingBookmarkFolderIds = new Set(
      bookmarks.value
        .filter(
          (bm) => bm.name.toLowerCase().includes(query) || bm.url.toLowerCase().includes(query),
        )
        .map((bm) => bm.groupId),
    );

    const targetFolderIds = new Set([...matchingFolderIds, ...matchingBookmarkFolderIds]);
    const visibleFolderIds = new Set<string>();

    for (const targetId of targetFolderIds) {
      if (!groups.value.some((g) => g.id === targetId)) continue;
      visibleFolderIds.add(targetId);
      const ancestors = getFolderAncestors(groups.value as BookmarkGroup[], targetId);
      for (const ancestor of ancestors) {
        visibleFolderIds.add(ancestor.id);
      }
    }

    return groups.value.filter((g) => visibleFolderIds.has(g.id));
  });

  // 依資料夾分組的一次性索引（O(N)），且組內項目未變時沿用上一版陣列，
  // 讓只讀取單一資料夾的元件在其他資料夾變動時不需重繪。
  let previousIndex = new Map<string, readonly Bookmark[]>();
  const filteredBookmarksByGroup = computed<ReadonlyMap<string, readonly Bookmark[]>>(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const next = new Map<string, Bookmark[]>();
    for (const bm of bookmarks.value) {
      if (
        query &&
        !bm.name.toLowerCase().includes(query) &&
        !bm.url.toLowerCase().includes(query)
      ) {
        continue;
      }
      const list = next.get(bm.groupId);
      if (list) list.push(bm);
      else next.set(bm.groupId, [bm]);
    }
    const resolved = new Map<string, readonly Bookmark[]>();
    for (const [groupId, list] of next) {
      const prior = previousIndex.get(groupId);
      const same =
        prior !== undefined &&
        prior.length === list.length &&
        prior.every((item, index) => item === list[index]);
      resolved.set(groupId, same ? prior : list);
    }
    previousIndex = resolved;
    return resolved;
  });

  const getFilteredGroupBookmarks = (groupId: string): readonly Bookmark[] =>
    filteredBookmarksByGroup.value.get(groupId) ?? EMPTY_BOOKMARKS;

  return {
    searchQuery,
    isSearchVisible,
    searchInputRef,
    openSearch,
    closeSearch,
    toggleSearch,
    handleKeydown,
    filteredGroups,
    getFilteredGroupBookmarks,
  };
}
