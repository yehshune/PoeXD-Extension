import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue';
import { t, formatMessage } from '@/utils/i18n';
import { createVersionedStorageKeys } from '@/utils/storage-contracts';
import { readBookmarkTargetContext, resolveBookmarkUrl } from '@/utils/bookmark-target';
import { sanitizeBookmarkName } from '@/utils/bookmark-collection-schema';
import {
  getFolderDeleteImpact,
  getFolderSubtreeIds,
  isDirectlyDeletableEmptyFolder,
  formatFolderPath,
} from '@/utils/bookmark-folder-tree';
import {
  isLegacyTradeSearchUrl,
  isSameTradeSearchPageUrl,
  parseTradeSearchUrl,
  stripLiveSuffix,
  toLiveUrl,
  withTradeSearchId,
} from '@/utils/trade-search-identity';
import {
  deriveSearchTitleFromUrl,
  encodeQueryToGzipBase64Url,
  isGenericTradePageTitle,
} from '@/utils/trade-url-codec';
import { resolveTunedTradeSearchUrl } from '@/utils/trade-query-tuning';
import {
  DEFAULT_PREFERENCES,
  type BookmarkButtonPosition,
  type SearchEntryClickAction,
} from '@/utils/preferences-contract';
import type { PoeVersion } from '@/utils/trade-context';
import type { BookmarkModel, BookmarkMutationIntent } from '../bookmark-model';
import type { Bookmark, BookmarkGroup } from '../bookmark-types';
import { buildFolderTree, type FolderTreeNode } from '../bookmark-tree';
import { resolveSingleEnqueueToast } from '../live-search-presentation';
import { rowAnchorFromEvent, useTradeSearchPreview } from '../composables/useTradeSearchPreview';
import type { BookmarkWorkspaceHost } from './host';
import { createBookmarkMenus } from './menus';
import { createBookmarkEditing } from './editing';
import { createBookmarkCollapse } from './collapse';
import { createBookmarkSearch } from './search';
import { createBookmarkCovers } from './covers';
import { createBookmarkLeagues } from './leagues';

export interface BookmarkWorkspaceOptions {
  version: PoeVersion;
  /** 既有的 Bookmark model（持久化走原本的 messaging 路徑，不經 Host）。 */
  model: BookmarkModel;
  /** 目前是否正在拖曳（由 Pane 的 DragTrashSession 提供）。 */
  isDragging?: Readonly<Ref<boolean>>;
  isDraggingBookmark?: Readonly<Ref<boolean>>;
}

export interface BookmarkWorkspacePreferences {
  addBookmarkBtnPosition?: BookmarkButtonPosition;
  enableBookmarkTooltip?: boolean;
  searchEntryClickAction?: SearchEntryClickAction;
  sidebarPosition?: 'left' | 'right';
  sidebarModuleLiveSearch?: boolean;
}

export interface VisibleFolderNode {
  folder: BookmarkGroup;
  depth: number;
}

