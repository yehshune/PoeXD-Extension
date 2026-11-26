<template>
  <div
    :data-source-id="item.id"
    :data-source-kind="item.kind"
    :data-source-compatibility="item.compatibility"
    data-test="connection-item"
    :draggable="item.removable ? 'true' : undefined"
    class="flex flex-col gap-[var(--pxd-space-xs)] py-[var(--pxd-bookmark-row-padding-y)] px-[var(--pxd-space-sm)] rounded-sm transition-colors"
    :class="rowClasses"
    @dragstart="emit('dragstart', item, group.id, $event)"
    @dragend="emit('dragend')"
  >
    <div class="flex items-center justify-between gap-[var(--pxd-space-xs)] min-w-0">
      <TradeSearchPreviewTooltip
        :open="isPreviewOpen"
        :disabled="item.compatibility === 'invalid-url'"
        :side="tooltipSide"
        :source-name="item.name"
        :boundary-anchor="boundaryAnchor"
        :preview-data="isPreviewOpen ? activePreviewData : null"
        @update:open="(open) => emit('preview-open-change', item, open)"
      >
        <div
          data-test="connection-item-identity"
          class="flex items-center gap-[var(--pxd-space-sm)] min-w-0 flex-1 outline-none"
          :class="isResultFilterable ? 'cursor-pointer' : 'cursor-default'"
          :data-result-filter-active="isResultFilterTarget ? 'true' : undefined"
          @click="emit('toggle-result-filter', item, group)"
        >
          <img
            v-if="item.coverImageUrl"
            :key="item.coverImageUrl"
            :src="item.coverImageUrl"
            data-test="connection-item-thumbnail"
            class="size-[var(--control-height-sm)] shrink-0 object-contain"
            alt=""
            draggable="false"
            @error="handleCoverImageError"
          />
          <span
            v-else-if="item.kind === 'bookmark'"
            data-test="connection-item-placeholder"
            class="flex size-[var(--control-height-sm)] shrink-0 items-center justify-center text-[length:var(--pxd-font-secondary)] leading-none text-muted-foreground select-none"
            >•</span
          >
          <span
            data-test="connection-item-name"
            :data-folder="folderBadge || undefined"
            class="text-[length:var(--pxd-font-secondary)] truncate min-w-0 flex-1"
            :class="
              isItemActive(item.status)
                ? 'font-semibold text-foreground'
                : 'font-medium text-foreground'
            "
          >
            {{ item.name }}
          </span>
          <span
            v-if="isResultFilterable && resultCount > 0"
            data-test="connection-item-hit-count"
            :title="t('liveSearch.resultFilter.hitCountTitle', { count: resultCount })"
            class="shrink-0 px-1.5 py-0.5 rounded-full text-[length:var(--pxd-font-caption)] font-mono tabular-nums leading-none"
            :class="
              isResultFilterTarget
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'bg-muted text-muted-foreground'
            "
          >
            {{ resultCount }}
          </span>
        </div>
      </TradeSearchPreviewTooltip>

      <div class="flex items-center gap-[var(--pxd-space-xs)] shrink-0">
        <!-- 單組靜音標記：僅在已靜音時顯示，點擊直接解除靜音 -->
        <Button
          v-if="item.muted && canToggleItemMute(item)"
          type="button"
          variant="ghost"
          size="icon-sm"
          :data-test="`btn-unmute-${item.id}`"
          :title="t('liveSearch.mute.unmuteTooltip')"
          :aria-label="t('liveSearch.mute.unmuteTooltip')"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          @click.stop="emit('toggle-mute', item)"
        >
          <BellOff aria-hidden="true" />
        </Button>

        <!-- 不相容且未處於 active/error：顯示單一精簡不相容原因標籤/Tooltip，禁止啟用 -->
        <template v-if="!isItemCompatible(item) && !isItemActiveOrError(item.status)">
          <Tooltip>
            <TooltipTrigger as-child>
              <span
                :data-test="`compatibility-${item.id}`"
                :aria-label="item.compatibilityMessage"
                class="px-1.5 py-0.5 rounded-sm text-[length:var(--pxd-font-caption)] font-medium whitespace-nowrap text-muted-foreground border border-border/50 bg-background/50 cursor-help"
              >
                {{ getIncompatibleLabel(item.compatibility) }}
              </span>
            </TooltipTrigger>
            <TooltipContent v-if="item.compatibilityMessage" side="top">
              {{ item.compatibilityMessage }}
            </TooltipContent>
          </Tooltip>
        </template>

        <template v-else>
          <!-- 單一狀態與操作合一按鈕：依連線狀態切換圖示、色彩與可點擊性 -->
          <!-- 1. 排隊 / 連線中 / 重連中：轉換為旋轉圖示且不可按 -->
          <Button
            v-if="isItemConnectingOrPending(item)"
            type="button"
            variant="ghost"
            size="icon-sm"
            :data-test="item.pending ? `btn-enable-${item.id}` : `btn-connecting-${item.id}`"
            :data-status="getItemStatusText(item)"
            :title="getItemConnectingTitle(item)"
            :aria-label="getItemConnectingTitle(item)"
            class="shrink-0 text-amber-500 disabled:opacity-100"
            disabled
          >
            <Loader2 class="animate-spin text-amber-500" />
          </Button>

          <!-- 2. 監聽中 (active)：點擊暫停 -->
          <Button
            v-else-if="item.status === 'active'"
            type="button"
            variant="ghost"
            size="icon-sm"
            :data-test="`btn-stop-${item.id}`"
            data-status="監聽中"
            :title="t('liveSearch.primary.pauseTooltip')"
            :aria-label="t('liveSearch.primary.pause')"
            class="shrink-0 text-emerald-500 hover:text-foreground hover:bg-muted/60"
            :disabled="isBatchRunning"
            @click="emit('stop', item)"
          >
            <Pause />
          </Button>

          <!-- 3. 異常已停止 (error)：左側紅條 + 警示色重啟按鈕 -->
          <Button
            v-else-if="item.status === 'error'"
            type="button"
            variant="ghost"
            size="icon-sm"
            :data-test="`btn-retry-${item.id}`"
            data-status="異常"
            :title="
              item.errorMessage
                ? t('liveSearch.primary.errorRetryTooltip', {
                    error: item.errorMessage,
                  })
                : t('liveSearch.primary.retryTooltip')
            "
            :aria-label="t('liveSearch.primary.retry')"
            class="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            :disabled="isBatchRunning"
            @click="emit('retry', item)"
          >
            <RotateCcw />
          </Button>

          <!-- 4. 未啟用 / 已暫停 (idle / closed)：點擊啟用（上次連線為次要操作改用 ghost） -->
          <Button
            v-else
            type="button"
            :variant="group.id === PREVIOUS_CONNECTIONS_GROUP_ID ? 'ghost' : 'secondary'"
            size="icon-sm"
            :data-test="`btn-enable-${item.id}`"
            data-status="未啟用"
            :title="t('liveSearch.primary.enable')"
            :aria-label="t('liveSearch.primary.enable')"
            class="shrink-0"
            :class="
              group.id === PREVIOUS_CONNECTIONS_GROUP_ID
                ? 'text-muted-foreground hover:text-foreground'
                : ''
            "
            :disabled="isBatchRunning"
            @click="emit('enable', item.id)"
          >
            <Play />
          </Button>
        </template>

        <!-- 次要操作選單 [⋯]：新分頁開啟、連線中取消或移除連線 -->
        <DropdownMenu
          v-if="hasItemSecondaryActions(item)"
          :open="isItemMenuOpen"
          @update:open="(open) => emit('menu-open-change', item.id, open)"
        >
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :data-test="`btn-item-menu-${item.id}`"
              :title="t('common.moreActions')"
              :aria-label="t('common.moreActions')"
              class="text-muted-foreground hover:text-foreground shrink-0"
              @pointerdown.capture="emit('menu-trigger-pointerdown', item.id, $event)"
              @click.capture="emit('menu-trigger-click-capture', $event)"
              @click.stop="emit('menu-trigger-click', item.id)"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            <DropdownMenuItem
              v-if="canToggleItemMute(item)"
              :data-test="`btn-toggle-mute-${item.id}`"
              @click="emit('toggle-mute', item)"
            >
              <Bell v-if="item.muted" class="text-muted-foreground" />
              <BellOff v-else class="text-muted-foreground" />
              {{ item.muted ? t('liveSearch.mute.unmuteAction') : t('liveSearch.mute.muteAction') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="canOpenItemUrl(item)"
              :data-test="`btn-open-new-tab-${item.id}`"
              @click="emit('open-new-tab', item)"
            >
              <ExternalLink class="text-muted-foreground" />
              {{ t('common.openNewTab') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="item.status === 'connecting' || item.status === 'reconnecting'"
              :data-test="`btn-stop-${item.id}`"
              @click="emit('stop', item)"
            >
              {{ t('liveSearch.primary.stopConnection') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="item.removable"
              :data-test="`btn-remove-${item.id}`"
              class="text-destructive focus:text-destructive"
              @click="emit('remove', item, group.id)"
            >
              {{
                group.id === PREVIOUS_CONNECTIONS_GROUP_ID
                  ? t('liveSearch.primary.removePreviousRecord')
                  : group.id === SESSION_CONNECTIONS_GROUP_ID
                    ? t('liveSearch.console.removeFromSession')
                    : t('liveSearch.primary.removeTempSearch')
              }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- 錯誤訊息 (若適用) -->
    <div
      v-if="item.errorMessage"
      :data-test="`error-${item.id}`"
      class="text-[length:var(--pxd-font-caption)] text-destructive leading-tight break-words"
    >
      {{ item.errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import {
  Bell,
  BellOff,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import TradeSearchPreviewTooltip from '../search-preview/TradeSearchPreviewTooltip.vue';
import type { TradeSearchPreviewData } from '../composables/useTradeSearchPreview';
import { isItemActiveOrError } from './useLiveSearchGroups';
import { t } from '@/utils/i18n';
import { parseTradeSearchUrl } from '@/utils/trade-search-identity';
import type { LiveSearchSubscriptionStatus } from '@/utils/live-search-contract';
import {
  PREVIOUS_CONNECTIONS_GROUP_ID,
  SESSION_CONNECTIONS_GROUP_ID,
  type LiveSearchSourceCompatibility,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
} from '@/entrypoints/content/logic/live-search-sources';

const props = defineProps({
  item: {
    type: Object as PropType<LiveSearchSourceItem>,
    required: true,
  },
  group: {
    type: Object as PropType<LiveSearchSourceGroup>,
    required: true,
  },
  tooltipSide: {
    type: String as PropType<'left' | 'right'>,
    required: true,
  },
  boundaryAnchor: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
  isPreviewOpen: {
    type: Boolean,
    required: true,
  },
  activePreviewData: {
    type: Object as PropType<TradeSearchPreviewData | null>,
    default: null,
  },
  isResultFilterable: {
    type: Boolean,
    required: true,
  },
  isResultFilterTarget: {
    type: Boolean,
    required: true,
  },
  resultCount: {
    type: Number,
    default: 0,
  },
  isBatchRunning: {
    type: Boolean,
    required: true,
  },
  isItemMenuOpen: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits<{
  (e: 'dragstart', item: LiveSearchSourceItem, groupId: string, event: DragEvent): void;
  (e: 'dragend'): void;
  (e: 'preview-open-change', item: LiveSearchSourceItem, open: boolean): void;
  (e: 'toggle-result-filter', item: LiveSearchSourceItem, group: LiveSearchSourceGroup): void;
  (e: 'enable', sourceId: string): void;
  (e: 'stop', item: LiveSearchSourceItem): void;
  (e: 'retry', item: LiveSearchSourceItem): void;
  (e: 'open-new-tab', item: LiveSearchSourceItem): void;
  (e: 'toggle-mute', item: LiveSearchSourceItem): void;
  (e: 'remove', item: LiveSearchSourceItem, groupId: string): void;
  (e: 'menu-open-change', itemId: string, open: boolean): void;
  (e: 'menu-trigger-pointerdown', itemId: string, event: PointerEvent | MouseEvent): void;
  (e: 'menu-trigger-click-capture', event: MouseEvent): void;
  (e: 'menu-trigger-click', itemId: string): void;
}>();

function handleCoverImageError(event: Event) {
  (event.currentTarget as HTMLImageElement).style.visibility = 'hidden';
}

function isItemCompatible(item: LiveSearchSourceItem): boolean {
  return item.compatibility === 'compatible';
}

function getIncompatibleLabel(compatibility?: LiveSearchSourceCompatibility): string {
  switch (compatibility) {
    case 'wrong-version':
      return t('liveSearch.primary.diffVersion');
    case 'wrong-league':
      return t('liveSearch.primary.diffLeague');
    case 'invalid-url':
      return t('liveSearch.primary.invalidUrl');
    default:
      return '';
  }
}

function isItemActive(status?: LiveSearchSubscriptionStatus): boolean {
  return status === 'connecting' || status === 'active' || status === 'reconnecting';
}

function isItemConnectingOrPending(item: LiveSearchSourceItem): boolean {
  return Boolean(item.pending) || item.status === 'connecting' || item.status === 'reconnecting';
}

function canOpenItemUrl(item: LiveSearchSourceItem): boolean {
  if (item.compatibility === 'invalid-url') return false;
  return Boolean(parseTradeSearchUrl(item.url));
}

function canToggleItemMute(item: LiveSearchSourceItem): boolean {
  if (!item.canonicalKey) return false;
  return (
    props.group.id === SESSION_CONNECTIONS_GROUP_ID ||
    props.group.id === PREVIOUS_CONNECTIONS_GROUP_ID
  );
}

function hasItemSecondaryActions(item: LiveSearchSourceItem): boolean {
  return Boolean(
    canToggleItemMute(item) ||
    canOpenItemUrl(item) ||
    item.removable ||
    item.status === 'connecting' ||
    item.status === 'reconnecting',
  );
}

function getItemStatusText(item: LiveSearchSourceItem): string {
  const status = item.status;
  if (!status || status === 'idle' || status === 'closed') {
    if (item.pending) {
      return t('liveSearch.primary.pendingStart');
    }
    return t('liveSearch.primary.statusIdle');
  }
  if (status === 'connecting') {
    return t('liveSearch.primary.statusConnecting');
  }
  if (status === 'active') {
    return t('liveSearch.primary.statusActive');
  }
  if (status === 'reconnecting') {
    if (typeof item.reconnectInSeconds === 'number' && item.reconnectInSeconds > 0) {
      return t('liveSearch.primary.reconnectingIn', { seconds: item.reconnectInSeconds });
    }
    return t('liveSearch.primary.reconnecting');
  }
  if (status === 'error') {
    return t('liveSearch.primary.statusError');
  }
  return status;
}

function getItemConnectingTitle(item: LiveSearchSourceItem): string {
  if (item.pending && (!item.status || item.status === 'idle' || item.status === 'closed')) {
    return t('liveSearch.tempDialog.starting');
  }
  return getItemStatusText(item);
}

const folderBadge = computed(() => {
  const item = props.item;
  if (item.kind !== 'bookmark') return '';
  const folder = item.groupName?.trim() ?? '';
  if (
    !folder ||
    folder === '本次連線' ||
    folder === '上次連線' ||
    folder === '暫時搜尋' ||
    folder === t('liveSearch.primary.sessionGroupName') ||
    folder === t('liveSearch.primary.previousGroupName') ||
    folder === t('liveSearch.console.temporarySource') ||
    folder === props.group.name
  ) {
    return '';
  }
  return folder;
});

const rowClasses = computed<Record<string, boolean>>(() => {
  const item = props.item;
  const isActive = item.status === 'active';
  const isPendingOrConnecting =
    item.status === 'connecting' || item.status === 'reconnecting' || Boolean(item.pending);
  const isError = item.status === 'error';
  return {
    'border-l-2 border-l-emerald-500 bg-muted/30 border border-border/40': isActive,
    'border-l-2 border-l-amber-500 bg-muted/20 border border-border/40':
      !isActive && isPendingOrConnecting,
    'border-l-2 border-l-destructive bg-destructive/5 border border-destructive/30': isError,
    'bg-background/60 hover:bg-muted/40': !isActive && !isPendingOrConnecting && !isError,
    'opacity-60': !isItemCompatible(item) && !isItemActiveOrError(item.status),
    'cursor-grab active:cursor-grabbing': Boolean(item.removable),
    'ring-1 ring-primary/60': props.isResultFilterTarget,
  };
});
</script>
