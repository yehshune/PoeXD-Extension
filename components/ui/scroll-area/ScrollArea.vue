<script setup lang="ts">
import type { ScrollAreaRootProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ScrollAreaCorner, ScrollAreaViewport } from 'reka-ui';
import ScrollAreaRoot from './ScrollAreaRoot.vue';
import ScrollBar from './ScrollBar.vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    ScrollAreaRootProps & {
      class?: HTMLAttributes['class'];
      viewportClass?: HTMLAttributes['class'];
      orientation?: 'vertical' | 'horizontal' | 'both';
    }
  >(),
  {
    orientation: 'vertical',
  },
);

const delegatedProps = reactiveOmit(props, 'class', 'viewportClass', 'orientation');
</script>

<template>
  <ScrollAreaRoot v-bind="delegatedProps" :class="props.class">
    <ScrollAreaViewport
      data-slot="scroll-area-viewport"
      :class="cn('h-full w-full rounded-[inherit]', props.viewportClass)"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollBar v-if="orientation === 'vertical' || orientation === 'both'" orientation="vertical" />
    <ScrollBar
      v-if="orientation === 'horizontal' || orientation === 'both'"
      orientation="horizontal"
    />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
