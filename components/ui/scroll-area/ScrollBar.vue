<script setup lang="ts">
import type { ScrollAreaScrollbarProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    ScrollAreaScrollbarProps & {
      class?: HTMLAttributes['class'];
      thumbClass?: HTMLAttributes['class'];
    }
  >(),
  {
    orientation: 'vertical',
  },
);

const delegatedProps = reactiveOmit(props, 'class', 'thumbClass');
</script>

<template>
  <ScrollAreaScrollbar
    v-bind="delegatedProps"
    data-slot="scroll-area-scrollbar"
    :class="
      cn(
        'flex touch-none select-none transition-colors z-(--pxd-z-sticky)',
        orientation === 'vertical' && 'h-full w-[4px] border-none bg-transparent p-0',
        orientation === 'horizontal' && 'h-[4px] flex-col border-none bg-transparent p-0',
        props.class,
      )
    "
  >
    <ScrollAreaThumb
      data-slot="scroll-area-thumb"
      :class="
        cn(
          'relative flex-1 rounded-[var(--radius)] bg-border hover:bg-muted-foreground transition-colors',
          props.thumbClass,
        )
      "
    />
  </ScrollAreaScrollbar>
</template>
