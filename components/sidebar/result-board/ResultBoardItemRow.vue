<script setup lang="ts">
/**
 * 看板的一筆結果：緊湊列（圖示、名稱、賣家與上架時間、價格），點開顯示與釘選相同的卡片。
 * 定位、前往藏身處、釘選都交給官方結果列（ADR-0018）。
 */
import { computed } from 'vue';
import { ChevronDown, ChevronUp, Crosshair, DoorOpen, Pin } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import { convertPrice } from '@/utils/result-board/board-price';
import type { BoardMark } from '@/utils/result-board/board-session';
import PinnedItemCardView from '../pinned-items/PinnedItemCardView.vue';
import {
  entryTitle,
  formatAge,
  formatAmount,
  formatPrice,
  rarityColour,
} from './result-board-format';

const props = defineProps<{
  entry: BoardEntry;
  mark?: BoardMark;
  rates?: CurrencyRateSnapshot;
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

const converted = computed(() => {
  const value = convertPrice(props.entry.price, props.rates);
  if (value === undefined || !props.rates || props.entry.price?.currency === props.rates.primary) {
    return '';
  }
  return `≈ ${formatAmount(value)} ${props.rates.primary}`;
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
</script>

<template>
  <li
    class="group relative border-0 border-b border-dashed border-border last:border-b-0"
    :class="expanded ? 'bg-muted/20' : 'hover:bg-muted/40'"
    :data-board-entry-id="entry.id"
    :data-board-mark="mark"
  >
    <div
      class="flex items-center gap-[var(--pxd-space-md)] px-[var(--pxd-space-md)] py-[var(--pxd-space-md)]"
      :class="mark === 'sold' ? 'opacity-60' : ''"
    >
      <Checkbox
        v-if="pickable"
        :model-value="picked"
        :disabled="!entry.instantBuyout"
        class="shrink-0"
        :aria-label="t('resultBoard.seller.pick')"
        data-board-pick
        @update:model-value="emit('pick')"
      />
      <img
        v-if="entry.icon"
        :src="entry.icon"
        alt=""
        class="size-[var(--control-height-md)] shrink-0 object-contain"
        referrerpolicy="no-referrer"
        draggable="false"
      />
      <button
        type="button"
        class="flex min-w-0 flex-1 flex-col items-start gap-[2px] border-0 bg-transparent p-0 text-left outline-none cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
        :aria-expanded="expanded"
        :title="expanded ? t('resultBoard.action.collapse') : t('resultBoard.action.expand')"
        data-board-entry-toggle
        @click="emit('toggle')"
      >
        <span
          class="w-full truncate text-[length:var(--pxd-font-body)] font-semibold leading-tight"
          :style="{ color: rarityColour(entry) }"
          >{{ entryTitle(entry) }}</span
        >
        <span
          v-if="meta"
          class="w-full truncate text-[length:var(--pxd-font-micro)] text-muted-foreground leading-tight"
          >{{ meta }}</span
        >
      </button>
      <div class="flex shrink-0 flex-col items-end gap-[2px] group-hover:hidden">
        <span
          class="text-[length:var(--pxd-font-body)] font-bold tabular-nums leading-none"
          :class="{ 'line-through': mark === 'sold' }"
          data-board-entry-price
          >{{ formatPrice(entry.price) }}</span
        >
        <span
          v-if="converted"
          class="text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
          >{{ converted }}</span
        >
        <span
          v-if="mark"
          class="rounded-sm px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] font-semibold leading-tight"
          :class="
            mark === 'sold'
              ? 'border border-destructive/30 bg-destructive/15 text-destructive'
              : 'border border-primary/30 bg-primary/10 text-primary'
          "
          data-board-entry-mark
          >{{ mark === 'sold' ? t('resultBoard.mark.sold') : t('resultBoard.mark.visited') }}</span
        >
      </div>
      <div class="hidden shrink-0 items-center gap-[var(--pxd-space-xs)] group-hover:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          :title="t('resultBoard.action.locate')"
          :aria-label="t('resultBoard.action.locate')"
          data-board-locate
          @click="emit('locate')"
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
          @click="emit('travel')"
        >
          <DoorOpen />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :title="t('resultBoard.action.pin')"
          :aria-label="t('resultBoard.action.pin')"
          data-board-pin
          @click="emit('pin')"
        >
          <Pin />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :title="expanded ? t('resultBoard.action.collapse') : t('resultBoard.action.expand')"
          :aria-label="expanded ? t('resultBoard.action.collapse') : t('resultBoard.action.expand')"
          @click="emit('toggle')"
        >
          <ChevronUp v-if="expanded" />
          <ChevronDown v-else />
        </Button>
      </div>
    </div>
    <div v-if="expanded" class="px-[var(--pxd-space-md)] pb-[var(--pxd-space-md)]">
      <PinnedItemCardView
        v-if="snapshot"
        :snapshot="snapshot"
        :collapsed="false"
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
