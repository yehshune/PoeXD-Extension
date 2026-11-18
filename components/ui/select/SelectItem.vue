<script setup lang="ts">
import type { SelectItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { SelectItem, SelectItemText, useForwardProps } from 'reka-ui';
import { type CollectionSize, getComponentSizeClasses } from '@/lib/tokens/ui-contract';
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
        'relative flex w-full cursor-default select-none items-center box-border rounded-sm outline-none data-[state=checked]:bg-muted/60 data-[state=checked]:font-semibold focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        getComponentSizeClasses(props.size, 'collection-item'),
        props.class,
      )
    "
  >
    <SelectItemText data-slot="select-item-text">
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
