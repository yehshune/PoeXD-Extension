<script setup lang="ts">
/**
 * 搜尋結果看板（GLOSSARY.md「Result Board」）：這次搜尋已取得的結果，以物品清單或賣家清單檢視。
 * 不改動官方結果列；載入更多透過官方按鈕（ADR-0018）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  LayoutList,
  ListFilter,
  Loader2,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
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
import type { BoardSortMode } from '@/utils/result-board/board-projection';
import { createVersionedStorageKeys } from '@/utils/storage-contracts';
import { getPoeVersion } from '@/utils/trade-context';
import SidebarPane from '../layout/SidebarPane.vue';
import SidebarEmptyState from '../layout/SidebarEmptyState.vue';
import SidebarFilterEmptyState from '../layout/SidebarFilterEmptyState.vue';
import BoardCurrencyAmount from './BoardCurrencyAmount.vue';
import ResultBoardItemRow from './ResultBoardItemRow.vue';
import ResultBoardModFilterPanel from './ResultBoardModFilterPanel.vue';
import ResultBoardPriceFilter from './ResultBoardPriceFilter.vue';
import ResultBoardSellerRow from './ResultBoardSellerRow.vue';
import { currencyDisplayOf, stopMessage } from './result-board-format';
import { parseBound, useResultBoard, type BoardView } from './useResultBoard';

const board = useResultBoard();
const {
  state,
  loaderState,
  rates,
  enablePriceComparison,
  isLiveMode,
  view,
  sortMode,
  sortModes,
  instantOnly,
  hideSold,
  hasSoldEntries,
  keyword,
  modConditions,
  modPickerQuery,
  modQuickFilter,
  hasActiveFilters,
  syncOfficialFilter,
  modOptions,
  filteredModOptions,
  modOptionByKey,
  priceMinText,
  priceMaxText,
  minSellerCount,
  entries,
  hasMixedInstantBuyout,
  listedCount,
  conversionAvailable,
  filteredEntries,
  sellers,
  sellerInstantCounts,
  priceSummary,
  travelStates,
  hasAnyExpanded,
  canToggleExpandAll,
  canLoadMore,
} = board;

const primaryCurrency = computed(() =>
  currencyDisplayOf(rates.value?.primary, state.value.currencies),
);

const LOAD_PRESETS = [10, 20, 30, 50, 'all'] as const;
type BoardLoadPreset = (typeof LOAD_PRESETS)[number];
const ITEMS_PER_BATCH = 10;

const isSortMenuOpen = ref(false);
const isLoadMenuOpen = ref(false);
const loadPreset = ref<BoardLoadPreset>(10);
const isSearchVisible = ref(false);
const isModFilterOpen = ref(false);
const searchInputRef = ref<InstanceType<typeof Input> | null>(null);
const itemsListRef = ref<HTMLElement | null>(null);
const sellersListRef = ref<HTMLElement | null>(null);
const storageKeys = createVersionedStorageKeys(getPoeVersion());
const searchStorageKey = storageKeys.resultBoardSearchVisible;
const viewStorageKey = storageKeys.resultBoardView;
const hideSoldStorageKey = storageKeys.resultBoardHideSold;
const loadPresetStorageKey = storageKeys.resultBoardLoadPreset;
let searchUserToggled = false;
let viewUserToggled = false;
let hideSoldUserToggled = false;
let loadPresetUserSelected = false;

/** 儲存的值不可信：只接受已知的檢視與載入預設 */
const isBoardView = (value: unknown): value is BoardView =>
  value === 'items' || value === 'sellers';
const isBoardLoadPreset = (value: unknown): value is BoardLoadPreset =>
  (LOAD_PRESETS as readonly unknown[]).includes(value);

function persistLocal(key: string, value: unknown): void {
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storage?.set) return;
  void storage.set({ [key]: value }).catch(() => {});
}

onMounted(() => {
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storage?.get) return;
  void storage
    .get([searchStorageKey, viewStorageKey, hideSoldStorageKey, loadPresetStorageKey])
    .then((data: Record<string, unknown>) => {
      if (!searchUserToggled) isSearchVisible.value = data?.[searchStorageKey] === true;
      const savedView = data?.[viewStorageKey];
      if (!viewUserToggled && isBoardView(savedView)) view.value = savedView;
      if (!hideSoldUserToggled && typeof data?.[hideSoldStorageKey] === 'boolean') {
        hideSold.value = data[hideSoldStorageKey];
      }
      const savedPreset = data?.[loadPresetStorageKey];
      if (!loadPresetUserSelected && isBoardLoadPreset(savedPreset)) {
        loadPreset.value = savedPreset;
      }
    })
    .catch(() => {});
});

