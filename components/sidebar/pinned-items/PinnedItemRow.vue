<script setup lang="ts">
/**
 * 釘選清單的一筆物品：收合時是一行精簡列（圖示、名稱、灰色資訊、價格），
 * 展開後在下方顯示明細（賣家、手續費、釘選時間）與官方卡片快照。
 * 外層的 `<li>` 帶 `data-pinned-item-id`，供拖曳排序與拖到垃圾桶取消釘選辨識。
 */
import { computed } from 'vue';
import { Loader2 } from '@lucide/vue';
import { getActiveUiLocale, t } from '@/utils/i18n';
import { GOLD_COIN_ICON_URL } from '@/utils/poe-cdn-url';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import ResultMetaLine from '../result-row/ResultMetaLine.vue';
import ResultPriceLabel from '../result-row/ResultPriceLabel.vue';
import ResultSummaryRow from '../result-row/ResultSummaryRow.vue';
import type { MetaPart } from '../result-row/result-meta';
import PinnedItemActions from './PinnedItemActions.vue';
import PinnedItemCardView from './PinnedItemCardView.vue';
import { RARITY_COLOURS, resolveRarityClass } from './pinned-item-card';
import type { PinnedPriceComparison } from './pinned-item-sort';
import type { PinnedItemTransientState } from './usePinnedItems';

const props = defineProps<{
  item: PinnedItemSnapshot;
  expanded: boolean;
  draggable: boolean;
  sold: boolean;
  state?: PinnedItemTransientState;
  sameRealm: boolean;
  canCopyPob: boolean;
  hasSource: boolean;
  /** 聯盟與目前不同（或顯示所有聯盟）時附在灰色資訊 */
  showLeague: boolean;
  /** 伺服器與目前不同時附在灰色資訊 */
  realmLabel?: string;
  priceComparison?: PinnedPriceComparison;
}>();

const emit = defineEmits<{
  toggle: [];
  travel: [];
  whisper: [];
  pob: [];
  source: [];
  unpin: [];
}>();

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

const rarityColour = computed(
  () => RARITY_COLOURS[resolveRarityClass(props.item.item)] ?? RARITY_COLOURS.normal!,
);

/** 名稱與基底；PoE 2 的 `[標籤|文字]` 標記只顯示文字 */
const nameLines = computed(() => {
  const unwrap = (value: string) => value.replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');
  const name = unwrap(textOf(props.item.item.name));
  const typeLine = unwrap(textOf(props.item.item.typeLine) || textOf(props.item.item.baseType));
  return [name, typeLine].filter(Boolean);
});

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

/**
 * 灰色資訊：刊登多久前 · 聯盟／伺服器（與目前不同時）· 需私訊。
 * 賣家帳號不放外層，改在展開明細顯示。
 */
const metaParts = computed<MetaPart[]>(() => {
  const parts: MetaPart[] = [];
  const age = formatAge(props.item.listing.indexed);
  if (age) parts.push({ text: age });
  if (props.showLeague && props.item.league) parts.push({ text: props.item.league });
  if (props.realmLabel) parts.push({ text: props.realmLabel });
  if (!props.sold && !props.item.listing.instantBuyout) {
    parts.push({ text: t('common.whisperOnly'), tone: 'caution' });
  }
  return parts;
});

const feeText = computed(() => {
  const fee = props.item.listing.fee;
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee <= 0) return '';
  return new Intl.NumberFormat(getActiveUiLocale()).format(fee);
});

