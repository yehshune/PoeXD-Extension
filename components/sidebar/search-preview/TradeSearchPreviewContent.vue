<template>
  <div
    v-if="previewData"
    ref="rootRef"
    :style="lockedHeight ? { minHeight: `${lockedHeight}px` } : undefined"
    class="trade-search-preview-popover bookmark-preview-popover flex min-h-0 flex-1 flex-col text-[length:var(--pxd-font-body)]"
  >
    <!-- 固定標題列（比照詞綴選擇器）：來源名稱、標籤與關閉鈕，不隨內容捲動 -->
    <div
      class="preview-header preview-title-row flex h-[var(--pxd-sidebar-affix-dialog-header-height)] min-w-0 shrink-0 items-center gap-[var(--pxd-space-sm)] border-b border-border bg-background px-[var(--pxd-pane-padding)]"
    >
      <span
        class="preview-source-name min-w-0 flex-1 truncate text-[length:var(--pxd-font-body)] font-bold tracking-[0.5px] text-foreground"
        data-test="preview-source-name"
        :title="headerTitle"
        >{{ headerTitle }}</span
      >
      <div v-if="hasTags" class="preview-tags flex min-w-0 shrink gap-[var(--pxd-space-xs)]">
        <span
          v-if="previewData.realmLabel"
          class="preview-tag realm-tag whitespace-nowrap rounded-sm border border-border bg-secondary px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-secondary-foreground"
        >
          {{ previewData.realmLabel }}
        </span>
        <span
          v-if="previewData.league"
          class="preview-tag league-tag min-w-0 truncate rounded-sm border border-border bg-muted px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-muted-foreground"
          :title="previewData.league"
        >
          {{ previewData.league }}
        </span>
      </div>
      <button
        v-if="closable"
        type="button"
        class="preview-close inline-flex size-[var(--control-height-sm)] shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        data-test="preview-close"
        :aria-label="t('common.close')"
        :title="t('common.close')"
        @click="emit('close')"
      >
        <X class="size-[var(--control-icon-default)]" aria-hidden="true" />
      </button>
    </div>

    <!-- 工具列：摺疊與疊加操作，固定於標題列下方 -->
    <div
      v-if="sectionKeys.length > 0 || canOverlay || overlayHint"
      class="preview-action-row flex min-w-0 shrink-0 items-center gap-[var(--pxd-space-xs)] border-b border-border px-[var(--pxd-pane-padding)] py-[var(--pxd-space-sm)]"
    >
      <button
        v-if="sectionKeys.length > 0"
        type="button"
        class="preview-toggle-all inline-flex shrink-0 items-center gap-[var(--pxd-space-xs)] whitespace-nowrap rounded-sm p-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        :aria-label="
          allExpanded ? t('searchPreview.action.collapseAll') : t('searchPreview.action.expandAll')
        "
        @click="toggleAll"
      >
        <ChevronsDownUp v-if="allExpanded" :class="iconClass" aria-hidden="true" />
        <ChevronsUpDown v-else :class="iconClass" aria-hidden="true" />
        {{
          allExpanded ? t('searchPreview.action.collapseAll') : t('searchPreview.action.expandAll')
        }}
      </button>
      <div
        v-if="canOverlay"
        class="preview-overlay-actions ml-auto flex shrink-0 items-center gap-[var(--pxd-space-xs)]"
      >
        <button
          type="button"
          :class="overlayButtonClass"
          data-test="preview-overlay-all"
          :title="t('searchPreview.action.overlayAllTitle')"
          :disabled="overlayBusy || !hasCriteria"
          @click="emit('overlay', { kind: 'all' })"
        >
          <Plus :class="iconClass" aria-hidden="true" />{{ t('searchPreview.action.overlayAll') }}
        </button>
        <button
          type="button"
          :class="overlayButtonClass"
          data-test="preview-overlay-undo"
          :title="t('searchPreview.action.undoTitle')"
          :disabled="overlayBusy || !canUndo"
          @click="emit('undo')"
        >
          <Undo2 :class="iconClass" aria-hidden="true" />{{ t('searchPreview.action.undo') }}
        </button>
      </div>
      <span
        v-else-if="overlayHint"
        class="preview-overlay-hint ml-auto min-w-0 truncate text-[length:var(--pxd-font-caption)] text-muted-foreground"
        data-test="preview-overlay-hint"
        :title="overlayHint"
        >{{ overlayHint }}</span
      >
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
          v-if="previewData.meta.name || previewData.meta.type"
          class="preview-section item-names flex items-start gap-[var(--pxd-space-sm)] rounded-md border border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
        >
          <div class="flex min-w-0 flex-1 flex-col leading-[1.25]">
            <div v-if="previewData.meta.name" class="preview-item-name text-foreground">
              {{ t('searchPreview.label.item')
              }}<span class="highlight-unique font-semibold text-foreground">{{
                previewData.meta.name
              }}</span>
            </div>
            <div v-if="previewData.meta.type" class="preview-item-type text-muted-foreground">
              {{ t('searchPreview.label.base') }}{{ previewData.meta.type }}
            </div>
          </div>
          <button
            v-if="canOverlay && criteria?.item"
            type="button"
            :class="overlayIconClass"
            data-test="preview-overlay-item"
            :title="t('searchPreview.action.overlayItemTitle')"
            :disabled="overlayBusy"
            @click="emit('overlay', { kind: 'item' })"
          >
            <Plus :class="iconClass" aria-hidden="true" />
          </button>
        </div>

        <div
          v-if="criteria?.status"
          class="preview-section preview-status flex items-center justify-between gap-[var(--pxd-space-md)] rounded-md border border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)]"
        >
          <span class="text-muted-foreground"
            >{{ t('searchPreview.label.status')
            }}<span class="text-foreground">{{
              STATUS_LABELS[criteria.status] ?? criteria.status
            }}</span></span
          >
          <button
            v-if="canOverlay"
            type="button"
            :class="overlayIconClass"
            data-test="preview-overlay-status"
            :title="t('searchPreview.action.overlayStatusTitle')"
            :disabled="overlayBusy"
            @click="emit('overlay', { kind: 'status' })"
          >
            <Plus :class="iconClass" aria-hidden="true" />
          </button>
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
            <button
              v-if="canOverlay && statGroups.length > 0"
              type="button"
              :class="overlayIconClass"
              data-test="preview-overlay-stats"
              :title="t('searchPreview.action.overlayAllStatsTitle')"
              :disabled="overlayBusy"
              @click="emit('overlay', { kind: 'stats' })"
            >
              <Plus :class="iconClass" aria-hidden="true" />
            </button>
          </div>
          <div
            v-if="statGroups.length > 0"
            v-show="!isCollapsed(STATS_SECTION_KEY)"
            class="preview-stats-list flex flex-col gap-[var(--pxd-space-sm)]"
          >
            <div
              v-for="(group, groupIndex) in statGroups"
              :key="groupIndex"
              class="preview-stat-group overflow-hidden rounded-md border border-border"
              :class="group.disabled ? 'opacity-60' : ''"
              :data-stat-group-index="groupIndex"
              :data-disabled="group.disabled ? 'true' : undefined"
            >
              <div
                class="preview-stat-group-header flex items-center gap-[var(--pxd-space-xs)] bg-muted px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)]"
              >
                <span
                  class="preview-stat-group-type whitespace-nowrap font-semibold text-foreground"
                  >{{ groupTypeLabel(group) }}</span
                >
                <span
                  v-if="rangeText(group.value)"
                  class="whitespace-nowrap font-mono text-foreground"
                  >{{ rangeText(group.value) }}</span
                >
                <span
                  v-if="group.disabled"
                  class="preview-stat-group-disabled whitespace-nowrap rounded-sm border border-border px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
                  >{{ t('searchPreview.statGroup.disabled') }}</span
                >
                <span
                  class="ml-auto whitespace-nowrap text-[length:var(--pxd-font-caption)] text-muted-foreground"
                  >{{ group.filters.length }}
                  {{
                    group.filters.length === 1
                      ? t('criteriaOverlay.statGroup.filterUnitSingle')
                      : t('criteriaOverlay.statGroup.filterUnitPlural')
                  }}</span
                >
                <button
                  v-if="canOverlay"
                  type="button"
                  :class="overlayButtonClass"
                  data-test="preview-overlay-stat-group"
                  :title="t('searchPreview.action.overlayStatGroupTitle')"
                  :disabled="overlayBusy"
                  @click="emit('overlay', { kind: 'stat-group', index: groupIndex })"
                >
                  <Plus :class="iconClass" aria-hidden="true" />{{
                    t('searchPreview.action.overlay')
                  }}
                </button>
              </div>
              <div
                v-for="(f, idx) in group.filters"
                :key="idx"
                class="preview-stat-row"
                :class="[rowClass, f.disabled ? 'opacity-60' : '']"
              >
                <span class="stat-name flex min-w-0 flex-col text-foreground" :title="f.id">
                  <span
                    v-for="(line, lineIndex) in statLines(f.id)"
                    :key="lineIndex"
                    class="stat-line truncate"
                    >{{ line }}</span
                  >
                </span>
                <span
                  v-if="rangeText(f.value)"
                  class="stat-range shrink-0 font-mono text-foreground"
                >
                  {{ rangeText(f.value) }}
                </span>
              </div>
            </div>
          </div>
          <div
            v-else
            v-show="!isCollapsed(STATS_SECTION_KEY)"
            class="preview-stats-list overflow-hidden rounded-md border border-border"
          >
            <div v-for="(s, idx) in stats" :key="idx" class="preview-stat-row" :class="rowClass">
              <span class="stat-name flex min-w-0 flex-col text-foreground" :title="s.id">
                <span
                  v-for="(line, lineIndex) in statLines(s.id)"
                  :key="lineIndex"
                  class="stat-line truncate"
                  >{{ line }}</span
                >
              </span>
              <span
                v-if="s.min !== undefined || s.max !== undefined"
                class="stat-range shrink-0 font-mono text-foreground"
              >
                {{ s.min !== undefined ? '≥' + s.min : ''
                }}{{ s.max !== undefined ? ' ≤' + s.max : '' }}
              </span>
            </div>
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
            <button
              v-if="canOverlay && hasSection(group.key)"
              type="button"
              :class="overlayIconClass"
              data-test="preview-overlay-section"
              :data-section="group.key"
              :title="t('searchPreview.action.overlaySectionTitle')"
              :disabled="overlayBusy"
              @click="emit('overlay', { kind: 'section', section: group.key })"
            >
              <Plus :class="iconClass" aria-hidden="true" />
            </button>
          </div>
          <div
            v-show="!isCollapsed(group.key)"
            class="preview-filters-list overflow-hidden rounded-md border border-border"
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
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Plus, Undo2, X } from '@lucide/vue';
import { t } from '@/utils/i18n';
import type { OverlayTarget, CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';
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
  /** 目前頁面有官方搜尋表單時才可疊加（見 CONTEXT.md「Criteria Overlay」）。 */
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
});

