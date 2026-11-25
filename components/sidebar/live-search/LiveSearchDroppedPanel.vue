<template>
  <div
    v-if="groups.length > 0"
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
        class="flex items-center gap-[var(--pxd-space-xs)] min-w-0 flex-1 text-left font-medium text-amber-600 dark:text-amber-400 hover:opacity-85 transition-opacity cursor-pointer"
        :aria-expanded="isExpanded"
        @click="isExpanded = !isExpanded"
      >
        <AlertTriangle class="size-[var(--control-icon-sm,14px)] shrink-0" aria-hidden="true" />
        <span data-test="dropped-items-count" class="truncate">
          {{ t('liveSearch.dropped.bannerTitle', { count: totalDropped }) }}
        </span>
        <ChevronDown
          class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-150"
          :class="{ 'rotate-180': isExpanded }"
          aria-hidden="true"
        />
      </button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-test="btn-clear-dropped-items"
        class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground hover:text-foreground"
        @click="emit('clear-all')"
      >
        {{ t('liveSearch.dropped.clearAll') }}
      </Button>
    </div>

    <!-- 展開清單（採用專案標準 ScrollArea Foundation） -->
    <ScrollAreaRoot
      v-show="isExpanded"
      data-test="dropped-items-list"
      class="border-t border-amber-500/20 bg-card/60 max-h-[10rem] overflow-hidden"
    >
      <ScrollAreaViewport class="max-h-[10rem] w-full">
        <div class="flex flex-col divide-y divide-border/50">
          <div
            v-for="group in groups"
            :key="group.ownerKey"
            data-test="dropped-group-row"
            :data-owner-key="group.ownerKey"
            class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
          >
            <div class="min-w-0 flex-1 flex flex-col gap-0.5">
              <span
                data-test="dropped-group-source"
                class="truncate font-medium text-foreground"
                :title="resolveGroupName(group)"
              >
                {{ resolveGroupName(group) }}
              </span>
              <span
                data-test="dropped-group-breakdown"
                class="truncate text-muted-foreground font-mono text-[length:var(--pxd-font-micro)]"
              >
                {{ formatBreakdown(group) }} · {{ formatLastDroppedAgo(group.lastDroppedAt) }}
              </span>
            </div>

            <div class="flex items-center gap-[var(--pxd-space-xs)] shrink-0">
              <span
                data-test="dropped-group-total"
                class="font-mono tabular-nums text-amber-600 dark:text-amber-400"
              >
                {{ group.total }}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-test="btn-dismiss-dropped-group"
                :title="t('liveSearch.dropped.dismissTitle')"
                :aria-label="t('liveSearch.dropped.dismissTitle')"
                @click="emit('dismiss-group', group.ownerKey)"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </ScrollAreaViewport>
      <ScrollBar />
    </ScrollAreaRoot>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch, type PropType } from 'vue';
import { AlertTriangle, ChevronDown, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { ScrollAreaRoot, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { t } from '@/utils/i18n';
import type { LiveSearchDroppedGroup } from '@/utils/live-search-contract';

const props = defineProps({
  groups: {
    type: Array as PropType<readonly Readonly<LiveSearchDroppedGroup>[]>,
    required: true,
  },
  resolveSourceName: {
    type: Function as PropType<(ownerKey: string) => string | undefined>,
    default: undefined,
  },
});

const emit = defineEmits<{
  (e: 'dismiss-group', ownerKey: string): void;
  (e: 'clear-all'): void;
}>();

const isExpanded = ref(false);
const totalDropped = computed(() => props.groups.reduce((sum, group) => sum + group.total, 0));
const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

function stopTimer() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

watch(
  [isExpanded, () => props.groups.length],
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

function resolveGroupName(group: Readonly<LiveSearchDroppedGroup>): string {
  const fromMap = props.resolveSourceName?.(group.ownerKey);
  return fromMap || group.sourceName || group.searchId;
}

/** 只列出有發生的原因，例如「冷卻過久 3 · 等待逾時 1」 */
function formatBreakdown(group: Readonly<LiveSearchDroppedGroup>): string {
  const parts: string[] = [];
  const cooldown = group.counts['rate-limit-cooldown'];
  const expired = group.counts.expired;
  if (cooldown > 0) parts.push(t('liveSearch.dropped.reasonCooldownCount', { n: cooldown }));
  if (expired > 0) parts.push(t('liveSearch.dropped.reasonExpiredCount', { n: expired }));
  return parts.join(' · ');
}

function formatLastDroppedAgo(lastDroppedAt: number): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs.value - lastDroppedAt) / 1000));
  let age: string;
  if (elapsedSec < 60) {
    age = t('liveSearch.rateLimit.unitSeconds', { n: elapsedSec });
  } else if (elapsedSec < 3600) {
    age = t('liveSearch.rateLimit.unitMinutes', { n: Math.floor(elapsedSec / 60) });
  } else {
    age = t('liveSearch.rateLimit.unitHours', { n: Math.floor(elapsedSec / 3600) });
  }
  return t('liveSearch.dropped.lastAgo', { age });
}
</script>
