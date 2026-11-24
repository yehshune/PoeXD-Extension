<template>
  <div
    v-if="items.length > 0"
    data-test="dropped-items-panel"
    class="flex flex-col rounded-md border border-amber-500/30 bg-amber-500/5 text-[length:var(--pxd-font-caption)] overflow-hidden"
  >
    <!-- 摘要列：點擊展開/收合 -->
    <div
      class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
    >
      <button
        type="button"
        data-test="btn-toggle-dropped-items"
        class="flex items-center gap-1.5 min-w-0 flex-1 text-left font-medium text-amber-600 dark:text-amber-400 hover:opacity-85 transition-opacity cursor-pointer"
        :aria-expanded="isExpanded"
        @click="isExpanded = !isExpanded"
      >
        <AlertTriangle class="size-[var(--control-icon-sm,14px)] shrink-0" aria-hidden="true" />
        <span data-test="dropped-items-count" class="truncate">
          {{ t('liveSearch.dropped.bannerTitle', { count: items.length }) }}
        </span>
        <ChevronDown
          class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-150"
          :class="{ 'rotate-180': isExpanded }"
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        data-test="btn-clear-dropped-items"
        class="shrink-0 px-1.5 py-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        @click="emit('clear-all')"
      >
        {{ t('liveSearch.dropped.clearAll') }}
      </button>
    </div>

    <!-- 展開清單 -->
    <div
      v-show="isExpanded"
      data-test="dropped-items-list"
      class="flex flex-col divide-y divide-border/50 border-t border-amber-500/20 max-h-[160px] overflow-y-auto bg-card/60"
    >
      <div
        v-for="item in items"
        :key="item.id"
        data-test="dropped-item-row"
        :data-dropped-id="item.id"
        class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] py-1.5"
      >
        <div class="min-w-0 flex-1 flex flex-col gap-0.5">
          <span
            data-test="dropped-item-source"
            class="truncate font-medium text-foreground"
            :title="resolveItemName(item)"
          >
            {{ resolveItemName(item) }}
          </span>
          <span class="truncate text-muted-foreground font-mono text-[11px]">
            {{ formatReceivedAgo(item.receivedAt) }} · {{ formatReason(item.reason) }}
            <template v-if="item.status === 'failed'">
              · <span class="text-destructive">{{ t('liveSearch.dropped.failed') }}</span>
            </template>
          </span>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            data-test="btn-fetch-dropped-item"
            :disabled="item.status === 'fetching'"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            @click="emit('fetch-item', item.id)"
          >
            <Loader2
              v-if="item.status === 'fetching'"
              class="size-3 animate-spin"
              aria-hidden="true"
            />
            <Download v-else class="size-3" aria-hidden="true" />
            <span>
              {{
                item.status === 'fetching'
                  ? t('liveSearch.dropped.fetching')
                  : t('liveSearch.dropped.fetchBtn')
              }}
            </span>
          </button>

          <button
            type="button"
            data-test="btn-dismiss-dropped-item"
            :disabled="item.status === 'fetching'"
            :title="t('liveSearch.dropped.dismissTitle')"
            :aria-label="t('liveSearch.dropped.dismissTitle')"
            class="inline-flex items-center justify-center p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            @click="emit('dismiss-item', item.id)"
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch, type PropType } from 'vue';
import { AlertTriangle, ChevronDown, Download, Loader2, X } from '@lucide/vue';
import { t } from '@/utils/i18n';
import type { LiveSearchDroppedItem, LiveSearchDroppedReason } from '@/utils/live-search-contract';

const props = defineProps({
  items: {
    type: Array as PropType<readonly Readonly<LiveSearchDroppedItem>[]>,
    required: true,
  },
  resolveSourceName: {
    type: Function as PropType<(ownerKey: string) => string | undefined>,
    default: undefined,
  },
});

const emit = defineEmits<{
  (e: 'fetch-item', droppedItemId: string): void;
  (e: 'dismiss-item', droppedItemId: string): void;
  (e: 'clear-all'): void;
}>();

const isExpanded = ref(false);
const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

function stopTimer() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

watch(
  [isExpanded, () => props.items.length],
  ([expanded, count]) => {
    if (count === 0) {
      isExpanded.value = false;
      stopTimer();
      return;
    }
    nowMs.value = Date.now();
    if (expanded) {
      if (tickTimer === null) {
        tickTimer = setInterval(() => {
          nowMs.value = Date.now();
        }, 1000);
      }
    } else {
      stopTimer();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  stopTimer();
});

function resolveItemName(item: Readonly<LiveSearchDroppedItem>): string {
  const fromMap = props.resolveSourceName?.(item.ownerKey);
  return fromMap || item.sourceName || item.searchId;
}

function formatReason(reason: LiveSearchDroppedReason): string {
  return reason === 'rate-limit-cooldown'
    ? t('liveSearch.dropped.reasonCooldown')
    : t('liveSearch.dropped.reasonExpired');
}

function formatReceivedAgo(receivedAt: number): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs.value - receivedAt) / 1000));
  let age: string;
  if (elapsedSec < 60) {
    age = t('liveSearch.rateLimit.unitSeconds', { n: elapsedSec });
  } else if (elapsedSec < 3600) {
    age = t('liveSearch.rateLimit.unitMinutes', { n: Math.floor(elapsedSec / 60) });
  } else {
    age = t('liveSearch.rateLimit.unitHours', { n: Math.floor(elapsedSec / 3600) });
  }
  return t('liveSearch.dropped.receivedAgo', { age });
}
</script>
