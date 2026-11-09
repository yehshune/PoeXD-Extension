<script setup lang="ts">
import type { DropdownMenuItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuItem, useForwardProps } from 'reka-ui';
import {
  COLLECTION_ITEM_SPECS,
  type CollectionSize,
  getComponentSizeClasses,
} from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    DropdownMenuItemProps & {
      class?: HTMLAttributes['class'];
      inset?: boolean;
      size?: CollectionSize;
      variant?: 'default' | 'destructive';
      selected?: boolean;
    }
  >(),
  {
    size: 'sm',
    variant: 'default',
    selected: false,
  },
);

const delegatedProps = reactiveOmit(props, 'class', 'size', 'inset', 'variant', 'selected');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    v-bind="forwardedProps"
    :class="
      cn(
        'relative flex min-w-0 cursor-pointer select-none items-center box-border rounded-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:shrink-0',
        props.variant === 'destructive'
          ? 'text-destructive focus:bg-destructive focus:text-destructive-foreground'
          : 'text-foreground focus:bg-accent focus:text-accent-foreground',
        props.selected && 'bg-muted font-bold',
        getComponentSizeClasses(props.size, 'collection-item'),
        props.inset && COLLECTION_ITEM_SPECS[props.size].indicatorReserveClass,
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
