<template>
  <div
    :data-group-id="group.id"
    :data-group-kind="group.kind"
    :data-parent-id="group.parentId"
    :data-depth="group.depth ?? 0"
    :style="groupIndentStyle"
    data-test="connection-group"
    class="group-container flex flex-col rounded-md border border-border bg-card overflow-hidden shrink-0"
  >
    <!-- 可收合 Group Header + 群組批次選單 [⋯] -->
    <div
      class="group-header-row group relative flex items-center justify-between cursor-pointer select-none border-0 border-solid border-l-2 bg-muted/40 hover:bg-muted/70 px-[var(--pxd-space-md)] py-[var(--pxd-bookmark-row-padding-y)]"
      :class="{
        'border-l-primary': group.id !== PREVIOUS_CONNECTIONS_GROUP_ID,
        'border-l-muted-foreground/60': group.id === PREVIOUS_CONNECTIONS_GROUP_ID,
        'border-b border-border': !isCollapsed && group.items.length > 0,
      }"
    >
      <button
        type="button"
        data-test="connection-group-header"
        :data-group-toggle="group.id"
        :aria-expanded="!isCollapsed"
        class="flex flex-1 min-w-0 items-center justify-between gap-[var(--pxd-space-sm)] text-left cursor-pointer select-none"
        @click="emit('toggle-collapse', group.id)"
      >
        <div class="flex items-center gap-[var(--pxd-space-md)] min-w-0 flex-1">
          <Radio
            v-if="group.id === SESSION_CONNECTIONS_GROUP_ID"
            class="size-[var(--control-icon-sm,14px)] shrink-0 text-primary"
          />
          <RotateCcw
            v-else-if="group.id === PREVIOUS_CONNECTIONS_GROUP_ID"
            class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
          />
          <Folder
            v-else
            class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
          />
          <span
            data-test="connection-group-name"
            class="truncate text-[length:var(--pxd-font-secondary)] font-bold text-foreground"
            :title="group.name"
          >
            {{ group.name }}
          </span>
        </div>

        <div
          data-test="connection-group-count"
          class="shrink-0 flex items-center gap-1 text-[length:var(--pxd-font-caption)] font-mono text-muted-foreground"
        >
          <span>
            {{ stats.enabledCount }} /
            {{ stats.totalCount }}
          </span>
          <template v-if="stats.errorCount > 0">
            <span>·</span>
            <span data-test="connection-group-error-count" class="text-destructive font-medium">
              {{ stats.errorCount }}
              {{ t('liveSearch.primary.error') }}
            </span>
          </template>
          <ChevronDown
            class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-150 ml-0.5"
            :class="{ '-rotate-90': isCollapsed }"
          />
        </div>
      </button>

      <!-- 本次連線標題列快捷 [＋ 新增搜尋連線] -->
      <Button
        v-if="group.id === SESSION_CONNECTIONS_GROUP_ID"
        type="button"
        variant="ghost"
        size="icon-sm"
        data-test="btn-group-add-connection"
        :title="t('liveSearch.primary.addNewConnection')"
        :aria-label="t('liveSearch.primary.addNewConnection')"
        class="shrink-0 text-muted-foreground hover:text-foreground ml-1"
        @click.stop="emit('open-add-connection')"
      >
        <Plus />
      </Button>

      <!-- 群組快捷啟用操作：若群組或其子樹內存在尚未啟用的項目，直接提供低干擾的快捷啟用操作 -->
      <Button
        v-if="hasEnableableSources"
        type="button"
        variant="ghost"
        size="icon-sm"
        :data-test="`btn-group-quick-enable-${group.id}`"
        :title="quickEnableTitle"
        :aria-label="quickEnableTitle"
        class="shrink-0 text-primary hover:text-primary hover:bg-primary/10 ml-1"
        :disabled="isBatchRunning"
        @click.stop="emit('batch-enable-group', group.id)"
      >
        <Play />
      </Button>

      <DropdownMenu
        :open="isGroupMenuOpen"
        @update:open="(open) => emit('group-menu-open-change', group.id, open)"
      >
        <DropdownMenuTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :data-test="`btn-group-menu-${group.id}`"
            :title="t('liveSearch.primary.groupBatchAction')"
            :aria-label="t('liveSearch.primary.groupBatchAction')"
            class="shrink-0 text-muted-foreground hover:text-foreground ml-1"
            :disabled="isBatchRunning"
            @pointerdown.capture="emit('group-menu-trigger-pointerdown', group.id, $event)"
            @click.capture="emit('menu-trigger-click-capture', $event)"
            @click.stop="emit('group-menu-trigger-click', group.id)"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <template v-if="group.id === PREVIOUS_CONNECTIONS_GROUP_ID">
            <DropdownMenuItem
              :data-test="`btn-group-enable-all-${group.id}`"
              :disabled="isBatchRunning"
              @click="emit('batch-enable-group', group.id)"
            >
              {{ t('liveSearch.primary.restoreAll') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :data-test="`btn-group-clear-${group.id}`"
              :disabled="isBatchRunning"
              class="text-destructive focus:text-destructive"
              @click="emit('clear-previous-connections')"
            >
              {{ t('liveSearch.primary.clearPreviousRecords') }}
            </DropdownMenuItem>
          </template>
          <template v-else-if="group.id === SESSION_CONNECTIONS_GROUP_ID">
            <DropdownMenuItem
              :data-test="`btn-group-enable-all-${group.id}`"
              :disabled="isBatchRunning"
              @click="emit('batch-enable-group', group.id)"
            >
              {{ t('liveSearch.primary.enableAll') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :data-test="`btn-group-stop-all-${group.id}`"
              :disabled="isBatchRunning"
              @click="emit('batch-stop-group', group.id)"
            >
              {{ t('liveSearch.primary.stopAll') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :data-test="`btn-group-clear-stopped-${group.id}`"
              :disabled="isBatchRunning || !hasStoppedSources"
              class="text-destructive focus:text-destructive"
              @click="emit('clear-stopped-session-connections')"
            >
              {{ t('liveSearch.console.removeStopped') }}
            </DropdownMenuItem>
          </template>
          <template v-else>
            <DropdownMenuItem
              :data-test="`btn-group-enable-all-${group.id}`"
              :disabled="isBatchRunning"
              @click="emit('batch-enable-group', group.id)"
            >
              {{
                group.kind === 'custom'
                  ? t('liveSearch.primary.enableAllInGroup')
                  : t('liveSearch.primary.enableAllInFolder')
              }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :data-test="`btn-group-stop-all-${group.id}`"
              :disabled="isBatchRunning"
              @click="emit('batch-stop-group', group.id)"
            >
              {{
                group.kind === 'custom'
                  ? t('liveSearch.primary.stopAllInGroup')
                  : t('liveSearch.primary.stopAllInFolder')
              }}
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Group Items (收合時隱藏；若該層無 direct items 亦不渲染空區塊) -->
    <div
      v-if="!isCollapsed && group.items.length > 0"
      data-test="connection-group-items"
      class="flex flex-col gap-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] py-[var(--pxd-bookmark-folder-body-padding-y)] bg-background"
    >
      <LiveSearchSourceRow
        v-for="item in group.items"
        :key="item.id"
        :item="item"
        :group="group"
        :tooltip-side="tooltipSide"
        :boundary-anchor="boundaryAnchor"
        :is-preview-open="activeEntityKey === getPreviewEntityKey(item)"
        :active-preview-data="activePreviewData"
        :is-result-filterable="isItemResultFilterable(item, group)"
        :is-result-filter-target="isItemResultFilterTarget(item)"
        :is-batch-running="isBatchRunning"
        :is-item-menu-open="activeItemMenuId === item.id"
        @dragstart="(it, gId, ev) => emit('connection-dragstart', it, gId, ev)"
        @dragend="emit('connection-dragend')"
        @preview-open-change="(it, open) => emit('preview-open-change', it, open)"
        @toggle-result-filter="(it, grp) => emit('toggle-result-filter', it, grp)"
        @enable="(sourceId) => emit('enable-source', sourceId)"
        @stop="(it) => emit('stop-source', it)"
        @retry="(it) => emit('retry-source', it)"
        @remove="(it, gId) => emit('remove-source', it, gId)"
        @menu-open-change="(itemId, open) => emit('item-menu-open-change', itemId, open)"
        @menu-trigger-pointerdown="
          (itemId, ev) => emit('item-menu-trigger-pointerdown', itemId, ev)
        "
        @menu-trigger-click-capture="(ev) => emit('menu-trigger-click-capture', ev)"
        @menu-trigger-click="(itemId) => emit('item-menu-trigger-click', itemId)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { ChevronDown, Folder, MoreHorizontal, Play, Plus, Radio, RotateCcw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import LiveSearchSourceRow from './LiveSearchSourceRow.vue';
import { getPreviewEntityKey, type LiveSearchGroupStats } from './useLiveSearchGroups';
import type { TradeSearchPreviewData } from '../composables/useTradeSearchPreview';
import { t } from '@/utils/i18n';
import {
  PREVIOUS_CONNECTIONS_GROUP_ID,
  SESSION_CONNECTIONS_GROUP_ID,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';

const props = defineProps({
  group: {
    type: Object as PropType<LiveSearchSourceGroup>,
    required: true,
  },
  stats: {
    type: Object as PropType<LiveSearchGroupStats>,
    required: true,
  },
  isCollapsed: {
    type: Boolean,
    required: true,
  },
  hasEnableableSources: {
    type: Boolean,
    required: true,
  },
  hasStoppedSources: {
    type: Boolean,
    required: true,
  },
  isBatchRunning: {
    type: Boolean,
    required: true,
  },
  isGroupMenuOpen: {
    type: Boolean,
    required: true,
  },
  activeItemMenuId: {
    type: String as PropType<string | null>,
    default: null,
  },
  tooltipSide: {
    type: String as PropType<'left' | 'right'>,
    required: true,
  },
  boundaryAnchor: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
  activeEntityKey: {
    type: String as PropType<string | null>,
    default: null,
  },
  activePreviewData: {
    type: Object as PropType<TradeSearchPreviewData | null>,
    default: null,
  },
  isItemResultFilterable: {
    type: Function as PropType<
      (item: LiveSearchSourceItem, group: LiveSearchSourceGroup) => boolean
    >,
    required: true,
  },
  isItemResultFilterTarget: {
    type: Function as PropType<(item: LiveSearchSourceItem) => boolean>,
    required: true,
  },
});

const emit = defineEmits<{
  (e: 'toggle-collapse', groupId: string): void;
  (e: 'open-add-connection'): void;
  (e: 'batch-enable-group', groupId: string): void;
  (e: 'batch-stop-group', groupId: string): void;
  (e: 'clear-previous-connections'): void;
  (e: 'clear-stopped-session-connections'): void;
  (e: 'group-menu-open-change', groupId: string, open: boolean): void;
  (e: 'group-menu-trigger-pointerdown', groupId: string, event: PointerEvent | MouseEvent): void;
  (e: 'group-menu-trigger-click', groupId: string): void;
  (e: 'menu-trigger-click-capture', event: MouseEvent): void;
  (e: 'connection-dragstart', item: LiveSearchSourceItem, groupId: string, event: DragEvent): void;
  (e: 'connection-dragend'): void;
  (e: 'preview-open-change', item: LiveSearchSourceItem, open: boolean): void;
  (e: 'toggle-result-filter', item: LiveSearchSourceItem, group: LiveSearchSourceGroup): void;
  (e: 'enable-source', sourceId: string): void;
  (e: 'stop-source', item: LiveSearchSourceItem): void;
  (e: 'retry-source', item: LiveSearchSourceItem): void;
  (e: 'remove-source', item: LiveSearchSourceItem, groupId: string): void;
  (e: 'item-menu-open-change', itemId: string, open: boolean): void;
  (e: 'item-menu-trigger-pointerdown', itemId: string, event: PointerEvent | MouseEvent): void;
  (e: 'item-menu-trigger-click', itemId: string): void;
}>();

const groupIndentStyle = computed<Record<string, string>>(() => {
  const depth = props.group.depth ?? 0;
  if (depth <= 0) return {} as Record<string, string>;
  const step = '(var(--pxd-space-lg) + var(--pxd-space-md))';
  const sum = Array.from({ length: depth }, () => step).join(' + ');
  return {
    marginLeft: `calc(${sum})`,
  };
});

const quickEnableTitle = computed(() => {
  if (props.group.id === PREVIOUS_CONNECTIONS_GROUP_ID) {
    return t('liveSearch.primary.restoreAll');
  }
  if (props.group.id === SESSION_CONNECTIONS_GROUP_ID) {
    return t('liveSearch.primary.enableAll');
  }
  return t('liveSearch.primary.enableGroup');
});
</script>
