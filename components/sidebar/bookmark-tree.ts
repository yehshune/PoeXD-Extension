import type { InjectionKey } from 'vue';
import type { BookmarkGroup } from './bookmark-types';
import type {
  BookmarkWorkspaceActions,
  BookmarkWorkspaceEditing,
  BookmarkWorkspaceMenus,
  BookmarkWorkspacePreview,
  BookmarkWorkspaceTree,
} from './bookmark-workspace';
import {
  buildFolderTree,
  getFlattenedFolderTree,
  type FlattenedFolderTarget as GenericFlattenedFolderTarget,
  type FolderTreeNode as GenericFolderTreeNode,
} from '@/utils/bookmark-folder-tree';

export type FolderTreeNode = GenericFolderTreeNode<BookmarkGroup>;
export type FlattenedFolderTarget = GenericFlattenedFolderTarget<BookmarkGroup>;
export { buildFolderTree, getFlattenedFolderTree };

export const TREE_MENU_MAX_INDENT_DEPTH = 6;

/**
 * 取得樹狀選單項目在最大上限內的縮排層級數（階梯數）。
 * 供 presentation layer 產生對應數量之 scale/density-aware spacer，
 * 避免 CSS length × number arithmetic，並與 UI Scale / Density 保持一致。
 */
export function getFolderItemIndentLevel(depth: number): number {
  if (depth <= 0) return 0;
  return Math.min(depth, TREE_MENU_MAX_INDENT_DEPTH);
}

/** 分組後的 Bookmark Workspace 唯讀 context，供資料夾節點與書籤列依職責取用。 */
export interface BookmarkPaneContext {
  readonly tree: BookmarkWorkspaceTree;
  readonly editing: BookmarkWorkspaceEditing;
  readonly menus: BookmarkWorkspaceMenus;
  readonly actions: BookmarkWorkspaceActions;
  readonly preview: BookmarkWorkspacePreview;
  readonly refresh: () => void;
}

export const BOOKMARK_PANE_CONTEXT_KEY: InjectionKey<BookmarkPaneContext> =
  Symbol('BookmarkPaneContext');
