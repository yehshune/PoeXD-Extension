<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Pin,
  Search,
  Trash2,
  X,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { getActiveUiLocale, t } from '@/utils/i18n';
import { isSameLeague, type PinnedItemSnapshot } from '@/utils/pinned-items';
import { getTradeRealm } from '@/utils/trade-realms';
import SidebarPane from '../layout/SidebarPane.vue';
import SidebarEmptyState from '../layout/SidebarEmptyState.vue';
import SidebarFilterEmptyState from '../layout/SidebarFilterEmptyState.vue';
import DragTrashZone from '../layout/DragTrashZone.vue';
import { useSortableTrashList } from '../composables/useSortableTrashList';
import { useDebouncedRef } from '../composables/useDebouncedSearch';
import { requestResultTranslation } from '@/utils/market-result-translation-request';
import PinnedItemRow from './PinnedItemRow.vue';
import { filterPinnedItems } from './pinned-item-filter';
import {
  PINNED_SORT_MODES,
  resolvePinnedPriceComparison,
  sortPinnedItems,
  type PinnedPriceComparison,
  type PinnedSortMode,
} from './pinned-item-sort';
import { usePinnedItems } from './usePinnedItems';

const props = defineProps<{
  /** 側邊欄所在側；拖曳刪除的垃圾桶開在另一側 */
  sidebarPosition?: 'left' | 'right';
}>();

const LIST_SCROLL_SELECTOR = '[data-pane="pinned-items"] [data-slot="sidebar-pane-scroll"]';
const ROW_SELECTOR = '[data-pinned-item-id]';

const {
  version,
  items,
  visibleItems,
  hiddenCount,
  soldVisibleCount,
  showAllLeagues,
  states,
  currencyRates,
  enablePriceComparison,
  ensureCurrencyRates,
  currentLeague,
  limit,
  isSold,
  sameRealm,
  canCopyPob,
  sourceUrl,
  copyWhisper,
  travel,
  copyPob,
  openSource,
  unpin,
  reorder,
  clearVisible,
  clearSold,
} = usePinnedItems();

const sidebarPosition = computed(() => props.sidebarPosition ?? 'left');
const listRef = ref<HTMLElement | null>(null);
const isClearMenuOpen = ref(false);
const isSortMenuOpen = ref(false);
const sortMode = ref<PinnedSortMode>('custom');
const isSearchVisible = ref(false);
const searchQuery = ref('');
const debouncedSearchQuery = useDebouncedRef(searchQuery);
const searchInputRef = ref<InstanceType<typeof Input> | null>(null);

const filteredItems = computed(() => {
  const matched = filterPinnedItems(visibleItems.value, debouncedSearchQuery.value);
  return sortPinnedItems(matched, sortMode.value, currencyRates.value);
});
/** 已售出的釘選集中在清單底部的「已售出」區塊，不參與拖曳排序 */
const activeItems = computed(() => filteredItems.value.filter((item) => !isSold(item)));
const soldItems = computed(() => filteredItems.value.filter((item) => isSold(item)));
const isSoldGroupOpen = ref(true);
/** 搜尋中或非自訂排序時停用拖曳，避免錯位或與排序規則衝突。 */
const canDrag = computed(() => searchQuery.value.trim() === '' && sortMode.value === 'custom');

watch(sortMode, (mode) => {
  if (mode === 'price-asc' || mode === 'price-desc') {
    void ensureCurrencyRates();
  }
});

