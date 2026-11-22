import { computed, getCurrentInstance, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { getTradeMapping } from '../mapping-registry';
import { type PoeVersion } from '@/utils/trade-context';
import {
  ensureAffixLexiconLoaded,
  getAffixLexiconRevision,
  getHydratedModsByGroup,
  isAffixLexiconReady,
  translateAffixStat,
} from '@/utils/affix-lexicon';
import { getActiveDisplayLocale, getActiveDisplayLocaleRef } from '@/utils/i18n';
import { getOfficialStatLabel } from '@/utils/trade-label-resolver';
import { getKnownStatsRef } from '@/utils/known-stats-store';
import type { ModGroup, ModTier } from '../types';

/** 一個詞綴群組不含顯示標籤的結構；firstTier 留給標籤解析用 */
type ModGroupStructure = Omit<ModGroup, 'displayTemplate'> & { firstTier: ModTier };

function buildModGroupStructures(
  modsByKey: Record<string, ModTier[]>,
  targetTypes: string[],
): ModGroupStructure[] {
  const targetTypeSet = new Set(targetTypes);
  const groups: ModGroupStructure[] = [];
  for (const [modKey, tiers] of Object.entries(modsByKey)) {
    const grouped = new Map<
      string,
      { generationType: string; affinity: string; tiers: ModTier[] }
    >();
    for (const tier of tiers) {
      if (!tier.types?.some((itemType) => targetTypeSet.has(itemType))) continue;
      const generationType = String(tier.generation_type || '1');
      const affinities = tier.affinities?.length ? tier.affinities : ['normal'];
      for (const affinity of affinities) {
        const key = `${generationType}_${affinity}`;
        let group = grouped.get(key);
        if (!group) {
          group = { generationType, affinity, tiers: [] };
          grouped.set(key, group);
        }
        group.tiers.push(tier);
      }
    }
    for (const group of grouped.values()) {
      // 補上 officialId 時產生副本，不改動詞綴字典共用的 tier 物件（computed 內不應有寫入）
      const sortedTiers = group.tiers
        .map((tier) => (tier.id && !tier.officialId ? { ...tier, officialId: tier.id } : tier))
        .sort((a, b) => parseInt(a.level) - parseInt(b.level));
      const firstTier = sortedTiers[0];
      groups.push({
        id: `${modKey}_${group.generationType}_${group.affinity}`,
        officialId: firstTier.id || firstTier.officialId,
        ids: firstTier.ids,
        key: modKey,
        displayKey: firstTier.displayKey || '',
        details: sortedTiers
          .map((tier) => `Lv.${tier.level}: ${tier.displayKey ? `${tier.displayKey} ` : ''}`)
          .join('\n'),
        tiers: sortedTiers,
        generation_type: group.generationType,
        affinities: [group.affinity],
        firstTier,
      });
    }
  }
  return groups;
}

export function useFilterData(version: PoeVersion, selectedType: Ref<string>) {
  /**
   * 數千筆 tier 的唯讀資料，每次都整份替換；用 shallowRef 避免每個 tier 與陣列都被轉成 Proxy + Dep
   * （深層 reactive 時切換物品類型約慢 10 倍、多佔數 MB）。
   */
  const rawModsData = shallowRef<Record<string, ModTier[]>>({});
  const knownStats = getKnownStatsRef();
  const loading = ref(true);
  const typeNames = getTradeMapping(version).typeNames;

  const getTypeName = (type: string) =>
    (typeNames[type] || type.toUpperCase()).replace(/\s*\([^)]*\)/g, '').trim();

  const availableTypes = computed(() => {
    const types = new Set<string>();
    Object.values(rawModsData.value).forEach((tiers) => {
      tiers.forEach((tier) => tier.types?.forEach((type) => types.add(type)));
    });
    const aliases: Array<[string, string[]]> = [
      [
        'cluster_jewel',
        ['large_cluster_jewel', 'medium_cluster_jewel', 'small_cluster_jewel', 'cluster_jewel'],
      ],
      [
        'abyss_jewel',
        [
          'searching_eye_jewel',
          'hypnotic_eye_jewel',
          'murderous_eye_jewel',
          'ghastly_eye_jewel',
          'abyss_jewel',
        ],
      ],
      [
        'minor_idol',
        [
          'minor_idol',
          'kamasan_idol',
          'totemic_idol',
          'noble_idol',
          'burial_idol',
          'conqueror_idol',
        ],
      ],
    ];
    aliases.forEach(([parent, children]) => {
      if (children.some((child) => types.has(child))) types.add(parent);
    });

    const preferredOrder = [
      'body-armour',
      'helmet',
      'gloves',
      'boots',
      'shield',
      'focus',
      'amulet',
      'ring',
      'belt',
      'quiver',
      'waystone',
      'waystone-t1',
      'waystone-t2',
      'waystone-t3',
      'flask',
      'life-flask',
      'mana-flask',
      'charm',
      'relic',
      'urn-relic',
      'amphora-relic',
      'vase-relic',
      'seal-relic',
      'coffer-relic',
      'tapestry-relic',
      'incense-relic',
      'tablet',
      'breach-tablet',
      'expedition-tablet',
      'delirium-tablet',
      'ritual-tablet',
      'irradiated-tablet',
      'overseer-tablet',
      'abyss-tablet',
      'temple-tablet',
    ];
    return Array.from(types).sort((a, b) => {
      const aIndex = preferredOrder.indexOf(a);
      const bIndex = preferredOrder.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  });

  const typeAliases: Record<string, string[]> = {
    diamond: ['diamond', 'ruby', 'emerald', 'sapphire'],
    time_lost_diamond: [
      'time_lost_diamond',
      'time_lost_ruby',
      'time_lost_emerald',
      'time_lost_sapphire',
    ],
    prismatic_jewel: ['prismatic_jewel', 'cobalt_jewel', 'crimson_jewel', 'viridian_jewel'],
    cluster_jewel: [
      'cluster_jewel',
      'large_cluster_jewel',
      'medium_cluster_jewel',
      'small_cluster_jewel',
    ],
    abyss_jewel: [
      'abyss_jewel',
      'searching_eye_jewel',
      'hypnotic_eye_jewel',
      'murderous_eye_jewel',
      'ghastly_eye_jewel',
    ],
    minor_idol: [
      'minor_idol',
      'kamasan_idol',
      'totemic_idol',
      'noble_idol',
      'burial_idol',
      'conqueror_idol',
    ],
  };

  /** 詞綴字典的 statTemplates 是市集標準寫法（poexd-data 以國際服市集為準產生）；多行的不採用 */
  const lexiconStatLabel = (statId: string): string | null => {
    const label = translateAffixStat(statId, version);
    return label && !label.includes('|||||') ? label : null;
  };

  /**
   * 單一詞綴的標籤用市集寫法（正負向跟市集一致）：官方市集 → 詞綴字典的標準寫法 → 最低階級的遊戲文字。
   * 複合詞綴維持完整的遊戲寫法，讓使用者看到整條詞綴的內容。
   */
  const resolveGroupLabel = (firstTier: ModTier): string => {
    const template = firstTier.displayTemplate || '';
    const ids = firstTier.ids ?? (firstTier.id ? [firstTier.id] : []);
    if (ids.length !== 1 || template.includes('|||||')) return template;
    return (
      getOfficialStatLabel(ids[0], version, getActiveDisplayLocale()) ??
      lexiconStatLabel(ids[0]) ??
      template
    );
  };

  /**
   * 分組結構（不含標籤）只取決於字典資料與類別，依類別快取：切回看過的類別不用再掃一次全部 tier。
   * 以 rawModsData 物件當 WeakMap 鍵，字典或語系重組時自然失效。
   * 標籤仍每次解析，才會跟著官方市集文字的載入（revision）與語系即時更新。
   */
  const structureCache = new WeakMap<object, Map<string, ModGroupStructure[]>>();

  const getModGroupStructures = (type: string): ModGroupStructure[] => {
    const source = rawModsData.value;
    let byType = structureCache.get(source);
    if (!byType) {
      byType = new Map();
      structureCache.set(source, byType);
    }
    const cached = byType.get(type);
    if (cached) return cached;
    const structures = buildModGroupStructures(source, typeAliases[type] || [type]);
    byType.set(type, structures);
    return structures;
  };

  const getModGroups = (type: string): ModGroup[] =>
    getModGroupStructures(type).map(({ firstTier, ...group }) => ({
      ...group,
      displayTemplate: resolveGroupLabel(firstTier),
    }));

  const currentTypeGroups = computed(() =>
    Object.keys(rawModsData.value).length ? getModGroups(selectedType.value) : [],
  );
  /**
   * 組裝數千筆 tier 要上百毫秒：同一個字典版本與語系只組一次。
   * 字典載完會同時觸發 revision watch 與 loadData，沒有這道檢查會連續組兩次。
   */
  let hydratedKey: string | null = null;
  const hydrate = () => {
    const key = `${getAffixLexiconRevision().value}|${getActiveDisplayLocaleRef().value}`;
    if (key === hydratedKey) return;
    const hydrated = getHydratedModsByGroup(version);
    if (Object.keys(hydrated).length > 0) {
      rawModsData.value = hydrated;
      hydratedKey = key;
    }
  };

  // loadData 載入期間字典會分段到齊（revision 遞增數次），由它載完後組一次即可
  watch(getAffixLexiconRevision(), () => {
    if (!loading.value) hydrate();
  });

  const finishHydration = () => {
    hydrate();
    if (typeof window !== 'undefined') {
      dispatchPoeEvent('poexd-request-known-stats');
    }
  };

  const loadData = async () => {
    if (isAffixLexiconReady(version)) {
      finishHydration();
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      // Display Locale 由偏好模組統一寫入全域狀態，這裡只依目前語系載入分片
      await ensureAffixLexiconLoaded(version);
      finishHydration();
    } catch (error) {
      console.error('[PoeXD] 載入詞綴資料失敗:', error);
    } finally {
      loading.value = false;
    }
  };

  // 語系切換時載入新語系分片，並以新語系重新組裝詞綴（分片已快取時不會觸發 revision）
  watch(getActiveDisplayLocaleRef(), async () => {
    await ensureAffixLexiconLoaded(version);
    hydrate();
  });
  if (getCurrentInstance()) {
    onMounted(() => void loadData());
  }

  return {
    loading,
    rawModsData,
    knownStats,
    typeNames,
    availableTypes,
    currentTypeGroups,
    getTypeName,
    loadData,
  };
}
