<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { X } from '@lucide/vue';
import { DialogContent, DialogOverlay, DialogPortal, useForwardPropsEmits } from 'reka-ui';
import DialogClose from './DialogClose.vue';
import { cn } from '@/lib/utils';

export type DialogLayer = 'base' | 'nested' | 'system';

const LAYER_CLASSES: Record<DialogLayer, string> = {
  base: 'z-50',
  nested: 'z-[60]',
  system: 'z-[70]',
};

const props = withDefaults(
  defineProps<
    DialogContentProps & {
      layer?: DialogLayer;
      placement?: 'centered' | 'inset';
      class?: HTMLAttributes['class'];
      overlayClass?: HTMLAttributes['class'];
      overlayMousedown?: (event: MouseEvent) => void;
      overlayMouseup?: (event: MouseEvent) => void;
      closeClass?: HTMLAttributes['class'];
    }
  >(),
  {
    layer: 'base',
    placement: 'centered',
  },
);
const emits = defineEmits<DialogContentEmits>();

const baseDelegated = reactiveOmit(props, 'class', 'overlayClass');
const delegatedProps = reactiveOmit(
  baseDelegated,
  'layer',
  'placement',
  'overlayMousedown',
  'overlayMouseup',
  'closeClass',
);

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const PORTALLED_FLOATING_SELECTORS = [
  '[data-slot="select-content"]',
  '[data-slot="select-item"]',
  '[data-slot="select-viewport"]',
  '[data-slot="select-scroll-up-button"]',
  '[data-slot="select-scroll-down-button"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="dropdown-menu-item"]',
  '[data-slot="popover-content"]',
  '[data-slot="tooltip-content"]',
  '[data-reka-popper-content-wrapper]',
  '[data-radix-popper-content-wrapper]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menuitem"]',
].join(', ');

function isPortalledFloatingTarget(target: unknown, originalEvent?: Event): boolean {
  if (originalEvent && typeof originalEvent.composedPath === 'function') {
    const path = originalEvent.composedPath();
    for (const item of path) {
      if (item instanceof Element && item.matches?.(PORTALLED_FLOATING_SELECTORS)) {
        return true;
      }
    }
  }
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest?.(PORTALLED_FLOATING_SELECTORS));
}

const handlePointerDownOutside = (event: DialogContentEmits['pointerDownOutside'][0]) => {
  const originalEvent = event.detail?.originalEvent;
  const target = originalEvent?.target;
  if (isPortalledFloatingTarget(target, originalEvent)) {
    event.preventDefault();
  }
};

const handleInteractOutside = (event: DialogContentEmits['interactOutside'][0]) => {
  const originalEvent = (event.detail as { originalEvent?: Event })?.originalEvent;
  const target = originalEvent?.target;
  if (isPortalledFloatingTarget(target, originalEvent)) {
    event.preventDefault();
  }
};

const handleCloseAutoFocus = (event: DialogContentEmits['closeAutoFocus'][0]) => {
  emits('closeAutoFocus', event);
  if (!event.defaultPrevented) {
    event.preventDefault();
  }
};
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      data-slot="dialog-overlay"
      :class="
        cn(
          'fixed inset-0 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          LAYER_CLASSES[props.layer],
          props.overlayClass,
        )
      "
      @mousedown="props.overlayMousedown?.($event)"
      @mouseup="props.overlayMouseup?.($event)"
    />
    <DialogContent
      data-slot="dialog-content"
      v-bind="forwarded"
      :class="
        cn(
          'fixed grid gap-4 box-border border border-border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 rounded-lg',
          LAYER_CLASSES[props.layer],
          props.placement === 'centered' &&
            'left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          props.class,
        )
      "
      @pointer-down-outside="handlePointerDownOutside"
      @interact-outside="handleInteractOutside"
      @close-auto-focus="handleCloseAutoFocus"
    >
      <slot />

      <DialogClose
        data-slot="dialog-close"
        :class="
          cn(
            'absolute right-4 top-4 opacity-70 transition-opacity hover:opacity-100 data-[state=open]:bg-accent data-[state=open]:text-muted-foreground',
            props.closeClass,
          )
        "
      >
        <X />
        <span class="sr-only">Close</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
