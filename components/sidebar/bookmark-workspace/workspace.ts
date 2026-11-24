import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { PoeVersion } from '@/utils/trade-context';
import type { BookmarkModel } from '../bookmark-model';
import type { Bookmark, BookmarkGroup } from '../bookmark-types';
import type { BookmarkWorkspaceHost } from './host';

export interface BookmarkWorkspaceOptions {
  version: PoeVersion;
  /** 既有的 Bookmark model（持久化走原本的 messaging 路徑，不經 Host）。 */
  model: BookmarkModel;
}

export interface BookmarkWorkspaceTree {
  readonly groups: ComputedRef<readonly BookmarkGroup[]>;
  readonly bookmarks: ComputedRef<readonly Bookmark[]>;
  readonly isLoading: Readonly<Ref<boolean>>;
}

export interface BookmarkWorkspace {
  readonly tree: BookmarkWorkspaceTree;
  /** 載入資料並開始監聽；`alongside` 與資料載入並行，全部完成才結束載入狀態。 */
  start(options?: { alongside?: Promise<unknown> }): Promise<void>;
  /** 匯入完成等情況後，重新解析 Bookmark 目標網址。 */
  refresh(): void;
  dispose(): void;
}

export function createBookmarkWorkspace(
  _host: BookmarkWorkspaceHost,
  options: BookmarkWorkspaceOptions,
): BookmarkWorkspace {
  const { model } = options;
  const isLoading = ref(true);
  const groups = computed(() => model.state.value.groups);
  const bookmarks = computed(() => model.state.value.bookmarks);

  const start: BookmarkWorkspace['start'] = async (startOptions = {}) => {
    try {
      const [, bookmarkOutcome] = await Promise.all([startOptions.alongside, model.connect()]);
      if (!bookmarkOutcome.ok) throw new Error(bookmarkOutcome.error.message);
    } finally {
      isLoading.value = false;
    }
  };

  return {
    tree: { groups, bookmarks, isLoading },
    start,
    refresh: () => model.refreshTargetContext(),
    dispose: () => model.dispose(),
  };
}
