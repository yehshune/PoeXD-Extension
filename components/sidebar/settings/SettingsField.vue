<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  label?: string;
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <div :class="cn('mb-[var(--pxd-field-gap)] flex flex-col', props.class)">
    <label
      v-if="label"
      class="mb-[var(--pxd-row-gap)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
    >
      {{ label }}
    </label>
    <slot />
  </div>
</template>
