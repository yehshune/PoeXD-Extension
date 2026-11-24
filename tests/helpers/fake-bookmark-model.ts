import { ref } from 'vue';
import type {
  BookmarkModel,
  BookmarkModelOutcome,
  BookmarkModelState,
  BookmarkMutationIntent,
} from '@/components/sidebar/bookmark-model';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';

export interface FakeBookmarkModel extends BookmarkModel {
  intents: BookmarkMutationIntent[];
  /** 之後的 execute 是否失敗（寫入被拒絕）。 */
  failWith(message: string | null): void;
  setState(next: Partial<BookmarkModelState>): void;
  connectCount: number;
  refreshCount: number;
  disposed: boolean;
}

/** In-memory Bookmark model：套用最基本的意圖，並記錄所有送出的意圖。 */
export function createFakeBookmarkModel(
  initial: { groups?: BookmarkGroup[]; bookmarks?: Bookmark[] } = {},
): FakeBookmarkModel {
  const state = ref<BookmarkModelState>({
    groups: initial.groups ? [...initial.groups] : [],
    bookmarks: initial.bookmarks ? [...initial.bookmarks] : [],
  });
  let failure: string | null = null;

  const apply = (intent: BookmarkMutationIntent) => {
    const current = state.value;
    switch (intent.type) {
      case 'add-group':
        state.value = { ...current, groups: [...current.groups, intent.group] };
        break;
      case 'add-bookmark':
        state.value = {
          ...current,
          bookmarks: [
            ...current.bookmarks,
            {
              ...intent.bookmark,
              order: current.bookmarks.filter((b) => b.groupId === intent.bookmark.groupId).length,
            },
          ],
        };
        break;
      case 'delete-bookmark':
        state.value = {
          ...current,
          bookmarks: current.bookmarks.filter((b) => b.id !== intent.bookmarkId),
        };
        break;
      case 'move-bookmark':
        state.value = {
          ...current,
          bookmarks: current.bookmarks.map((b) =>
            b.id === intent.bookmarkId ? { ...b, groupId: intent.groupId } : b,
          ),
        };
        break;
      case 'delete-group':
        state.value = {
          groups: current.groups.filter((g) => g.id !== intent.groupId),
          bookmarks: current.bookmarks.filter((b) => b.groupId !== intent.groupId),
        };
        break;
      case 'clear-collection':
        state.value = { groups: [], bookmarks: [] };
        break;
      default:
        break;
    }
  };

  const model = {
    state,
    intents: [] as BookmarkMutationIntent[],
    connectCount: 0,
    refreshCount: 0,
    disposed: false,
    failWith(message: string | null) {
      failure = message;
    },
    setState(next: Partial<BookmarkModelState>) {
      state.value = { ...state.value, ...next };
    },
    async connect() {
      model.connectCount++;
      return { ok: true as const, value: undefined };
    },
    async execute(intent: any): Promise<BookmarkModelOutcome<any>> {
      model.intents.push(intent);
      if (failure !== null) {
        return { ok: false, error: { code: 'rejected', message: failure } as any };
      }
      apply(intent);
      return { ok: true, value: undefined };
    },
    refreshTargetContext() {
      model.refreshCount++;
    },
    dispose() {
      model.disposed = true;
    },
  };
  return model as unknown as FakeBookmarkModel;
}
