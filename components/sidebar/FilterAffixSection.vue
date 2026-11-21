<template>
  <div class="mods-group mb-[var(--pxd-space-md)] [&+&]:pt-[var(--pxd-section-gap)]">
    <!-- 區塊標題（包含展開收合狀態及 Toggle 功能） -->
    <div
      :id="'category_' + category.label"
      class="group-header group/header flex items-center justify-between rounded-md cursor-pointer select-none transition-colors mb-[var(--pxd-space-sm)] px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-section-title)] font-semibold text-foreground hover:bg-accent hover:text-accent-foreground"
      :class="expanded ? 'bg-muted' : 'bg-transparent'"
      :aria-expanded="expanded"
      @click="emit('toggle-category', category.label)"
    >
      <div class="flex items-center gap-[var(--pxd-space-sm)] min-w-0">
        <span class="group-title font-semibold text-current min-w-0 truncate">
          {{ category.label }}
        </span>
        <span
          class="group-count text-[length:var(--pxd-font-caption)] text-muted-foreground group-hover/header:text-accent-foreground shrink-0 select-none"
        >
          {{ category.totals.prefixes + category.totals.suffixes + category.totals.all }}
        </span>
      </div>
      <Minus
        v-if="expanded"
        class="size-[var(--control-icon-sm,14px)] text-muted-foreground group-hover/header:text-accent-foreground shrink-0"
      />
      <Plus
        v-else
        class="size-[var(--control-icon-sm,14px)] text-muted-foreground group-hover/header:text-accent-foreground shrink-0"
      />
    </div>

    <!-- 展開狀態下顯示內容：前後綴分欄列＋其他世代單欄列，皆由 layoutRows 描述 -->
    <div v-if="expanded" class="group-content mb-[var(--pxd-space-lg)]">
      <div v-for="row in layoutRows" :key="row.key" :class="row.className">
        <template v-for="column in row.columns" :key="column.key">
          <!-- 佔位欄：單側命中時維持左前綴／右後綴的對齊 -->
          <div v-if="!column.mods" :class="column.className" aria-hidden="true" />
          <div v-else :class="column.className">
            <div
              v-if="column.title"
              class="column-title text-[length:var(--pxd-font-secondary)] font-semibold text-muted-foreground py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] mb-[var(--pxd-space-sm)] bg-transparent border-b border-border uppercase tracking-[0.5px]"
            >
              {{ column.title }}
            </div>
            <div
              class="mods-list-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[var(--pxd-space-sm)] items-start"
            >
              <!-- v-memo 依賴需涵蓋所有會影響 ModItem 的 prop；tier 勾選狀態由 ModItem 渲染時自行讀取 -->
              <ModItem
                v-for="mod in column.mods"
                :key="mod.id"
                v-memo="[
                  mod,
                  category.affinity,
                  searchQuery,
                  expandedKeys.has(mod.id),
                  isModSelected(mod.id, category.affinity),
                  itemLevelMax,
                  affixDemoHoveredModId === mod.id,
                ]"
                class="mb-[2px]"
                :mod="mod"
                :affinity="category.affinity"
                :search-query="searchQuery"
                :is-expanded="expandedKeys.has(mod.id)"
                :is-selected="isModSelected(mod.id, category.affinity)"
                :is-tier-selected="isTierSelected"
                :get-tier-number="getTierNumber"
                :item-level-max="itemLevelMax"
                :demo-highlighted="affixDemoHoveredModId === mod.id"
                @toggle-expand="(key: string) => emit('toggle-expand', key)"
                @toggle-select="(m: ModGroup, aff: string) => emit('toggle-select', m, aff)"
                @toggle-tier-select="
                  (m: ModGroup, tier: ModTier, idx: number, aff: string) =>
                    emit('toggle-tier-select', m, tier, idx, aff)
                "
                @add-filter="(m: ModGroup, aff: string) => emit('add-filter', m, aff)"
                @add-tier-filter="
                  (m: ModGroup, tier: ModTier, aff: string) => emit('add-tier-filter', m, tier, aff)
                "
              />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Minus, Plus } from '@lucide/vue';
import ModItem from './ModItem.vue';
import type { ModGroup, ModTier } from './types';
import type { RenderedCategoryGroup } from './composables/useProgressiveAffixRender';
import type { GenerationFilter } from './composables/useAffixFilter';
import { t } from '@/utils/i18n';
import { affixDemoHoveredModId } from '@/utils/page-guide-demo-state';

