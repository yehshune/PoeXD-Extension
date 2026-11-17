<script setup lang="ts">
import type { PropType } from 'vue';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STAT_GROUP_TYPE_LABELS } from '@/components/injected/criteria-overlay-labels';
import { PREVIEW_COMPACT_CONTROL_HEIGHT_CLASS } from './preview-classes';

/** 高度與同一行的數值輸入框一致；左右內距與間距跟著縮小 */
const TRIGGER_CLASS = `${PREVIEW_COMPACT_CONTROL_HEIGHT_CLASS} w-auto shrink-0 gap-[var(--pxd-space-xs)] px-[var(--input-padding-x-sm)] font-semibold leading-none`;

/**
 * 詞綴群組類別的下拉選單（且、非、若、計數、加權總和），名稱同市集。
 * PoB 物品預覽只提供且／計數，搜尋預覽提供全部類別。額外屬性套在觸發鈕上。
 */
defineOptions({ inheritAttrs: false });

const props = defineProps({
  type: { type: String, required: true },
  options: { type: Array as PropType<readonly string[]>, required: true },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits<{ select: [type: string] }>();

const labelOf = (type: string) => STAT_GROUP_TYPE_LABELS[type] ?? type;

function onSelect(value: unknown): void {
  const type = String(value);
  if (type !== props.type && props.options.includes(type)) emit('select', type);
}
</script>

<template>
  <Select :model-value="type" :disabled="disabled" @update:model-value="onSelect">
    <SelectTrigger size="sm" :class="TRIGGER_CLASS" v-bind="$attrs">
      <SelectValue>{{ labelOf(type) }}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="option in options" :key="option" :value="option">
        {{ labelOf(option) }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
