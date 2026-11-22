import { computed, ref, watch, type Ref } from 'vue';
import { filterModGroupsByItemLevel, parseItemLevelFilter } from '../utils';
import type { CategoryGroup, ModGroup } from '../types';
import { getActiveDisplayLocale } from '@/utils/i18n';

export type GenerationFilter = 'all' | 'prefix' | 'suffix';

export interface UseAffixFilterOptions {
  /** 原始詞綴資料；尚未載入（空物件）時不分組 */
  rawModsData: Ref<Record<string, unknown> | null | undefined>;
  /** 目前物品類別的完整詞綴清單 */
  currentTypeGroups: Ref<ModGroup[]>;
  getCategoryLabel: (affinity: string) => string;
  getCategoryPriority: (affinity: string) => number;
}

/** 依關鍵字（空白分隔、全部命中）比對詞綴顯示文字；中文與英文介面也比對英文 key */
const matchesSearch = (mod: ModGroup, queries: string[], includeEnglishKey: boolean) =>
  queries.every((q) => {
    const matchesDisplay =
      Boolean(mod.displayKey && mod.displayKey.toLowerCase().includes(q)) ||
      Boolean(mod.displayTemplate && mod.displayTemplate.toLowerCase().includes(q));
    if (matchesDisplay) return true;
    if (includeEnglishKey || (!mod.displayKey && !mod.displayTemplate)) {
      return mod.key.toLowerCase().includes(q);
    }
    return false;
  });

/**
 * 詞綴選擇器的篩選狀態：關鍵字、物品等級區間、前／後綴切換，
 * 以及據此分組後的大類清單與大類展開／收合狀態。
 */
