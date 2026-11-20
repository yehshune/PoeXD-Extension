<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  Loader2,
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
import { GOLD_COIN_ICON_URL } from '@/utils/poe-cdn-url';
import { isSameLeague, type PinnedItemSnapshot } from '@/utils/pinned-items';
import { getTradeRealm } from '@/utils/trade-realms';
import SidebarPane from '../layout/SidebarPane.vue';
import SidebarEmptyState from '../layout/SidebarEmptyState.vue';
import DragTrashZone from '../layout/DragTrashZone.vue';
import {
  hideDragTrash,
  scheduleAfterSortableDrop,
  showDragTrash,
  useDragTrash,
} from '../composables/useDragTrash';
import { createSidebarDragScrollOptions } from '../composables/sidebar-drag-scroll';
import { moveTemplateId } from '../stat-group-templates/template-order';
import { requestResultTranslation } from '@/utils/market-result-translation-request';
import PinnedItemActions from './PinnedItemActions.vue';
import PinnedItemCardView from './PinnedItemCardView.vue';
import { resolveRarityClass } from './pinned-item-card';
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
const searchInputRef = ref<InstanceType<typeof Input> | null>(null);

const filteredItems = computed(() => {
  const matched = filterPinnedItems(visibleItems.value, searchQuery.value);
  return sortPinnedItems(matched, sortMode.value, currencyRates.value);
});
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

const {
  trashZone,
  isDragging,
  isOverTrash,
  trashStyle,
  enableDragScrollBlock,
  disableDragScrollBlock,
  setupTrashListeners,
} = useDragTrash(LIST_SCROLL_SELECTOR);

let sortable: Sortable | null = null;

function endDrag() {
  if (trashZone.value) {
    hideDragTrash(trashZone.value);
    trashZone.value.classList.remove('drag-hover');
  }
  isDragging.value = false;
  isOverTrash.value = false;
  disableDragScrollBlock();
}

/**
 * 整張釘選卡都可以拖曳：拖到別的位置排序，拖到垃圾桶取消釘選。
 * 按鈕與連結不會開始拖曳（各自有點擊行為），展開改由卡片右側的展開按鈕切換。
 * 只顯示目前聯盟時排序的是看得到的這幾筆，其他聯盟的釘選維持原位（見 applyPinnedOrder）。
 */
function initSortable() {
  sortable?.destroy();
  sortable = null;
  if (!listRef.value) return;
  sortable = Sortable.create(listRef.value, {
    animation: 200,
    draggable: ROW_SELECTOR,
    handle: '[data-pinned-item-toggle]',
    ghostClass: 'sortable-ghost',
    filter: 'button, a, input, label',
    preventOnFilter: false,
    disabled: !canDrag.value,
    ...createSidebarDragScrollOptions(listRef.value.closest<HTMLElement>(LIST_SCROLL_SELECTOR)),
    onStart: () => {
      if (trashZone.value) showDragTrash(trashZone.value);
      isDragging.value = true;
      enableDragScrollBlock();
    },
    onEnd: (event) => {
      const droppedOverTrash = isOverTrash.value;
      const { oldIndex, newIndex, item, from } = event;
      const itemId = item.dataset.pinnedItemId;
      endDrag();
      if (typeof oldIndex !== 'number') return;
      // 先把 DOM 還原，交由 Vue 依資料重新渲染，避免 Sortable 與 Vue 的 DOM 狀態不一致
      if (typeof newIndex === 'number' && newIndex !== oldIndex) {
        const reference = from.children[oldIndex < newIndex ? oldIndex : oldIndex + 1] ?? null;
        from.insertBefore(item, reference);
      }
      const ids = visibleItems.value.map((entry) => entry.id);
      const target = visibleItems.value.find((entry) => entry.id === itemId);
      scheduleAfterSortableDrop(async () => {
        if (droppedOverTrash) {
          if (target) await unpin(target);
          return;
        }
        if (typeof newIndex !== 'number' || newIndex === oldIndex) return;
        await reorder(moveTemplateId(ids, oldIndex, newIndex));
      });
    },
  });
}

function setTrashZoneRef(component: unknown) {
  trashZone.value = (component as { $el?: HTMLElement } | null)?.$el ?? null;
}

let trashCleanup: (() => void) | null = null;
watch(trashZone, (el) => {
  trashCleanup?.();
  trashCleanup = el ? setupTrashListeners(el) : null;
});

