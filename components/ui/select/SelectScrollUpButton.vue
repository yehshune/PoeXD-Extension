<script setup lang="ts">
import type { SelectScrollUpButtonProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ChevronUp } from '@lucide/vue';
import { SelectScrollUpButton, useForwardProps } from 'reka-ui';
import { COMPONENT_SIZE_SPECS } from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = defineProps<SelectScrollUpButtonProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectScrollUpButton
    data-slot="select-scroll-up-button"
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
      <ChevronUp class="size-[var(--control-icon-sm,14px)]" />
    </slot>
  </SelectScrollUpButton>
</template>
