<script setup lang="ts">
/** 賣家清單的「至少可直購 N 件」門檻：減、輸入、加，上下鍵也能調整；不接受負數與非數字。 */
import { Minus, Plus } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/utils/i18n';

const model = defineModel<number>({ required: true });

function setCount(value: string | number): void {
  const parsed = Math.floor(Number(value));
  model.value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
</script>

<template>
  <div class="flex items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)]">
    <span>{{ t('resultBoard.filter.minCount') }}</span>
    <div
      class="inline-flex h-[var(--control-height-sm)] items-center overflow-hidden rounded-md border border-input bg-background"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        class="h-full w-[calc(var(--control-height-sm)-4px)] rounded-none border-r border-border/60 text-muted-foreground hover:text-foreground"
        :disabled="model <= 0"
        :aria-label="t('resultBoard.filter.decreaseMinCount')"
        data-board-min-count-dec
        @click="setCount(model - 1)"
      >
        <Minus />
      </Button>
      <Input
        :model-value="String(model)"
        size="sm"
        type="text"
        inputmode="numeric"
        class="h-full w-[2.8em] rounded-none border-0 bg-transparent px-[var(--pxd-space-xs)] text-center tabular-nums shadow-none focus-visible:ring-0"
        :aria-label="t('resultBoard.filter.minCount')"
        data-board-min-count
        @update:model-value="setCount"
        @keydown.up.prevent="setCount(model + 1)"
        @keydown.down.prevent="setCount(model - 1)"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        class="h-full w-[calc(var(--control-height-sm)-4px)] rounded-none border-l border-border/60 text-muted-foreground hover:text-foreground"
        :aria-label="t('resultBoard.filter.increaseMinCount')"
        data-board-min-count-inc
        @click="setCount(model + 1)"
      >
        <Plus />
      </Button>
    </div>
    <span>{{ t('resultBoard.filter.minCountUnit') }}</span>
  </div>
</template>
