<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import type { ButtonVariants } from '.';
import { cn } from '@/lib/utils';
import { buttonVariants } from '.';

interface Props {
  variant?: ButtonVariants['variant'];
  size?: ButtonVariants['size'];
  class?: HTMLAttributes['class'];
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

const props = withDefaults(defineProps<Props>(), {
  type: 'button',
});
</script>

<template>
  <button
    data-slot="button"
    :type="type"
    :disabled="disabled"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </button>
</template>
