<template>
  <SidebarPane ref="sidebarPaneRef" class="bookmark-pane" scroll-mode="external">
    <template #fixed>
      <!-- 上方控制區：左側新增資料夾，右側展開與匯入匯出操作 -->
      <div
        class="flex items-center gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full max-w-full min-w-0"
      >
        <Button
          variant="outline"
          size="sm"
          class="min-w-0 flex-1 font-bold"
          :title="t('bookmark.action.newFolder')"
          @click="addGroup()"
        >
          <FolderPlus />
          <span class="pxd-toolbar-btn-text truncate">{{ t('bookmark.action.newFolder') }}</span>
        </Button>
        <div class="flex items-center gap-[var(--pxd-space-sm)] shrink-0">
          <Button
            variant="outline"
            size="sm"
            class="font-bold"
            :title="isAllCollapsed ? t('common.expandAll') : t('common.collapseAll')"
            @click="toggleExpandAll"
          >
            <ChevronsUpDown />
            <span class="pxd-toolbar-btn-text truncate">
              {{ isAllCollapsed ? t('common.expandAll') : t('common.collapseAll') }}
            </span>
          </Button>
          <Button
            :variant="isSearchVisible ? 'default' : 'outline'"
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
                  variant="outline"
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
                  {{ t('bookmarkImport.export.copyCode') }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="exportBookmarks">
                  <Download class="text-muted-foreground" />
                  <!-- 下載備份檔 -->
                  {{ t('bookmarkImport.export.downloadBackup') }}
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
          class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
        />
        <Input
          ref="searchInputRef"
          v-model="searchQuery"
          size="sm"
          :placeholder="t('bookmark.search.placeholder')"
          class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))]"
          @keydown.esc.stop.prevent="closeSearch"
        />
        <Button
          v-if="searchQuery"
          variant="ghost"
          size="icon-sm"
          class="absolute right-[var(--pxd-space-xs)]"
          :title="t('common.clearSearch') /* title=&quot;清除搜尋&quot; */"
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
              class="empty-state text-center text-muted-foreground text-[length:var(--pxd-font-secondary)] py-[var(--pxd-space-2xl)]"
              key="loading"
            >
              {{ t('bookmark.empty.loading') }}
            </div>
            <SidebarEmptyState
              v-else-if="groups.length === 0"
              :message="t('bookmark.empty.noBookmarks')"
              class="empty-state"
              key="empty"
            >
              <template #icon><BookmarkIcon /></template>
              <template #actions>
                <Button variant="default" size="sm" @click="addGroup()">
                  {{ t('bookmark.action.newFolder') }}
                </Button>
                <Button variant="secondary" size="sm" @click="openImportDialog">
                  {{ t('bookmark.transfer.import') }}
                </Button>
              </template>
            </SidebarEmptyState>
            <SidebarFilterEmptyState
              v-else-if="visibleFolderNodes.length === 0"
              data-test="bookmark-search-empty"
              key="no-match"
              mode="search"
              :message="t('bookmark.empty.noMatch')"
              :active-filters="
                searchQuery.trim()
                  ? [t('common.filterTag.keyword', { query: searchQuery.trim() })]
                  : undefined
              "
              @reset="searchQuery = ''"
            />
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
                  @share-folder="copyTransfer('folder', $event)"
                />
              </div>
            </template>
          </ScrollAreaViewport>
          <ScrollBar />
          <ScrollAreaCorner />
        </ScrollAreaRoot>
        <!-- 全域單例書籤預覽（點擊切換，見 GLOSSARY.md「Search Preview」） -->
        <TradeSearchPreviewPopover
          :open="isPreviewOpen"
          :side="sidebarPosition === 'left' ? 'right' : 'left'"
          :preview-data="activePreviewData"
          :reference="previewAnchorEl"
          :source-name="previewBookmark?.name ?? ''"
          :raw-query="activeRawQuery"
          :can-open-search="canOpenPreviewSearch"
          :can-overwrite="true"
          :overwrite-busy="isOverwritingPreview"
          @open-search="handleOpenPreviewSearch"
          @overwrite-search="handleOverwritePreviewSearch"
          @update:open="
            (val) => {
              if (!val) closePreview();
            }
          "
        />
      </TooltipProvider>

      <!-- 拖曳刪除垃圾桶區 -->
      <DragTrashZone
        :ref="setTrashZoneRef"
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
          <span class="text-[length:var(--pxd-font-secondary)] font-bold leading-normal">{{
            t('sidebar.trash.releaseHint')
          }}</span>
          <!-- 個資料夾 -->
          <span class="text-[length:var(--pxd-font-micro)] font-semibold opacity-90 leading-tight">
            {{ liveFolderDeleteImpact.totalFolderCount }} {{ t('bookmarkImport.unit.folders') }}
          </span>
          <!-- 個書籤 -->
          <span class="text-[length:var(--pxd-font-micro)] font-semibold opacity-90 leading-tight">
            {{ liveFolderDeleteImpact.affectedBookmarkCount }}
            {{ t('bookmarkImport.unit.bookmarks') }}
          </span>
        </div>
        <div
          v-else-if="activeDragEntity?.kind === 'bookmark'"
          class="text-center text-[length:var(--pxd-font-secondary)] font-bold leading-snug select-none"
        >
          <!-- 放開以刪除書籤 -->
          {{ t('bookmark.action.deleteBookmark') }}
        </div>
        <!-- 放開以刪除 -->
        <div
          v-else
          class="text-center text-[length:var(--pxd-font-secondary)] font-bold leading-snug select-none"
        >
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
import { defineComponent, ref, onUnmounted, computed, provide } from 'vue';
import { t } from '@/utils/i18n';
import SidebarPane from './layout/SidebarPane.vue';
import SidebarEmptyState from './layout/SidebarEmptyState.vue';
import SidebarFilterEmptyState from './layout/SidebarFilterEmptyState.vue';
import DragTrashZone from './layout/DragTrashZone.vue';
import BookmarkFolderNode from './BookmarkFolderNode.vue';
import { BOOKMARK_PANE_CONTEXT_KEY } from './bookmark-tree';
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
  Bookmark as BookmarkIcon,
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
import { useDragTrash, type DragTrashSession } from './composables/useDragTrash';
import type { BookmarkGroup } from './bookmark-types';
import { useBookmarkSortables, type BookmarkDragEntity } from './composables/useBookmarkSortables';
import { getFolderDeleteImpact } from '@/utils/bookmark-collection';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { describeBookmarkImportFailure } from '@/utils/bookmark-transfer-messages';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { getPreferences } from '@/utils/preferences';
import { getPoeVersion } from '@/utils/trade-context';
import { createBookmarkModel } from './bookmark-model';
import {
  createBookmarkTransferWorkflow,
  createBrowserBookmarkTransferHost,
} from './bookmark-transfer-workflow';
import { useBookmarkWorkspace } from './bookmark-workspace';
import BookmarkImportDialog from './BookmarkImportDialog.vue';
import TradeSearchPreviewPopover from './search-preview/TradeSearchPreviewPopover.vue';
import type { BookmarkTransferPayload, BookmarkImportMode } from '@/utils/bookmark-transfer';

