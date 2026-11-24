<script setup lang="ts">
/**
 * 搜尋結果看板的「必含獨立詞綴」篩選面板與已選條件標籤列。
 *
 * 列出目前結果中實際出現的獨立詞條（自動區分單詞與複合詞），提供快速分類切換、
 * 累積階級（不限 / T1 / T1–T2 / T1–T3）與多條件即時交集件數。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { ChevronUp, Search, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import { t, type I18nKey } from '@/utils/i18n';
import SidebarFilterEmptyState from '../layout/SidebarFilterEmptyState.vue';
import {
  BOARD_MOD_QUICK_FILTERS,
  BOARD_MOD_TIER_CAPS,
  type BoardModCondition,
  type BoardModOption,
  type BoardModQuickFilter,
  type BoardModTierCap,
} from '@/utils/result-board/board-projection';

const props = defineProps<{
  open: boolean;
  query: string;
  quickFilter: BoardModQuickFilter;
  options: readonly BoardModOption[];
  allOptionCount: number;
  optionByKey: ReadonlyMap<string, BoardModOption>;
  conditions: readonly BoardModCondition[];
}>();

const emit = defineEmits<{
  'update:query': [value: string];
  'update:quickFilter': [value: BoardModQuickFilter];
  select: [key: string, maxTier?: BoardModTierCap];
  toggle: [key: string];
  remove: [key: string];
  clearAll: [];
  close: [];
}>();

const searchInputRef = ref<InstanceType<typeof Input> | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    (searchInputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
  },
);

const CATEGORY_LABEL_KEYS: Readonly<Record<string, I18nKey>> = {
  fractured: 'resultBoard.modFilter.category.fractured',
  implicit: 'resultBoard.modFilter.category.implicit',
  crafted: 'resultBoard.modFilter.category.crafted',
  enchant: 'resultBoard.modFilter.category.enchant',
};

const QUICK_FILTER_LABEL_KEYS: Readonly<Record<BoardModQuickFilter, I18nKey>> = {
  all: 'resultBoard.modFilter.quick.all',
  pure: 'resultBoard.modFilter.quick.pure',
  hybrid: 'resultBoard.modFilter.quick.hybrid',
  t1: 'resultBoard.modFilter.quick.t1',
};

function categoryLabel(category: string): string {
  const key = CATEGORY_LABEL_KEYS[category];
  return key ? t(key) : '';
}

function tierLabel(maxTier: BoardModTierCap | undefined): string {
  if (maxTier === undefined) return t('resultBoard.modFilter.anyTier');
  if (maxTier === 1) return t('resultBoard.modFilter.tierExact', { tier: 1 });
  return t('resultBoard.modFilter.tierUpTo', { tier: maxTier });
}

function optionTooltip(opt: BoardModOption): string {
  const metaParts: string[] = [];
  if (opt.bestTier) metaParts.push(opt.bestTier);
  if (opt.sampleNames.length > 0) metaParts.push(opt.sampleNames.join(', '));
  return metaParts.length > 0 ? `${opt.label} (${metaParts.join(' · ')})` : opt.label;
}

function activeTierOf(key: string): { active: boolean; maxTier?: BoardModTierCap } {
  const cond = props.conditions.find((item) => item.key === key);
  return cond ? { active: true, maxTier: cond.maxTier } : { active: false };
}

function isTierSelected(key: string, maxTier: BoardModTierCap | undefined): boolean {
  const state = activeTierOf(key);
  return state.active && state.maxTier === maxTier;
}

function hasVisibleTiers(opt: BoardModOption): boolean {
  return opt.hasTiers && opt.tierCounts[3] > 0;
}

function cycleConditionTier(cond: BoardModCondition): void {
  const opt = props.optionByKey.get(cond.key);
  if (!opt?.hasTiers) return;
  const candidates: (BoardModTierCap | undefined)[] = [
    ...BOARD_MOD_TIER_CAPS.filter((cap) => opt.tierCounts[cap] > 0),
    undefined,
  ];
  if (candidates.length <= 1) return;
  const idx = candidates.indexOf(cond.maxTier);
  const next = candidates[(idx + 1) % candidates.length];
  emit('select', cond.key, next);
}
const activePickerFilterLabels = computed(() => {
  const labels: string[] = [];
  const trimmed = props.query.trim();
  if (trimmed) {
    labels.push(t('common.filterTag.keyword', { query: trimmed }));
  }
  if (props.quickFilter !== 'all') {
    labels.push(t(QUICK_FILTER_LABEL_KEYS[props.quickFilter]));
  }
  return labels;
});

function resetPickerFilters(): void {
  if (props.query) emit('update:query', '');
  if (props.quickFilter !== 'all') emit('update:quickFilter', 'all');
}
</script>

<template>
  <div v-if="conditions.length > 0 || open" class="flex flex-col gap-[var(--pxd-space-xs)]">
    <!-- 已啟用的必含獨立詞綴條件標籤列 -->
    <div
      v-if="conditions.length > 0"
      class="flex flex-wrap items-center gap-[var(--pxd-space-xs)]"
      data-board-mod-chips
    >
      <div
        v-for="cond in conditions"
        :key="cond.key"
        class="inline-flex max-w-full items-center gap-[var(--pxd-space-xs)] rounded-md border border-primary/35 bg-primary/10 px-[var(--pxd-space-sm)] py-[2px] text-[length:var(--pxd-font-caption)] text-foreground"
        data-board-mod-chip
        :data-mod-key="cond.key"
      >
        <span
          v-if="optionByKey.get(cond.key)"
          class="shrink-0 rounded-sm bg-background/70 px-[4px] py-px text-[length:var(--pxd-font-micro)] font-medium leading-tight text-muted-foreground"
        >
          {{
            optionByKey.get(cond.key)!.isHybrid
              ? t('resultBoard.modFilter.hybrid')
              : t('resultBoard.modFilter.pure')
          }}
        </span>
        <span class="truncate font-medium" :title="optionByKey.get(cond.key)?.label ?? cond.key">
          {{ optionByKey.get(cond.key)?.label ?? cond.key }}
        </span>
        <button
          v-if="optionByKey.get(cond.key) && hasVisibleTiers(optionByKey.get(cond.key)!)"
          type="button"
          class="shrink-0 cursor-pointer rounded-sm border border-primary/30 bg-primary/15 px-[5px] py-px text-[length:var(--pxd-font-micro)] font-semibold leading-tight text-primary hover:bg-primary/25"
          data-board-mod-chip-tier
          @click="cycleConditionTier(cond)"
        >
          {{ tierLabel(cond.maxTier) }}
        </button>
        <button
          type="button"
          class="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-[2px] text-muted-foreground hover:bg-muted hover:text-foreground"
          :title="t('resultBoard.modFilter.removeCondition')"
          :aria-label="t('resultBoard.modFilter.removeCondition')"
          data-board-mod-chip-remove
          @click="emit('remove', cond.key)"
        >
          <X class="size-3.5" />
        </button>
      </div>
      <Button
        v-if="conditions.length > 1"
        variant="link"
        size="sm"
        class="h-auto p-0 text-[length:var(--pxd-font-caption)]"
        data-board-mod-clear-all
        @click="emit('clearAll')"
      >
        {{ t('resultBoard.modFilter.clearAll') }}
      </Button>
    </div>

    <!-- 可收合的獨立詞條選擇器 -->
    <div
      v-if="open"
      class="flex flex-col gap-[var(--pxd-space-xs)] rounded-md border border-border bg-card p-[var(--pxd-space-sm)]"
      data-board-mod-picker
    >
      <div class="flex items-center gap-[var(--pxd-space-xs)]">
        <div class="relative flex flex-1 items-center min-w-0">
          <Search
            class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
          />
          <Input
            ref="searchInputRef"
            :model-value="query"
            size="sm"
            :placeholder="t('resultBoard.modFilter.searchPlaceholder')"
            class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))]"
            data-board-mod-picker-search
            @update:model-value="emit('update:query', String($event ?? ''))"
            @keydown.esc.stop.prevent="emit('close')"
          />
          <Button
            v-if="query"
            variant="ghost"
            size="icon-sm"
            class="absolute right-[var(--pxd-space-xs)]"
            :aria-label="t('common.clearSearch')"
            @click="emit('update:query', '')"
          >
            <X />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          :title="t('resultBoard.modFilter.close')"
          :aria-label="t('resultBoard.modFilter.close')"
          data-board-mod-picker-close
          @click="emit('close')"
        >
          <ChevronUp />
        </Button>
      </div>

      <!-- 快速分類切換（全部 / 單詞 / 複合 / 僅 T1） -->
      <div
        v-if="allOptionCount > 0"
        class="flex flex-wrap items-center gap-[var(--pxd-space-xs)]"
        role="group"
        data-board-mod-quick-filters
      >
        <button
          v-for="mode in BOARD_MOD_QUICK_FILTERS"
          :key="mode"
          type="button"
          class="cursor-pointer rounded-sm border px-[var(--pxd-space-sm)] py-[3px] text-[length:var(--pxd-font-micro)] font-medium leading-tight transition-colors"
          :class="
            quickFilter === mode
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'
          "
          :aria-pressed="quickFilter === mode"
          :data-board-mod-quick-filter="mode"
          @click="emit('update:quickFilter', mode)"
        >
          {{ t(QUICK_FILTER_LABEL_KEYS[mode]) }}
        </button>
      </div>

      <p
        v-if="allOptionCount === 0"
        class="m-0 py-[var(--pxd-space-sm)] text-center text-[length:var(--pxd-font-caption)] text-muted-foreground"
        data-board-mod-picker-empty
      >
        {{ t('resultBoard.modFilter.empty') }}
      </p>
      <SidebarFilterEmptyState
        v-else-if="options.length === 0"
        compact
        :message="t('resultBoard.modFilter.noMatch')"
        :active-filters="activePickerFilterLabels"
        :show-reset="activePickerFilterLabels.length > 0"
        data-board-mod-picker-no-match
        @reset="resetPickerFilters"
      />
      <ScrollAreaRoot v-else class="relative max-h-[min(240px,36vh)] overflow-hidden">
        <ScrollAreaViewport class="max-h-[min(240px,36vh)] w-full">
          <ul
            class="m-0 flex list-none flex-col gap-[var(--pxd-space-xs)] p-0 pr-[var(--pxd-space-sm)]"
            data-board-mod-picker-list
          >
            <li
              v-for="opt in options"
              :key="opt.key"
              class="flex flex-col gap-[var(--pxd-space-xs)] rounded-sm border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] transition-colors"
              :class="[
                activeTierOf(opt.key).active
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-transparent hover:bg-muted/50',
                !activeTierOf(opt.key).active && opt.itemCount === 0 ? 'opacity-45' : '',
              ]"
              data-board-mod-option
              :data-mod-key="opt.key"
            >
              <button
                type="button"
                class="flex w-full cursor-pointer items-start justify-between gap-[var(--pxd-space-sm)] border-0 bg-transparent p-0 text-left"
                :title="optionTooltip(opt)"
                data-board-mod-option-toggle
                @click="emit('toggle', opt.key)"
              >
                <span
                  class="flex-1 break-words text-[length:var(--pxd-font-caption)] leading-snug text-foreground"
                >
                  {{ opt.label }}
                </span>
                <span class="flex shrink-0 items-center gap-[var(--pxd-space-xs)]">
                  <span
                    v-if="categoryLabel(opt.category)"
                    class="rounded-sm border border-border px-[5px] py-px text-[length:var(--pxd-font-micro)] leading-tight text-muted-foreground"
                  >
                    {{ categoryLabel(opt.category) }}
                  </span>
                  <span
                    class="rounded-sm px-[5px] py-px text-[length:var(--pxd-font-micro)] font-medium leading-tight"
                    :class="
                      opt.isHybrid ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary'
                    "
                    data-board-mod-kind
                  >
                    {{
                      opt.isHybrid
                        ? t('resultBoard.modFilter.hybrid')
                        : t('resultBoard.modFilter.pure')
                    }}
                  </span>
                  <span
                    class="min-w-[1.6em] text-right text-[length:var(--pxd-font-micro)] tabular-nums text-muted-foreground"
                  >
                    {{ opt.itemCount }}
                  </span>
                </span>
              </button>

              <div
                v-if="hasVisibleTiers(opt)"
                class="flex flex-wrap items-center gap-[var(--pxd-space-xs)]"
              >
                <button
                  type="button"
                  class="cursor-pointer rounded-sm border px-[6px] py-[3px] text-[length:var(--pxd-font-micro)] leading-tight tabular-nums transition-colors"
                  :class="
                    isTierSelected(opt.key, undefined)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  "
                  data-board-mod-tier="any"
                  @click="emit('select', opt.key, undefined)"
                >
                  {{ t('resultBoard.modFilter.anyTier') }} ({{ opt.itemCount }})
                </button>
                <button
                  v-for="cap in BOARD_MOD_TIER_CAPS"
                  :key="cap"
                  type="button"
                  :disabled="opt.tierCounts[cap] === 0"
                  class="rounded-sm border px-[6px] py-[3px] text-[length:var(--pxd-font-micro)] leading-tight tabular-nums transition-colors"
                  :class="
                    isTierSelected(opt.key, cap)
                      ? 'cursor-pointer border-primary bg-primary text-primary-foreground'
                      : opt.tierCounts[cap] === 0
                        ? 'cursor-not-allowed border-border/50 bg-background/30 text-muted-foreground/45'
                        : 'cursor-pointer border-border bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  "
                  :data-board-mod-tier="String(cap)"
                  @click="emit('select', opt.key, cap)"
                >
                  {{ tierLabel(cap) }} ({{ opt.tierCounts[cap] }})
                </button>
              </div>
            </li>
          </ul>
        </ScrollAreaViewport>
        <ScrollBar />
        <ScrollAreaCorner />
      </ScrollAreaRoot>
    </div>
  </div>
</template>
