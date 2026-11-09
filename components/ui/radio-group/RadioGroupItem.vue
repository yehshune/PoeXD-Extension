<script setup lang="ts">
import type { RadioGroupItemProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { Circle } from '@lucide/vue';
import { RadioGroupIndicator, RadioGroupItem, useForwardProps } from 'reka-ui';
import { FORM_INDICATOR_SPECS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export interface RadioItemProps extends RadioGroupItemProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<RadioItemProps>();

const delegatedProps = reactiveOmit(props, 'class');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <RadioGroupItem
    data-slot="radio-group-item"
    v-bind="forwardedProps"
    :class="
      cn(
        'peer inline-flex items-center justify-center shrink-0 cursor-pointer p-0 m-0 box-border appearance-none select-none rounded-full border border-primary text-primary transition-colors ring-offset-background focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-[inherit]',
        FORM_INDICATOR_SPECS.radio.sizeClass,
        props.class,
      )
    "
  >
    <RadioGroupIndicator
      data-slot="radio-group-indicator"
      class="flex items-center justify-center size-full text-current"
    >
      <Circle :class="cn('fill-current text-current', FORM_INDICATOR_SPECS.radio.indicatorClass)" />
    </RadioGroupIndicator>
  </RadioGroupItem>
</template>
