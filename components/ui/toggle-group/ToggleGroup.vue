<script setup lang="ts">
import type { ToggleGroupRootEmits, ToggleGroupRootProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import type { ToggleVariants } from '@/components/ui/toggle';
import { reactiveOmit } from '@vueuse/core';
import { ToggleGroupRoot, useForwardPropsEmits } from 'reka-ui';
import { provide } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<
  ToggleGroupRootProps & {
    class?: HTMLAttributes['class'];
    variant?: ToggleVariants['variant'];
    size?: ToggleVariants['size'];
  }
>();
const emits = defineEmits<ToggleGroupRootEmits>();

provide('toggleGroup', {
  variant: props.variant,
  size: props.size,
});

const delegatedProps = reactiveOmit(props, 'class', 'variant', 'size');

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <ToggleGroupRoot
    data-slot="toggle-group"
    v-slot="slotProps"
    v-bind="forwarded"
    :class="cn('flex items-center justify-center gap-0', props.class)"
  >
    <slot v-bind="slotProps" />
  </ToggleGroupRoot>
</template>
