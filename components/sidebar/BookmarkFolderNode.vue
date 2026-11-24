<template>
  <div
    class="group-container relative rounded-md border border-border bg-card mb-0"
    :data-group-id="node.folder.id"
    :data-depth="node.depth"
    :style="folderContainerStyle"
  >
    <!-- 資料夾標題行 -->
    <div
      class="group-header-row group"
      :class="[
        'relative flex items-center justify-between cursor-pointer select-none border-0 border-solid border-l-2 border-l-primary bg-card hover:bg-muted/50 has-[[data-state=open]]:bg-muted/50 py-[var(--pxd-bookmark-folder-header-padding-y)] px-[var(--pxd-space-lg)]',
        isBodyVisible ? 'rounded-t-md border-b border-border' : 'rounded-md',
        {
          collapsed: tree.isGroupCollapsed(node.folder.id),
        },
      ]"
      @click="tree.toggleGroupCollapse(node.folder.id)"
    >
      <div class="flex w-full min-w-0 items-center gap-[var(--pxd-space-md)]">
        <FolderIconPicker
          v-model:open="isIconPickerOpen"
          :game-version="tree.gameVersion"
          :icon="node.folder.icon"
          :color="node.folder.color"
          @select="handleSelectFolderAppearance"
        >
          <button
            type="button"
            class="folder-icon-trigger relative flex items-center justify-center shrink-0 rounded px-1 py-0.5 -mx-1 -my-0.5 hover:bg-muted/80 hover:ring-1 hover:ring-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-all cursor-pointer"
            :class="{
              'bg-primary/10 ring-1 ring-dashed ring-primary/70 gap-1':
                editing.editingGroupId.value === node.folder.id,
            }"
            :title="t('bookmark.folderIcon.changeTitle')"
            @mousedown.prevent
            @click.stop
          >
            <FolderIcon :icon="node.folder.icon" :color="node.folder.color" :open="!isCollapsed" />
            <Palette
              v-if="editing.editingGroupId.value === node.folder.id"
              class="size-[var(--checkbox-indicator-size,12px)] shrink-0 text-primary"
            />
          </button>
        </FolderIconPicker>

        <template v-if="editing.editingGroupId.value === node.folder.id">
          <Input
            v-model="editing.editingGroupName.value"
            v-focus
            :maxlength="BOOKMARK_NAME_MAX_LENGTH"
            size="sm"
            class="w-full min-w-0"
            @keyup.enter="editing.saveRenameGroup"
            @keyup.escape="editing.editingGroupId.value = null"
            @blur="editing.saveRenameGroup"
            @click.stop
          />
        </template>
        <template v-else>
          <span
            class="truncate text-[length:var(--pxd-font-body)] font-bold text-foreground"
            :title="node.folder.name"
            >{{ node.folder.name }}</span
          >
          <span class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
            >({{ folderCountDisplay }})</span
          >
        </template>
      </div>

      <div
        v-if="editing.editingGroupId.value !== node.folder.id && !tree.isDragging.value"
        class="group-actions pxd-hover-actions-overlay [--pxd-hover-overlay-bg:color-mix(in_srgb,var(--muted)_50%,var(--card))] absolute inset-y-0 right-0 rounded-r-[inherit] z-(--pxd-z-raised) pr-[var(--pxd-space-lg)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto flex items-center gap-[var(--pxd-space-sm)]"
      >
        <!-- 拖曳排序把手（隨懸停動作列一併浮現，不佔用左側圖示對齊空間） -->
        <button
          type="button"
          class="folder-drag-handle inline-flex size-[var(--control-height-sm)] items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 focus-visible:outline-none rounded-md transition-colors"
          :title="t('bookmark.folder.dragHandleTitle')"
          tabindex="-1"
          @click.stop
        >
          <GripVertical class="size-[var(--control-icon-sm,14px)] shrink-0" />
        </button>

        <!-- 新增書籤按鈕 -->
        <Button
          v-if="shouldShowHeaderAdd"
          variant="ghost"
          size="icon-sm"
          class="font-bold"
          :title="
            t('bookmark.folder.addCurrentPageTitle') /* title=&quot;新增當前網頁到此資料夾&quot; */
          "
          @click.stop="actions.addBookmarkToGroup(node.folder.id)"
        >
          <Plus />
        </Button>

        <!-- 可展開操作按鈕 -->
        <div class="dropdown-menu-container relative inline-block">
          <DropdownMenu v-model:open="isGroupMenuOpen">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                :title="t('bookmark.folder.menuTitle') /* title=&quot;操作選單&quot; */"
                @pointerdown.capture="menus.handleGroupTriggerPointerDown(node.folder.id, $event)"
                @click.capture="menus.handleTriggerClick"
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
                  if (editing.editingGroupId.value) e.preventDefault();
                }
              "
            >
              <DropdownMenuItem @click="actions.addChildFolder(node.folder.id)">
                <FolderPlus class="text-muted-foreground" />
                {{ t('bookmark.action.newSubfolder') }}
              </DropdownMenuItem>

              <DropdownMenuItem
                v-if="tree.hasSubtreeFolders(node.folder.id)"
                @click="tree.toggleSubtreeCollapse(node.folder.id)"
              >
                <FolderOpen
                  v-if="tree.isSubtreeAllCollapsed(node.folder.id)"
                  class="text-muted-foreground"
                />
                <FolderClosed v-else class="text-muted-foreground" />
                {{
                  tree.isSubtreeAllCollapsed(node.folder.id)
                    ? t('bookmark.action.expandAllSubfolders')
                    : t('bookmark.action.collapseAllSubfolders')
                }}
              </DropdownMenuItem>

              <DropdownMenuItem @click="editing.startRenameGroup(node.folder)">
                <Pencil class="text-muted-foreground" />
                <!-- 重新命名 -->
                {{ t('common.rename') }}
              </DropdownMenuItem>

              <DropdownMenuItem @click="openIconPickerFromMenu">
                <Palette class="text-muted-foreground" />
                {{ t('bookmark.action.changeFolderIcon') }}
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
                      :title="tree.getFolderPath(target.folder.id)"
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
                      <FolderIcon :icon="target.folder.icon" :color="target.folder.color" />
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
                data-test="folder-send-to-live-search-console"
                @click="actions.sendFolderToLiveSearchConsole(node.folder)"
              >
                <Radio class="text-primary" />
                {{ t('bookmark.action.sendFolderToConsole') }}
              </DropdownMenuItem>

              <DropdownMenuItem @click="$emit('share-folder', node.folder.id)">
                <Copy class="text-muted-foreground" />
                <!-- 分享此資料夾 -->
                {{ t('bookmark.action.shareFolder') }}
              </DropdownMenuItem>

              <DropdownMenuSub
                @update:open="
                  (open) => {
                    if (open) actions.ensureTradeLeaguesLoaded();
                  }
                "
              >
                <DropdownMenuSubTrigger @mouseenter="actions.ensureTradeLeaguesLoaded">
                  <RefreshCw class="text-muted-foreground" />
                  <!-- 替換此資料夾聯盟 -->
                  {{ t('bookmark.action.replaceFolderLeague') }}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  class="w-[var(--pxd-menu-sub-width,192px)] max-h-60 max-h-[min(var(--pxd-menu-max-height,240px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto pxd-scrollbar"
                >
                  <div
                    v-if="actions.isLeagueLoading.value"
                    class="league-menu-status text-muted-foreground py-[var(--pxd-space-sm)] px-[var(--pxd-space-lg)] text-[length:var(--pxd-font-caption)] whitespace-nowrap"
                  >
                    {{ t('bookmark.transfer.loadingLeagues') }}
                  </div>
                  <div
                    v-else-if="actions.leagueLoadError.value"
                    class="league-menu-status error text-destructive py-[var(--pxd-space-sm)] px-[var(--pxd-space-lg)] text-[length:var(--pxd-font-caption)] break-words"
                  >
                    {{ actions.leagueLoadError.value }}
                  </div>
                  <DropdownMenuItem
                    v-for="league in actions.tradeLeagues.value"
                    :key="league.id"
                    :title="actions.formatTradeLeagueText(league)"
                    @click="actions.confirmReplaceLeague('folder', league, node.folder)"
                  >
                    <span class="min-w-0 flex-1 truncate">{{
                      actions.formatTradeLeagueText(league)
                    }}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" @click="actions.confirmDeleteGroup(node.folder)">
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
      v-if="!tree.isGroupCollapsed(node.folder.id)"
      v-show="isBodyVisible"
      class="group-body rounded-b-md pr-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)] bg-card"
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
          class="empty-group-text compact-drop-zone text-[length:var(--pxd-font-micro)] text-muted-foreground py-1 px-2 border border-dashed border-border rounded-sm bg-muted/20 text-center pointer-events-none"
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
          @click.stop="actions.addBookmarkToGroup(node.folder.id)"
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
  Plus,
  Radio,
  Pencil,
  Palette,
  FolderInput,
  Trash2,
  Copy,
  RefreshCw,
} from '@lucide/vue';
import { BOOKMARK_NAME_MAX_LENGTH, getFolderSubtreeIds } from '@/utils/bookmark-collection';
import BookmarkRow from './BookmarkRow.vue';
import FolderIcon from './FolderIcon.vue';
import FolderIconPicker from './FolderIconPicker.vue';
import { t } from '@/utils/i18n';
import type { BookmarkGroup } from './bookmark-types';
import {
  BOOKMARK_PANE_CONTEXT_KEY,
  getFlattenedFolderTree,
  getFolderItemIndentLevel,
} from './bookmark-tree';

