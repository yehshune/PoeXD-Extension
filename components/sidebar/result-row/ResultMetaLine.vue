<script setup lang="ts">
/**
 * 物品結果列的灰色資訊行（釘選與看板共用）：以「 · 」串接片段，狀態片段依 tone 上色。
 * 結尾可放額外的行內元素（例如「同賣家 ×N」）。
 */
import { META_TONE_CLASSES, type MetaPart } from './result-meta';

defineProps<{
  parts: readonly MetaPart[];
  /** 展開時最多兩行，收合時單行截斷 */
  expanded?: boolean;
}>();
</script>

<template>
  <span
    class="text-[length:var(--pxd-font-micro)] text-muted-foreground leading-tight"
    :class="expanded ? 'line-clamp-2 break-words' : 'truncate'"
  >
    <template v-for="(part, index) in parts" :key="index">
      <span v-if="index > 0" aria-hidden="true"> · </span>
      <span :class="part.tone ? META_TONE_CLASSES[part.tone] : undefined" data-meta-part>{{
        part.text
      }}</span>
    </template>
    <slot />
  </span>
</template>
