<script setup lang="ts">
/**
 * 搜尋結果看板（CONTEXT.md「Result Board」）：這次搜尋已取得的結果，以物品清單或賣家清單檢視。
 * 不改動官方結果列；載入更多透過官方按鈕（ADR-0018）。
 */
import { ref } from 'vue';
import { ArrowUpDown, Check, LayoutList, Loader2, Search, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { t, type I18nKey } from '@/utils/i18n';
import type { BoardSortMode } from '@/utils/result-board/board-query';
import SidebarPane from '../layout/SidebarPane.vue';
import SidebarEmptyState from '../layout/SidebarEmptyState.vue';
import ResultBoardItemRow from './ResultBoardItemRow.vue';
import ResultBoardSellerRow from './ResultBoardSellerRow.vue';
import { formatAmount, stopMessage } from './result-board-format';
import { useResultBoard } from './useResultBoard';

const board = useResultBoard();
const {
  state,
  loaderState,
  rates,
  isLiveMode,
  view,
  sortMode,
  sortModes,
  instantOnly,
  keyword,
  priceMinText,
  priceMaxText,
  minSellerCount,
  entries,
  listedCount,
  conversionAvailable,
  filteredEntries,
  sellers,
  priceSummary,
  canLoadMore,
} = board;

const isSortMenuOpen = ref(false);

const SORT_LABEL_KEYS: Readonly<Record<BoardSortMode, I18nKey>> = {
  official: 'resultBoard.sort.official',
  'price-asc': 'resultBoard.sort.priceAsc',
  'price-desc': 'resultBoard.sort.priceDesc',
  'indexed-desc': 'resultBoard.sort.newest',
  'seller-count-desc': 'resultBoard.sort.sellerCount',
};

function statusText(): string {
  const count = entries.value.length;
  return listedCount.value === undefined
    ? t('resultBoard.status.retrievedOnly', { count })
    : t('resultBoard.status.retrieved', { count, listed: listedCount.value });
}

function matchedText(): string {
  const summary = state.value.summary;
  if (!summary || summary.total <= (listedCount.value ?? 0)) return '';
  const total = `${formatAmount(summary.total)}${summary.inexact ? '+' : ''}`;
  return t('resultBoard.status.matched', { total });
}

function summaryText(): string {
  const summary = priceSummary.value;
  if (!summary) return '';
  return t('resultBoard.summary.price', {
    min: `${formatAmount(summary.min)} ${summary.currency}`,
    median: `${formatAmount(summary.median)} ${summary.currency}`,
  });
}

function setMinSellerCount(value: string | number): void {
  const parsed = Math.floor(Number(value));
  minSellerCount.value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
</script>

<template>
  <SidebarPane data-pane="result-board" class="result-board-pane">
    <template #fixed>
      <div class="flex flex-col gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)]">
        <div class="flex items-center gap-[var(--pxd-space-sm)] min-w-0">
          <span
            class="flex-1 truncate text-[length:var(--pxd-font-body)] text-foreground tabular-nums"
            data-board-status
            >{{ statusText() }}</span
          >
          <template v-if="loaderState.running">
            <Loader2 class="size-[var(--control-icon-sm)] animate-spin text-muted-foreground" />
            <Button variant="secondary" size="sm" data-board-stop @click="board.stopLoading">
              {{ t('resultBoard.load.stop') }}
            </Button>
          </template>
          <template v-else>
            <Button
              variant="secondary"
              size="sm"
              :disabled="!canLoadMore || !state.searchId"
              data-board-load-next
              @click="board.loadNext"
            >
              {{ t('resultBoard.load.next') }}
            </Button>
            <Button
              size="sm"
              :disabled="!canLoadMore || !state.searchId"
              data-board-load-all
              @click="board.loadAll"
            >
              {{ t('resultBoard.load.all') }}
            </Button>
          </template>
        </div>
        <p
          v-if="!loaderState.running && loaderState.lastStop"
          class="m-0 text-[length:var(--pxd-font-micro)]"
          :class="
            loaderState.lastStop === 'complete' || loaderState.lastStop === 'stopped'
              ? 'text-muted-foreground'
              : 'text-destructive'
          "
          data-board-stop-reason
        >
          {{ stopMessage(loaderState.lastStop) }}
        </p>
        <p
          v-if="matchedText()"
          class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
        >
          {{ matchedText() }}
        </p>
        <p
          v-if="summaryText()"
          class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
          data-board-price-summary
        >
          {{ summaryText() }}
        </p>
      </div>
      <Separator class="mb-[var(--pxd-space-md)]" />

      <div class="flex flex-col gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)]">
        <div class="flex items-center gap-[var(--pxd-space-sm)]">
          <div class="flex rounded-md border border-border p-[2px]" role="tablist">
            <Button
              v-for="option in ['items', 'sellers'] as const"
              :key="option"
              :variant="view === option ? 'default' : 'ghost'"
              size="sm"
              role="tab"
              :aria-selected="view === option"
              :data-board-view="option"
              @click="view = option"
            >
              {{ option === 'items' ? t('resultBoard.view.items') : t('resultBoard.view.sellers') }}
            </Button>
          </div>
          <span class="flex-1"></span>
          <DropdownMenu v-if="view === 'items'" v-model:open="isSortMenuOpen">
            <DropdownMenuTrigger as-child>
              <Button
                :variant="sortMode !== 'official' ? 'default' : 'secondary'"
                size="icon-sm"
                :title="t('resultBoard.sort.title')"
                :aria-label="t('resultBoard.sort.title')"
                data-board-sort
              >
                <ArrowUpDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent v-if="isSortMenuOpen" align="end">
              <DropdownMenuItem
                v-for="mode in sortModes"
                :key="mode"
                :data-board-sort-mode="mode"
                class="justify-between gap-[var(--pxd-space-md)]"
                @click="sortMode = mode"
              >
                <span>{{ t(SORT_LABEL_KEYS[mode]) }}</span>
                <Check
                  v-if="sortMode === mode"
                  class="size-[var(--control-icon-sm)] text-primary"
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="relative flex items-center">
          <Search
            class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
          />
          <Input
            v-model="keyword"
            size="sm"
            :placeholder="t('resultBoard.filter.keyword')"
            class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))]"
            data-board-keyword
          />
          <Button
            v-if="keyword"
            variant="ghost"
            size="icon-sm"
            class="absolute right-[var(--pxd-space-xs)]"
            :aria-label="t('bookmark.search.clearTooltip')"
            @click="keyword = ''"
          >
            <X />
          </Button>
        </div>

        <div v-if="view === 'items'" class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]">
          <label
            class="flex items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] cursor-pointer select-none"
          >
            <Checkbox v-model="instantOnly" data-board-instant-only />
            {{ t('resultBoard.filter.instantOnly') }}
          </label>
          <template v-if="conversionAvailable">
            <Input
              v-model="priceMinText"
              size="sm"
              inputmode="decimal"
              class="w-[5.5em]"
              :placeholder="t('resultBoard.filter.priceMin')"
              data-board-price-min
            />
            <span class="text-muted-foreground">–</span>
            <Input
              v-model="priceMaxText"
              size="sm"
              inputmode="decimal"
              class="w-[5.5em]"
              :placeholder="t('resultBoard.filter.priceMax')"
              data-board-price-max
            />
            <span class="text-[length:var(--pxd-font-micro)] text-muted-foreground">{{
              rates?.primary
            }}</span>
          </template>
        </div>
        <label
          v-else
          class="flex items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)]"
        >
          {{ t('resultBoard.filter.minCount') }}
          <Input
            :model-value="String(minSellerCount)"
            size="sm"
            type="number"
            min="0"
            class="w-[4em]"
            data-board-min-count
            @update:model-value="setMinSellerCount"
          />
          {{ t('resultBoard.filter.minCountUnit') }}
        </label>

        <p
          v-if="!conversionAvailable && entries.length > 0"
          class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
          data-board-no-conversion
        >
          {{ t('resultBoard.conversionUnavailable') }}
        </p>
        <Button
          v-if="state.hiddenAccounts.size > 0"
          variant="link"
          size="sm"
          class="self-start px-0"
          data-board-show-hidden
          @click="board.showAllSellers"
        >
          {{ t('resultBoard.hidden.restore', { count: state.hiddenAccounts.size }) }}
        </Button>
      </div>
    </template>

    <template #scroll>
      <SidebarEmptyState
        v-if="entries.length === 0"
        :message="t('resultBoard.empty')"
        :hint="isLiveMode ? t('resultBoard.liveModeHint') : undefined"
        data-board-empty
      >
        <template #icon><LayoutList /></template>
      </SidebarEmptyState>

      <template v-else-if="view === 'items'">
        <p
          v-if="filteredEntries.length === 0"
          class="m-0 py-[var(--pxd-space-lg)] text-center text-muted-foreground"
          data-board-no-match
        >
          {{ t('resultBoard.noMatch') }}
        </p>
        <ul
          v-else
          class="m-0 list-none overflow-hidden rounded-md border border-border bg-card p-0"
          data-board-items
        >
          <ResultBoardItemRow
            v-for="entry in filteredEntries"
            :key="entry.id"
            :entry="entry"
            :mark="state.marks[entry.id]"
            :rates="rates"
            :currencies="state.currencies"
            :expanded="board.isExpanded(entry.id)"
            :snapshot="board.isExpanded(entry.id) ? board.cardSnapshot(entry.id) : undefined"
            @toggle="board.toggleExpanded(entry.id)"
            @locate="board.locate(entry.id)"
            @travel="board.travel(entry.id)"
            @pin="board.pin(entry.id)"
          />
        </ul>
      </template>

      <template v-else>
        <p
          v-if="sellers.length === 0"
          class="m-0 py-[var(--pxd-space-lg)] text-center text-muted-foreground"
          data-board-no-seller-match
        >
          {{ t('resultBoard.noSellerMatch') }}
        </p>
        <ul
          v-else
          class="m-0 list-none overflow-hidden rounded-md border border-border bg-card p-0"
          data-board-sellers
        >
          <ResultBoardSellerRow
            v-for="seller in sellers"
            :key="seller.account"
            :seller="seller"
            :rates="rates"
            :currencies="state.currencies"
            :marks="state.marks"
            :picked-entries="board.pickedOf(seller)"
            :picked-total="board.pickedTotal(seller)"
            :is-picked="board.isPicked"
            :is-expanded="board.isExpanded"
            :card-snapshot="board.cardSnapshot"
            @hide="board.hideSeller(seller.account)"
            @pick="board.togglePicked"
            @toggle="board.toggleExpanded"
            @locate="board.locate"
            @travel="board.travel"
            @pin="board.pin"
          />
        </ul>
      </template>
    </template>
  </SidebarPane>
</template>
