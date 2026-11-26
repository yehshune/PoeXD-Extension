<script setup lang="ts">
import { onMounted, onUnmounted, ref, type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';
import { calcPixelSnapMargin } from '@/utils/scroll-pixel-snap';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
    scrollMode?: 'internal' | 'external';
  }>(),
  {
    scrollMode: 'internal',
  },
);

const fixedSlotRef = ref<HTMLElement | null>(null);
const scrollContentRef = ref<HTMLElement | null>(null);

function applySnapMargin(el: HTMLElement | null, value: number) {
  if (!el) return;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snap = calcPixelSnapMargin(value, dpr);
  const next = snap > 0 ? `${snap}px` : '';
  if (el.style.marginBottom !== next) {
    el.style.marginBottom = next;
  }
}

function syncScrollPixelSnap() {
  if (fixedSlotRef.value) {
    applySnapMargin(fixedSlotRef.value, fixedSlotRef.value.getBoundingClientRect().bottom);
  }
  if (scrollContentRef.value) {
    applySnapMargin(scrollContentRef.value, scrollContentRef.value.getBoundingClientRect().height);
  }
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  syncScrollPixelSnap();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncScrollPixelSnap());
    if (fixedSlotRef.value) resizeObserver.observe(fixedSlotRef.value);
    if (scrollContentRef.value) resizeObserver.observe(scrollContentRef.value);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', syncScrollPixelSnap, { passive: true });
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', syncScrollPixelSnap);
  }
});
</script>

<template>
  <div
    data-slot="sidebar-pane"
    :class="cn('flex h-full min-h-0 flex-col overflow-hidden @container', props.class)"
    style="container-type: inline-size"
  >
    <div
      v-if="$slots.fixed"
      ref="fixedSlotRef"
      data-slot="sidebar-pane-fixed"
      class="shrink-0 p-[var(--pxd-pane-padding)] pt-[var(--pxd-space-md)] pb-0 min-w-0 w-full"
    >
      <slot name="fixed" />
    </div>

    <!-- Internal scroll viewport (managed by SidebarPane via ScrollArea) -->
    <ScrollAreaRoot
      v-if="scrollMode === 'internal'"
      data-slot="sidebar-pane-scroll-root"
      class="relative min-h-0 flex-1 overflow-hidden"
    >
      <ScrollAreaViewport
        data-slot="sidebar-pane-scroll"
        :as-child="true"
        class="h-full w-full min-h-0 bg-background backface-hidden"
      >
        <div
          ref="scrollContentRef"
          data-slot="sidebar-pane-scroll-content"
          :class="
            cn(
              'bg-background p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)]',
              $slots.fixed && 'pt-0',
            )
          "
        >
          <slot name="scroll" />
        </div>
      </ScrollAreaViewport>
      <ScrollBar />
      <ScrollAreaCorner />
    </ScrollAreaRoot>

    <!-- External scroll host (consumer provides native scroll viewport) -->
    <div
      v-else-if="scrollMode === 'external'"
      data-slot="sidebar-pane-scroll-host"
      class="min-h-0 flex-1 overflow-hidden"
    >
      <slot name="scroll" />
    </div>
  </div>
</template>
