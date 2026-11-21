<script setup lang="ts">
/**
 * 看板賣家清單的一位賣家：以獨立卡片呈現，展開後依倉庫分頁分區顯示可直購／私訊物品，
 * 並為每個倉庫分頁各自產生勾選總價與倉庫搜尋 regex。
 */
import { computed, ref } from 'vue';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  EyeOff,
  TriangleAlert,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import type { PriceTotal } from '@/utils/result-board/board-price';
import { sortEntries } from '@/utils/result-board/board-query';
import type { BoardMark, CurrencyDisplay } from '@/utils/result-board/board-session';
import { groupSellerEntriesByStash, type SellerSummary } from '@/utils/result-board/board-sellers';
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
  stashRegexFor: (entries: readonly BoardEntry[]) => StashRegexResult;
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

/** 展開後依價格由低到高（無法比較時維持官方順序），再依倉庫分頁分區 */
const orderedEntries = computed(() =>
  sortEntries(props.seller.entries, props.rates ? 'price-asc' : 'official', props.rates),
);

const stashSections = computed(() => {
  if (!open.value) return [];
  return groupSellerEntriesByStash(orderedEntries.value).map((group) => ({
    ...group,
    regex: group.instantBuyoutCount > 0 ? props.stashRegexFor(group.entries) : undefined,
  }));
});

const range = computed(() => {
  const value = props.seller.priceRange;
  if (!value) return '';
  const min = formatPrice(value.min);
  const max = formatPrice(value.max);
  return min === max ? min : `${min} – ${max}`;
});

function warningsOf(regex: StashRegexResult | undefined): string[] {
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
}

const visited = computed(() =>
  props.seller.entries.some((entry) => props.marks[entry.id] === 'visited'),
);

const allSold = computed(
  () =>
    props.seller.entries.length > 0 &&
    props.seller.entries.every((entry) => props.marks[entry.id] === 'sold'),
);
</script>

<template>
  <li
    class="overflow-hidden rounded-md border bg-card transition-colors"
    :class="open ? 'border-primary/40 shadow-sm' : 'border-border hover:border-border/80'"
    :data-board-seller="seller.account"
    :data-board-seller-visited="visited ? '' : undefined"
  >
    <div
      class="group flex items-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] transition-colors"
      :class="open ? 'border-b border-border bg-muted/20' : 'hover:bg-muted/40'"
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
            v-if="allSold"
            class="shrink-0 rounded-sm border border-destructive/30 bg-destructive/15 px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-destructive"
            data-board-seller-mark
            >{{ t('resultBoard.mark.sold') }}</span
          >
          <span
            v-else-if="visited"
            class="shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-primary"
            data-board-seller-mark
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
          class="rounded-sm bg-muted/60 px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-caption)] font-bold tabular-nums leading-tight"
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
        class="shrink-0 text-muted-foreground hover:text-foreground"
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
    <div
      v-if="open"
      class="flex flex-col gap-[var(--pxd-space-sm)] bg-muted/15 p-[var(--pxd-space-sm)]"
    >
      <p
        class="m-0 px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-medium text-foreground tabular-nums"
        data-board-seller-picked
      >
        {{
          t('resultBoard.seller.picked', {
            count: pickedEntries.length,
            total: formatTotal(pickedTotal),
          })
        }}
      </p>
      <div
        v-for="group in stashSections"
        :key="group.key"
        class="overflow-hidden rounded-md border border-border/80 bg-background/70"
        data-board-stash-group
        :data-board-stash-name="group.stashName ?? ''"
      >
        <div
          class="flex items-center justify-between gap-[var(--pxd-space-sm)] border-b border-border/60 bg-muted/35 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
        >
          <span
            class="flex min-w-0 items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-foreground"
          >
            <Archive class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{{
              group.stashName
                ? t('resultBoard.stash.tab', { name: group.stashName })
                : t('resultBoard.stash.unknown')
            }}</span>
          </span>
          <span
            class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
          >
            ({{ group.entries.length }})
          </span>
        </div>
        <section
          v-if="group.regex"
          class="flex flex-col gap-[var(--pxd-space-xs)] border-b border-border/60 bg-card/70 p-[var(--pxd-space-sm)]"
          data-board-stash-regex
        >
          <div class="flex items-center gap-[var(--pxd-space-xs)]">
            <span class="text-[length:var(--pxd-font-micro)] font-semibold text-muted-foreground">{{
              t('resultBoard.regex.title')
            }}</span>
            <span
              class="inline-flex text-muted-foreground/80"
              :title="t('resultBoard.regex.hint')"
              :aria-label="t('resultBoard.regex.hint')"
            >
              <CircleHelp class="size-3" />
            </span>
          </div>
          <p
            v-if="group.regex.parts.length === 0"
            class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
            data-board-stash-regex-empty
          >
            {{ t('resultBoard.regex.empty') }}
          </p>
          <div
            v-for="(part, index) in group.regex.parts"
            :key="index"
            class="flex items-start gap-[var(--pxd-space-xs)]"
            data-board-stash-regex-part
          >
            <span
              v-if="group.regex.parts.length > 1"
              class="shrink-0 pt-[2px] text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
              >{{
                t('resultBoard.regex.part', { index: index + 1, count: group.regex.parts.length })
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
            v-for="warning in warningsOf(group.regex)"
            :key="warning"
            class="m-0 flex items-start gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-destructive"
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
    </div>
  </li>
</template>
