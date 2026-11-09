<template>
  <div
    class="group-container relative border border-border bg-card mb-0"
    :data-group-id="node.folder.id"
    :data-depth="node.depth"
    :style="folderContainerStyle"
  >
    <!-- 資料夾標題行 -->
    <div
      class="group-header-row group"
      :class="[
        'relative flex items-center justify-between cursor-pointer select-none border-0 border-solid border-l-2 border-l-primary bg-muted/40 hover:bg-muted/70 py-[var(--pxd-bookmark-folder-header-padding-y)] px-[var(--pxd-space-lg)]',
        {
          'border-b border-border': isBodyVisible,
          collapsed: ctx.isGroupCollapsed(node.folder.id),
        },
      ]"
      @click="ctx.toggleGroupCollapse(node.folder.id)"
    >
      <div class="flex w-full min-w-0 items-center gap-[var(--pxd-space-md)]">
        <button
          type="button"
          class="folder-drag-handle flex items-center justify-center cursor-grab active:cursor-grabbing p-0.5 -ml-1 text-muted-foreground/60 hover:text-foreground shrink-0 focus-visible:outline-none rounded transition-colors"
          :title="t('bookmark.folder.dragHandleTitle')"
          tabindex="-1"
          @click.stop
        >
          <GripVertical class="size-[var(--control-icon-sm,14px)] shrink-0" />
        </button>
        <Folder class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground" />

        <template v-if="ctx.editingGroupId.value === node.folder.id">
          <Input
            v-model="ctx.editingGroupName.value"
            v-focus
            :maxlength="BOOKMARK_NAME_MAX_LENGTH"
            size="sm"
            class="w-full min-w-0"
            @keyup.enter="ctx.saveRenameGroup"
            @keyup.escape="ctx.editingGroupId.value = null"
            @blur="ctx.saveRenameGroup"
            @click.stop
          />
        </template>
        <template v-else>
          <span
            class="truncate text-[length:var(--pxd-font-secondary)] font-bold text-foreground"
            >{{ node.folder.name }}</span
          >
          <span class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
            >({{ directBookmarks.length }})</span
          >
        </template>
      </div>

      <div
        v-if="ctx.editingGroupId.value !== node.folder.id && !ctx.isDragging.value"
        class="group-actions absolute right-[var(--pxd-space-md)] top-1/2 -translate-y-1/2 z-[1] bg-[color-mix(in_srgb,var(--muted)_70%,var(--card))] pl-[var(--pxd-space-sm)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto flex items-center gap-[var(--pxd-space-sm)]"
      >
        <!-- 新增書籤按鈕 -->
        <Button
          v-if="shouldShowHeaderAdd"
          variant="ghost"
          size="icon-sm"
          class="font-bold"
          :title="
            t('bookmark.folder.addCurrentPageTitle') /* title=&quot;新增當前網頁到此資料夾&quot; */
          "
          @click.stop="ctx.addBookmarkToGroup(node.folder.id)"
        >
          +
        </Button>

        <!-- 可展開操作按鈕 -->
        <div class="dropdown-menu-container relative inline-block">
          <DropdownMenu v-model:open="isGroupMenuOpen">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                :title="t('bookmark.folder.menuTitle') /* title=&quot;操作選單&quot; */"
                @pointerdown.capture="ctx.handleGroupTriggerPointerDown(node.folder.id, $event)"
                @click.capture="ctx.handleTriggerClick"
                @click.stop
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              v-if="isGroupMenuOpen"
              align="end"
              @close-auto-focus="
                (e) => {
                  if (ctx.editingGroupId.value) e.preventDefault();
                }
              "
            >
              <DropdownMenuItem @click="ctx.addChildFolder(node.folder.id)">
                <FolderPlus class="text-muted-foreground" />
                {{ t('bookmark.action.newSubfolder') }}
              </DropdownMenuItem>

              <DropdownMenuItem
                v-if="ctx.hasSubtreeFolders(node.folder.id)"
                @click="ctx.toggleSubtreeCollapse(node.folder.id)"
              >
                <FolderOpen
                  v-if="ctx.isSubtreeAllCollapsed(node.folder.id)"
                  class="text-muted-foreground"
                />
                <FolderClosed v-else class="text-muted-foreground" />
                {{
                  ctx.isSubtreeAllCollapsed(node.folder.id)
                    ? t('bookmark.action.expandAllSubfolders')
                    : t('bookmark.action.collapseAllSubfolders')
                }}
              </DropdownMenuItem>

              <DropdownMenuItem @click="ctx.startRenameGroup(node.folder)">
                <Pencil class="text-muted-foreground" />
                <!-- 重新命名 -->
                {{ t('bookmark.action.rename') }}
              </DropdownMenuItem>

              <!-- 二級選單：移動到資料夾 -->
              <DropdownMenuSub
                :open="isMoveFolderSubMenu"
                @update:open="(open) => (isMoveFolderSubMenu = open)"
              >
                <DropdownMenuSubTrigger>
                  <FolderInput class="text-muted-foreground" />
                  <!-- 移動到資料夾... -->
                  {{ t('bookmark.action.moveToFolder') }}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  class="w-[var(--pxd-menu-sub-width,192px)] max-h-[min(var(--pxd-menu-sub-max-height,180px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto pxd-scrollbar"
                >
                  <template v-if="node.folder.parentId !== undefined">
                    <DropdownMenuItem
                      :title="t('bookmark.action.rootFolder')"
                      @click="handleMoveToRoot"
                    >
                      <FolderRoot class="shrink-0 text-muted-foreground" />
                      <span class="min-w-0 flex-1 truncate">{{
                        t('bookmark.action.rootFolder')
                      }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator v-if="eligibleMoveTargetFolders.length > 0" />
                  </template>
                  <template v-if="eligibleMoveTargetFolders.length > 0">
                    <DropdownMenuItem
                      v-for="target in eligibleMoveTargetFolders"
                      :key="target.folder.id"
                      :disabled="node.folder.parentId === target.folder.id"
                      :selected="node.folder.parentId === target.folder.id"
                      :title="ctx.getFolderPath(target.folder.id)"
                      @click="handleMoveFolder(target.folder.id)"
                    >
                      <span
                        v-if="getFolderItemIndentLevel(target.depth) > 0"
                        class="flex shrink-0 items-center -mr-[var(--control-gap-sm)]"
                        aria-hidden="true"
                      >
                        <span
                          v-for="step in getFolderItemIndentLevel(target.depth)"
                          :key="step"
                          class="w-[var(--pxd-space-md)] shrink-0"
                          data-slot="indent-spacer"
                        />
                      </span>
                      <Folder class="shrink-0 text-muted-foreground" />
                      <span class="min-w-0 flex-1 truncate">{{ target.folder.name }}</span>
                      <span
                        v-if="node.folder.parentId === target.folder.id"
                        class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground ml-1"
                      >
                        {{ t('bookmark.action.currentLocation') }}
                      </span>
                    </DropdownMenuItem>
                  </template>
                  <DropdownMenuItem
                    v-else-if="node.folder.parentId === undefined"
                    disabled
                    class="justify-center text-muted-foreground select-none"
                  >
                    {{ t('bookmark.action.noMoveTarget') }}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                v-if="ctx.sendFolderToLiveSearchConsole"
                data-test="folder-send-to-live-search-console"
                @click="ctx.sendFolderToLiveSearchConsole(node.folder)"
              >
                <Radio class="text-primary" />
                {{ t('bookmark.action.sendFolderToConsole') }}
              </DropdownMenuItem>

              <DropdownMenuItem @click="ctx.copyTransfer('folder', node.folder.id)">
                <Copy class="text-muted-foreground" />
                <!-- 分享此資料夾 -->
                {{ t('bookmark.action.shareFolder') }}
              </DropdownMenuItem>

              <DropdownMenuSub
                @update:open="
                  (open) => {
                    if (open) ctx.ensureTradeLeaguesLoaded();
                  }
                "
              >
                <DropdownMenuSubTrigger @mouseenter="ctx.ensureTradeLeaguesLoaded">
                  <RefreshCw class="text-muted-foreground" />
                  <!-- 替換此資料夾聯盟 -->
                  {{ t('bookmark.action.replaceFolderLeague') }}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  class="w-[var(--pxd-menu-sub-width,192px)] max-h-60 max-h-[min(var(--pxd-menu-max-height,240px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto pxd-scrollbar"
                >
                  <div
                    v-if="ctx.isLeagueLoading.value"
                    class="league-menu-status text-muted-foreground py-[var(--pxd-space-sm)] px-[var(--pxd-space-lg)] text-[length:var(--pxd-font-caption)] whitespace-nowrap"
                  >
                    {{ t('bookmark.transfer.loadingLeagues') }}
                  </div>
                  <div
                    v-else-if="ctx.leagueLoadError.value"
                    class="league-menu-status error text-destructive py-[var(--pxd-space-sm)] px-[var(--pxd-space-lg)] text-[length:var(--pxd-font-caption)] break-words"
                  >
                    {{ ctx.leagueLoadError.value }}
                  </div>
                  <DropdownMenuItem
                    v-for="league in ctx.tradeLeagues.value"
                    :key="league.id"
                    :title="ctx.formatTradeLeagueText(league)"
                    @click="ctx.confirmReplaceLeague('folder', league, node.folder)"
                  >
                    <span class="min-w-0 flex-1 truncate">{{
                      ctx.formatTradeLeagueText(league)
                    }}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" @click="ctx.confirmDeleteGroup(node.folder)">
                <Trash2 class="text-destructive" />
                {{ t('bookmark.action.deleteFolder') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>

    <!-- 資料夾內容（僅包含內部直接書籤，子資料夾改為外部同層平鋪視覺樹） -->
    <div
      v-if="!ctx.isGroupCollapsed(node.folder.id)"
      v-show="isBodyVisible"
      class="group-body pr-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)] bg-background"
      :class="[
        isParentWithoutBookmarks
          ? 'py-[var(--pxd-space-xs)]'
          : 'pt-[var(--pxd-bookmark-folder-body-padding-y)] pb-[var(--pxd-bookmark-folder-body-padding-y)]',
      ]"
    >
      <div
        class="bookmark-list-wrapper flex flex-col gap-[var(--pxd-space-xs)]"
        :class="[isParentWithoutBookmarks ? 'min-h-[24px]' : 'min-h-[25px]']"
        :data-group-id="node.folder.id"
      >
        <div
          v-if="isParentWithoutBookmarks"
          class="empty-group-text compact-drop-zone text-[length:var(--pxd-font-micro)] text-muted-foreground py-1 px-2 border border-dashed border-border rounded bg-muted/20 text-center pointer-events-none"
        >
          {{ t('bookmark.folder.dropBookmarksHere') }}
        </div>
        <div
          v-else-if="directBookmarks.length === 0"
          class="empty-group-text text-[length:var(--pxd-font-secondary)] text-muted-foreground p-[var(--pxd-space-md)] italic text-center pointer-events-none"
        >
          {{ t('bookmark.folder.emptyFolderDropHint') }}
        </div>

        <BookmarkRow v-for="bm in directBookmarks" :key="bm.id" :bookmark="bm" />
      </div>

      <!-- 資料夾下方新增按鈕 -->
      <div
        v-if="shouldShowBottomAdd"
        class="bookmark-bottom-add-container mt-[var(--pxd-bookmark-tree-gap)] flex justify-center"
      >
        <Button
          variant="secondary"
          size="sm"
          class="w-full font-bold"
          :title="t('bookmark.folder.addCurrentPageTitle')"
          @click.stop="ctx.addBookmarkToGroup(node.folder.id)"
        >
          <!-- ＋ 新增當前網頁 -->
          <span>{{ t('bookmark.folder.addCurrentPage') }}</span>
        </Button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, computed, ref, type PropType } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Folder,
  FolderPlus,
  FolderOpen,
  FolderClosed,
  FolderRoot,
  GripVertical,
  MoreVertical,
  Radio,
  Pencil,
  FolderInput,
  Trash2,
  Copy,
  RefreshCw,
} from '@lucide/vue';
import { BOOKMARK_NAME_MAX_LENGTH } from '@/utils/bookmark-collection';
import BookmarkRow from './BookmarkRow.vue';
import { t } from '@/utils/i18n';
import type { BookmarkGroup } from './bookmark-types';
import {
  type BookmarkPaneContext,
  BOOKMARK_PANE_CONTEXT_KEY,
  getFlattenedFolderTree,
  getFolderItemIndentLevel,
} from './bookmark-tree';

