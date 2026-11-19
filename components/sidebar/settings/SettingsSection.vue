<script setup lang="ts">
import type { Component } from 'vue';
import { useSettingsSection } from './settings-search';

const props = withDefaults(
  defineProps<{
    sectionId: string;
    title: string;
    icon: Component;
    highlighted?: boolean;
  }>(),
  {
    highlighted: false,
  },
);

const { visible } = useSettingsSection(() => props.title);
const headingId = `pxd-settings-section-${props.sectionId}`;
</script>

<template>
  <section
    v-show="visible"
    :data-settings-section="sectionId"
    :data-settings-section-highlighted="highlighted ? 'true' : undefined"
    :aria-labelledby="headingId"
    :class="[
      'flex flex-col gap-[var(--pxd-space-xl)] rounded-md border -mx-[var(--pxd-space-sm)] px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] transition-[background-color,border-color] duration-300',
      highlighted ? 'border-primary/50 bg-primary/10' : 'border-transparent',
    ]"
  >
    <header
      class="flex min-w-0 items-center gap-[var(--pxd-space-sm)] border-b border-border pb-[var(--pxd-space-md)]"
    >
      <component
        :is="icon"
        class="size-[var(--control-icon-default,16px)] shrink-0 text-primary"
        aria-hidden="true"
      />
      <h3
        :id="headingId"
        class="m-0 min-w-0 flex-1 truncate text-[length:var(--pxd-font-body)] font-bold text-foreground"
      >
        {{ title }}
      </h3>
      <slot name="aside" />
    </header>
    <slot />
  </section>
</template>
