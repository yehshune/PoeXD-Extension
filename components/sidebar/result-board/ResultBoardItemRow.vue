<script setup lang="ts">
/**
 * 看板的一筆結果：與釘選相同的收合列（圖示、名稱、灰色資訊、右側標價），點開顯示與釘選相同的卡片。
 * 定位、前往藏身處、釘選都交給官方結果列（ADR-0018）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Home, Loader2, Pin, ScanSearch, Users } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { t } from '@/utils/i18n';
import { GOLD_COIN_ICON_URL } from '@/utils/poe-cdn-url';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import { convertPrice, type CurrencyRateSnapshot } from '@/utils/price-comparison';
import ResultMetaLine from '../result-row/ResultMetaLine.vue';
import type { MetaPart } from '../result-row/result-meta';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import type { BoardMark, CurrencyDisplay } from '@/utils/result-board/board-session';
import PinnedItemCardView from '../pinned-items/PinnedItemCardView.vue';
import ResultPriceLabel from '../result-row/ResultPriceLabel.vue';
import ResultSummaryRow from '../result-row/ResultSummaryRow.vue';
import {
  currencyDisplayOf,
  entryNameLines,
  formatAge,
  formatAmount,
  formatConverted,
  rarityColour,
} from './result-board-format';

const props = defineProps<{
  entry: BoardEntry;
  mark?: BoardMark;
  rates?: CurrencyRateSnapshot;
  /** 通貨代碼 → 圖示 */
  currencies: Readonly<Record<string, CurrencyDisplay>>;
  expanded: boolean;
  /** 展開時才建立的卡片快照（也可改傳 `cardSnapshot` 延後到接近視窗時才擷取） */
  snapshot?: PinnedItemSnapshot;
  /** 惰性擷取卡片快照：僅在展開且接近視窗時呼叫，避免 100 筆「全部展開」同步擷取全部官方 DOM */
  cardSnapshot?: (id: string) => PinnedItemSnapshot | undefined;
  /** 賣家清單中顯示勾選框與格位；物品清單中於展開明細顯示賣家 */
  pickable?: boolean;
  /** 命中目前詞綴條件的詞綴行（已翻譯並填入數值）；顯示在灰色資訊下方 */
  matchedMods?: readonly string[];
  /** 同一位賣家在目前結果中的可直購件數；2 件以上時在物品清單顯示「同賣家 ×N」 */
  sameSellerCount?: number;
  picked?: boolean;
  /** 是否已存在於釘選清單 */
  pinned?: boolean;
  /** 正在重新整理或前往藏身處中 */
  travelState?: 'refreshing' | 'traveling';
}>();

const emit = defineEmits<{
  toggle: [];
  locate: [];
  travel: [];
  pin: [];
  pick: [];
  focusSeller: [];
}>();

const currency = computed(() => currencyDisplayOf(props.entry.price?.currency, props.currencies));

const primaryIcon = computed(() => currencyDisplayOf(props.rates?.primary, props.currencies)?.icon);

/** 換算成主要通貨的價格（本來就是主要通貨時不顯示） */
const converted = computed(() => {
  const value = convertPrice(props.entry.price, props.rates);
  if (value === undefined || !props.rates || props.entry.price?.currency === props.rates.primary) {
    return '';
  }
  return formatConverted(value);
});

/**
 * 灰色資訊：刊登多久前 · 購買狀態。
 * 物品清單不放賣家帳號（改在展開明細）；賣家清單不放上架時間（賣家層級已顯示）與格位（改在展開明細）。
 * 需私訊／AFK／離線以顏色區分。
 */
const metaParts = computed<MetaPart[]>(() => {
  const { seller, instantBuyout } = props.entry;
  const parts: MetaPart[] = [];
  const age = props.pickable ? '' : formatAge(props.entry.indexedAt);
  if (age) parts.push({ text: age });
  if (!instantBuyout) {
    parts.push({ text: t('common.whisperOnly'), tone: 'caution' });
    if (seller.presence === 'afk') {
      parts.push({ text: t('resultBoard.presence.afk'), tone: 'caution' });
    } else if (seller.presence === 'offline') {
      parts.push({ text: t('resultBoard.presence.offline'), tone: 'danger' });
    }
  }
  return parts;
});

