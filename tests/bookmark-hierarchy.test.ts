import { describe, expect, it } from 'vitest';
import {
  BOOKMARK_COLLECTION_STATE_KEY,
  BOOKMARK_COLLECTION_STATE_KEY_V2,
  canMoveFolder,
  createBookmarkCollectionModule,
  getFolderSubtreeIds,
  getSubtreeBookmarkIds,
  getFolderDeleteImpact,
  isDirectlyDeletableEmptyFolder,
  isBookmarkCollectionState,
  isBookmarkCollectionStateV3,
  isCanonicalBookmarkCollectionStateV3,
  canonicalizeBookmarkCollectionState,
  formatFolderPath,
  getFolderPathNames,
  migrateBookmarkCollectionStateV2ToV3,
  type BookmarkCollectionState,
  type BookmarkCollectionStateV2,
  type BookmarkFolder,
} from '@/utils/bookmark-collection';
import {
  createBackgroundBookmarkCoordinator,
  createInMemoryBookmarkCoordinatorStorage,
  loadBookmarkCollectionFromStorage,
  type BookmarkCoordinator,
  type BookmarkCoordinatorStorage,
} from '@/utils/bookmark-coordinator';
import {
  createInMemorySearchRecordStorage,
  createSearchRecordModule,
  SEARCH_RECORD_STATE_KEY,
} from '@/utils/search-records';
import { createBookmarkClient } from '@/utils/bookmark-messaging';

async function setupCoordinator(
  storage: BookmarkCoordinatorStorage = createInMemoryBookmarkCoordinatorStorage(),
) {
  const searchRecords = createSearchRecordModule(createInMemorySearchRecordStorage());
  await searchRecords.initialize();
  const coordinator = createBackgroundBookmarkCoordinator(searchRecords, storage);
  await coordinator.initialize();
  return { searchRecords, coordinator, storage };
}

function messagingClient(coordinator: BookmarkCoordinator) {
  return createBookmarkClient(
    {
      execute: (command) => coordinator.execute(command),
      read: (read) => coordinator.read(read),
      subscribeBookmarkChange: (listener) => coordinator.subscribe(listener),
    },
    'poe1',
  );
}

