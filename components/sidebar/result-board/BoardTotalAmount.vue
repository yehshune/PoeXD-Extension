<script setup lang="ts">
/** 以通貨圖示呈現 `PriceTotal`（換算總價或分幣種加總） */
import { t } from '@/utils/i18n';
import type { PriceTotal } from '@/utils/result-board/board-price';
import type { CurrencyDisplay } from '@/utils/result-board/board-session';
import BoardCurrencyAmount from './BoardCurrencyAmount.vue';

defineProps<{
  total: PriceTotal;
  currencies: Readonly<Record<string, CurrencyDisplay>>;
}>();
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-[3px] tabular-nums">
    <template v-if="total.kind === 'converted'">
      <BoardCurrencyAmount
        :amount="total.amount"
        :currency="total.currency"
        :currencies="currencies"
      />
      <span v-if="total.unconverted > 0">{{
        t('resultBoard.total.unconverted', { count: total.unconverted })
      }}</span>
    </template>
    <template v-else-if="total.totals.length === 0">
      <span>{{ t('common.noPrice') }}</span>
    </template>
    <template v-else>
      <template v-for="(item, index) in total.totals" :key="item.currency">
        <span v-if="index > 0">+</span>
        <BoardCurrencyAmount
          :amount="item.amount"
          :currency="item.currency"
          :currencies="currencies"
        />
      </template>
    </template>
  </span>
</template>