const props = defineProps<{
  category: RenderedCategoryGroup;
  expanded: boolean;
  generationFilter: GenerationFilter;
  searchQuery: string;
  expandedKeys: Set<string>;
  itemLevelMax: number | null;
  isModSelected: (modId: string, affinity: string) => boolean;
  isTierSelected: (idx: number, mod: ModGroup, affinity: string) => boolean;
  getTierNumber: (tier: ModTier, idx: number, mod: ModGroup) => number;
}>();

const emit = defineEmits<{
  'toggle-category': [label: string];
  'toggle-expand': [key: string];
  'toggle-select': [mod: ModGroup, affinity: string];
  'toggle-tier-select': [mod: ModGroup, tier: ModTier, idx: number, affinity: string];
  'add-filter': [mod: ModGroup, affinity: string];
  'add-tier-filter': [mod: ModGroup, tier: ModTier, affinity: string];
}>();

/** 沒有 mods 的欄位為對齊用佔位欄 */
interface AffixColumn {
  key: string;
  className: string;
  title?: string;
  mods?: ModGroup[];
}

interface AffixRow {
  key: string;
  className: string;
  columns: AffixColumn[];
}

const TWO_COLUMN_ROW = 'category-columns flex flex-row flex-wrap gap-[var(--pxd-space-lg)] w-full';
const SINGLE_COLUMN_ROW = 'category-single-column w-full';
const LEFT_COLUMN = 'column-left flex-1 min-w-[280px]';
const RIGHT_COLUMN = 'column-right flex-1 min-w-[280px]';

/**
 * 排版規則：
 * - 前後綴皆有：左前綴、右後綴雙欄。
 * - 僅前綴／僅後綴：「全部」模式維持左前綴／右後綴對齊（另一側放佔位欄），前／後綴篩選模式展全寬。
 * - 其他世代（固定詞、腐化等）：單欄網格；與前後綴同區塊時加上分隔標題。
 */
const layoutRows = computed<AffixRow[]>(() => {
  const cat = props.category;
  const keepAligned = props.generationFilter === 'all';
  const prefixColumn = (className: string): AffixColumn => ({
    key: 'prefixes',
    className,
    title: t('filterPane.column.prefixes', { count: cat.totals.prefixes }),
    mods: cat.prefixes,
  });
  const suffixColumn = (className: string): AffixColumn => ({
    key: 'suffixes',
    className,
    title: t('filterPane.column.suffixes', { count: cat.totals.suffixes }),
    mods: cat.suffixes,
  });

  const rows: AffixRow[] = [];
  if (cat.hasBothSplit) {
    rows.push({
      key: 'split',
      className: TWO_COLUMN_ROW,
      columns: [prefixColumn(LEFT_COLUMN), suffixColumn(RIGHT_COLUMN)],
    });
  } else if (cat.hasOnlyPrefix) {
    rows.push({
      key: 'split',
      className: keepAligned ? TWO_COLUMN_ROW : SINGLE_COLUMN_ROW,
      columns: keepAligned
        ? [prefixColumn(LEFT_COLUMN), { key: 'suffix-spacer', className: RIGHT_COLUMN }]
        : [prefixColumn('')],
    });
  } else if (cat.hasOnlySuffix) {
    rows.push({
      key: 'split',
      className: keepAligned ? TWO_COLUMN_ROW : SINGLE_COLUMN_ROW,
      columns: keepAligned
        ? [{ key: 'prefix-spacer', className: LEFT_COLUMN }, suffixColumn(RIGHT_COLUMN)]
        : [suffixColumn('')],
    });
  }

  if (cat.all.length > 0) {
    let title: string | undefined;
    if (cat.hasSplit) {
      title =
        cat.affinity === 'normal'
          ? t('filterPane.column.implicits', { count: cat.totals.all })
          : t('filterPane.column.others', { count: cat.totals.all });
    }
    rows.push({
      key: 'all',
      className: cat.hasSplit ? 'mt-[var(--pxd-space-md)] w-full' : 'w-full',
      columns: [{ key: 'all', className: '', title, mods: cat.all }],
    });
  }
  return rows;
});
</script>
