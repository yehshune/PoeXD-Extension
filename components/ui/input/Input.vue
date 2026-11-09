<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import type { InputVariants } from '.';
import { useVModel } from '@vueuse/core';
import { cn } from '@/lib/utils';
import { inputVariants } from '.';

const props = defineProps<{
  defaultValue?: string | number;
  modelValue?: string | number;
  class?: HTMLAttributes['class'];
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: InputVariants['size'];
}>();

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void;
}>();

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
});
</script>

<template>
  <input
    data-slot="input"
    v-model="modelValue"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="cn(inputVariants({ size }), props.class)"
  />
</template>