export default defineComponent({
  name: 'BookmarkFolderNode',
  components: {
    BookmarkRow,
    FolderIcon,
    FolderIconPicker,
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
    Plus,
    Radio,
    Pencil,
    Palette,
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
  emits: ['share-folder'],
  setup(props) {
    const workspace = inject(BOOKMARK_PANE_CONTEXT_KEY);
    if (!workspace) {
      throw new Error('BookmarkFolderNode must be used within BookmarkPane');
    }
    const { tree, editing, menus, actions } = workspace;

    const isGroupMenuOpen = computed({
      get: () => menus.activeGroupMenuId.value === props.node.folder.id,
      set: (open) => menus.setGroupMenuOpen(props.node.folder.id, open),
    });

    const directBookmarks = computed(() => tree.getFilteredGroupBookmarks(props.node.folder.id));

    const isCollapsed = computed(() => tree.isGroupCollapsed(props.node.folder.id));

    const hasChildFolders = computed(() =>
      tree.groups.value.some((g) => g.parentId === props.node.folder.id),
    );

    const folderCountDisplay = computed(() => {
      const directCount = directBookmarks.value.length;
      if (!isCollapsed.value || !hasChildFolders.value) {
        return directCount;
      }
      const subtreeIds = getFolderSubtreeIds(tree.groups.value, props.node.folder.id);
      let total = 0;
      for (const folderId of subtreeIds) {
        total += tree.getFilteredGroupBookmarks(folderId).length;
      }
      return total;
    });

    const isParentWithoutBookmarks = computed(
      () => hasChildFolders.value && directBookmarks.value.length === 0,
    );

    const shouldShowHeaderAdd = computed(
      () => tree.addBookmarkBtnPosition.value === 'top' || isParentWithoutBookmarks.value,
    );

    const shouldShowBottomAdd = computed(
      () => tree.addBookmarkBtnPosition.value === 'bottom' && !isParentWithoutBookmarks.value,
    );

    const isDraggingBookmark = computed(() => tree.isDraggingBookmark.value);

    const isBodyVisible = computed(() => {
      if (tree.isGroupCollapsed(props.node.folder.id)) return false;
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
      getFlattenedFolderTree(tree.groups.value, props.node.folder.id),
    );

    const handleMoveFolder = (targetFolderId: string) => {
      isMoveFolderSubMenu.value = false;
      if (props.node.folder.parentId === targetFolderId) {
        menus.setGroupMenuOpen(props.node.folder.id, false);
        return;
      }
      void actions.moveFolder(props.node.folder.id, targetFolderId);
    };

    const isIconPickerOpen = ref(false);

    const handleSelectFolderAppearance = (appearance: { icon?: string; color?: string }) => {
      void actions.setFolderAppearance(props.node.folder.id, appearance);
    };

    const openIconPickerFromMenu = () => {
      menus.setGroupMenuOpen(props.node.folder.id, false);
      isIconPickerOpen.value = true;
    };

    const handleMoveToRoot = () => {
      isMoveFolderSubMenu.value = false;
      menus.setGroupMenuOpen(props.node.folder.id, false);
      void actions.moveFolder(props.node.folder.id, undefined);
    };

    return {
      t,
      tree,
      editing,
      menus,
      actions,
      isGroupMenuOpen,
      isIconPickerOpen,
      handleSelectFolderAppearance,
      openIconPickerFromMenu,
      folderContainerStyle,
      isMoveFolderSubMenu,
      eligibleMoveTargetFolders,
      getFolderItemIndentLevel,
      handleMoveFolder,
      handleMoveToRoot,
      BOOKMARK_NAME_MAX_LENGTH,
      directBookmarks,
      isCollapsed,
      folderCountDisplay,
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
  z-index: var(--pxd-z-sticky);
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
  z-index: var(--pxd-z-sticky);
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