export function useAffixFilter({
  rawModsData,
  currentTypeGroups,
  getCategoryLabel,
  getCategoryPriority,
}: UseAffixFilterOptions) {
  const searchQuery = ref('');
  const clearSearchQuery = () => {
    searchQuery.value = '';
  };

  const itemLevelMin = ref('');
  const itemLevelMax = ref('');
  const itemLevelRange = computed(() => ({
    min: parseItemLevelFilter(itemLevelMin.value),
    max: parseItemLevelFilter(itemLevelMax.value),
  }));
  const hasItemLevelFilter = computed(
    () =>
      String(itemLevelMin.value ?? '').trim() !== '' ||
      String(itemLevelMax.value ?? '').trim() !== '',
  );
  const hasActiveItemLevelRange = computed(
    () => itemLevelRange.value.min !== null || itemLevelRange.value.max !== null,
  );
  const isInvalidItemLevelRange = computed(
    () =>
      itemLevelRange.value.min !== null &&
      itemLevelRange.value.max !== null &&
      itemLevelRange.value.min > itemLevelRange.value.max,
  );
  const clearItemLevelFilter = () => {
    itemLevelMin.value = '';
    itemLevelMax.value = '';
  };

  const generationFilter = ref<GenerationFilter>('all');
  // ToggleGroup 再次點擊已選項目會送出空值，維持原選項
  watch(generationFilter, (val, oldVal) => {
    if (!val && oldVal) {
      generationFilter.value = oldVal;
    }
  });

  // 依據目前選取種類進行大類分組與排序，並套用搜尋篩選
  const groupedAffixes = computed(() => {
    if (!rawModsData.value || Object.keys(rawModsData.value).length === 0) return [];

    const allGroups = currentTypeGroups.value;

    let filtered = allGroups;
    if (searchQuery.value.trim()) {
      const queries = searchQuery.value.toLowerCase().split(/\s+/).filter(Boolean);
      const displayLocale = getActiveDisplayLocale();
      const includeEnglishKey =
        displayLocale === 'zh-TW' || displayLocale === 'zh-CN' || displayLocale === 'en';
      filtered = allGroups.filter((m) => matchesSearch(m, queries, includeEnglishKey));
    }

    filtered = filterModGroupsByItemLevel(filtered, itemLevelRange.value, {
      includeHigherTiersAboveMax: true,
    });

    const categoriesMap: Record<string, CategoryGroup> = {};
    // 每個大類已加入的詞綴 id；用 Set 查重，避免上千筆詞綴時逐一比對成 O(n²)
    const seenIdsByAffinity = new Map<string, Set<string>>();

    filtered.forEach((mod) => {
      const affinities = mod.affinities && mod.affinities.length > 0 ? mod.affinities : ['normal'];

      affinities.forEach((affKey) => {
        if (!categoriesMap[affKey]) {
          categoriesMap[affKey] = {
            affinity: affKey,
            label: getCategoryLabel(affKey),
            prefixes: [],
            suffixes: [],
            all: [],
            hasSplit: false,
            priority: getCategoryPriority(affKey),
          };
        }

        const cat = categoriesMap[affKey];
        let seenIds = seenIdsByAffinity.get(affKey);
        if (!seenIds) {
          seenIds = new Set();
          seenIdsByAffinity.set(affKey, seenIds);
        }

        if (!seenIds.has(mod.id)) {
          seenIds.add(mod.id);
          if (String(mod.generation_type) === '1') {
            cat.prefixes.push(mod);
          } else if (String(mod.generation_type) === '2') {
            cat.suffixes.push(mod);
          } else {
            cat.all.push(mod);
          }
        }
      });
    });

    // 只要該類別含有前綴 (generation_type === '1') 或後綴 (generation_type === '2') 就顯示前／後綴分欄；
    // 固定詞上綴、腐化、附魔等非前後綴世代則維持不分前後綴的單欄顯示。
    for (const key in categoriesMap) {
      const cat = categoriesMap[key];

      // 依據世代類型篩選 Tab 過濾
      if (generationFilter.value === 'prefix') {
        cat.suffixes = [];
        cat.all = [];
      } else if (generationFilter.value === 'suffix') {
        cat.prefixes = [];
        cat.all = [];
      }

      const hasPrefix = cat.prefixes.length > 0;
      const hasSuffix = cat.suffixes.length > 0;

      if (hasPrefix || hasSuffix) {
        cat.hasBothSplit = hasPrefix && hasSuffix;
        cat.hasOnlyPrefix = hasPrefix && !hasSuffix;
        cat.hasOnlySuffix = !hasPrefix && hasSuffix;
        cat.hasSplit = true;
      } else {
        cat.all = [...cat.prefixes, ...cat.suffixes, ...cat.all];
        cat.prefixes = [];
        cat.suffixes = [];
        cat.hasBothSplit = false;
        cat.hasOnlyPrefix = false;
        cat.hasOnlySuffix = false;
        cat.hasSplit = false;
      }
    }

    return Object.values(categoriesMap)
      .filter((c) => c.prefixes.length > 0 || c.suffixes.length > 0 || c.all.length > 0)
      .sort((a, b) => a.priority - b.priority);
  });

  const isEmpty = computed(() => groupedAffixes.value.length === 0);

  const filteredModTotalCount = computed(() =>
    groupedAffixes.value.reduce(
      (sum, cat) => sum + cat.prefixes.length + cat.suffixes.length + cat.all.length,
      0,
    ),
  );
  const canSelectAllFiltered = computed(
    () => Boolean(searchQuery.value.trim()) && filteredModTotalCount.value > 0,
  );

  const expandedCategories = ref<Set<string>>(new Set());

  const expandAll = (groups: CategoryGroup[]) => {
    groups.forEach((g) => {
      expandedCategories.value.add(g.label);
    });
  };

  // 搜尋中、有等級區間或尚未有任何展開狀態（剛載入／切換類別）時，自動展開所有命中的大類
  watch(
    groupedAffixes,
    (newGroups) => {
      if (
        searchQuery.value.trim() ||
        hasActiveItemLevelRange.value ||
        expandedCategories.value.size === 0
      ) {
        expandAll(newGroups);
      }
    },
    { immediate: true },
  );

  const toggleCategory = (label: string) => {
    if (expandedCategories.value.has(label)) {
      expandedCategories.value.delete(label);
    } else {
      expandedCategories.value.add(label);
    }
  };

  const hasAnyExpandedCategory = computed(() =>
    groupedAffixes.value.some((g) => expandedCategories.value.has(g.label)),
  );

  const toggleAllCategories = () => {
    if (hasAnyExpandedCategory.value) {
      expandedCategories.value.clear();
    } else {
      expandAll(groupedAffixes.value);
    }
  };

  return {
    searchQuery,
    clearSearchQuery,
    itemLevelMin,
    itemLevelMax,
    itemLevelRange,
    hasItemLevelFilter,
    isInvalidItemLevelRange,
    clearItemLevelFilter,
    generationFilter,
    groupedAffixes,
    isEmpty,
    filteredModTotalCount,
    canSelectAllFiltered,
    expandedCategories,
    toggleCategory,
    hasAnyExpandedCategory,
    toggleAllCategories,
  };
}
