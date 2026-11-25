<script setup lang="ts">
/**
 * 看板物品清單的價格區間：工具列上的按鈕開啟彈出面板輸入最低／最高價（以主要通貨計）。
 * 有設定時按鈕高亮（看板另在工具列下方顯示可一鍵清除的標籤），平常不佔清單上方的高度。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { Coins, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t } from '@/utils/i18n';
import type { CurrencyDisplay } from '@/utils/result-board/board-session';
import { parseBound } from './useResultBoard';

const props = defineProps<{
  min: string;
  max: string;
  /** 主要通貨（顯示在輸入框旁） */
  currency?: CurrencyDisplay;
  currencyCode?: string;
}>();

const emit = defineEmits<{
  'update:min': [value: string];
  'update:max': [value: string];
}>();

const open = ref(false);
const minInputRef = ref<InstanceType<typeof Input> | null>(null);

const isActive = computed(
  () => parseBound(props.min) !== undefined || parseBound(props.max) !== undefined,
);

function clear(): void {
  emit('update:min', '');
  emit('update:max', '');
}

watch(open, async (isOpen) => {
  if (!isOpen) return;
  await nextTick();
  (minInputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
});
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        :variant="isActive || open ? 'default' : 'outline'"
        size="icon-sm"
        class="shrink-0"
        :aria-expanded="open"
        :title="t('resultBoard.filter.priceRange')"
        :aria-label="t('resultBoard.filter.priceRange')"
        data-board-price-toggle
      >
        <Coins />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="6"
      :collision-padding="8"
      class="flex w-auto flex-col gap-[var(--pxd-space-sm)] p-[var(--pxd-space-md)] text-[length:var(--pxd-font-caption)]"
      data-board-price-popover
      @keydown.enter.prevent="open = false"
    >
      <span class="font-medium text-foreground">{{ t('resultBoard.filter.priceRange') }}</span>
      <div class="flex items-center gap-[var(--pxd-space-xs)]">
        <Input
          ref="minInputRef"
          :model-value="min"
          size="sm"
          inputmode="decimal"
          class="w-[5.2em] tabular-nums"
          :placeholder="t('resultBoard.filter.priceMin')"
          data-board-price-min
          @update:model-value="emit('update:min', String($event))"
        />
        <span class="text-muted-foreground">–</span>
        <Input
          :model-value="max"
          size="sm"
          inputmode="decimal"
          class="w-[5.2em] tabular-nums"
          :placeholder="t('resultBoard.filter.priceMax')"
          data-board-price-max
          @update:model-value="emit('update:max', String($event))"
        />
        <img
          v-if="currency?.icon"
          :src="currency.icon"
          :alt="currencyCode"
          :title="currency.name ?? currencyCode"
          class="size-[var(--control-icon-default)] shrink-0 object-contain"
          referrerpolicy="no-referrer"
          draggable="false"
        />
        <span v-else class="text-[length:var(--pxd-font-micro)] text-muted-foreground">{{
          currencyCode
        }}</span>
        <Button
          v-if="isActive || min || max"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('resultBoard.filter.clearPrice')"
          :title="t('resultBoard.filter.clearPrice')"
          data-board-price-clear
          @click="clear"
        >
          <X />
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