/** 賣家清單展開明細的格位（1-based） */
const coordsText = computed(() => {
  const { stash } = props.entry;
  return props.pickable && stash?.x !== undefined && stash?.y !== undefined
    ? t('resultBoard.stash.coords', { x: stash.x + 1, y: stash.y + 1 })
    : '';
});

/**
 * 賣家清單中可勾選卻沒勾的物品輕微淡化，讓「被排除的那幾件」一眼可見；
 * 淡化程度比已售出輕，兩者不會混在一起。
 */
const isUnpicked = computed(
  () =>
    props.mark !== 'sold' &&
    props.pickable === true &&
    props.entry.instantBuyout &&
    props.picked !== true,
);

/** 與賣家清單標題一致：角色名稱優先，和帳號不同時附上帳號 */
const sellerName = computed(() => {
  if (props.pickable) return '';
  const { character, account } = props.entry.seller;
  return character && character !== account ? `${character} (${account})` : account;
});

/** 物品清單中、未售出的可直購物品，且賣家有 2 件以上可直購時才標示「同賣家 ×N」 */
const showSameSeller = computed(
  () =>
    !props.pickable &&
    props.mark !== 'sold' &&
    props.entry.instantBuyout &&
    (props.sameSellerCount ?? 0) >= 2,
);

const matchedModText = computed(() => (props.matchedMods ?? []).join(' · '));

const toggleLabel = computed(() =>
  props.expanded ? t('resultBoard.action.collapse') : t('resultBoard.action.expand'),
);

const feeText = computed(() =>
  typeof props.entry.fee === 'number' && props.entry.fee > 0
    ? props.entry.fee.toLocaleString()
    : '',
);

/**
 * 展開大量卡片（例如 100 筆「全部展開」）時，只為視窗附近（前後 400px）的列建立
 * 巢狀 Shadow DOM 與官方樣式表，避免單次點擊同步建立數百個 shadow root 造成卡頓。
 */
const rowEl = ref<HTMLElement | null>(null);
const isNearViewport = ref(false);
let visibilityObserver: IntersectionObserver | undefined;

function stopObserving(): void {
  visibilityObserver?.disconnect();
  visibilityObserver = undefined;
}

watch(
  [() => props.expanded, rowEl],
  ([expanded, el]) => {
    stopObserving();
    if (!expanded) {
      isNearViewport.value = false;
      return;
    }
    if (isNearViewport.value) return;
    if (
      !el ||
      typeof IntersectionObserver !== 'function' ||
      el.getBoundingClientRect().height === 0
    ) {
      isNearViewport.value = true;
      return;
    }
    const scrollRoot = el.closest('[data-slot="sidebar-pane-scroll"]');
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          isNearViewport.value = true;
          stopObserving();
        }
      },
      { root: scrollRoot, rootMargin: '300px 0px' },
    );
    visibilityObserver.observe(el);
  },
  { immediate: true },
);

const resolvedSnapshot = computed(() => {
  if (!props.expanded || !isNearViewport.value) return undefined;
  return props.snapshot ?? props.cardSnapshot?.(props.entry.id);
});

onBeforeUnmount(stopObserving);
</script>