const emit = defineEmits<{
  overlay: [target: OverlayTarget];
  undo: [];
  close: [];
}>();

/** 版面比照詞綴選擇器（FilterPane／ModItem）：字級、間距、圓角一律用 design tokens。 */
const iconClass = 'size-[var(--control-icon-sm)] shrink-0';
const overlayButtonClass =
  'preview-overlay-btn inline-flex shrink-0 items-center gap-[var(--pxd-space-xs)] whitespace-nowrap rounded-sm border border-border bg-transparent px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] leading-none text-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50';
const overlayIconClass =
  'preview-overlay-icon inline-flex shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-[var(--pxd-space-xs)] text-muted-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50';
/** 分區標頭比照 FilterPane 的群組標頭。 */
const sectionHeaderClass =
  'preview-section-header mb-[var(--pxd-space-xs)] flex items-center gap-[var(--pxd-space-xs)]';
const sectionTitleClass =
  'preview-section-title min-w-0 truncate text-[length:var(--pxd-font-section-title)] font-semibold text-current';
const sectionCountClass =
  'preview-section-count shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground';
/** 條件列比照 ModItem 的詞綴列：本文字級、分隔線。 */
const rowClass =
  'flex items-center justify-between gap-[var(--pxd-space-md)] border-t border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] leading-[1.25] first:border-t-0';

const criteria = computed(() => props.previewData?.criteria);
const statGroups = computed(() => criteria.value?.statGroups ?? []);
const hasCriteria = computed(() => {
  const c = criteria.value;
  return Boolean(c && (c.item || c.status || c.statGroups.length > 0 || c.fields.length > 0));
});

function hasSection(section: string): boolean {
  return Boolean(criteria.value?.fields.some((f) => f.section === section));
}

function groupTypeLabel(group: CriteriaOverlayStatGroup): string {
  return STAT_GROUP_TYPE_LABELS[group.type] ?? group.type;
}

function statLines(statId: string): string[] {
  return translateStatLines(statId, props.previewData?.gameVersion);
}

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

const headerTitle = computed(() => props.sourceName || t('searchPreview.defaultSourceName'));

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

// 切換預覽的搜尋時一律回到全部展開
watch(
  () => props.previewData,
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
