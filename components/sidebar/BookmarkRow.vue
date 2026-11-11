<template>
  <div
    class="bookmark-row-item group relative flex items-center justify-between py-[var(--pxd-bookmark-row-padding-y)] px-[var(--pxd-space-md)] gap-[var(--pxd-space-lg)] border-0 border-b border-dashed border-border bg-transparent cursor-grab active:cursor-grabbing hover:bg-muted/40 last:border-b-0"
    :data-id="bm.id"
    @pointerenter.once="activateActions"
    @focusin.once="activateActions"
  >
    <span class="flex w-full min-w-0 items-center gap-[var(--pxd-space-sm)] outline-none">
      <img
        v-if="bm.coverImageUrl"
        :key="bm.coverImageUrl"
        :src="bm.coverImageUrl"
        class="size-[var(--control-height-sm)] shrink-0 object-contain"
        alt=""
        draggable="false"
        @error="ctx.handleCoverImageError"
      />
      <span
        v-else
        class="flex size-[var(--control-height-sm)] shrink-0 items-center justify-center text-[length:var(--pxd-font-secondary)] leading-none text-muted-foreground"
        >•</span
      >
      <Input
        v-if="isEditing"
        v-model="ctx.editingBookmarkName.value"
        v-focus
        :maxlength="BOOKMARK_NAME_MAX_LENGTH"
        size="sm"
        class="w-full min-w-0"
        @keyup.enter="ctx.saveRenameBookmark"
        @keyup.escape="ctx.editingBookmarkId.value = null"
        @blur="ctx.saveRenameBookmark"
        @click.stop
      />
      <a
        v-else
        :href="bm.url"
        @click.prevent="handlePrimaryClick"
        class="bookmark-link block w-full min-w-0 truncate text-[length:var(--pxd-font-caption)] text-foreground no-underline hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        draggable="false"
      >
        {{ bm.name }}
      </a>
      <span
        v-if="isLegacyUrl"
        class="legacy-search-badge shrink-0 text-[length:var(--pxd-font-micro)] text-destructive"
        :title="t('bookmark.row.invalidNoticeTooltip')"
        >{{ t('bookmark.row.invalidBadge') }}</span
      >
    </span>

    <!-- 操作列採延遲掛載：書籤一多時避免每列都建立選單元件，首次 hover / focus 才建立 -->
    <div
      v-if="showActions"
      class="bookmark-item-actions absolute right-[var(--pxd-space-md)] top-1/2 -translate-y-1/2 z-(--pxd-z-raised) bg-[color-mix(in_srgb,var(--muted)_40%,var(--background))] pl-[var(--pxd-space-sm)] flex items-center shrink-0 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
    >
      <Button
        v-if="ctx.searchEntryClickAction?.value === 'preview'"
        variant="ghost"
        size="icon-sm"
        :title="t('bookmark.row.openSearch')"
        data-test="bookmark-open"
        @click.stop="ctx.openBookmark(bm)"
        @pointerdown.stop
      >
        <ArrowRight />
      </Button>
      <Button
        v-else-if="ctx.toggleBookmarkPreview && ctx.enableBookmarkTooltip?.value !== false"
        variant="ghost"
        size="icon-sm"
        :title="t('bookmark.row.previewSearch')"
        data-test="bookmark-preview-toggle"
        @click.stop="ctx.toggleBookmarkPreview(bm, $event)"
        @pointerdown.stop
      >
        <Eye />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :title="t('bookmark.row.openNewTab') /* title=&quot;在新分頁開啟&quot; */"
        @click.stop="ctx.openBookmarkNewTab(bm)"
        @pointerdown.stop
      >
        <ExternalLink />
      </Button>
      <div class="dropdown-menu-container relative inline-block">
        <DropdownMenu
          :open="isMenuOpen"
          @update:open="(open) => ctx.setBookmarkMenuOpen(bm.id, open)"
        >
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :title="t('bookmark.folder.menuTitle') /* title=&quot;操作選單&quot; */"
              @pointerdown.capture="ctx.handleBookmarkTriggerPointerDown(bm.id, $event)"
              @click.capture="ctx.handleTriggerClick"
              @click.stop
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            v-if="isMenuOpen"
            align="end"
            @close-auto-focus="
              (e) => {
                if (ctx.editingBookmarkId.value) e.preventDefault();
              }
            "
          >
            <DropdownMenuItem @click="ctx.openBookmarkNewTab(bm)">
              <ExternalLink class="text-muted-foreground" />
              <!-- 在新分頁開啟 -->
              {{ t('bookmark.row.openNewTab') }}
            </DropdownMenuItem>

            <DropdownMenuItem
              v-if="ctx.sendBookmarkToLiveSearchConsole"
              data-test="bookmark-send-to-live-search-console"
              @click="ctx.sendBookmarkToLiveSearchConsole(bm)"
            >
              <Radio class="text-primary" />
              {{ t('bookmark.row.sendToConsole') }}
            </DropdownMenuItem>

            <DropdownMenuItem @click="ctx.openBookmarkLiveSearch(bm)">
              <Radio class="text-muted-foreground" />
              <!-- 使用線上搜尋開啟 -->
              {{ t('bookmark.row.openLiveSearch') }}
            </DropdownMenuItem>

            <DropdownMenuItem @click="ctx.startRenameBookmark(bm)">
              <Pencil class="text-muted-foreground" />
              {{ t('bookmark.action.rename') }}
            </DropdownMenuItem>

            <!-- 二級選單：更換封面 -->
            <DropdownMenuSub
              :open="ctx.isCoverSubMenu.value"
              @update:open="ctx.setCoverSubMenuOpen"
            >
              <DropdownMenuSubTrigger
                @click.stop="ctx.requestOpenCoverSubMenu(bm)"
                @keydown="ctx.handleCoverSubmenuKeydown($event, bm)"
              >
                <Image class="text-muted-foreground" />
                <!-- 更換封面 -->
                {{ t('bookmark.row.changeCover') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-[var(--pxd-cover-picker-width,272px)] p-1.5">
                <div
                  v-if="ctx.getResultImagesForBookmark(bm).length > 0"
                  class="cover-image-grid grid grid-cols-4 gap-[var(--pxd-space-sm)] max-h-[min(var(--pxd-cover-picker-max-height,240px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] p-[var(--pxd-space-sm)] overflow-y-auto pxd-scrollbar"
                >
                  <DropdownMenuItem
                    v-for="imageUrl in ctx.getResultImagesForBookmark(bm)"
                    :key="imageUrl"
                    class="cover-image-option w-full max-w-[var(--pxd-cover-picker-item-size,56px)] aspect-square min-h-0 h-auto p-0.5 justify-center"
                    :selected="bm.coverImageUrl === imageUrl"
                    :title="t('bookmark.row.setCover')"
                    @click="ctx.selectBookmarkCover(bm, imageUrl)"
                  >
                    <img
                      :src="imageUrl"
                      alt=""
                      class="size-full object-contain"
                      @error="ctx.handleCoverImageError"
                    />
                  </DropdownMenuItem>
                </div>
                <DropdownMenuItem
                  v-else
                  disabled
                  class="cover-empty-state justify-center text-muted-foreground select-none"
                >
                  {{ t('bookmark.row.noImages') }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem v-if="bm.coverImageUrl" @click="ctx.removeBookmarkCover(bm)">
              <ImageOff class="text-muted-foreground" />
              {{ t('bookmark.row.removeCover') }}
            </DropdownMenuItem>

            <!-- 二級選單：移動到資料夾 -->
            <DropdownMenuSub :open="ctx.isMoveSubMenu.value" @update:open="ctx.setMoveSubMenuOpen">
              <DropdownMenuSubTrigger>
                <FolderInput class="text-muted-foreground" />
                <!-- 移動到資料夾 -->
                {{ t('bookmark.action.moveToFolder') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                class="w-[var(--pxd-menu-sub-width,192px)] max-h-[min(var(--pxd-menu-sub-max-height,180px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto pxd-scrollbar"
              >
                <DropdownMenuItem
                  v-for="target in moveTargetFolders"
                  :key="target.folder.id"
                  :disabled="bm.groupId === target.folder.id"
                  :selected="bm.groupId === target.folder.id"
                  :title="ctx.getFolderPath(target.folder.id)"
                  @click="ctx.moveBookmark(bm.id, target.folder.id)"
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
                    v-if="bm.groupId === target.folder.id"
                    class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground ml-1"
                  >
                    {{ t('bookmark.action.currentLocation') }}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem variant="destructive" @click="ctx.deleteBookmark(bm.id)">
              <Trash2 class="text-destructive" />
              {{ t('bookmark.action.deleteBookmark') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
  ExternalLink,
  ArrowRight,
  Eye,
  MoreVertical,
  Image,
  ImageOff,
  Radio,
  Pencil,
  FolderInput,
  Trash2,
} from '@lucide/vue';
import { BOOKMARK_NAME_MAX_LENGTH } from '@/utils/bookmark-collection';
import { isLegacyTradeSearchUrl } from '@/utils/trade-search-identity';
import { t } from '@/utils/i18n';
import type { Bookmark } from './bookmark-types';
import {
  type BookmarkPaneContext,
  BOOKMARK_PANE_CONTEXT_KEY,
  getFlattenedFolderTree,
  getFolderItemIndentLevel,
} from './bookmark-tree';

/**
 * 單一書籤列。
 *
 * 效能邊界：每列只依賴自身的 `bookmark` 物件與「是否編輯中／選單開啟」等布林 computed，
 * 其他書籤或全域狀態（如拖曳開始）變動時不會重繪未啟用的列；操作列與下拉選單延遲至首次互動才掛載。
 */
export default defineComponent({
  name: 'BookmarkRow',
  components: {
    Button,
    Input,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuSeparator,
    Folder,
    ExternalLink,
    ArrowRight,
    Eye,
    MoreVertical,
    Image,
    ImageOff,
    Radio,
    Pencil,
    FolderInput,
    Trash2,
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
    bookmark: {
      type: Object as PropType<Bookmark>,
      required: true,
    },
  },
  setup(props) {
    const ctx = inject<BookmarkPaneContext>(BOOKMARK_PANE_CONTEXT_KEY);
    if (!ctx) {
      throw new Error('BookmarkRow must be used within BookmarkPane');
    }

    const bm = computed(() => props.bookmark);
    const isEditing = computed(() => ctx.editingBookmarkId.value === props.bookmark.id);
    const isMenuOpen = computed(() => ctx.activeBookmarkMenuId.value === props.bookmark.id);
    const isLegacyUrl = computed(() => isLegacyTradeSearchUrl(props.bookmark.url));
    const actionsActivated = ref(false);

    // 短路順序刻意讓尚未互動的列不追蹤 isDragging，拖曳開始時不會連帶重繪全部書籤列。
    const showActions = computed(
      () =>
        (actionsActivated.value || isMenuOpen.value) && !isEditing.value && !ctx.isDragging.value,
    );

    const moveTargetFolders = computed(() => getFlattenedFolderTree(ctx.groups.value));

    const activateActions = () => {
      actionsActivated.value = true;
    };

    const handlePrimaryClick = (event: Event) => {
      if (ctx.handleBookmarkPrimaryClick) {
        ctx.handleBookmarkPrimaryClick(props.bookmark, event);
      } else {
        ctx.openBookmark(props.bookmark);
      }
    };

    return {
      t,
      ctx,
      bm,
      isEditing,
      isMenuOpen,
      isLegacyUrl,
      showActions,
      moveTargetFolders,
      activateActions,
      handlePrimaryClick,
      getFolderItemIndentLevel,
      BOOKMARK_NAME_MAX_LENGTH,
    };
  },
});
</script>

<style scoped>
.bookmark-row-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 30px;
}
</style>
