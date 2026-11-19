<script setup lang="ts">
import type { SwitchRootEmits, SwitchRootProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { SwitchRoot, SwitchThumb, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/lib/utils';

export interface SwitchProps extends SwitchRootProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<SwitchProps>();
const emits = defineEmits<SwitchRootEmits>();

const delegatedProps = reactiveOmit(props, 'class');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <!-- 尺寸沿用 checkbox token，確保隨介面縮放比例一起縮放 -->
  <SwitchRoot
    data-slot="switch"
    v-bind="forwarded"
    :class="
      cn(
        'peer relative inline-flex shrink-0 cursor-pointer items-center p-0 m-0 box-border appearance-none rounded-full border border-transparent transition-colors outline-none select-none',
        'h-[var(--checkbox-size,18px)] w-[calc(var(--checkbox-size,18px)*1.8)]',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  >
    <SwitchThumb
      data-slot="switch-thumb"
      class="pointer-events-none block size-[calc(var(--checkbox-size,18px)-4px)] rounded-full bg-background shadow-sm ring-0 transition-transform duration-150 data-[state=unchecked]:translate-x-[1px] data-[state=checked]:translate-x-[calc(var(--checkbox-size,18px)*0.8+1px)] motion-reduce:transition-none"
    />
  </SwitchRoot>
</template>
