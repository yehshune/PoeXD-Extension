import { describe, expect, it } from 'vitest';
import {
  createInMemorySearchRecordStorage,
  createSearchRecordModule,
} from '@/utils/search-records';
import {
  createBackgroundBookmarkCoordinator,
  createInMemoryBookmarkCoordinatorStorage,
  type BookmarkCoordinator,
  type BookmarkCoordinatorStorage,
} from '@/utils/bookmark-coordinator';
import { createBookmarkClient } from '@/utils/bookmark-messaging';

const group = { id: 'group-1', name: 'Favorites', order: 0 };
const firstUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIid-1';
const secondUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIid-2';

async function setup(
  storage: BookmarkCoordinatorStorage = createInMemoryBookmarkCoordinatorStorage(),
) {
  const searchRecords = createSearchRecordModule(createInMemorySearchRecordStorage());
  await searchRecords.initialize();
  const coordinator = createBackgroundBookmarkCoordinator(searchRecords, storage);
  await coordinator.initialize();
  return { searchRecords, coordinator };
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

describe('Bookmark background coordinator messaging seam', () => {
  it('exports collection and folder Bookmark Transfers without internal identities', async () => {
    const { coordinator } = await setup();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putBookmark({
      id: 'bookmark-1',
      name: 'Covered',
      url: firstUrl,
      groupId: group.id,
      order: 0,
      coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
    });
    await client.putBookmark({
      id: 'bookmark-2',
      name: 'Loose',
      url: secondUrl,
      groupId: group.id,
      order: 1,
    });

    expect(await client.exportTransfer('collection')).toEqual({
      ok: true,
      value: {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [
          {
            name: 'Favorites',
            bookmarks: [
              {
                name: 'Covered',
                url: firstUrl,
                coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
              },
              { name: 'Loose', url: secondUrl },
            ],
          },
        ],
      },
    });
    expect(await client.exportTransfer('folder', group.id)).toEqual({
      ok: true,
      value: {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'folder',
        folders: [
          {
            name: 'Favorites',
            bookmarks: [
              {
                name: 'Covered',
                url: firstUrl,
                coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
              },
              { name: 'Loose', url: secondUrl },
            ],
          },
        ],
      },
    });
  });

  it('merges a Bookmark Transfer by folder and canonical URL while filling a missing cover', async () => {
    const { coordinator } = await setup();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putBookmark({
      id: 'existing-bookmark',
      name: 'Existing',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });

    expect(
      await client.importTransfer(
        {
          kind: 'poexd-bookmarks',
          schemaVersion: 2,
          gameVersion: 'poe1',
          scope: 'collection',
          folders: [
            {
              name: 'Favorites',
              bookmarks: [
                {
                  name: 'Existing',
                  url: firstUrl,
                  coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
                },
                { name: 'New', url: secondUrl },
              ],
            },
          ],
        },
        'merge',
      ),
    ).toEqual({ ok: true, changed: true });

    const collection = await client.readCollection();
    expect(collection.ok && collection.value.groups.map((item) => item.name)).toEqual([
      'Favorites',
    ]);
    expect(collection.ok && collection.value.bookmarks).toEqual([
      expect.objectContaining({
        id: 'existing-bookmark',
        name: 'Existing',
        coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
      }),
      expect.objectContaining({ name: 'New', url: secondUrl }),
    ]);
  });

  it('does not change existing Search Record timestamps during a Transfer merge', async () => {
    const { searchRecords, coordinator } = await setup();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putBookmark({
      id: 'existing-bookmark',
      name: 'Existing',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });
    const before = await searchRecords.read({ type: 'get-state' });

    await client.importTransfer(
      {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [
          {
            name: 'Favorites',
            bookmarks: [
              {
                name: 'Existing',
                url: firstUrl,
                coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
              },
            ],
          },
        ],
      },
      'merge',
    );

    const after = await searchRecords.read({ type: 'get-state' });
    expect(after.ok && before.ok && after.value.searchRecords).toEqual(
      before.ok && before.value.searchRecords,
    );
  });

  it('overwrites only the selected folder for a folder-scoped Bookmark Transfer', async () => {
    const { coordinator } = await setup();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putGroup({ id: 'group-2', name: 'Keep', order: 1 });
    await client.putBookmark({
      id: 'old',
      name: 'Old',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });
    await client.putBookmark({
      id: 'keep',
      name: 'Keep',
      url: firstUrl,
      groupId: 'group-2',
      order: 0,
    });
    expect(
      await client.importTransfer(
        {
          kind: 'poexd-bookmarks',
          schemaVersion: 2,
          gameVersion: 'poe1',
          scope: 'folder',
          folders: [{ name: 'Favorites', bookmarks: [{ name: 'Replacement', url: secondUrl }] }],
        },
        'replace',
      ),
    ).toEqual({ ok: true, changed: true });

    const collection = await client.readCollection();
    expect(collection.ok && collection.value.groups.map((item) => item.name)).toEqual([
      'Favorites',
      'Keep',
    ]);
    expect(collection.ok && collection.value.bookmarks.map((item) => item.name).sort()).toEqual([
      'Keep',
      'Replacement',
    ]);
  });

  it('serializes granular changes from concurrent tabs without losing either Bookmark', async () => {
    const { coordinator } = await setup();
    const firstTab = messagingClient(coordinator);
    const secondTab = messagingClient(coordinator);

    await firstTab.putGroup(group);
    const [first, second] = await Promise.all([
      firstTab.putBookmark({
        id: 'bookmark-1',
        name: 'First',
        url: firstUrl,
        groupId: group.id,
        order: 0,
      }),
      secondTab.putBookmark({
        id: 'bookmark-2',
        name: 'Second',
        url: secondUrl,
        groupId: group.id,
        order: 1,
      }),
    ]);

    expect(first).toEqual({ ok: true, changed: true });
    expect(second).toEqual({ ok: true, changed: true });
    const collection = await firstTab.readCollection();
    expect(collection.ok && collection.value.bookmarks.map((item) => item.name).sort()).toEqual([
      'First',
      'Second',
    ]);
  });

  it('replaces the league only for Bookmarks in the selected Bookmark Group', async () => {
    const { coordinator } = await setup();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putGroup({ id: 'group-2', name: 'Keep', order: 1 });
    await client.putBookmark({
      id: 'replace',
      name: 'Replace',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });
    await client.putBookmark({
      id: 'keep',
      name: 'Keep',
      url: secondUrl,
      groupId: 'group-2',
      order: 0,
    });

    expect(await client.replaceLeague('folder', 'Hardcore Allflame', group.id)).toEqual({
      ok: true,
      changed: true,
    });

    const collection = await client.readCollection();
    expect(
      collection.ok && collection.value.bookmarks.find((item) => item.id === 'replace')?.url,
    ).toBe('https://www.pathofexile.com/trade/search/Hardcore%20Allflame/H4sIid-1');
    expect(
      collection.ok && collection.value.bookmarks.find((item) => item.id === 'keep')?.url,
    ).toBe(secondUrl);
  });

  it('commits neither collection nor reference and publishes nothing when coordinated storage fails', async () => {
    const durable = createInMemoryBookmarkCoordinatorStorage();
    let failCoordinatedCommit = false;
    const storage: BookmarkCoordinatorStorage = {
      load: () => durable.load(),
      commitBookmarks: (state) => durable.commitBookmarks(state),
      async commitCoordinated(searchState, bookmarkState) {
        if (failCoordinatedCommit) throw new Error('quota exceeded');
        await durable.commitCoordinated(searchState, bookmarkState);
      },
    };
    const { searchRecords, coordinator } = await setup(storage);
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    failCoordinatedCommit = true;
    let changes = 0;
    client.subscribe(() => {
      changes += 1;
    });

    expect(
      await client.putBookmark({
        id: 'bookmark-1',
        name: 'Must not appear',
        url: firstUrl,
        groupId: group.id,
        order: 0,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'storage-failure', message: 'quota exceeded' },
    });
    expect(await client.readCollection()).toEqual({
      ok: true,
      value: {
        groups: [{ ...group, gameVersion: 'poe1' }],
        bookmarks: [],
      },
    });
    expect(
      await searchRecords.read({
        type: 'get-search-record',
        identity: { gameVersion: 'poe1', url: firstUrl },
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(changes).toBe(0);
  });

  it('leaves both modules unavailable when their initial legacy migration cannot commit atomically', async () => {
    const legacy = {
      bookmarks_poe1: [
        {
          id: 'bookmark-1',
          name: 'Legacy',
          url: firstUrl,
          groupId: 'group-1',
        },
      ],
      bookmarkGroups_poe1: [group],
    };
    const searchRecords = createSearchRecordModule(createInMemorySearchRecordStorage(legacy));
    const durable: Record<string, unknown> = structuredClone(legacy);
    const storage: BookmarkCoordinatorStorage = {
      async load() {
        return { state: undefined };
      },
      async commitBookmarks() {
        throw new Error('must use coordinated initialization');
      },
      async commitCoordinated() {
        throw new Error('disk unavailable');
      },
    };
    const coordinator = createBackgroundBookmarkCoordinator(searchRecords, storage);

    expect(await coordinator.initialize()).toEqual({
      ok: false,
      error: { code: 'storage-failure', message: 'disk unavailable' },
    });
    expect(await searchRecords.read({ type: 'get-state' })).toEqual({
      ok: false,
      error: { code: 'not-initialized', message: 'Search Record module is not initialized' },
    });
    expect(durable).toEqual(legacy);
    expect(await coordinator.read({ type: 'get-collection', gameVersion: 'poe1' })).toEqual({
      ok: false,
      error: { code: 'not-initialized', message: 'Bookmark coordinator is not initialized' },
    });
  });

  it('deletes a group and its references atomically without deleting a history-retained record', async () => {
    const { searchRecords, coordinator } = await setup();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putBookmark({
      id: 'bookmark-1',
      name: 'First',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });
    await searchRecords.execute({
      type: 'record-history',
      identity: { gameVersion: 'poe1', url: firstUrl },
      entry: { name: 'History', url: firstUrl },
    });

    await client.deleteGroup(group.id);

    expect(await client.readCollection()).toEqual({
      ok: true,
      value: { groups: [], bookmarks: [] },
    });
    expect(
      await searchRecords.read({
        type: 'get-search-record',
        identity: { gameVersion: 'poe1', url: firstUrl },
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({ url: firstUrl }),
    });
  });

  it('durably commits a collection rename even when its Search Record reference is unchanged', async () => {
    const searchRecords = createSearchRecordModule(createInMemorySearchRecordStorage(), () => 1);
    await searchRecords.initialize();
    const storage = createInMemoryBookmarkCoordinatorStorage();
    const coordinator = createBackgroundBookmarkCoordinator(searchRecords, storage);
    await coordinator.initialize();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putBookmark({
      id: 'bookmark-1',
      name: 'Before',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });
    await client.putBookmark({
      id: 'bookmark-1',
      name: 'After',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });

    const restarted = createBackgroundBookmarkCoordinator(searchRecords, storage);
    await restarted.initialize();
    const reloaded = await messagingClient(restarted).readCollection();
    expect(reloaded.ok && reloaded.value.bookmarks[0].name).toBe('After');
  });

  it('starts with an empty V2 collection instead of migrating legacy Bookmarks', async () => {
    const legacy = {
      bookmarks_poe1: [
        {
          id: 'bookmark-1',
          name: 'Recovered',
          url: firstUrl,
          groupId: 'missing-group',
        },
      ],
    };
    const searchRecords = createSearchRecordModule(createInMemorySearchRecordStorage(legacy));
    await searchRecords.initialize();
    const coordinator = createBackgroundBookmarkCoordinator(
      searchRecords,
      createInMemoryBookmarkCoordinatorStorage(legacy),
    );
    await coordinator.initialize();

    const collection = await messagingClient(coordinator).readCollection();
    expect(collection.ok && collection.value).toEqual({ groups: [], bookmarks: [] });
  });

  it('rejects a V2 collection containing a Bookmark without a valid folder', async () => {
    const storage = createInMemoryBookmarkCoordinatorStorage({
      poexdBookmarkCollectionStateV2: {
        schemaVersion: 2,
        groups: [],
        bookmarks: [
          {
            id: 'orphan',
            gameVersion: 'poe1',
            name: 'Orphan',
            groupId: 'missing',
            order: 0,
          },
        ],
      },
    });
    const { coordinator } = await setup(storage);

    expect(await messagingClient(coordinator).readCollection()).toEqual({
      ok: true,
      value: { groups: [], bookmarks: [] },
    });
  });

  it('rejects reorder-bookmarks with duplicate placement IDs instead of silent last-write-wins', async () => {
    const { coordinator } = await setup();
    const client = messagingClient(coordinator);
    await client.putGroup(group);
    await client.putBookmark({
      id: 'bookmark-1',
      name: 'One',
      url: firstUrl,
      groupId: group.id,
      order: 0,
    });
    const result = await client.reorderBookmarks([
      { id: 'bookmark-1', groupId: group.id, order: 0 },
      { id: 'bookmark-1', groupId: group.id, order: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Duplicate bookmark ID in reorder placements');
    }
  });

  it('enforces canonical name length limit: accepts 200-char names and rejects 201-char/empty names', async () => {
    const { coordinator } = await setup();
    const client = messagingClient(coordinator);

    const valid200Name = 'B'.repeat(200);
    const invalid201Name = 'B'.repeat(201);

    // 1. 200 chars folder name: accepted
    const group200Outcome = await client.putGroup({
      id: 'group-200',
      name: valid200Name,
      order: 0,
    });
    expect(group200Outcome.ok).toBe(true);

    // 2. 200 chars bookmark name: accepted
    const bm200Outcome = await client.putBookmark({
      id: 'bm-200',
      name: valid200Name,
      url: firstUrl,
      groupId: 'group-200',
      order: 0,
    });
    expect(bm200Outcome.ok).toBe(true);

    // 3. Valid collection with 200-char names must pass exportTransfer
    const exportResult = await client.exportTransfer('collection');
    expect(exportResult.ok).toBe(true);
    if (exportResult.ok) {
      expect(exportResult.value.folders[0].name).toBe(valid200Name);
      expect(exportResult.value.folders[0].bookmarks[0].name).toBe(valid200Name);
    }

    // 4. 201 chars folder name: rejected
    const group201Outcome = await client.putGroup({
      id: 'group-201',
      name: invalid201Name,
      order: 1,
    });
    expect(group201Outcome.ok).toBe(false);

    // 5. 201 chars bookmark name: rejected
    const bm201Outcome = await client.putBookmark({
      id: 'bm-201',
      name: invalid201Name,
      url: secondUrl,
      groupId: 'group-200',
      order: 1,
    });
    expect(bm201Outcome.ok).toBe(false);

    // 6. Empty / whitespace-only folder name: rejected
    const emptyGroupOutcome = await client.putGroup({ id: 'group-empty', name: '   ', order: 1 });
    expect(emptyGroupOutcome.ok).toBe(false);

    // 7. Verify collection state was not polluted by rejected mutations
    const collectionResult = await client.readCollection();
    expect(collectionResult.ok).toBe(true);
    if (collectionResult.ok) {
      expect(
        collectionResult.value.groups.some((g) => g.id === 'group-201' || g.id === 'group-empty'),
      ).toBe(false);
      expect(collectionResult.value.bookmarks.some((b) => b.id === 'bm-201')).toBe(false);
    }
  });

  describe('Bookmark collection clear-collection contract', () => {
    it('clears all root and nested folders and bookmarks for current gameVersion without affecting the other gameVersion', async () => {
      const { coordinator } = await setup();
      const poe1Client = messagingClient(coordinator);
      const poe2Client = createBookmarkClient(
        {
          execute: (command) => coordinator.execute(command),
          read: (read) => coordinator.read(read),
          subscribeBookmarkChange: (listener) => coordinator.subscribe(listener),
        },
        'poe2',
      );

      await poe1Client.putGroup({ id: 'root-1', name: 'Root Folder', order: 0 });
      await poe1Client.putGroup({
        id: 'child-1',
        name: 'Child Folder',
        parentId: 'root-1',
        order: 0,
      });
      await poe1Client.putBookmark({
        id: 'bm-root',
        name: 'Root Bookmark',
        url: firstUrl,
        groupId: 'root-1',
        order: 0,
      });
      await poe1Client.putBookmark({
        id: 'bm-child',
        name: 'Child Bookmark',
        url: secondUrl,
        groupId: 'child-1',
        order: 0,
      });

      const poe2Url = 'https://www.pathofexile.com/trade2/search/poe2/Standard/H4sIid-poe2';
      await poe2Client.putGroup({ id: 'poe2-root', name: 'PoE2 Folder', order: 0 });
      await poe2Client.putBookmark({
        id: 'poe2-bm',
        name: 'PoE2 Bookmark',
        url: poe2Url,
        groupId: 'poe2-root',
        order: 0,
      });

      const outcome = await poe1Client.clearCollection();
      expect(outcome).toEqual({ ok: true, changed: true });

      const poe1Read = await poe1Client.readCollection();
      expect(poe1Read).toEqual({
        ok: true,
        value: { groups: [], bookmarks: [] },
      });

      const poe2Read = await poe2Client.readCollection();
      expect(poe2Read.ok).toBe(true);
      if (poe2Read.ok) {
        expect(poe2Read.value.groups.map((g) => g.id)).toEqual(['poe2-root']);
        expect(poe2Read.value.bookmarks.map((b) => b.id)).toEqual(['poe2-bm']);
      }
    });

    it('removes bookmark references while retaining SearchRecord if still referenced by History', async () => {
      const { searchRecords, coordinator } = await setup();
      const client = messagingClient(coordinator);

      await client.putGroup(group);
      await client.putBookmark({
        id: 'bm-history',
        name: 'Bookmark in History',
        url: firstUrl,
        groupId: group.id,
        order: 0,
      });

      await searchRecords.execute({
        type: 'record-history',
        identity: { gameVersion: 'poe1', url: firstUrl },
        entry: {
          name: 'History Visit',
          url: firstUrl,
        },
      });

      const clearResult = await client.clearCollection();
      expect(clearResult.ok).toBe(true);

      const bookmarkRecords = await searchRecords.read({
        type: 'get-bookmark-records',
        gameVersion: 'poe1',
      });
      expect(bookmarkRecords.ok).toBe(true);
      if (bookmarkRecords.ok) {
        expect(bookmarkRecords.value).toEqual([]);
      }

      const recordOutcome = await searchRecords.read({
        type: 'get-search-record',
        identity: { gameVersion: 'poe1', url: firstUrl },
      });
      expect(recordOutcome.ok).toBe(true);
      if (recordOutcome.ok) {
        expect(recordOutcome.value).toBeDefined();
        expect(recordOutcome.value?.url).toBe(firstUrl);
      }

      const historyView = await searchRecords.read({
        type: 'get-history-view',
        gameVersion: 'poe1',
      });
      expect(historyView.ok).toBe(true);
      if (historyView.ok) {
        expect(historyView.value.length).toBe(1);
        expect(historyView.value[0].url).toBe(firstUrl);
      }
    });

    it('commits neither collection nor reference and publishes no change when coordinated storage fails during clear', async () => {
      const durable = createInMemoryBookmarkCoordinatorStorage();
      let failCoordinatedCommit = false;
      const storage: BookmarkCoordinatorStorage = {
        load: () => durable.load(),
        commitBookmarks: (state) => durable.commitBookmarks(state),
        async commitCoordinated(searchState, bookmarkState) {
          if (failCoordinatedCommit) throw new Error('disk failure');
          await durable.commitCoordinated(searchState, bookmarkState);
        },
      };
      const { searchRecords, coordinator } = await setup(storage);
      const client = messagingClient(coordinator);

      await client.putGroup(group);
      await client.putBookmark({
        id: 'bm-safe',
        name: 'Safe Bookmark',
        url: firstUrl,
        groupId: group.id,
        order: 0,
      });

      failCoordinatedCommit = true;
      let changes = 0;
      client.subscribe(() => {
        changes += 1;
      });

      const clearOutcome = await client.clearCollection();
      expect(clearOutcome).toEqual({
        ok: false,
        error: { code: 'storage-failure', message: 'disk failure' },
      });
      expect(changes).toBe(0);

      const collection = await client.readCollection();
      expect(collection.ok).toBe(true);
      if (collection.ok) {
        expect(collection.value.groups.length).toBe(1);
        expect(collection.value.bookmarks.length).toBe(1);
      }

      const bookmarkRecords = await searchRecords.read({
        type: 'get-bookmark-records',
        gameVersion: 'poe1',
      });
      expect(bookmarkRecords.ok).toBe(true);
      if (bookmarkRecords.ok) {
        expect(bookmarkRecords.value.length).toBe(1);
        expect(bookmarkRecords.value[0].reference.id).toBe('bm-safe');
      }
    });

    it('publishes exactly one logical change upon successful clear-collection', async () => {
      const { coordinator } = await setup();
      const client = messagingClient(coordinator);

      await client.putGroup(group);
      await client.putBookmark({
        id: 'bm-1',
        name: 'BM 1',
        url: firstUrl,
        groupId: group.id,
        order: 0,
      });
      await client.putBookmark({
        id: 'bm-2',
        name: 'BM 2',
        url: secondUrl,
        groupId: group.id,
        order: 1,
      });

      const coordinatorChanges: any[] = [];
      coordinator.subscribe((change) => {
        coordinatorChanges.push(change);
      });
      let clientNotified = 0;
      client.subscribe(() => {
        clientNotified += 1;
      });

      const outcome = await client.clearCollection();
      expect(outcome).toEqual({ ok: true, changed: true });
      expect(coordinatorChanges.length).toBe(1);
      expect(coordinatorChanges[0].command).toEqual({
        type: 'clear-collection',
        gameVersion: 'poe1',
      });
      expect(clientNotified).toBe(1);
    });
  });
});
