<script setup lang="ts">
/**
 * 搜尋結果看板（CONTEXT.md「Result Board」）：這次搜尋已取得的結果，以物品清單或賣家清單檢視。
 * 不改動官方結果列；載入更多透過官方按鈕（ADR-0018）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  ArrowUpDown,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  LayoutList,
  Loader2,
  Search,
  X,
} from '@lucide/vue';
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
import { requestResultTranslation } from '@/utils/market-result-translation-request';
import type { BoardSortMode } from '@/utils/result-board/board-query';
import { createVersionedStorageKeys } from '@/utils/storage-contracts';
import { getPoeVersion } from '@/utils/trade-context';
import SidebarPane from '../layout/SidebarPane.vue';
import SidebarEmptyState from '../layout/SidebarEmptyState.vue';
import ResultBoardItemRow from './ResultBoardItemRow.vue';
import ResultBoardSellerRow from './ResultBoardSellerRow.vue';
import { currencyDisplayOf, formatAmount, stopMessage } from './result-board-format';
import { useResultBoard, type BoardView } from './useResultBoard';

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
  hasMixedInstantBuyout,
  listedCount,
  conversionAvailable,
  filteredEntries,
  sellers,
  priceSummary,
  hasAnyExpanded,
  canToggleExpandAll,
  canLoadMore,
} = board;

const primaryCurrency = computed(() =>
  currencyDisplayOf(rates.value?.primary, state.value.currencies),
);

const isSortMenuOpen = ref(false);
const isSearchVisible = ref(false);
const searchInputRef = ref<InstanceType<typeof Input> | null>(null);
const itemsListRef = ref<HTMLElement | null>(null);
const sellersListRef = ref<HTMLElement | null>(null);
const storageKeys = createVersionedStorageKeys(getPoeVersion());
const searchStorageKey = storageKeys.resultBoardSearchVisible;
const viewStorageKey = storageKeys.resultBoardView;
let searchUserToggled = false;
let viewUserToggled = false;

/** 儲存的值不可信：只接受已知的檢視 */
const isBoardView = (value: unknown): value is BoardView =>
  value === 'items' || value === 'sellers';

onMounted(() => {
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storage?.get) return;
  void storage
    .get([searchStorageKey, viewStorageKey])
    .then((data: Record<string, unknown>) => {
      if (!searchUserToggled) isSearchVisible.value = data?.[searchStorageKey] === true;
      const savedView = data?.[viewStorageKey];
      if (!viewUserToggled && isBoardView(savedView)) view.value = savedView;
    })
    .catch(() => {});
});

/** 切換物品／賣家清單，並記住選擇（依遊戲版本分開保存） */
function selectView(next: BoardView): void {
  viewUserToggled = true;
  if (view.value === next) return;
  view.value = next;
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storage?.set) return;
  void storage.set({ [viewStorageKey]: next }).catch(() => {});
}

watch(itemsListRef, (list) => {
  if (list) requestResultTranslation(list);
});
watch(sellersListRef, (list) => {
  if (list) requestResultTranslation(list);
});

function persistSearchVisible(visible: boolean): void {
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storage?.set) return;
  void storage.set({ [searchStorageKey]: visible }).catch(() => {});
}

