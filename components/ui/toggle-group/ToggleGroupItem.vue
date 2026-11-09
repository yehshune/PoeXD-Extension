<script setup lang="ts">
import type { ToggleGroupItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import type { ToggleVariants } from '@/components/ui/toggle';
import { reactiveOmit } from '@vueuse/core';
import { ToggleGroupItem, useForwardProps } from 'reka-ui';
import { inject } from 'vue';
import { cn } from '@/lib/utils';
import { toggleVariants } from '@/components/ui/toggle';

const props = defineProps<
  ToggleGroupItemProps & {
    class?: HTMLAttributes['class'];
    variant?: ToggleVariants['variant'];
    size?: ToggleVariants['size'];
  }
>();

const context = inject<{
  variant?: ToggleVariants['variant'];
  size?: ToggleVariants['size'];
}>('toggleGroup');

const delegatedProps = reactiveOmit(props, 'class', 'size', 'variant');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <ToggleGroupItem
    data-slot="toggle-group-item"
    v-slot="slotProps"
    v-bind="forwardedProps"
    :class="
      cn(
        toggleVariants({
          variant: context?.variant || props.variant,
          size: context?.size || props.size,
        }),
        'first:rounded-l-md first:rounded-r-none last:rounded-r-md last:rounded-l-none [&:not(:first-child):not(:last-child)]:rounded-none only:rounded-md [&:not(:first-child)]:-ml-px focus:z-10 focus-visible:z-10 data-[state=on]:z-10',
        props.class,
      )
    "
  >
    <slot v-bind="slotProps" />
  </ToggleGroupItem>
</template>
