import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookmarkWorkspace } from '@/components/sidebar/bookmark-workspace';
import { createFakeBookmarkWorkspaceHost } from '@/components/sidebar/bookmark-workspace/fake-host';
import type { BookmarkGroup } from '@/components/sidebar/bookmark-types';
import { createVersionedStorageKeys } from '@/utils/storage-contracts';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';

describe('Bookmark Workspace — collapse', () => {
  const dummyGroups: BookmarkGroup[] = [
    { id: 'group-1', name: 'Folder 1', order: 0 },
    { id: 'group-2', name: 'Folder 2', order: 1 },
  ];
  const storageKey = createVersionedStorageKeys('poe1').bookmarkCollapsedGroups;

  let storageStore: Record<string, any> = {};
  let storageChangeListener: ((changes: any) => void) | null = null;
  let activeWorkspaces: Array<{ dispose: () => void }> = [];

  const setup = async (groups: BookmarkGroup[] = dummyGroups) => {
    const host = createFakeBookmarkWorkspaceHost();
    const model = createFakeBookmarkModel({ groups });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });
    activeWorkspaces.push(workspace);
    await workspace.start();
    return { host, model, workspace };
  };

  beforeEach(() => {
    storageStore = {};
    storageChangeListener = null;
    activeWorkspaces = [];

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

  afterEach(() => {
    activeWorkspaces.forEach((ws) => ws.dispose());
    activeWorkspaces = [];
  });

  it('loads collapsed groups from storage on start()', async () => {
    storageStore[storageKey] = ['group-1'];
    const { workspace } = await setup();

    expect(workspace.tree.isGroupCollapsed('group-1')).toBe(true);
    expect(workspace.tree.isGroupCollapsed('group-2')).toBe(false);
  });

  it('syncs collapsed groups when storage change occurs', async () => {
    const { workspace } = await setup();

    storageChangeListener?.({
      [storageKey]: { newValue: ['group-2'] },
    });

    expect(workspace.tree.isGroupCollapsed('group-1')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('group-2')).toBe(true);
  });

  it('toggles collapse state, persists to storage, and updates sortableKey', async () => {
    const { workspace } = await setup();
    const initialKey = workspace.tree.sortableKey.value;

    // Toggle on (collapse group-1)
    await workspace.tree.toggleGroupCollapse('group-1');
    expect(workspace.tree.isGroupCollapsed('group-1')).toBe(true);
    expect(storageStore[storageKey]).toEqual(['group-1']);
    const collapsedKey = workspace.tree.sortableKey.value;
    expect(collapsedKey).not.toBe(initialKey);

    // Toggle off (expand group-1)
    await workspace.tree.toggleGroupCollapse('group-1');
    expect(workspace.tree.isGroupCollapsed('group-1')).toBe(false);
    expect(storageStore[storageKey]).toEqual([]);
    expect(workspace.tree.sortableKey.value).toBe(initialKey);
  });

  it('does not toggle collapse when group is currently editing', async () => {
    const { workspace } = await setup();
    const initialKey = workspace.tree.sortableKey.value;

    workspace.editing.startRenameGroup(dummyGroups[0]);
    await workspace.tree.toggleGroupCollapse('group-1');

    expect(workspace.tree.isGroupCollapsed('group-1')).toBe(false);
    expect(workspace.tree.sortableKey.value).toBe(initialKey);
  });

  it('expands all, persists to storage, and updates sortableKey', async () => {
    storageStore[storageKey] = ['group-1', 'group-2'];
    const { workspace } = await setup();
    const collapsedKey = workspace.tree.sortableKey.value;

    await workspace.tree.expandAll();

    expect(workspace.tree.collapsedGroupIds.value.size).toBe(0);
    expect(storageStore[storageKey]).toEqual([]);
    expect(workspace.tree.sortableKey.value).not.toBe(collapsedKey);
  });

  it('collapses all, persists to storage, and updates sortableKey', async () => {
    const { workspace } = await setup();
    const expandedKey = workspace.tree.sortableKey.value;

    await workspace.tree.collapseAll();

    expect(workspace.tree.collapsedGroupIds.value.has('group-1')).toBe(true);
    expect(workspace.tree.collapsedGroupIds.value.has('group-2')).toBe(true);
    expect(storageStore[storageKey]).toEqual(expect.arrayContaining(['group-1', 'group-2']));
    expect(workspace.tree.sortableKey.value).not.toBe(expandedKey);
  });

  it('computes isAllCollapsed correctly and toggleExpandAll toggles appropriately', async () => {
    const { workspace } = await setup();

    expect(workspace.tree.isAllCollapsed.value).toBe(false);

    await workspace.tree.toggleGroupCollapse('group-1');
    expect(workspace.tree.isAllCollapsed.value).toBe(false);

    await workspace.tree.toggleGroupCollapse('group-2');
    expect(workspace.tree.isAllCollapsed.value).toBe(true);

    // When all collapsed, toggleExpandAll expands all
    workspace.tree.toggleExpandAll();
    await Promise.resolve();
    expect(workspace.tree.collapsedGroupIds.value.size).toBe(0);

    // When not all collapsed, toggleExpandAll collapses all
    workspace.tree.toggleExpandAll();
    await Promise.resolve();
    expect(workspace.tree.collapsedGroupIds.value.size).toBe(2);
  });

  it('always returns isGroupCollapsed false when searchQuery is non-empty', async () => {
    storageStore[storageKey] = ['group-1', 'group-2'];
    const { workspace } = await setup();

    workspace.tree.search.query.value = 'something';

    expect(workspace.tree.isGroupCollapsed('group-1')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('group-2')).toBe(false);

    // Persisted state in collapsedGroupIds remains intact
    expect(workspace.tree.collapsedGroupIds.value.has('group-1')).toBe(true);
    expect(workspace.tree.collapsedGroupIds.value.has('group-2')).toBe(true);

    // After search query is cleared, original collapsed state is restored
    workspace.tree.search.query.value = '';
    expect(workspace.tree.isGroupCollapsed('group-1')).toBe(true);
    expect(workspace.tree.isGroupCollapsed('group-2')).toBe(true);
  });

  it('does not falsely report isAllCollapsed when stale IDs are present in set', async () => {
    storageStore[storageKey] = ['stale-1', 'stale-2'];
    const { workspace } = await setup();

    // Set has 2 items (stale-1, stale-2), so size == 2, but neither is in dummyGroups
    expect(workspace.tree.isAllCollapsed.value).toBe(false);

    // Set has group-1 and stale-1 (size == 2), but group-2 is not collapsed
    storageChangeListener?.({ [storageKey]: { newValue: ['group-1', 'stale-1'] } });
    expect(workspace.tree.isAllCollapsed.value).toBe(false);

    // Set has both group-1 and group-2 (plus stale-1) -> all active groups are collapsed
    storageChangeListener?.({ [storageKey]: { newValue: ['group-1', 'group-2', 'stale-1'] } });
    expect(workspace.tree.isAllCollapsed.value).toBe(true);
  });

  it('handles arbitrary depth nested folders in collapseAll and expandAll', async () => {
    const nestedGroups: BookmarkGroup[] = [
      { id: 'root', name: 'Root', order: 0 },
      { id: 'child', name: 'Child', order: 0, parentId: 'root' },
      { id: 'grandchild', name: 'Grandchild', order: 0, parentId: 'child' },
    ];
    const { workspace } = await setup(nestedGroups);

    await workspace.tree.collapseAll();
    expect(workspace.tree.isAllCollapsed.value).toBe(true);
    expect(workspace.tree.isGroupCollapsed('root')).toBe(true);
    expect(workspace.tree.isGroupCollapsed('child')).toBe(true);
    expect(workspace.tree.isGroupCollapsed('grandchild')).toBe(true);

    await workspace.tree.expandAll();
    expect(workspace.tree.isAllCollapsed.value).toBe(false);
    expect(workspace.tree.isGroupCollapsed('root')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('child')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('grandchild')).toBe(false);
  });

  it('provides subtree-scoped collapse and expand without affecting unrelated subtrees', async () => {
    const treeGroups: BookmarkGroup[] = [
      { id: 'tree-a', name: 'Tree A', order: 0 },
      { id: 'a-child-1', name: 'A Child 1', order: 0, parentId: 'tree-a' },
      { id: 'a-child-2', name: 'A Child 2', order: 1, parentId: 'tree-a' },
      { id: 'tree-b', name: 'Tree B', order: 1 },
      { id: 'b-child-1', name: 'B Child 1', order: 0, parentId: 'tree-b' },
    ];
    const { workspace } = await setup(treeGroups);

    expect(workspace.tree.hasSubtreeFolders('tree-a')).toBe(true);
    expect(workspace.tree.hasSubtreeFolders('a-child-1')).toBe(false);

    // Initial: none collapsed in tree-a -> not all collapsed
    expect(workspace.tree.isSubtreeAllCollapsed('tree-a')).toBe(false);

    // Toggle collapses all children in tree-a
    await workspace.tree.toggleSubtreeCollapse('tree-a');
    expect(workspace.tree.isGroupCollapsed('a-child-1')).toBe(true);
    expect(workspace.tree.isGroupCollapsed('a-child-2')).toBe(true);
    // Tree B is completely untouched
    expect(workspace.tree.isGroupCollapsed('tree-b')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('b-child-1')).toBe(false);
    expect(workspace.tree.isSubtreeAllCollapsed('tree-a')).toBe(true);

    // Toggle again expands all children in tree-a and ensures root tree-a is expanded
    await workspace.tree.toggleSubtreeCollapse('tree-a');
    expect(workspace.tree.isGroupCollapsed('tree-a')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('a-child-1')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('a-child-2')).toBe(false);
    expect(workspace.tree.isGroupCollapsed('b-child-1')).toBe(false);
  });
});
