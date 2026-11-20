<script setup lang="ts">
/**
 * 結果列右側的標價（釘選與看板共用）：數量加通貨圖示；沒有圖示時改顯示通貨代碼。
 * 傳入的屬性（例如 data-*）放在外層。
 */
import { computed } from 'vue';

const props = defineProps<{
  /** 已格式化的數量；沒有標價時為呼叫端給的「無標價」文字 */
  amount: string;
  currency?: string;
  /** 通貨圖示（需已驗證為 PoE CDN 網址） */
  icon?: string;
  currencyName?: string;
  /** 已售出時加刪除線 */
  struck?: boolean;
}>();

const text = computed(() =>
  props.icon || !props.currency ? props.amount : `${props.amount} ${props.currency}`,
);
</script>

<template>
  <span
    class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-section-title)] font-bold tabular-nums leading-none text-foreground"
    :class="{ 'line-through': struck }"
  >
    {{ text }}
    <img
      v-if="icon"
      :src="icon"
      :alt="currency"
      :title="currencyName ?? currency"
      class="size-[var(--control-icon-lg)] object-contain"
      referrerpolicy="no-referrer"
      draggable="false"
      data-result-price-icon
    />
  </span>
</template>