export function createBookmarkWorkspace(
  host: BookmarkWorkspaceHost,
  options: BookmarkWorkspaceOptions,
) {
  const { version, model } = options;
  const isDragging = options.isDragging ?? ref(false);
  const isDraggingBookmark = options.isDraggingBookmark ?? ref(false);
  const keys = createVersionedStorageKeys(version);

  const isLoading = ref(true);
  const groups = computed(() => model.state.value.groups);
  const bookmarks = computed(() => model.state.value.bookmarks);

  // ── 偏好（由 Pane 訂閱 Preference 後寫入）─────────────────────
  const addBookmarkBtnPosition = ref<BookmarkButtonPosition>(
    DEFAULT_PREFERENCES.addBookmarkBtnPosition,
  );
  const enableBookmarkTooltip = ref<boolean>(DEFAULT_PREFERENCES.enableBookmarkTooltip);
  const searchEntryClickAction = ref<SearchEntryClickAction>(
    DEFAULT_PREFERENCES.searchEntryClickAction,
  );
  const sidebarPosition = ref<'left' | 'right'>('left');
  const liveSearchEnabled = ref<boolean>(DEFAULT_PREFERENCES.sidebarModuleLiveSearch);
  const setPreferences = (next: BookmarkWorkspacePreferences) => {
    if (next.addBookmarkBtnPosition !== undefined)
      addBookmarkBtnPosition.value = next.addBookmarkBtnPosition;
    if (next.enableBookmarkTooltip !== undefined)
      enableBookmarkTooltip.value = next.enableBookmarkTooltip;
    if (next.searchEntryClickAction !== undefined)
      searchEntryClickAction.value = next.searchEntryClickAction;
    if (next.sidebarPosition !== undefined) sidebarPosition.value = next.sidebarPosition;
    if (next.sidebarModuleLiveSearch !== undefined)
      liveSearchEnabled.value = next.sidebarModuleLiveSearch;
  };

  // ── 寫入（Bookmark model）──────────────────────────────────────
  const execute = async (intent: BookmarkMutationIntent): Promise<boolean> => {
    const outcome = await model.execute(intent);
    if (!outcome.ok) {
      // 只記錄意圖類型與錯誤代碼，不含書籤名稱或網址
      console.error('[PoeXD] 書籤寫入失敗:', {
        intent: intent.type,
        code: outcome.error.code,
        message: outcome.error.message,
      });
      await host.feedback.alert(
        t('bookmark.dialog.saveFailure', { message: outcome.error.message }),
        t('common.saveFailed'),
      );
    }
    return outcome.ok;
  };

  // ── 部件 ───────────────────────────────────────────────────────
  const menus = createBookmarkMenus();
  const search = createBookmarkSearch({ groups, bookmarks });
  const editing = createBookmarkEditing({
    executeBookmarkIntent: execute,
    activeGroupMenuId: menus.activeGroupMenuId,
    activeBookmarkMenuId: menus.activeBookmarkMenuId,
  });
  const collapse = createBookmarkCollapse({
    groups,
    searchQuery: search.searchQuery,
    storageKey: keys.bookmarkCollapsedGroups,
    isEditing: (id) => editing.editingGroupId.value === id,
  });
  const covers = createBookmarkCovers({
    host,
    execute,
    isMoveSubMenu: menus.isMoveSubMenu,
    isCoverSubMenu: menus.isCoverSubMenu,
    closeAllMenus: menus.closeAllMenus,
  });
  const leagues = createBookmarkLeagues({
    version,
    host,
    bookmarks,
    execute,
    closeAllMenus: menus.closeAllMenus,
  });

  // 拖曳中暫時自動展開的資料夾集合 (零 storage 寫入)
  const transientExpandedFolderIds = ref<Set<string>>(new Set());
  const isGroupCollapsed = (groupId: string): boolean => {
    if (transientExpandedFolderIds.value.has(groupId)) return false;
    return collapse.isGroupCollapsed(groupId);
  };

  const isBookmarkDragEnabled = computed(() => search.searchQuery.value.trim() === '');
  const isCollectionEmpty = computed(
    () => groups.value.length === 0 && bookmarks.value.length === 0,
  );

  const visibleFolderNodes = computed<VisibleFolderNode[]>(() => {
    const tree = buildFolderTree(search.filteredGroups.value as BookmarkGroup[]);
    const result: VisibleFolderNode[] = [];
    const traverse = (nodes: FolderTreeNode[]) => {
      for (const node of nodes) {
        result.push({ folder: node.folder, depth: node.depth });
        if (!isGroupCollapsed(node.folder.id) && node.children.length > 0) {
          traverse(node.children);
        }
      }
    };
    traverse(tree);
    return result;
  });

  /** 樹的結構簽章：結構、收合狀態或拖曳可用性改變時變動，供 sortable 反應式同步。 */
  const sortableKey = computed(() =>
    [
      isBookmarkDragEnabled.value ? 'drag-enabled' : 'drag-disabled',
      groups.value.map((group) => `${group.id}:${group.parentId ?? ''}:${group.order}`).join(','),
      bookmarks.value
        .map((bookmark) => `${bookmark.id}:${bookmark.groupId}:${bookmark.order}`)
        .join(','),
      Array.from(collapse.collapsedGroupIds.value).sort().join(','),
    ].join('|'),
  );

  const getFolderPath = (folderId: string) =>
    formatFolderPath(groups.value as BookmarkGroup[], folderId);

  // ── 目前頁面 ───────────────────────────────────────────────────
  const currentPageUrl = ref(host.navigation.readLocation().url);
  const syncCurrentPageRoute = () => {
    currentPageUrl.value = host.navigation.readLocation().url || '';
    model.refreshTargetContext();
  };

  // ── Search Preview ─────────────────────────────────────────────
  const previewDisabled = computed(
    () =>
      Boolean(isDragging.value) ||
      Boolean(editing.editingBookmarkId.value) ||
      !enableBookmarkTooltip.value,
  );
  const {
    activeEntityKey: activeBookmarkId,
    activePreviewData,
    activeRawQuery,
    loadPreview,
    clearActivePreview,
    activeItem: previewBookmark,
    anchorEl: previewAnchorEl,
    isOpen: isPreviewOpen,
    toggle: toggleBookmarkPreview,
    close: closePreview,
  } = useTradeSearchPreview<Bookmark>({ version, disabled: previewDisabled });

  const loadBookmarkPreview = (bm: Bookmark) => loadPreview(bm.id, bm.url);

  /** 以事件來源所在的書籤列作為預覽錨點。 */
  const toggleBookmarkPreviewFromEvent = (bm: Bookmark, event: Event) => {
    if (!enableBookmarkTooltip.value) return;
    toggleBookmarkPreview(bm, rowAnchorFromEvent(event, '.bookmark-row-item'));
  };

  const isOverwritingPreview = ref(false);
  const canOpenPreviewSearch = computed(() =>
    Boolean(previewBookmark.value && !isLegacyTradeSearchUrl(previewBookmark.value.url)),
  );

  const handlePreviewOpenChange = (bm: Bookmark, open: boolean) => {
    if (!enableBookmarkTooltip.value) return;
    if (open) {
      if (isDragging.value || editing.editingBookmarkId.value === bm.id) return;
      void loadBookmarkPreview(bm);
    } else {
      clearActivePreview(bm.id);
    }
  };

  // ── 開啟書籤 ───────────────────────────────────────────────────
  // 開啟時以 Host 目前頁面的網域與聯盟重新解析，避免投影後頁面已切換聯盟
  const readHostTargetContext = () => {
    const rawUrl = host.navigation.readLocation().url;
    if (!rawUrl) return {};
    try {
      return readBookmarkTargetContext(new URL(rawUrl));
    } catch {
      return {};
    }
  };

  const resolveOpenUrl = (bookmark: Bookmark) =>
    resolveBookmarkUrl(
      bookmark.canonicalUrl ?? bookmark.url,
      { leaguePinned: bookmark.leaguePinned },
      readHostTargetContext(),
    );

  const openBookmark = (bookmark: Bookmark) => {
    const url = resolveOpenUrl(bookmark);
    if (!url) return;
    host.navigation.navigate(url, 'current');
  };

  const openBookmarkNewTab = (bookmark: Bookmark) => {
    const url = resolveOpenUrl(bookmark);
    if (!url) return;
    host.navigation.navigate(url, 'new-tab');
    menus.closeAllMenus();
  };

  const openBookmarkLiveSearch = (bookmark: Bookmark) => {
    const url = resolveOpenUrl(bookmark);
    if (!url) return;
    host.navigation.navigate(toLiveUrl(url), 'new-tab');
    menus.closeAllMenus();
  };

  /** 左鍵點書籤名稱：依 Preference 開啟搜尋或切換預覽。 */
  const handleBookmarkPrimaryClick = (bm: Bookmark, event: Event) => {
    if (searchEntryClickAction.value === 'preview' && enableBookmarkTooltip.value) {
      toggleBookmarkPreviewFromEvent(bm, event);
      return;
    }
    openBookmark(bm);
  };

  const handleOpenPreviewSearch = async (payload: {
    mode: 'current' | 'new-tab';
    modifiedQuery: Record<string, unknown> | null;
  }) => {
    const bm = previewBookmark.value;
    if (!bm) return;
    const baseUrl = resolveOpenUrl(bm);
    if (!baseUrl) return;
    const targetUrl = await resolveTunedTradeSearchUrl(baseUrl, payload.modifiedQuery);
    if (!targetUrl) return;
    host.navigation.navigate(targetUrl, payload.mode === 'current' ? 'current' : 'new-tab');
  };

  const handleOverwritePreviewSearch = async (modifiedQuery: Record<string, unknown>) => {
    const bm = previewBookmark.value;
    if (!bm || isOverwritingPreview.value) return;
    isOverwritingPreview.value = true;
    try {
      const code = await encodeQueryToGzipBase64Url(modifiedQuery);
      const nextUrl =
        withTradeSearchId(bm.url, code) ?? withTradeSearchId(bm.canonicalUrl ?? '', code);
      if (!nextUrl) return;
      const saved = await execute({ type: 'overwrite-bookmark', bookmarkId: bm.id, url: nextUrl });
      if (!saved) return;
      const updated = bookmarks.value.find((entry) => entry.id === bm.id) ?? {
        ...bm,
        url: nextUrl,
      };
      await loadBookmarkPreview(updated);
      host.feedback.toast(t('bookmark.toast.overwritten', { name: bm.name }));
    } catch {
      host.feedback.toast(t('bookmark.toast.cannotResolveUrl'));
    } finally {
      isOverwritingPreview.value = false;
    }
  };

  // ── 送入線上搜尋主控台 ─────────────────────────────────────────
  const sendBookmarkToLiveSearchConsole = async (bookmark: Bookmark) => {
    menus.closeAllMenus();
    const url = resolveOpenUrl(bookmark);
    if (!url) {
      host.feedback.toast(t('bookmark.toast.cannotResolveUrl'));
      return;
    }
    try {
      const res = await host.sources.enqueue(
        {
          gameVersion: version,
          items: [
            {
              url,
              name: bookmark.name,
              coverImageUrl: bookmark.coverImageUrl,
              sourceBookmarkId: bookmark.id,
            },
          ],
        },
        { timeoutMessage: t('common.sendToConsoleFailed') },
      );
      host.feedback.toast(resolveSingleEnqueueToast(res, bookmark.name).message);
    } catch (err) {
      host.feedback.toast(err instanceof Error ? err.message : t('common.sendToConsoleFailed'));
    }
  };

  const sendFolderToLiveSearchConsole = async (folder: BookmarkGroup) => {
    menus.closeAllMenus();
    const subtreeFolderIds = new Set(
      getFolderSubtreeIds(groups.value as BookmarkGroup[], folder.id),
    );
    const targetBookmarks = bookmarks.value.filter((bm) => subtreeFolderIds.has(bm.groupId));
    if (targetBookmarks.length === 0) {
      host.feedback.toast(t('bookmark.toast.folderNoBookmarks'));
      return;
    }

    const items = targetBookmarks
      .map((bm) => {
        const url = resolveOpenUrl(bm);
        if (!url) return null;
        return { url, name: bm.name, coverImageUrl: bm.coverImageUrl, sourceBookmarkId: bm.id };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (items.length === 0) {
      host.feedback.toast(t('bookmark.toast.folderNoValidUrls'));
      return;
    }

    try {
      const res = await host.sources.enqueue(
        { gameVersion: version, items },
        { timeoutMessage: t('common.sendToConsoleFailed') },
      );
      if (!res.success) {
        host.feedback.toast(formatMessage(res.error, 'common.sendToConsoleFailed'));
      } else if (res.created) {
        host.feedback.toast(t('bookmark.toast.sentWithCreated', { count: items.length }));
      } else {
        const added = res.addedCount ?? items.length;
        const skipped = res.skippedCount ?? 0;
        const parts = [t('bookmark.toast.sentCount', { count: added })];
        if (skipped > 0) parts.push(t('bookmark.toast.skippedCount', { count: skipped }));
        host.feedback.toast(parts.join(' · '));
      }
    } catch (err) {
      host.feedback.toast(err instanceof Error ? err.message : t('common.sendToConsoleFailed'));
    }
  };

  // ── 資料夾 ─────────────────────────────────────────────────────
  // 新增資料夾（若有 parentId 則為子資料夾，否則為 root folder）
  const addGroup = async (parentId?: string) => {
    const siblings = groups.value.filter((g) => g.parentId === parentId);
    const baseName = t('bookmark.defaultFolderName');
    let name = baseName;
    let counter = 1;
    while (siblings.some((g) => g.name === name)) {
      name = `${baseName} (${counter})`;
      counter++;
    }

    const order = siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
    const newGrp: BookmarkGroup = {
      id: 'group_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now(),
      name,
      order,
      ...(parentId !== undefined ? { parentId } : {}),
    };

    if (!(await execute({ type: 'add-group', group: newGrp }))) return;

    if (parentId) await collapse.reveal(parentId);
    if (groups.value.some((g) => g.id === newGrp.id)) {
      editing.startRenameGroup(newGrp);
    }
  };

  const addChildFolder = (parentFolderId: string) => addGroup(parentFolderId);

  const setFolderAppearance = async (
    groupId: string,
    appearance: { icon?: string; color?: string },
  ) => {
    await execute({
      type: 'set-group-appearance',
      groupId,
      icon: appearance.icon,
      color: appearance.color,
    });
  };

  const moveFolder = async (folderId: string, targetFolderId?: string) => {
    menus.activeGroupMenuId.value = null;
    if (targetFolderId !== undefined) {
      const saved = await execute({
        type: 'move-folder',
        folderId,
        dropIntent: { targetFolderId, position: 'inside' },
      });
      if (!saved) return;
      await collapse.reveal(targetFolderId);
    } else {
      const rootFolders = (groups.value as BookmarkGroup[])
        .filter((f) => f.parentId === undefined && f.id !== folderId)
        .sort((a, b) => a.order - b.order);
      const lastRoot = rootFolders[rootFolders.length - 1];
      if (!lastRoot) return;
      await execute({
        type: 'move-folder',
        folderId,
        dropIntent: { targetFolderId: lastRoot.id, position: 'after' },
      });
    }
  };

  // 刪除資料夾時直接一併刪除書籤及子資料夾（提示完整 cascade 範圍；真正的空 leaf folder 則直接刪除不彈窗）
  const confirmDeleteGroup = async (group: BookmarkGroup) => {
    menus.activeGroupMenuId.value = null;
    const impact = getFolderDeleteImpact(
      groups.value as BookmarkGroup[],
      bookmarks.value,
      group.id,
    );
    if (!isDirectlyDeletableEmptyFolder(impact)) {
      const message =
        impact.descendantFolderCount > 0
          ? t('bookmark.dialog.deleteFolderConfirmWithDescendants', {
              name: group.name,
              folders: impact.descendantFolderCount,
              bookmarks: impact.affectedBookmarkCount,
            })
          : t('bookmark.dialog.deleteFolderConfirmWithBookmarks', {
              name: group.name,
              bookmarks: impact.affectedBookmarkCount,
            });
      const confirmed = await host.feedback.confirm(message, t('bookmark.action.deleteFolder'));
      if (!confirmed) return;
    }
    await execute({ type: 'delete-group', groupId: group.id });
  };

  const confirmClearCollection = async () => {
    menus.closeAllMenus();
    const totalFolderCount = groups.value.length;
    const totalBookmarkCount = bookmarks.value.length;
    if (totalFolderCount === 0 && totalBookmarkCount === 0) return;

    const confirmed = await host.feedback.confirm(
      t('bookmark.dialog.clearCollectionConfirm', {
        folders: totalFolderCount,
        bookmarks: totalBookmarkCount,
      }),
      t('bookmark.transfer.clearAll'),
    );
    if (!confirmed) return;

    await execute({ type: 'clear-collection' });
  };

  // ── 書籤 ───────────────────────────────────────────────────────
  const captureCurrentSearchSnapshot = async (): Promise<{ url: string; title: string } | null> => {
    let syncedUrl: string;
    try {
      // 官方網址不一定反映剛修改的表單，先寫入再取網址（ADR-0010）
      syncedUrl = await host.navigation.syncUrl();
    } catch (error) {
      host.feedback.toast(error instanceof Error ? error.message : String(error), 'error');
      return null;
    }
    await covers.fetchCurrentTab();
    syncCurrentPageRoute();
    const url = stripLiveSuffix(syncedUrl);
    let rawTitle = covers.currentTabInfo.value.title;
    if (isGenericTradePageTitle(rawTitle, version)) {
      const derived = await deriveSearchTitleFromUrl(url);
      if (derived) rawTitle = derived;
    }
    const title = sanitizeBookmarkName(rawTitle, t('bookmark.defaultPageTitle'));
    if (!url) {
      console.error('[PoeXD] 加入書籤失敗：同步後取得的網址為空');
      await host.feedback.alert(
        t('bookmark.dialog.cannotGetUrl'),
        t('bookmark.dialog.importFailureTitle'),
      );
      return null;
    }
    return { url, title };
  };

  const resolveDefaultCoverImage = (url: string): string | undefined => {
    host.sources.requestCoverCapture();
    return covers.getResultImagesForUrl(url)[0];
  };

  // 新增目前網頁為書籤到指定資料夾
  const addBookmarkToGroup = async (groupId: string) => {
    const snapshot = await captureCurrentSearchSnapshot();
    if (!snapshot) return;
    const coverImageUrl = resolveDefaultCoverImage(snapshot.url);

    const newBm: Omit<Bookmark, 'order'> = {
      id: 'bm_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now(),
      searchRecordId: '',
      name: snapshot.title,
      url: snapshot.url,
      groupId,
      createdAt: Date.now(),
      ...(coverImageUrl ? { coverImageUrl } : {}),
    };

    if (!(await execute({ type: 'add-bookmark', bookmark: newBm }))) return;

    host.feedback.toast(t('bookmark.toast.added', { name: newBm.name }));

    // 自動展開該資料夾，確保能看到新書籤
    await collapse.reveal(groupId);
  };

  // 以目前頁面的搜尋覆蓋現有書籤（保留書籤名稱、既有封面、位置與自訂設定，無確認框）
  const overwriteBookmark = async (bookmark: Bookmark) => {
    menus.activeBookmarkMenuId.value = null;
    const snapshot = await captureCurrentSearchSnapshot();
    if (!snapshot) return;

    if (!parseTradeSearchUrl(snapshot.url)) {
      host.feedback.toast(t('bookmark.toast.overwriteInvalidUrl'), 'error');
      return;
    }

    if (isSameTradeSearchPageUrl(snapshot.url, bookmark.url)) {
      host.feedback.toast(t('bookmark.toast.overwriteUnchanged', { name: bookmark.name }));
      return;
    }

    const fallbackCover = bookmark.coverImageUrl
      ? undefined
      : resolveDefaultCoverImage(snapshot.url);

    const saved = await execute({
      type: 'overwrite-bookmark',
      bookmarkId: bookmark.id,
      url: snapshot.url,
      ...(fallbackCover ? { coverImageUrl: fallbackCover } : {}),
    });
    if (!saved) return;

    if (previewBookmark.value?.id === bookmark.id) closePreview();
    host.feedback.toast(t('bookmark.toast.overwritten', { name: bookmark.name }));
  };

  const moveBookmark = async (id: string, targetGroupId: string) => {
    if (!(await execute({ type: 'move-bookmark', bookmarkId: id, groupId: targetGroupId }))) return;
    menus.activeBookmarkMenuId.value = null;
  };

  const deleteBookmark = async (id: string) => {
    if (!(await execute({ type: 'delete-bookmark', bookmarkId: id }))) return;
    menus.activeBookmarkMenuId.value = null;
  };

  // ── 生命週期 ───────────────────────────────────────────────────
  const stops: Array<() => void> = [];
  let disposed = false;
  const track = (stop: () => void) => {
    if (disposed) stop();
    else stops.push(stop);
  };

  /** 載入資料並開始監聽；`alongside` 與資料載入並行，全部完成才結束載入狀態。 */
  const start = async (startOptions: { alongside?: Promise<unknown> } = {}): Promise<void> => {
    track(covers.startCapture());
    track(collapse.watchStorage());
    try {
      const [, bookmarkOutcome] = await Promise.all([
        startOptions.alongside,
        model.connect(),
        collapse.load(),
      ]);
      if (!bookmarkOutcome.ok) throw new Error(bookmarkOutcome.error.message);
    } finally {
      isLoading.value = false;
    }
    await covers.fetchCurrentTab();
    syncCurrentPageRoute();
    track(host.navigation.subscribeRouteChange(syncCurrentPageRoute));
  };

  const dispose = () => {
    disposed = true;
    stops.splice(0).forEach((stop) => stop());
    model.dispose();
  };

  return {
    start,
    dispose,
    execute,
    /** 匯入完成等情況後，重新解析 Bookmark 目標網址並同步目前頁面路由。 */
    refresh: syncCurrentPageRoute,
    setPreferences,

    tree: {
      groups: groups as ComputedRef<readonly BookmarkGroup[]>,
      bookmarks: bookmarks as ComputedRef<readonly Bookmark[]>,
      isLoading: readonly(isLoading),
      isDragging,
      isDraggingBookmark,
      isCollectionEmpty,
      visibleFolderNodes,
      filteredGroups: search.filteredGroups,
      getFilteredGroupBookmarks: search.getFilteredGroupBookmarks,
      getFolderPath,
      isGroupCollapsed,
      toggleGroupCollapse: collapse.toggleGroupCollapse,
      isAllCollapsed: collapse.isAllCollapsed,
      toggleExpandAll: collapse.toggleExpandAll,
      expandAll: collapse.expandAll,
      collapseAll: collapse.collapseAll,
      hasSubtreeFolders: collapse.hasSubtreeFolders,
      isSubtreeAllCollapsed: collapse.isSubtreeAllCollapsed,
      toggleSubtreeCollapse: collapse.toggleSubtreeCollapse,
      collapsedGroupIds: readonly(collapse.collapsedGroupIds),
      transientExpandedFolderIds,
      isBookmarkDragEnabled,
      sortableKey,
      addBookmarkBtnPosition: readonly(addBookmarkBtnPosition),
      sidebarPosition: readonly(sidebarPosition),
      liveSearchEnabled: readonly(liveSearchEnabled),
      gameVersion: version,
      currentPageUrl: readonly(currentPageUrl),
      search: {
        query: search.searchQuery,
        isVisible: readonly(search.isSearchVisible),
        inputRef: search.searchInputRef,
        open: search.openSearch,
        close: search.closeSearch,
        toggle: search.toggleSearch,
        handleKeydown: search.handleKeydown,
      },
    },

    editing: {
      editingGroupId: editing.editingGroupId,
      editingGroupName: editing.editingGroupName,
      editingBookmarkId: editing.editingBookmarkId,
      editingBookmarkName: editing.editingBookmarkName,
      startRenameGroup: editing.startRenameGroup,
      saveRenameGroup: editing.saveRenameGroup,
      startRenameBookmark: editing.startRenameBookmark,
      saveRenameBookmark: editing.saveRenameBookmark,
    },

    menus: {
      isTransferMenuOpen: menus.isTransferMenuOpen,
      activeGroupMenuId: menus.activeGroupMenuId,
      activeBookmarkMenuId: menus.activeBookmarkMenuId,
      isMoveSubMenu: menus.isMoveSubMenu,
      isCoverSubMenu: menus.isCoverSubMenu,
      closeAll: menus.closeAllMenus,
      setGroupMenuOpen: menus.setGroupMenuOpen,
      setBookmarkMenuOpen: menus.setBookmarkMenuOpen,
      setMoveSubMenuOpen: menus.setMoveSubMenuOpen,
      setCoverSubMenuOpen: menus.setCoverSubMenuOpen,
      handleTriggerClick: menus.handleTriggerClick,
      handleTransferTriggerPointerDown: menus.handleTransferTriggerPointerDown,
      handleGroupTriggerPointerDown: menus.handleGroupTriggerPointerDown,
      handleBookmarkTriggerPointerDown: menus.handleBookmarkTriggerPointerDown,
      requestOpenCoverSubMenu: covers.requestOpenCoverSubMenu,
      handleCoverSubmenuKeydown: covers.handleCoverSubmenuKeydown,
    },

    actions: {
      addGroup,
      addChildFolder,
      setFolderAppearance,
      moveFolder,
      confirmDeleteGroup,
      confirmClearCollection,
      addBookmarkToGroup,
      overwriteBookmark,
      moveBookmark,
      deleteBookmark,
      openBookmark,
      openBookmarkNewTab,
      openBookmarkLiveSearch,
      handleBookmarkPrimaryClick,
      sendBookmarkToLiveSearchConsole,
      sendFolderToLiveSearchConsole,
      // 封面
      getResultImagesForBookmark: covers.getResultImagesForBookmark,
      selectBookmarkCover: covers.selectBookmarkCover,
      removeBookmarkCover: covers.removeBookmarkCover,
      handleCoverImageError: covers.handleCoverImageError,
      // 聯盟
      tradeLeagues: readonly(leagues.tradeLeagues),
      isLeagueLoading: readonly(leagues.isLeagueLoading),
      leagueLoadError: readonly(leagues.leagueLoadError),
      ensureTradeLeaguesLoaded: leagues.ensureTradeLeaguesLoaded,
      confirmReplaceLeague: leagues.confirmReplaceLeague,
      formatTradeLeagueText: leagues.formatTradeLeagueText,
    },

    preview: {
      enableBookmarkTooltip: readonly(enableBookmarkTooltip),
      searchEntryClickAction: readonly(searchEntryClickAction),
      activeBookmarkId,
      activePreviewData,
      activeRawQuery,
      previewBookmark,
      anchorEl: previewAnchorEl,
      isOpen: isPreviewOpen,
      close: closePreview,
      canOpenPreviewSearch,
      isOverwriting: readonly(isOverwritingPreview),
      toggleBookmarkPreview: toggleBookmarkPreviewFromEvent,
      handlePreviewOpenChange,
      handleOpenPreviewSearch,
      handleOverwritePreviewSearch,
    },
  };
}

export type BookmarkWorkspace = ReturnType<typeof createBookmarkWorkspace>;
export type BookmarkWorkspaceTree = BookmarkWorkspace['tree'];
export type BookmarkWorkspaceEditing = BookmarkWorkspace['editing'];
export type BookmarkWorkspaceMenus = BookmarkWorkspace['menus'];
export type BookmarkWorkspaceActions = BookmarkWorkspace['actions'];
export type BookmarkWorkspacePreview = BookmarkWorkspace['preview'];
