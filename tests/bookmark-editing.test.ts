// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useBookmarkEditing } from '@/components/sidebar/composables/useBookmarkEditing';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';

describe('useBookmarkEditing', () => {
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

  it('starts group rename and closes activeGroupMenuId', () => {
    const activeGroupMenuId = ref<string | null>('group-1');
    const activeBookmarkMenuId = ref<string | null>(null);
    const executeBookmarkIntent = vi.fn(async () => true);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId,
      activeBookmarkMenuId,
    });

    editing.startRenameGroup(dummyGroup);

    expect(activeGroupMenuId.value).toBeNull();
    expect(editing.editingGroupId.value).toBe('group-1');
    expect(editing.editingGroupName.value).toBe('Currency');
  });

  it('saves group rename with trimmed non-empty name on success', async () => {
    const activeGroupMenuId = ref<string | null>(null);
    const activeBookmarkMenuId = ref<string | null>(null);
    const executeBookmarkIntent = vi.fn(async () => true);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId,
      activeBookmarkMenuId,
    });

    editing.startRenameGroup(dummyGroup);
    editing.editingGroupName.value = '  New Currency Name  ';

    await editing.saveRenameGroup();

    expect(executeBookmarkIntent).toHaveBeenCalledWith({
      type: 'rename-group',
      groupId: 'group-1',
      name: 'New Currency Name',
    });
    expect(editing.editingGroupId.value).toBeNull();
  });

  it('does not dispatch rename-group if name trims to empty string', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId: ref(null),
      activeBookmarkMenuId: ref(null),
    });

    editing.startRenameGroup(dummyGroup);
    editing.editingGroupName.value = '   ';

    await editing.saveRenameGroup();

    expect(executeBookmarkIntent).not.toHaveBeenCalled();
    expect(editing.editingGroupId.value).toBeNull();
  });

  it('preserves editingGroupId if rename-group mutation fails', async () => {
    const executeBookmarkIntent = vi.fn(async () => false);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId: ref(null),
      activeBookmarkMenuId: ref(null),
    });

    editing.startRenameGroup(dummyGroup);
    editing.editingGroupName.value = 'Updated Name';

    await editing.saveRenameGroup();

    expect(executeBookmarkIntent).toHaveBeenCalledTimes(1);
    expect(editing.editingGroupId.value).toBe('group-1');
  });

  it('starts bookmark rename and closes activeBookmarkMenuId', () => {
    const activeGroupMenuId = ref<string | null>(null);
    const activeBookmarkMenuId = ref<string | null>('bm-1');
    const executeBookmarkIntent = vi.fn(async () => true);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId,
      activeBookmarkMenuId,
    });

    editing.startRenameBookmark(dummyBookmark);

    expect(activeBookmarkMenuId.value).toBeNull();
    expect(editing.editingBookmarkId.value).toBe('bm-1');
    expect(editing.editingBookmarkName.value).toBe('Exalted Orb');
  });

  it('saves bookmark rename with trimmed non-empty name on success', async () => {
    const activeGroupMenuId = ref<string | null>(null);
    const activeBookmarkMenuId = ref<string | null>(null);
    const executeBookmarkIntent = vi.fn(async () => true);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId,
      activeBookmarkMenuId,
    });

    editing.startRenameBookmark(dummyBookmark);
    editing.editingBookmarkName.value = '  Divine Orb  ';

    await editing.saveRenameBookmark();

    expect(executeBookmarkIntent).toHaveBeenCalledWith({
      type: 'rename-bookmark',
      bookmarkId: 'bm-1',
      name: 'Divine Orb',
    });
    expect(editing.editingBookmarkId.value).toBeNull();
  });

  it('does not dispatch rename-bookmark if name trims to empty string', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId: ref(null),
      activeBookmarkMenuId: ref(null),
    });

    editing.startRenameBookmark(dummyBookmark);
    editing.editingBookmarkName.value = '   ';

    await editing.saveRenameBookmark();

    expect(executeBookmarkIntent).not.toHaveBeenCalled();
    expect(editing.editingBookmarkId.value).toBeNull();
  });

  it('preserves editingBookmarkId if rename-bookmark mutation fails', async () => {
    const executeBookmarkIntent = vi.fn(async () => false);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId: ref(null),
      activeBookmarkMenuId: ref(null),
    });

    editing.startRenameBookmark(dummyBookmark);
    editing.editingBookmarkName.value = 'Updated Bookmark';

    await editing.saveRenameBookmark();

    expect(executeBookmarkIntent).toHaveBeenCalledTimes(1);
    expect(editing.editingBookmarkId.value).toBe('bm-1');
  });

  it('does not dispatch rename-group or rename-bookmark if name exceeds BOOKMARK_NAME_MAX_LENGTH (200)', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);

    const editing = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId: ref(null),
      activeBookmarkMenuId: ref(null),
    });

    const tooLongName = 'X'.repeat(201);

    // Group rename with 201 chars
    editing.startRenameGroup(dummyGroup);
    editing.editingGroupName.value = tooLongName;
    await editing.saveRenameGroup();
    expect(executeBookmarkIntent).not.toHaveBeenCalled();
    expect(editing.editingGroupId.value).toBeNull();

    // Bookmark rename with 201 chars
    editing.startRenameBookmark(dummyBookmark);
    editing.editingBookmarkName.value = tooLongName;
    await editing.saveRenameBookmark();
    expect(executeBookmarkIntent).not.toHaveBeenCalled();
    expect(editing.editingBookmarkId.value).toBeNull();
  });
});
