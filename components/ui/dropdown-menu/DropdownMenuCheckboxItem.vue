<script setup lang="ts">
import type { DropdownMenuCheckboxItemEmits, DropdownMenuCheckboxItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { Check } from '@lucide/vue';
import { DropdownMenuCheckboxItem, DropdownMenuItemIndicator, useForwardPropsEmits } from 'reka-ui';
import {
  COLLECTION_ITEM_SPECS,
  COMPONENT_SIZE_SPECS,
  type CollectionSize,
  getComponentSizeClasses,
} from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    DropdownMenuCheckboxItemProps & {
      class?: HTMLAttributes['class'];
      size?: CollectionSize;
    }
  >(),
  {
    size: 'sm',
  },
);
const emits = defineEmits<DropdownMenuCheckboxItemEmits>();

const delegatedProps = reactiveOmit(props, 'class', 'size');

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuCheckboxItem
    data-slot="dropdown-menu-checkbox-item"
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
        <Check class="size-full" />
      </DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuCheckboxItem>
</template>
