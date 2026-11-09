<script setup lang="ts">
import type { TooltipTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { TooltipTrigger, useForwardProps } from 'reka-ui';
import { getComponentSizeClasses } from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = defineProps<TooltipTriggerProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <TooltipTrigger
    data-slot="tooltip-trigger"
    v-bind="forwardedProps"
    :class="
      cn(
        !props.asChild && [
          'inline-flex items-center justify-center box-border border-none bg-transparent cursor-pointer appearance-none m-0 font-[inherit] select-none',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-50',
          getComponentSizeClasses('sm', 'button'),
        ],
        props.class,
      )
    "
  >
    <slot />
  </TooltipTrigger>
</template>
