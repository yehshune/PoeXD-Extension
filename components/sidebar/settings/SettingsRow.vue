<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { Info } from '@lucide/vue';
import { t } from '@/utils/i18n';
import { useSettingsRow } from './settings-search';

const props = withDefaults(
  defineProps<{
    label: string;
    /** 一行簡短說明，永遠顯示 */
    description?: string;
    /** 完整說明，點 ⓘ 才展開 */
    details?: string;
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
    details: undefined,
    controlId: undefined,
    keywords: () => [],
    layout: 'inline',
    nested: false,
  },
);

const uid = useId();
const descriptionId = `pxd-setting-desc-${uid}`;
const detailsId = `pxd-setting-details-${uid}`;
const detailsOpen = ref(false);
const { visible } = useSettingsRow(() => [
  props.label,
  props.description,
  props.details,
  ...props.keywords,
]);
const describedBy = computed(() => (props.description ? descriptionId : undefined));
</script>

<template>
  <div
    v-show="visible"
    data-settings-row
    :class="[
      'flex min-w-0 flex-col gap-[var(--pxd-space-xs)]',
      nested ? 'ml-[7px] border-l border-border/70 pl-[var(--pxd-space-md)]' : '',
    ]"
  >
    <div
      :class="[
        'flex min-w-0 gap-x-[var(--pxd-space-lg)] gap-y-[var(--pxd-space-sm)]',
        layout === 'inline' ? 'items-center justify-between' : 'flex-col items-stretch',
      ]"
    >
      <div class="flex min-w-0 items-start gap-[var(--pxd-space-md)]">
        <slot name="leading" />
        <div class="flex min-w-0 flex-col gap-[2px]">
          <div class="flex min-w-0 items-center gap-[2px]">
            <label
              v-if="controlId"
              :for="controlId"
              class="min-w-0 cursor-pointer select-none text-[length:var(--pxd-font-secondary)] leading-snug text-foreground"
              >{{ label }}</label
            >
            <span
              v-else
              class="min-w-0 select-none text-[length:var(--pxd-font-secondary)] leading-snug text-foreground"
              >{{ label }}</span
            >
            <button
              v-if="details"
              type="button"
              data-settings-details-toggle
              :aria-expanded="detailsOpen"
              :aria-controls="detailsId"
              :aria-label="t('settings.details.toggleAria', { label })"
              :title="t('settings.details.toggleAria', { label })"
              class="inline-flex size-[calc(var(--control-icon-sm,14px)+6px)] shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              :class="detailsOpen ? 'text-primary' : 'text-muted-foreground/70'"
              @click="detailsOpen = !detailsOpen"
            >
              <Info class="size-[var(--control-icon-sm,14px)]" />
            </button>
          </div>
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
    <p
      v-if="details"
      v-show="detailsOpen"
      :id="detailsId"
      data-settings-details
      class="m-0 rounded-sm bg-muted/60 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] leading-[1.5] text-muted-foreground"
    >
      {{ details }}
    </p>
  </div>
</template>
