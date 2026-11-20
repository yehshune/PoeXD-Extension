<script setup lang="ts">
/**
 * 看板的一筆結果：與釘選相同的收合列（圖示、名稱、灰色資訊、右側標價），點開顯示與釘選相同的卡片。
 * 定位、前往藏身處、釘選都交給官方結果列（ADR-0018）。
 */
import { computed } from 'vue';
import { Crosshair, DoorOpen, Pin } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import { convertPrice } from '@/utils/result-board/board-price';
import type { BoardMark, CurrencyDisplay } from '@/utils/result-board/board-session';
import PinnedItemCardView from '../pinned-items/PinnedItemCardView.vue';
import ResultPriceLabel from '../result-row/ResultPriceLabel.vue';
import ResultSummaryRow from '../result-row/ResultSummaryRow.vue';
import {
  currencyDisplayOf,
  entryNameLines,
  formatAge,
  formatAmount,
  rarityColour,
} from './result-board-format';

const props = defineProps<{
  entry: BoardEntry;
  mark?: BoardMark;
  rates?: CurrencyRateSnapshot;
  /** 通貨代碼 → 圖示 */
  currencies: Readonly<Record<string, CurrencyDisplay>>;
  expanded: boolean;
  /** 展開時才建立的卡片快照 */
  snapshot?: PinnedItemSnapshot;
  /** 賣家清單中顯示勾選框；物品清單中顯示賣家 */
  pickable?: boolean;
  picked?: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  locate: [];
  travel: [];
  pin: [];
  pick: [];
}>();

const currency = computed(() => currencyDisplayOf(props.entry.price?.currency, props.currencies));

const primaryIcon = computed(() => currencyDisplayOf(props.rates?.primary, props.currencies)?.icon);

/** 換算成主要通貨的價格（本來就是主要通貨時不顯示） */
const converted = computed(() => {
  const value = convertPrice(props.entry.price, props.rates);
  if (value === undefined || !props.rates || props.entry.price?.currency === props.rates.primary) {
    return '';
  }
  return formatAmount(value);
});

const meta = computed(() => {
  const { seller } = props.entry;
  const parts = [
    props.pickable ? '' : (seller.character ?? seller.account),
    formatAge(props.entry.indexedAt),
    props.entry.instantBuyout ? '' : t('resultBoard.whisperOnly'),
    !props.entry.instantBuyout && seller.presence === 'afk' ? t('resultBoard.presence.afk') : '',
    !props.entry.instantBuyout && seller.presence === 'offline'
      ? t('resultBoard.presence.offline')
      : '',
  ];
  return parts.filter(Boolean).join(' · ');
});

const toggleLabel = computed(() =>
  props.expanded ? t('resultBoard.action.collapse') : t('resultBoard.action.expand'),
);
</script>

<template>
  <li
    class="group relative border-0 border-b border-dashed border-border last:border-b-0 transition-colors"
    :class="expanded ? 'bg-muted/20' : 'hover:bg-muted/40 has-[[data-state=open]]:bg-muted/40'"
    :data-board-entry-id="entry.id"
    :data-board-mark="mark"
  >
    <ResultSummaryRow
      :icon="entry.icon"
      :dimmed="mark === 'sold'"
      :expanded="expanded"
      :title="toggleLabel"
      data-board-entry-toggle
      @toggle="emit('toggle')"
    >
      <template v-if="pickable" #leading>
        <span class="flex shrink-0" @click.stop @keydown.stop>
          <Checkbox
            :model-value="picked"
            :disabled="!entry.instantBuyout"
            :aria-label="t('resultBoard.seller.pick')"
            data-board-pick
            @update:model-value="emit('pick')"
          />
        </span>
      </template>
      <template #expanded-icon>
        <PinnedItemCardView v-if="snapshot" :snapshot="snapshot" :collapsed="false" part="icon" />
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
        <span
          v-if="meta"
          class="text-[length:var(--pxd-font-micro)] text-muted-foreground leading-tight"
          :class="expanded ? 'line-clamp-2 break-words' : 'truncate'"
          data-board-entry-meta
          >{{ meta }}</span
        >
      </template>
      <template #price>
        <ResultPriceLabel
          :amount="entry.price ? formatAmount(entry.price.amount) : t('resultBoard.noPrice')"
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
          v-if="mark"
          class="rounded-sm border px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-micro)] font-semibold leading-tight"
          :class="
            mark === 'sold'
              ? 'border-destructive/30 bg-destructive/15 text-destructive'
              : 'border-primary/30 bg-primary/10 text-primary'
          "
          data-board-entry-mark
          >{{ mark === 'sold' ? t('resultBoard.mark.sold') : t('resultBoard.mark.visited') }}</span
        >
      </template>
      <template #actions>
        <div class="flex items-center gap-[var(--pxd-space-xs)]">
          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('resultBoard.action.locate')"
            :aria-label="t('resultBoard.action.locate')"
            data-board-locate
            @click.stop="emit('locate')"
          >
            <Crosshair />
          </Button>
          <Button
            v-if="entry.instantBuyout"
            variant="ghost"
            size="icon-sm"
            :disabled="mark === 'sold'"
            :title="t('resultBoard.action.travel')"
            :aria-label="t('resultBoard.action.travel')"
            data-board-travel
            @click.stop="emit('travel')"
          >
            <DoorOpen />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('resultBoard.action.pin')"
            :aria-label="t('resultBoard.action.pin')"
            data-board-pin
            @click.stop="emit('pin')"
          >
            <Pin />
          </Button>
        </div>
      </template>
    </ResultSummaryRow>
    <div v-if="expanded" class="px-[var(--pxd-space-md)] pb-[var(--pxd-space-md)]">
      <PinnedItemCardView
        v-if="snapshot"
        :snapshot="snapshot"
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
