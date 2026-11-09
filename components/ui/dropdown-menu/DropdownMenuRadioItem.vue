<script setup lang="ts">
import type { DropdownMenuRadioItemEmits, DropdownMenuRadioItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { Circle } from '@lucide/vue';
import { DropdownMenuItemIndicator, DropdownMenuRadioItem, useForwardPropsEmits } from 'reka-ui';
import {
  COLLECTION_ITEM_SPECS,
  COMPONENT_SIZE_SPECS,
  type CollectionSize,
  getComponentSizeClasses,
} from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    DropdownMenuRadioItemProps & {
      class?: HTMLAttributes['class'];
      size?: CollectionSize;
    }
  >(),
  {
    size: 'sm',
  },
);

const emits = defineEmits<DropdownMenuRadioItemEmits>();

const delegatedProps = reactiveOmit(props, 'class', 'size');

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuRadioItem
    data-slot="dropdown-menu-radio-item"
    v-bind="forwarded"
    :class="
      cn(
        'relative flex min-w-0 cursor-default select-none items-center box-border rounded-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:shrink-0',
        getComponentSizeClasses(props.size, 'collection-item'),
        COLLECTION_ITEM_SPECS[props.size].indicatorReserveClass,
        props.class,
      )
    "
  >
    <span
      :class="
        cn(
          'absolute flex items-center justify-center',
          COLLECTION_ITEM_SPECS[props.size].indicatorLeftClass,
          COMPONENT_SIZE_SPECS[props.size].iconSizeClass,
        )
      "
    >
      <DropdownMenuItemIndicator>
        <Circle :class="cn('fill-current', COLLECTION_ITEM_SPECS[props.size].radioDotClass)" />
      </DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuRadioItem>
</template>
