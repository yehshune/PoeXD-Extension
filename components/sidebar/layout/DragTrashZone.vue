<script setup lang="ts">
import { Trash2 } from '@lucide/vue';
import { t } from '@/utils/i18n';

/**
 * 側邊欄拖曳刪除的垃圾桶：拖曳開始時從側邊欄外側滑出。
 * 拖放偵測由 `useDragTrash().setupTrashListeners` 綁在根元素上；懸停文字可用預設 slot 覆寫。
 */
defineProps<{
  visible: boolean;
  overTrash: boolean;
  sidebarPosition: 'left' | 'right';
}>();
</script>

<template>
  <div
    class="drag-trash-zone fixed top-[10%] h-[80%] w-[90px] z-(--pxd-z-sidebar-overlay) flex flex-col items-center justify-center gap-[var(--pxd-space-lg)] bg-[color-mix(in_srgb,var(--destructive)_15%,transparent)] border border-dashed border-destructive rounded-[var(--radius)] text-destructive text-[length:var(--pxd-font-secondary)] font-bold box-border py-5 px-2.5 pointer-events-none opacity-0 shadow-lg [&_*]:pointer-events-none"
    :class="{
      visible,
      'sidebar-left': sidebarPosition === 'left',
      'sidebar-right': sidebarPosition === 'right',
    }"
  >
    <Trash2 class="trash-icon-svg size-[20px] text-destructive shrink-0" />
    <template v-if="overTrash">
      <slot>
        <div class="text-center text-xs font-bold leading-snug select-none">
          {{ t('sidebar.trash.releaseHint') }}
        </div>
      </slot>
    </template>
    <span
      v-else
      class="block w-[1.2em] [word-wrap:break-word] text-center leading-[1.4] tracking-normal"
    >
      {{ t('sidebar.trash.hint') }}
    </span>
  </div>
</template>

<style scoped>
.drag-trash-zone {
  transition:
    transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
}

/* 側邊欄在右側時，垃圾桶放在左外側並預設向右偏移藏在側邊欄內 */
.drag-trash-zone.sidebar-right {
  transform: translateX(100%) scaleX(0.8);
}

/* 側邊欄在左側時，垃圾桶放在右外側並預設向左偏移藏在側邊欄內 */
.drag-trash-zone.sidebar-left {
  transform: translateX(-100%) scaleX(0.8);
}

/* 開始拖曳時滑出並顯示 */
.drag-trash-zone.visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0) scaleX(1);
}

/* 拖曳物件懸停在垃圾桶上方時 */
.drag-trash-zone.drag-hover {
  background-color: var(--destructive) !important;
  border-style: solid !important;
  border-color: var(--destructive) !important;
  color: var(--destructive-foreground) !important;
  transform: scale(1.05);
  box-shadow: var(--shadow-2xl);
}

.drag-trash-zone.drag-hover .trash-icon-svg {
  color: var(--destructive-foreground);
}
</style>
