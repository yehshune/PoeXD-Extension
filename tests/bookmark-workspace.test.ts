// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createBookmarkWorkspace } from '@/components/sidebar/bookmark-workspace';
import { createFakeBookmarkWorkspaceHost } from '@/components/sidebar/bookmark-workspace/fake-host';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';

const group: BookmarkGroup = { id: 'g1', name: 'Folder', order: 0 };
const bookmark: Bookmark = {
  id: 'b1',
  name: 'One',
  url: 'https://www.pathofexile.com/trade/search/Standard/abc',
  groupId: 'g1',
  searchRecordId: 'abc',
  order: 0,
};

describe('Bookmark Workspace (tree + lifecycle)', () => {
  it('exposes the model tree read-only and reflects model changes', async () => {
    const model = createFakeBookmarkModel({ groups: [group], bookmarks: [bookmark] });
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });

    expect(workspace.tree.groups.value).toEqual([group]);
    expect(workspace.tree.bookmarks.value).toEqual([bookmark]);

    model.setState({ bookmarks: [] });
    expect(workspace.tree.bookmarks.value).toEqual([]);
  });

  it('start() connects the model and clears isLoading without touching window keydown; dispose() disconnects', async () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const model = createFakeBookmarkModel();
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });

    expect(workspace.tree.isLoading.value).toBe(true);
    await workspace.start();
    expect(model.connectCount).toBe(1);
    expect(workspace.tree.isLoading.value).toBe(false);
    expect(addListenerSpy.mock.calls.some(([event]) => event === 'keydown')).toBe(false);

    workspace.dispose();
    expect(model.disposed).toBe(true);
    addListenerSpy.mockRestore();
  });

  it('refresh() re-resolves Bookmark targets against the current page', () => {
    const model = createFakeBookmarkModel();
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });
    workspace.refresh();
    expect(model.refreshCount).toBe(1);
  });

  it('start() throws when the model cannot connect, but still clears isLoading', async () => {
    const model = createFakeBookmarkModel();
    model.connect = async () => ({
      ok: false,
      error: { code: 'unavailable', message: 'offline' } as any,
    });
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });
    await expect(workspace.start()).rejects.toThrow('offline');
    expect(workspace.tree.isLoading.value).toBe(false);
  });
});

