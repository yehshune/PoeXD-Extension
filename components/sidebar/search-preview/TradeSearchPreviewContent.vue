<template>
  <div
    v-if="previewData"
    ref="rootRef"
    :style="lockedHeight ? { minHeight: `${lockedHeight}px` } : undefined"
    class="trade-search-preview-popover bookmark-preview-popover flex min-h-0 flex-1 flex-col text-[length:var(--pxd-font-body)]"
  >
    <!-- 固定標題列（比照詞綴選擇器）：來源名稱、標籤與關閉鈕，不隨內容捲動 -->
    <ItemPreviewHeader
      :title="headerTitle"
      :closable="closable"
      :modified="isModified"
      @close="emit('close')"
    >
      <template v-if="hasTags" #tags>
        <span
          v-if="previewData.realmLabel"
          :class="['preview-tag realm-tag', PREVIEW_TAG_CLASS.secondary]"
        >
          {{ previewData.realmLabel }}
        </span>
        <span
          v-if="previewData.league"
          :class="['preview-tag league-tag', PREVIEW_TAG_CLASS.muted]"
          :title="previewData.league"
        >
          {{ previewData.league }}
        </span>
      </template>
    </ItemPreviewHeader>

    <!-- 整合式單行頂部工具列：左側搜尋與微調存回、右側摺疊與疊加，固定單行避免微調時面板上下位移 -->
    <div
      v-if="canOpenSearch || isModified || sectionKeys.length > 1 || canOverlay || overlayHint"
      :class="PREVIEW_TOOLBAR_CLASS"
    >
      <div
        v-if="canOpenSearch || isModified"
        class="preview-search-row flex min-w-0 shrink-0 items-center gap-[var(--pxd-space-xs)]"
      >
        <Button
          v-if="canOpenSearch"
          variant="secondary"
          size="sm"
          class="preview-overlay-btn border-transparent px-[var(--pxd-space-sm)] shadow-none"
          data-test="preview-open-current"
          :title="t('bookmark.row.openSearch')"
          @click="emit('open-search', 'current')"
        >
          <Search aria-hidden="true" />{{ t('bookmark.row.openSearch') }}
        </Button>
        <Button
          v-if="canOpenSearch"
          variant="ghost"
          size="icon-sm"
          class="preview-overlay-btn shrink-0 text-foreground/80"
          data-test="preview-open-new-tab"
          :title="t('common.openNewTab')"
          :aria-label="t('common.openNewTab')"
          @click="emit('open-search', 'new-tab')"
        >
          <ExternalLink aria-hidden="true" />
          <span class="sr-only">{{ t('common.openNewTab') }}</span>
        </Button>
        <span
          v-if="canOpenSearch && isModified"
          class="h-4 w-px shrink-0 bg-border/60"
          aria-hidden="true"
        />
        <Button
          v-if="canOverwrite && isModified"
          variant="outline"
          size="sm"
          class="preview-overlay-btn border-primary/50 bg-primary/10 px-[var(--pxd-space-sm)] text-primary shadow-none"
          data-test="preview-overwrite-bookmark"
          :title="overwriteTitle || t('searchPreview.action.overwriteBookmarkTitle')"
          :disabled="overwriteBusy"
          @click="emit('overwrite-bookmark')"
        >
          <Save aria-hidden="true" />{{
            overwriteLabel || t('searchPreview.action.overwriteBookmark')
          }}
        </Button>
        <Button
          v-if="isModified"
          variant="ghost"
          size="icon-sm"
          class="preview-overlay-btn shrink-0"
          data-test="preview-reset-tune"
          :title="t('searchPreview.action.resetTuneTitle')"
          :aria-label="t('searchPreview.action.resetTune')"
          @click="emit('reset-tune')"
        >
          <RotateCcw aria-hidden="true" />
          <span class="sr-only">{{ t('searchPreview.action.resetTune') }}</span>
        </Button>
      </div>

      <div
        v-if="sectionKeys.length > 1 || canOverlay || overlayHint"
        class="preview-action-row ml-auto flex min-w-0 flex-1 items-center justify-end gap-[var(--pxd-space-xs)]"
      >
        <Button
          v-if="sectionKeys.length > 1"
          variant="ghost"
          size="icon-sm"
          class="preview-toggle-all shrink-0"
          :title="allExpanded ? t('common.collapseAll') : t('common.expandAll')"
          :aria-label="allExpanded ? t('common.collapseAll') : t('common.expandAll')"
          @click="toggleAll"
        >
          <ChevronsDownUp v-if="allExpanded" aria-hidden="true" />
          <ChevronsUpDown v-else aria-hidden="true" />
          <span class="sr-only">{{
            allExpanded ? t('common.collapseAll') : t('common.expandAll')
          }}</span>
        </Button>
        <div
          v-if="canOverlay"
          class="preview-overlay-actions flex shrink-0 items-center gap-[var(--pxd-space-xs)]"
        >
          <Button
            variant="ghost"
            size="sm"
            class="preview-overlay-btn px-[var(--pxd-space-sm)] text-foreground/85"
            data-test="preview-overlay-all"
            :title="t('searchPreview.action.overlayAllTitle')"
            :disabled="overlayBusy || !hasCriteria"
            @click="emit('overlay', { kind: 'all' })"
          >
            <Plus aria-hidden="true" />{{ t('searchPreview.action.overlayAll') }}
          </Button>
          <Button
            v-if="canUndo"
            variant="ghost"
            size="icon-sm"
            class="preview-overlay-btn shrink-0"
            data-test="preview-overlay-undo"
            :title="t('common.undoLastOverlay')"
            :aria-label="t('common.undo')"
            :disabled="overlayBusy"
            @click="emit('undo')"
          >
            <Undo2 aria-hidden="true" />
            <span class="sr-only">{{ t('common.undo') }}</span>
          </Button>
        </div>
        <span
          v-else-if="overlayHint"
          class="preview-overlay-hint min-w-0 truncate text-[length:var(--pxd-font-caption)] text-muted-foreground"
          data-test="preview-overlay-hint"
          :title="overlayHint"
          >{{ overlayHint }}</span
        >
      </div>
    </div>

    <div
      class="preview-body min-h-0 flex-1 overflow-y-auto pxd-scrollbar p-[var(--pxd-pane-padding)]"
    >
      <div
        v-if="previewData.loading"
        class="preview-loading py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] text-muted-foreground"
      >
        {{ t('searchPreview.loading') }}
      </div>

      <div
        v-else-if="previewData.isLegacy"
        class="preview-legacy py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] text-muted-foreground"
      >
        {{ t('searchPreview.decodeFailed') }}
      </div>

      <div
        v-else-if="previewData.meta"
        class="preview-content flex flex-col gap-[var(--pxd-space-md)]"
      >
        <div
          v-if="
            previewData.meta.name ||
            previewData.meta.type ||
            (criteria && (criteria.status || (canTune && canTuneStatus)))
          "
          :class="[PREVIEW_META_BLOCK_CLASS, 'flex flex-col gap-[var(--pxd-space-xs)]']"
        >
          <div
            v-if="previewData.meta.name || previewData.meta.type"
            class="preview-section item-names flex items-center justify-between gap-[var(--pxd-space-sm)]"
          >
            <div
              class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-[var(--pxd-space-md)] gap-y-[var(--pxd-space-xs)] leading-[1.25]"
            >
              <div v-if="previewData.meta.name" class="preview-item-name text-foreground">
                <span class="text-muted-foreground">{{ t('searchPreview.label.item') }}</span>
                <span class="highlight-unique font-semibold text-foreground">{{
                  previewData.meta.name
                }}</span>
              </div>
              <div v-if="previewData.meta.type" class="preview-item-type text-muted-foreground">
                {{ t('searchPreview.label.base')
                }}<span class="text-foreground">{{ previewData.meta.type }}</span>
              </div>
            </div>
            <Button
              v-if="canOverlay && criteria?.item"
              variant="ghost"
              size="icon-sm"
              class="preview-overlay-icon shrink-0"
              data-test="preview-overlay-item"
              :title="t('searchPreview.action.overlayItemTitle')"
              :disabled="overlayBusy"
              @click="emit('overlay', { kind: 'item' })"
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>

          <div
            v-if="criteria && (criteria.status || (canTune && canTuneStatus))"
            class="preview-section preview-status flex items-center justify-between gap-[var(--pxd-space-md)] text-[length:var(--pxd-font-body)]"
            :class="
              previewData.meta.name || previewData.meta.type
                ? 'border-t border-border/30 pt-[var(--pxd-space-xs)]'
                : ''
            "
          >
            <div class="flex min-w-0 flex-1 items-center gap-[var(--pxd-space-sm)]">
              <span class="shrink-0 text-muted-foreground">{{
                t('searchPreview.label.status')
              }}</span>
              <Select
                v-if="canTune && canTuneStatus"
                :model-value="criteria.status || undefined"
                @update:model-value="(val) => emit('set-status', String(val))"
              >
                <SelectTrigger
                  size="sm"
                  :class="PREVIEW_COMPACT_SELECT_CLASS"
                  data-test="preview-status-select"
                >
                  <SelectValue>{{
                    criteria.status
                      ? (STATUS_LABELS[criteria.status] ?? criteria.status)
                      : t('searchPreview.statusUnset')
                  }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in statusOptions" :key="option" :value="option">
                    {{ STATUS_LABELS[option] ?? option }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <span v-else-if="criteria.status" class="text-foreground">{{
                STATUS_LABELS[criteria.status] ?? criteria.status
              }}</span>
            </div>
            <Button
              v-if="canOverlay && criteria.status"
              variant="ghost"
              size="icon-sm"
              class="preview-overlay-icon shrink-0"
              data-test="preview-overlay-status"
              :title="t('searchPreview.action.overlayStatusTitle')"
              :disabled="overlayBusy"
              @click="emit('overlay', { kind: 'status' })"
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div v-if="statCount > 0" class="preview-section">
          <div :class="sectionHeaderClass">
            <button
              type="button"
              :class="sectionToggleClass"
              :aria-expanded="!isCollapsed(STATS_SECTION_KEY)"
              @click="toggleSection(STATS_SECTION_KEY)"
            >
              <ChevronRight :class="chevronClass(STATS_SECTION_KEY)" aria-hidden="true" />
              <span :class="sectionTitleClass">{{ t('searchPreview.section.stats') }}</span>
              <span :class="sectionCountClass">({{ statCount }})</span>
            </button>
            <Button
              v-if="canOverlay && statGroups.length > 1"
              variant="ghost"
              size="icon-sm"
              class="preview-overlay-icon shrink-0"
              data-test="preview-overlay-stats"
              :title="t('searchPreview.action.overlayAllStatsTitle')"
              :disabled="overlayBusy"
              @click="emit('overlay', { kind: 'stats' })"
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          <div
            v-if="statGroups.length > 0"
            v-show="!isCollapsed(STATS_SECTION_KEY)"
            class="preview-stats-list flex flex-col gap-[var(--pxd-space-sm)]"
          >
            <div
              v-for="(group, groupIndex) in statGroups"
              :key="groupIndex"
              :class="[
                'preview-stat-group',
                PREVIEW_CARD_CLASS,
                group.disabled ? 'opacity-60 grayscale' : '',
              ]"
              :data-stat-group-index="groupIndex"
              :data-disabled="group.disabled ? 'true' : undefined"
            >
              <div :class="['preview-stat-group-header', PREVIEW_GROUP_HEADER_CLASS]">
                <Checkbox
                  v-if="canTune"
                  data-test="preview-stat-group-toggle"
                  :model-value="!group.disabled"
                  :aria-label="groupTypeLabel(group)"
                  @update:model-value="
                    (val) => emit('set-stat-group-disabled', groupIndex, val !== true)
                  "
                />
                <StatGroupTypeSelect
                  v-if="canTune"
                  class="preview-stat-group-type"
                  data-test="preview-stat-group-type"
                  :type="group.type"
                  :options="groupTypeOptions(group)"
                  @select="(type) => emit('set-stat-group-type', groupIndex, type)"
                />
                <span
                  v-else
                  class="preview-stat-group-type whitespace-nowrap font-semibold text-foreground"
                  >{{ groupTypeLabel(group) }}</span
                >
                <span
                  v-if="canTune && isGroupValueEditable(group.type)"
                  class="inline-flex items-center gap-[var(--pxd-space-xs)]"
                >
                  <Input
                    size="sm"
                    type="number"
                    inputmode="decimal"
                    step="any"
                    data-test="preview-stat-group-min"
                    :class="PREVIEW_BOUND_INPUT_CLASS"
                    :model-value="boundInputValue(group.value?.min)"
                    :placeholder="t('tierDropdown.minPlaceholder')"
                    :disabled="Boolean(group.disabled)"
                    :aria-label="t('tierDropdown.minPlaceholder')"
                    @input="(e: Event) => handleGroupBoundInput(groupIndex, 'min', e)"
                    @change="
                      (e: Event) =>
                        emit('set-stat-group-bound', groupIndex, 'min', parseBoundInput(e))
                    "
                    @keydown.enter.prevent="blurInputTarget"
                  />
                  <Input
                    size="sm"
                    type="number"
                    inputmode="decimal"
                    step="any"
                    data-test="preview-stat-group-max"
                    :class="PREVIEW_BOUND_INPUT_CLASS"
                    :model-value="boundInputValue(group.value?.max)"
                    :placeholder="t('tierDropdown.maxPlaceholder')"
                    :disabled="Boolean(group.disabled)"
                    :aria-label="t('tierDropdown.maxPlaceholder')"
                    @input="(e: Event) => handleGroupBoundInput(groupIndex, 'max', e)"
                    @change="
                      (e: Event) =>
                        emit('set-stat-group-bound', groupIndex, 'max', parseBoundInput(e))
                    "
                    @keydown.enter.prevent="blurInputTarget"
                  />
                </span>
                <span
                  v-else-if="rangeText(group.value)"
                  class="whitespace-nowrap font-mono text-foreground"
                  >{{ rangeText(group.value) }}</span
                >
                <span
                  v-if="group.disabled"
                  class="preview-stat-group-disabled whitespace-nowrap rounded-sm bg-muted px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
                  >{{ t('searchPreview.statGroup.disabled') }}</span
                >
                <span
                  class="whitespace-nowrap text-[length:var(--pxd-font-caption)] text-muted-foreground"
                  >{{ group.filters.length }}
                  {{
                    group.filters.length === 1
                      ? t('criteriaOverlay.statGroup.filterUnitSingle')
                      : t('criteriaOverlay.statGroup.filterUnitPlural')
                  }}</span
                >
                <Button
                  v-if="canOverlay && !isSingleStatGroupOnly"
                  variant="ghost"
                  size="sm"
                  class="preview-overlay-btn ml-auto px-[var(--pxd-space-xs)] text-foreground/85"
                  data-test="preview-overlay-stat-group"
                  :title="t('searchPreview.action.overlayStatGroupTitle')"
                  :disabled="overlayBusy"
                  @click="emit('overlay', { kind: 'stat-group', index: groupIndex })"
                >
                  <Plus aria-hidden="true" />{{ t('searchPreview.action.overlay') }}
                </Button>
              </div>
              <PreviewStatRow
                v-for="(item, idx) in displayedStatGroups[groupIndex].rows"
                :key="idx"
                :domain="item.domain"
                :domains="item.domains"
                :domain-disabled="Boolean(group.disabled)"
                :version="previewData.gameVersion"
                :lines="item.lines"
                :title="formatStatTitle(item.lines, item.filter.id)"
                wrap
                :checked="canTune ? !item.filter.disabled : undefined"
                :toggle-disabled="Boolean(group.disabled)"
                :bounds="canTune ? statBounds(item.filter) : null"
                :bounds-disabled="Boolean(item.filter.disabled || group.disabled)"
                :range-text="rangeText(item.filter.value)"
                :dimmed="Boolean(item.filter.disabled)"
                @toggle="(checked) => emit('set-stat-filter-disabled', groupIndex, idx, !checked)"
                @select-domain="
                  (domain) => emit('set-stat-filter-domain', groupIndex, idx, domain, item.domains)
                "
                @commit-bound="
                  (bound, value) => emit('set-stat-filter-bound', groupIndex, idx, bound, value)
                "
              />
            </div>
          </div>
          <div
            v-else
            v-show="!isCollapsed(STATS_SECTION_KEY)"
            :class="['preview-stats-list', PREVIEW_CARD_CLASS]"
          >
            <PreviewStatRow
              v-for="(item, idx) in displayedStats"
              :key="idx"
              :domain="item.domain"
              :version="previewData.gameVersion"
              :lines="item.lines"
              :title="formatStatTitle(item.lines, item.stat.id)"
              wrap
              :range-text="flatRangeText(item.stat)"
            />
          </div>
        </div>

        <div
          v-for="group in filterGroups"
          :key="group.key"
          class="preview-section filter-group-section"
        >
          <div :class="sectionHeaderClass">
            <button
              type="button"
              :class="sectionToggleClass"
              :aria-expanded="!isCollapsed(group.key)"
              @click="toggleSection(group.key)"
            >
              <ChevronRight :class="chevronClass(group.key)" aria-hidden="true" />
              <span :class="sectionTitleClass" class="filter-group-title filter-title">{{
                translateFilterGroup(group.key, previewData?.gameVersion)
              }}</span>
              <span :class="sectionCountClass">({{ group.filters.length }})</span>
            </button>
            <Button
              v-if="canOverlay && hasSection(group.key)"
              variant="ghost"
              size="icon-sm"
              class="preview-overlay-icon shrink-0"
              data-test="preview-overlay-section"
              :data-section="group.key"
              :title="t('searchPreview.action.overlaySectionTitle')"
              :disabled="overlayBusy"
              @click="emit('overlay', { kind: 'section', section: group.key })"
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          <div
            v-show="!isCollapsed(group.key)"
            :class="['preview-filters-list', PREVIEW_CARD_CLASS]"
          >
            <div
              v-for="(item, idx) in group.filters"
              :key="`${group.key}.${item.fieldKey}.${idx}`"
              class="preview-filter-row"
              :class="rowClass"
            >
              <span class="filter-key truncate text-muted-foreground">{{
                translateFilterKey(item.fieldKey, previewData?.gameVersion)
              }}</span>
              <span class="filter-val shrink-0 font-mono text-foreground">{{
                formatFilterValue(item.value, item.fieldKey, previewData?.gameVersion)
              }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="totalDetailsCount === 0 && !criteria?.status"
          class="preview-empty py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] text-muted-foreground"
        >
          {{ t('searchPreview.emptyCriteria') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Plus,
  RotateCcw,
  Save,
  Search,
  Undo2,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { t } from '@/utils/i18n';
import type { OverlayTarget, CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';
import { extractStatDomain } from '@/utils/stat-domain';
import {
  isGroupValueEditable,
  isNumericStatFilter,
  STAT_GROUP_TYPES,
  type StatGroupType,
} from '@/utils/trade-query-tuning';
import { getOfficialStatDomains } from '@/utils/official-stat-text';
import ItemPreviewHeader from '../item-preview/ItemPreviewHeader.vue';
import PreviewStatRow, { type PreviewStatBounds } from '../item-preview/PreviewStatRow.vue';
import StatGroupTypeSelect from '../item-preview/StatGroupTypeSelect.vue';
import {
  PREVIEW_BOUND_INPUT_CLASS,
  PREVIEW_CARD_CLASS,
  PREVIEW_COMPACT_SELECT_CLASS,
  PREVIEW_GROUP_HEADER_CLASS,
  PREVIEW_META_BLOCK_CLASS,
  PREVIEW_STAT_ROW_CLASS,
  PREVIEW_TAG_CLASS,
  PREVIEW_TOOLBAR_CLASS,
} from '../item-preview/preview-classes';
import {
  rangeText,
  STAT_GROUP_TYPE_LABELS,
  STATUS_LABELS,
} from '@/components/injected/criteria-overlay-labels';
import type { TradeSearchPreviewData } from '../composables/useTradeSearchPreview';
import type { ExtractedFilterItem } from '@/utils/trade-url-codec';
import {
  formatFilterValue,
  translateFilterGroup,
  translateFilterKey,
  translateStatLines,
} from '@/utils/trade-stat-dictionary';

const props = defineProps({
  previewData: {
    type: Object as PropType<TradeSearchPreviewData | null>,
    default: null,
  },
  /** 用於區分「切換新搜尋目標」與「暫存微調 criteria 更新」的重置鍵；省略時跟隨 previewData。 */
  resetKey: {
    type: [Object, String, Number] as PropType<TradeSearchPreviewData | string | number | null>,
    default: undefined,
  },
  /** 目前頁面有官方搜尋表單時才可疊加（見 GLOSSARY.md「Criteria Overlay」）。 */
  canOverlay: {
    type: Boolean,
    default: false,
  },
  canUndo: {
    type: Boolean,
    default: false,
  },
  overlayBusy: {
    type: Boolean,
    default: false,
  },
  /** 無法疊加時給使用者的原因（例如不在搜尋頁）。 */
  overlayHint: {
    type: String,
    default: '',
  },
  /** 預覽來源的名稱（書籤、歷史紀錄或常用詞綴群組），顯示在標題列。 */
  sourceName: {
    type: String,
    default: '',
  },
  /** 固定顯示的預覽在標題列提供關閉鈕；滑過即顯示的預覽不需要。 */
  closable: {
    type: Boolean,
    default: false,
  },
  /** 書籤／歷史等帶有網址的預覽可顯示快捷開啟搜尋按鈕。 */
  canOpenSearch: {
    type: Boolean,
    default: false,
  },
  /** 是否允許在預覽中臨時勾選與修改詞綴數值／上架狀態。 */
  canTune: {
    type: Boolean,
    default: false,
  },
  /** 目前預覽的條件是否已經與原始搜尋不同。 */
  isModified: {
    type: Boolean,
    default: false,
  },
  /** 書籤預覽提供「覆蓋回書籤」按鈕。 */
  canOverwrite: {
    type: Boolean,
    default: false,
  },
  /** 覆蓋按鈕的文字與提示；省略時為「覆蓋回書籤」 */
  overwriteLabel: { type: String, default: '' },
  overwriteTitle: { type: String, default: '' },
  /** 微調時可改上架狀態；常用詞綴群組只有詞綴，不提供 */
  canTuneStatus: { type: Boolean, default: true },
  overwriteBusy: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  overlay: [target: OverlayTarget];
  undo: [];
  close: [];
  'open-search': [mode: 'current' | 'new-tab'];
  'set-status': [status: string];
  'set-stat-group-disabled': [groupIndex: number, disabled: boolean];
  'set-stat-group-bound': [groupIndex: number, bound: 'min' | 'max', value: number | null];
  'set-stat-group-type': [groupIndex: number, type: StatGroupType];
  'set-stat-filter-disabled': [groupIndex: number, filterIndex: number, disabled: boolean];
  'set-stat-filter-bound': [
    groupIndex: number,
    filterIndex: number,
    bound: 'min' | 'max',
    value: number | null,
  ];
  /** 換掉詞綴條件的網域前綴；allowed 為這個代碼可切換的前綴 */
  'set-stat-filter-domain': [
    groupIndex: number,
    filterIndex: number,
    domain: string,
    allowed: readonly string[],
  ];
  'reset-tune': [];
  'overwrite-bookmark': [];
}>();

/** 版面比照詞綴選擇器（FilterPane／ModItem）：共用類別見 item-preview/preview-classes。 */
/** 分區標頭比照 FilterPane 的群組標頭，右側留白與頂部摘要區塊對齊使「＋」按鈕落在同一垂直軸線。 */
const sectionHeaderClass =
  'preview-section-header mb-[var(--pxd-space-xs)] flex items-center gap-[var(--pxd-space-xs)] pr-[var(--pxd-space-xs)]';
const sectionTitleClass =
  'preview-section-title min-w-0 truncate text-[length:var(--pxd-font-section-title)] font-semibold text-current';
const sectionCountClass =
  'preview-section-count shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground';
/** 篩選條件列比照詞綴列 */
const rowClass = PREVIEW_STAT_ROW_CLASS;

const STATUS_OPTION_ORDER = ['securable', 'available', 'online', 'onlineleague', 'any'] as const;

const statusOptions = computed(() => {
  const current = criteria.value?.status;
  return current && !STATUS_OPTION_ORDER.includes(current as (typeof STATUS_OPTION_ORDER)[number])
    ? [current, ...STATUS_OPTION_ORDER]
    : [...STATUS_OPTION_ORDER];
});

function boundInputValue(value: unknown): string | number {
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

/** 數值型條件可編輯下限／上限；選項型條件不能改 */
function statBounds(filter: CriteriaOverlayStatGroup['filters'][number]): PreviewStatBounds | null {
  if (!isNumericStatFilter(filter)) return null;
  const toBound = (value: unknown) =>
    typeof value === 'number' || typeof value === 'string' ? value : undefined;
  return { min: toBound(filter.value?.min), max: toBound(filter.value?.max) };
}

/** 攤平的詞綴（舊版 metadata）只顯示範圍文字 */
function flatRangeText(stat: { min?: number; max?: number }): string {
  const parts = [
    stat.min !== undefined ? `≥${stat.min}` : '',
    stat.max !== undefined ? `≤${stat.max}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

function parseBoundInput(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function handleGroupBoundInput(groupIndex: number, bound: 'min' | 'max', event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.validity?.badInput) return;
  const raw = input.value.trim();
  if (raw === '-' || raw.endsWith('.')) return;
  if (raw === '') {
    emit('set-stat-group-bound', groupIndex, bound, null);
    return;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) emit('set-stat-group-bound', groupIndex, bound, parsed);
}

function formatStatTitle(lines: readonly string[], statId?: string): string {
  const text = lines.join(' / ');
  return statId ? `${text}\n${statId}` : text;
}

function blurInputTarget(event: Event): void {
  (event.target as HTMLInputElement).blur();
}

const criteria = computed(() => props.previewData?.criteria);
const statGroups = computed(() => criteria.value?.statGroups ?? []);
const hasCriteria = computed(() => {
  const c = criteria.value;
  return Boolean(c && (c.item || c.status || c.statGroups.length > 0 || c.fields.length > 0));
});
/** 整個預覽只有單一詞綴群組且無其他條件時，工具列的「全部疊加」已涵蓋，略過卡片內重複疊加鈕 */
const isSingleStatGroupOnly = computed(() => {
  const c = criteria.value;
  return Boolean(
    statGroups.value.length === 1 &&
    filterGroups.value.length === 0 &&
    !c?.item &&
    !c?.status &&
    !c?.fields.length,
  );
});

function hasSection(section: string): boolean {
  return Boolean(criteria.value?.fields.some((f) => f.section === section));
}

/** 群組類別選單：市集支援的類別；原本是不認得的類別時保留在最前面 */
function groupTypeOptions(group: CriteriaOverlayStatGroup): string[] {
  const known: readonly string[] = STAT_GROUP_TYPES;
  return known.includes(group.type) ? [...known] : [group.type, ...known];
}

function groupTypeLabel(group: CriteriaOverlayStatGroup): string {
  return STAT_GROUP_TYPE_LABELS[group.type] ?? group.type;
}

function describeStatRow(statId: string) {
  return {
    domain: extractStatDomain(statId),
    lines: translateStatLines(statId, props.previewData?.gameVersion),
  };
}

const displayedStatGroups = computed(() =>
  statGroups.value.map((group) => ({
    group,
    rows: group.filters.map((filter) => ({
      filter,
      ...describeStatRow(filter.id),
      // 可微調時才提供切換；同一個代碼後綴在市集上有兩種以上前綴才顯示選單
      domains: props.canTune
        ? getOfficialStatDomains(filter.id, props.previewData?.gameVersion ?? 'poe1')
        : [],
    })),
  })),
);

const displayedStats = computed(() =>
  stats.value.map((stat) => ({
    stat,
    ...describeStatRow(stat.id),
  })),
);

interface DisplayedFilterGroup {
  key: string;
  filters: ExtractedFilterItem[];
}

/** 詞綴條件區塊的摺疊鍵；篩選類別直接使用其 sectionKey（皆以 `_filters` 結尾，不會衝突）。 */
const STATS_SECTION_KEY = '__stats__';

const sectionToggleClass =
  'preview-section-toggle flex min-w-0 flex-1 items-center gap-[var(--pxd-space-sm)] rounded-md px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-left text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const stats = computed(() => {
  return props.previewData?.meta?.stats ?? [];
});

const filters = computed<ExtractedFilterItem[]>(() => {
  const list = props.previewData?.meta?.filters;
  return Array.isArray(list) ? list : [];
});

const filterGroups = computed<DisplayedFilterGroup[]>(() => {
  const groupMap = new Map<string, ExtractedFilterItem[]>();
  for (const item of filters.value) {
    groupMap.set(item.sectionKey, [...(groupMap.get(item.sectionKey) ?? []), item]);
  }
  return Array.from(groupMap, ([key, groupFilters]) => ({
    key,
    filters: groupFilters,
  }));
});

/** 有依群組的條件時以群組內詞綴計數，否則沿用攤平的 metadata。 */
const statCount = computed(() =>
  statGroups.value.length > 0
    ? statGroups.value.reduce((sum, g) => sum + g.filters.length, 0)
    : stats.value.length,
);

const totalDetailsCount = computed(() => {
  return statCount.value + filters.value.length;
});

const sectionKeys = computed<string[]>(() => {
  if (!props.previewData?.meta || props.previewData.loading || props.previewData.isLegacy) {
    return [];
  }
  return [
    ...(statCount.value > 0 ? [STATS_SECTION_KEY] : []),
    ...filterGroups.value.map((group) => group.key),
  ];
});

const hasTags = computed(() => Boolean(props.previewData?.realmLabel || props.previewData?.league));

const headerTitle = computed(() => props.sourceName || t('common.searchPreview'));

const collapsedKeys = ref<ReadonlySet<string>>(new Set());
const rootRef = ref<HTMLElement | null>(null);
/**
 * 第一次展開／摺疊時鎖定目前高度作為最小高度：摺疊不會讓 tooltip 縮小，
 * 避免浮動定位重新計算後位移、滑鼠落在 tooltip 外而關閉。展開不會超過原始高度，因此同樣穩定。
 */
const lockedHeight = ref<number | null>(null);

function lockHeight(): void {
  if (lockedHeight.value !== null) return;
  const height = rootRef.value?.offsetHeight ?? 0;
  if (height > 0) lockedHeight.value = height;
}

// 切換預覽的搜尋目標時才重設摺疊與鎖定高度（暫存微調／還原僅換掉 criteria 時保留現狀）
watch(
  () => (props.resetKey !== undefined ? props.resetKey : props.previewData),
  () => {
    collapsedKeys.value = new Set();
    lockedHeight.value = null;
  },
);

const allExpanded = computed(() => sectionKeys.value.every((key) => !collapsedKeys.value.has(key)));

function isCollapsed(key: string): boolean {
  return collapsedKeys.value.has(key);
}

function toggleSection(key: string): void {
  lockHeight();
  const next = new Set(collapsedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsedKeys.value = next;
}

function toggleAll(): void {
  lockHeight();
  collapsedKeys.value = allExpanded.value ? new Set(sectionKeys.value) : new Set();
}

function chevronClass(key: string): string {
  return `size-[var(--control-icon-sm)] shrink-0 text-muted-foreground transition-transform ${
    isCollapsed(key) ? '' : 'rotate-90'
  }`;
}
</script>
