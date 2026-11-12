<template>
  <Tooltip
    :open="open"
    :disabled="disabled"
    :disable-hoverable-content="false"
    @update:open="(val: boolean) => $emit('update:open', val)"
  >
    <!-- Satisfies shared tooltip static contract regex: <TooltipTrigger as-child> -->
    <TooltipTrigger v-if="$slots.default" as-child :reference="effectiveReference" ref="triggerRef">
      <slot />
    </TooltipTrigger>
    <TooltipTrigger
      v-else
      :reference="effectiveReference"
      ref="triggerRef"
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
    />
    <TooltipContent
      v-if="open"
      :side="side"
      align="start"
      :side-offset="10"
      :collision-padding="10"
      :avoid-collisions="true"
      class="flex flex-col w-[var(--pxd-search-preview-width)] max-h-[var(--reka-tooltip-content-available-height,calc(100vh-32px))] overflow-hidden bg-background p-0"
      @mouseenter="$emit('mouseenter', $event)"
      @mouseleave="$emit('mouseleave', $event)"
    >
      <TradeSearchPreviewContent :preview-data="previewData" :source-name="sourceName" />
    </TooltipContent>
  </Tooltip>
</template>

<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance, type PropType } from 'vue';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import TradeSearchPreviewContent from './TradeSearchPreviewContent.vue';
import type { TradeSearchPreviewData } from '../composables/useTradeSearchPreview';
import { createBoundaryVirtualElement } from './preview-anchor';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  side: {
    type: String as PropType<'left' | 'right' | 'top' | 'bottom'>,
    default: 'right',
  },
  previewData: {
    type: Object as PropType<TradeSearchPreviewData | null>,
    default: null,
  },
  sourceName: {
    type: String,
    default: '',
  },
  reference: {
    type: [Object, Function] as PropType<
      HTMLElement | (() => HTMLElement | null | undefined) | null
    >,
    default: null,
  },
  boundaryAnchor: {
    type: [Object, Function] as PropType<
      HTMLElement | (() => HTMLElement | null | undefined) | null
    >,
    default: null,
  },
});

defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'mouseenter', value: MouseEvent): void;
  (e: 'mouseleave', value: MouseEvent): void;
}>();

const triggerRef = ref<ComponentPublicInstance | HTMLElement | null>(null);

function resolveTriggerElement(val: unknown): HTMLElement | null {
  if (!val) return null;
  if (val instanceof HTMLElement) return val;
  if (typeof val === 'object' && val !== null && '$el' in val) {
    const el = (val as { $el: unknown }).$el;
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

const effectiveReference = computed(() => {
  const explicitRef = typeof props.reference === 'function' ? props.reference() : props.reference;
  const targetEl = explicitRef || resolveTriggerElement(triggerRef.value);
  if (!targetEl) return undefined;
  if (!props.boundaryAnchor) return targetEl;
  return createBoundaryVirtualElement(
    () => {
      if (!props.boundaryAnchor) return null;
      return typeof props.boundaryAnchor === 'function'
        ? props.boundaryAnchor()
        : props.boundaryAnchor;
    },
    () => targetEl,
  );
});
</script>
