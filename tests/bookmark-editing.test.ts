import { describe, expect, it } from 'vitest';
import { createBookmarkWorkspace } from '@/components/sidebar/bookmark-workspace';
import { createFakeBookmarkWorkspaceHost } from '@/components/sidebar/bookmark-workspace/fake-host';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';

describe('Bookmark Workspace — editing', () => {
  const dummyGroup: BookmarkGroup = {
    id: 'group-1',
    name: 'Currency',
    order: 0,
  };

  const dummyBookmark: Bookmark = {
    id: 'bm-1',
    name: 'Exalted Orb',
    url: 'https://pathofexile.com/trade',
    groupId: 'group-1',
    searchRecordId: 'exalt',
    order: 0,
  };

  const setup = () => {
    const host = createFakeBookmarkWorkspaceHost();
    const model = createFakeBookmarkModel({
      groups: [dummyGroup],
      bookmarks: [dummyBookmark],
    });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });
    return { host, model, workspace };
  };

  it('starts group rename and closes activeGroupMenuId', () => {
    const { workspace } = setup();
    workspace.menus.setGroupMenuOpen('group-1', true);

    workspace.editing.startRenameGroup(dummyGroup);

    expect(workspace.menus.activeGroupMenuId.value).toBeNull();
    expect(workspace.editing.editingGroupId.value).toBe('group-1');
    expect(workspace.editing.editingGroupName.value).toBe('Currency');
  });

  it('saves group rename with trimmed non-empty name on success', async () => {
    const { model, workspace } = setup();

    workspace.editing.startRenameGroup(dummyGroup);
    workspace.editing.editingGroupName.value = '  New Currency Name  ';

    await workspace.editing.saveRenameGroup();

    expect(model.intents).toEqual([
      {
        type: 'rename-group',
        groupId: 'group-1',
        name: 'New Currency Name',
      },
    ]);
    expect(workspace.editing.editingGroupId.value).toBeNull();
  });

  it('does not dispatch rename-group if name trims to empty string', async () => {
    const { model, workspace } = setup();

    workspace.editing.startRenameGroup(dummyGroup);
    workspace.editing.editingGroupName.value = '   ';

    await workspace.editing.saveRenameGroup();

    expect(model.intents).toHaveLength(0);
    expect(workspace.editing.editingGroupId.value).toBeNull();
  });

  it('preserves editingGroupId if rename-group mutation fails', async () => {
    const { host, model, workspace } = setup();
    model.failWith('write rejected');

    workspace.editing.startRenameGroup(dummyGroup);
    workspace.editing.editingGroupName.value = 'Updated Name';

    await workspace.editing.saveRenameGroup();

    expect(model.intents).toHaveLength(1);
    expect(workspace.editing.editingGroupId.value).toBe('group-1');
    expect(host.state.alerts).toHaveLength(1);
  });

  it('starts bookmark rename and closes activeBookmarkMenuId', () => {
    const { workspace } = setup();
    workspace.menus.setBookmarkMenuOpen('bm-1', true);

    workspace.editing.startRenameBookmark(dummyBookmark);

    expect(workspace.menus.activeBookmarkMenuId.value).toBeNull();
    expect(workspace.editing.editingBookmarkId.value).toBe('bm-1');
    expect(workspace.editing.editingBookmarkName.value).toBe('Exalted Orb');
  });

  it('saves bookmark rename with trimmed non-empty name on success', async () => {
    const { model, workspace } = setup();

    workspace.editing.startRenameBookmark(dummyBookmark);
    workspace.editing.editingBookmarkName.value = '  Divine Orb  ';

    await workspace.editing.saveRenameBookmark();

    expect(model.intents).toEqual([
      {
        type: 'rename-bookmark',
        bookmarkId: 'bm-1',
        name: 'Divine Orb',
      },
    ]);
    expect(workspace.editing.editingBookmarkId.value).toBeNull();
  });

  it('does not dispatch rename-bookmark if name trims to empty string', async () => {
    const { model, workspace } = setup();

    workspace.editing.startRenameBookmark(dummyBookmark);
    workspace.editing.editingBookmarkName.value = '   ';

    await workspace.editing.saveRenameBookmark();

    expect(model.intents).toHaveLength(0);
    expect(workspace.editing.editingBookmarkId.value).toBeNull();
  });

  it('preserves editingBookmarkId if rename-bookmark mutation fails', async () => {
    const { host, model, workspace } = setup();
    model.failWith('write rejected');

    workspace.editing.startRenameBookmark(dummyBookmark);
    workspace.editing.editingBookmarkName.value = 'Updated Bookmark';

    await workspace.editing.saveRenameBookmark();

    expect(model.intents).toHaveLength(1);
    expect(workspace.editing.editingBookmarkId.value).toBe('bm-1');
    expect(host.state.alerts).toHaveLength(1);
  });

  it('does not dispatch rename-group or rename-bookmark if name exceeds BOOKMARK_NAME_MAX_LENGTH (200)', async () => {
    const { model, workspace } = setup();
    const tooLongName = 'X'.repeat(201);

    // Group rename with 201 chars
    workspace.editing.startRenameGroup(dummyGroup);
    workspace.editing.editingGroupName.value = tooLongName;
    await workspace.editing.saveRenameGroup();
    expect(model.intents).toHaveLength(0);
    expect(workspace.editing.editingGroupId.value).toBeNull();

    // Bookmark rename with 201 chars
    workspace.editing.startRenameBookmark(dummyBookmark);
    workspace.editing.editingBookmarkName.value = tooLongName;
    await workspace.editing.saveRenameBookmark();
    expect(model.intents).toHaveLength(0);
    expect(workspace.editing.editingBookmarkId.value).toBeNull();
  });
});