describe('Bookmark Workspace (CRUD write-through + host interactions)', () => {
  it('addGroup creates root and child folders with unique names and starts rename', async () => {
    const model = createFakeBookmarkModel({ groups: [group] });
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });

    await workspace.actions.addGroup();
    const firstIntent = model.intents[0];
    expect(firstIntent?.type).toBe('add-group');
    if (firstIntent?.type === 'add-group') {
      expect(firstIntent.group.parentId).toBeUndefined();
      expect(firstIntent.group.order).toBe(1);
      expect(workspace.editing.editingGroupId.value).toBe(firstIntent.group.id);
    }

    await workspace.actions.addChildFolder('g1');
    const childIntent = model.intents[1];
    expect(childIntent?.type).toBe('add-group');
    if (childIntent?.type === 'add-group') {
      expect(childIntent.group.parentId).toBe('g1');
      expect(childIntent.group.order).toBe(0);
    }
  });

  it('addBookmarkToGroup syncs URL via host, strips /live, attaches cover, and toasts', async () => {
    const coverUrl = 'https://web.poecdn.com/gen/image/item.png';
    const host = createFakeBookmarkWorkspaceHost({
      location: {
        url: 'https://www.pathofexile.com/trade/search/Settlers/xyz123',
        title: 'Mageblood Belt',
      },
      syncedUrl: 'https://www.pathofexile.com/trade/search/Settlers/xyz123/live',
      resultCoverImages: [coverUrl],
    });
    const model = createFakeBookmarkModel({ groups: [group] });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });

    await workspace.actions.addBookmarkToGroup('g1');

    expect(model.intents).toHaveLength(1);
    expect(model.intents[0]).toMatchObject({
      type: 'add-bookmark',
      bookmark: {
        groupId: 'g1',
        name: 'Mageblood Belt',
        url: 'https://www.pathofexile.com/trade/search/Settlers/xyz123',
        coverImageUrl: coverUrl,
      },
    });
    expect(host.state.coverCaptureRequests).toBeGreaterThanOrEqual(1);
    expect(host.state.toasts).toHaveLength(1);
    expect(host.state.toasts[0]?.tone).toBe('default');
  });

  it('addBookmarkToGroup shows an error toast and skips write when syncUrl fails', async () => {
    const host = createFakeBookmarkWorkspaceHost({
      syncedUrl: new Error('sync failed'),
    });
    const model = createFakeBookmarkModel({ groups: [group] });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });

    await workspace.actions.addBookmarkToGroup('g1');

    expect(model.intents).toHaveLength(0);
    expect(host.state.toasts).toEqual([{ message: 'sync failed', tone: 'error' }]);
  });

  it('overwriteBookmark validates URL, skips unchanged URL, and writes updated URL', async () => {
    const coverUrl = 'https://web.poecdn.com/gen/image/new-cover.png';
    const host = createFakeBookmarkWorkspaceHost({
      location: {
        url: 'https://www.pathofexile.com/trade/search/Standard/newid',
        title: 'Trade',
      },
      syncedUrl: 'https://www.pathofexile.com/trade/search/Standard/newid',
      resultCoverImages: [coverUrl],
    });
    const model = createFakeBookmarkModel({ groups: [group], bookmarks: [bookmark] });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });

    // Invalid URL
    host.state.syncedUrl = 'https://www.pathofexile.com/account';
    await workspace.actions.overwriteBookmark(bookmark);
    expect(model.intents).toHaveLength(0);
    expect(host.state.toasts.at(-1)?.tone).toBe('error');

    // Unchanged URL
    host.state.syncedUrl = bookmark.url;
    await workspace.actions.overwriteBookmark(bookmark);
    expect(model.intents).toHaveLength(0);
    expect(host.state.toasts.at(-1)?.tone).toBe('default');

    // Changed valid URL
    host.state.syncedUrl = 'https://www.pathofexile.com/trade/search/Standard/newid';
    workspace.menus.activeBookmarkMenuId.value = bookmark.id;
    await workspace.actions.overwriteBookmark(bookmark);
    expect(model.intents).toEqual([
      {
        type: 'overwrite-bookmark',
        bookmarkId: bookmark.id,
        url: 'https://www.pathofexile.com/trade/search/Standard/newid',
        coverImageUrl: coverUrl,
      },
    ]);
    expect(workspace.menus.activeBookmarkMenuId.value).toBeNull();
  });

  it('moveBookmark and deleteBookmark write through to model and close active bookmark menu', async () => {
    const group2: BookmarkGroup = { id: 'g2', name: 'Target', order: 1 };
    const model = createFakeBookmarkModel({ groups: [group, group2], bookmarks: [bookmark] });
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });

    workspace.menus.activeBookmarkMenuId.value = bookmark.id;
    await workspace.actions.moveBookmark(bookmark.id, 'g2');
    expect(model.intents[0]).toEqual({
      type: 'move-bookmark',
      bookmarkId: bookmark.id,
      groupId: 'g2',
    });
    expect(workspace.tree.bookmarks.value[0]?.groupId).toBe('g2');
    expect(workspace.menus.activeBookmarkMenuId.value).toBeNull();

    workspace.menus.activeBookmarkMenuId.value = bookmark.id;
    await workspace.actions.deleteBookmark(bookmark.id);
    expect(model.intents[1]).toEqual({
      type: 'delete-bookmark',
      bookmarkId: bookmark.id,
    });
    expect(workspace.tree.bookmarks.value).toHaveLength(0);
    expect(workspace.menus.activeBookmarkMenuId.value).toBeNull();
  });

  it('moveFolder moves inside a target folder or after the last root folder', async () => {
    const g2: BookmarkGroup = { id: 'g2', name: 'Second', order: 1 };
    const child: BookmarkGroup = { id: 'g3', name: 'Child', order: 0, parentId: 'g1' };
    const model = createFakeBookmarkModel({ groups: [group, g2, child] });
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });

    await workspace.actions.moveFolder('g2', 'g1');
    expect(model.intents[0]).toEqual({
      type: 'move-folder',
      folderId: 'g2',
      dropIntent: { targetFolderId: 'g1', position: 'inside' },
    });

    await workspace.actions.moveFolder('g3', undefined);
    expect(model.intents[1]).toEqual({
      type: 'move-folder',
      folderId: 'g3',
      dropIntent: { targetFolderId: 'g2', position: 'after' },
    });
  });

  it('confirmDeleteGroup deletes empty leaf folders directly and prompts for non-empty folders', async () => {
    const emptyFolder: BookmarkGroup = { id: 'empty', name: 'Empty', order: 1 };
    const host = createFakeBookmarkWorkspaceHost({ confirmAnswer: false });
    const model = createFakeBookmarkModel({
      groups: [group, emptyFolder],
      bookmarks: [bookmark],
    });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });

    // Empty leaf folder -> deletes without confirm
    await workspace.actions.confirmDeleteGroup(emptyFolder);
    expect(host.state.confirms).toHaveLength(0);
    expect(model.intents).toEqual([{ type: 'delete-group', groupId: 'empty' }]);

    // Non-empty folder + confirm cancelled
    await workspace.actions.confirmDeleteGroup(group);
    expect(host.state.confirms).toHaveLength(1);
    expect(model.intents).toHaveLength(1);

    // Non-empty folder + confirm accepted
    host.state.confirmAnswer = true;
    await workspace.actions.confirmDeleteGroup(group);
    expect(host.state.confirms).toHaveLength(2);
    expect(model.intents[1]).toEqual({ type: 'delete-group', groupId: 'g1' });
  });

  it('confirmClearCollection respects confirm dialog and skips when already empty', async () => {
    const host = createFakeBookmarkWorkspaceHost({ confirmAnswer: false });
    const model = createFakeBookmarkModel({ groups: [group], bookmarks: [bookmark] });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });

    // Cancelled
    await workspace.actions.confirmClearCollection();
    expect(host.state.confirms).toHaveLength(1);
    expect(model.intents).toHaveLength(0);

    // Accepted
    host.state.confirmAnswer = true;
    await workspace.actions.confirmClearCollection();
    expect(host.state.confirms).toHaveLength(2);
    expect(model.intents).toEqual([{ type: 'clear-collection' }]);
    expect(workspace.tree.isCollectionEmpty.value).toBe(true);

    // Already empty -> no confirm
    await workspace.actions.confirmClearCollection();
    expect(host.state.confirms).toHaveLength(2);
  });

  it('openBookmark* resolves target URL from host.navigation.readLocation() rather than window.location', () => {
    const host = createFakeBookmarkWorkspaceHost({
      location: {
        url: 'https://poe.game.qq.com/trade/search/Settlers/current',
        title: 'Trade',
      },
    });
    const pinnedBookmark: Bookmark = {
      ...bookmark,
      id: 'b2',
      leaguePinned: true,
    };
    const workspace = createBookmarkWorkspace(host, {
      version: 'poe1',
      model: createFakeBookmarkModel({ groups: [group], bookmarks: [bookmark, pinnedBookmark] }),
    });

    workspace.actions.openBookmark(bookmark);
    workspace.actions.openBookmarkNewTab(pinnedBookmark);
    workspace.actions.openBookmarkLiveSearch(bookmark);

    expect(host.state.navigations).toEqual([
      {
        url: 'https://poe.game.qq.com/trade/search/Settlers/abc',
        target: 'current',
      },
      {
        url: 'https://poe.game.qq.com/trade/search/Standard/abc',
        target: 'new-tab',
      },
      {
        url: 'https://poe.game.qq.com/trade/search/Settlers/abc/live',
        target: 'new-tab',
      },
    ]);
  });

  it('sendBookmarkToLiveSearchConsole and sendFolderToLiveSearchConsole enqueue resolved items and toast', async () => {
    const childFolder: BookmarkGroup = { id: 'g2', name: 'Sub', order: 0, parentId: 'g1' };
    const emptyFolder: BookmarkGroup = { id: 'g3', name: 'Empty', order: 1 };
    const childBookmark: Bookmark = {
      id: 'b2',
      name: 'Two',
      url: 'https://www.pathofexile.com/trade/search/Standard/def',
      groupId: 'g2',
      searchRecordId: 'def',
      order: 0,
    };
    const host = createFakeBookmarkWorkspaceHost({
      location: {
        url: 'https://www.pathofexile.com/trade/search/Settlers/current',
        title: 'Trade',
      },
      enqueueResponse: { success: true, created: false, addedCount: 2, skippedCount: 0 } as any,
    });
    const model = createFakeBookmarkModel({
      groups: [group, childFolder, emptyFolder],
      bookmarks: [bookmark, childBookmark],
    });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });

    await workspace.actions.sendBookmarkToLiveSearchConsole(bookmark);
    expect(host.state.enqueues).toHaveLength(1);
    expect(host.state.enqueues[0]?.request).toEqual({
      gameVersion: 'poe1',
      items: [
        {
          url: 'https://www.pathofexile.com/trade/search/Settlers/abc',
          name: 'One',
          coverImageUrl: undefined,
          sourceBookmarkId: 'b1',
        },
      ],
    });
    expect(host.state.toasts).toHaveLength(1);

    await workspace.actions.sendFolderToLiveSearchConsole(group);
    expect(host.state.enqueues).toHaveLength(2);
    expect(host.state.enqueues[1]?.request.items).toHaveLength(2);
    expect(host.state.enqueues[1]?.request.items.map((item) => item.url)).toEqual([
      'https://www.pathofexile.com/trade/search/Settlers/abc',
      'https://www.pathofexile.com/trade/search/Settlers/def',
    ]);
    expect(host.state.toasts).toHaveLength(2);

    // Empty folder -> toast only, no enqueue
    await workspace.actions.sendFolderToLiveSearchConsole(emptyFolder);
    expect(host.state.enqueues).toHaveLength(2);
    expect(host.state.toasts).toHaveLength(3);
  });
});
