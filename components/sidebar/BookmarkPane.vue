<template>
  <SidebarPane ref="sidebarPaneRef" class="bookmark-pane" scroll-mode="external">
    <template #fixed>
      <!-- 上方控制區：左側新增資料夾，右側展開與匯入匯出操作 -->
      <div
        class="flex items-center gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full max-w-full min-w-0"
      >
        <Button
          variant="default"
          size="sm"
          class="flex-1 font-bold"
          :title="t('bookmark.action.newFolder')"
          @click="addGroup()"
        >
          <FolderPlus />
          <span class="pxd-toolbar-btn-text ml-1.5 truncate">{{
            t('bookmark.action.newFolder')
          }}</span>
        </Button>
        <div class="flex items-center gap-[var(--pxd-space-sm)] shrink-0">
          <Button
            variant="secondary"
            size="sm"
            class="font-bold"
            :title="
              isAllCollapsed ? t('bookmark.action.expandAll') : t('bookmark.action.collapseAll')
            "
            @click="toggleExpandAll"
          >
            <ChevronsUpDown />
            <span class="pxd-toolbar-btn-text ml-1.5 truncate">
              {{
                isAllCollapsed ? t('bookmark.action.expandAll') : t('bookmark.action.collapseAll')
              }}
            </span>
          </Button>
          <Button
            :variant="isSearchVisible ? 'default' : 'secondary'"
            size="icon-sm"
            :title="
              isSearchVisible ? t('bookmark.search.closeTooltip') : t('bookmark.search.tooltip')
            "
            @click="toggleSearch"
          >
            <Search />
          </Button>
          <div class="dropdown-menu-container" data-bookmark-transfer-menu>
            <DropdownMenu v-model:open="isTransferMenuOpen">
              <DropdownMenuTrigger as-child>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  :title="
                    t('bookmark.transfer.menuTooltip') /* title=&quot;書籤匯入匯出操作&quot; */
                  "
                  @pointerdown.capture="handleTransferTriggerPointerDown"
                  @click.capture="handleTriggerClick"
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent v-if="isTransferMenuOpen" align="end">
                <DropdownMenuItem @click="openImportDialog">
                  <Upload class="text-muted-foreground" />
                  <!-- 匯入書籤… -->
                  {{ t('bookmark.transfer.import') }}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem @click="copyTransfer('collection')">
                  <Copy class="text-muted-foreground" />
                  <!-- 複製分享碼 -->
                  {{ t('bookmark.transfer.copyShareCode') }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="exportBookmarks">
                  <Download class="text-muted-foreground" />
                  <!-- 下載備份檔 -->
                  {{ t('bookmark.transfer.downloadBackup') }}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuSub
                  @update:open="
                    (open) => {
                      if (open) ensureTradeLeaguesLoaded();
                    }
                  "
                >
                  <DropdownMenuSubTrigger @mouseenter="ensureTradeLeaguesLoaded">
                    <RefreshCw class="text-muted-foreground" />
                    <!-- 替換全部書籤聯盟 -->
                    {{ t('bookmark.transfer.replaceLeague') }}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    class="w-[var(--pxd-menu-sub-width,192px)] max-h-60 max-h-[min(var(--pxd-menu-max-height,240px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto pxd-scrollbar"
                  >
                    <div
                      v-if="isLeagueLoading"
                      class="league-menu-status text-muted-foreground py-[var(--pxd-space-sm)] px-[var(--pxd-space-lg)] text-[length:var(--pxd-font-caption)] whitespace-nowrap"
                    >
                      {{ t('bookmark.transfer.loadingLeagues') }}
                    </div>
                    <div
                      v-else-if="leagueLoadError"
                      class="league-menu-status error text-destructive py-[var(--pxd-space-sm)] px-[var(--pxd-space-lg)] text-[length:var(--pxd-font-caption)] break-words"
                    >
                      {{ leagueLoadError }}
                    </div>
                    <DropdownMenuItem
                      v-for="league in tradeLeagues"
                      :key="league.id"
                      :title="formatTradeLeagueText(league)"
                      @click="confirmReplaceLeague('collection', league)"
                    >
                      <span class="min-w-0 flex-1 truncate">{{
                        formatTradeLeagueText(league)
                      }}</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  variant="destructive"
                  :disabled="isCollectionEmpty"
                  @click="confirmClearCollection"
                >
                  <Trash2 class="text-destructive" />
                  {{ t('bookmark.transfer.clearAll') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Separator class="mb-[var(--pxd-space-md)]" />

      <!-- 搜尋篩選器 -->
      <div v-if="isSearchVisible" class="relative mb-[var(--pxd-space-md)] flex items-center">
        <Search
          class="pointer-events-none absolute left-2.5 size-[var(--control-icon-sm,14px)] text-muted-foreground"
        />
        <Input
          ref="searchInputRef"
          v-model="searchQuery"
          size="sm"
          :placeholder="t('bookmark.search.placeholder')"
          class="w-full pl-8 pr-7"
          @keydown.esc.stop.prevent="closeSearch"
        />
        <Button
          v-if="searchQuery"
          variant="ghost"
          size="icon-sm"
          class="absolute right-1"
          :title="t('bookmark.search.clearTooltip') /* title=&quot;清除搜尋&quot; */"
          @click="searchQuery = ''"
        >
          <X />
        </Button>
      </div>
    </template>

    <template #scroll>
      <!-- 書籤列表展示區 -->
      <TooltipProvider :delay-duration="200" :skip-delay-duration="150">
        <ScrollAreaRoot class="flex-1 box-border h-full min-h-0 relative overflow-hidden">
          <ScrollAreaViewport
            class="bookmark-accordion-list flex flex-col gap-[var(--pxd-bookmark-tree-gap)] box-border h-full w-full min-h-0 px-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] pt-0"
          >
            <!-- 無任何書籤的全局提示 -->
            <div
              v-if="isLoading"
              class="empty-state text-center text-muted-foreground text-[length:var(--pxd-font-caption)] py-[var(--pxd-space-2xl)]"
              key="loading"
            >
              {{ t('bookmark.empty.loading') }}
            </div>
            <div
              v-else-if="groups.length === 0"
              class="empty-state flex flex-col items-center justify-center gap-3 text-center text-muted-foreground py-[var(--pxd-space-2xl)] px-4"
              key="empty"
            >
              <div class="text-[length:var(--pxd-font-caption)]">
                {{ t('bookmark.empty.noBookmarks') }}
              </div>
              <div class="flex items-center gap-2">
                <Button variant="default" size="sm" @click="addGroup()">
                  {{ t('bookmark.action.newFolder') }}
                </Button>
                <Button variant="secondary" size="sm" @click="openImportDialog">
                  {{ t('bookmark.transfer.import') }}
                </Button>
              </div>
            </div>
            <template v-else key="groups-content">
              <div
                :key="listRenderKey"
                class="bookmark-sortable-root flex flex-col gap-[var(--pxd-bookmark-tree-gap)] w-full shrink-0"
              >
                <!-- 資料夾扁平視覺樹 (Flat Visual Tree) -->
                <BookmarkFolderNode
                  v-for="item in visibleFolderNodes"
                  :key="item.folder.id"
                  :node="item"
                />
              </div>
            </template>
          </ScrollAreaViewport>
          <ScrollBar />
          <ScrollAreaCorner />
        </ScrollAreaRoot>
        <!-- 全域單例書籤預覽（點擊切換，見 CONTEXT.md「Search Preview」） -->
        <TradeSearchPreviewPopover
          :open="isPreviewOpen"
          :side="sidebarPosition === 'left' ? 'right' : 'left'"
          :preview-data="activePreviewData"
          :reference="previewAnchorEl"
          :source-name="previewBookmark?.name ?? ''"
          @update:open="
            (val) => {
              if (!val) closePreview();
            }
          "
        />
      </TooltipProvider>

      <!-- 拖曳刪除垃圾桶區 -->
      <DragTrashZone
        :ref="(c: any) => (trashZone = c ? c.$el : null)"
        :visible="isDragging"
        :over-trash="isOverTrash"
        :sidebar-position="sidebarPosition"
        :style="trashStyle"
      >
        <div
          v-if="activeDragEntity?.kind === 'folder' && liveFolderDeleteImpact"
          class="flex flex-col items-center justify-center text-center leading-tight gap-1 select-none"
        >
          <!-- 放開以刪除 -->
          <span class="text-xs font-bold leading-normal">{{ t('sidebar.trash.releaseHint') }}</span>
          <!-- 個資料夾 -->
          <span class="text-[11px] font-semibold opacity-90 leading-tight">
            {{ liveFolderDeleteImpact.totalFolderCount }} {{ t('bookmarkImport.unit.folders') }}
          </span>
          <!-- 個書籤 -->
          <span class="text-[11px] font-semibold opacity-90 leading-tight">
            {{ liveFolderDeleteImpact.affectedBookmarkCount }}
            {{ t('bookmarkImport.unit.bookmarks') }}
          </span>
        </div>
        <div
          v-else-if="activeDragEntity?.kind === 'bookmark'"
          class="text-center text-xs font-bold leading-snug select-none"
        >
          <!-- 放開以刪除書籤 -->
          {{ t('bookmark.row.delete') }}
        </div>
        <!-- 放開以刪除 -->
        <div v-else class="text-center text-xs font-bold leading-snug select-none">
          {{ t('sidebar.trash.releaseHint') }}
        </div>
      </DragTrashZone>

      <!-- 書籤匯入對話框 -->
      <BookmarkImportDialog
        v-model:open="isImportDialogOpen"
        :version="version"
        :current-collection="{ groups, bookmarks }"
        @import="handleExecuteImport"
      />
    </template>
  </SidebarPane>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted, computed, watch, provide } from 'vue';
import { describeBookmarkImportFailure } from '@/utils/bookmark-transfer-messages';
import { t } from '@/utils/i18n';
import SidebarPane from './layout/SidebarPane.vue';
import DragTrashZone from './layout/DragTrashZone.vue';
import BookmarkFolderNode from './BookmarkFolderNode.vue';
import {
  buildFolderTree,
  type FolderTreeNode,
  BOOKMARK_PANE_CONTEXT_KEY,
  type BookmarkPaneContext,
} from './bookmark-tree';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ChevronsUpDown,
  FolderPlus,
  MoreVertical,
  Trash2,
  Search,
  X,
  Copy,
  Upload,
  Download,
  RefreshCw,
} from '@lucide/vue';
import {
  calculateDragTrashPosition,
  hideDragTrash,
  showDragTrash,
  useDragTrash,
} from './composables/useDragTrash';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import type { Bookmark, BookmarkGroup } from './bookmark-types';
import { createBookmarkModel, type BookmarkMutationIntent } from './bookmark-model';
import { readBookmarkTargetContext, resolveBookmarkUrl } from '@/utils/bookmark-target';
import { useBookmarkSortables } from './composables/useBookmarkSortables';
import { rowAnchorFromEvent } from './composables/usePinnedPreview';
import { stripLiveSuffix, toLiveUrl } from '@/utils/trade-search-identity';
import { syncFormToUrl } from '@/entrypoints/content/logic/form-url-sync';
import {
  BOOKMARK_NAME_MAX_LENGTH,
  sanitizeBookmarkName,
  getFolderDeleteImpact,
  getFolderSubtreeIds,
  isDirectlyDeletableEmptyFolder,
  formatFolderPath,
} from '@/utils/bookmark-collection';
import { extensionMessaging } from '@/utils/extension-protocol';
import { useBookmarkPreview } from './composables/useBookmarkPreview';
import { useBookmarkMenuState } from './composables/useBookmarkMenuState';
import { useBookmarkCovers } from './composables/useBookmarkCovers';
import { useBookmarkSearch } from './composables/useBookmarkSearch';
import { useBookmarkCollapse } from './composables/useBookmarkCollapse';
import { useBookmarkEditing } from './composables/useBookmarkEditing';
import { useBookmarkLeagues } from './composables/useBookmarkLeagues';
import { DEFAULT_PREFERENCES, type SearchEntryClickAction } from '@/utils/preferences-contract';
import { getPreferences } from '@/utils/preferences';
import { createVersionedStorageKeys } from '@/utils/storage-contracts';
import { getPoeVersion } from '@/utils/trade-context';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import {
  createBookmarkTransferWorkflow,
  createBrowserBookmarkTransferHost,
} from './bookmark-transfer-workflow';
import BookmarkImportDialog from './BookmarkImportDialog.vue';
import TradeSearchPreviewPopover from './search-preview/TradeSearchPreviewPopover.vue';
import { resolveSingleEnqueueToast } from './live-search-presentation';
import type { BookmarkTransferPayload, BookmarkImportMode } from '@/utils/bookmark-transfer';

export default defineComponent({
  name: 'BookmarkPane',
  components: {
    SidebarPane,
    DragTrashZone,
    BookmarkFolderNode,
    BookmarkImportDialog,
    TradeSearchPreviewPopover,
    TooltipProvider,
    ScrollAreaRoot,
    ScrollAreaViewport,
    ScrollBar,
    ScrollAreaCorner,
    Button,
    Input,
    Separator,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuSeparator,
    FolderPlus,
    ChevronsUpDown,
    MoreVertical,
    Trash2,
    Search,
    X,
    Copy,
    Upload,
    Download,
    RefreshCw,
  },
  setup() {
    const sidebarPaneRef = ref<any>(null);
    const paneRoot = computed(() => (sidebarPaneRef.value?.$el as HTMLElement | null) ?? null);
    let initSortable = async () => {};
    const version = getPoeVersion();
    const keys = createVersionedStorageKeys(version);
    const bookmarkModel = createBookmarkModel(createChromeBookmarkClient(version));
    const bookmarks = computed(() => bookmarkModel.state.value.bookmarks);
    const groups = computed(() => bookmarkModel.state.value.groups);
    const addBookmarkBtnPosition = ref<'top' | 'bottom'>('bottom');
    const enableBookmarkTooltip = ref<boolean>(DEFAULT_PREFERENCES.enableBookmarkTooltip);
    const searchEntryClickAction = ref<SearchEntryClickAction>(
      DEFAULT_PREFERENCES.searchEntryClickAction,
    );
    const sidebarPosition = ref<'left' | 'right'>('left');
    const isLoading = ref(true);
    let stopPreferences: (() => void) | undefined;

    const executeBookmarkIntent = async (intent: BookmarkMutationIntent) => {
      const outcome = await bookmarkModel.execute(intent);
      if (!outcome.ok) {
        await (window as any).poexdAlert(
          t('bookmark.dialog.saveFailure', { message: outcome.error.message }),
          t('bookmark.dialog.saveFailureTitle'),
        );
      }
      return outcome.ok;
    };
    // 搜尋 Composable
    const {
      searchQuery,
      isSearchVisible,
      searchInputRef,
      openSearch,
      closeSearch,
      toggleSearch,
      filteredGroups,
      getFilteredGroupBookmarks,
    } = useBookmarkSearch({
      groups,
      bookmarks,
    });
    const isBookmarkDragEnabled = computed(() => searchQuery.value.trim() === '');
    const listRenderKey = ref(0);
    let trashCleanup: (() => void) | null = null;

    // 導入拖曳垃圾桶 Composable
    const {
      trashZone,
      isDragging,
      isOverTrash,
      activeDragEntity,
      setDragEntity,
      trashStyle,
      enableDragScrollBlock,
      disableDragScrollBlock,
      setupTrashListeners,
    } = useDragTrash('.bookmark-accordion-list');

    const isDraggingBookmark = computed(() => activeDragEntity.value?.kind === 'bookmark');

    const showTrash = () => {
      if (!trashZone.value) return;
      showDragTrash(trashZone.value);
    };
    const hideTrash = () => {
      if (trashZone.value) hideDragTrash(trashZone.value);
    };

    // 當前作用中選單狀態
    const {
      isTransferMenuOpen,
      activeGroupMenuId,
      activeBookmarkMenuId,
      isMoveSubMenu,
      isCoverSubMenu,
      closeAllMenus,
      setGroupMenuOpen,
      setBookmarkMenuOpen,
      setMoveSubMenuOpen,
      setCoverSubMenuOpen,
      handleTriggerClick,
      handleTransferTriggerPointerDown,
      handleGroupTriggerPointerDown,
      handleBookmarkTriggerPointerDown,
    } = useBookmarkMenuState();
    const showToast = (message: string) => {
      dispatchPoeEvent('poexd-toast', {
        message,
        tone: 'default',
        durationMs: 3000,
      });
    };

    // 重新命名 Composable
    const {
      editingGroupId,
      editingGroupName,
      editingBookmarkId,
      editingBookmarkName,
      startRenameGroup,
      saveRenameGroup,
      startRenameBookmark,
      saveRenameBookmark,
    } = useBookmarkEditing({
      executeBookmarkIntent,
      activeGroupMenuId,
      activeBookmarkMenuId,
    });

    // 手風琴摺疊管理 Composable
    const {
      collapsedGroupIds,
      loadCollapsedGroups,
      saveCollapsedGroups,
      isGroupCollapsed: rawIsGroupCollapsed,
      toggleGroupCollapse,
      expandAll,
      collapseAll,
      toggleExpandAll,
      isAllCollapsed,
      hasSubtreeFolders,
      isSubtreeAllCollapsed,
      toggleSubtreeCollapse,
    } = useBookmarkCollapse({
      groups,
      searchQuery,
      storageKey: keys.bookmarkCollapsedGroups,
      initSortable: () => initSortable(),
      isEditing: (id) => editingGroupId.value === id,
    });

    // 拖曳中暫時自動展開的資料夾集合 (零 storage 寫入，零 Sortable destroy/re-init)
    const transientExpandedFolderIds = ref<Set<string>>(new Set());

    const isGroupCollapsed = (groupId: string): boolean => {
      if (transientExpandedFolderIds.value.has(groupId)) return false;
      return rawIsGroupCollapsed(groupId);
    };

    const sortableController = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey,
      trashZone,
      isDragging,
      isOverTrash,
      enableDragScrollBlock,
      disableDragScrollBlock,
      showTrash,
      hideTrash,
      execute: executeBookmarkIntent,
      containerRef: paneRoot,
      isDragEnabled: isBookmarkDragEnabled,
      collapsedGroupIds,
      transientExpandedFolderIds,
      setDragEntity,
    });

    const liveFolderDeleteImpact = computed(() => {
      if (activeDragEntity.value?.kind !== 'folder' || !activeDragEntity.value.id) {
        return null;
      }
      return getFolderDeleteImpact(
        groups.value as BookmarkGroup[],
        bookmarks.value,
        activeDragEntity.value.id,
      );
    });
    initSortable = sortableController.init;
    const destroySortables = sortableController.destroy;
    const sortableStructure = computed(() =>
      [
        isBookmarkDragEnabled.value ? 'drag-enabled' : 'drag-disabled',
        groups.value.map((group) => `${group.id}:${group.parentId ?? ''}:${group.order}`).join(','),
        bookmarks.value
          .map((bookmark) => `${bookmark.id}:${bookmark.groupId}:${bookmark.order}`)
          .join(','),
      ].join('|'),
    );
    watch(
      [sortableStructure, isLoading],
      ([, loading]) => {
        if (!loading) void initSortable();
      },
      { flush: 'post' },
    );

    // 監聽拖曳垃圾桶 DOM
    watch(trashZone, (newVal) => {
      if (trashCleanup) {
        trashCleanup();
        trashCleanup = null;
      }
      if (newVal) {
        trashCleanup = setupTrashListeners(newVal);
      }
    });

    // 封面管理 Composable
    const {
      resultImagesUrl,
      resultImages,
      currentTabInfo,
      fetchCurrentTab,
      getResultImagesForUrl,
      getResultImagesForBookmark,
      requestOpenCoverSubMenu,
      handleCoverSubmenuKeydown,
      selectBookmarkCover,
      removeBookmarkCover,
      handleCoverImageError,
    } = useBookmarkCovers({
      executeBookmarkIntent,
      activeBookmarkMenuId,
      isMoveSubMenu,
      isCoverSubMenu,
      closeAllMenus,
    });

    // 聯盟更換 Composable
    const {
      tradeLeagues,
      isLeagueLoading,
      leagueLoadError,
      ensureTradeLeaguesLoaded,
      confirmReplaceLeague,
      formatTradeLeagueText,
    } = useBookmarkLeagues({
      version,
      bookmarks,
      executeBookmarkIntent,
      closeAllMenus,
      showToast: (msg) => showToast(msg),
    });

    const isCollectionEmpty = computed(
      () => groups.value.length === 0 && bookmarks.value.length === 0,
    );

    const confirmClearCollection = async () => {
      closeAllMenus();
      const totalFolderCount = groups.value.length;
      const totalBookmarkCount = bookmarks.value.length;
      if (totalFolderCount === 0 && totalBookmarkCount === 0) return;

      const message = t('bookmark.dialog.clearCollectionConfirm', {
        folders: totalFolderCount,
        bookmarks: totalBookmarkCount,
      });
      const confirmed = await (window as any).poexdConfirm?.(
        message,
        t('bookmark.dialog.clearCollectionTitle'),
      );
      if (!confirmed) return;

      await executeBookmarkIntent({ type: 'clear-collection' });
    };

    const refreshBookmarkTargets = () => bookmarkModel.refreshTargetContext();

    const loadData = async () => {
      const [preferencesOutcome, bookmarkOutcome] = await Promise.all([
        getPreferences(version),
        bookmarkModel.connect(),
        loadCollapsedGroups(),
      ]);
      if (!preferencesOutcome.ok) throw new Error(preferencesOutcome.error.message);
      if (!bookmarkOutcome.ok) throw new Error(bookmarkOutcome.error.message);
      stopPreferences?.();
      stopPreferences = preferencesOutcome.value.subscribe((snapshot) => {
        addBookmarkBtnPosition.value = snapshot.addBookmarkBtnPosition;
        enableBookmarkTooltip.value = snapshot.enableBookmarkTooltip;
        searchEntryClickAction.value = snapshot.searchEntryClickAction;
        sidebarPosition.value = snapshot.sidebarPosition;
      });
    };

    // 載入資料
    onMounted(async () => {
      try {
        await loadData();
      } finally {
        isLoading.value = false;
      }
      await fetchCurrentTab();
      window.addEventListener('popstate', refreshBookmarkTargets);
    });

    onUnmounted(() => {
      window.removeEventListener('popstate', refreshBookmarkTargets);
      bookmarkModel.dispose();
      stopPreferences?.();
      stopPreferences = undefined;
      destroySortables();
      if (trashCleanup) {
        trashCleanup();
      }
      disableDragScrollBlock();
    });

    const isImportDialogOpen = ref(false);
    const openImportDialog = () => {
      closeAllMenus();
      isImportDialogOpen.value = true;
    };

    const handleExecuteImport = async (event: {
      payload: BookmarkTransferPayload;
      mode: BookmarkImportMode;
      targetGroupId?: string;
    }) => {
      const outcome = await bookmarkModel.execute({
        type: 'import-transfer',
        payload: event.payload,
        mode: event.mode,
        targetGroupId: event.targetGroupId,
      });
      if (outcome.ok) {
        showToast(t('bookmark.toast.imported'));
      } else {
        await (window as any).poexdAlert(
          t('bookmark.dialog.importFailureMessage', {
            error: describeBookmarkImportFailure(outcome.error),
          }),
          t('bookmark.dialog.importFailureTitle'),
        );
      }
    };

    const bookmarkTransferWorkflow = createBookmarkTransferWorkflow({
      model: bookmarkModel,
      host: createBrowserBookmarkTransferHost({
        closeMenus: closeAllMenus,
        showToast: (msg) => showToast(msg),
      }),
    });

    // 開啟書籤 (當前分頁前往)
    // 開啟時以當下網域與聯盟重新解析，避免投影後頁面已切換聯盟
    const resolveOpenUrl = (bookmark: Bookmark) =>
      resolveBookmarkUrl(
        bookmark.canonicalUrl ?? bookmark.url,
        { leaguePinned: bookmark.leaguePinned },
        readBookmarkTargetContext(),
      );

    const openBookmark = (bookmark: Bookmark) => {
      const url = resolveOpenUrl(bookmark);
      if (!url) return;
      window.location.href = url;
    };

    // 在新分頁開啟書籤
    const openBookmarkNewTab = (bookmark: Bookmark) => {
      const url = resolveOpenUrl(bookmark);
      if (!url) return;
      window.open(url, '_blank');
      closeAllMenus();
    };

    // 使用線上搜尋開啟書籤 (新分頁開啟官方 /live URL)
    const openBookmarkLiveSearch = (bookmark: Bookmark) => {
      const url = resolveOpenUrl(bookmark);
      if (!url) return;
      window.open(toLiveUrl(url), '_blank');
      closeAllMenus();
    };

    // 將單一書籤送入線上搜尋主控台（背景遞交，不搶焦點）
    const sendBookmarkToLiveSearchConsole = async (bookmark: Bookmark) => {
      closeAllMenus();
      const url = resolveOpenUrl(bookmark);
      if (!url) {
        showToast(t('bookmark.toast.cannotResolveUrl'));
        return;
      }
      try {
        const res = await extensionMessaging.sendMessage('liveSearch:enqueueConnections', {
          gameVersion: version,
          items: [
            {
              url,
              name: bookmark.name,
              coverImageUrl: bookmark.coverImageUrl,
              sourceBookmarkId: bookmark.id,
            },
          ],
        });
        showToast(resolveSingleEnqueueToast(res, bookmark.name).message);
      } catch (err) {
        showToast(err instanceof Error ? err.message : t('bookmark.toast.sendToConsoleFailed'));
      }
    };

    // 將整個資料夾（含子樹）的書籤送入線上搜尋主控台（背景遞交，不搶焦點）
    const sendFolderToLiveSearchConsole = async (folder: BookmarkGroup) => {
      closeAllMenus();
      const subtreeFolderIds = new Set(
        getFolderSubtreeIds(groups.value as BookmarkGroup[], folder.id),
      );
      const targetBookmarks = bookmarks.value.filter((bm) => subtreeFolderIds.has(bm.groupId));
      if (targetBookmarks.length === 0) {
        showToast(t('bookmark.toast.folderNoBookmarks'));
        return;
      }

      const items = targetBookmarks
        .map((bm) => {
          const url = resolveOpenUrl(bm);
          if (!url) return null;
          return {
            url,
            name: bm.name,
            coverImageUrl: bm.coverImageUrl,
            sourceBookmarkId: bm.id,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (items.length === 0) {
        showToast(t('bookmark.toast.folderNoValidUrls'));
        return;
      }

      try {
        const res = await extensionMessaging.sendMessage('liveSearch:enqueueConnections', {
          gameVersion: version,
          items,
        });
        if (!res.success) {
          showToast(res.error || t('bookmark.toast.sendToConsoleFailed'));
        } else if (res.created) {
          showToast(t('bookmark.toast.sentWithCreated', { count: items.length }));
        } else {
          const added = res.addedCount ?? items.length;
          const skipped = res.skippedCount ?? 0;
          const parts = [t('bookmark.toast.sentCount', { count: added })];
          if (skipped > 0) parts.push(t('bookmark.toast.skippedCount', { count: skipped }));
          showToast(parts.join(' · '));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : t('bookmark.toast.sendToConsoleFailed'));
      }
    };

    // 新增資料夾（若有 parentId 則為子資料夾，否則為 root folder）
    const addGroup = async (parentId?: unknown) => {
      const resolvedParentId = typeof parentId === 'string' ? parentId : undefined;
      const siblings = groups.value.filter((g) => g.parentId === resolvedParentId);
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
        ...(resolvedParentId !== undefined ? { parentId: resolvedParentId } : {}),
      };

      if (!(await executeBookmarkIntent({ type: 'add-group', group: newGrp }))) return;

      if (resolvedParentId) {
        collapsedGroupIds.value.delete(resolvedParentId);
        await saveCollapsedGroups();
      }
    };

    const addChildGroup = (parentFolderId: string) => addGroup(parentFolderId);

    const moveFolder = async (folderId: string, targetFolderId?: string) => {
      activeGroupMenuId.value = null;
      if (targetFolderId !== undefined) {
        const saved = await executeBookmarkIntent({
          type: 'move-folder',
          folderId,
          dropIntent: {
            targetFolderId,
            position: 'inside',
          },
        });
        if (!saved) return;
        collapsedGroupIds.value.delete(targetFolderId);
        await saveCollapsedGroups();
      } else {
        const rootFolders = (groups.value as BookmarkGroup[])
          .filter((f) => f.parentId === undefined && f.id !== folderId)
          .sort((a, b) => a.order - b.order);
        const lastRoot = rootFolders[rootFolders.length - 1];
        if (!lastRoot) return;
        const saved = await executeBookmarkIntent({
          type: 'move-folder',
          folderId,
          dropIntent: {
            targetFolderId: lastRoot.id,
            position: 'after',
          },
        });
        if (!saved) return;
      }
    };

    // 刪除資料夾時直接一併刪除書籤及子資料夾（提示完整 cascade 範圍；真正的空 leaf folder 則直接刪除不彈窗）
    const confirmDeleteGroup = async (group: BookmarkGroup) => {
      activeGroupMenuId.value = null; // 關閉選單
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
        const confirm = await (window as any).poexdConfirm(
          message,
          t('bookmark.dialog.deleteFolderTitle'),
        );
        if (!confirm) return;
      }

      if (!(await executeBookmarkIntent({ type: 'delete-group', groupId: group.id }))) return;
    };

    const getFolderPath = (folderId: string) =>
      formatFolderPath(groups.value as BookmarkGroup[], folderId);

    // 新增目前網頁為書籤到指定資料夾
    const addBookmarkToGroup = async (groupId: string) => {
      let syncedUrl: string;
      try {
        // 官方網址不一定反映剛修改的表單，先寫入再取網址（ADR-0010）
        syncedUrl = await syncFormToUrl();
      } catch (error) {
        dispatchPoeEvent('poexd-toast', {
          message: error instanceof Error ? error.message : String(error),
          tone: 'error',
        });
        return;
      }
      await fetchCurrentTab();
      const url = stripLiveSuffix(syncedUrl);
      const title = sanitizeBookmarkName(
        currentTabInfo.value.title,
        t('bookmark.defaultPageTitle'),
      );
      if (!url) {
        await (window as any).poexdAlert(
          t('bookmark.dialog.cannotGetUrl'),
          t('bookmark.dialog.importFailureTitle'),
        );
        return;
      }
      dispatchPoeEvent('poexd-request-result-images');
      const coverImageUrl = getResultImagesForUrl(url)[0];

      const newBm: Bookmark = {
        id: 'bm_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now(),
        searchRecordId: '',
        name: title,
        url,
        groupId,
        order: bookmarks.value.length,
        createdAt: Date.now(),
        ...(coverImageUrl ? { coverImageUrl } : {}),
      };

      const saved = await executeBookmarkIntent({ type: 'add-bookmark', bookmark: newBm });
      if (!saved) return;

      // 自動展開該資料夾，確保能看到新書籤
      collapsedGroupIds.value.delete(groupId);
      await saveCollapsedGroups();
      await initSortable();
    };

    // 移動書籤資料夾
    const moveBookmark = async (id: string, targetGroupId: string) => {
      if (
        !(await executeBookmarkIntent({
          type: 'move-bookmark',
          bookmarkId: id,
          groupId: targetGroupId,
        }))
      )
        return;
      activeBookmarkMenuId.value = null; // 關閉選單
    };

    // 刪除書籤
    const deleteBookmark = async (id: string) => {
      if (!(await executeBookmarkIntent({ type: 'delete-bookmark', bookmarkId: id }))) return;
      activeBookmarkMenuId.value = null; // 關閉選單
    };

    const copyTransfer = (scope: 'collection' | 'folder', groupId?: string) =>
      bookmarkTransferWorkflow.run({ type: 'copy', scope, groupId });

    // 下載與分享碼使用相同的 Bookmark Transfer envelope。
    const exportBookmarks = () => bookmarkTransferWorkflow.run({ type: 'download' });

    const {
      activeBookmarkId,
      activePreviewData,
      loadBookmarkPreview,
      clearActivePreview,
      previewBookmark,
      previewAnchorEl,
      isPreviewOpen,
      toggleBookmarkPreview,
      closePreview,
    } = useBookmarkPreview({
      isDragging,
      editingBookmarkId,
      version,
      enableBookmarkTooltip,
    });

    /** 以事件來源所在的書籤列作為預覽錨點。 */
    const toggleBookmarkPreviewFromEvent = (bm: Bookmark, event: Event) => {
      if (!enableBookmarkTooltip.value) return;
      toggleBookmarkPreview(bm, rowAnchorFromEvent(event, '.bookmark-row-item'));
    };

    /** 左鍵點書籤名稱：依 Preference 開啟搜尋或切換預覽。 */
    const handleBookmarkPrimaryClick = (bm: Bookmark, event: Event) => {
      if (searchEntryClickAction.value === 'preview' && enableBookmarkTooltip.value) {
        toggleBookmarkPreviewFromEvent(bm, event);
        return;
      }
      openBookmark(bm);
    };

    const handlePreviewOpenChange = (bm: Bookmark, open: boolean) => {
      if (!enableBookmarkTooltip.value) return;
      if (open) {
        if (isDragging.value || editingBookmarkId.value === bm.id) return;
        loadBookmarkPreview(bm);
      } else {
        clearActivePreview(bm.id);
      }
    };

    const visibleFolderNodes = computed(() => {
      const tree = buildFolderTree(filteredGroups.value);
      const result: Array<{ folder: BookmarkGroup; depth: number }> = [];

      function traverse(nodes: FolderTreeNode[]) {
        for (const node of nodes) {
          result.push({
            folder: node.folder,
            depth: node.depth,
          });
          if (!isGroupCollapsed(node.folder.id) && node.children.length > 0) {
            traverse(node.children);
          }
        }
      }

      traverse(tree);
      return result;
    });

    provide<BookmarkPaneContext>(BOOKMARK_PANE_CONTEXT_KEY, {
      groups,
      bookmarks,
      isDragging,
      isDraggingBookmark,
      editingGroupId,
      editingGroupName,
      startRenameGroup,
      saveRenameGroup,
      editingBookmarkId,
      editingBookmarkName,
      startRenameBookmark,
      saveRenameBookmark,
      activeGroupMenuId,
      setGroupMenuOpen,
      handleGroupTriggerPointerDown,
      activeBookmarkMenuId,
      setBookmarkMenuOpen,
      handleBookmarkTriggerPointerDown,
      isMoveSubMenu,
      setMoveSubMenuOpen,
      isCoverSubMenu,
      setCoverSubMenuOpen,
      requestOpenCoverSubMenu,
      handleCoverSubmenuKeydown,
      isGroupCollapsed,
      toggleGroupCollapse,
      addBookmarkBtnPosition,
      enableBookmarkTooltip,
      sidebarPosition,
      tradeLeagues,
      isLeagueLoading,
      leagueLoadError,
      ensureTradeLeaguesLoaded,
      confirmReplaceLeague,
      formatTradeLeagueText,
      addBookmarkToGroup,
      addChildFolder: addChildGroup,
      confirmDeleteGroup,
      openBookmark,
      openBookmarkNewTab,
      openBookmarkLiveSearch,
      sendBookmarkToLiveSearchConsole,
      sendFolderToLiveSearchConsole,
      moveBookmark,
      deleteBookmark,
      copyTransfer: (scope, groupId) => copyTransfer(scope, groupId),
      getFilteredGroupBookmarks,
      getFolderPath,
      activeBookmarkId,
      activePreviewData,
      handlePreviewOpenChange,
      handleCoverImageError,
      getResultImagesForBookmark,
      selectBookmarkCover,
      removeBookmarkCover,
      hasSubtreeFolders,
      isSubtreeAllCollapsed,
      toggleSubtreeCollapse,
      moveFolder,
      handleTriggerClick,
      searchEntryClickAction,
      toggleBookmarkPreview: toggleBookmarkPreviewFromEvent,
      handleBookmarkPrimaryClick,
    });

    return {
      t,
      sidebarPaneRef,
      paneRoot,
      bookmarks,
      groups,
      visibleFolderNodes,
      isLoading,
      isDragging,
      isDraggingBookmark,
      listRenderKey,
      editingGroupId,
      editingGroupName,
      editingBookmarkId,
      editingBookmarkName,
      BOOKMARK_NAME_MAX_LENGTH,
      activeGroupMenuId,
      activeBookmarkMenuId,
      isAllCollapsed,
      openBookmark,
      openBookmarkNewTab,
      openBookmarkLiveSearch,
      sendBookmarkToLiveSearchConsole,
      sendFolderToLiveSearchConsole,
      addGroup,
      setGroupMenuOpen,
      setBookmarkMenuOpen,
      setMoveSubMenuOpen,
      setCoverSubMenuOpen,
      handleTriggerClick,
      handleTransferTriggerPointerDown,
      handleGroupTriggerPointerDown,
      handleBookmarkTriggerPointerDown,
      requestOpenCoverSubMenu,
      handleCoverSubmenuKeydown,
      startRenameGroup,
      saveRenameGroup,
      startRenameBookmark,
      saveRenameBookmark,
      confirmDeleteGroup,
      addBookmarkToGroup,
      moveBookmark,
      deleteBookmark,
      isCoverSubMenu,
      getResultImagesForBookmark,
      selectBookmarkCover,
      removeBookmarkCover,
      handleCoverImageError,
      isGroupCollapsed,
      toggleGroupCollapse,
      toggleExpandAll,
      expandAll,
      collapseAll,
      isTransferMenuOpen,
      ensureTradeLeaguesLoaded,
      exportBookmarks,
      copyTransfer,
      isImportDialogOpen,
      openImportDialog,
      handleExecuteImport,
      version,
      addBookmarkBtnPosition,

      // 新增狀態與方法
      searchQuery,
      isSearchVisible,
      searchInputRef,
      toggleSearch,
      closeSearch,
      isMoveSubMenu,
      filteredGroups,
      getFilteredGroupBookmarks,
      sidebarPosition,
      tradeLeagues,
      isLeagueLoading,
      leagueLoadError,
      confirmReplaceLeague,
      formatTradeLeagueText,
      trashStyle,
      trashZone,
      isOverTrash,
      activeDragEntity,
      liveFolderDeleteImpact,
      activeBookmarkId,
      activePreviewData,
      handlePreviewOpenChange,
      isCollectionEmpty,
      confirmClearCollection,
      previewBookmark,
      previewAnchorEl,
      isPreviewOpen,
      closePreview,
      enableBookmarkTooltip,
    };
  },
});
</script>