export default defineComponent({
  name: 'BookmarkFolderNode',
  components: {
    BookmarkRow,
    Button,
    Input,
    GripVertical,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuSeparator,
    Folder,
    FolderPlus,
    FolderOpen,
    FolderClosed,
    FolderRoot,
    MoreVertical,
    Radio,
    Pencil,
    FolderInput,
    Trash2,
    Copy,
    RefreshCw,
  },
  directives: {
    focus: {
      mounted(el: HTMLElement) {
        const input = (
          el instanceof HTMLInputElement ? el : el.querySelector('input')
        ) as HTMLInputElement | null;
        input?.focus();
        input?.select();
      },
    },
  },
  props: {
    node: {
      type: Object as PropType<{
        folder: BookmarkGroup;
        depth: number;
      }>,
      required: true,
    },
  },
  setup(props) {
    const ctx = inject<BookmarkPaneContext>(BOOKMARK_PANE_CONTEXT_KEY);
    if (!ctx) {
      throw new Error('BookmarkFolderNode must be used within BookmarkPane');
    }

    const isGroupMenuOpen = computed({
      get: () => ctx.activeGroupMenuId.value === props.node.folder.id,
      set: (open) => ctx.setGroupMenuOpen(props.node.folder.id, open),
    });

    const directBookmarks = computed(() =>
      ctx.getFilteredGroupBookmarks ? ctx.getFilteredGroupBookmarks(props.node.folder.id) : [],
    );

    const hasChildFolders = computed(
      () => ctx.groups.value?.some((g) => g.parentId === props.node.folder.id) ?? false,
    );

    const isParentWithoutBookmarks = computed(
      () => hasChildFolders.value && directBookmarks.value.length === 0,
    );

    const shouldShowHeaderAdd = computed(
      () => ctx.addBookmarkBtnPosition.value === 'top' || isParentWithoutBookmarks.value,
    );

    const shouldShowBottomAdd = computed(
      () => ctx.addBookmarkBtnPosition.value === 'bottom' && !isParentWithoutBookmarks.value,
    );

    const isDraggingBookmark = computed(() => ctx.isDraggingBookmark?.value ?? false);

    const isBodyVisible = computed(() => {
      if (ctx.isGroupCollapsed(props.node.folder.id)) return false;
      if (isParentWithoutBookmarks.value) {
        return isDraggingBookmark.value;
      }
      return true;
    });

    const folderContainerStyle = computed(() => {
      const depth = props.node.depth ?? 0;
      if (depth <= 0) {
        return undefined;
      }
      if (depth === 1) {
        return {
          marginLeft: 'calc(var(--pxd-space-lg) + var(--pxd-space-md))',
        };
      }
      const singleStep = '(var(--pxd-space-lg) + var(--pxd-space-md))';
      const terms = Array.from({ length: depth }, () => singleStep).join(' + ');
      return {
        marginLeft: `calc(${terms})`,
      };
    });

    const isMoveFolderSubMenu = ref(false);

    const eligibleMoveTargetFolders = computed(() =>
      getFlattenedFolderTree(ctx.groups.value, props.node.folder.id),
    );

    const handleMoveFolder = (targetFolderId: string) => {
      isMoveFolderSubMenu.value = false;
      if (props.node.folder.parentId === targetFolderId) {
        ctx.setGroupMenuOpen(props.node.folder.id, false);
        return;
      }
      void ctx.moveFolder(props.node.folder.id, targetFolderId);
    };

    const handleMoveToRoot = () => {
      isMoveFolderSubMenu.value = false;
      ctx.setGroupMenuOpen(props.node.folder.id, false);
      void ctx.moveFolder(props.node.folder.id, undefined);
    };

    return {
      t,
      ctx,
      isGroupMenuOpen,
      folderContainerStyle,
      isMoveFolderSubMenu,
      eligibleMoveTargetFolders,
      getFolderItemIndentLevel,
      handleMoveFolder,
      handleMoveToRoot,
      BOOKMARK_NAME_MAX_LENGTH,
      directBookmarks,
      hasChildFolders,
      isParentWithoutBookmarks,
      shouldShowHeaderAdd,
      shouldShowBottomAdd,
      isDraggingBookmark,
      isBodyVisible,
    };
  },
});
</script>