export default defineComponent({
  name: 'BookmarkPane',
  components: {
    SidebarPane,
    SidebarEmptyState,
    SidebarFilterEmptyState,
    DragTrashZone,
    BookmarkFolderNode,
    BookmarkIcon,
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
    const version = getPoeVersion();
    const listRenderKey = ref(0);
    let stopPreferences: (() => void) | undefined;

    // 導入拖曳垃圾桶 Composable（trashZone 由 setTrashZoneRef 綁定並自動管理監聽與清理）
    const {
      setTrashZoneRef,
      isDragging,
      isOverTrash,
      activeDragEntity,
      trashStyle,
      beginDrag,
      endDrag,
    }: DragTrashSession<BookmarkDragEntity> = useDragTrash('.bookmark-accordion-list');

    const isDraggingBookmark = computed(() => activeDragEntity.value?.kind === 'bookmark');

    const model = createBookmarkModel(createChromeBookmarkClient(version));

    const workspace = useBookmarkWorkspace({
      version,
      model,
      isDragging,
      isDraggingBookmark,
      alongside: async () => {
        const preferencesOutcome = await getPreferences(version);
        if (!preferencesOutcome.ok) throw new Error(preferencesOutcome.error.message);
        stopPreferences?.();
        stopPreferences = preferencesOutcome.value.subscribe((snapshot) => {
          workspace.setPreferences(snapshot);
        });
      },
    });

    const { tree, editing, menus, actions, preview } = workspace;

    const sortableController = useBookmarkSortables({
      bookmarks: tree.bookmarks,
      groups: tree.groups,
      listRenderKey,
      isDragging,
      isOverTrash,
      beginDrag,
      endDrag,
      execute: workspace.execute,
      containerRef: paneRoot,
      isDragEnabled: tree.isBookmarkDragEnabled,
      collapsedGroupIds: tree.collapsedGroupIds,
      transientExpandedFolderIds: tree.transientExpandedFolderIds,
      syncSource: tree.sortableKey,
      isLoading: tree.isLoading,
    });

    const liveFolderDeleteImpact = computed(() => {
      if (activeDragEntity.value?.kind !== 'folder' || !activeDragEntity.value.id) {
        return null;
      }
      return getFolderDeleteImpact(
        tree.groups.value as BookmarkGroup[],
        tree.bookmarks.value,
        activeDragEntity.value.id,
      );
    });

    onUnmounted(() => {
      stopPreferences?.();
      stopPreferences = undefined;
      sortableController.destroy();
    });

    // ── Bookmark Transfer（位於 Pane，不進入 Workspace）─────────────
    const transferWorkflow = createBookmarkTransferWorkflow({
      model,
      host: createBrowserBookmarkTransferHost({
        closeMenus: menus.closeAll,
        showToast: (message) =>
          dispatchPoeEvent('poexd-toast', { message, tone: 'default', durationMs: 3000 }),
      }),
    });
    const copyTransfer = (scope: 'collection' | 'folder', groupId?: string) =>
      transferWorkflow.run({ type: 'copy', scope, groupId });
    // 下載與分享碼使用相同的 Bookmark Transfer envelope。
    const exportBookmarks = () => transferWorkflow.run({ type: 'download' });

    const isImportDialogOpen = ref(false);
    const openImportDialog = () => {
      menus.closeAll();
      isImportDialogOpen.value = true;
    };

    const handleExecuteImport = async (event: {
      payload: BookmarkTransferPayload;
      mode: BookmarkImportMode;
      targetGroupId?: string;
    }) => {
      const outcome = await model.execute({
        type: 'import-transfer',
        payload: event.payload,
        mode: event.mode,
        targetGroupId: event.targetGroupId,
      });
      if (outcome.ok) {
        dispatchPoeEvent('poexd-toast', {
          message: t('bookmark.toast.imported'),
          tone: 'default',
          durationMs: 3000,
        });
      } else {
        await (window as any).poexdAlert(
          t('bookmark.dialog.importFailureMessage', {
            error: describeBookmarkImportFailure(outcome.error),
          }),
          t('bookmark.dialog.importFailureTitle'),
        );
      }
      workspace.refresh();
    };

    provide(BOOKMARK_PANE_CONTEXT_KEY, {
      tree,
      editing,
      menus,
      actions,
      preview,
      refresh: workspace.refresh,
    });

    return {
      t,
      sidebarPaneRef,
      version,
      listRenderKey,
      groups: tree.groups,
      bookmarks: tree.bookmarks,
      visibleFolderNodes: tree.visibleFolderNodes,
      isLoading: tree.isLoading,
      isAllCollapsed: tree.isAllCollapsed,
      isCollectionEmpty: tree.isCollectionEmpty,
      sidebarPosition: tree.sidebarPosition,
      toggleExpandAll: tree.toggleExpandAll,
      searchQuery: tree.search.query,
      isSearchVisible: tree.search.isVisible,
      searchInputRef: tree.search.inputRef,
      toggleSearch: tree.search.toggle,
      closeSearch: tree.search.close,
      isTransferMenuOpen: menus.isTransferMenuOpen,
      handleTransferTriggerPointerDown: menus.handleTransferTriggerPointerDown,
      handleTriggerClick: menus.handleTriggerClick,
      addGroup: actions.addGroup,
      copyTransfer,
      exportBookmarks,
      ensureTradeLeaguesLoaded: actions.ensureTradeLeaguesLoaded,
      isLeagueLoading: actions.isLeagueLoading,
      leagueLoadError: actions.leagueLoadError,
      tradeLeagues: actions.tradeLeagues,
      formatTradeLeagueText: actions.formatTradeLeagueText,
      confirmReplaceLeague: actions.confirmReplaceLeague,
      confirmClearCollection: actions.confirmClearCollection,
      isPreviewOpen: preview.isOpen,
      activePreviewData: preview.activePreviewData,
      previewAnchorEl: preview.anchorEl,
      previewBookmark: preview.previewBookmark,
      activeRawQuery: preview.activeRawQuery,
      canOpenPreviewSearch: preview.canOpenPreviewSearch,
      isOverwritingPreview: preview.isOverwriting,
      handleOpenPreviewSearch: preview.handleOpenPreviewSearch,
      handleOverwritePreviewSearch: preview.handleOverwritePreviewSearch,
      closePreview: preview.close,
      setTrashZoneRef,
      isDragging,
      isOverTrash,
      activeDragEntity,
      trashStyle,
      liveFolderDeleteImpact,
      isImportDialogOpen,
      openImportDialog,
      handleExecuteImport,
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
