<script setup lang="ts">
import type { CollapsibleTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { CollapsibleTrigger, useForwardProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<CollapsibleTriggerProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <CollapsibleTrigger
    data-slot="collapsible-trigger"
    v-bind="forwardedProps"
    :class="cn('cursor-pointer', props.class)"
  >
    <slot />
  </CollapsibleTrigger>
</template>