async function toggleSearch(): Promise<void> {
  searchUserToggled = true;
  if (isSearchVisible.value) {
    closeSearch();
    return;
  }
  isSearchVisible.value = true;
  persistSearchVisible(true);
  await nextTick();
  (searchInputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
}

function closeSearch(): void {
  searchUserToggled = true;
  isSearchVisible.value = false;
  keyword.value = '';
  persistSearchVisible(false);
}

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
      <div
        v-if="entries.length > 0 || state.searchId || loaderState.running"
        class="flex flex-col gap-[var(--pxd-space-xs)] pb-[var(--pxd-space-sm)]"
      >
        <div
          class="flex min-h-[var(--control-height-sm)] items-center gap-[var(--pxd-space-sm)] min-w-0"
        >
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
          <template v-else-if="canLoadMore && state.searchId">
            <Button variant="secondary" size="sm" data-board-load-next @click="board.loadNext">
              {{ t('resultBoard.load.next') }}
            </Button>
            <Button size="sm" data-board-load-all @click="board.loadAll">
              {{ t('resultBoard.load.all') }}
            </Button>
          </template>
          <span
            v-else-if="
              entries.length > 0 && (!loaderState.lastStop || loaderState.lastStop === 'complete')
            "
            class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
            data-board-stop-reason
          >
            {{ stopMessage('complete') }}
          </span>
        </div>
        <div
          v-if="
            (!loaderState.running && loaderState.lastStop && loaderState.lastStop !== 'complete') ||
            matchedText() ||
            summaryText()
          "
          class="flex flex-col gap-[2px]"
        >
          <p
            v-if="
              !loaderState.running && loaderState.lastStop && loaderState.lastStop !== 'complete'
            "
            class="m-0 text-[length:var(--pxd-font-micro)]"
            :class="
              loaderState.lastStop === 'stopped' ? 'text-muted-foreground' : 'text-destructive'
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
      </div>
      <Separator
        v-if="entries.length > 0 || state.searchId || loaderState.running"
        class="mb-[var(--pxd-space-sm)]"
      />

      <div class="flex flex-col gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)]">
        <div class="flex items-center gap-[var(--pxd-space-sm)]">
          <div
            class="flex h-[var(--control-height-sm)] items-center rounded-md border border-border p-[2px]"
            role="tablist"
          >
            <Button
              v-for="option in ['items', 'sellers'] as const"
              :key="option"
              :variant="view === option ? 'default' : 'ghost'"
              size="sm"
              class="h-full px-[var(--pxd-space-sm)]"
              role="tab"
              :aria-selected="view === option"
              :data-board-view="option"
              @click="selectView(option)"
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
          <Button
            :variant="isSearchVisible ? 'default' : 'secondary'"
            size="icon-sm"
            class="shrink-0"
            data-board-search-toggle
            :aria-expanded="isSearchVisible"
            :title="
              isSearchVisible ? t('bookmark.search.closeTooltip') : t('resultBoard.filter.keyword')
            "
            :aria-label="
              isSearchVisible ? t('bookmark.search.closeTooltip') : t('resultBoard.filter.keyword')
            "
            @click="toggleSearch"
          >
            <Search />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            class="shrink-0"
            data-board-expand-toggle
            :disabled="!canToggleExpandAll"
            :aria-pressed="hasAnyExpanded"
            :title="
              hasAnyExpanded ? t('bookmark.action.collapseAll') : t('bookmark.action.expandAll')
            "
            :aria-label="
              hasAnyExpanded ? t('bookmark.action.collapseAll') : t('bookmark.action.expandAll')
            "
            @click="board.toggleExpandAll"
          >
            <ChevronsDownUp v-if="hasAnyExpanded" />
            <ChevronsUpDown v-else />
          </Button>
        </div>

        <div v-if="isSearchVisible" class="relative flex items-center">
          <Search
            class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
          />
          <Input
            ref="searchInputRef"
            v-model="keyword"
            size="sm"
            :placeholder="t('resultBoard.filter.keyword')"
            class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))]"
            data-board-keyword
            @keydown.esc.stop.prevent="closeSearch"
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

        <div
          v-if="view === 'items' && (hasMixedInstantBuyout || conversionAvailable)"
          class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]"
        >
          <label
            v-if="hasMixedInstantBuyout"
            class="flex items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] cursor-pointer select-none"
          >
            <Checkbox v-model="instantOnly" data-board-instant-only />
            {{ t('resultBoard.filter.instantOnly') }}
          </label>
          <div
            v-if="conversionAvailable"
            class="inline-flex items-center gap-[var(--pxd-space-xs)]"
          >
            <Input
              v-model="priceMinText"
              size="sm"
              inputmode="decimal"
              class="w-[5.2em] tabular-nums"
              :placeholder="t('resultBoard.filter.priceMin')"
              data-board-price-min
            />
            <span class="text-muted-foreground">–</span>
            <Input
              v-model="priceMaxText"
              size="sm"
              inputmode="decimal"
              class="w-[5.2em] tabular-nums"
              :placeholder="t('resultBoard.filter.priceMax')"
              data-board-price-max
            />
            <img
              v-if="primaryCurrency?.icon"
              :src="primaryCurrency.icon"
              :alt="rates?.primary"
              :title="primaryCurrency.name ?? rates?.primary"
              class="size-[var(--control-icon-default)] shrink-0 object-contain"
              referrerpolicy="no-referrer"
              draggable="false"
            />
            <span v-else class="text-[length:var(--pxd-font-micro)] text-muted-foreground">{{
              rates?.primary
            }}</span>
            <Button
              v-if="priceMinText || priceMaxText"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('bookmark.search.clearTooltip')"
              :title="t('bookmark.search.clearTooltip')"
              data-board-price-clear
              @click="
                priceMinText = '';
                priceMaxText = '';
              "
            >
              <X />
            </Button>
          </div>
        </div>
        <div
          v-else-if="view === 'sellers'"
          class="flex flex-wrap items-center justify-between gap-[var(--pxd-space-sm)]"
        >
          <label
            class="flex items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)]"
          >
            {{ t('resultBoard.filter.minCount') }}
            <Input
              :model-value="String(minSellerCount)"
              size="sm"
              type="number"
              min="0"
              class="w-[4em] tabular-nums"
              data-board-min-count
              @update:model-value="setMinSellerCount"
            />
            {{ t('resultBoard.filter.minCountUnit') }}
          </label>
          <Button
            v-if="state.hiddenAccounts.size > 0"
            variant="link"
            size="sm"
            class="h-auto p-0"
            data-board-show-hidden
            @click="board.showAllSellers"
          >
            {{ t('resultBoard.hidden.restore', { count: state.hiddenAccounts.size }) }}
          </Button>
        </div>

        <p
          v-if="!conversionAvailable && entries.length > 0"
          class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
          data-board-no-conversion
        >
          {{ t('resultBoard.conversionUnavailable') }}
        </p>
        <Button
          v-if="view === 'items' && state.hiddenAccounts.size > 0"
          variant="link"
          size="sm"
          class="h-auto self-start p-0"
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
          ref="itemsListRef"
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
          ref="sellersListRef"
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
            :stash-regex="
              board.isSellerExpanded(seller.account) ? board.stashRegexOf(seller) : undefined
            "
            :is-picked="board.isPicked"
            :is-expanded="board.isExpanded"
            :expanded="board.isSellerExpanded(seller.account)"
            :card-snapshot="board.cardSnapshot"
            @hide="board.hideSeller(seller.account)"
            @pick="board.togglePicked"
            @toggle-seller="board.toggleSellerExpanded(seller.account)"
            @toggle="board.toggleExpanded"
            @locate="board.locate"
            @travel="board.travel"
            @pin="board.pin"
            @copy-regex="board.copyStashRegex"
          />
        </ul>
      </template>
    </template>
  </SidebarPane>
</template>