watch(canDrag, (enabled) => sortable?.option('disabled', !enabled));
watch(
  () => visibleItems.value.length > 0,
  async () => {
    await nextTick();
    initSortable();
  },
);

onMounted(async () => {
  await nextTick();
  initSortable();
});

onUnmounted(() => {
  sortable?.destroy();
  sortable = null;
  trashCleanup?.();
  trashCleanup = null;
  disableDragScrollBlock();
});

// 名稱以 `.item-popup__header-line` 標記，市集漢化會像結果列一樣翻譯（清單本身沒有 `poexd*` class）
watch(listRef, (list) => {
  if (list) requestResultTranslation(list);
});

/**
 * 收合時是一行精簡列（圖示、名稱、價格），點一下展開官方卡片快照與完整按鈕列。
 * 展開狀態是這次瀏覽的暫時狀態，不保存。拖曳由 Sortable 判斷：按住移動才算拖曳，單純點擊會展開。
 */
const expandedIds = ref<ReadonlySet<string>>(new Set());

function isExpanded(item: PinnedItemSnapshot): boolean {
  return expandedIds.value.has(item.id);
}

function expandLabel(item: PinnedItemSnapshot): string {
  return isExpanded(item) ? t('pinnedItem.action.collapse') : t('pinnedItem.action.expand');
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

function collapseAll(): void {
  if (expandedIds.value.size === 0) return;
  expandedIds.value = new Set();
}

/** 官方物品名稱的稀有度顏色（以 OKLCH 調和亮度與飽和度，與深色主題及 PoB 購物清單色票協調） */
const RARITY_COLOURS: Readonly<Record<string, string>> = {
  normal: 'var(--foreground)',
  magic: 'oklch(0.68 0.13 258)',
  rare: 'oklch(0.76 0.13 92)',
  unique: 'oklch(0.68 0.15 50)',
  gem: 'oklch(0.7 0.1 190)',
  currency: 'oklch(0.74 0.06 82)',
  divination: 'oklch(0.72 0.12 225)',
};

function rarityColour(item: PinnedItemSnapshot): string {
  return RARITY_COLOURS[resolveRarityClass(item.item)] ?? RARITY_COLOURS.normal!;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 名稱與基底；PoE 2 的 `[標籤|文字]` 標記只顯示文字 */
function nameLines(item: PinnedItemSnapshot): string[] {
  const unwrap = (value: string) => value.replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');
  const name = unwrap(textOf(item.item.name));
  const typeLine = unwrap(textOf(item.item.typeLine) || textOf(item.item.baseType));
  return [name, typeLine].filter(Boolean);
}

/** 價格只顯示數量（官方的 `~b/o` / `~price` 前綴不顯示）；沒有通貨圖示時改顯示通貨代碼 */
function priceAmount(item: PinnedItemSnapshot): string {
  const price = item.listing.price;
  if (!price) return t('pinnedItem.noPrice');
  return price.icon ? `${price.amount}` : `${price.amount} ${price.currency}`;
}

/** 收合列第二行的灰色資訊（省略賣家帳號，僅保留上架時間與跨聯盟／分流提示） */
function metaParts(item: PinnedItemSnapshot): string[] {
  return [
    formatAge(item.listing.indexed),
    showAllLeagues.value || !currentLeague || !isSameLeague(item.league, currentLeague)
      ? item.league
      : '',
    sameRealm(item) ? '' : realmLabel(item),
  ].filter(Boolean);
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

function formatAge(iso: string | undefined): string {
  if (!iso) return '';
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return '';
  const format = new Intl.RelativeTimeFormat(getActiveUiLocale(), { numeric: 'auto' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return format.format(0, 'minute');
}

function realmLabel(item: PinnedItemSnapshot): string {
  return t(getTradeRealm(item.realm).labelKey);
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

function formatPinnedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const d = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function priceComparisonOf(item: PinnedItemSnapshot): PinnedPriceComparison | undefined {
  if (!enablePriceComparison.value) return undefined;
  return resolvePinnedPriceComparison(item, version, currencyRates.value, getActiveUiLocale(), t);
}

function formatFee(fee: number | undefined): string {
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee <= 0) return '';
  return new Intl.NumberFormat(getActiveUiLocale()).format(fee);
}

function expandedListingMeta(item: PinnedItemSnapshot): string {
  const parts: string[] = [];
  const age = formatAge(item.listing.indexed);
  if (age) parts.push(t('pinnedItem.meta.listedAt', { time: age }));
  if (item.listing.accountName) {
    parts.push(t('pinnedItem.meta.seller', { name: item.listing.accountName }));
  }
  if (showAllLeagues.value || !currentLeague || !isSameLeague(item.league, currentLeague)) {
    parts.push(item.league);
  }
  if (!sameRealm(item)) {
    parts.push(realmLabel(item));
  }
  return parts.join(' · ');
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
              :variant="sortMode !== 'custom' ? 'default' : 'secondary'"
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
          :variant="isSearchVisible ? 'default' : 'secondary'"
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
          variant="secondary"
          size="icon-sm"
          class="shrink-0"
          data-pinned-items-collapse-all
          :disabled="!hasAnyExpanded"
          :title="t('bookmark.action.collapseAll')"
          :aria-label="t('bookmark.action.collapseAll')"
          @click="collapseAll"
        >
          <ChevronsDownUp />
        </Button>
        <DropdownMenu v-model:open="isClearMenuOpen">
          <DropdownMenuTrigger as-child>
            <Button
              variant="secondary"
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
          :title="t('bookmark.search.clearTooltip')"
          @click="searchQuery = ''"
        >
          <X />
        </Button>
      </div>
    </template>

    <template #scroll>
      <SidebarEmptyState
        v-if="visibleItems.length === 0"
        :message="t('pinnedItem.empty')"
        :hint="hiddenCount > 0 ? t('pinnedItem.hiddenByLeague', { count: hiddenCount }) : undefined"
        data-pinned-items-empty
      >
        <template #icon><Pin /></template>
      </SidebarEmptyState>

      <template v-else>
        <p
          v-if="filteredItems.length === 0"
          class="m-0 py-[var(--pxd-space-lg)] text-center text-[length:var(--pxd-font-secondary)] text-muted-foreground"
          data-pinned-items-no-match
        >
          {{ t('pinnedItem.noMatch', { query: searchQuery.trim() }) }}
        </p>

        <ul
          v-show="filteredItems.length > 0"
          ref="listRef"
          class="m-0 flex list-none flex-col overflow-hidden rounded-md border border-border bg-card p-0"
          data-pinned-items-list
        >
          <li
            v-for="item in filteredItems"
            :key="item.id"
            class="pinned-item-row group relative border-0 border-b border-dashed border-border last:border-b-0 transition-colors"
            :class="[
              isExpanded(item)
                ? 'bg-muted/20'
                : 'hover:bg-muted/40 has-[[data-state=open]]:bg-muted/40',
            ]"
            :data-pinned-item-id="item.id"
            :data-expanded="isExpanded(item) ? '' : undefined"
          >
            <template v-if="!isExpanded(item)">
              <div
                role="button"
                tabindex="0"
                class="flex items-center gap-[var(--pxd-space-md)] px-[var(--pxd-space-md)] py-[var(--pxd-space-lg)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                :class="[
                  canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                  isSold(item) ? 'opacity-65' : '',
                ]"
                data-pinned-item-toggle
                :aria-expanded="false"
                :title="expandLabel(item)"
                @click="toggleExpanded(item)"
                @keydown.enter.prevent="toggleExpanded(item)"
                @keydown.space.prevent="toggleExpanded(item)"
              >
                <img
                  v-if="typeof item.item.icon === 'string'"
                  :src="item.item.icon"
                  alt=""
                  class="size-[var(--control-height-lg)] shrink-0 object-contain"
                  referrerpolicy="no-referrer"
                  draggable="false"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-[var(--pxd-space-xs)]">
                  <span
                    class="truncate text-[length:var(--pxd-font-body)] font-semibold leading-tight"
                    :style="{ color: rarityColour(item) }"
                    data-pinned-item-name
                  >
                    <span
                      v-for="(line, index) in nameLines(item)"
                      :key="index"
                      class="item-popup__header-line"
                      :class="{ 'ml-[0.35em]': index > 0 }"
                      >{{ line }}</span
                    >
                  </span>
                  <span
                    v-if="metaParts(item).length > 0"
                    class="truncate text-[length:var(--pxd-font-micro)] text-muted-foreground leading-tight"
                    data-pinned-item-meta
                    >{{ metaParts(item).join(' · ') }}</span
                  >
                </div>
                <div
                  class="flex shrink-0 flex-col items-end gap-[2px] group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
                >
                  <span
                    class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-section-title)] font-bold tabular-nums leading-none text-foreground"
                    :class="{ 'line-through': isSold(item) }"
                    data-pinned-item-price
                  >
                    {{ priceAmount(item) }}
                    <img
                      v-if="item.listing.price?.icon"
                      :src="item.listing.price.icon"
                      :alt="item.listing.price.currency"
                      :title="item.listing.price.currencyName ?? item.listing.price.currency"
                      class="size-[var(--control-icon-lg)] object-contain"
                      referrerpolicy="no-referrer"
                      draggable="false"
                      data-pinned-item-currency-icon
                    />
                  </span>
                  <span
                    v-if="isSold(item)"
                    class="rounded-sm border border-destructive/30 bg-destructive/15 px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-micro)] font-semibold leading-tight text-destructive"
                    data-pinned-item-sold
                    >{{ t('pinnedItem.sold') }}</span
                  >
                  <span
                    v-else-if="states[item.id] === 'refreshing' || states[item.id] === 'traveling'"
                    class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)]"
                    :class="
                      states[item.id] === 'refreshing' ? 'text-muted-foreground' : 'text-primary'
                    "
                    data-pinned-item-busy
                  >
                    <Loader2
                      class="size-[var(--control-icon-sm)] shrink-0 animate-spin"
                      aria-hidden="true"
                    />
                    {{
                      states[item.id] === 'refreshing'
                        ? t('pinnedItem.action.refreshing')
                        : t('pinnedItem.action.traveling')
                    }}
                  </span>
                </div>
                <ChevronDown
                  class="size-[var(--control-icon-sm)] shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              </div>

              <!-- 收合時 hover 才浮出的操作（停在右側展開箭頭左側、整列等高實色遮擋＋左側漸層淡出，並即時隱藏右側標價） -->
              <PinnedItemActions
                class="pxd-hover-actions-overlay absolute inset-y-0 right-[calc(var(--pxd-space-md)+var(--control-icon-sm)+var(--pxd-space-sm))] z-(--pxd-z-raised) flex items-center py-1 pr-[var(--pxd-space-xs)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto"
                :item="item"
                :state="isSold(item) ? 'sold' : states[item.id]"
                :same-realm="sameRealm(item)"
                :can-copy-pob="canCopyPob(item)"
                :has-source="!!sourceUrl(item)"
                :full="false"
                @travel="travel(item)"
                @whisper="copyWhisper(item)"
                @pob="copyPob(item)"
                @source="openSource(item)"
                @unpin="unpin(item)"
              />
            </template>

            <div v-else class="flex flex-col bg-background">
              <div
                data-pinned-item-expanded-header
                class="flex items-stretch gap-[var(--pxd-space-md)] border-b border-border/60 bg-card/50 p-[var(--pxd-space-md)]"
              >
                <div
                  data-pinned-item-icon-frame
                  class="size-[var(--pxd-pinned-icon-box-size,88px)] shrink-0 flex items-center justify-center overflow-hidden rounded-md border border-border/80 bg-black/55 p-[var(--pxd-space-xs)]"
                >
                  <PinnedItemCardView :snapshot="item" :collapsed="false" part="icon" />
                </div>
                <div class="flex min-w-0 flex-1 flex-col justify-between gap-[var(--pxd-space-sm)]">
                  <div class="flex min-w-0 items-start justify-between gap-[var(--pxd-space-sm)]">
                    <div class="flex min-w-0 flex-wrap items-center gap-[var(--pxd-space-xs)]">
                      <span
                        class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-section-title)] font-bold tabular-nums leading-none text-foreground"
                        :class="{ 'line-through opacity-70': isSold(item) }"
                        data-pinned-item-price
                      >
                        {{ priceAmount(item) }}
                        <img
                          v-if="item.listing.price?.icon"
                          :src="item.listing.price.icon"
                          :alt="item.listing.price.currency"
                          :title="item.listing.price.currencyName ?? item.listing.price.currency"
                          class="block size-[var(--control-icon-lg)] shrink-0 object-contain"
                          referrerpolicy="no-referrer"
                          draggable="false"
                          data-pinned-item-currency-icon
                        />
                      </span>
                      <span
                        v-if="priceComparisonOf(item)"
                        data-pinned-item-price-conversion
                        :title="priceComparisonOf(item)?.tooltip"
                        class="inline-flex items-center gap-[3px] text-[length:var(--pxd-font-micro)] font-medium tabular-nums leading-none text-muted-foreground"
                      >
                        <span class="leading-none">≈ {{ priceComparisonOf(item)?.amount }}</span>
                        <img
                          :src="priceComparisonOf(item)?.icon"
                          :alt="priceComparisonOf(item)?.currencyName"
                          :title="priceComparisonOf(item)?.currencyName"
                          class="block size-[var(--control-icon-default)] shrink-0 translate-y-[1px] object-contain"
                          referrerpolicy="no-referrer"
                          draggable="false"
                          data-pinned-item-price-conversion-icon
                        />
                      </span>
                      <span
                        v-if="isSold(item)"
                        class="rounded-sm border border-destructive/30 bg-destructive/15 px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-micro)] font-semibold leading-tight text-destructive"
                        data-pinned-item-sold
                        >{{ t('pinnedItem.sold') }}</span
                      >
                      <span
                        v-else-if="
                          states[item.id] === 'refreshing' || states[item.id] === 'traveling'
                        "
                        class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)]"
                        :class="
                          states[item.id] === 'refreshing'
                            ? 'text-muted-foreground'
                            : 'text-primary'
                        "
                        data-pinned-item-busy
                      >
                        <Loader2
                          class="size-[var(--control-icon-sm)] shrink-0 animate-spin"
                          aria-hidden="true"
                        />
                        {{
                          states[item.id] === 'refreshing'
                            ? t('pinnedItem.action.refreshing')
                            : t('pinnedItem.action.traveling')
                        }}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      class="-mr-[var(--pxd-space-xs)] -mt-[var(--pxd-space-xs)] shrink-0 text-muted-foreground"
                      data-pinned-item-toggle
                      :aria-expanded="true"
                      :title="expandLabel(item)"
                      :aria-label="expandLabel(item)"
                      @click="toggleExpanded(item)"
                    >
                      <ChevronUp />
                    </Button>
                  </div>
                  <div
                    data-pinned-item-details
                    class="flex min-w-0 flex-col gap-[2px] text-[length:var(--pxd-font-micro)] leading-snug text-muted-foreground"
                  >
                    <span
                      v-if="formatFee(item.listing.fee)"
                      data-pinned-item-fee
                      :title="`${t('pinnedItem.meta.fee')}${formatFee(item.listing.fee)}`"
                      class="inline-flex items-center gap-[3px] leading-none tabular-nums text-foreground/85"
                    >
                      <span class="leading-none">{{ t('pinnedItem.meta.fee') }}</span>
                      <img
                        :src="GOLD_COIN_ICON_URL"
                        alt="Gold"
                        class="block size-[var(--control-icon-sm)] shrink-0 object-contain"
                        referrerpolicy="no-referrer"
                        draggable="false"
                        data-pinned-item-fee-icon
                      />
                      <span class="leading-none">{{ formatFee(item.listing.fee) }}</span>
                    </span>
                    <span
                      v-if="formatPinnedAt(item.pinnedAt)"
                      data-pinned-item-pinned-at
                      class="truncate tabular-nums"
                    >
                      {{ t('pinnedItem.meta.pinnedAt', { time: formatPinnedAt(item.pinnedAt) }) }}
                    </span>
                    <span
                      v-if="expandedListingMeta(item)"
                      data-pinned-item-listing-meta
                      class="truncate"
                      :title="expandedListingMeta(item)"
                    >
                      {{ expandedListingMeta(item) }}
                    </span>
                  </div>
                  <PinnedItemActions
                    class="flex-wrap"
                    :item="item"
                    :state="isSold(item) ? 'sold' : states[item.id]"
                    :same-realm="sameRealm(item)"
                    :can-copy-pob="canCopyPob(item)"
                    :has-source="!!sourceUrl(item)"
                    :full="true"
                    @travel="travel(item)"
                    @whisper="copyWhisper(item)"
                    @pob="copyPob(item)"
                    @source="openSource(item)"
                    @unpin="unpin(item)"
                  />
                </div>
              </div>
              <PinnedItemCardView :snapshot="item" :collapsed="false" part="popup" />
            </div>
          </li>
        </ul>
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
