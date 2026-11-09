<script setup lang="ts">
import type { SelectTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import type { ComponentSize } from '@/lib/tokens';
import { computed } from 'vue';
import { COMPONENT_SIZE_SPECS, getComponentSizeClasses } from '@/lib/tokens';
import { reactiveOmit } from '@vueuse/core';
import { ChevronDown } from '@lucide/vue';
import { SelectIcon, SelectTrigger, useForwardProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    SelectTriggerProps & {
      class?: HTMLAttributes['class'];
      size?: ComponentSize;
    }
  >(),
  {
    size: 'default',
  },
);

const delegatedProps = reactiveOmit(props, 'class', 'size');

const forwardedProps = useForwardProps(delegatedProps);

const chevronSizeClass = computed(() => COMPONENT_SIZE_SPECS[props.size].iconSizeClass);
</script>

<template>
  <SelectTrigger
    data-slot="select-trigger"
    v-bind="forwardedProps"
    :class="
      cn(
        'flex w-full items-center justify-between box-border rounded-md border border-input bg-background font-[inherit] text-foreground shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none m-0 cursor-pointer [&>span]:truncate text-start',
        getComponentSizeClasses(size, 'select'),
        props.class,
      )
    "
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown :class="cn(chevronSizeClass, 'opacity-50 shrink-0')" />
    </SelectIcon>
  </SelectTrigger>
</template>
