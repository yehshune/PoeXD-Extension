// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useBookmarkCollapse } from '@/components/sidebar/composables/useBookmarkCollapse';
import type { BookmarkGroup } from '@/components/sidebar/bookmark-types';

describe('useBookmarkCollapse', () => {
  const dummyGroups: BookmarkGroup[] = [
    { id: 'group-1', name: 'Folder 1', order: 0 },
    { id: 'group-2', name: 'Folder 2', order: 1 },
  ];
  const storageKey = 'poexdBookmarkCollapsedGroups';

  let storageStore: Record<string, any> = {};
  let storageChangeListener: ((changes: any) => void) | null = null;

  beforeEach(() => {
    storageStore = {};
    storageChangeListener = null;

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) => {
            const res: Record<string, any> = {};
            for (const k of keys) {
              if (k in storageStore) res[k] = storageStore[k];
            }
            return res;
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(storageStore, items);
          }),
        },
        onChanged: {
          addListener: vi.fn((listener: (changes: any) => void) => {
            storageChangeListener = listener;
          }),
          removeListener: vi.fn(() => {
            storageChangeListener = null;
          }),
        },
      },
    };
  });

  it('loads collapsed groups from storage', async () => {
    storageStore[storageKey] = ['group-1'];
    const groups = ref(dummyGroups);
    const searchQuery = ref('');

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
    });

    await collapse.loadCollapsedGroups();
    expect(collapse.isGroupCollapsed('group-1')).toBe(true);
    expect(collapse.isGroupCollapsed('group-2')).toBe(false);
  });

  it('syncs collapsed groups when storage change occurs', () => {
    const groups = ref(dummyGroups);
    const searchQuery = ref('');

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
    });

    collapse.handleStorageChange({
      [storageKey]: { newValue: ['group-2'] },
    });

    expect(collapse.isGroupCollapsed('group-1')).toBe(false);
    expect(collapse.isGroupCollapsed('group-2')).toBe(true);
  });

  it('toggles collapse state, persists to storage, and calls initSortable', async () => {
    const groups = ref(dummyGroups);
    const searchQuery = ref('');
    const initSortable = vi.fn(async () => {});

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
      initSortable,
    });

    // Toggle on (collapse group-1)
    await collapse.toggleGroupCollapse('group-1');
    expect(collapse.isGroupCollapsed('group-1')).toBe(true);
    expect(storageStore[storageKey]).toEqual(['group-1']);
    expect(initSortable).toHaveBeenCalledTimes(1);

    // Toggle off (expand group-1)
    await collapse.toggleGroupCollapse('group-1');
    expect(collapse.isGroupCollapsed('group-1')).toBe(false);
    expect(storageStore[storageKey]).toEqual([]);
    expect(initSortable).toHaveBeenCalledTimes(2);
  });

  it('does not toggle collapse when group is currently editing', async () => {
    const groups = ref(dummyGroups);
    const searchQuery = ref('');
    const initSortable = vi.fn(async () => {});
    const isEditing = (id: string) => id === 'group-1';

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
      initSortable,
      isEditing,
    });

    await collapse.toggleGroupCollapse('group-1');
    expect(collapse.isGroupCollapsed('group-1')).toBe(false);
    expect(initSortable).not.toHaveBeenCalled();
  });

  it('expands all, persists to storage, and calls initSortable', async () => {
    const groups = ref(dummyGroups);
    const searchQuery = ref('');
    const initSortable = vi.fn(async () => {});

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
      initSortable,
    });

    collapse.collapsedGroupIds.value = new Set(['group-1', 'group-2']);
    await collapse.expandAll();

    expect(collapse.collapsedGroupIds.value.size).toBe(0);
    expect(storageStore[storageKey]).toEqual([]);
    expect(initSortable).toHaveBeenCalledTimes(1);
  });

  it('collapses all, persists to storage, and calls initSortable', async () => {
    const groups = ref(dummyGroups);
    const searchQuery = ref('');
    const initSortable = vi.fn(async () => {});

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
      initSortable,
    });

    await collapse.collapseAll();

    expect(collapse.collapsedGroupIds.value.has('group-1')).toBe(true);
    expect(collapse.collapsedGroupIds.value.has('group-2')).toBe(true);
    expect(storageStore[storageKey]).toEqual(expect.arrayContaining(['group-1', 'group-2']));
    expect(initSortable).toHaveBeenCalledTimes(1);
  });

  it('computes isAllCollapsed correctly and toggleExpandAll toggles appropriately', async () => {
    const groups = ref(dummyGroups);
    const searchQuery = ref('');
    const initSortable = vi.fn(async () => {});

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
      initSortable,
    });

    expect(collapse.isAllCollapsed.value).toBe(false);

    collapse.collapsedGroupIds.value = new Set(['group-1']);
    expect(collapse.isAllCollapsed.value).toBe(false);

    collapse.collapsedGroupIds.value = new Set(['group-1', 'group-2']);
    expect(collapse.isAllCollapsed.value).toBe(true);

    // When all collapsed, toggleExpandAll expands all
    collapse.toggleExpandAll();
    await Promise.resolve();
    expect(collapse.collapsedGroupIds.value.size).toBe(0);

    // When not all collapsed, toggleExpandAll collapses all
    collapse.toggleExpandAll();
    await Promise.resolve();
    expect(collapse.collapsedGroupIds.value.size).toBe(2);
  });

  it('always returns isGroupCollapsed false when searchQuery is non-empty', () => {
    const groups = ref(dummyGroups);
    const searchQuery = ref('something');

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
    });

    collapse.collapsedGroupIds.value = new Set(['group-1', 'group-2']);

    expect(collapse.isGroupCollapsed('group-1')).toBe(false);
    expect(collapse.isGroupCollapsed('group-2')).toBe(false);

    // Persisted state in collapsedGroupIds remains intact
    expect(collapse.collapsedGroupIds.value.has('group-1')).toBe(true);
    expect(collapse.collapsedGroupIds.value.has('group-2')).toBe(true);

    // After search query is cleared, original collapsed state is restored
    searchQuery.value = '';
    expect(collapse.isGroupCollapsed('group-1')).toBe(true);
    expect(collapse.isGroupCollapsed('group-2')).toBe(true);
  });

  it('does not falsely report isAllCollapsed when stale IDs are present in set', () => {
    const groups = ref(dummyGroups); // group-1, group-2
    const searchQuery = ref('');

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
    });

    // Set has 2 items (stale-1, stale-2), so size == 2, but neither is in dummyGroups
    collapse.collapsedGroupIds.value = new Set(['stale-1', 'stale-2']);
    expect(collapse.isAllCollapsed.value).toBe(false);

    // Set has group-1 and stale-1 (size == 2), but group-2 is not collapsed
    collapse.collapsedGroupIds.value = new Set(['group-1', 'stale-1']);
    expect(collapse.isAllCollapsed.value).toBe(false);

    // Set has both group-1 and group-2 (plus stale-1) -> all active groups are collapsed
    collapse.collapsedGroupIds.value = new Set(['group-1', 'group-2', 'stale-1']);
    expect(collapse.isAllCollapsed.value).toBe(true);
  });

  it('handles arbitrary depth nested folders in collapseAll and expandAll', async () => {
    const nestedGroups: BookmarkGroup[] = [
      { id: 'root', name: 'Root', order: 0 },
      { id: 'child', name: 'Child', order: 0, parentId: 'root' },
      { id: 'grandchild', name: 'Grandchild', order: 0, parentId: 'child' },
    ];
    const groups = ref(nestedGroups);
    const searchQuery = ref('');

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
    });

    await collapse.collapseAll();
    expect(collapse.isAllCollapsed.value).toBe(true);
    expect(collapse.isGroupCollapsed('root')).toBe(true);
    expect(collapse.isGroupCollapsed('child')).toBe(true);
    expect(collapse.isGroupCollapsed('grandchild')).toBe(true);

    await collapse.expandAll();
    expect(collapse.isAllCollapsed.value).toBe(false);
    expect(collapse.isGroupCollapsed('root')).toBe(false);
    expect(collapse.isGroupCollapsed('child')).toBe(false);
    expect(collapse.isGroupCollapsed('grandchild')).toBe(false);
  });

  it('provides subtree-scoped collapse and expand without affecting unrelated subtrees', async () => {
    const treeGroups: BookmarkGroup[] = [
      { id: 'tree-a', name: 'Tree A', order: 0 },
      { id: 'a-child-1', name: 'A Child 1', order: 0, parentId: 'tree-a' },
      { id: 'a-child-2', name: 'A Child 2', order: 1, parentId: 'tree-a' },
      { id: 'tree-b', name: 'Tree B', order: 1 },
      { id: 'b-child-1', name: 'B Child 1', order: 0, parentId: 'tree-b' },
    ];
    const groups = ref(treeGroups);
    const searchQuery = ref('');

    const collapse = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey,
    });

    expect(collapse.hasSubtreeFolders('tree-a')).toBe(true);
    expect(collapse.hasSubtreeFolders('a-child-1')).toBe(false);

    // Initial: none collapsed in tree-a -> not all collapsed
    expect(collapse.isSubtreeAllCollapsed('tree-a')).toBe(false);

    // Toggle collapses all children in tree-a
    await collapse.toggleSubtreeCollapse('tree-a');
    expect(collapse.isGroupCollapsed('a-child-1')).toBe(true);
    expect(collapse.isGroupCollapsed('a-child-2')).toBe(true);
    // Tree B is completely untouched
    expect(collapse.isGroupCollapsed('tree-b')).toBe(false);
    expect(collapse.isGroupCollapsed('b-child-1')).toBe(false);
    expect(collapse.isSubtreeAllCollapsed('tree-a')).toBe(true);

    // Toggle again expands all children in tree-a and ensures root tree-a is expanded
    await collapse.toggleSubtreeCollapse('tree-a');
    expect(collapse.isGroupCollapsed('tree-a')).toBe(false);
    expect(collapse.isGroupCollapsed('a-child-1')).toBe(false);
    expect(collapse.isGroupCollapsed('a-child-2')).toBe(false);
    expect(collapse.isGroupCollapsed('b-child-1')).toBe(false);
  });
});
