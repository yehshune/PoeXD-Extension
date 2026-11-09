<script setup lang="ts">
import type { SelectScrollDownButtonProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ChevronDown } from '@lucide/vue';
import { SelectScrollDownButton, useForwardProps } from 'reka-ui';
import { COMPONENT_SIZE_SPECS } from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = defineProps<SelectScrollDownButtonProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectScrollDownButton
    data-slot="select-scroll-down-button"
    v-bind="forwardedProps"
    :class="
      cn(
        'flex w-full cursor-default items-center justify-center box-border border-none bg-transparent appearance-none m-0 p-0 font-[inherit] text-muted-foreground',
        COMPONENT_SIZE_SPECS.sm.minHeightClass,
        COMPONENT_SIZE_SPECS.sm.iconSvgClass,
        props.class,
      )
    "
  >
    <slot>
      <ChevronDown class="size-[var(--control-icon-sm,14px)]" />
    </slot>
  </SelectScrollDownButton>
</template>