<style scoped>
/* 拖曳預覽虛線樣式 */
.sortable-ghost {
  opacity: 0.3;
  outline: 1px dashed var(--ring);
  outline-offset: -1px;
  background-color: var(--background) !important;
}

/* 當拖曳物件懸停在垃圾桶上方時，清除預覽虛線輪廓 */
.bookmark-pane:has(.drag-trash-zone.drag-hover) .sortable-ghost {
  outline: none !important;
}

/* 書籤項懸停在垃圾桶上方時收縮佔位符 (Bookmark row collapse) */
.bookmark-pane:has(.drag-trash-zone.drag-hover) .bookmark-row-item.sortable-ghost {
  opacity: 0 !important;
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
}

/* 資料夾子樹懸停在垃圾桶上方時呈現 destructive preview (保留完整 layout footprint) */
.bookmark-pane:has(.drag-trash-zone.drag-hover) .group-container.sortable-ghost,
.bookmark-pane:has(.drag-trash-zone.drag-hover) .group-container.dragging-subtree-origin,
.bookmark-pane:has(.drag-trash-zone.drag-hover) .group-container.dragging-subtree-descendant {
  opacity: 0.85 !important;
  visibility: visible !important;
  border-color: var(--destructive) !important;
  background-color: color-mix(in srgb, var(--destructive) 10%, var(--card)) !important;
}

.bookmark-pane:has(.drag-trash-zone.drag-hover)
  .group-container.dragging-subtree-origin
  > .group-header-row,
.bookmark-pane:has(.drag-trash-zone.drag-hover)
  .group-container.dragging-subtree-descendant
  > .group-header-row {
  border-left-color: var(--destructive) !important;
  background-color: color-mix(in srgb, var(--destructive) 12%, transparent) !important;
}
</style>
