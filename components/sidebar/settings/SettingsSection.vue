<script setup lang="ts">
import type { Component } from 'vue';
import type { SettingsSectionId } from '@/utils/sidebar-modules';
import { useSettingsSection } from './settings-search';

const props = withDefaults(
  defineProps<{
    sectionId: SettingsSectionId;
    title: string;
    icon: Component;
    /** 從其他分頁跳轉過來時短暫標示 */
    highlighted?: boolean;
  }>(),
  { highlighted: false },
);

const { visible } = useSettingsSection(() => props.title);
const headingId = `pxd-settings-section-${props.sectionId}`;
</script>

<template>
  <section
    v-show="visible"
    :data-settings-section="sectionId"
    :aria-labelledby="headingId"
    :class="[
      'pxd-settings-section relative flex scroll-mt-[var(--pxd-settings-toolbar-offset,88px)] flex-col gap-[var(--pxd-field-gap)] rounded-md',
      highlighted ? 'pxd-settings-section-highlight' : '',
    ]"
  >
    <header class="flex min-w-0 items-center gap-[var(--pxd-space-sm)] pb-[2px]">
      <span
        class="inline-flex size-[calc(var(--pxd-font-section-title)*1.6)] shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <component :is="icon" class="size-[var(--control-icon-sm,14px)]" />
      </span>
      <h3
        :id="headingId"
        class="m-0 min-w-0 flex-1 truncate text-[length:var(--pxd-font-section-title)] font-bold text-foreground"
      >
        {{ title }}
      </h3>
      <slot name="aside" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.pxd-settings-section-highlight::before {
  content: '';
  position: absolute;
  inset: calc(var(--pxd-space-sm) * -1);
  border-radius: inherit;
  pointer-events: none;
  box-shadow: 0 0 0 1px var(--primary);
  background: color-mix(in srgb, var(--primary) 7%, transparent);
  animation: pxd-settings-section-flash 1.6s ease-out forwards;
}

@keyframes pxd-settings-section-flash {
  0%,
  45% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pxd-settings-section-highlight::before {
    animation-duration: 0.01ms;
    animation-delay: 1.2s;
  }
}
</style>
