<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';
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
</script>

<template>
  <div
    data-slot="sidebar-pane"
    :class="cn('flex h-full min-h-0 flex-col overflow-hidden @container', props.class)"
    style="container-type: inline-size"
  >
    <div
      v-if="$slots.fixed"
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
        class="h-full w-full min-h-0"
      >
        <div
          data-slot="sidebar-pane-scroll-content"
          :class="
            cn(
              'p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)]',
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
