<script setup lang="ts">
import { Bookmark, ClipboardCopy, ExternalLink, Scale } from '@lucide/vue';
import { t } from '@/utils/i18n';

/** 導覽時頁面還沒有搜尋結果，用這張示意卡說明結果列會多出哪些按鈕；不偽造真的結果。 */
const actions = [Bookmark, Scale, ClipboardCopy, ExternalLink] as const;
</script>

<template>
  <figure data-page-guide-mock class="m-0 flex flex-col gap-[var(--pxd-space-xs)]">
    <div
      aria-hidden="true"
      class="flex items-stretch gap-[var(--pxd-space-sm)] rounded-sm border border-dashed border-border bg-muted/40 p-[var(--pxd-space-sm)]"
    >
      <div class="flex flex-col gap-[3px]">
        <span
          v-for="(icon, index) in actions"
          :key="index"
          class="flex size-5 items-center justify-center rounded-sm bg-primary/15 text-primary"
        >
          <component :is="icon" class="size-3" />
        </span>
      </div>
      <div class="flex min-w-0 flex-1 flex-col justify-center gap-[5px]">
        <span class="h-2 w-3/5 rounded-full bg-foreground/40" />
        <span class="h-1.5 w-4/5 rounded-full bg-muted-foreground/40" />
        <span class="h-1.5 w-2/3 rounded-full bg-muted-foreground/40" />
        <span class="h-1.5 w-1/2 rounded-full bg-muted-foreground/40" />
      </div>
    </div>
    <figcaption class="text-[length:var(--pxd-font-caption)] text-muted-foreground">
      {{ t('pageGuide.mock.caption') }}
    </figcaption>
  </figure>
</template>
