<script setup lang="ts">
import type { CheckboxRootEmits, CheckboxRootProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { CheckboxIndicator, CheckboxRoot, useForwardPropsEmits } from 'reka-ui';
import { FORM_INDICATOR_SPECS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends CheckboxRootProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<CheckboxProps>();
const emits = defineEmits<CheckboxRootEmits>();

const delegatedProps = reactiveOmit(props, 'class');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <CheckboxRoot
    data-slot="checkbox"
    v-bind="forwarded"
    :class="
      cn(
        'peer inline-flex items-center justify-center shrink-0 cursor-pointer p-0 m-0 box-border appearance-none select-none rounded-sm border border-input bg-background transition-colors hover:bg-accent ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-[inherit]',
        FORM_INDICATOR_SPECS.checkbox.sizeClass,
        props.class,
      )
    "
  >
    <CheckboxIndicator
      data-slot="checkbox-indicator"
      :class="
        cn(
          'flex items-center justify-center rounded-[calc(var(--radius)*0.25)] bg-primary text-primary-foreground transition-colors data-[state=indeterminate]:h-0.5 data-[state=indeterminate]:w-full data-[state=unchecked]:hidden',
          FORM_INDICATOR_SPECS.checkbox.indicatorClass,
        )
      "
    >
      <slot />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
