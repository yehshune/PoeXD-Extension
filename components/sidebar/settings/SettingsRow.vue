<script setup lang="ts">
import { computed, useId } from 'vue';
import { useSettingsRow } from './settings-search';

const props = withDefaults(
  defineProps<{
    label: string;
    description?: string;
    /** 控制項的 id；有值時標籤可點擊以操作控制項 */
    controlId?: string;
    /** 額外的搜尋關鍵字（不顯示） */
    keywords?: readonly string[];
    /** inline：控制項在右側；stack：控制項在標籤下方 */
    layout?: 'inline' | 'stack';
    /** 隸屬上一列的子設定 */
    nested?: boolean;
  }>(),
  {
    description: undefined,
    controlId: undefined,
    keywords: () => [],
    layout: 'inline',
    nested: false,
  },
);

const descriptionId = `pxd-setting-desc-${useId()}`;
const { visible } = useSettingsRow(() => [props.label, props.description, ...props.keywords]);
const describedBy = computed(() => (props.description ? descriptionId : undefined));
</script>

<template>
  <div
    v-show="visible"
    data-settings-row
    :class="[
      'flex min-w-0 gap-x-[var(--pxd-space-lg)] gap-y-[var(--pxd-space-sm)]',
      layout === 'inline' ? 'items-center justify-between' : 'flex-col items-stretch',
      nested ? 'ml-[7px] border-l border-border/70 pl-[var(--pxd-space-md)]' : '',
    ]"
  >
    <div class="flex min-w-0 items-start gap-[var(--pxd-space-md)]">
      <slot name="leading" />
      <div class="flex min-w-0 flex-col gap-[2px]">
        <label
          v-if="controlId"
          :for="controlId"
          class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] leading-snug text-foreground"
          >{{ label }}</label
        >
        <span
          v-else
          class="select-none text-[length:var(--pxd-font-secondary)] leading-snug text-foreground"
          >{{ label }}</span
        >
        <p
          v-if="description"
          :id="descriptionId"
          class="m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground"
        >
          {{ description }}
        </p>
      </div>
    </div>
    <div :class="layout === 'inline' ? 'shrink-0' : 'min-w-0'">
      <slot :described-by="describedBy" />
    </div>
  </div>
</template>
