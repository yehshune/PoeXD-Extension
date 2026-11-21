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
    collapsible?: boolean;
    divided?: boolean;
  }>(),
  {
    highlighted: false,
    collapsed: false,
    collapsible: true,
    divided: true,
  },
);

const emit = defineEmits<{
  'toggle-collapse': [];
}>();

const { visible, query } = useSettingsSection(() => props.title);
const isSearching = computed(() => normalizeSettingsQuery(query.value) !== '');
const isExpanded = computed(() => !props.collapsible || isSearching.value || !props.collapsed);
const headingId = `pxd-settings-section-${props.sectionId}`;

function handleToggleCollapse() {
  if (!props.collapsible) return;
  emit('toggle-collapse');
}
</script>

<template>
  <section
    v-show="visible"
    :data-settings-section="sectionId"
    :data-settings-section-highlighted="highlighted ? 'true' : undefined"
    :data-settings-section-collapsed="collapsible && !isExpanded ? 'true' : undefined"
    :aria-labelledby="headingId"
    :class="[
      'flex flex-col rounded-lg border px-[var(--pxd-space-lg)] py-[var(--pxd-space-md)] transition-[background-color,border-color] duration-300',
      highlighted ? 'border-primary/50 bg-primary/10' : 'border-border/55 bg-muted/20',
    ]"
  >
    <header
      :class="[
        'flex min-h-[32px] min-w-0 items-center gap-[var(--pxd-space-sm)]',
        collapsible ? 'cursor-pointer select-none' : '',
        isExpanded ? 'border-b border-border/70 pb-[var(--pxd-space-md)]' : '',
      ]"
      :aria-expanded="collapsible ? isExpanded : undefined"
      :role="collapsible ? 'button' : undefined"
      :tabindex="collapsible ? 0 : undefined"
      @click="handleToggleCollapse"
      @keydown.enter.prevent="handleToggleCollapse"
      @keydown.space.prevent="handleToggleCollapse"
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
        v-if="collapsible"
        :class="[
          'size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-200',
          isExpanded ? '' : '-rotate-90',
        ]"
        aria-hidden="true"
      />
    </header>
    <div
      v-show="isExpanded"
      :class="
        divided
          ? 'mt-[var(--pxd-space-sm)] flex flex-col divide-y divide-border/35 [&>*]:py-[var(--pxd-space-md)] [&>*:last-child]:pb-[var(--pxd-space-xs)]'
          : 'mt-[var(--pxd-space-md)] flex flex-col gap-[var(--pxd-space-md)] pb-[var(--pxd-space-xs)]'
      "
    >
      <slot />
    </div>
  </section>
</template>