<style scoped>
/* 上邊緣插入線 (before) - 位於卡片上方 gap 中央 */
.group-container.drop-indicator-before::before {
  content: '';
  position: absolute;
  left: var(--drop-indicator-indent, 0px);
  right: 0;
  top: var(--drop-indicator-offset-y, 0px);
  transform: translateY(-50%);
  height: 3px;
  background-color: var(--primary);
  z-index: 10;
  pointer-events: none;
  border-radius: 2px;
  box-shadow: 0 0 6px color-mix(in srgb, var(--primary) 70%, transparent);
}

/* 下邊緣插入線 (after) - 位於卡片下方 gap 中央 */
.group-container.drop-indicator-after::after {
  content: '';
  position: absolute;
  left: var(--drop-indicator-indent, 0px);
  right: 0;
  bottom: var(--drop-indicator-offset-y, 0px);
  transform: translateY(50%);
  height: 3px;
  background-color: var(--primary);
  z-index: 10;
  pointer-events: none;
  border-radius: 2px;
  box-shadow: 0 0 6px color-mix(in srgb, var(--primary) 70%, transparent);
}

/* 中央 surface highlight (inside: 移入此資料夾) */
.group-container.drop-indicator-inside {
  outline: 2px solid var(--primary) !important;
  outline-offset: -2px;
  background-color: color-mix(in srgb, var(--primary) 12%, var(--card)) !important;
  box-shadow:
    inset 0 0 0 1px var(--primary),
    inset 0 0 16px color-mix(in srgb, var(--primary) 15%, transparent);
}
.group-container.drop-indicator-inside > .group-header-row {
  background-color: color-mix(in srgb, var(--primary) 20%, var(--muted)) !important;
}
.group-container.drop-indicator-inside > .group-header-row .lucide-folder {
  color: var(--primary) !important;
  transform: scale(1.15);
  transition:
    transform 150ms ease,
    color 150ms ease;
}
.group-container.drop-indicator-inside > .group-body {
  background-color: color-mix(in srgb, var(--primary) 8%, var(--card)) !important;
}
.group-header-row.drop-indicator-inside {
  outline: 2px solid var(--primary) !important;
  outline-offset: -2px;
  background-color: color-mix(in srgb, var(--primary) 20%, var(--muted)) !important;
}
.group-container.dragging-subtree-origin,
.group-container.dragging-subtree-descendant {
  opacity: 0.45;
  transition: opacity 150ms ease;
}
</style>
