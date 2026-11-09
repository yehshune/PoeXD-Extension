<script setup lang="ts">
import type { CollapsibleContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { CollapsibleContent, useForwardProps } from 'reka-ui';
import { cn } from '@/lib/utils';

const props = defineProps<CollapsibleContentProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <CollapsibleContent
    data-slot="collapsible-content"
    v-bind="forwardedProps"
    :class="cn(props.class)"
  >
    <slot />
  </CollapsibleContent>
</template>
