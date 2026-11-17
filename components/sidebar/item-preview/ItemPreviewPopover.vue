<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { isNestedMenuInteraction } from '../stat-domain/nested-menu-guard';
import { PREVIEW_POPOVER_CLASS } from './preview-classes';

/**
 * 物品預覽的 Popover 外框（PoB 物品預覽、書籤／歷史搜尋預覽共用）：定位、尺寸與
 * 「點到外面才關閉」的判斷。額外屬性（例如 data-test）套在 PopoverContent 上。
 */
defineOptions({ inheritAttrs: false });

const props = defineProps({
  open: { type: Boolean, default: false },
  side: {
    type: String as PropType<'left' | 'right' | 'top' | 'bottom'>,
    default: 'right',
  },
  reference: { type: Object as PropType<HTMLElement | null>, default: null },
  /** 內容還沒準備好時不渲染 PopoverContent */
  ready: { type: Boolean, default: true },
});

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const anchorReference = computed(() => props.reference ?? undefined);

/**
 * 點擊錨點那一列交給列表自己的切換邏輯（否則外部點擊先關閉、接著的 click 又打開）；
 * Popover 內的下拉選單掛在 Popover 外，側欄在 Shadow DOM 裡時另外判斷（見 nested-menu-guard）。
 */
function handleInteractOutside(event: CustomEvent<{ originalEvent?: Event }>): void {
  const path = event.detail?.originalEvent?.composedPath?.() ?? [];
  if (props.reference && path.includes(props.reference)) {
    event.preventDefault();
    return;
  }
  if (isNestedMenuInteraction(path, (element) => element.hasAttribute('data-item-preview'))) {
    event.preventDefault();
  }
}
</script>

<template>
  <Popover :open="open" @update:open="(value: boolean) => emit('update:open', value)">
    <PopoverAnchor :reference="anchorReference" />
    <PopoverContent
      v-if="open && ready"
      v-bind="$attrs"
      data-item-preview
      :side="side"
      align="start"
      :side-offset="10"
      :collision-padding="10"
      :avoid-collisions="true"
      :class="PREVIEW_POPOVER_CLASS"
      @open-auto-focus.prevent
      @interact-outside="handleInteractOutside"
    >
      <slot />
    </PopoverContent>
  </Popover>
</template>
