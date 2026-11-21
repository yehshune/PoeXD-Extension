<script setup lang="ts">
import { computed, type Component } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { normalizeSettingsQuery, useSettingsSection } from './settings-search';

const props = withDefaults(
  defineProps<{
    sectionId: string;
    title: string;
    icon: Component;
    highlighted?: boolean;
    collapsed?: boolean;
  }>(),
  {
    highlighted: false,
    collapsed: false,
  },
);

const emit = defineEmits<{
  'toggle-collapse': [];
}>();

const { visible, query } = useSettingsSection(() => props.title);
const isSearching = computed(() => normalizeSettingsQuery(query.value) !== '');
const isExpanded = computed(() => isSearching.value || !props.collapsed);
const headingId = `pxd-settings-section-${props.sectionId}`;
</script>

<template>
  <section
    v-show="visible"
    :data-settings-section="sectionId"
    :data-settings-section-highlighted="highlighted ? 'true' : undefined"
    :data-settings-section-collapsed="isExpanded ? undefined : 'true'"
    :aria-labelledby="headingId"
    :class="[
      'flex flex-col rounded-lg border px-[var(--pxd-space-lg)] py-[var(--pxd-space-md)] transition-[background-color,border-color] duration-300',
      highlighted ? 'border-primary/50 bg-primary/10' : 'border-border/55 bg-muted/20',
    ]"
  >
    <header
      :class="[
        'flex min-h-[32px] min-w-0 cursor-pointer select-none items-center gap-[var(--pxd-space-sm)]',
        isExpanded ? 'border-b border-border/70 pb-[var(--pxd-space-md)]' : '',
      ]"
      :aria-expanded="isExpanded"
      role="button"
      tabindex="0"
      @click="emit('toggle-collapse')"
      @keydown.enter.prevent="emit('toggle-collapse')"
      @keydown.space.prevent="emit('toggle-collapse')"
    >
      <component
        :is="icon"
        class="size-[var(--control-icon-default,16px)] shrink-0 text-primary"
        aria-hidden="true"
      />
      <h3
        :id="headingId"
        class="m-0 min-w-0 flex-1 truncate text-[length:var(--pxd-font-section-title)] font-bold text-foreground"
      >
        {{ title }}
      </h3>
      <slot name="aside" />
      <ChevronDown
        :class="[
          'size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-200',
          isExpanded ? '' : '-rotate-90',
        ]"
        aria-hidden="true"
      />
    </header>
    <div
      v-show="isExpanded"
      class="mt-[var(--pxd-space-sm)] flex flex-col divide-y divide-border/35 [&>*]:py-[var(--pxd-space-md)] [&>*:last-child]:pb-[var(--pxd-space-xs)]"
    >
      <slot />
    </div>
  </section>
</template>
