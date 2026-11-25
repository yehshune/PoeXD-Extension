<script setup lang="ts">
/**
 * 賣家清單的「至少可直購 N 件」門檻：工具列上顯示目前值的小按鈕（例如「≥ 2 件」），
 * 點開彈出面板再調整，不再獨佔工具列下方一整行。
 */
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t } from '@/utils/i18n';
import ResultBoardMinCountStepper from './ResultBoardMinCountStepper.vue';
import { DEFAULT_MIN_SELLER_COUNT } from './useResultBoard';

const model = defineModel<number>({ required: true });
const open = ref(false);
/** 門檻改過預設值時強調按鈕，收進彈出面板後仍看得出篩選正在生效 */
const isCustomized = computed(() => model.value !== DEFAULT_MIN_SELLER_COUNT);
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        :variant="open ? 'default' : 'outline'"
        :class="!open && isCustomized ? 'border-primary/40 bg-primary/10 text-primary' : ''"
        size="sm"
        class="h-[var(--control-height-sm)] shrink-0 px-[var(--pxd-space-sm)] tabular-nums"
        :aria-expanded="open"
        :title="t('resultBoard.filter.minCount')"
        data-board-min-count-toggle
      >
        {{ t('resultBoard.filter.minCountShort', { count: model }) }}
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="6"
      :collision-padding="8"
      class="w-auto p-[var(--pxd-space-md)]"
      data-board-min-count-popover
    >
      <ResultBoardMinCountStepper v-model="model" />
    </PopoverContent>
  </Popover>
</template>
