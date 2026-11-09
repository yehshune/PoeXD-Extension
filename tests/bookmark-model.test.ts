import { describe, expect, it, vi } from 'vitest';
import { createBookmarkModel } from '@/components/sidebar/bookmark-model';
import type { BookmarkClient } from '@/utils/bookmark-messaging';
import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';

const initialView: BookmarkCollectionView = {
  groups: [{ id: 'group-1', gameVersion: 'poe1', name: 'Favorites', order: 0 }],
  bookmarks: [
    {
      id: 'bookmark-1',
      gameVersion: 'poe1',
      searchRecordId: 'record-1',
      name: 'Bow',
      url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
      groupId: 'group-1',
      order: 0,
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setupClient(view = initialView) {
  let liveView = structuredClone(view);
  const listeners = new Set<() => void>();
  const client = {
    readCollection: vi.fn(async () => ({ ok: true as const, value: structuredClone(liveView) })),
    putGroup: vi.fn(async () => ({ ok: true as const, changed: true })),
    deleteGroup: vi.fn(async () => ({ ok: true as const, changed: true })),
    reorderGroups: vi.fn(async () => ({ ok: true as const, changed: true })),
    putBookmark: vi.fn(async () => ({ ok: true as const, changed: true })),
    deleteBookmark: vi.fn(async () => ({ ok: true as const, changed: true })),
    reorderBookmarks: vi.fn(async () => ({ ok: true as const, changed: true })),
    replaceLeague: vi.fn(async () => ({ ok: true as const, changed: true })),
    exportTransfer: vi.fn(),
    importTransfer: vi.fn(async () => ({ ok: true as const, changed: true })),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as BookmarkClient;
  return {
    client,
    emit() {
      listeners.forEach((listener) => listener());
    },
    setView(next: BookmarkCollectionView) {
      liveView = structuredClone(next);
    },
  };
}

describe('Bookmark pane model interface', () => {
  it('projects Auto bookmarks onto the current origin and league but writes back the canonical URL', async () => {
    const adapter = setupClient({
      ...initialView,
      bookmarks: [
        initialView.bookmarks[0],
        {
          ...initialView.bookmarks[0],
          id: 'bookmark-2',
          searchRecordId: 'record-2',
          name: 'Pinned',
          url: 'https://www.pathofexile.com/trade/search/Hardcore/id-2',
          order: 1,
          leaguePinned: true,
        },
      ],
    });
    let context = { origin: 'https://poe.game.qq.com', league: 'S29' };
    const model = createBookmarkModel(adapter.client, { resolveTargetContext: () => context });
    await model.connect();

    expect(model.state.value.bookmarks.map((bookmark) => bookmark.url)).toEqual([
      'https://poe.game.qq.com/trade/search/S29/id-1',
      'https://poe.game.qq.com/trade/search/Hardcore/id-2',
    ]);

    context = { origin: 'https://www.pathofexile.com', league: 'Settlers' };
    model.refreshTargetContext();
    expect(model.state.value.bookmarks[0].url).toBe(
      'https://www.pathofexile.com/trade/search/Settlers/id-1',
    );

    await model.execute({ type: 'rename-bookmark', bookmarkId: 'bookmark-2', name: 'Renamed' });
    expect(adapter.client.putBookmark).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'bookmark-2',
        name: 'Renamed',
        url: 'https://www.pathofexile.com/trade/search/Hardcore/id-2',
        leaguePinned: true,
      }),
    );
  });

  it('loads the canonical projection and reconciles committed external changes', async () => {
    const adapter = setupClient();
    const model = createBookmarkModel(adapter.client);

    expect(await model.connect()).toEqual({ ok: true, value: undefined });
    expect(model.state.value.groups.map((group) => group.name)).toEqual(['Favorites']);

    adapter.setView({
      ...initialView,
      groups: [{ ...initialView.groups[0], name: 'Renamed elsewhere' }],
    });
    adapter.emit();
    await vi.waitFor(() => expect(model.state.value.groups[0].name).toBe('Renamed elsewhere'));
  });

  it('optimistically deletes a group with one background command', async () => {
    const adapter = setupClient();
    const commit = deferred<{ ok: true; changed: boolean }>();
    vi.mocked(adapter.client.deleteGroup).mockImplementation(async () => commit.promise);
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    const outcome = model.execute({ type: 'delete-group', groupId: 'group-1' });
    expect(model.state.value.groups).toEqual([]);
    expect(model.state.value.bookmarks).toEqual([]);
    expect(adapter.client.deleteBookmark).not.toHaveBeenCalled();

    adapter.setView({ groups: [], bookmarks: [] });
    commit.resolve({ ok: true, changed: true });
    await expect(outcome).resolves.toEqual({ ok: true, value: undefined });
    expect(adapter.client.deleteGroup).toHaveBeenCalledOnce();
  });

  it('rolls back a failed optimistic intent and returns the typed error', async () => {
    const adapter = setupClient();
    vi.mocked(adapter.client.putGroup).mockResolvedValue({
      ok: false,
      error: { code: 'storage-failure', message: 'disk full' },
    });
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    const outcome = model.execute({ type: 'rename-group', groupId: 'group-1', name: 'Broken' });
    expect(model.state.value.groups[0].name).toBe('Broken');

    await expect(outcome).resolves.toEqual({
      ok: false,
      error: { code: 'storage-failure', message: 'disk full' },
    });
    expect(model.state.value.groups[0].name).toBe('Favorites');
  });

  it('keeps the UI Search Record reference behind the model seam', async () => {
    const adapter = setupClient();
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    await model.execute({ type: 'rename-bookmark', bookmarkId: 'bookmark-1', name: 'Renamed' });

    expect(adapter.client.putBookmark).toHaveBeenCalledWith({
      id: 'bookmark-1',
      name: 'Renamed',
      url: initialView.bookmarks[0].url,
      groupId: 'group-1',
      order: 0,
    });
  });

  it('moves a Bookmark with a placement command instead of a stale full write', async () => {
    const adapter = setupClient();
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    await model.execute({ type: 'move-bookmark', bookmarkId: 'bookmark-1', groupId: 'group-2' });

    expect(adapter.client.reorderBookmarks).toHaveBeenCalledWith([
      {
        id: 'bookmark-1',
        groupId: 'group-2',
        order: 0,
      },
    ]);
    expect(adapter.client.putBookmark).not.toHaveBeenCalled();
  });

  it('replaces leagues for a Bookmark Group with one background command', async () => {
    const adapter = setupClient();
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    await model.execute({
      type: 'replace-league',
      scope: 'folder',
      groupId: 'group-1',
      league: 'Allflame',
    });

    expect(adapter.client.replaceLeague).toHaveBeenCalledWith('folder', 'Allflame', 'group-1');
    expect(adapter.client.putBookmark).not.toHaveBeenCalled();
  });

  it('exports through the model interface after queued mutations', async () => {
    const adapter = setupClient();
    const payload = {
      kind: 'poexd-bookmarks' as const,
      schemaVersion: 2 as const,
      gameVersion: 'poe1' as const,
      scope: 'collection' as const,
      folders: [],
    };
    vi.mocked(adapter.client.exportTransfer).mockResolvedValue({ ok: true, value: payload });
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    await expect(model.execute({ type: 'export-transfer', scope: 'collection' })).resolves.toEqual({
      ok: true,
      value: payload,
    });
  });

  it('reports a committed import whose canonical refresh failed and later reconciles', async () => {
    const adapter = setupClient();
    const importedView: BookmarkCollectionView = { groups: [], bookmarks: [] };
    const model = createBookmarkModel(adapter.client);
    await model.connect();
    vi.mocked(adapter.client.readCollection).mockResolvedValueOnce({
      ok: false,
      error: { code: 'unavailable', message: 'refresh failed' },
    });

    const outcome = await model.execute({
      type: 'import-transfer',
      mode: 'replace',
      payload: {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [],
      },
    });

    expect(outcome).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'refresh failed' },
    });
    expect(model.state.value.groups).toHaveLength(1);

    adapter.setView(importedView);
    adapter.emit();
    await vi.waitFor(() => expect(model.state.value.groups).toEqual([]));
  });

  it('waits for a fresh canonical read when an external reload predates a commit', async () => {
    const adapter = setupClient();
    const model = createBookmarkModel(adapter.client);
    await model.connect();
    const staleRead = deferred<{ ok: true; value: BookmarkCollectionView }>();
    const freshView = {
      ...initialView,
      groups: [{ ...initialView.groups[0], name: 'Committed' }],
    };
    vi.mocked(adapter.client.readCollection)
      .mockImplementationOnce(async () => staleRead.promise)
      .mockResolvedValue({ ok: true, value: freshView });

    adapter.emit();
    const outcome = model.execute({ type: 'rename-group', groupId: 'group-1', name: 'Committed' });
    await vi.waitFor(() => expect(adapter.client.putGroup).toHaveBeenCalledOnce());
    staleRead.resolve({ ok: true, value: initialView });

    await outcome;
    expect(adapter.client.readCollection).toHaveBeenCalledTimes(3);
    expect(model.state.value.groups[0].name).toBe('Committed');
  });

  it('serializes local intents and defers external reconciliation until each settles', async () => {
    const adapter = setupClient();
    const firstCommit = deferred<{ ok: true; changed: boolean }>();
    let active = 0;
    let maxActive = 0;
    vi.mocked(adapter.client.putGroup).mockImplementation(async (group) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (group.id === 'group-2') await firstCommit.promise;
      active -= 1;
      return { ok: true, changed: true };
    });
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    const add = model.execute({
      type: 'add-group',
      group: { id: 'group-2', name: 'Second', order: 1 },
    });
    const rename = model.execute({ type: 'rename-group', groupId: 'group-1', name: 'First' });
    expect(model.state.value.groups.map((group) => group.name)).toEqual(['First', 'Second']);
    adapter.emit();
    expect(adapter.client.readCollection).toHaveBeenCalledTimes(1);

    adapter.setView({
      ...initialView,
      groups: [
        ...initialView.groups,
        { id: 'group-2', gameVersion: 'poe1', name: 'Second', order: 1 },
      ],
    });
    firstCommit.resolve({ ok: true, changed: true });
    await add;
    adapter.setView({
      ...initialView,
      groups: [
        { ...initialView.groups[0], name: 'First' },
        { id: 'group-2', gameVersion: 'poe1', name: 'Second', order: 1 },
      ],
    });
    await rename;

    expect(maxActive).toBe(1);
    expect(adapter.client.putGroup).toHaveBeenCalledTimes(2);
    expect(model.state.value.groups.map((group) => group.name)).toEqual(['First', 'Second']);
  });

  it('stops reconciling external changes after dispose', async () => {
    const adapter = setupClient();
    const model = createBookmarkModel(adapter.client);
    await model.connect();
    model.dispose();
    adapter.setView({ ...initialView, groups: [] });

    adapter.emit();
    await Promise.resolve();

    expect(adapter.client.readCollection).toHaveBeenCalledOnce();
    expect(model.state.value.groups).toHaveLength(1);
  });

  it('rejects mutations exceeding canonical 200-char name limit without polluting optimistic state', async () => {
    const adapter = setupClient();
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    const tooLongName = 'Z'.repeat(201);

    // 1. rename-group with 201 chars
    const groupOutcome = await model.execute({
      type: 'rename-group',
      groupId: 'group-1',
      name: tooLongName,
    });
    expect(groupOutcome.ok).toBe(false);
    expect(adapter.client.putGroup).not.toHaveBeenCalled();
    expect(model.state.value.groups[0].name).toBe('Favorites');

    // 2. rename-bookmark with 201 chars
    const bmOutcome = await model.execute({
      type: 'rename-bookmark',
      bookmarkId: 'bookmark-1',
      name: tooLongName,
    });
    expect(bmOutcome.ok).toBe(false);
    expect(adapter.client.putBookmark).not.toHaveBeenCalled();
    expect(model.state.value.bookmarks[0].name).toBe('Bow');
  });

  it('retains parentId metadata on nested child folders and preserves hierarchy during rename', async () => {
    const hierarchicalView: BookmarkCollectionView = {
      groups: [
        { id: 'root-1', gameVersion: 'poe1', name: 'Root Folder', order: 0 },
        { id: 'child-1', gameVersion: 'poe1', name: 'Child Folder', order: 0, parentId: 'root-1' },
      ],
      bookmarks: [],
    };
    const adapter = setupClient(hierarchicalView);
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    // 1. Verify parentId is preserved on load
    const rootFolder = model.state.value.groups.find((g) => g.id === 'root-1');
    const childFolder = model.state.value.groups.find((g) => g.id === 'child-1');
    expect(rootFolder?.parentId).toBeUndefined();
    expect(childFolder?.parentId).toBe('root-1');

    // 2. Rename child folder - must retain parentId in putGroup call
    const outcome = await model.execute({
      type: 'rename-group',
      groupId: 'child-1',
      name: 'Renamed Child',
    });
    expect(outcome.ok).toBe(true);
    expect(adapter.client.putGroup).toHaveBeenCalledWith({
      id: 'child-1',
      name: 'Renamed Child',
      order: 0,
      parentId: 'root-1',
    });

    // 3. Rename root folder - must remain root (parentId undefined)
    const rootOutcome = await model.execute({
      type: 'rename-group',
      groupId: 'root-1',
      name: 'Renamed Root',
    });
    expect(rootOutcome.ok).toBe(true);
    expect(adapter.client.putGroup).toHaveBeenCalledWith({
      id: 'root-1',
      name: 'Renamed Root',
      order: 0,
    });
  });

  it('removes selected folder, all descendants, and subtree bookmarks in delete-group optimistic projection', async () => {
    const adapter = setupClient();
    adapter.setView({
      groups: [
        { id: 'root-1', gameVersion: 'poe1', name: 'Root 1', order: 0 },
        { id: 'child-1', gameVersion: 'poe1', name: 'Child 1', order: 0, parentId: 'root-1' },
        {
          id: 'grandchild-1',
          gameVersion: 'poe1',
          name: 'Grandchild 1',
          order: 0,
          parentId: 'child-1',
        },
        { id: 'unrelated-root', gameVersion: 'poe1', name: 'Unrelated Root', order: 1 },
      ],
      bookmarks: [
        {
          id: 'bm-root',
          gameVersion: 'poe1',
          searchRecordId: 'r1',
          name: 'Root BM',
          url: 'https://pathofexile.com/trade',
          groupId: 'root-1',
          order: 0,
        },
        {
          id: 'bm-child',
          gameVersion: 'poe1',
          searchRecordId: 'c1',
          name: 'Child BM',
          url: 'https://pathofexile.com/trade',
          groupId: 'child-1',
          order: 0,
        },
        {
          id: 'bm-grandchild',
          gameVersion: 'poe1',
          searchRecordId: 'g1',
          name: 'Grandchild BM',
          url: 'https://pathofexile.com/trade',
          groupId: 'grandchild-1',
          order: 0,
        },
        {
          id: 'bm-unrelated',
          gameVersion: 'poe1',
          searchRecordId: 'u1',
          name: 'Unrelated BM',
          url: 'https://pathofexile.com/trade',
          groupId: 'unrelated-root',
          order: 0,
        },
      ],
    });

    const model = createBookmarkModel(adapter.client);
    await model.connect();

    // Optimistically delete root-1
    const outcome = model.execute({ type: 'delete-group', groupId: 'root-1' });

    // State should immediately have only unrelated-root and bm-unrelated
    expect(model.state.value.groups.map((g) => g.id)).toEqual(['unrelated-root']);
    expect(model.state.value.bookmarks.map((b) => b.id)).toEqual(['bm-unrelated']);

    await outcome;
    expect(adapter.client.deleteGroup).toHaveBeenCalledWith('root-1');
  });

  it('optimistically clears groups and bookmarks on clear-collection and rolls back on failure', async () => {
    const adapter = setupClient();
    const commit = deferred<{ ok: false; error: any }>();
    adapter.client.clearCollection = vi.fn(async () => commit.promise);
    const model = createBookmarkModel(adapter.client);
    await model.connect();

    expect(model.state.value.groups.length).toBe(1);
    expect(model.state.value.bookmarks.length).toBe(1);

    const outcomePromise = model.execute({ type: 'clear-collection' });
    expect(model.state.value.groups).toEqual([]);
    expect(model.state.value.bookmarks).toEqual([]);

    commit.resolve({ ok: false, error: { code: 'storage-failure', message: 'disk full' } });
    await outcomePromise;

    expect(adapter.client.clearCollection).toHaveBeenCalledOnce();
    expect(model.state.value.groups.length).toBe(1);
    expect(model.state.value.bookmarks.length).toBe(1);
  });
});
