<template>
  <ItemPreviewPopover
    :open="open"
    :side="side"
    :reference="reference"
    data-test="search-preview-popover"
    @update:open="(val: boolean) => $emit('update:open', val)"
  >
    <TradeSearchPreviewContent
      :preview-data="draft.effectivePreviewData.value"
      :reset-key="previewData"
      :can-overlay="draft.canOverlay.value"
      :can-undo="manager.canUndo.value"
      :overlay-busy="manager.busy.value"
      :overlay-hint="draft.overlayHint.value"
      :source-name="sourceName"
      :can-open-search="canOpenSearch"
      :can-tune="draft.canTune.value"
      :is-modified="draft.isModified.value"
      :can-overwrite="canOverwrite"
      :overwrite-busy="overwriteBusy"
      :overwrite-label="overwriteLabel"
      :overwrite-title="overwriteTitle"
      :can-tune-status="!statsOnly"
      closable
      @close="$emit('update:open', false)"
      @overlay="draft.overlay"
      @undo="manager.undo()"
      @open-search="handleOpenSearch"
      @set-status="draft.setStatus"
      @set-stat-group-disabled="draft.setStatGroupDisabled"
      @set-stat-group-bound="draft.setStatGroupBound"
      @set-stat-group-type="draft.setStatGroupType"
      @set-stat-filter-disabled="draft.setStatFilterDisabled"
      @set-stat-filter-bound="draft.setStatFilterBound"
      @set-stat-filter-domain="draft.setStatFilterDomain"
      @reset-tune="draft.resetTune"
      @overwrite-bookmark="handleOverwriteBookmark"
    />
  </ItemPreviewPopover>
</template>

<script setup lang="ts">
import type { PropType } from 'vue';
import ItemPreviewPopover from '../item-preview/ItemPreviewPopover.vue';
import TradeSearchPreviewContent from './TradeSearchPreviewContent.vue';
import {
  useSearchPreviewDraft,
  type TradeSearchPreviewData,
} from '../composables/useTradeSearchPreview';
import {
  useCriteriaOverlayManager,
  type CriteriaOverlayManager,
} from '@/entrypoints/content/logic/criteria-overlay-manager';

/**
 * 以點擊切換、固定顯示的 Search Preview（見 GLOSSARY.md）。可從中把條件疊加到目前搜尋。
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
  /** 是否在預覽工具列顯示前往搜尋／開新分頁按鈕。 */
  canOpenSearch: { type: Boolean, default: false },
  /** 解碼後的原始 query JSON，供書籤／歷史臨時微調條件。 */
  rawQuery: {
    type: Object as PropType<Record<string, unknown> | null>,
    default: null,
  },
  /** 書籤預覽允許把微調結果覆蓋寫回書籤。 */
  canOverwrite: { type: Boolean, default: false },
  overwriteBusy: { type: Boolean, default: false },
  overwriteLabel: { type: String, default: '' },
  overwriteTitle: { type: String, default: '' },
  /** 沒有搜尋網址也允許以 rawQuery 暫時微調（常用詞綴群組）。 */
  tunable: { type: Boolean, default: false },
  /** 條件只有詞綴群組（常用詞綴群組），不提供上架狀態微調。 */
  statsOnly: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (
    e: 'open-search',
    payload: { mode: 'current' | 'new-tab'; modifiedQuery: Record<string, unknown> | null },
  ): void;
  (e: 'overwrite-search', modifiedQuery: Record<string, unknown>): void;
}>();

const manager = props.manager ?? useCriteriaOverlayManager();

const draft = useSearchPreviewDraft({
  open: () => props.open,
  previewData: () => props.previewData,
  rawQuery: () => props.rawQuery,
  reference: () => props.reference,
  sourceName: () => props.sourceName,
  canOpenSearch: () => props.canOpenSearch,
  tunable: () => props.tunable,
  manager,
  readUrl: () => props.readUrl(),
});

function handleOpenSearch(mode: 'current' | 'new-tab'): void {
  emit('open-search', { mode, modifiedQuery: draft.getModifiedQuery() });
}

function handleOverwriteBookmark(): void {
  const cloned = draft.consumeDraftForOverwrite();
  if (cloned) emit('overwrite-search', cloned);
}
</script>
