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
      class="flex flex-col w-[var(--pxd-search-preview-width)] max-w-[var(--reka-popover-content-available-width,calc(100vw-32px))] max-h-[var(--reka-popover-content-available-height,calc(100vh-32px))] overflow-hidden bg-background p-0"
      @open-auto-focus.prevent
      @interact-outside="handleInteractOutside"
    >
      <TradeSearchPreviewContent
        :preview-data="effectivePreviewData"
        :reset-key="previewData"
        :can-overlay="canOverlay"
        :can-undo="manager.canUndo.value"
        :overlay-busy="manager.busy.value"
        :overlay-hint="overlayHint"
        :source-name="sourceName"
        :can-open-search="canOpenSearch"
        :can-tune="canTune"
        :is-modified="isModified"
        :can-overwrite="canOverwrite"
        :overwrite-busy="overwriteBusy"
        closable
        @close="$emit('update:open', false)"
        @overlay="handleOverlay"
        @undo="manager.undo()"
        @open-search="handleOpenSearch"
        @set-status="applyTune((q) => setTradeQueryStatus(q, $event))"
        @set-stat-group-disabled="
          (idx, disabled) => applyTune((q) => setTradeStatGroupDisabled(q, idx, disabled))
        "
        @set-stat-group-bound="
          (idx, bound, val) => applyTune((q) => setTradeStatGroupBound(q, idx, bound, val))
        "
        @set-stat-filter-disabled="
          (gIdx, fIdx, disabled) =>
            applyTune((q) => setTradeStatFilterDisabled(q, gIdx, fIdx, disabled))
        "
        @set-stat-filter-bound="
          (gIdx, fIdx, bound, val) =>
            applyTune((q) => setTradeStatFilterBound(q, gIdx, fIdx, bound, val))
        "
        @reset-tune="resetTune"
        @overwrite-bookmark="handleOverwriteBookmark"
      />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import TradeSearchPreviewContent from './TradeSearchPreviewContent.vue';
import type { TradeSearchPreviewData } from '../composables/useTradeSearchPreview';
import {
  criteriaFromTradeQuery,
  sliceOverlayCriteria,
  type OverlayTarget,
} from '@/utils/criteria-overlay';
import {
  areTradeQueriesEqual,
  cloneTradeQuery,
  setTradeQueryStatus,
  setTradeStatFilterBound,
  setTradeStatFilterDisabled,
  setTradeStatGroupBound,
  setTradeStatGroupDisabled,
} from '@/utils/trade-query-tuning';
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

const anchorReference = computed(() => props.reference ?? undefined);

const draftQuery = ref<Record<string, unknown> | null>(null);

const resetTune = () => {
  draftQuery.value = cloneTradeQuery(props.rawQuery);
};

watch(
  [() => props.open, () => props.rawQuery, () => props.reference],
  ([open]) => {
    if (open) resetTune();
    else draftQuery.value = null;
  },
  { immediate: true },
);

const isModified = computed(() =>
  Boolean(
    draftQuery.value && props.rawQuery && !areTradeQueriesEqual(draftQuery.value, props.rawQuery),
  ),
);

const canTune = computed(() =>
  Boolean(
    props.canOpenSearch &&
    draftQuery.value &&
    !props.previewData?.loading &&
    !props.previewData?.isLegacy,
  ),
);

const effectivePreviewData = computed<TradeSearchPreviewData | null>(() => {
  const base = props.previewData;
  if (!base || !isModified.value || !draftQuery.value) return base;
  return {
    ...base,
    criteria: criteriaFromTradeQuery(draftQuery.value),
  };
});

function applyTune(mutator: (current: Record<string, unknown>) => Record<string, unknown>): void {
  if (!draftQuery.value) return;
  draftQuery.value = mutator(draftQuery.value);
}

function handleOpenSearch(mode: 'current' | 'new-tab'): void {
  emit('open-search', {
    mode,
    modifiedQuery: isModified.value && draftQuery.value ? cloneTradeQuery(draftQuery.value) : null,
  });
}

function handleOverwriteBookmark(): void {
  if (!isModified.value || !draftQuery.value) return;
  const cloned = cloneTradeQuery(draftQuery.value);
  if (cloned) emit('overwrite-search', cloned);
}

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
  const data = effectivePreviewData.value;
  if (!pageHasForm.value || !data?.criteria || data.loading) return false;
  return !data.gameVersion || data.gameVersion === manager.version;
});

const overlayHint = computed(() => {
  const data = effectivePreviewData.value;
  if (canOverlay.value || !data?.criteria || data.loading) return '';
  if (!pageHasForm.value) return t('searchPreview.hint.notOnSearchPage');
  return t('searchPreview.hint.versionMismatch');
});

/**
 * 點擊錨點那一列交給列表自己的切換邏輯處理；否則外部點擊會先關閉、接著的 click 又把它打開。
 * 同時避免點選 Popover 內的 Select portal 選項時誤關 Popover。
 */
function handleInteractOutside(event: CustomEvent<{ originalEvent?: Event }>) {
  const path = event.detail?.originalEvent?.composedPath?.() ?? [];
  if (props.reference && path.includes(props.reference)) {
    event.preventDefault();
    return;
  }
  const inSelectPortal = path.some(
    (node) => node instanceof HTMLElement && node.dataset?.slot === 'select-content',
  );
  if (inSelectPortal) event.preventDefault();
}

function handleOverlay(target: OverlayTarget) {
  const criteria = effectivePreviewData.value?.criteria;
  if (!criteria) return;
  void manager.overlay(
    sliceOverlayCriteria(criteria, target),
    props.sourceName || t('searchPreview.defaultSourceName'),
  );
}
</script>
