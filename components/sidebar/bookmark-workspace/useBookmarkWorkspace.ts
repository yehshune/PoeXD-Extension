import { onMounted, onUnmounted } from 'vue';
import { createBookmarkModel } from '../bookmark-model';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { getPoeVersion } from '@/utils/trade-context';
import { createChromeBookmarkWorkspaceHost } from './chrome-host';
import {
  createBookmarkWorkspace,
  type BookmarkWorkspace,
  type BookmarkWorkspaceOptions,
} from './workspace';
import type { BookmarkWorkspaceHost } from './host';

export interface UseBookmarkWorkspaceOptions
  extends Partial<Pick<BookmarkWorkspaceOptions, 'version' | 'model'>>,
    Pick<BookmarkWorkspaceOptions, 'isDragging' | 'isDraggingBookmark' | 'onLayoutChange'> {
  host?: BookmarkWorkspaceHost;
  /** 與資料載入並行的工作（例如 Preference 載入）。 */
  alongside?: () => Promise<unknown>;
}

/** 薄的 Vue lifecycle 包裝：建立正式環境 Workspace、掛載時啟動、卸載時釋放。 */
export function useBookmarkWorkspace(options: UseBookmarkWorkspaceOptions = {}): BookmarkWorkspace {
  const version = options.version ?? getPoeVersion();
  const model = options.model ?? createBookmarkModel(createChromeBookmarkClient(version));
  const workspace = createBookmarkWorkspace(options.host ?? createChromeBookmarkWorkspaceHost(), {
    version,
    model,
    isDragging: options.isDragging,
    isDraggingBookmark: options.isDraggingBookmark,
    onLayoutChange: options.onLayoutChange,
  });

  onMounted(() => workspace.start({ alongside: options.alongside?.() }));
  onUnmounted(() => workspace.dispose());

  return workspace;
}
