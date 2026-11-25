<script setup lang="ts">
/**
 * 賣家展開區的一個倉庫分頁：不再包一層框，只有一行小標題（整頁勾選、分頁名稱、件數、複製搜尋字串），
 * 倉庫搜尋 regex 預設收合，需要看或分段複製時再展開；警告一律顯示。
 * 整頁都已售出時標題列淡化（物品列各自依售出狀態淡化，不重複疊加）。
 */
import { computed, ref } from 'vue';
import { ChevronDown, CircleHelp, Copy, TriangleAlert } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import type { BoardMark, CurrencyDisplay } from '@/utils/result-board/board-session';
import ResultBoardItemRow from './ResultBoardItemRow.vue';
import type { StashSection } from './stash-section';

const props = defineProps<{
  group: StashSection;
  rates?: CurrencyRateSnapshot;
  currencies: Readonly<Record<string, CurrencyDisplay>>;
  marks: Readonly<Record<string, BoardMark>>;
  isPicked: (entry: BoardEntry) => boolean;
  isPinned: (id: string) => boolean;
  travelStates: Readonly<Record<string, 'refreshing' | 'traveling'>>;
  isExpanded: (id: string) => boolean;
  cardSnapshot: (id: string) => PinnedItemSnapshot | undefined;
}>();

const emit = defineEmits<{
  pick: [entry: BoardEntry];
  pickGroup: [entries: readonly BoardEntry[]];
  toggle: [id: string];
  locate: [id: string];
  travel: [id: string];
  pin: [id: string];
  copyRegex: [text: string];
}>();

const isRegexOpen = ref(false);

const parts = computed(() => props.group.regex?.parts ?? []);

const warnings = computed(() => {
  const regex = props.group.regex;
  if (!regex) return [];
  return [
    regex.ambiguousIds.length > 0
      ? t('resultBoard.regex.ambiguous', { count: regex.ambiguousIds.length })
      : '',
    regex.unpricedIds.length > 0
      ? t('resultBoard.regex.unpriced', { count: regex.unpricedIds.length })
      : '',
    regex.tooLongIds.length > 0
      ? t('resultBoard.regex.tooLong', { count: regex.tooLongIds.length })
      : '',
  ].filter(Boolean);
});
</script>

