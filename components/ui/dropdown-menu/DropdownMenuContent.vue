<script setup lang="ts">
import type { DropdownMenuContentEmits, DropdownMenuContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { DropdownMenuContent, DropdownMenuPortal, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/lib/utils';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<DropdownMenuContentProps & { class?: HTMLAttributes['class']; inert?: boolean }>(),
  {
    sideOffset: 4,
  },
);
const emits = defineEmits<DropdownMenuContentEmits>();

const delegatedProps = reactiveOmit(props, 'class', 'inert');

const forwarded = useForwardPropsEmits(delegatedProps, emits);

function isTriggerInPath(event: CustomEvent<{ originalEvent?: Event }>): boolean {
  const path = event.detail?.originalEvent?.composedPath?.() ?? [];
  const currentTarget = event.currentTarget as HTMLElement | null;
  const contentId = currentTarget?.id;
  return path.some(
    (node) =>
      node instanceof Element &&
      ((contentId && node.getAttribute('aria-controls') === contentId) ||
        node.getAttribute('data-slot') === 'dropdown-menu-trigger'),
  );
}

function handleFocusOutside(event: CustomEvent<{ originalEvent?: FocusEvent }>) {
  const target = event.detail?.originalEvent?.target;
  if (
    (target instanceof Element && target.closest('[data-slot="dropdown-menu-trigger"]')) ||
    isTriggerInPath(event)
  ) {
    event.preventDefault();
  }
}

/**
 * Shadow DOM 內點擊已開啟的觸發鈕時，document 層級看到的 event.target 會被重導向為 shadowHost，
 * 導致 reka 內建的 triggerElement.contains(event.target) 失效而於 pointerdown 先行關閉、緊接著被
 * trigger 的 click 重新打開。透過 composedPath 辨識自身觸發鈕並擋下 outside dismiss，交由 click 正常切換關閉。
 */
function handleInteractOutside(event: CustomEvent<{ originalEvent?: Event }>) {
  const path = event.detail?.originalEvent?.composedPath?.() ?? [];
  const currentTarget = event.currentTarget as HTMLElement | null;
  const contentId = currentTarget?.id;
  const hitOwnOpenTrigger = path.some(
    (node) =>
      node instanceof Element &&
      ((contentId && node.getAttribute('aria-controls') === contentId) ||
        (node.getAttribute('data-slot') === 'dropdown-menu-trigger' &&
          node.getAttribute('data-state') === 'open')),
  );
  if (hitOwnOpenTrigger) {
    event.preventDefault();
  }
}
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      data-slot="dropdown-menu-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :inert="props.inert || undefined"
      :class="
        cn(
          'z-(--pxd-z-floating) min-w-[min(var(--pxd-menu-min-width,128px),var(--reka-dropdown-menu-content-available-width,calc(100vw-32px)))] max-w-[var(--reka-dropdown-menu-content-available-width,calc(100vw-32px))] max-h-[min(var(--pxd-menu-max-height,240px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto overflow-x-hidden pxd-scrollbar box-border rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          props.class,
        )
      "
      @focus-outside="handleFocusOutside"
      @interact-outside="handleInteractOutside"
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
