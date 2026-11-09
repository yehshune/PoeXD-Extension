<script setup lang="ts">
import type { DialogCloseProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { DialogClose, useForwardProps } from 'reka-ui';
import { getComponentSizeClasses } from '@/lib/tokens/ui-contract';
import { cn } from '@/lib/utils';

const props = defineProps<DialogCloseProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DialogClose
    data-slot="dialog-close"
    v-bind="forwardedProps"
    :class="
      cn(
        !props.asChild && [
          'inline-flex items-center justify-center box-border border-none bg-transparent cursor-pointer appearance-none m-0 font-[inherit] select-none',
          'focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none',
          getComponentSizeClasses('sm', 'icon-button'),
        ],
        props.class,
      )
    "
  >
    <slot />
  </DialogClose>
</template>
