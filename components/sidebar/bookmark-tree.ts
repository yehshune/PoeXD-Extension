import type { ComputedRef, Ref } from 'vue';
import type { Bookmark, BookmarkGroup } from './bookmark-types';
import type { TradeLeague } from '@/utils/trade-leagues';
import {
  buildFolderTree,
  getFlattenedFolderTree,
  type FlattenedFolderTarget as GenericFlattenedFolderTarget,
  type FolderTreeNode as GenericFolderTreeNode,
} from '@/utils/bookmark-collection';

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

export interface BookmarkPaneContext {
  groups: ComputedRef<readonly BookmarkGroup[]>;
  bookmarks: ComputedRef<readonly Bookmark[]>;
  isDragging: Ref<boolean>;
  isDraggingBookmark?: ComputedRef<boolean> | Ref<boolean>;
  editingGroupId: Ref<string | null>;
  editingGroupName: Ref<string>;
  startRenameGroup: (group: BookmarkGroup) => void;
  saveRenameGroup: () => Promise<void>;
  editingBookmarkId: Ref<string | null>;
  editingBookmarkName: Ref<string>;
  startRenameBookmark: (bookmark: Bookmark) => void;
  saveRenameBookmark: () => Promise<void>;
  activeGroupMenuId: Ref<string | null>;
  setGroupMenuOpen: (groupId: string, open: boolean) => void;
  handleGroupTriggerPointerDown: (groupId: string, event: PointerEvent) => void;
  activeBookmarkMenuId: Ref<string | null>;
  setBookmarkMenuOpen: (bookmarkId: string, open: boolean) => void;
  handleBookmarkTriggerPointerDown: (bookmarkId: string, event: PointerEvent) => void;
  isMoveSubMenu: Ref<boolean>;
  setMoveSubMenuOpen: (open: boolean) => void;
  isCoverSubMenu: Ref<boolean>;
  setCoverSubMenuOpen: (open: boolean) => void;
  requestOpenCoverSubMenu: (bookmark: Bookmark) => void;
  handleCoverSubmenuKeydown: (event: KeyboardEvent, bookmark: Bookmark) => void;
  isGroupCollapsed: (groupId: string) => boolean;
  toggleGroupCollapse: (groupId: string) => Promise<void>;
  addBookmarkBtnPosition: Ref<'top' | 'bottom'>;
  enableBookmarkTooltip?: Ref<boolean>;
  sidebarPosition: Ref<'left' | 'right'>;
  tradeLeagues: Ref<TradeLeague[]>;
  isLeagueLoading: Ref<boolean>;
  leagueLoadError: Ref<string | null>;
  ensureTradeLeaguesLoaded: () => Promise<void>;
  formatTradeLeagueText: (league: TradeLeague) => string;
  confirmReplaceLeague: (scope: 'folder', league: TradeLeague, group: BookmarkGroup) => void;
  addBookmarkToGroup: (groupId: string) => Promise<void>;
  addChildFolder: (parentFolderId: string) => Promise<void>;
  confirmDeleteGroup: (group: BookmarkGroup) => Promise<void>;
  openBookmark: (bookmark: Bookmark) => void;
  openBookmarkNewTab: (bookmark: Bookmark) => void;
  openBookmarkLiveSearch: (bookmark: Bookmark) => void;
  sendBookmarkToLiveSearchConsole?: (bookmark: Bookmark) => Promise<void> | void;
  sendFolderToLiveSearchConsole?: (group: BookmarkGroup) => Promise<void> | void;
  moveBookmark: (bookmarkId: string, targetGroupId: string) => Promise<void>;
  deleteBookmark: (bookmarkId: string) => Promise<void>;
  copyTransfer: (scope: 'folder', groupId: string) => Promise<void>;
  getFilteredGroupBookmarks: (groupId: string) => readonly Bookmark[];
  getFolderPath: (folderId: string) => string;
  activeBookmarkId: Ref<string | null>;
  activePreviewData: Ref<any>;
  handlePreviewOpenChange: (bookmark: Bookmark, open: boolean) => void;
  handleCoverImageError: (event: Event) => void;
  getResultImagesForBookmark: (bookmark: Bookmark) => string[];
  selectBookmarkCover: (bookmark: Bookmark, imageUrl: string) => Promise<void>;
  removeBookmarkCover: (bookmark: Bookmark) => Promise<void>;
  hasSubtreeFolders: (rootFolderId: string) => boolean;
  isSubtreeAllCollapsed: (rootFolderId: string) => boolean;
  toggleSubtreeCollapse: (rootFolderId: string) => Promise<void>;
  moveFolder: (folderId: string, targetFolderId?: string) => Promise<void>;
  handleTriggerClick: (event: MouseEvent) => void;
  /** 左鍵點書籤的行為（Preference：開啟搜尋或切換預覽）。 */
  searchEntryClickAction?: Ref<'open' | 'preview'>;
  toggleBookmarkPreview?: (bookmark: Bookmark, event: Event) => void;
  handleBookmarkPrimaryClick?: (bookmark: Bookmark, event: Event) => void;
}

export const BOOKMARK_PANE_CONTEXT_KEY = Symbol('BookmarkPaneContext');
