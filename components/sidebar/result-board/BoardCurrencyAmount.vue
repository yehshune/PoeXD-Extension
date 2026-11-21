<script setup lang="ts">
/** 行內金額＋通貨圖示（無圖示時回退顯示通貨代碼），供看板摘要與賣家總價／區間共用 */
import { computed } from 'vue';
import type { CurrencyDisplay } from '@/utils/result-board/board-session';
import { currencyDisplayOf, formatAmount } from './result-board-format';

const props = defineProps<{
  amount: number;
  currency?: string;
  currencies: Readonly<Record<string, CurrencyDisplay>>;
}>();

const display = computed(() => currencyDisplayOf(props.currency, props.currencies));
</script>

<template>
  <span class="inline-flex items-center gap-[3px] tabular-nums">
    <span>{{ formatAmount(amount) }}</span>
    <img
      v-if="display?.icon"
      :src="display.icon"
      :alt="currency"
      :title="display.name ?? currency"
      class="size-[var(--control-icon-sm)] shrink-0 object-contain"
      referrerpolicy="no-referrer"
      draggable="false"
      data-board-currency-icon
    />
    <span v-else-if="currency">{{ currency }}</span>
  </span>
</template>
