<script setup lang="ts">
import { X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';

/** 物品預覽固定的標題列：名稱、標籤（slot）與關閉鈕，不隨內容捲動。 */
defineProps({
  title: { type: String, default: '' },
  /** 名稱的文字顏色（例如依稀有度）；省略時為前景色 */
  titleClass: { type: String, default: '' },
  closable: { type: Boolean, default: false },
  /** 有未儲存的暫存微調時在標題旁顯示圓點提示 */
  modified: { type: Boolean, default: false },
});

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div
    class="preview-header preview-title-row flex h-[var(--pxd-sidebar-affix-dialog-header-height)] min-w-0 shrink-0 items-center gap-[var(--pxd-space-sm)] border-b border-border/60 bg-muted/30 px-[var(--pxd-pane-padding)]"
  >
    <div class="flex min-w-0 flex-1 items-center gap-[var(--pxd-space-xs)]">
      <span
        class="preview-source-name min-w-0 truncate text-[length:var(--pxd-font-body)] font-bold tracking-[0.5px]"
        :class="titleClass || 'text-foreground'"
        data-test="preview-source-name"
        :title="title"
        >{{ title }}</span
      >
      <span
        v-if="modified"
        class="preview-modified-dot size-2 shrink-0 rounded-full bg-primary"
        data-test="preview-modified-dot"
        aria-hidden="true"
      />
    </div>
    <div
      v-if="$slots.tags"
      class="preview-tags flex min-w-0 shrink items-center gap-[var(--pxd-space-xs)]"
    >
      <slot name="tags" />
    </div>
    <Button
      v-if="closable"
      variant="ghost"
      size="icon-sm"
      class="preview-close shrink-0 opacity-70 hover:opacity-100"
      data-test="preview-close"
      :aria-label="t('common.close')"
      :title="t('common.close')"
      @click="emit('close')"
    >
      <X aria-hidden="true" />
    </Button>
  </div>
</template>
