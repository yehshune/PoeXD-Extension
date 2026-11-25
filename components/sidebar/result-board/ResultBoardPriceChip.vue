<script setup lang="ts">
/** 價格區間生效時顯示在工具列下方的標籤（例如「價格 0.3–1」），按 ✕ 清除。 */
import { X } from '@lucide/vue';
import { t } from '@/utils/i18n';
import type { CurrencyDisplay } from '@/utils/result-board/board-session';

defineProps<{
  /** `0.3–1`、`0.3–`、`–1` */
  range: string;
  currency?: CurrencyDisplay;
  currencyCode?: string;
}>();

const emit = defineEmits<{ clear: [] }>();
</script>

<template>
  <span
    class="inline-flex h-[22px] items-center gap-[2px] rounded-full border border-primary/40 bg-primary/10 pl-[var(--pxd-space-sm)] pr-[2px] text-[length:var(--pxd-font-caption)] text-primary tabular-nums"
    data-board-price-chip
  >
    {{ t('common.filterTag.price', { range }) }}
    <img
      v-if="currency?.icon"
      :src="currency.icon"
      :alt="currencyCode"
      class="size-[var(--control-icon-sm)] shrink-0 object-contain"
      referrerpolicy="no-referrer"
      draggable="false"
    />
    <button
      type="button"
      class="flex size-[18px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-primary hover:bg-primary/15"
      :aria-label="t('resultBoard.filter.clearPrice')"
      :title="t('resultBoard.filter.clearPrice')"
      data-board-price-chip-clear
      @click="emit('clear')"
    >
      <X class="size-[var(--control-icon-sm)]" />
    </button>
  </span>
</template>
