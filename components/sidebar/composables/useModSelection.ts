import { ref } from 'vue';
import { getTierFilterBounds } from '../utils';
import type { ModGroup, ModTier, SelectedModInfo } from '../types';

export function useModSelection() {
  const selectedModsMap = ref<Map<string, SelectedModInfo>>(new Map());

  const isModSelected = (modId: string, affinity: string) => {
    return selectedModsMap.value.has(`${modId}_${affinity}`);
  };

  const isTierSelected = (modId: string, tierIndex: number, affinity: string) => {
    const info = selectedModsMap.value.get(`${modId}_${affinity}`);
    if (info && info.selectedTierIndex !== undefined) {
      return tierIndex >= info.selectedTierIndex;
    }
    return false;
  };

  const toggleModSelection = (mod: ModGroup, currentAffinity: string) => {
    const key = `${mod.id}_${currentAffinity}`;
    const newMap = new Map(selectedModsMap.value);
    if (newMap.has(key) && newMap.get(key)?.selectedTierIndex === undefined) {
      newMap.delete(key);
    } else {
      newMap.set(key, {
        id: mod.id,
        officialId: mod.officialId,
        ids: mod.ids,
        key: mod.key,
        displayKey: mod.displayKey,
        displayTemplate: mod.displayTemplate,
        affinities: [currentAffinity],
      });
    }
    selectedModsMap.value = newMap;
  };

  const toggleTierSelection = (
    mod: ModGroup,
    tier: ModTier,
    tierIndex: number,
    currentAffinity: string,
  ) => {
    const key = `${mod.id}_${currentAffinity}`;
    const newMap = new Map(selectedModsMap.value);

    if (newMap.has(key) && newMap.get(key)?.selectedTierIndex === tierIndex) {
      newMap.delete(key);
    } else {
      const { atLeast } = getTierFilterBounds(mod.key, tier);
      newMap.set(key, {
        id: mod.id,
        officialId: tier.id || tier.officialId || mod.officialId,
        ids: tier.ids || mod.ids,
        key: mod.key,
        displayKey: mod.displayKey,
        displayTemplate: mod.displayTemplate,
        affinities: [currentAffinity],
        ...atLeast,
        selectedTierIndex: tierIndex,
      });
    }
    selectedModsMap.value = newMap;
  };

  const clearAllSelection = () => {
    selectedModsMap.value = new Map();
  };

  const applyT1ToSelected = (currentTypeGroups: ModGroup[]) => {
    const newMap = new Map(selectedModsMap.value);
    const updatedMap = new Map<string, SelectedModInfo>();

    newMap.forEach((info, mapKey) => {
      const modObj = currentTypeGroups.find((m) => m.id === info.id);
      if (modObj && modObj.tiers && modObj.tiers.length > 0) {
        const tIdx = modObj.tiers.length - 1; // T1 最強 (在我們的 sorted list 中最後一個是 T1 最強)
        const tier = modObj.tiers[tIdx];
        const { atLeast } = getTierFilterBounds(modObj.key, tier);

        updatedMap.set(mapKey, {
          id: info.id,
          officialId: tier.id || tier.officialId || modObj.officialId,
          ids: tier.ids || modObj.ids,
          key: info.key,
          displayKey: info.displayKey,
          displayTemplate: info.displayTemplate,
          affinities: info.affinities,
          ...atLeast,
          selectedTierIndex: tIdx,
        });
      } else {
        updatedMap.set(mapKey, info);
      }
    });
    selectedModsMap.value = updatedMap;
  };

  return {
    selectedModsMap,
    isModSelected,
    isTierSelected,
    toggleModSelection,
    toggleTierSelection,
    clearAllSelection,
    applyT1ToSelected,
  };
}