async function toggleSearch() {
  if (isSearchVisible.value) {
    closeSearch();
    return;
  }
  isSearchVisible.value = true;
  await nextTick();
  (searchInputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
}

function closeSearch() {
  isSearchVisible.value = false;
  searchQuery.value = '';
}

const hasVisibleItems = computed(() => visibleItems.value.length > 0);

/**
 * 整張釘選卡都可以拖曳：拖到別的位置排序，拖到垃圾桶取消釘選。
 * 按鈕與連結不會開始拖曳（各自有點擊行為），展開改由卡片右側的展開按鈕切換。
 * 只顯示目前聯盟時排序的是看得到的這幾筆，其他聯盟的釘選維持原位（見 applyPinnedOrder）。
 */
const { setTrashZoneRef, isDragging, isOverTrash, trashStyle } = useSortableTrashList({
  listRef,
  scrollSelector: LIST_SCROLL_SELECTOR,
  draggableSelector: ROW_SELECTOR,
  handle: '[data-pinned-item-toggle]',
  filter: 'button, a, input, label',
  canDrag,
  hasItems: hasVisibleItems,
  getItemId: (el) => el.dataset.pinnedItemId,
  // 只排序未售出的釘選；已售出與其他聯盟的釘選維持原位（見 applyPinnedOrder）
  getOrderedIds: () =>
    visibleItems.value.filter((entry) => !isSold(entry)).map((entry) => entry.id),
  onReorder: (nextIds) => reorder(nextIds),
  onTrashDrop: async (itemId) => {
    const target = visibleItems.value.find((entry) => entry.id === itemId);
    if (target) await unpin(target);
  },
});

// 名稱以 `.item-popup__header-line` 標記，市集漢化會像結果列一樣翻譯（清單本身沒有 `poexd*` class）
const soldListRef = ref<HTMLElement | null>(null);
watch([listRef, soldListRef], (lists) => {
  for (const list of lists) {
    if (list) requestResultTranslation(list);
  }
});

/**
 * 收合時是一行精簡列（圖示、名稱、價格），展開後保留上方列（隱藏原始小圖示，控制按鍵維持在右上角 hover）並在下方顯示細節與官方卡片快照。
 * 展開狀態是這次瀏覽的暫時狀態，不保存。拖曳由 Sortable 判斷：按住移動才算拖曳，單純點擊會展開。
 */
const expandedIds = ref<ReadonlySet<string>>(new Set());

function isExpanded(item: PinnedItemSnapshot): boolean {
  return expandedIds.value.has(item.id);
}

function toggleExpanded(item: PinnedItemSnapshot): void {
  const next = new Set(expandedIds.value);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  expandedIds.value = next;
}

const hasAnyExpanded = computed(() =>
  filteredItems.value.some((item) => expandedIds.value.has(item.id)),
);
const canToggleExpandAll = computed(() => hasAnyExpanded.value || filteredItems.value.length > 0);

function toggleExpandAll(): void {
  if (hasAnyExpanded.value) {
    expandedIds.value = new Set();
    return;
  }
  if (filteredItems.value.length === 0) return;
  expandedIds.value = new Set(filteredItems.value.map((item) => item.id));
}

/** 聯盟與目前不同（或勾選顯示所有聯盟）時，在灰色資訊附上聯盟 */
function showLeagueOf(item: PinnedItemSnapshot): boolean {
  return showAllLeagues.value || !currentLeague || !isSameLeague(item.league, currentLeague);
}

/** 伺服器與目前不同時才顯示 */
function realmLabelOf(item: PinnedItemSnapshot): string | undefined {
  return sameRealm(item) ? undefined : t(getTradeRealm(item.realm).labelKey);
}

const SORT_LABEL_KEYS: Record<
  PinnedSortMode,
  | 'pinnedItem.sort.custom'
  | 'pinnedItem.sort.newest'
  | 'pinnedItem.sort.priceAsc'
  | 'pinnedItem.sort.priceDesc'
> = {
  custom: 'pinnedItem.sort.custom',
  newest: 'pinnedItem.sort.newest',
  'price-asc': 'pinnedItem.sort.priceAsc',
  'price-desc': 'pinnedItem.sort.priceDesc',
};

function priceComparisonOf(item: PinnedItemSnapshot): PinnedPriceComparison | undefined {
  if (!enablePriceComparison.value) return undefined;
  return resolvePinnedPriceComparison(item, version, currencyRates.value, getActiveUiLocale(), t);
}

/** 作用中與已售出兩份清單共用的列屬性 */
function rowBindings(item: PinnedItemSnapshot) {
  return {
    item,
    expanded: isExpanded(item),
    sold: isSold(item),
    state: states.value[item.id],
    sameRealm: sameRealm(item),
    canCopyPob: canCopyPob(item),
    hasSource: !!sourceUrl(item),
    showLeague: showLeagueOf(item),
    realmLabel: realmLabelOf(item),
    priceComparison: priceComparisonOf(item),
  };
}
</script>

<template>
  <SidebarPane data-pane="pinned-items" class="pinned-items-pane">
    <template #fixed>
      <div
        class="flex items-center gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full min-w-0"
      >
        <label
          v-if="currentLeague"
          class="flex items-center gap-[var(--pxd-space-md)] min-w-0 flex-1 text-[length:var(--pxd-font-body)] text-foreground cursor-pointer select-none"
        >
          <Checkbox v-model="showAllLeagues" class="shrink-0" data-pinned-items-show-all />
          <span class="truncate">{{ t('pinnedItem.showAllLeagues') }}</span>
        </label>
        <span v-else class="flex-1"></span>
        <span
          class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums"
          data-pinned-items-count
          >{{ t('pinnedItem.count', { count: items.length, limit }) }}</span
        >
        <DropdownMenu v-model:open="isSortMenuOpen">
          <DropdownMenuTrigger as-child>
            <Button
              :variant="sortMode !== 'custom' ? 'default' : 'outline'"
              size="icon-sm"
              class="shrink-0"
              data-pinned-items-sort
              :disabled="visibleItems.length < 2 && sortMode === 'custom'"
              :title="t('pinnedItem.sort.title')"
              :aria-label="t('pinnedItem.sort.title')"
            >
              <ArrowUpDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent v-if="isSortMenuOpen" align="end">
            <DropdownMenuItem
              v-for="mode in PINNED_SORT_MODES"
              :key="mode"
              :data-pinned-sort-mode="mode"
              class="justify-between gap-[var(--pxd-space-md)]"
              @click="sortMode = mode"
            >
              <span>{{ t(SORT_LABEL_KEYS[mode]) }}</span>
              <Check
                v-if="sortMode === mode"
                class="size-[var(--control-icon-sm)] shrink-0 text-primary"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          :variant="isSearchVisible ? 'default' : 'outline'"
          size="icon-sm"
          class="shrink-0"
          data-pinned-items-search-toggle
          :disabled="visibleItems.length === 0 && !isSearchVisible"
          :title="
            isSearchVisible ? t('bookmark.search.closeTooltip') : t('pinnedItem.searchTooltip')
          "
          :aria-label="
            isSearchVisible ? t('bookmark.search.closeTooltip') : t('pinnedItem.searchTooltip')
          "
          @click="toggleSearch"
        >
          <Search />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          class="shrink-0"
          data-pinned-items-expand-toggle
          :disabled="!canToggleExpandAll"
          :aria-pressed="hasAnyExpanded"
          :title="hasAnyExpanded ? t('common.collapseAll') : t('common.expandAll')"
          :aria-label="hasAnyExpanded ? t('common.collapseAll') : t('common.expandAll')"
          @click="toggleExpandAll"
        >
          <ChevronsDownUp v-if="hasAnyExpanded" />
          <ChevronsUpDown v-else />
        </Button>
        <DropdownMenu v-model:open="isClearMenuOpen">
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="icon-sm"
              class="shrink-0"
              data-pinned-items-clear
              :disabled="visibleItems.length === 0"
              :title="t('pinnedItem.clearMenuTitle')"
              :aria-label="t('pinnedItem.clearMenuTitle')"
            >
              <Trash2 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent v-if="isClearMenuOpen" align="end">
            <DropdownMenuItem
              :disabled="soldVisibleCount === 0"
              data-pinned-items-clear-sold
              @click="clearSold"
            >
              <Trash2 class="text-muted-foreground" />
              <span>{{ t('pinnedItem.clearSold') }}</span>
              <span
                v-if="soldVisibleCount > 0"
                class="ml-auto pl-[var(--pxd-space-sm)] text-[length:var(--pxd-font-micro)] tabular-nums text-muted-foreground"
                >{{ soldVisibleCount }}</span
              >
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-pinned-items-clear-all
              @click="clearVisible"
            >
              <Trash2 class="text-destructive" />
              {{
                showAllLeagues || !currentLeague
                  ? t('pinnedItem.clearAll')
                  : t('pinnedItem.clearLeague')
              }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Separator class="mb-[var(--pxd-space-md)]" />

      <div v-if="isSearchVisible" class="relative mb-[var(--pxd-space-md)] flex items-center">
        <Search
          class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
        />
        <Input
          ref="searchInputRef"
          v-model="searchQuery"
          size="sm"
          :placeholder="t('pinnedItem.searchPlaceholder')"
          class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))]"
          data-pinned-items-search
          @keydown.esc.stop.prevent="closeSearch"
        />
        <Button
          v-if="searchQuery"
          variant="ghost"
          size="icon-sm"
          class="absolute right-[var(--pxd-space-xs)]"
          :title="t('common.clearSearch')"
          @click="searchQuery = ''"
        >
          <X />
        </Button>
      </div>
    </template>

    <template #scroll>
      <SidebarFilterEmptyState
        v-if="visibleItems.length === 0 && hiddenCount > 0"
        :message="t('pinnedItem.empty')"
        :hint="t('pinnedItem.hiddenByLeague', { count: hiddenCount })"
        :action-label="t('pinnedItem.showAllLeagues')"
        data-pinned-items-empty
        @reset="showAllLeagues = true"
      />
      <SidebarEmptyState
        v-else-if="visibleItems.length === 0"
        :message="t('pinnedItem.empty')"
        data-pinned-items-empty
      >
        <template #icon><Pin /></template>
      </SidebarEmptyState>

      <template v-else>
        <SidebarFilterEmptyState
          v-if="filteredItems.length === 0"
          mode="search"
          :message="t('pinnedItem.noMatch', { query: searchQuery.trim() })"
          data-pinned-items-no-match
          @reset="searchQuery = ''"
        />

        <ul
          v-show="activeItems.length > 0"
          ref="listRef"
          class="m-0 flex list-none flex-col overflow-hidden rounded-md border border-border bg-card p-0"
          data-pinned-items-list
        >
          <PinnedItemRow
            v-for="item in activeItems"
            :key="item.id"
            v-bind="rowBindings(item)"
            :draggable="canDrag"
            @toggle="toggleExpanded(item)"
            @travel="travel(item)"
            @whisper="copyWhisper(item)"
            @pob="copyPob(item)"
            @source="openSource(item)"
            @unpin="unpin(item)"
          />
        </ul>

        <section
          v-if="soldItems.length > 0"
          class="flex flex-col gap-[var(--pxd-space-sm)]"
          :class="activeItems.length > 0 ? 'mt-[var(--pxd-space-md)]' : ''"
          data-pinned-items-sold-group
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-[var(--pxd-space-xs)] border-0 bg-transparent p-0 text-left text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground transition-colors hover:text-foreground"
            :aria-expanded="isSoldGroupOpen"
            data-pinned-items-sold-toggle
            @click="isSoldGroupOpen = !isSoldGroupOpen"
          >
            <ChevronDown
              class="size-[var(--control-icon-sm)] shrink-0 transition-transform"
              :class="isSoldGroupOpen ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            <span class="tabular-nums">{{
              t('pinnedItem.soldGroup', { count: soldItems.length })
            }}</span>
          </button>
          <ul
            v-if="isSoldGroupOpen"
            ref="soldListRef"
            class="m-0 flex list-none flex-col overflow-hidden rounded-md border border-border bg-card p-0"
            data-pinned-items-sold-list
          >
            <PinnedItemRow
              v-for="item in soldItems"
              :key="item.id"
              v-bind="rowBindings(item)"
              :draggable="false"
              @toggle="toggleExpanded(item)"
              @travel="travel(item)"
              @whisper="copyWhisper(item)"
              @pob="copyPob(item)"
              @source="openSource(item)"
              @unpin="unpin(item)"
            />
          </ul>
        </section>
      </template>

      <DragTrashZone
        :ref="setTrashZoneRef"
        :visible="isDragging"
        :over-trash="isOverTrash"
        :sidebar-position="sidebarPosition"
        :style="trashStyle"
      >
        <div
          class="text-center text-[length:var(--pxd-font-secondary)] font-bold leading-snug select-none"
        >
          {{ t('pinnedItem.trash.release') }}
        </div>
      </DragTrashZone>
    </template>
  </SidebarPane>
</template>

<style scoped>
.sortable-ghost {
  opacity: 0.3;
  outline: 1px dashed var(--ring);
  outline-offset: -1px;
}

/* 懸停在垃圾桶上方時收縮佔位，預告取消釘選後的清單 */
.pinned-items-pane:has(.drag-trash-zone.drag-hover) .pinned-item-row.sortable-ghost {
  visibility: hidden;
  height: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  overflow: hidden;
}
</style>
