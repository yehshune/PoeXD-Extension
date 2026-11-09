<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { computed, useId } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  size?: number | string;
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
});

const uid = useId();
const clipId = computed(() => `poexd-gear-clip-${uid}`);
const maskId = computed(() => `poexd-gear-mask-${uid}`);

const dimension = computed(() => {
  return typeof props.size === 'number' ? `${props.size}px` : props.size;
});
</script>

<template>
  <svg
    v-bind="$attrs"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 512 512"
    fill="none"
    :width="dimension"
    :height="dimension"
    :style="{ width: dimension, height: dimension }"
    :class="cn('inline-block shrink-0 align-middle select-none', props.class)"
    role="img"
    aria-label="PoeXD Brand Gear Emblem"
  >
    <defs>
      <!-- Clip path strictly constraining fold shadow to gear surface -->
      <clipPath :id="clipId">
        <path
          d="M 195.07 36.29 A 228.0 228.0 0 0 1 316.93 36.29 L 322.09 69.36 A 198.0 198.0 0 0 1 341.24 77.29 L 368.27 57.56 A 228.0 228.0 0 0 1 454.44 143.73 L 434.71 170.76 A 198.0 198.0 0 0 1 442.64 189.91 L 475.71 195.07 A 228.0 228.0 0 0 1 475.71 316.93 L 442.64 322.09 A 198.0 198.0 0 0 1 434.71 341.24 L 454.44 368.27 A 228.0 228.0 0 0 1 368.27 454.44 L 341.24 434.71 A 198.0 198.0 0 0 1 322.09 442.64 L 316.93 475.71 A 228.0 228.0 0 0 1 195.07 475.71 L 189.91 442.64 A 198.0 198.0 0 0 1 170.76 434.71 L 143.73 454.44 A 228.0 228.0 0 0 1 57.56 368.27 L 77.29 341.24 A 198.0 198.0 0 0 1 69.36 322.09 L 36.29 316.93 A 228.0 228.0 0 0 1 36.29 195.07 L 69.36 189.91 A 198.0 198.0 0 0 1 77.29 170.76 L 57.56 143.73 A 228.0 228.0 0 0 1 143.73 57.56 L 170.76 77.29 A 198.0 198.0 0 0 1 189.91 69.36 Z"
        />
      </clipPath>

      <!-- Negative space mask: punches out letter P while preserving center bearing hole -->
      <mask :id="maskId">
        <rect width="512" height="512" fill="white" />
        <path d="M 128 256 A 128 128 0 1 1 194 368 L 194 490 L 128 490 Z" fill="black" />
        <circle cx="256" cy="256" r="62" fill="white" />
      </mask>
    </defs>

    <g :mask="`url(#${maskId})`">
      <!-- 8-Tooth Mechanical Gear (Colored via currentColor / text-primary) -->
      <path
        d="M 195.07 36.29 A 228.0 228.0 0 0 1 316.93 36.29 L 322.09 69.36 A 198.0 198.0 0 0 1 341.24 77.29 L 368.27 57.56 A 228.0 228.0 0 0 1 454.44 143.73 L 434.71 170.76 A 198.0 198.0 0 0 1 442.64 189.91 L 475.71 195.07 A 228.0 228.0 0 0 1 475.71 316.93 L 442.64 322.09 A 198.0 198.0 0 0 1 434.71 341.24 L 454.44 368.27 A 228.0 228.0 0 0 1 368.27 454.44 L 341.24 434.71 A 198.0 198.0 0 0 1 322.09 442.64 L 316.93 475.71 A 228.0 228.0 0 0 1 195.07 475.71 L 189.91 442.64 A 198.0 198.0 0 0 1 170.76 434.71 L 143.73 454.44 A 228.0 228.0 0 0 1 57.56 368.27 L 77.29 341.24 A 198.0 198.0 0 0 1 69.36 322.09 L 36.29 316.93 A 228.0 228.0 0 0 1 36.29 195.07 L 69.36 189.91 A 198.0 198.0 0 0 1 77.29 170.76 L 57.56 143.73 A 228.0 228.0 0 0 1 143.73 57.56 L 170.76 77.29 A 198.0 198.0 0 0 1 189.91 69.36 Z"
        fill="currentColor"
      />

      <!-- Fold Shadow (Constrained within Gear surface) -->
      <g :clip-path="`url(#${clipId})`">
        <path d="M 194 368 L 275 490 L 194 490 Z" fill="black" fill-opacity="0.25" />
      </g>
    </g>
  </svg>
</template>
