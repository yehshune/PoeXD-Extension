<script setup lang="ts">
import type { SelectItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { Check } from '@lucide/vue';
import { SelectItem, SelectItemIndicator, SelectItemText, useForwardProps } from 'reka-ui';
import {
  COLLECTION_ITEM_SPECS,
  COMPONENT_SIZE_SPECS,
  type CollectionSize,
  getComponentSizeClasses,
} from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    SelectItemProps & {
      class?: HTMLAttributes['class'];
      size?: CollectionSize;
    }
  >(),
  {
    size: 'sm',
  },
);

const delegatedProps = reactiveOmit(props, 'class', 'size');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectItem
    data-slot="select-item"
    :data-value="props.value"
    v-bind="forwardedProps"
    :class="
      cn(
        'relative flex w-full cursor-default select-none items-center box-border rounded-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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
      <SelectItemIndicator>
        <Check class="size-full" />
      </SelectItemIndicator>
    </span>

    <SelectItemText data-slot="select-item-text">
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
