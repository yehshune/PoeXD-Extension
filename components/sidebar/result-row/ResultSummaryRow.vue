<script setup lang="ts">
/**
 * 物品結果列（釘選與看板共用）：
 * - 收合時：固定寬度的小圖示、名稱與灰色資訊、右側價格與狀態、展開箭頭。
 * - 展開後：隱藏原始小圖示，左側顯示 `expanded-icon` 大圖示框（如有提供），
 *   右上維持價格／hover 操作與收合箭頭，其餘內容（名稱、資訊、明細）排在圖示與右上之間。
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
      class="flex gap-[var(--pxd-space-md)] px-[var(--pxd-space-md)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :class="[
        expanded ? 'items-start py-[var(--pxd-space-md)]' : 'items-center py-[var(--pxd-space-lg)]',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dimmed ? 'opacity-65' : '',
      ]"
      :aria-expanded="expanded === true"
      @click="emit('toggle')"
      @keydown.enter.self.prevent="emit('toggle')"
      @keydown.space.self.prevent="emit('toggle')"
    >
      <span v-if="$slots.leading" class="flex shrink-0" :class="expanded ? 'mt-[4px]' : ''">
        <slot name="leading" />
      </span>
      <span
        v-if="!expanded"
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
      <div
        v-else-if="$slots['expanded-icon']"
        data-result-row-expanded-icon
        class="flex size-[var(--pxd-pinned-icon-box-size,88px)] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/80 bg-black/55 p-[var(--pxd-space-xs)]"
      >
        <slot name="expanded-icon" />
      </div>

      <template v-if="expanded">
        <div class="flex min-w-0 flex-1 flex-col gap-[var(--pxd-space-xs)]">
          <div class="relative flex items-start gap-[var(--pxd-space-sm)]">
            <div
              class="flex min-h-[var(--control-height-sm)] min-w-0 flex-1 flex-col justify-center gap-[var(--pxd-space-xs)]"
            >
              <slot name="title" />
            </div>
            <div
              class="flex min-h-[var(--control-height-sm)] shrink-0 flex-col items-end justify-center gap-[2px] group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
            >
              <slot name="price" />
            </div>
            <span class="flex h-[var(--control-height-sm)] shrink-0 items-center">
              <ChevronUp
                class="size-[var(--control-icon-sm)] text-muted-foreground/70 transition-colors group-hover:text-foreground"
                aria-hidden="true"
              />
            </span>
            <div
              v-if="$slots.actions"
              class="pxd-hover-actions-overlay absolute top-0 right-[calc(var(--control-icon-sm)+var(--pxd-space-sm))] z-(--pxd-z-raised) flex min-h-[var(--control-height-sm)] items-center py-0.5 pr-[var(--pxd-space-xs)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto"
              style="--pxd-hover-overlay-bg: color-mix(in srgb, var(--muted) 20%, var(--card))"
            >
              <slot name="actions" />
            </div>
          </div>
          <slot name="meta" />
          <slot name="expanded-details" />
        </div>
      </template>

      <template v-else>
        <div class="flex min-w-0 flex-1 flex-col gap-[var(--pxd-space-xs)]">
          <slot name="title" />
          <slot name="meta" />
        </div>
        <div
          class="flex shrink-0 flex-col items-end gap-[2px] group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
        >
          <slot name="price" />
        </div>
        <ChevronDown
          class="size-[var(--control-icon-sm)] shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
          aria-hidden="true"
        />
      </template>
    </div>
    <div
      v-if="!expanded && $slots.actions"
      class="pxd-hover-actions-overlay absolute inset-y-0 right-[calc(var(--pxd-space-md)+var(--control-icon-sm)+var(--pxd-space-sm))] z-(--pxd-z-raised) flex items-center py-1 pr-[var(--pxd-space-xs)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