describe('Bookmark Multi-level Folder — Phase A: Hierarchy Contract & Migration', () => {
  // 1. V2 → 新 schema migration 無損
  it('1. performs lossless, deterministic migration from V2 to V3 and cleans up legacy storage key upon initialize', async () => {
    const v2State: BookmarkCollectionStateV2 = {
      schemaVersion: 2,
      groups: [
        { id: 'group-1', gameVersion: 'poe1', name: 'Root One', order: 0 },
        { id: 'group-2', gameVersion: 'poe1', name: 'Root Two', order: 1 },
      ],
      bookmarks: [
        {
          id: 'bm-1',
          gameVersion: 'poe1',
          name: 'First Item',
          groupId: 'group-1',
          order: 0,
          createdAt: 123456789,
          coverImageUrl: 'https://web.poecdn.com/gen/image/item1.png',
        },
        {
          id: 'bm-2',
          gameVersion: 'poe1',
          name: 'Second Item',
          groupId: 'group-2',
          order: 0,
        },
      ],
    };

    // Direct pure migration
    const v3State = migrateBookmarkCollectionStateV2ToV3(v2State);
    expect(v3State.schemaVersion).toBe(3);
    expect(v3State.folders).toEqual([
      { id: 'group-1', gameVersion: 'poe1', name: 'Root One', order: 0 },
      { id: 'group-2', gameVersion: 'poe1', name: 'Root Two', order: 1 },
    ]);
    expect(v3State.bookmarks).toEqual([
      {
        id: 'bm-1',
        gameVersion: 'poe1',
        name: 'First Item',
        groupId: 'group-1',
        order: 0,
        createdAt: 123456789,
        coverImageUrl: 'https://web.poecdn.com/gen/image/item1.png',
      },
      {
        id: 'bm-2',
        gameVersion: 'poe1',
        name: 'Second Item',
        groupId: 'group-2',
        order: 0,
        createdAt: undefined,
        coverImageUrl: undefined,
      },
    ]);
    expect(isBookmarkCollectionState(v3State)).toBe(true);

    // Verify canonical V3 read exposes groupId only and no folderId runtime alias
    const migratedModule = createBookmarkCollectionModule(v3State);
    const migratedRead = migratedModule.read('poe1');
    expect(migratedRead.bookmarks[0].groupId).toBe('group-1');
    expect((migratedRead.bookmarks[0] as any).folderId).toBeUndefined();
    expect(Object.keys(migratedRead.bookmarks[0])).not.toContain('folderId');
    expect(JSON.parse(JSON.stringify(migratedRead.bookmarks[0])).folderId).toBeUndefined();

    // Coordinator storage migration and legacy key cleanup
    const v2StorageState: BookmarkCollectionStateV2 = {
      schemaVersion: 2,
      groups: [
        { id: 'group-1', gameVersion: 'poe1', name: 'Root One', order: 0 },
        { id: 'group-2', gameVersion: 'poe1', name: 'Root Two', order: 1 },
      ],
      bookmarks: [],
    };
    const rawStorage: Record<string, unknown> = {
      [BOOKMARK_COLLECTION_STATE_KEY_V2]: v2StorageState,
    };
    const storage = createInMemoryBookmarkCoordinatorStorage(rawStorage);
    const { coordinator } = await setupCoordinator(storage);
    const client = messagingClient(coordinator);
    const collection = await client.readCollection();
    expect(collection.ok && collection.value.groups.length).toBe(2);
    expect(collection.ok && collection.value.bookmarks.length).toBe(0);

    // Check storage inspect: V2 should be cleaned up and V3 committed
    const inspected = (storage as any).inspect();
    expect(inspected[BOOKMARK_COLLECTION_STATE_KEY_V2]).toBeUndefined();
    expect(inspected[BOOKMARK_COLLECTION_STATE_KEY]?.schemaVersion).toBe(3);
    expect(inspected[BOOKMARK_COLLECTION_STATE_KEY]?.folders.length).toBe(2);
  });

  // 2. 多層 parent/child hierarchy 可合法存在
  it('2. allows arbitrary depth parent/child hierarchy in canonical state', () => {
    const state: BookmarkCollectionState = {
      schemaVersion: 3,
      folders: [
        { id: 'f-root', gameVersion: 'poe1', name: 'Root', order: 0 },
        { id: 'f-child', gameVersion: 'poe1', name: 'Child', order: 0, parentId: 'f-root' },
        {
          id: 'f-grandchild',
          gameVersion: 'poe1',
          name: 'Grandchild',
          order: 0,
          parentId: 'f-child',
        },
        {
          id: 'f-great-grandchild',
          gameVersion: 'poe1',
          name: 'Deep',
          order: 0,
          parentId: 'f-grandchild',
        },
      ],
      bookmarks: [
        {
          id: 'bm-deep',
          gameVersion: 'poe1',
          name: 'Deep Item',
          groupId: 'f-great-grandchild',
          order: 0,
        },
      ],
    };

    expect(isBookmarkCollectionState(state)).toBe(true);
    const module = createBookmarkCollectionModule(state);
    const read = module.read('poe1');
    expect(read.groups.length).toBe(4);
    expect(read.bookmarks[0].groupId).toBe('f-great-grandchild');
    expect((read.bookmarks[0] as any).folderId).toBeUndefined();
  });

  // 3. dangling parent 被拒絕
  it('3. rejects state with dangling parent', () => {
    const state: BookmarkCollectionState = {
      schemaVersion: 3,
      folders: [
        {
          id: 'f-child',
          gameVersion: 'poe1',
          name: 'Child',
          order: 0,
          parentId: 'nonexistent-parent',
        },
      ],
      bookmarks: [],
    };
    expect(isBookmarkCollectionState(state)).toBe(false);

    const module = createBookmarkCollectionModule({ schemaVersion: 3, folders: [], bookmarks: [] });
    expect(() =>
      module.prepare({
        type: 'put-group',
        group: { id: 'f-child', gameVersion: 'poe1', name: 'Child', order: 0, parentId: 'missing' },
      }),
    ).toThrow(/Parent folder missing does not exist/);
  });

  // 4. self-parent 被拒絕
  it('4. rejects folder parent pointing to itself', () => {
    const state: BookmarkCollectionState = {
      schemaVersion: 3,
      folders: [{ id: 'f-1', gameVersion: 'poe1', name: 'Self', order: 0, parentId: 'f-1' }],
      bookmarks: [],
    };
    expect(isBookmarkCollectionState(state)).toBe(false);

    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders: [{ id: 'f-1', gameVersion: 'poe1', name: 'Folder', order: 0 }],
      bookmarks: [],
    });
    expect(() =>
      module.prepare({
        type: 'move-folder',
        gameVersion: 'poe1',
        folderId: 'f-1',
        targetParentId: 'f-1',
      }),
    ).toThrow(/Folder cannot be its own parent/);
  });

  // 5. indirect cycle 被拒絕
  it('5. rejects indirect cycles (A -> B -> C -> A)', () => {
    const cyclicState: BookmarkCollectionState = {
      schemaVersion: 3,
      folders: [
        { id: 'f-a', gameVersion: 'poe1', name: 'A', order: 0, parentId: 'f-c' },
        { id: 'f-b', gameVersion: 'poe1', name: 'B', order: 0, parentId: 'f-a' },
        { id: 'f-c', gameVersion: 'poe1', name: 'C', order: 0, parentId: 'f-b' },
      ],
      bookmarks: [],
    };
    expect(isBookmarkCollectionState(cyclicState)).toBe(false);

    // Also verify move-folder rejects cycle creation
    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders: [
        { id: 'f-a', gameVersion: 'poe1', name: 'A', order: 0 },
        { id: 'f-b', gameVersion: 'poe1', name: 'B', order: 0, parentId: 'f-a' },
        { id: 'f-c', gameVersion: 'poe1', name: 'C', order: 0, parentId: 'f-b' },
      ],
      bookmarks: [],
    });
    expect(() =>
      module.prepare({
        type: 'move-folder',
        gameVersion: 'poe1',
        folderId: 'f-a',
        targetParentId: 'f-c',
      }),
    ).toThrow(/Folder cannot be moved into its own descendant/);
  });

  // 6. 跨 gameVersion parent 被拒絕
  it('6. rejects parent from a different gameVersion', () => {
    const crossVersionState: BookmarkCollectionState = {
      schemaVersion: 3,
      folders: [
        { id: 'f-poe1', gameVersion: 'poe1', name: 'PoE 1 Root', order: 0 },
        { id: 'f-poe2', gameVersion: 'poe2', name: 'PoE 2 Child', order: 0, parentId: 'f-poe1' },
      ],
      bookmarks: [],
    };
    expect(isBookmarkCollectionState(crossVersionState)).toBe(false);

    const folders: BookmarkFolder[] = [
      { id: 'f-poe1', gameVersion: 'poe1', name: 'PoE 1 Root', order: 0 },
      { id: 'f-poe2', gameVersion: 'poe2', name: 'PoE 2 Target', order: 0 },
    ];
    const check = canMoveFolder(folders, 'f-poe2', 'f-poe1');
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/different game version/);
  });

  // 7. folder 可跨 parent 移動
  it('7. allows moving a folder across parents and back to root', () => {
    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders: [
        { id: 'p-1', gameVersion: 'poe1', name: 'Parent 1', order: 0 },
        { id: 'p-2', gameVersion: 'poe1', name: 'Parent 2', order: 1 },
        { id: 'f-target', gameVersion: 'poe1', name: 'Moving Folder', order: 0, parentId: 'p-1' },
      ],
      bookmarks: [],
    });

    // Move from p-1 to p-2
    const prep1 = module.prepare({
      type: 'move-folder',
      gameVersion: 'poe1',
      folderId: 'f-target',
      targetParentId: 'p-2',
      order: 5,
    });
    expect(prep1.changed).toBe(true);
    module.accept(prep1.state);
    const movedToP2 = module.snapshot().folders.find((f) => f.id === 'f-target');
    expect(movedToP2?.parentId).toBe('p-2');
    expect(movedToP2?.order).toBe(5);

    // Move back to root (targetParentId: undefined)
    const prep2 = module.prepare({
      type: 'move-folder',
      gameVersion: 'poe1',
      folderId: 'f-target',
      targetParentId: undefined,
    });
    expect(prep2.changed).toBe(true);
    module.accept(prep2.state);
    const movedToRoot = module.snapshot().folders.find((f) => f.id === 'f-target');
    expect(movedToRoot?.parentId).toBeUndefined();
  });

  // 8. folder 不得移入自己的 descendant
  it('8. prevents folder from moving into its own descendant', () => {
    const folders: BookmarkFolder[] = [
      { id: 'f-ancestor', gameVersion: 'poe1', name: 'Ancestor', order: 0 },
      { id: 'f-mid', gameVersion: 'poe1', name: 'Mid', order: 0, parentId: 'f-ancestor' },
      { id: 'f-leaf', gameVersion: 'poe1', name: 'Leaf', order: 0, parentId: 'f-mid' },
    ];
    expect(canMoveFolder(folders, 'f-ancestor', 'f-leaf')).toEqual({
      allowed: false,
      reason: 'Folder cannot be moved into its own descendant',
    });
    expect(canMoveFolder(folders, 'f-ancestor', 'f-mid')).toEqual({
      allowed: false,
      reason: 'Folder cannot be moved into its own descendant',
    });
  });

  // 9. sibling reorder 不影響其他 parent 的 siblings
  it('9. reordering siblings under one parent does not affect siblings under other parents', () => {
    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders: [
        { id: 'root-1', gameVersion: 'poe1', name: 'R1', order: 0 },
        { id: 'root-2', gameVersion: 'poe1', name: 'R2', order: 1 },
        { id: 'child-1a', gameVersion: 'poe1', name: 'C1A', order: 0, parentId: 'root-1' },
        { id: 'child-1b', gameVersion: 'poe1', name: 'C1B', order: 1, parentId: 'root-1' },
        { id: 'child-2a', gameVersion: 'poe1', name: 'C2A', order: 10, parentId: 'root-2' },
        { id: 'child-2b', gameVersion: 'poe1', name: 'C2B', order: 20, parentId: 'root-2' },
      ],
      bookmarks: [],
    });

    const prep = module.prepare({
      type: 'move-folder',
      gameVersion: 'poe1',
      folderId: 'child-1a',
      targetParentId: 'root-1',
      dropIntent: {
        targetFolderId: 'child-1b',
        position: 'after',
      },
    });
    expect(prep.changed).toBe(true);
    module.accept(prep.state);

    const snapshot = module.snapshot();
    const c1a = snapshot.folders.find((f) => f.id === 'child-1a');
    const c1b = snapshot.folders.find((f) => f.id === 'child-1b');
    const c2a = snapshot.folders.find((f) => f.id === 'child-2a');
    const c2b = snapshot.folders.find((f) => f.id === 'child-2b');

    // Root-1 siblings swapped
    expect(c1b?.order).toBe(0);
    expect(c1a?.order).toBe(1);

    // Root-2 siblings untouched
    expect(c2a?.order).toBe(10);
    expect(c2b?.order).toBe(20);
  });

  // 10. 刪除 parent folder 會 cascade 整個 subtree
  it('10. cascading delete removes the parent folder and all its descendant folders and bookmarks', () => {
    const initial: BookmarkCollectionState = {
      schemaVersion: 3,
      folders: [
        { id: 'f-delete-root', gameVersion: 'poe1', name: 'Delete Me', order: 0 },
        { id: 'f-sub-1', gameVersion: 'poe1', name: 'Sub 1', order: 0, parentId: 'f-delete-root' },
        { id: 'f-sub-2', gameVersion: 'poe1', name: 'Sub 2', order: 0, parentId: 'f-sub-1' },
        { id: 'f-other', gameVersion: 'poe1', name: 'Keep Me', order: 1 },
      ],
      bookmarks: [
        { id: 'bm-root', gameVersion: 'poe1', name: 'Root BM', groupId: 'f-delete-root', order: 0 },
        { id: 'bm-sub1', gameVersion: 'poe1', name: 'Sub1 BM', groupId: 'f-sub-1', order: 0 },
        { id: 'bm-sub2', gameVersion: 'poe1', name: 'Sub2 BM', groupId: 'f-sub-2', order: 0 },
        { id: 'bm-other', gameVersion: 'poe1', name: 'Other BM', groupId: 'f-other', order: 0 },
      ],
    };

    const module = createBookmarkCollectionModule(initial);
    const prep = module.prepare({
      type: 'delete-group',
      gameVersion: 'poe1',
      groupId: 'f-delete-root',
    });

    expect(prep.changed).toBe(true);
    expect(prep.state.folders.map((f) => f.id)).toEqual(['f-other']);
    expect(prep.state.bookmarks.map((b) => b.id)).toEqual(['bm-other']);
  });

  // 11. cascade delete 回報所有 descendant Bookmark IDs
  it('11. cascade delete reports all removed descendant Bookmark IDs in prepared mutation', () => {
    const folders: BookmarkFolder[] = [
      { id: 'r', gameVersion: 'poe1', name: 'Root', order: 0 },
      { id: 'c1', gameVersion: 'poe1', name: 'Child 1', order: 0, parentId: 'r' },
      { id: 'c2', gameVersion: 'poe1', name: 'Child 2', order: 0, parentId: 'c1' },
      { id: 'other', gameVersion: 'poe1', name: 'Other', order: 1 },
    ];
    const subtreeIds = getFolderSubtreeIds(folders, 'r');
    expect(Array.from(subtreeIds).sort()).toEqual(['c1', 'c2', 'r']);

    const bookmarks = [
      { id: 'b-r', gameVersion: 'poe1' as const, name: 'BR', groupId: 'r', order: 0 },
      { id: 'b-c1', gameVersion: 'poe1' as const, name: 'BC1', groupId: 'c1', order: 0 },
      { id: 'b-c2', gameVersion: 'poe1' as const, name: 'BC2', groupId: 'c2', order: 0 },
      { id: 'b-ext', gameVersion: 'poe1' as const, name: 'BExt', groupId: 'other', order: 0 },
    ];
    const removedIds = getSubtreeBookmarkIds(folders, bookmarks, 'r');
    expect(removedIds.sort()).toEqual(['b-c1', 'b-c2', 'b-r']);

    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders,
      bookmarks,
    });
    const prep = module.prepare({
      type: 'delete-group',
      gameVersion: 'poe1',
      groupId: 'r',
    });
    expect(prep.removedBookmarkIds.sort()).toEqual(['b-c1', 'b-c2', 'b-r']);

    const impact = getFolderDeleteImpact(folders, bookmarks, 'r');
    expect(impact.rootFolderId).toBe('r');
    expect(Array.from(impact.subtreeFolderIds).sort()).toEqual(['c1', 'c2', 'r']);
    expect(impact.totalFolderCount).toBe(3);
    expect(impact.descendantFolderCount).toBe(2);
    expect(impact.affectedBookmarkCount).toBe(3);
    expect(impact.affectedBookmarkIds.sort()).toEqual(['b-c1', 'b-c2', 'b-r']);

    const leafImpact = getFolderDeleteImpact(folders, bookmarks, 'c2');
    expect(leafImpact.totalFolderCount).toBe(1);
    expect(leafImpact.descendantFolderCount).toBe(0);
    expect(leafImpact.affectedBookmarkCount).toBe(1);
    expect(leafImpact.affectedBookmarkIds).toEqual(['b-c2']);
    expect(isDirectlyDeletableEmptyFolder(leafImpact)).toBe(false);

    // Empty leaf folder (0 descendants, 0 bookmarks) -> true
    const emptyLeafImpact = getFolderDeleteImpact(folders, [], 'c2');
    expect(emptyLeafImpact.descendantFolderCount).toBe(0);
    expect(emptyLeafImpact.affectedBookmarkCount).toBe(0);
    expect(isDirectlyDeletableEmptyFolder(emptyLeafImpact)).toBe(true);

    // Folder with descendant folders but 0 bookmarks -> false
    const emptyParentImpact = getFolderDeleteImpact(folders, [], 'r');
    expect(emptyParentImpact.descendantFolderCount).toBe(2);
    expect(emptyParentImpact.affectedBookmarkCount).toBe(0);
    expect(isDirectlyDeletableEmptyFolder(emptyParentImpact)).toBe(false);
  });

  // 12. Search Record coordinated cleanup 沿用現有 ownership
  it('12. coordinates atomic search record cleanup when deleting a multi-level folder subtree', async () => {
    const { searchRecords, coordinator } = await setupCoordinator();
    const client = messagingClient(coordinator);

    const firstUrl = 'https://www.pathofexile.com/trade/search/Standard/test-coord-1';
    const secondUrl = 'https://www.pathofexile.com/trade/search/Standard/test-coord-2';

    // Create root folder and child folder
    await client.putGroup({ id: 'parent-folder', name: 'Parent', order: 0 });
    await client.putGroup({
      id: 'child-folder',
      name: 'Child',
      order: 0,
      parentId: 'parent-folder',
    });

    // Put bookmarks in both levels
    await client.putBookmark({
      id: 'bm-parent',
      name: 'Parent Bookmark',
      url: firstUrl,
      groupId: 'parent-folder',
      order: 0,
    });
    await client.putBookmark({
      id: 'bm-child',
      name: 'Child Bookmark',
      url: secondUrl,
      groupId: 'child-folder',
      order: 0,
    });

    // Verify search records references exist
    const recordsBefore = await searchRecords.read({
      type: 'get-bookmark-records',
      gameVersion: 'poe1',
    });
    expect(recordsBefore.ok && recordsBefore.value.length).toBe(2);

    // Delete parent folder (subtree cascade)
    const deleteOutcome = await client.deleteGroup('parent-folder');
    expect(deleteOutcome.ok).toBe(true);

    // Verify collection is empty
    const collectionAfter = await client.readCollection();
    expect(collectionAfter.ok && collectionAfter.value.groups).toEqual([]);
    expect(collectionAfter.ok && collectionAfter.value.bookmarks).toEqual([]);

    // Verify Search Record references for both bookmarks were cleanly removed
    const recordsAfter = await searchRecords.read({
      type: 'get-bookmark-records',
      gameVersion: 'poe1',
    });
    expect(recordsAfter.ok && recordsAfter.value).toEqual([]);
  });

  // 13. 既有單層 Bookmark 行為沒有 regression
  it('13. maintains single-level folder and bookmark behavior without regression', async () => {
    const { coordinator } = await setupCoordinator();
    const client = messagingClient(coordinator);
    const testUrl = 'https://www.pathofexile.com/trade/search/Standard/single-level';

    // Put group (legacy call)
    await client.putGroup({ id: 'single-group', name: 'Single Group', order: 0 });
    // Put bookmark
    await client.putBookmark({
      id: 'single-bm',
      name: 'Single BM',
      url: testUrl,
      groupId: 'single-group',
      order: 0,
    });

    const read1 = await client.readCollection();
    expect(read1.ok && read1.value.groups.map((g) => g.name)).toEqual(['Single Group']);
    expect(read1.ok && read1.value.bookmarks.map((b) => b.name)).toEqual(['Single BM']);

    // Reorder groups (legacy call)
    await client.putGroup({ id: 'single-group-2', name: 'Second Group', order: 1 });
    await client.reorderGroups(['single-group-2', 'single-group']);

    const read2 = await client.readCollection();
    expect(read2.ok && read2.value.groups.map((g) => g.id)).toEqual([
      'single-group-2',
      'single-group',
    ]);

    // Delete bookmark
    await client.deleteBookmark('single-bm');
    const read3 = await client.readCollection();
    expect(read3.ok && read3.value.bookmarks).toEqual([]);
  });

  // 14. 嚴格拒絕矛盾的 folderId 與 groupId (validator)
  it('14. rejects state with contradicting bookmark folderId and groupId in validator', () => {
    const conflictingState = {
      schemaVersion: 3,
      folders: [
        { id: 'f-1', gameVersion: 'poe1', name: 'Folder 1', order: 0 },
        { id: 'f-2', gameVersion: 'poe1', name: 'Folder 2', order: 1 },
      ],
      bookmarks: [
        {
          id: 'bm-conflict',
          gameVersion: 'poe1',
          name: 'Conflict BM',
          groupId: 'f-1',
          folderId: 'f-2', // Contradicting!
          order: 0,
        },
      ],
    };
    expect(isBookmarkCollectionState(conflictingState)).toBe(false);
  });

  // 15. put-bookmark 嚴格拒絕帶有 legacy folderId 的 runtime payload（包含相同雙欄位與 folderId-only）
  it('15. strictly rejects any runtime put-bookmark payload containing legacy folderId', () => {
    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders: [
        { id: 'f-1', gameVersion: 'poe1', name: 'Folder 1', order: 0 },
        { id: 'f-2', gameVersion: 'poe1', name: 'Folder 2', order: 1 },
      ],
      bookmarks: [],
    });

    // Contradictory ownership rejected
    expect(() =>
      module.prepare({
        type: 'put-bookmark',
        bookmark: {
          id: 'bm-conflict',
          gameVersion: 'poe1',
          name: 'Conflict',
          groupId: 'f-1',
          folderId: 'f-2',
          order: 0,
        } as any,
      }),
    ).toThrow(/Legacy folderId is prohibited in runtime bookmark mutation/);

    // Equivalent dual fields rejected (must not be treated as formal runtime contract)
    expect(() =>
      module.prepare({
        type: 'put-bookmark',
        bookmark: {
          id: 'bm-equal-dual',
          gameVersion: 'poe1',
          name: 'Equal Dual',
          groupId: 'f-1',
          folderId: 'f-1',
          order: 0,
        } as any,
      }),
    ).toThrow(/Legacy folderId is prohibited in runtime bookmark mutation/);

    // folderId-only runtime payload rejected
    expect(() =>
      module.prepare({
        type: 'put-bookmark',
        bookmark: {
          id: 'bm-folder',
          gameVersion: 'poe1',
          name: 'Via FolderId',
          folderId: 'f-1',
          order: 0,
        } as any,
      }),
    ).toThrow(/Legacy folderId is prohibited in runtime bookmark mutation/);

    // Single canonical groupId accepted
    const prepWithGroupId = module.prepare({
      type: 'put-bookmark',
      bookmark: {
        id: 'bm-group',
        gameVersion: 'poe1',
        name: 'Via GroupId',
        groupId: 'f-2',
        order: 0,
      },
    });
    expect(prepWithGroupId.changed).toBe(true);
    expect(prepWithGroupId.state.bookmarks[0].groupId).toBe('f-2');
  });

  // 16. reorder-bookmarks 收到 folderId 時 fail-closed 拒絕且 state 完全不變（無 partial mutation）
  it('16. strictly rejects any reorder-bookmarks placement with folderId and preserves state with zero partial mutation', () => {
    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders: [
        { id: 'f-1', gameVersion: 'poe1', name: 'Folder 1', order: 0 },
        { id: 'f-2', gameVersion: 'poe1', name: 'Folder 2', order: 1 },
      ],
      bookmarks: [{ id: 'bm-1', gameVersion: 'poe1', name: 'BM 1', groupId: 'f-1', order: 0 }],
    });

    const initialBookmark = module.snapshot().bookmarks[0];

    // folderId-only placement rejected and state untouched
    expect(() =>
      module.prepare({
        type: 'reorder-bookmarks',
        gameVersion: 'poe1',
        placements: [{ id: 'bm-1', folderId: 'f-2', order: 99 } as any],
      }),
    ).toThrow(/Legacy folderId is prohibited in runtime reorder placement/);
    expect(module.snapshot().bookmarks[0]).toEqual(initialBookmark);

    // Equivalent dual fields placement rejected and state untouched
    expect(() =>
      module.prepare({
        type: 'reorder-bookmarks',
        gameVersion: 'poe1',
        placements: [{ id: 'bm-1', groupId: 'f-2', folderId: 'f-2', order: 5 } as any],
      }),
    ).toThrow(/Legacy folderId is prohibited in runtime reorder placement/);
    expect(module.snapshot().bookmarks[0]).toEqual(initialBookmark);

    // Contradictory placement rejected and state untouched
    expect(() =>
      module.prepare({
        type: 'reorder-bookmarks',
        gameVersion: 'poe1',
        placements: [{ id: 'bm-1', groupId: 'f-1', folderId: 'f-2', order: 10 } as any],
      }),
    ).toThrow(/Legacy folderId is prohibited in runtime reorder placement/);
    expect(module.snapshot().bookmarks[0]).toEqual(initialBookmark);

    // Canonical groupId placement succeeds normally
    const prepValid = module.prepare({
      type: 'reorder-bookmarks',
      gameVersion: 'poe1',
      placements: [{ id: 'bm-1', groupId: 'f-2', order: 5 }],
    });
    expect(prepValid.changed).toBe(true);
    expect(prepValid.state.bookmarks[0].groupId).toBe('f-2');
    expect(prepValid.state.bookmarks[0].order).toBe(5);
  });

  // 17. persisted canonical V3 最終只以 groupId 表示 Bookmark ownership
  it('17. persisted canonical V3 exclusively represents Bookmark ownership via groupId without persisting folderId', async () => {
    const storage = createInMemoryBookmarkCoordinatorStorage();
    const { coordinator } = await setupCoordinator(storage);
    const client = messagingClient(coordinator);

    await client.putGroup({ id: 'f-canonical', name: 'Folder', order: 0 });
    await client.putBookmark({
      id: 'bm-canonical',
      name: 'Item',
      url: 'https://www.pathofexile.com/trade/search/Standard/item',
      groupId: 'f-canonical',
      order: 0,
    });

    const inspected = (storage as any).inspect()[BOOKMARK_COLLECTION_STATE_KEY];
    expect(inspected.schemaVersion).toBe(3);
    expect(inspected.bookmarks.length).toBe(1);
    const bm = inspected.bookmarks[0];
    expect(bm.groupId).toBe('f-canonical');
    expect('folderId' in bm).toBe(false);
    expect(bm.folderId).toBeUndefined();
    expect(Object.keys(bm)).not.toContain('folderId');
    expect(JSON.parse(JSON.stringify(bm)).folderId).toBeUndefined();
    expect(isCanonicalBookmarkCollectionStateV3(inspected)).toBe(true);
  });

  // 18. 前一版產生的等值 groupId + folderId V3 不丟資料，且 normalize 後不再保留雙 ownership
  it('18. losslessly normalizes legacy V3 with equivalent groupId and folderId to single groupId ownership and updates storage', async () => {
    const dualState = {
      schemaVersion: 3,
      folders: [{ id: 'f-dual', gameVersion: 'poe1', name: 'Dual Folder', order: 0 }],
      bookmarks: [
        {
          id: 'bm-dual',
          gameVersion: 'poe1',
          name: 'Dual BM',
          groupId: 'f-dual',
          folderId: 'f-dual',
          order: 0,
          createdAt: 88888,
          coverImageUrl: 'https://web.poecdn.com/image.png',
        },
      ],
    };

    // isBookmarkCollectionState accepts equivalent dual-field V3
    expect(isBookmarkCollectionState(dualState)).toBe(true);
    // But it is not pure canonical because folderId is present
    expect(isCanonicalBookmarkCollectionStateV3(dualState)).toBe(false);

    // Canonicalization normalizes and strips folderId
    const canonical = canonicalizeBookmarkCollectionState(dualState);
    expect(canonical.bookmarks[0].groupId).toBe('f-dual');
    expect('folderId' in canonical.bookmarks[0]).toBe(false);
    expect(canonical.bookmarks[0].createdAt).toBe(88888);
    expect(canonical.bookmarks[0].coverImageUrl).toBe('https://web.poecdn.com/image.png');

    // Module read preserves all data and exposes groupId only
    const module = createBookmarkCollectionModule(dualState);
    const read = module.read('poe1');
    expect(read.bookmarks[0].name).toBe('Dual BM');
    expect(read.bookmarks[0].groupId).toBe('f-dual');
    expect((read.bookmarks[0] as any).folderId).toBeUndefined();

    // Storage load detects migration need and strips folderId
    const loaded = loadBookmarkCollectionFromStorage({
      [BOOKMARK_COLLECTION_STATE_KEY]: dualState,
    });
    expect(loaded.migrated).toBe(true);
    expect(loaded.state?.bookmarks[0].groupId).toBe('f-dual');
    expect('folderId' in loaded.state!.bookmarks[0]).toBe(false);

    // Coordinator initialization commits pure canonical V3 to storage
    const storage = createInMemoryBookmarkCoordinatorStorage({
      [BOOKMARK_COLLECTION_STATE_KEY]: dualState,
    });
    await setupCoordinator(storage);
    const inspected = (storage as any).inspect()[BOOKMARK_COLLECTION_STATE_KEY];
    expect(inspected.bookmarks[0].groupId).toBe('f-dual');
    expect('folderId' in inspected.bookmarks[0]).toBe(false);
    expect(Object.keys(inspected.bookmarks[0])).not.toContain('folderId');
    expect(isCanonicalBookmarkCollectionStateV3(inspected)).toBe(true);
  });

  // 19. folderId-only V3 不會出現「validator 通過，但 read 後 ownership 變 undefined」的情況
  it('19. rejects folderId-only V3 in canonical validator and normalizes to groupId before entering module so ownership is never undefined', async () => {
    const folderIdOnlyState = {
      schemaVersion: 3,
      folders: [{ id: 'f-compat', gameVersion: 'poe1', name: 'Compat Folder', order: 0 }],
      bookmarks: [
        {
          id: 'bm-compat',
          gameVersion: 'poe1',
          name: 'Compat BM',
          folderId: 'f-compat',
          // groupId omitted
          order: 0,
        },
      ],
    };

    // 1. Validator does NOT pass it as a canonical state
    expect(isBookmarkCollectionState(folderIdOnlyState)).toBe(false);
    expect(isBookmarkCollectionStateV3(folderIdOnlyState)).toBe(false);

    // 2. Passing it to module deterministically normalizes it to groupId
    const module = createBookmarkCollectionModule(folderIdOnlyState);
    const read = module.read('poe1');
    expect(read.bookmarks[0].groupId).toBe('f-compat');
    expect((read.bookmarks[0] as any).folderId).toBeUndefined();
    expect(read.bookmarks[0].groupId).not.toBeUndefined();
    expect(module.snapshot().bookmarks[0].groupId).toBe('f-compat');
    expect('folderId' in module.snapshot().bookmarks[0]).toBe(false);

    // 3. Loading through storage loader normalizes and marks migrated
    const loaded = loadBookmarkCollectionFromStorage({
      [BOOKMARK_COLLECTION_STATE_KEY]: folderIdOnlyState,
    });
    expect(loaded.migrated).toBe(true);
    expect(loaded.state?.bookmarks[0].groupId).toBe('f-compat');
    expect('folderId' in loaded.state!.bookmarks[0]).toBe(false);

    // 4. Coordinator initialize re-commits pure canonical V3 to storage
    const storage = createInMemoryBookmarkCoordinatorStorage({
      [BOOKMARK_COLLECTION_STATE_KEY]: folderIdOnlyState,
    });
    await setupCoordinator(storage);
    const inspected = (storage as any).inspect()[BOOKMARK_COLLECTION_STATE_KEY];
    expect(inspected.bookmarks[0].groupId).toBe('f-compat');
    expect('folderId' in inspected.bookmarks[0]).toBe(false);
    expect(isCanonicalBookmarkCollectionStateV3(inspected)).toBe(true);
  });

  // 20. contradictory ownership 仍被拒絕
  it('20. strictly rejects contradictory folderId and groupId across validator, storage load, and module creation', () => {
    const contradictoryState = {
      schemaVersion: 3,
      folders: [
        { id: 'f-1', gameVersion: 'poe1', name: 'F1', order: 0 },
        { id: 'f-2', gameVersion: 'poe1', name: 'F2', order: 1 },
      ],
      bookmarks: [
        {
          id: 'bm-bad',
          gameVersion: 'poe1',
          name: 'Bad',
          groupId: 'f-1',
          folderId: 'f-2',
          order: 0,
        },
      ],
    };

    // Validator rejects
    expect(isBookmarkCollectionState(contradictoryState)).toBe(false);
    expect(isBookmarkCollectionStateV3(contradictoryState)).toBe(false);

    // Module creation fails closed
    expect(() => createBookmarkCollectionModule(contradictoryState)).toThrow(
      /Ambiguous bookmark ownership: folderId and groupId must not contradict/,
    );

    // Storage loader fails closed
    expect(
      loadBookmarkCollectionFromStorage({
        [BOOKMARK_COLLECTION_STATE_KEY]: contradictoryState,
      }),
    ).toEqual({ state: undefined, migrated: false });
  });

  // 21. getFolderPathNames 與 formatFolderPath 產生完整 ancestor breadcrumb path
  it('21. produces ancestor path names and formatted breadcrumb string', () => {
    const folders: BookmarkFolder[] = [
      { id: 'f-equip', gameVersion: 'poe1', name: '裝備', order: 0 },
      { id: 'f-weapon', gameVersion: 'poe1', name: '武器', order: 0, parentId: 'f-equip' },
      { id: 'f-bow', gameVersion: 'poe1', name: '弓', order: 0, parentId: 'f-weapon' },
      { id: 'f-other', gameVersion: 'poe1', name: '追蹤', order: 1 },
      { id: 'f-other-bow', gameVersion: 'poe1', name: '弓', order: 0, parentId: 'f-other' },
    ];

    expect(getFolderPathNames(folders, 'f-equip')).toEqual(['裝備']);
    expect(formatFolderPath(folders, 'f-equip')).toBe('裝備');

    expect(getFolderPathNames(folders, 'f-weapon')).toEqual(['裝備', '武器']);
    expect(formatFolderPath(folders, 'f-weapon')).toBe('裝備 / 武器');

    expect(getFolderPathNames(folders, 'f-bow')).toEqual(['裝備', '武器', '弓']);
    expect(formatFolderPath(folders, 'f-bow')).toBe('裝備 / 武器 / 弓');

    expect(getFolderPathNames(folders, 'f-other-bow')).toEqual(['追蹤', '弓']);
    expect(formatFolderPath(folders, 'f-other-bow')).toBe('追蹤 / 弓');

    // Unknown folder returns empty array / empty string
    expect(getFolderPathNames(folders, 'f-unknown')).toEqual([]);
    expect(formatFolderPath(folders, 'f-unknown')).toBe('');
  });

  // 22. folder-scoped replace-bookmark-league 涵蓋整個 subtree（含所有 descendant folders）
  it('22. updates league for all bookmarks across the folder subtree during replace-bookmark-league', async () => {
    const { coordinator } = await setupCoordinator();
    const client = messagingClient(coordinator);

    // Root folder: Equipment
    await client.putGroup({ id: 'f-equip', name: '裝備', order: 0 });
    // Child folder: Weapon
    await client.putGroup({ id: 'f-weapon', name: '武器', order: 0, parentId: 'f-equip' });
    // Grandchild folder: Bow
    await client.putGroup({ id: 'f-bow', name: '弓', order: 0, parentId: 'f-weapon' });
    // Unrelated root folder: Consumables
    await client.putGroup({ id: 'f-other', name: '消耗品', order: 1 });

    // Bookmark directly in Equipment
    await client.putBookmark({
      id: 'bm-equip',
      name: 'Equip Item',
      url: 'https://www.pathofexile.com/trade/search/Standard/eq1',
      groupId: 'f-equip',
      order: 0,
    });
    // Bookmark in Weapon (child)
    await client.putBookmark({
      id: 'bm-weapon',
      name: 'Weapon Item',
      url: 'https://www.pathofexile.com/trade/search/Standard/wp1',
      groupId: 'f-weapon',
      order: 0,
    });
    // Bookmark in Bow (grandchild)
    await client.putBookmark({
      id: 'bm-bow',
      name: 'Bow Item',
      url: 'https://www.pathofexile.com/trade/search/Standard/bw1',
      groupId: 'f-bow',
      order: 0,
    });
    // Bookmark in unrelated folder
    await client.putBookmark({
      id: 'bm-other',
      name: 'Flask Item',
      url: 'https://www.pathofexile.com/trade/search/Standard/fl1',
      groupId: 'f-other',
      order: 0,
    });

    // Replace league targeting 'f-equip' folder scope with 'Settlers'
    const outcome = await client.replaceLeague('folder', 'Settlers', 'f-equip');
    expect(outcome.ok).toBe(true);

    const collection = await client.readCollection();
    expect(collection.ok).toBe(true);
    if (!collection.ok) return;

    const bms = new Map(collection.value.bookmarks.map((b) => [b.id, b.url]));

    // All subtree bookmarks (root, child, grandchild) have been updated to Settlers
    expect(bms.get('bm-equip')).toBe('https://www.pathofexile.com/trade/search/Settlers/eq1');
    expect(bms.get('bm-weapon')).toBe('https://www.pathofexile.com/trade/search/Settlers/wp1');
    expect(bms.get('bm-bow')).toBe('https://www.pathofexile.com/trade/search/Settlers/bw1');

    // Unrelated bookmark remains in Standard
    expect(bms.get('bm-other')).toBe('https://www.pathofexile.com/trade/search/Standard/fl1');
  });

  it('23. fails closed when replace-bookmark-league in folder scope is missing groupId or target folder does not exist', async () => {
    const { coordinator } = await setupCoordinator();
    const client = messagingClient(coordinator);

    await client.putGroup({ id: 'f-root', name: 'Root', order: 0 });
    await client.putBookmark({
      id: 'bm-1',
      name: 'Item 1',
      url: 'https://www.pathofexile.com/trade/search/Standard/item1',
      groupId: 'f-root',
      order: 0,
    });

    // 1. Missing groupId in folder scope -> fail-closed (no-op, does not affect bookmarks)
    const missingOutcome = await client.replaceLeague('folder', 'Settlers', undefined);
    expect(missingOutcome.ok).toBe(true);

    let collection = await client.readCollection();
    expect(collection.ok).toBe(true);
    if (!collection.ok) return;
    expect(collection.value.bookmarks[0].url).toBe(
      'https://www.pathofexile.com/trade/search/Standard/item1',
    );

    // 2. Nonexistent groupId in folder scope -> fail-closed (no-op, does not affect bookmarks)
    const nonexistentOutcome = await client.replaceLeague('folder', 'Settlers', 'f-nonexistent');
    expect(nonexistentOutcome.ok).toBe(true);

    collection = await client.readCollection();
    expect(collection.ok).toBe(true);
    if (!collection.ok) return;
    expect(collection.value.bookmarks[0].url).toBe(
      'https://www.pathofexile.com/trade/search/Standard/item1',
    );
  });

  it('24. updates all bookmarks across folders when replace-bookmark-league is collection scope', async () => {
    const { coordinator } = await setupCoordinator();
    const client = messagingClient(coordinator);

    await client.putGroup({ id: 'f-1', name: 'Group 1', order: 0 });
    await client.putGroup({ id: 'f-2', name: 'Group 2', order: 1 });
    await client.putBookmark({
      id: 'bm-1',
      name: 'Item 1',
      url: 'https://www.pathofexile.com/trade/search/Standard/item1',
      groupId: 'f-1',
      order: 0,
    });
    await client.putBookmark({
      id: 'bm-2',
      name: 'Item 2',
      url: 'https://www.pathofexile.com/trade/search/Standard/item2',
      groupId: 'f-2',
      order: 0,
    });

    const outcome = await client.replaceLeague('collection', 'Settlers');
    expect(outcome.ok).toBe(true);

    const collection = await client.readCollection();
    expect(collection.ok).toBe(true);
    if (!collection.ok) return;

    expect(collection.value.bookmarks.map((b) => b.url)).toEqual([
      'https://www.pathofexile.com/trade/search/Settlers/item1',
      'https://www.pathofexile.com/trade/search/Settlers/item2',
    ]);
    expect(collection.value.bookmarks.every((b) => b.leaguePinned === true)).toBe(true);
  });

  it('25. switching to the Auto league unpins bookmarks without rewriting their Search Records', async () => {
    const { coordinator } = await setupCoordinator();
    const client = messagingClient(coordinator);

    await client.putGroup({ id: 'f-1', name: 'Group 1', order: 0 });
    await client.putBookmark({
      id: 'bm-1',
      name: 'Item 1',
      url: 'https://www.pathofexile.com/trade/search/Standard/item1',
      groupId: 'f-1',
      order: 0,
    });
    expect((await client.replaceLeague('collection', 'Hardcore')).ok).toBe(true);

    const pinned = await client.readCollection();
    if (!pinned.ok) throw new Error('read failed');
    expect(pinned.value.bookmarks[0]).toMatchObject({
      leaguePinned: true,
      url: 'https://www.pathofexile.com/trade/search/Hardcore/item1',
    });

    expect((await client.replaceLeague('collection', 'Auto')).ok).toBe(true);
    const auto = await client.readCollection();
    if (!auto.ok) throw new Error('read failed');
    expect(auto.value.bookmarks[0].leaguePinned).toBeUndefined();
    expect(auto.value.bookmarks[0].url).toBe(
      'https://www.pathofexile.com/trade/search/Hardcore/item1',
    );
  });

  it('26. persists leaguePinned provided through put-bookmark', async () => {
    const { coordinator } = await setupCoordinator();
    const client = messagingClient(coordinator);

    await client.putGroup({ id: 'f-1', name: 'Group 1', order: 0 });
    await client.putBookmark({
      id: 'bm-1',
      name: 'Item 1',
      url: 'https://www.pathofexile.com/trade/search/Standard/item1',
      groupId: 'f-1',
      order: 0,
      leaguePinned: true,
    });
    const read = await client.readCollection();
    if (!read.ok) throw new Error('read failed');
    expect(read.value.bookmarks[0].leaguePinned).toBe(true);
  });
});
