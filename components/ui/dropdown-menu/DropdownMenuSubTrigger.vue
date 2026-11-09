<script setup lang="ts">
import type { DropdownMenuSubTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ChevronRight } from '@lucide/vue';
import { DropdownMenuSubTrigger, useForwardProps } from 'reka-ui';
import {
  COLLECTION_ITEM_SPECS,
  type CollectionSize,
  getComponentSizeClasses,
} from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    DropdownMenuSubTriggerProps & {
      class?: HTMLAttributes['class'];
      inset?: boolean;
      size?: CollectionSize;
    }
  >(),
  {
    size: 'sm',
  },
);

const delegatedProps = reactiveOmit(props, 'class', 'size', 'inset');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuSubTrigger
    data-slot="dropdown-menu-sub-trigger"
    v-bind="forwardedProps"
    :class="
      cn(
        'flex min-w-0 cursor-pointer select-none items-center box-border rounded-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg]:shrink-0',
        getComponentSizeClasses(props.size, 'collection-item'),
        props.inset && COLLECTION_ITEM_SPECS[props.size].indicatorReserveClass,
        props.class,
      )
    "
  >
    <slot />
    <ChevronRight class="ml-auto" />
  </DropdownMenuSubTrigger>
</template>
