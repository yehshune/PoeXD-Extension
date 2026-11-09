<template>
  <Popover :open="open" @update:open="(val: boolean) => $emit('update:open', val)">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="6"
      :collision-padding="8"
      class="w-[var(--pxd-overlay-inspect-width)] flex flex-col gap-[var(--pxd-space-md)] max-w-[calc(100vw-32px)] text-[length:var(--pxd-font-caption)]"
      data-test="resume-inspect-popover"
    >
      <div
        class="flex items-center justify-between border-b border-border pb-[var(--pxd-space-sm)]"
      >
        <div
          class="flex items-center gap-[var(--pxd-space-sm)] font-semibold text-foreground text-[length:var(--pxd-font-secondary)] min-w-0"
        >
          <Radio class="size-[var(--control-icon-sm,14px)] text-primary shrink-0" />
          <span class="truncate">{{ t('liveSearch.inspect.title', { count: items.length }) }}</span>
        </div>
        <span
          class="text-[length:var(--pxd-font-caption)] text-muted-foreground font-mono shrink-0"
        >
          {{ leagueDisplay }}
        </span>
      </div>

      <div
        v-if="items.length === 0"
        data-test="resume-inspect-empty"
        class="text-center py-[var(--pxd-space-xl)] text-muted-foreground"
      >
        {{ t('liveSearch.inspect.empty') }}
      </div>

      <ScrollAreaRoot v-else class="max-h-[var(--pxd-overlay-inspect-max-height)] overflow-hidden">
        <ScrollAreaViewport
          data-test="resume-inspect-list"
          class="flex flex-col gap-[var(--pxd-space-sm)] pr-[var(--pxd-space-xs)]"
        >
          <div
            v-for="item in items"
            :key="item.id"
            data-test="resume-inspect-item"
            class="flex items-center justify-between gap-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] rounded-[var(--radius)] bg-muted/40 hover:bg-muted/70 transition-colors"
          >
            <div class="flex flex-col min-w-0 flex-1 gap-0.5">
              <span
                data-test="resume-inspect-item-name"
                class="text-[length:var(--pxd-font-body)] font-medium text-foreground truncate"
                :title="item.name"
              >
                {{ item.name }}
              </span>
              <span
                data-test="resume-inspect-item-context"
                class="text-[length:var(--pxd-font-micro)] text-muted-foreground truncate"
                :title="item.groupPath"
              >
                {{ item.groupPath }}
              </span>
            </div>

            <span
              data-test="resume-inspect-item-status"
              class="shrink-0 text-[length:var(--pxd-font-micro)] px-[var(--pxd-space-xs)] py-0.5 rounded-[var(--radius)] border border-border/50 bg-background/60 font-medium"
              :class="getStatusTextColor(item.status)"
            >
              {{ getItemStatusText(item.status) }}
            </span>
          </div>
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollAreaRoot>

      <div class="flex items-center justify-end pt-[var(--pxd-space-xs)] border-t border-border">
        <Button
          type="button"
          size="sm"
          data-test="btn-resume-inspect-restore"
          :disabled="isBatchRunning || items.length === 0"
          @click="handleRestore"
        >
          {{ t('liveSearch.inspect.restoreBtn', { count: items.length }) }}
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import type { PropType } from 'vue';
import { Radio } from '@lucide/vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollAreaRoot, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { t } from '@/utils/i18n';
import type { LiveSearchSubscriptionStatus } from '@/utils/live-search-contract';

export interface ResumableInspectItem {
  id: string;
  name: string;
  groupPath: string;
  status: LiveSearchSubscriptionStatus;
}

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  items: {
    type: Array as PropType<readonly ResumableInspectItem[]>,
    default: () => [],
  },
  leagueDisplay: {
    type: String,
    default: '',
  },
  isBatchRunning: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'restore'): void;
}>();

function getItemStatusText(status: LiveSearchSubscriptionStatus): string {
  switch (status) {
    case 'active':
      return t('liveSearch.primary.statusActive');
    case 'connecting':
    case 'reconnecting':
      return t('liveSearch.primary.statusConnecting');
    case 'error':
      return t('liveSearch.primary.statusError');
    case 'idle':
    case 'closed':
    default:
      return t('liveSearch.primary.statusIdle');
  }
}

function getStatusTextColor(status: LiveSearchSubscriptionStatus): string {
  switch (status) {
    case 'active':
      return 'text-emerald-500';
    case 'connecting':
    case 'reconnecting':
      return 'text-amber-500';
    case 'error':
      return 'text-destructive';
    case 'idle':
    case 'closed':
    default:
      return 'text-muted-foreground';
  }
}

function handleRestore() {
  emit('restore');
  emit('update:open', false);
}
</script>
