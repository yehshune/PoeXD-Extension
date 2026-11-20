<script setup lang="ts">
/**
 * 收合的物品結果列（釘選與看板共用）：固定寬度的圖示區、名稱與灰色資訊、右側價格與狀態、展開箭頭。
 * hover 時右側價格讓位給浮出的操作（`actions` slot），操作停在展開箭頭左側。
 *
 * 外層的 `<li>` 由呼叫端提供，需帶 `group`；傳入的屬性（例如 data-*）會放在可點擊的列上。
 */
import { ChevronDown, ChevronUp } from '@lucide/vue';

defineOptions({ inheritAttrs: false });

defineProps<{
  /** 物品圖示；沒有時仍保留圖示區，讓每一列的文字對齊 */
  icon?: string;
  /** 已售出等狀態時淡化整列 */
  dimmed?: boolean;
  /** 可拖曳排序時改用抓取游標 */
  draggable?: boolean;
  /** 下方已展開詳細內容時，箭頭朝上 */
  expanded?: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <div class="relative">
    <div
      v-bind="$attrs"
      role="button"
      tabindex="0"
      class="flex items-center gap-[var(--pxd-space-md)] px-[var(--pxd-space-md)] py-[var(--pxd-space-lg)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :class="[
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dimmed ? 'opacity-65' : '',
      ]"
      :aria-expanded="expanded === true"
      @click="emit('toggle')"
      @keydown.enter.self.prevent="emit('toggle')"
      @keydown.space.self.prevent="emit('toggle')"
    >
      <slot name="leading" />
      <span
        class="flex size-[var(--control-height-lg)] shrink-0 items-center justify-center"
        data-result-row-icon
      >
        <img
          v-if="icon"
          :src="icon"
          alt=""
          class="max-h-full max-w-full object-contain"
          referrerpolicy="no-referrer"
          draggable="false"
        />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-[var(--pxd-space-xs)]">
        <slot name="title" />
        <slot name="meta" />
      </div>
      <div
        class="flex shrink-0 flex-col items-end gap-[2px] group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
      >
        <slot name="price" />
      </div>
      <component
        :is="expanded ? ChevronUp : ChevronDown"
        class="size-[var(--control-icon-sm)] shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
        aria-hidden="true"
      />
    </div>
    <div
      v-if="$slots.actions"
      class="pxd-hover-actions-overlay absolute inset-y-0 right-[calc(var(--pxd-space-md)+var(--control-icon-sm)+var(--pxd-space-sm))] z-(--pxd-z-raised) flex items-center py-1 pr-[var(--pxd-space-xs)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
