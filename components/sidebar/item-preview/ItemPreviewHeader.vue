<script setup lang="ts">
import { X } from '@lucide/vue';
import { t } from '@/utils/i18n';

/** 物品預覽固定的標題列：名稱、標籤（slot）與關閉鈕，不隨內容捲動。 */
defineProps({
  title: { type: String, default: '' },
  /** 名稱的文字顏色（例如依稀有度）；省略時為前景色 */
  titleClass: { type: String, default: '' },
  closable: { type: Boolean, default: false },
});

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div
    class="preview-header preview-title-row flex h-[var(--pxd-sidebar-affix-dialog-header-height)] min-w-0 shrink-0 items-center gap-[var(--pxd-space-sm)] border-b border-border bg-background px-[var(--pxd-pane-padding)]"
  >
    <span
      class="preview-source-name min-w-0 flex-1 truncate text-[length:var(--pxd-font-body)] font-bold tracking-[0.5px]"
      :class="titleClass || 'text-foreground'"
      data-test="preview-source-name"
      :title="title"
      >{{ title }}</span
    >
    <div
      v-if="$slots.tags"
      class="preview-tags flex min-w-0 shrink items-center gap-[var(--pxd-space-xs)]"
    >
      <slot name="tags" />
    </div>
    <button
      v-if="closable"
      type="button"
      class="preview-close inline-flex size-[var(--control-height-sm)] shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-test="preview-close"
      :aria-label="t('common.close')"
      :title="t('common.close')"
      @click="emit('close')"
    >
      <X class="size-[var(--control-icon-default)]" aria-hidden="true" />
    </button>
  </div>
</template>