<template>
  <div
    class="flex flex-col border-0 border-t border-dashed border-border first:border-t-0"
    data-board-stash-group
    :data-board-stash-name="group.stashName ?? ''"
  >
    <div
      class="flex min-h-[var(--control-height-sm)] items-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] pt-[var(--pxd-space-sm)] pb-[var(--pxd-space-xs)]"
      :class="group.allSold ? 'opacity-65' : ''"
      data-board-stash-header
    >
      <Checkbox
        v-if="group.instantBuyoutCount > 0"
        :model-value="group.pickState"
        class="pxd-pick-checkbox"
        :aria-label="t('resultBoard.stash.toggleAll')"
        data-board-stash-pick
        @update:model-value="emit('pickGroup', group.entries)"
      />
      <span
        class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-caption)] font-semibold text-muted-foreground"
      >
        {{
          group.stashName
            ? t('resultBoard.stash.tab', { name: group.stashName })
            : t('resultBoard.stash.unknown')
        }}
        <span class="font-normal tabular-nums">({{ group.entries.length }})</span>
      </span>
      <template v-if="group.regex">
        <Button
          v-if="parts.length === 1"
          variant="ghost"
          size="sm"
          class="h-[var(--control-height-sm)] shrink-0 gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)]"
          :title="t('resultBoard.regex.hint')"
          data-board-stash-regex-quick-copy
          @click="emit('copyRegex', parts[0])"
        >
          <Copy class="size-[var(--control-icon-sm)]" />
          {{ t('resultBoard.regex.copyShort') }}
        </Button>
        <span
          v-else
          class="inline-flex shrink-0 text-muted-foreground/80"
          :title="t('resultBoard.regex.hint')"
          :aria-label="t('resultBoard.regex.hint')"
          data-board-stash-regex-hint
        >
          <CircleHelp class="size-[var(--control-icon-sm)]" />
        </span>
        <Button
          v-if="parts.length === 1"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground"
          :aria-expanded="isRegexOpen"
          :title="isRegexOpen ? t('resultBoard.regex.hide') : t('resultBoard.regex.show')"
          :aria-label="isRegexOpen ? t('resultBoard.regex.hide') : t('resultBoard.regex.show')"
          data-board-stash-regex-toggle
          @click="isRegexOpen = !isRegexOpen"
        >
          <ChevronDown class="transition-transform" :class="isRegexOpen ? 'rotate-180' : ''" />
        </Button>
      </template>
    </div>

    <section
      v-if="group.regex && (isRegexOpen || parts.length !== 1 || warnings.length > 0)"
      class="flex flex-col gap-[var(--pxd-space-xs)] px-[var(--pxd-space-md)] pb-[var(--pxd-space-xs)]"
      data-board-stash-regex
    >
      <p
        v-if="parts.length === 0"
        class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
        data-board-stash-regex-empty
      >
        {{ t('resultBoard.regex.empty') }}
      </p>
      <button
        v-else-if="parts.length > 1"
        type="button"
        class="cursor-pointer self-start border-0 bg-transparent p-0 text-[length:var(--pxd-font-micro)] text-primary hover:underline"
        :aria-expanded="isRegexOpen"
        data-board-stash-regex-parts-toggle
        @click="isRegexOpen = !isRegexOpen"
      >
        {{
          isRegexOpen
            ? t('resultBoard.regex.hide')
            : t('resultBoard.regex.parts', { count: parts.length })
        }}
      </button>
      <template v-if="isRegexOpen">
        <div
          v-for="(part, index) in parts"
          :key="index"
          class="flex items-start gap-[var(--pxd-space-xs)] rounded-sm border border-border/60 bg-background/60 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
          data-board-stash-regex-part
        >
          <span
            v-if="parts.length > 1"
            class="shrink-0 pt-[2px] text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
            >{{ t('resultBoard.regex.part', { index: index + 1, count: parts.length }) }}</span
          >
          <code
            class="pxd-scrollbar max-h-[4.8em] min-w-0 flex-1 overflow-y-auto break-all font-mono text-[length:var(--pxd-font-micro)] leading-snug text-foreground/90 select-all"
            >{{ part }}</code
          >
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0"
            :title="t('resultBoard.regex.copy')"
            :aria-label="t('resultBoard.regex.copy')"
            data-board-stash-regex-copy
            @click="emit('copyRegex', part)"
          >
            <Copy />
          </Button>
        </div>
      </template>
      <p
        v-for="warning in warnings"
        :key="warning"
        class="m-0 flex items-start gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-amber-700 dark:text-amber-400"
        data-board-stash-regex-warning
      >
        <TriangleAlert class="mt-[1px] size-3 shrink-0" />
        <span>{{ warning }}</span>
      </p>
    </section>

    <ul class="m-0 list-none p-0">
      <ResultBoardItemRow
        v-for="entry in group.entries"
        :key="entry.id"
        :entry="entry"
        :mark="marks[entry.id]"
        :rates="rates"
        :currencies="currencies"
        :expanded="isExpanded(entry.id)"
        :card-snapshot="cardSnapshot"
        pickable
        :picked="isPicked(entry)"
        :pinned="isPinned(entry.id)"
        :travel-state="travelStates[entry.id]"
        @pick="emit('pick', entry)"
        @toggle="emit('toggle', entry.id)"
        @locate="emit('locate', entry.id)"
        @travel="emit('travel', entry.id)"
        @pin="emit('pin', entry.id)"
      />
    </ul>
  </div>
</template>