<template>
  <li
    ref="rowEl"
    class="group relative border-0 border-b border-dashed border-border last:border-b-0 transition-colors"
    :class="expanded ? 'bg-muted/20' : 'hover:bg-muted/40 has-[[data-state=open]]:bg-muted/40'"
    :data-board-entry-id="entry.id"
    :data-board-mark="mark"
  >
    <ResultSummaryRow
      :icon="entry.icon"
      :dimmed="mark === 'sold'"
      :class="isUnpicked ? 'opacity-80' : ''"
      :data-board-entry-unpicked="isUnpicked ? '' : undefined"
      :expanded="expanded"
      :title="toggleLabel"
      data-board-entry-toggle
      @toggle="emit('toggle')"
    >
      <template v-if="pickable" #leading>
        <span class="flex shrink-0" @click.stop @keydown.stop>
          <Checkbox
            :model-value="picked"
            class="pxd-pick-checkbox"
            :disabled="!entry.instantBuyout || mark === 'sold'"
            :aria-label="t('resultBoard.seller.pick')"
            data-board-pick
            @update:model-value="emit('pick')"
          />
        </span>
      </template>
      <template #expanded-icon>
        <PinnedItemCardView
          v-if="resolvedSnapshot"
          :snapshot="resolvedSnapshot"
          :collapsed="false"
          part="icon"
        />
        <img
          v-else-if="entry.icon"
          :src="entry.icon"
          alt=""
          class="max-h-[68px] max-w-[68px] object-contain"
          referrerpolicy="no-referrer"
          draggable="false"
        />
      </template>
      <template #title>
        <span
          class="text-[length:var(--pxd-font-body)] font-semibold leading-tight"
          :class="expanded ? 'line-clamp-2 break-words' : 'truncate'"
          :style="{ color: rarityColour(entry) }"
          data-board-entry-name
        >
          <span
            v-for="(line, index) in entryNameLines(entry)"
            :key="index"
            class="item-popup__header-line"
            :class="{ 'ml-[0.35em]': index > 0 }"
            >{{ line }}</span
          >
        </span>
      </template>
      <template #meta>
        <div
          v-if="metaParts.length > 0 || showSameSeller"
          class="flex min-w-0 items-center gap-[var(--pxd-space-xs)]"
        >
          <ResultMetaLine
            v-if="metaParts.length > 0"
            :parts="metaParts"
            :expanded="expanded"
            class="min-w-0"
            data-board-entry-meta
          />
          <span
            v-if="showSameSeller"
            class="shrink-0 rounded-sm border border-border px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] leading-tight text-muted-foreground tabular-nums"
            :title="t('resultBoard.sameSellerTitle', { count: sameSellerCount ?? 0 })"
            data-board-same-seller
          >
            {{ t('resultBoard.sameSeller', { count: sameSellerCount ?? 0 }) }}
          </span>
        </div>
        <span
          v-if="matchedModText"
          class="text-[length:var(--pxd-font-micro)] font-medium leading-tight text-primary"
          :class="expanded ? 'line-clamp-3 break-words' : 'truncate'"
          :title="matchedModText"
          data-board-entry-matched-mods
          >{{ matchedModText }}</span
        >
      </template>
      <template #expanded-details>
        <div
          v-if="feeText || sellerName || coordsText"
          class="flex flex-col gap-[2px] text-[length:var(--pxd-font-micro)] leading-snug text-muted-foreground"
        >
          <span v-if="coordsText" class="tabular-nums" data-board-entry-coords>{{
            coordsText
          }}</span>
          <span v-if="sellerName" class="truncate" data-board-entry-seller>{{
            t('common.sellerLabel', { name: sellerName })
          }}</span>
          <span
            v-if="feeText"
            data-board-entry-fee
            :title="`${t('pinnedItem.meta.fee')}${feeText}`"
            class="inline-flex items-center gap-[3px] leading-none tabular-nums text-foreground/85"
          >
            <span class="leading-none">{{ t('pinnedItem.meta.fee') }}</span>
            <img
              :src="GOLD_COIN_ICON_URL"
              alt="Gold"
              class="block size-[var(--control-icon-sm)] shrink-0 object-contain"
              referrerpolicy="no-referrer"
              draggable="false"
            />
            <span class="leading-none">{{ feeText }}</span>
          </span>
        </div>
      </template>
      <template #price>
        <ResultPriceLabel
          :amount="entry.price ? formatAmount(entry.price.amount) : t('common.noPrice')"
          :currency="entry.price?.currency"
          :icon="currency?.icon"
          :currency-name="currency?.name"
          :struck="mark === 'sold'"
          data-board-entry-price
        />
        <span
          v-if="converted"
          class="inline-flex items-center gap-[3px] text-[length:var(--pxd-font-micro)] font-medium tabular-nums leading-none text-muted-foreground"
          data-board-entry-converted
        >
          ≈ {{ converted }}
          <img
            v-if="primaryIcon"
            :src="primaryIcon"
            :alt="rates?.primary"
            class="size-[var(--control-icon-default)] object-contain"
            referrerpolicy="no-referrer"
            draggable="false"
          />
          <template v-else>{{ rates?.primary }}</template>
        </span>
        <span
          v-if="travelState"
          class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)]"
          :class="travelState === 'refreshing' ? 'text-muted-foreground' : 'text-primary'"
          data-board-entry-busy
        >
          <Loader2 class="size-[var(--control-icon-sm)] shrink-0 animate-spin" aria-hidden="true" />
          {{
            travelState === 'refreshing'
              ? t('pinnedItem.action.refreshing')
              : t('pinnedItem.action.traveling')
          }}
        </span>
        <span
          v-else-if="mark"
          class="rounded-sm border px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-micro)] font-semibold leading-tight"
          :class="
            mark === 'sold'
              ? 'border-destructive/30 bg-destructive/15 text-destructive'
              : 'border-primary/30 bg-primary/10 text-primary'
          "
          data-board-entry-mark
          >{{ mark === 'sold' ? t('common.sold') : t('resultBoard.mark.visited') }}</span
        >
      </template>
      <template #actions>
        <div class="flex items-center gap-[var(--pxd-space-xs)]">
          <Button
            v-if="showSameSeller"
            variant="ghost"
            size="icon-sm"
            :title="t('resultBoard.action.focusSeller')"
            :aria-label="t('resultBoard.action.focusSeller')"
            data-board-focus-seller
            @click.stop="emit('focusSeller')"
          >
            <Users />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('resultBoard.action.locate')"
            :aria-label="t('resultBoard.action.locate')"
            data-board-locate
            @click.stop="emit('locate')"
          >
            <ScanSearch />
          </Button>
          <Button
            v-if="entry.instantBuyout"
            variant="ghost"
            size="icon-sm"
            :disabled="mark === 'sold' || Boolean(travelState)"
            :title="t('common.travelToHideout')"
            :aria-label="t('common.travelToHideout')"
            data-board-travel
            @click.stop="emit('travel')"
          >
            <Loader2 v-if="travelState" class="animate-spin" />
            <Home v-else />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :class="pinned ? 'text-primary hover:text-primary' : ''"
            :aria-pressed="pinned === true"
            :data-board-pinned="pinned ? '' : undefined"
            :title="pinned ? t('common.unpin') : t('resultBoard.action.pin')"
            :aria-label="pinned ? t('common.unpin') : t('resultBoard.action.pin')"
            data-board-pin
            @click.stop="emit('pin')"
          >
            <Pin :class="pinned ? 'fill-current' : ''" />
          </Button>
        </div>
      </template>
    </ResultSummaryRow>
    <div v-if="expanded" class="px-[var(--pxd-space-md)] pb-[var(--pxd-space-md)]">
      <div
        v-if="!isNearViewport"
        class="min-h-[140px] rounded-sm border border-border/50 bg-black/40"
        aria-hidden="true"
      />
      <PinnedItemCardView
        v-else-if="resolvedSnapshot"
        :snapshot="resolvedSnapshot"
        :collapsed="false"
        part="popup"
        data-board-entry-card
      />
      <p
        v-else
        class="m-0 text-[length:var(--pxd-font-micro)] text-muted-foreground"
        data-board-entry-card-missing
      >
        {{ t('resultBoard.cardUnavailable') }}
      </p>
    </div>
  </li>
</template>
