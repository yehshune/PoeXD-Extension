import { ref, type Ref } from 'vue';
import { BOOKMARK_NAME_MAX_LENGTH } from '@/utils/bookmark-collection';
import type { Bookmark, BookmarkGroup } from '../bookmark-types';
import type { BookmarkMutationIntent } from '../bookmark-model';

export interface UseBookmarkEditingOptions {
  executeBookmarkIntent: (intent: BookmarkMutationIntent) => Promise<boolean>;
  activeGroupMenuId: Ref<string | null>;
  activeBookmarkMenuId: Ref<string | null>;
}

export function useBookmarkEditing(options: UseBookmarkEditingOptions) {
  const { executeBookmarkIntent, activeGroupMenuId, activeBookmarkMenuId } = options;

  // 重新命名狀態 (資料夾)
  const editingGroupId = ref<string | null>(null);
  const editingGroupName = ref('');

  // 重新命名狀態 (書籤)
  const editingBookmarkId = ref<string | null>(null);
  const editingBookmarkName = ref('');

  // 資料夾重新命名
  const startRenameGroup = (group: BookmarkGroup): void => {
    activeGroupMenuId.value = null; // 關閉選單
    editingGroupId.value = group.id;
    editingGroupName.value = group.name;
  };

  const saveRenameGroup = async (): Promise<void> => {
    if (!editingGroupId.value) return;
    const name = editingGroupName.value.trim();
    if (name && name.length <= BOOKMARK_NAME_MAX_LENGTH) {
      const success = await executeBookmarkIntent({
        type: 'rename-group',
        groupId: editingGroupId.value,
        name,
      });
      if (!success) return;
    }
    editingGroupId.value = null;
  };

  // 書籤重新命名
  const startRenameBookmark = (bm: Bookmark): void => {
    activeBookmarkMenuId.value = null; // 關閉選單
    editingBookmarkId.value = bm.id;
    editingBookmarkName.value = bm.name;
  };

  const saveRenameBookmark = async (): Promise<void> => {
    if (!editingBookmarkId.value) return;
    const name = editingBookmarkName.value.trim();
    if (name && name.length <= BOOKMARK_NAME_MAX_LENGTH) {
      const success = await executeBookmarkIntent({
        type: 'rename-bookmark',
        bookmarkId: editingBookmarkId.value,
        name,
      });
      if (!success) return;
    }
    editingBookmarkId.value = null;
  };

  return {
    editingGroupId,
    editingGroupName,
    editingBookmarkId,
    editingBookmarkName,
    startRenameGroup,
    saveRenameGroup,
    startRenameBookmark,
    saveRenameBookmark,
  };
}
