<script setup lang="ts">
/**
 * 看板賣家清單的一位賣家：可直購件數、價格範圍、總價；展開後勾選要買的物品，顯示勾選總價
 * 與倉庫搜尋 regex。
 */
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp, Copy, EyeOff, TriangleAlert } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import type { PriceTotal } from '@/utils/result-board/board-price';
import { sortEntries } from '@/utils/result-board/board-query';
import type { BoardMark, CurrencyDisplay } from '@/utils/result-board/board-session';
import type { SellerSummary } from '@/utils/result-board/board-sellers';
import type { StashRegexResult } from '@/utils/result-board/stash-regex';
import ResultBoardItemRow from './ResultBoardItemRow.vue';
import { formatPrice, formatTotal } from './result-board-format';

const props = defineProps<{
  seller: SellerSummary;
  rates?: CurrencyRateSnapshot;
  currencies: Readonly<Record<string, CurrencyDisplay>>;
  marks: Readonly<Record<string, BoardMark>>;
  pickedEntries: readonly BoardEntry[];
  pickedTotal: PriceTotal;
  /** 展開時才計算 */
  stashRegex?: StashRegexResult;
  isPicked: (entry: BoardEntry) => boolean;
  isExpanded: (id: string) => boolean;
  cardSnapshot: (id: string) => PinnedItemSnapshot | undefined;
  expanded?: boolean;
}>();

const emit = defineEmits<{
  hide: [];
  pick: [entry: BoardEntry];
  toggleSeller: [];
  toggle: [id: string];
  locate: [id: string];
  travel: [id: string];
  pin: [id: string];
  copyRegex: [text: string];
}>();

const localOpen = ref(false);
const open = computed(() => props.expanded ?? localOpen.value);

function toggleOpen(): void {
  if (props.expanded !== undefined) emit('toggleSeller');
  else localOpen.value = !localOpen.value;
}

/** 展開後依價格由低到高（無法比較時維持官方順序） */
const orderedEntries = computed(() =>
  sortEntries(props.seller.entries, props.rates ? 'price-asc' : 'official', props.rates),
);

const range = computed(() => {
  const value = props.seller.priceRange;
  if (!value) return '';
  const min = formatPrice(value.min);
  const max = formatPrice(value.max);
  return min === max ? min : `${min} – ${max}`;
});

const regexWarnings = computed(() => {
  const regex = props.stashRegex;
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

const visited = computed(() =>
  props.seller.entries.some((entry) => props.marks[entry.id] !== undefined),
);
</script>

<template>
  <li
    class="border-0 border-b border-border last:border-b-0"
    :data-board-seller="seller.account"
    :data-board-seller-visited="visited ? '' : undefined"
  >
    <div
      class="group flex items-center gap-[var(--pxd-space-md)] px-[var(--pxd-space-md)] py-[var(--pxd-space-md)] hover:bg-muted/40"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 flex-col items-start gap-[2px] border-0 bg-transparent p-0 text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
        :aria-expanded="open"
        data-board-seller-toggle
        @click="toggleOpen"
      >
        <span class="flex w-full items-center gap-[var(--pxd-space-sm)] min-w-0">
          <span class="truncate text-[length:var(--pxd-font-body)] font-semibold leading-tight">{{
            seller.character ?? seller.account
          }}</span>
          <span
            v-if="visited"
            class="shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-primary"
            >{{ t('resultBoard.mark.visited') }}</span
          >
        </span>
        <span class="w-full truncate text-[length:var(--pxd-font-micro)] text-muted-foreground">
          {{ seller.account }}
          <template v-if="range"> · {{ range }}</template>
        </span>
      </button>
      <div class="flex shrink-0 flex-col items-end gap-[2px]">
        <span
          class="text-[length:var(--pxd-font-body)] font-bold tabular-nums leading-none"
          data-board-seller-count
          >{{ t('resultBoard.seller.instantCount', { count: seller.instantBuyoutCount }) }}</span
        >
        <span
          class="text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
          data-board-seller-total
          >{{ t('resultBoard.seller.total', { total: formatTotal(seller.total) }) }}</span
        >
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :title="t('resultBoard.action.hideSeller')"
        :aria-label="t('resultBoard.action.hideSeller')"
        data-board-seller-hide
        @click="emit('hide')"
      >
        <EyeOff />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :aria-label="open ? t('resultBoard.action.collapse') : t('resultBoard.action.expand')"
        @click="toggleOpen"
      >
        <ChevronUp v-if="open" />
        <ChevronDown v-else />
      </Button>
    </div>
    <div v-if="open" class="bg-muted/10 pb-[var(--pxd-space-sm)]">
      <p
        class="m-0 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-foreground tabular-nums"
        data-board-seller-picked
      >
        {{
          t('resultBoard.seller.picked', {
            count: pickedEntries.length,
            total: formatTotal(pickedTotal),
          })
        }}
      </p>
      <section
        v-if="stashRegex"
        class="mx-[var(--pxd-space-md)] mb-[var(--pxd-space-sm)] flex flex-col gap-[var(--pxd-space-xs)] rounded-md border border-border bg-card p-[var(--pxd-space-sm)]"
        data-board-stash-regex
      >
        <span class="text-[length:var(--pxd-font-caption)] font-semibold">{{
          t('resultBoard.regex.title')
        }}</span>
        <p
          v-if="stashRegex.parts.length === 0"
          class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
          data-board-stash-regex-empty
        >
          {{ t('resultBoard.regex.empty') }}
        </p>
        <div
          v-for="(part, index) in stashRegex.parts"
          :key="index"
          class="flex items-start gap-[var(--pxd-space-xs)]"
          data-board-stash-regex-part
        >
          <span
            v-if="stashRegex.parts.length > 1"
            class="shrink-0 pt-[2px] text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
            >{{
              t('resultBoard.regex.part', { index: index + 1, count: stashRegex.parts.length })
            }}</span
          >
          <code
            class="min-w-0 flex-1 break-all rounded-sm bg-muted/40 px-[var(--pxd-space-xs)] py-[2px] font-mono text-[length:var(--pxd-font-micro)] select-all"
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
        <p
          v-for="warning in regexWarnings"
          :key="warning"
          class="m-0 flex items-start gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-destructive"
          data-board-stash-regex-warning
        >
          <TriangleAlert class="mt-[1px] size-3 shrink-0" />
          <span>{{ warning }}</span>
        </p>
        <p class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground">
          {{ t('resultBoard.regex.hint') }}
        </p>
      </section>
      <ul class="m-0 list-none p-0">
        <ResultBoardItemRow
          v-for="entry in orderedEntries"
          :key="entry.id"
          :entry="entry"
          :mark="marks[entry.id]"
          :rates="rates"
          :currencies="currencies"
          :expanded="isExpanded(entry.id)"
          :snapshot="isExpanded(entry.id) ? cardSnapshot(entry.id) : undefined"
          pickable
          :picked="isPicked(entry)"
          @pick="emit('pick', entry)"
          @toggle="emit('toggle', entry.id)"
          @locate="emit('locate', entry.id)"
          @travel="emit('travel', entry.id)"
          @pin="emit('pin', entry.id)"
        />
      </ul>
    </div>
  </li>
</template>
