<script setup lang="ts">
import { computed, type Component } from 'vue';
import { useSettingsSection } from './settings-search';

const props = withDefaults(
  defineProps<{
    sectionId: string;
    title: string;
    icon: Component;
    /** 分頁式設定頁：只有目前分頁的區塊為 true；搜尋時改依搜尋結果顯示 */
    active?: boolean;
    /** always：一律顯示標題；search：只在搜尋時顯示（分頁本身已標示區塊名） */
    headerMode?: 'always' | 'search';
  }>(),
  { active: true, headerMode: 'always' },
);

const { visible, isSearching } = useSettingsSection(() => props.title);
const shown = computed(() => (isSearching.value ? visible.value : props.active));
const showHeader = computed(() => props.headerMode === 'always' || isSearching.value);
const headingId = `pxd-settings-section-${props.sectionId}`;
</script>

<template>
  <section
    v-show="shown"
    :data-settings-section="sectionId"
    :aria-labelledby="headingId"
    class="flex flex-col gap-[var(--pxd-field-gap)]"
  >
    <header v-show="showHeader" class="flex min-w-0 items-center gap-[var(--pxd-space-sm)]">
      <component
        :is="icon"
        class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <h3
        :id="headingId"
        class="m-0 min-w-0 flex-1 truncate text-[length:var(--pxd-font-secondary)] font-bold text-foreground"
      >
        {{ title }}
      </h3>
      <slot name="aside" />
    </header>
    <slot />
  </section>
</template>
