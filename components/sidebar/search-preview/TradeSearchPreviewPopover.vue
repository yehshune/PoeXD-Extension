<template>
  <Popover :open="open" @update:open="(val: boolean) => $emit('update:open', val)">
    <PopoverAnchor :reference="anchorReference" />
    <PopoverContent
      v-if="open"
      data-test="search-preview-popover"
      :side="side"
      align="start"
      :side-offset="10"
      :collision-padding="10"
      :avoid-collisions="true"
      class="flex flex-col w-[var(--pxd-search-preview-width)] max-h-[var(--reka-popover-content-available-height,calc(100vh-32px))] overflow-hidden p-[var(--pxd-space-lg)]"
      @open-auto-focus.prevent
      @interact-outside="handleInteractOutside"
    >
      <TradeSearchPreviewContent
        :preview-data="previewData"
        :can-overlay="canOverlay"
        :can-undo="manager.canUndo.value"
        :overlay-busy="manager.busy.value"
        :overlay-hint="overlayHint"
        :source-name="sourceName"
        @overlay="handleOverlay"
        @undo="manager.undo()"
      />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import TradeSearchPreviewContent from './TradeSearchPreviewContent.vue';
import type { TradeSearchPreviewData } from '../composables/useTradeSearchPreview';
import { sliceOverlayCriteria, type OverlayTarget } from '@/utils/criteria-overlay';
import { isTradeSearchFormUrl } from '@/entrypoints/content/logic/form-url-sync';
import {
  useCriteriaOverlayManager,
  type CriteriaOverlayManager,
} from '@/components/injected/criteria-overlay-manager';
import { t } from '@/utils/i18n';

/**
 * 以點擊切換、固定顯示的 Search Preview（見 CONTEXT.md）。可從中把條件疊加到目前搜尋。
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  side: {
    type: String as PropType<'left' | 'right' | 'top' | 'bottom'>,
    default: 'right',
  },
  previewData: {
    type: Object as PropType<TradeSearchPreviewData | null>,
    default: null,
  },
  reference: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
  /** 預覽來源的名稱，用於疊加後的提示。 */
  sourceName: { type: String, default: '' },
  /** 測試可注入；正式環境使用頁面共用的管理器。 */
  manager: {
    type: Object as PropType<CriteriaOverlayManager | null>,
    default: null,
  },
  /** 測試可注入；預設讀取目前網址。 */
  readUrl: {
    type: Function as PropType<() => string>,
    default: () => window.location.href,
  },
});

defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const manager = props.manager ?? useCriteriaOverlayManager();

const anchorReference = computed(() => props.reference ?? undefined);

/** 每次開啟時重新判斷目前頁面是否有可寫入的官方搜尋表單。 */
const pageHasForm = ref(false);
watch(
  () => props.open,
  (open) => {
    if (open) pageHasForm.value = isTradeSearchFormUrl(props.readUrl());
  },
  { immediate: true },
);

const canOverlay = computed(() => {
  const data = props.previewData;
  if (!pageHasForm.value || !data?.criteria || data.loading) return false;
  return !data.gameVersion || data.gameVersion === manager.version;
});

const overlayHint = computed(() => {
  const data = props.previewData;
  if (canOverlay.value || !data?.criteria || data.loading) return '';
  if (!pageHasForm.value) return t('searchPreview.hint.notOnSearchPage');
  return t('searchPreview.hint.versionMismatch');
});

/**
 * 點擊錨點那一列交給列表自己的切換邏輯處理；否則外部點擊會先關閉、接著的 click 又把它打開。
 */
function handleInteractOutside(event: CustomEvent<{ originalEvent?: Event }>) {
  const path = event.detail?.originalEvent?.composedPath?.() ?? [];
  if (props.reference && path.includes(props.reference)) event.preventDefault();
}

function handleOverlay(target: OverlayTarget) {
  const criteria = props.previewData?.criteria;
  if (!criteria) return;
  void manager.overlay(
    sliceOverlayCriteria(criteria, target),
    props.sourceName || t('searchPreview.defaultSourceName'),
  );
}
</script>