const pinnedAtText = computed(() => {
  const timestamp = props.item.pinnedAt;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const d = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

const sellerName = computed(() => props.item.listing.accountName ?? '');

const toggleLabel = computed(() =>
  props.expanded ? t('pinnedItem.action.collapse') : t('pinnedItem.action.expand'),
);

const actionState = computed<PinnedItemTransientState | undefined>(() =>
  props.sold ? 'sold' : props.state,
);
</script>

<template>
  <li
    class="pinned-item-row group relative border-0 border-b border-dashed border-border last:border-b-0 transition-colors"
    :class="[expanded ? 'bg-muted/20' : 'hover:bg-muted/40 has-[[data-state=open]]:bg-muted/40']"
    :data-pinned-item-id="item.id"
    :data-expanded="expanded ? '' : undefined"
    :data-pinned-item-sold="sold ? '' : undefined"
  >
    <ResultSummaryRow
      :icon="typeof item.item.icon === 'string' ? item.item.icon : undefined"
      :dimmed="sold"
      :draggable="draggable"
      :expanded="expanded"
      data-pinned-item-toggle
      :title="toggleLabel"
      @toggle="emit('toggle')"
    >
      <template #expanded-icon>
        <PinnedItemCardView :snapshot="item" :collapsed="false" part="icon" />
      </template>
      <template #title>
        <span
          class="text-[length:var(--pxd-font-body)] font-semibold leading-tight"
          :class="expanded ? 'line-clamp-2 break-words' : 'truncate'"
          :style="{ color: rarityColour }"
          data-pinned-item-name
        >
          <span
            v-for="(line, index) in nameLines"
            :key="index"
            class="item-popup__header-line"
            :class="{ 'ml-[0.35em]': index > 0 }"
            >{{ line }}</span
          >
        </span>
      </template>
      <template #meta>
        <ResultMetaLine
          v-if="metaParts.length > 0"
          :parts="metaParts"
          :expanded="expanded"
          data-pinned-item-meta
        />
      </template>
      <template #expanded-details>
        <div
          v-if="sellerName || feeText || pinnedAtText"
          data-pinned-item-details
          class="flex flex-col gap-[2px] text-[length:var(--pxd-font-micro)] leading-snug text-muted-foreground"
        >
          <span v-if="sellerName" class="truncate" data-pinned-item-seller>{{
            t('common.sellerLabel', { name: sellerName })
          }}</span>
          <span
            v-if="feeText"
            data-pinned-item-fee
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
              data-pinned-item-fee-icon
            />
            <span class="leading-none">{{ feeText }}</span>
          </span>
          <span v-if="pinnedAtText" data-pinned-item-pinned-at class="truncate tabular-nums">
            {{ t('pinnedItem.meta.pinnedAt', { time: pinnedAtText }) }}
          </span>
        </div>
      </template>
      <template #price>
        <ResultPriceLabel
          :amount="item.listing.price ? `${item.listing.price.amount}` : t('common.noPrice')"
          :currency="item.listing.price?.currency"
          :icon="item.listing.price?.icon"
          :currency-name="item.listing.price?.currencyName"
          :struck="sold"
          data-pinned-item-price
        />
        <span
          v-if="priceComparison && !sold"
          data-pinned-item-price-conversion
          :title="priceComparison.tooltip"
          class="inline-flex items-center gap-[3px] text-[length:var(--pxd-font-micro)] font-medium tabular-nums leading-none text-muted-foreground"
        >
          <span class="leading-none">≈ {{ priceComparison.amount }}</span>
          <img
            :src="priceComparison.icon"
            :alt="priceComparison.currencyName"
            :title="priceComparison.currencyName"
            class="block size-[var(--control-icon-default)] shrink-0 object-contain"
            referrerpolicy="no-referrer"
            draggable="false"
            data-pinned-item-price-conversion-icon
          />
        </span>
        <span
          v-if="!sold && (state === 'refreshing' || state === 'traveling')"
          class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)]"
          :class="state === 'refreshing' ? 'text-muted-foreground' : 'text-primary'"
          data-pinned-item-busy
        >
          <Loader2 class="size-[var(--control-icon-sm)] shrink-0 animate-spin" aria-hidden="true" />
          {{
            state === 'refreshing'
              ? t('pinnedItem.action.refreshing')
              : t('pinnedItem.action.traveling')
          }}
        </span>
      </template>
      <template #actions>
        <PinnedItemActions
          :item="item"
          :state="actionState"
          :same-realm="sameRealm"
          :can-copy-pob="canCopyPob"
          :has-source="hasSource"
          :full="false"
          @travel="emit('travel')"
          @whisper="emit('whisper')"
          @pob="emit('pob')"
          @source="emit('source')"
          @unpin="emit('unpin')"
        />
      </template>
    </ResultSummaryRow>
    <div v-if="expanded" class="px-[var(--pxd-space-md)] pb-[var(--pxd-space-md)]">
      <PinnedItemCardView :snapshot="item" :collapsed="false" part="popup" />
    </div>
  </li>
</template>
