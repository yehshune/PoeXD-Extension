<script setup lang="ts">
import { computed } from 'vue';

export interface ToastHostProps {
  message?: string;
  tone?: 'default' | 'success' | 'error';
  visible?: boolean;
}

const props = withDefaults(defineProps<ToastHostProps>(), {
  message: '',
  tone: 'default',
  visible: false,
});

const toneClass = computed(() => {
  switch (props.tone) {
    case 'success':
      return 'border-primary bg-popover text-popover-foreground';
    case 'error':
      return 'border-destructive bg-[color-mix(in_srgb,var(--destructive)_15%,var(--popover))] text-popover-foreground';
    case 'default':
    default:
      return 'border-border bg-popover text-popover-foreground';
  }
});
</script>

<template>
  <div
    v-if="visible"
    data-poexd-toast
    :data-tone="tone"
    role="status"
    aria-live="polite"
    :class="[
      'fixed top-[20px] left-1/2 -translate-x-1/2 max-w-[calc(100vw-32px)] z-[2147483647] box-border py-[var(--pxd-space-md)] px-[var(--pxd-space-xl)] rounded-[var(--radius)] shadow-lg text-[length:var(--pxd-font-section-title)] leading-normal whitespace-pre-line text-center pointer-events-auto transition-all duration-200 border',
      toneClass,
    ]"
  >
    {{ message }}
  </div>
</template>
