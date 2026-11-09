<script setup lang="ts">
import type { DropdownMenuTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuTrigger, useForwardProps } from 'reka-ui';
import { getComponentSizeClasses } from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = defineProps<DropdownMenuTriggerProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuTrigger
    data-slot="dropdown-menu-trigger"
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
  </DropdownMenuTrigger>
</template>
