<script setup lang="ts">
import type { PopoverContentEmits, PopoverContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import {
  injectPopoverRootContext,
  PopoverContent,
  PopoverPortal,
  useForwardPropsEmits,
} from 'reka-ui';
import { cn } from '@/lib/utils';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<PopoverContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    align: 'center',
    sideOffset: 4,
  },
);
const emits = defineEmits<PopoverContentEmits>();

const delegatedProps = reactiveOmit(props, 'class');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
const rootContext = injectPopoverRootContext(null);

function isTriggerInteraction(event: PopoverContentEmits['interactOutside'][0]): boolean {
  const triggerEl = rootContext?.triggerElement.value;
  if (!triggerEl) return false;

  const originalEvent = (event.detail as { originalEvent?: Event } | undefined)?.originalEvent;

  // Shadow DOM 下 document 監聽到的 pointerdown 會被 retarget 成 shadow host，
  // 需透過 composedPath() 判斷實際落點是否位於 PopoverTrigger 內。
  if (originalEvent && typeof originalEvent.composedPath === 'function') {
    if (originalEvent.composedPath().includes(triggerEl)) {
      return true;
    }
  }

  const target = originalEvent?.target ?? event.target;
  if (target instanceof Node && triggerEl.contains(target)) {
    return true;
  }

  // focusin 經過 DismissableLayer 的兩次 nextTick 後 composedPath() 會變成空陣列，
  // 改以 trigger 所屬 root（ShadowRoot / Document）的 activeElement 判斷焦點是否落回 trigger。
  if (originalEvent?.type === 'focusin') {
    const rootNode = triggerEl.getRootNode();
    const activeEl =
      rootNode instanceof Document || rootNode instanceof ShadowRoot
        ? rootNode.activeElement
        : null;
    if (activeEl && triggerEl.contains(activeEl)) {
      return true;
    }
  }

  return false;
}

const handleInteractOutside = (event: PopoverContentEmits['interactOutside'][0]) => {
  if (isTriggerInteraction(event)) {
    event.preventDefault();
  }
};
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      data-slot="popover-content"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="
        cn(
          'z-(--pxd-z-floating) rounded-md border border-border bg-popover p-[var(--pxd-space-lg)] text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          props.class,
        )
      "
      @interact-outside="handleInteractOutside"
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
