import { computed, getCurrentInstance, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { getTradeMapping } from '../mapping-registry';
import { type PoeVersion } from '@/utils/trade-context';
import {
  ensureAffixLexiconLoaded,
  getAffixLexiconRevision,
  getHydratedModsByGroup,
} from '@/utils/affix-lexicon';
import { getActiveDisplayLocaleRef } from '@/utils/i18n';
import type { ModGroup, ModTier } from '../types';

export function useFilterData(version: PoeVersion, selectedType: Ref<string>) {
  const rawModsData = ref<Record<string, ModTier[]>>({});
  const knownStats = ref<Record<string, { id: string; text: string; type: string }>>({});
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

  const getModGroups = (type: string): ModGroup[] => {
    const groups: ModGroup[] = [];
    const targetTypes = typeAliases[type] || [type];
    Object.entries(rawModsData.value).forEach(([modKey, tiers]) => {
      const matchingTiers = tiers.filter((tier) =>
        tier.types?.some((itemType) => targetTypes.includes(itemType)),
      );
      const grouped: Record<
        string,
        { generationType: string; affinity: string; tiers: ModTier[] }
      > = {};
      matchingTiers.forEach((tier) => {
        const generationType = String(tier.generation_type || '1');
        const affinities = tier.affinities?.length ? tier.affinities : ['normal'];
        affinities.forEach((affinity) => {
          const key = `${generationType}_${affinity}`;
          grouped[key] ||= { generationType, affinity, tiers: [] };
          grouped[key].tiers.push(tier);
        });
      });
      Object.values(grouped).forEach((group) => {
        const sortedTiers = [...group.tiers].sort((a, b) => parseInt(a.level) - parseInt(b.level));
        sortedTiers.forEach((tier) => {
          if (tier.id && !tier.officialId) {
            tier.officialId = tier.id;
          }
        });
        const firstTier = sortedTiers[0];
        groups.push({
          id: `${modKey}_${group.generationType}_${group.affinity}`,
          officialId: firstTier.id || firstTier.officialId,
          ids: firstTier.ids,
          key: modKey,
          displayKey: firstTier.displayKey || '',
          displayTemplate: firstTier.displayTemplate || '',
          details: sortedTiers
            .map((tier) => `Lv.${tier.level}: ${tier.displayKey ? `${tier.displayKey} ` : ''}`)
            .join('\n'),
          tiers: sortedTiers,
          generation_type: group.generationType,
          affinities: [group.affinity],
        });
      });
    });
    return groups;
  };

  const currentTypeGroups = computed(() =>
    Object.keys(rawModsData.value).length ? getModGroups(selectedType.value) : [],
  );

  watch(getAffixLexiconRevision(), () => {
    const hydrated = getHydratedModsByGroup(version);
    if (Object.keys(hydrated).length > 0) {
      rawModsData.value = hydrated;
    }
  });

  const loadData = async () => {
    loading.value = true;
    try {
      const storage = (await chrome?.storage?.local?.get?.('poexdKnownStats')) || {};
      if (storage.poexdKnownStats) knownStats.value = storage.poexdKnownStats;
      // Display Locale 由偏好模組統一寫入全域狀態，這裡只依目前語系載入分片
      await ensureAffixLexiconLoaded(version);
      rawModsData.value = getHydratedModsByGroup(version);
      if (typeof window !== 'undefined') {
        dispatchPoeEvent('poexd-request-known-stats');
      }
    } catch (error) {
      console.error('[PoeXD] 載入詞綴資料失敗:', error);
    } finally {
      loading.value = false;
    }
  };

  const handleStorageChange = (changes: any) => {
    if (changes.poexdKnownStats) knownStats.value = changes.poexdKnownStats.newValue;
  };

  // 語系切換時載入新語系分片，並以新語系重新組裝詞綴（分片已快取時不會觸發 revision）
  watch(getActiveDisplayLocaleRef(), async () => {
    await ensureAffixLexiconLoaded(version);
    const hydrated = getHydratedModsByGroup(version);
    if (Object.keys(hydrated).length > 0) rawModsData.value = hydrated;
  });
  if (getCurrentInstance()) {
    onMounted(() => {
      void loadData();
      chrome?.storage?.onChanged?.addListener?.(handleStorageChange);
    });
    onUnmounted(() => chrome?.storage?.onChanged?.removeListener?.(handleStorageChange));
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
