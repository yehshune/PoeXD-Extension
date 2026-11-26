<script setup lang="ts">
/**
 * 看板賣家清單的一位賣家：以獨立卡片呈現，提供一鍵前往藏身處；展開後依倉庫分頁分區顯示，
 * 支援分頁整頁勾選，並為每個倉庫分頁各自產生精簡的倉庫搜尋 regex（見 `ResultBoardStashGroup`）。
 * 展開區只放標題列沒有的資訊：部分勾選時的勾選總價，以及各倉庫分頁。
 */
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp, EyeOff, Home, Loader2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import {
  projectSellerStashGroups,
  type PriceTotal,
  type SellerSummary,
} from '@/utils/result-board/board-projection';
import type { BoardMark, CurrencyDisplay } from '@/utils/result-board/board-session';
import type { StashRegexResult } from '@/utils/result-board/stash-regex';
import BoardCurrencyAmount from './BoardCurrencyAmount.vue';
import BoardTotalAmount from './BoardTotalAmount.vue';
import ResultBoardStashGroup from './ResultBoardStashGroup.vue';
import type { StashSection } from './stash-section';
import { formatAge, formatAmount } from './result-board-format';

const props = defineProps<{
  seller: SellerSummary;
  rates?: CurrencyRateSnapshot;
  currencies: Readonly<Record<string, CurrencyDisplay>>;
  marks: Readonly<Record<string, BoardMark>>;
  pickedEntries: readonly BoardEntry[];
  pickedTotal: PriceTotal;
  stashRegexFor: (entries: readonly BoardEntry[]) => StashRegexResult;
  isPicked: (entry: BoardEntry) => boolean;
  isPinned: (id: string) => boolean;
  travelStates: Readonly<Record<string, 'refreshing' | 'traveling'>>;
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

/** 展開後按需依價格由低到高（無法比較時維持官方順序）並依倉庫分頁分區，已售出沉底 */
const stashSections = computed<StashSection[]>(() => {
  if (!open.value) return [];
  return projectSellerStashGroups(props.seller, props.rates, soldIds.value).map((group) => {
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

const distinctAccount = computed(() =>
  props.seller.character && props.seller.character !== props.seller.account
    ? props.seller.account
    : '',
);

/** 最近一筆仍可購買的刊登時間：同一位賣家的物品通常一起上架，只在賣家層級顯示一次；已售出的不算 */
const listedAge = computed(() => {
  const times = props.seller.entries
    .filter((entry) => !soldIds.value.has(entry.id))
    .map((entry) => entry.indexedAt)
    .filter((value): value is number => value !== undefined);
  return times.length > 0 ? formatAge(Math.max(...times)) : '';
});

const extraMeta = computed(() =>
  [
    props.seller.stashTabCount > 1
      ? t('resultBoard.seller.stashTabs', { count: props.seller.stashTabCount })
      : '',
    props.seller.soldCount > 0 && !props.seller.allSold
      ? t('resultBoard.seller.soldCount', { count: props.seller.soldCount })
      : '',
    listedAge.value ? t('resultBoard.seller.listedAt', { age: listedAge.value }) : '',
  ].filter(Boolean),
);

const hasSubtitle = computed(
  () =>
    Boolean(distinctAccount.value) ||
    props.seller.priceRange !== undefined ||
    extraMeta.value.length > 0,
);

const isSameRangeValue = computed(() => {
  const value = props.seller.priceRange;
  return (
    value !== undefined &&
    value.min.currency === value.max.currency &&
    formatAmount(value.min.amount) === formatAmount(value.max.amount)
  );
});

const totalPrefix = computed(() => t('resultBoard.seller.total', { total: '' }).trim());
const pickedPrefix = computed(() =>
  t('resultBoard.seller.picked', { count: props.pickedEntries.length, total: '' }).trim(),
);
/** 全部可直購的都勾選時，勾選總價等於標題列的總價，不必再顯示一次 */
const showPickedSummary = computed(
  () =>
    props.seller.instantBuyoutCount > 0 &&
    props.pickedEntries.length !== props.seller.instantBuyoutCount,
);
const sellerBusy = computed(() =>
  props.seller.entries.some((entry) => Boolean(props.travelStates[entry.id])),
);

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
    class="pxd-board-seller-row overflow-hidden rounded-md border bg-card"
    :class="[
      open ? 'border-foreground/25 shadow-sm' : 'border-border hover:border-border/80',
      allSold ? 'opacity-60' : '',
    ]"
    :data-board-seller="seller.account"
    :data-board-seller-visited="visited ? '' : undefined"
    :data-board-seller-sold="allSold ? '' : undefined"
  >
    <div
      class="group/header relative flex items-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] py-[var(--pxd-space-md)] transition-colors hover:bg-muted/40"
      :class="open ? 'bg-muted/20' : ''"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 flex-col items-start gap-[var(--pxd-space-xs)] border-0 bg-transparent px-[var(--pxd-space-xs)] py-0 text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
        :aria-expanded="open"
        data-board-seller-toggle
        @click="toggleOpen"
      >
        <span class="flex w-full items-center gap-[var(--pxd-space-xs)] min-w-0">
          <span
            class="truncate text-[length:var(--pxd-font-section-title)] font-semibold leading-snug"
            >{{ seller.character ?? seller.account }}</span
          >
          <span
            v-if="allSold"
            class="shrink-0 rounded-sm border border-destructive/30 bg-destructive/15 px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-caption)] leading-tight text-destructive"
            data-board-seller-mark
            >{{ t('common.sold') }}</span
          >
          <span
            v-else-if="visited"
            class="shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-caption)] leading-tight text-primary"
            data-board-seller-mark
            >{{ t('resultBoard.mark.visited') }}</span
          >
        </span>
        <span
          v-if="hasSubtitle"
          class="flex w-full min-w-0 items-center gap-[4px] truncate text-[length:var(--pxd-font-caption)] text-muted-foreground"
        >
          <span v-if="distinctAccount" class="truncate">{{ distinctAccount }}</span>
          <span v-if="distinctAccount && seller.priceRange" aria-hidden="true">·</span>
          <span
            v-if="seller.priceRange"
            class="inline-flex shrink-0 items-center gap-[3px] tabular-nums"
            data-board-seller-price-range
          >
            <span>{{ t('resultBoard.seller.unitPrice') }}</span>
            <BoardCurrencyAmount
              v-if="isSameRangeValue"
              :amount="seller.priceRange.min.amount"
              :currency="seller.priceRange.min.currency"
              :currencies="currencies"
            />
            <template v-else-if="seller.priceRange.min.currency === seller.priceRange.max.currency">
              <span>{{ formatAmount(seller.priceRange.min.amount) }} –</span>
              <BoardCurrencyAmount
                :amount="seller.priceRange.max.amount"
                :currency="seller.priceRange.max.currency"
                :currencies="currencies"
              />
            </template>
            <template v-else>
              <BoardCurrencyAmount
                :amount="seller.priceRange.min.amount"
                :currency="seller.priceRange.min.currency"
                :currencies="currencies"
              />
              <span>–</span>
              <BoardCurrencyAmount
                :amount="seller.priceRange.max.amount"
                :currency="seller.priceRange.max.currency"
                :currencies="currencies"
              />
            </template>
          </span>
          <template v-for="part in extraMeta" :key="part">
            <span v-if="distinctAccount || seller.priceRange" aria-hidden="true">·</span>
            <span class="shrink-0">{{ part }}</span>
          </template>
        </span>
      </button>
      <div
        class="flex shrink-0 flex-col items-end gap-[var(--pxd-space-xs)] transition-opacity duration-150 group-hover/header:opacity-0"
      >
        <span
          class="rounded-sm bg-muted/60 px-[var(--pxd-space-sm)] py-[2px] text-[length:var(--pxd-font-body)] font-bold tabular-nums leading-tight"
          data-board-seller-count
          >{{ t('resultBoard.seller.instantCount', { count: seller.instantBuyoutCount }) }}</span
        >
        <span
          class="inline-flex items-center gap-[3px] text-[length:var(--pxd-font-caption)] font-medium text-foreground/85 tabular-nums"
          data-board-seller-total
        >
          <span>{{ totalPrefix }}</span>
          <BoardTotalAmount :total="seller.total" :currencies="currencies" />
        </span>
      </div>
      <div
        class="pxd-hover-actions-overlay absolute inset-y-0 z-(--pxd-z-raised) flex items-center gap-[var(--pxd-space-xs)] pr-[var(--pxd-space-xs)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/header:opacity-100 group-hover/header:pointer-events-auto"
        :class="
          open
            ? 'right-[calc(var(--pxd-space-md)+var(--control-height-sm)*2+var(--pxd-space-sm))]'
            : 'right-[calc(var(--pxd-space-md)+var(--control-height-sm))]'
        "
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
          v-if="!open"
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          :disabled="seller.instantBuyoutCount === 0 || sellerBusy"
          :title="t('common.travelToHideout')"
          :aria-label="t('common.travelToHideout')"
          data-board-seller-travel
          @click="emit('travelSeller')"
        >
          <Loader2 v-if="sellerBusy" class="animate-spin" />
          <Home v-else />
        </Button>
      </div>
      <!-- 展開時前往藏身處固定顯示在標題列（取代原本展開區的大按鈕） -->
      <Button
        v-if="open"
        variant="secondary"
        size="icon-sm"
        class="relative z-(--pxd-z-raised) shrink-0"
        :disabled="seller.instantBuyoutCount === 0 || sellerBusy"
        :title="t('common.travelToHideout')"
        :aria-label="t('common.travelToHideout')"
        data-board-seller-travel
        @click="emit('travelSeller')"
      >
        <Loader2 v-if="sellerBusy" class="animate-spin" />
        <Home v-else />
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
    <div v-if="open" class="flex flex-col border-0 border-t border-border">
      <p
        v-if="showPickedSummary"
        class="m-0 inline-flex flex-wrap items-center gap-[4px] px-[var(--pxd-space-md)] pt-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] font-medium text-primary tabular-nums"
        data-board-seller-picked
      >
        <span>{{ pickedPrefix }}</span>
        <BoardTotalAmount :total="pickedTotal" :currencies="currencies" />
      </p>
      <ResultBoardStashGroup
        v-for="group in stashSections"
        :key="group.key"
        :group="group"
        :rates="rates"
        :currencies="currencies"
        :marks="marks"
        :is-picked="isPicked"
        :is-pinned="isPinned"
        :travel-states="travelStates"
        :is-expanded="isExpanded"
        :card-snapshot="cardSnapshot"
        @pick="emit('pick', $event)"
        @pick-group="emit('pickGroup', $event)"
        @toggle="emit('toggle', $event)"
        @locate="emit('locate', $event)"
        @travel="emit('travel', $event)"
        @pin="emit('pin', $event)"
        @copy-regex="emit('copyRegex', $event)"
      />
    </div>
  </li>
</template>

<style scoped>
.pxd-board-seller-row {
  content-visibility: auto;
  contain-intrinsic-block-size: auto 64px;
}
</style>
