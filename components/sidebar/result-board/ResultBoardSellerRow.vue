<script setup lang="ts">
/**
 * 看板賣家清單的一位賣家：以獨立卡片呈現，提供一鍵前往藏身處；展開後依倉庫分頁分區顯示，
 * 支援分頁整頁勾選，並為每個倉庫分頁各自產生精簡的倉庫搜尋 regex。
 */
import { computed, ref } from 'vue';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  EyeOff,
  Home,
  TriangleAlert,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  travelSeller: [];
  pick: [entry: BoardEntry];
  pickGroup: [entries: readonly BoardEntry[]];
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

const soldIds = computed(() => {
  const ids = new Set<string>();
  for (const entry of props.seller.entries) {
    if (props.marks[entry.id] === 'sold') ids.add(entry.id);
  }
  return ids;
});

/** 展開後依價格由低到高（無法比較時維持官方順序），再依倉庫分頁分區且把已售出沉底 */
const orderedEntries = computed(() =>
  sortEntries(props.seller.entries, props.rates ? 'price-asc' : 'official', props.rates),
);

const stashSections = computed(() => {
  if (!open.value) return [];
  return groupSellerEntriesByStash(orderedEntries.value, soldIds.value).map((group) => {
    const buyable = group.entries.filter(
      (entry) => entry.instantBuyout && !soldIds.value.has(entry.id),
    );
    const pickedCount = buyable.filter((entry) => props.isPicked(entry)).length;
    const pickState: boolean | 'indeterminate' =
      buyable.length === 0 || pickedCount === 0
        ? false
        : pickedCount === buyable.length
          ? true
          : 'indeterminate';
    return {
      ...group,
      pickState,
      regex: group.instantBuyoutCount > 0 ? props.stashRegexFor(group.entries) : undefined,
    };
  });
});

const range = computed(() => {
  const value = props.seller.priceRange;
  if (!value) return '';
  const min = formatPrice(value.min);
  const max = formatPrice(value.max);
  return min === max ? min : `${min} – ${max}`;
});

const subtitle = computed(() => {
  const hasDistinctCharacter =
    Boolean(props.seller.character) && props.seller.character !== props.seller.account;
  const parts = [
    hasDistinctCharacter ? props.seller.account : '',
    range.value,
    props.seller.stashTabCount > 1
      ? t('resultBoard.seller.stashTabs', { count: props.seller.stashTabCount })
      : '',
    props.seller.soldCount > 0 && !props.seller.allSold
      ? t('resultBoard.seller.soldCount', { count: props.seller.soldCount })
      : '',
  ];
  return parts.filter(Boolean).join(' · ');
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
    props.seller.allSold ||
    (props.seller.entries.length > 0 &&
      props.seller.entries.every((entry) => props.marks[entry.id] === 'sold')),
);
</script>

<template>
  <li
    class="overflow-hidden rounded-md border bg-card transition-colors"
    :class="[
      open ? 'border-primary/40 shadow-sm' : 'border-border hover:border-border/80',
      allSold ? 'opacity-60' : '',
    ]"
    :data-board-seller="seller.account"
    :data-board-seller-visited="visited ? '' : undefined"
    :data-board-seller-sold="allSold ? '' : undefined"
  >
    <div
      class="group/header relative flex items-center gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
      :class="open ? 'border-b border-border bg-muted/20' : ''"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 flex-col items-start gap-[2px] border-0 bg-transparent px-[var(--pxd-space-xs)] py-0 text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
        :aria-expanded="open"
        data-board-seller-toggle
        @click="toggleOpen"
      >
        <span class="flex w-full items-center gap-[var(--pxd-space-xs)] min-w-0">
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
        <span
          v-if="subtitle"
          class="w-full truncate text-[length:var(--pxd-font-micro)] text-muted-foreground"
        >
          {{ subtitle }}
        </span>
      </button>
      <div
        class="flex shrink-0 flex-col items-end gap-[2px] transition-opacity duration-150 group-hover/header:opacity-0 group-focus-within/header:opacity-0"
      >
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
      <div
        class="pxd-hover-actions-overlay absolute inset-y-0 right-[calc(var(--pxd-space-sm)+var(--control-height-sm))] z-(--pxd-z-raised) flex items-center gap-[var(--pxd-space-xs)] pr-[var(--pxd-space-xs)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/header:opacity-100 group-hover/header:pointer-events-auto group-focus-within/header:opacity-100 group-focus-within/header:pointer-events-auto"
      >
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
          :disabled="seller.instantBuyoutCount === 0"
          :title="t('resultBoard.action.travel')"
          :aria-label="t('resultBoard.action.travel')"
          data-board-seller-travel
          @click="emit('travelSeller')"
        >
          <Home />
        </Button>
      </div>
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
      class="flex flex-col gap-[var(--pxd-space-sm)] bg-muted/15 px-[var(--pxd-space-xs)] py-[var(--pxd-space-sm)]"
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
        class="overflow-hidden rounded-md border border-border/80 bg-card"
        :class="group.allSold ? 'opacity-65' : ''"
        data-board-stash-group
        :data-board-stash-name="group.stashName ?? ''"
      >
        <div
          class="flex items-center justify-between gap-[var(--pxd-space-xs)] border-b border-border/60 bg-muted/35 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
        >
          <div class="flex min-w-0 items-center gap-[var(--pxd-space-xs)]">
            <Checkbox
              v-if="group.instantBuyoutCount > 0"
              :model-value="group.pickState"
              :aria-label="t('resultBoard.stash.toggleAll')"
              data-board-stash-pick
              @update:model-value="emit('pickGroup', group.entries)"
            />
            <Archive class="size-3.5 shrink-0 text-muted-foreground" />
            <span
              class="truncate text-[length:var(--pxd-font-caption)] font-semibold text-foreground"
            >
              {{
                group.stashName
                  ? t('resultBoard.stash.tab', { name: group.stashName })
                  : t('resultBoard.stash.unknown')
              }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-[var(--pxd-space-xs)]">
            <span class="text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums">
              ({{ group.entries.length }})
            </span>
            <span
              v-if="group.regex"
              class="inline-flex text-muted-foreground/80"
              :title="t('resultBoard.regex.hint')"
              :aria-label="t('resultBoard.regex.hint')"
            >
              <CircleHelp class="size-3" />
            </span>
          </div>
        </div>
        <section
          v-if="group.regex"
          class="flex flex-col gap-[var(--pxd-space-xs)] border-b border-border/60 bg-card/70 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
          data-board-stash-regex
        >
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