/** 切換物品／賣家清單，並記住選擇（依遊戲版本分開保存） */
function selectView(next: BoardView): void {
  viewUserToggled = true;
  if (view.value === next) return;
  view.value = next;
  persistLocal(viewStorageKey, next);
}

function setHideSold(next: boolean | 'indeterminate'): void {
  hideSoldUserToggled = true;
  const value = next === true;
  hideSold.value = value;
  persistLocal(hideSoldStorageKey, value);
}

function loadPresetLabel(preset: BoardLoadPreset): string {
  return preset === 'all'
    ? t('resultBoard.load.all')
    : t('resultBoard.load.batch', { count: preset });
}

function triggerLoad(preset: BoardLoadPreset = loadPreset.value): void {
  if (preset === 'all') board.loadAll();
  else board.loadBatches(preset / ITEMS_PER_BATCH);
}

function selectLoadPreset(preset: BoardLoadPreset): void {
  loadPresetUserSelected = true;
  loadPreset.value = preset;
  persistLocal(loadPresetStorageKey, preset);
  triggerLoad(preset);
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

function toggleModFilter(): void {
  isModFilterOpen.value = !isModFilterOpen.value;
  if (isModFilterOpen.value) {
    board.ensureModDictionary();
  }
}

function closeModFilter(): void {
  isModFilterOpen.value = false;
  modPickerQuery.value = '';
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

const summaryTokens = computed(() =>
  t('resultBoard.summary.price', { min: '\0min\0', median: '\0median\0' }).split('\0'),
);

function setMinSellerCount(value: string | number): void {
  const parsed = Math.floor(Number(value));
  minSellerCount.value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const activeBoardFilterLabels = computed(() => {
  const labels: string[] = [];
  const trimmedKeyword = keyword.value.trim();
  if (trimmedKeyword) {
    labels.push(t('common.filterTag.keyword', { query: trimmedKeyword }));
  }
  if (modConditions.value.length > 0) {
    labels.push(t('common.filterTag.mods', { count: modConditions.value.length }));
  }
  if (view.value === 'items') {
    const min = parseBound(priceMinText.value);
    const max = parseBound(priceMaxText.value);
    if (conversionAvailable.value && (min !== undefined || max !== undefined)) {
      const range =
        min !== undefined && max !== undefined
          ? `${min}~${max}`
          : min !== undefined
            ? `${min}~`
            : `~${max}`;
      labels.push(t('common.filterTag.price', { range }));
    }
    if (hasMixedInstantBuyout.value && instantOnly.value) {
      labels.push(t('resultBoard.filter.instantOnly'));
    }
    if (hasSoldEntries.value && hideSold.value) {
      labels.push(t('resultBoard.filter.hideSold'));
    }
  } else {
    if (
      (trimmedKeyword || modConditions.value.length > 0) &&
      hasSoldEntries.value &&
      hideSold.value
    ) {
      labels.push(t('resultBoard.filter.hideSold'));
    }
    if (minSellerCount.value > 0) {
      labels.push(t('common.filterTag.minSellerItems', { count: minSellerCount.value }));
    }
  }
  if (state.value.hiddenAccounts.size > 0) {
    labels.push(t('common.filterTag.hiddenSellers', { count: state.value.hiddenAccounts.size }));
  }
  return labels;
});

/** 價格區間標籤文字（`0.3–1`、`0.3–`、`–1`）；沒有匯率或沒有設定時為空 */
const priceRangeText = computed(() => {
  if (!conversionAvailable.value) return '';
  const min = parseBound(priceMinText.value);
  const max = parseBound(priceMaxText.value);
  if (min !== undefined && max !== undefined) return `${min}–${max}`;
  if (min !== undefined) return `${min}–`;
  return max !== undefined ? `–${max}` : '';
});

function clearPriceRange(): void {
  priceMinText.value = '';
  priceMaxText.value = '';
}

/** 「同賣家 ×N」：切到賣家清單、展開該賣家並捲到它 */
async function focusSeller(account: string): Promise<void> {
  selectView('sellers');
  board.focusSeller(account);
  await nextTick();
  const target = Array.from(
    sellersListRef.value?.querySelectorAll<HTMLElement>('[data-board-seller]') ?? [],
  ).find((el) => el.dataset.boardSeller === account);
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function resetAllFilters(): void {
  keyword.value = '';
  board.clearModConditions();
  priceMinText.value = '';
  priceMaxText.value = '';
  instantOnly.value = false;
  if (hideSold.value) {
    setHideSold(false);
  }
  minSellerCount.value = 0;
  if (state.value.hiddenAccounts.size > 0) {
    board.showAllSellers();
  }
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
            <div
              class="inline-flex h-[var(--control-height-sm)] shrink-0 items-stretch overflow-hidden rounded-md border border-border bg-primary shadow-sm"
            >
              <Button
                size="sm"
                class="h-full rounded-none border-0 shadow-none"
                data-board-load-action
                @click="triggerLoad()"
              >
                {{ loadPresetLabel(loadPreset) }}
              </Button>
              <span class="w-px self-stretch bg-primary-foreground/20" aria-hidden="true" />
              <DropdownMenu v-model:open="isLoadMenuOpen">
                <DropdownMenuTrigger as-child>
                  <Button
                    size="icon-sm"
                    class="h-full w-[calc(var(--control-height-sm)-4px)] rounded-none border-0 shadow-none"
                    :title="t('resultBoard.load.choosePreset')"
                    :aria-label="t('resultBoard.load.choosePreset')"
                    data-board-load-preset
                  >
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent v-if="isLoadMenuOpen" align="end">
                  <DropdownMenuItem
                    v-for="preset in LOAD_PRESETS"
                    :key="String(preset)"
                    :data-board-load-option="String(preset)"
                    class="justify-between gap-[var(--pxd-space-md)]"
                    @click="selectLoadPreset(preset)"
                  >
                    <span>{{ loadPresetLabel(preset) }}</span>
                    <Check
                      v-if="loadPreset === preset"
                      class="size-[var(--control-icon-sm)] text-primary"
                    />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
            priceSummary
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
            v-if="priceSummary"
            class="m-0 flex flex-wrap items-center gap-[3px] text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
            data-board-price-summary
          >
            <template v-for="(token, index) in summaryTokens" :key="index">
              <BoardCurrencyAmount
                v-if="token === 'min'"
                :amount="priceSummary.min"
                :currency="priceSummary.currency"
                :currencies="state.currencies"
              />
              <BoardCurrencyAmount
                v-else-if="token === 'median'"
                :amount="priceSummary.median"
                :currency="priceSummary.currency"
                :currencies="state.currencies"
              />
              <span v-else-if="token">{{ token }}</span>
            </template>
          </p>
        </div>
      </div>
      <Separator
        v-if="entries.length > 0 || state.searchId || loaderState.running"
        class="mb-[var(--pxd-space-sm)]"
      />

      <div class="flex flex-col gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-sm)]">
        <div class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]">
          <div
            class="order-1 flex h-[var(--control-height-sm)] shrink-0 items-center rounded-md border border-border p-[2px]"
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

          <div
            v-if="view === 'sellers'"
            class="order-3 flex basis-full items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] @[460px]:order-2 @[460px]:basis-auto"
          >
            <span>{{ t('resultBoard.filter.minCount') }}</span>
            <div
              class="inline-flex h-[var(--control-height-sm)] items-center overflow-hidden rounded-md border border-input bg-background"
            >
              <Button
                variant="ghost"
                size="icon-sm"
                class="h-full w-[calc(var(--control-height-sm)-4px)] rounded-none border-r border-border/60 text-muted-foreground hover:text-foreground"
                :disabled="minSellerCount <= 0"
                :aria-label="t('resultBoard.filter.decreaseMinCount')"
                data-board-min-count-dec
                @click="setMinSellerCount(minSellerCount - 1)"
              >
                <Minus />
              </Button>
              <Input
                :model-value="String(minSellerCount)"
                size="sm"
                type="text"
                inputmode="numeric"
                class="h-full w-[2.8em] rounded-none border-0 bg-transparent px-[var(--pxd-space-xs)] text-center tabular-nums shadow-none focus-visible:ring-0"
                :aria-label="t('resultBoard.filter.minCount')"
                data-board-min-count
                @update:model-value="setMinSellerCount"
                @keydown.up.prevent="setMinSellerCount(minSellerCount + 1)"
                @keydown.down.prevent="setMinSellerCount(minSellerCount - 1)"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                class="h-full w-[calc(var(--control-height-sm)-4px)] rounded-none border-l border-border/60 text-muted-foreground hover:text-foreground"
                :aria-label="t('resultBoard.filter.increaseMinCount')"
                data-board-min-count-inc
                @click="setMinSellerCount(minSellerCount + 1)"
              >
                <Plus />
              </Button>
            </div>
            <span>{{ t('resultBoard.filter.minCountUnit') }}</span>
          </div>

          <div
            class="order-2 ml-auto flex shrink-0 items-center gap-[var(--pxd-space-sm)] @[460px]:order-3"
          >
            <ResultBoardPriceFilter
              v-if="view === 'items' && conversionAvailable"
              v-model:min="priceMinText"
              v-model:max="priceMaxText"
              :currency="primaryCurrency"
              :currency-code="rates?.primary"
            />
            <DropdownMenu v-if="view === 'items'" v-model:open="isSortMenuOpen">
              <DropdownMenuTrigger as-child>
                <Button
                  :variant="sortMode !== 'official' ? 'default' : 'outline'"
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
              :variant="syncOfficialFilter && hasActiveFilters ? 'default' : 'outline'"
              size="icon-sm"
              class="shrink-0"
              data-board-sync-official
              :disabled="!hasActiveFilters && !syncOfficialFilter"
              :aria-pressed="syncOfficialFilter && hasActiveFilters"
              :title="
                !hasActiveFilters && !syncOfficialFilter
                  ? t('resultBoard.syncOfficial.disabledHint')
                  : syncOfficialFilter
                    ? t('resultBoard.syncOfficial.active')
                    : t('resultBoard.syncOfficial.title')
              "
              :aria-label="
                syncOfficialFilter
                  ? t('resultBoard.syncOfficial.active')
                  : t('resultBoard.syncOfficial.title')
              "
              @click="board.toggleSyncOfficialFilter"
            >
              <ListFilter />
            </Button>
            <Button
              :variant="isModFilterOpen || modConditions.length > 0 ? 'default' : 'outline'"
              size="icon-sm"
              class="relative shrink-0"
              data-board-mod-filter-toggle
              :aria-expanded="isModFilterOpen"
              :title="t('resultBoard.modFilter.title')"
              :aria-label="t('resultBoard.modFilter.title')"
              @click="toggleModFilter"
            >
              <SlidersHorizontal />
              <span
                v-if="modConditions.length > 0"
                class="absolute -top-1 -right-1 flex min-w-[1.25em] items-center justify-center rounded-full border border-background bg-primary px-[3px] py-px text-[length:var(--pxd-font-micro)] font-bold leading-none text-primary-foreground tabular-nums"
                data-board-mod-filter-count
              >
                {{ modConditions.length }}
              </span>
            </Button>
            <Button
              :variant="isSearchVisible ? 'default' : 'outline'"
              size="icon-sm"
              class="shrink-0"
              data-board-search-toggle
              :aria-expanded="isSearchVisible"
              :title="
                isSearchVisible
                  ? t('bookmark.search.closeTooltip')
                  : t('resultBoard.filter.keyword')
              "
              :aria-label="
                isSearchVisible
                  ? t('bookmark.search.closeTooltip')
                  : t('resultBoard.filter.keyword')
              "
              @click="toggleSearch"
            >
              <Search />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              class="shrink-0"
              data-board-expand-toggle
              :disabled="!canToggleExpandAll"
              :aria-pressed="hasAnyExpanded"
              :title="hasAnyExpanded ? t('common.collapseAll') : t('common.expandAll')"
              :aria-label="hasAnyExpanded ? t('common.collapseAll') : t('common.expandAll')"
              @click="board.toggleExpandAll"
            >
              <ChevronsDownUp v-if="hasAnyExpanded" />
              <ChevronsUpDown v-else />
            </Button>
          </div>
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
            :aria-label="t('common.clearSearch')"
            @click="keyword = ''"
          >
            <X />
          </Button>
        </div>

        <ResultBoardModFilterPanel
          :open="isModFilterOpen"
          :query="modPickerQuery"
          :quick-filter="modQuickFilter"
          :options="filteredModOptions"
          :all-option-count="modOptions.length"
          :option-by-key="modOptionByKey"
          :conditions="modConditions"
          @update:query="modPickerQuery = $event"
          @update:quick-filter="modQuickFilter = $event"
          @select="board.setModCondition"
          @toggle="board.toggleModOption"
          @remove="board.removeModCondition"
          @clear-all="board.clearModConditions"
          @close="closeModFilter"
        />

        <div
          v-if="view === 'items' && (hasMixedInstantBuyout || hasSoldEntries || priceRangeText)"
          class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]"
        >
          <span
            v-if="priceRangeText"
            class="inline-flex h-[22px] items-center gap-[2px] rounded-full border border-primary/40 bg-primary/10 pl-[var(--pxd-space-sm)] pr-[2px] text-[length:var(--pxd-font-caption)] text-primary tabular-nums"
            data-board-price-chip
          >
            {{ t('common.filterTag.price', { range: priceRangeText }) }}
            <img
              v-if="primaryCurrency?.icon"
              :src="primaryCurrency.icon"
              :alt="rates?.primary"
              class="size-[var(--control-icon-sm)] shrink-0 object-contain"
              referrerpolicy="no-referrer"
              draggable="false"
            />
            <button
              type="button"
              class="flex size-[18px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-primary hover:bg-primary/15"
              :aria-label="t('resultBoard.filter.clearPrice')"
              :title="t('resultBoard.filter.clearPrice')"
              data-board-price-chip-clear
              @click="clearPriceRange"
            >
              <X class="size-[var(--control-icon-sm)]" />
            </button>
          </span>
          <label
            v-if="hasMixedInstantBuyout"
            class="flex items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] cursor-pointer select-none"
          >
            <Checkbox v-model="instantOnly" data-board-instant-only />
            {{ t('resultBoard.filter.instantOnly') }}
          </label>
          <label
            v-if="hasSoldEntries"
            class="flex items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] cursor-pointer select-none"
          >
            <Checkbox
              :model-value="hideSold"
              data-board-hide-sold
              @update:model-value="setHideSold"
            />
            {{ t('resultBoard.filter.hideSold') }}
          </label>
        </div>

        <p
          v-if="enablePriceComparison && !conversionAvailable && entries.length > 0"
          class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
          data-board-no-conversion
        >
          {{ t('resultBoard.conversionUnavailable') }}
        </p>
        <Button
          v-if="state.hiddenAccounts.size > 0"
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
        <SidebarFilterEmptyState
          v-if="filteredEntries.length === 0"
          :message="t('resultBoard.noMatch')"
          :active-filters="activeBoardFilterLabels"
          :show-reset="activeBoardFilterLabels.length > 0"
          data-board-no-match
          @reset="resetAllFilters"
        />
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
            :card-snapshot="board.cardSnapshot"
            :pinned="board.isPinned(entry.id)"
            :travel-state="travelStates[entry.id]"
            :matched-mods="board.matchedModTexts(entry)"
            :same-seller-count="sellerInstantCounts.get(entry.seller.account)"
            @focus-seller="focusSeller(entry.seller.account)"
            @toggle="board.toggleExpanded(entry.id)"
            @locate="board.locate(entry.id)"
            @travel="board.travel(entry.id)"
            @pin="board.pin(entry.id)"
          />
        </ul>
      </template>

      <template v-else>
        <SidebarFilterEmptyState
          v-if="sellers.length === 0"
          :message="t('resultBoard.noSellerMatch')"
          :active-filters="activeBoardFilterLabels"
          :show-reset="activeBoardFilterLabels.length > 0"
          data-board-no-seller-match
          @reset="resetAllFilters"
        />
        <ul
          v-else
          ref="sellersListRef"
          class="m-0 flex list-none flex-col gap-[var(--pxd-space-sm)] p-0"
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
            :stash-regex-for="board.stashRegexForEntries"
            :is-picked="board.isPicked"
            :is-pinned="board.isPinned"
            :travel-states="travelStates"
            :is-expanded="board.isExpanded"
            :expanded="board.isSellerExpanded(seller.account)"
            :card-snapshot="board.cardSnapshot"
            @hide="board.hideSeller(seller.account)"
            @travel-seller="board.travelSeller(seller)"
            @pick="board.togglePicked"
            @pick-group="board.toggleGroupPicked"
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
