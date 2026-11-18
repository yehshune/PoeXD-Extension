<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import { GripVertical, Pin, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { getActiveUiLocale, t } from '@/utils/i18n';
import { isSameLeague, type PinnedItemSnapshot } from '@/utils/pinned-items';
import { getTradeRealm } from '@/utils/trade-realms';
import SidebarPane from '../layout/SidebarPane.vue';
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
import { usePinnedItems } from './usePinnedItems';

const props = defineProps<{
  /** 側邊欄所在側；拖曳刪除的垃圾桶開在另一側 */
  sidebarPosition?: 'left' | 'right';
}>();

const LIST_SCROLL_SELECTOR = '[data-pane="pinned-items"] [data-slot="sidebar-pane-scroll"]';
const ROW_SELECTOR = '[data-pinned-item-id]';

const {
  items,
  visibleItems,
  hiddenCount,
  showAllLeagues,
  states,
  currentLeague,
  limit,
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
} = usePinnedItems();

const sidebarPosition = computed(() => props.sidebarPosition ?? 'left');
const listRef = ref<HTMLElement | null>(null);

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
    ghostClass: 'sortable-ghost',
    filter: 'button, a, input, label',
    preventOnFilter: false,
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

/** 官方物品名稱的稀有度顏色（所有主題都是深色底） */
const RARITY_COLOURS: Readonly<Record<string, string>> = {
  normal: '#c8c8c8',
  magic: '#8888ff',
  rare: '#ffff77',
  unique: '#af6025',
  gem: '#1ba29b',
  currency: '#aa9e82',
  divination: '#0ebaff',
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

/** 收合列第二行的灰色資訊 */
function metaParts(item: PinnedItemSnapshot): string[] {
  return [
    item.listing.instantBuyout ? t('pinnedItem.instantBuyout') : '',
    item.listing.accountName ?? '',
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
</script>

<template>
  <SidebarPane data-pane="pinned-items" class="pinned-items-pane">
    <template #fixed>
      <div
        class="flex items-center gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full min-w-0"
      >
        <label
          v-if="currentLeague"
          class="flex items-center gap-[var(--pxd-space-xs)] min-w-0 flex-1 text-[length:var(--pxd-font-caption)] text-muted-foreground cursor-pointer"
        >
          <Checkbox v-model="showAllLeagues" data-pinned-items-show-all />
          <span class="truncate">{{ t('pinnedItem.showAllLeagues') }}</span>
        </label>
        <span v-else class="flex-1"></span>
        <span
          class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums"
          data-pinned-items-count
          >{{ t('pinnedItem.count', { count: items.length, limit }) }}</span
        >
        <Button
          variant="secondary"
          size="sm"
          class="shrink-0"
          data-pinned-items-clear
          :disabled="visibleItems.length === 0"
          :title="
            showAllLeagues || !currentLeague
              ? t('pinnedItem.clearAll')
              : t('pinnedItem.clearLeague')
          "
          @click="clearVisible"
        >
          <Trash2 />
        </Button>
      </div>
      <Separator class="mb-[var(--pxd-space-md)]" />
    </template>

    <template #scroll>
      <div
        v-if="visibleItems.length === 0"
        class="flex flex-col items-center gap-[var(--pxd-space-sm)] py-[var(--pxd-space-xl)] text-center text-muted-foreground"
        data-pinned-items-empty
      >
        <Pin class="size-6" />
        <p class="text-[length:var(--pxd-font-body)]">{{ t('pinnedItem.empty') }}</p>
        <p v-if="hiddenCount > 0" class="text-[length:var(--pxd-font-caption)]">
          {{ t('pinnedItem.hiddenByLeague', { count: hiddenCount }) }}
        </p>
      </div>

      <ul v-else ref="listRef" class="flex flex-col border border-border" data-pinned-items-list>
        <li
          v-for="item in visibleItems"
          :key="item.id"
          class="pinned-item-row group relative border-0 border-b border-dashed border-border last:border-b-0 cursor-grab active:cursor-grabbing transition-colors"
          :class="[
            isExpanded(item) ? 'bg-muted/30' : 'hover:bg-muted/40',
            { 'opacity-60': states[item.id] === 'sold' },
          ]"
          :data-pinned-item-id="item.id"
          :data-expanded="isExpanded(item) ? '' : undefined"
        >
          <div
            role="button"
            tabindex="0"
            class="flex items-center gap-[var(--pxd-space-sm)] py-[var(--pxd-bookmark-row-padding-y)] pr-[var(--pxd-space-md)] pl-[var(--pxd-space-xs)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-pinned-item-toggle
            :aria-expanded="isExpanded(item)"
            :title="expandLabel(item)"
            @click="toggleExpanded(item)"
            @keydown.enter.prevent="toggleExpanded(item)"
            @keydown.space.prevent="toggleExpanded(item)"
          >
            <GripVertical
              class="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
            <img
              v-if="typeof item.item.icon === 'string'"
              :src="item.item.icon"
              alt=""
              class="size-[var(--control-height-sm)] shrink-0 object-contain"
              referrerpolicy="no-referrer"
              draggable="false"
            />
            <div class="flex min-w-0 flex-1 flex-col">
              <span
                class="truncate text-[length:var(--pxd-font-caption)] font-semibold"
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
                class="truncate text-[length:var(--pxd-font-micro)] text-muted-foreground"
                data-pinned-item-meta
                >{{ metaParts(item).join(' · ') }}</span
              >
            </div>
            <div class="flex shrink-0 flex-col items-end">
              <span
                class="inline-flex items-center gap-[var(--pxd-space-2xs)] text-[length:var(--pxd-font-caption)] font-bold tabular-nums text-foreground"
                :class="{ 'line-through': states[item.id] === 'sold' }"
                data-pinned-item-price
              >
                {{ priceAmount(item) }}
                <img
                  v-if="item.listing.price?.icon"
                  :src="item.listing.price.icon"
                  :alt="item.listing.price.currency"
                  :title="item.listing.price.currencyName ?? item.listing.price.currency"
                  class="size-5 object-contain"
                  referrerpolicy="no-referrer"
                  draggable="false"
                  data-pinned-item-currency-icon
                />
              </span>
              <span
                v-if="states[item.id] === 'sold'"
                class="text-[length:var(--pxd-font-micro)] text-destructive"
                >{{ t('pinnedItem.sold') }}</span
              >
            </div>
          </div>

          <!-- 收合時 hover / 鍵盤聚焦才浮出的操作（與書籤列相同），蓋在價格上方 -->
          <PinnedItemActions
            v-if="!isExpanded(item)"
            class="absolute right-[var(--pxd-space-md)] top-1/2 -translate-y-1/2 z-(--pxd-z-raised) pl-[var(--pxd-space-sm)] bg-[color-mix(in_srgb,var(--muted)_40%,var(--background))] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto"
            :item="item"
            :state="states[item.id]"
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

          <div
            v-else
            class="flex flex-col gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] pb-[var(--pxd-space-sm)]"
          >
            <PinnedItemCardView :snapshot="item" :collapsed="false" />
            <PinnedItemActions
              class="flex-wrap"
              :item="item"
              :state="states[item.id]"
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
        </li>
      </ul>

      <DragTrashZone
        :ref="setTrashZoneRef"
        :visible="isDragging"
        :over-trash="isOverTrash"
        :sidebar-position="sidebarPosition"
        :style="trashStyle"
      >
        <div class="text-center text-xs font-bold leading-snug select-none">
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
