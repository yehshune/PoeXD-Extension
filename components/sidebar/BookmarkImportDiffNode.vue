<template>
  <div v-if="shouldRender" class="folder-diff-node select-none text-[length:var(--pxd-font-body)]">
    <!-- 資料夾列 -->
    <div
      class="folder-diff-header flex items-center justify-between py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] rounded hover:bg-accent/40 cursor-pointer transition-colors"
      @click="toggleExpand"
    >
      <div class="flex items-center gap-[var(--pxd-space-sm)] min-w-0 flex-1">
        <ChevronRight
          class="size-[var(--control-icon-sm,14px)] text-muted-foreground shrink-0 transition-transform duration-150"
          :class="{ 'rotate-90': isExpanded }"
        />
        <Folder class="size-[var(--control-icon-sm,14px)] text-muted-foreground shrink-0" />
        <span class="font-medium truncate" :title="node.name">{{ node.name }}</span>
      </div>

      <div class="flex items-center gap-[var(--pxd-space-sm)] shrink-0 ml-[var(--pxd-space-md)]">
        <span
          v-if="node.status === 'create'"
          class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] font-medium bg-primary/10 text-primary border border-primary/20"
        >
          {{ t('bookmarkImport.diff.statusCreate') }}
        </span>
        <span
          v-else-if="node.status === 'delete'"
          class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] font-medium bg-destructive/15 text-destructive border border-destructive/30"
        >
          {{ t('bookmarkImport.diff.statusDelete') }}
        </span>
        <span
          v-else
          class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] font-medium bg-muted text-muted-foreground border border-border"
        >
          {{ t('bookmarkImport.diff.statusKeep') }}
        </span>

        <span
          v-if="changeSummaryBadge"
          class="text-[length:var(--pxd-font-caption)] text-muted-foreground"
        >
          {{ changeSummaryBadge }}
        </span>
      </div>
    </div>

    <!-- 展開後的子資料夾與書籤 -->
    <div
      v-if="isExpanded"
      class="folder-diff-children flex flex-col gap-[var(--pxd-space-xs)] mt-[var(--pxd-space-xs)] pl-[var(--pxd-space-lg)]"
    >
      <!-- 子資料夾遞迴 -->
      <BookmarkImportDiffNode
        v-for="child in node.folders"
        :key="child.id || child.name"
        :node="child"
        :show-only-changed="showOnlyChanged"
        :expand-all="expandAll"
      />

      <!-- 書籤列表 -->
      <div
        v-for="bm in displayedBookmarks"
        :key="bm.url + bm.name + bm.status"
        class="bookmark-diff-row flex items-center justify-between py-[var(--pxd-space-xs)] pr-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)] rounded hover:bg-accent/20 transition-colors"
      >
        <div class="flex items-center gap-[var(--pxd-space-sm)] min-w-0 flex-1">
          <BookmarkIcon
            class="size-[var(--control-icon-sm,14px)] text-muted-foreground/70 shrink-0"
          />
          <span class="truncate text-foreground/90" :title="bm.name">{{ bm.name }}</span>
        </div>

        <div class="shrink-0 ml-[var(--pxd-space-md)]">
          <span
            v-if="bm.status === 'create'"
            class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] font-medium bg-primary/10 text-primary border border-primary/20"
          >
            {{ t('bookmarkImport.diff.statusCreate') }}
          </span>
          <span
            v-else-if="bm.status === 'delete'"
            class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] font-medium bg-destructive/15 text-destructive border border-destructive/30"
          >
            {{ t('bookmarkImport.diff.statusDelete') }}
          </span>
          <span
            v-else-if="bm.status === 'update'"
            class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] font-medium bg-accent text-accent-foreground border border-border"
          >
            {{ t('bookmarkImport.diff.statusUpdateCover') }}
          </span>
          <span
            v-else-if="bm.status === 'skip'"
            class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] font-medium bg-muted text-muted-foreground/80 border border-border"
          >
            {{ t('bookmarkImport.diff.statusSkip') }}
          </span>
          <span
            v-else
            class="px-1.5 py-0.5 rounded text-[length:var(--pxd-font-caption)] text-muted-foreground/70"
          >
            {{ t('bookmarkImport.diff.statusKeep') }}
          </span>
        </div>
      </div>

      <div
        v-if="node.folders.length === 0 && displayedBookmarks.length === 0"
        class="py-[var(--pxd-space-xs)] pr-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)] text-[length:var(--pxd-font-secondary)] text-muted-foreground/60 italic"
      >
        {{ t('bookmarkImport.diff.empty') }}
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType } from 'vue';
import { ChevronRight, Folder, Bookmark as BookmarkIcon } from '@lucide/vue';
import type { BookmarkTransferPlanFolderNode } from '@/utils/bookmark-transfer';
import { t } from '@/utils/i18n';

export default defineComponent({
  name: 'BookmarkImportDiffNode',
  components: {
    ChevronRight,
    Folder,
    BookmarkIcon,
  },
  props: {
    node: {
      type: Object as PropType<BookmarkTransferPlanFolderNode>,
      required: true,
    },
    showOnlyChanged: {
      type: Boolean,
      default: false,
    },
    expandAll: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const isExpanded = ref(props.expandAll);

    watch(
      () => props.expandAll,
      (next) => {
        isExpanded.value = next;
      },
    );

    const toggleExpand = () => {
      isExpanded.value = !isExpanded.value;
    };

    function hasNodeChanges(node: BookmarkTransferPlanFolderNode): boolean {
      if (node.status === 'create' || node.status === 'delete') return true;
      if (
        node.bookmarks.some(
          (b) =>
            b.status === 'create' ||
            b.status === 'delete' ||
            b.status === 'skip' ||
            b.status === 'update',
        )
      ) {
        return true;
      }
      return node.folders.some(hasNodeChanges);
    }

    const shouldRender = computed(() => {
      if (!props.showOnlyChanged) return true;
      return hasNodeChanges(props.node);
    });

    const displayedBookmarks = computed(() => {
      if (!props.showOnlyChanged) return props.node.bookmarks;
      return props.node.bookmarks.filter(
        (b) =>
          b.status === 'create' ||
          b.status === 'delete' ||
          b.status === 'skip' ||
          b.status === 'update',
      );
    });

    const changeSummaryBadge = computed(() => {
      const createdCount = props.node.bookmarks.filter((b) => b.status === 'create').length;
      const updatedCount = props.node.bookmarks.filter((b) => b.status === 'update').length;
      const deletedCount = props.node.bookmarks.filter((b) => b.status === 'delete').length;
      const skippedCount = props.node.bookmarks.filter((b) => b.status === 'skip').length;

      const parts: string[] = [];
      if (createdCount > 0) parts.push(`+${createdCount}`);
      if (updatedCount > 0) parts.push(t('bookmarkImport.diff.updated', { count: updatedCount }));
      if (deletedCount > 0) parts.push(`-${deletedCount}`);
      if (skippedCount > 0) parts.push(t('bookmarkImport.diff.skipped', { count: skippedCount }));

      return parts.join(', ');
    });

    return {
      t,
      isExpanded,
      toggleExpand,
      shouldRender,
      displayedBookmarks,
      changeSummaryBadge,
    };
  },
});
</script>
