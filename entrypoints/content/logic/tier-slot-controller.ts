import { getTradeMapping } from '@/components/sidebar/mapping-registry';
import { parseAffinityModGroupId } from '@/utils/affinity-registry';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import {
  clearTierSlots,
  setTierCategorySelectionTarget,
  syncTierSlots,
  upsertTierSlot,
  type TierDropdownItemSpec,
  type TierSlotDescriptor,
} from '@/utils/tier-slot-registry';
import { type PoeVersion } from '@/utils/trade-context';
import { type TierDomainService } from './tier-domain-service';

export interface TierSlotControllerOptions {
  version: PoeVersion;
  tierDomainService: TierDomainService;
  isCurrentGeneration: (generation: number) => boolean;
  getCurrentGeneration?: () => number;
}

export interface TierSlotController {
  sync(generation: number): Promise<void>;
  refreshSlot(slotKey: string): Promise<boolean>;
  clear(): void;
}

export function findMinMaxInputs(filterEl: Element): {
  minInput: HTMLInputElement | null;
  maxInput: HTMLInputElement | null;
} {
  const minContainer = filterEl.querySelector('.min');
  const maxContainer = filterEl.querySelector('.max');
  if (minContainer || maxContainer) {
    return {
      minInput: minContainer?.querySelector('input') ?? null,
      maxInput: maxContainer?.querySelector('input') ?? null,
    };
  }

  const inputs = Array.from(filterEl.querySelectorAll('input'));
  let minInput =
    inputs.find((i) => {
      const ph = (i.placeholder || '').toLowerCase();
      return ph.includes('最小') || ph.includes('min');
    }) || null;
  let maxInput =
    inputs.find((i) => {
      const ph = (i.placeholder || '').toLowerCase();
      return ph.includes('最大') || ph.includes('max');
    }) || null;

  if (!minInput && inputs.length >= 2) {
    minInput = inputs[0];
    maxInput = inputs[1];
  }

  return { minInput, maxInput };
}

export function isStatFilterGroup(group: Element): boolean {
  const header = group.querySelector('.filter-group-header');
  if (header) {
    if (header.querySelector('.filter-select') !== null) return true;
    if (header.querySelector('.multiselect') !== null) return true;
    if (header.querySelector('.filter-group-select') !== null) return true;
  }
  const inputs = Array.from(group.querySelectorAll('input'));
  return inputs.some(
    (i) =>
      i.placeholder &&
      (i.placeholder.includes('+') ||
        i.placeholder.toLowerCase().includes('filter') ||
        i.placeholder.includes('屬性') ||
        i.placeholder.includes('過濾')),
  );
}

export function removeTierSlotArtifacts(slotEl: HTMLElement | null | undefined): void {
  if (!slotEl) return;
  const slotKey = slotEl.getAttribute('data-poexd-slot-key');
  const parent = slotEl.parentElement || slotEl.parentNode;
  if (parent && slotKey) {
    const boundSeps = parent.querySelectorAll(`[data-poexd-tier-sep="${slotKey}"]`);
    boundSeps.forEach((sep) => sep.remove());
  }
  slotEl.remove();
}

export function cleanAllTierSlotArtifacts(): void {
  document.querySelectorAll<HTMLElement>('.poexd-tier-trigger-slot').forEach((slotEl) => {
    removeTierSlotArtifacts(slotEl);
  });
  document.querySelectorAll<HTMLElement>('[data-poexd-tier-sep]').forEach((sepEl) => {
    sepEl.remove();
  });
  clearTierSlots();
}

let nextTierSlotSeq = 0;

export function createTierSlotDomainData(
  tiers: any[] | null | undefined,
  filterEl: Element,
  slotEl: HTMLElement,
  options: Pick<TierSlotControllerOptions, 'version' | 'tierDomainService'>,
  statId?: string | null,
): {
  items: TierDropdownItemSpec[];
  onSelect: (item: TierDropdownItemSpec, mode?: 'min' | 'both' | 'max') => void;
  getCurrentValues: () => { min: string; max: string };
} {
  const effectiveStatId = statId ?? filterEl.getAttribute('data-poexd-stat-id');
  const eligibility = options.tierDomainService.resolveTierModEligibility(tiers, effectiveStatId);
  if (!eligibility.isEligible) {
    return { items: [], onSelect: () => {}, getCurrentValues: () => ({ min: '', max: '' }) };
  }

  const { normalTiers, availableTypes: typeList } = eligibility;
  const gIdxAttr = filterEl.closest('.filter-group')?.getAttribute('data-poexd-group-idx');
  const fIdxAttr = filterEl.getAttribute('data-poexd-filter-idx');
  const gIdx = gIdxAttr !== null ? Number(gIdxAttr) : null;
  const fIdx = fIdxAttr !== null ? Number(fIdxAttr) : null;

  const getCurrentValues = (): { min: string; max: string } => {
    const { minInput, maxInput } = findMinMaxInputs(filterEl);
    return {
      min: minInput?.value ?? '',
      max: maxInput?.value ?? '',
    };
  };

  const applyValues = (minVal: string, maxVal: string) => {
    const { minInput, maxInput } = findMinMaxInputs(filterEl);

    if (minInput) {
      minInput.value = minVal;
      minInput.dispatchEvent(new Event('input', { bubbles: true }));
      minInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (maxInput) {
      maxInput.value = maxVal;
      maxInput.dispatchEvent(new Event('input', { bubbles: true }));
      maxInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  // 使用這行詞綴 DOM 上被標記的 category (即 Vuex 物件中的 poexdCategory)
  let detectedType = filterEl.getAttribute('data-poexd-category') || null;
  const bindingId = filterEl.getAttribute('data-poexd-binding-id') || '';

  const items: TierDropdownItemSpec[] = [];

  let activeType = detectedType;
  if (!activeType && typeList.length === 1) {
    activeType = typeList[0];
    detectedType = activeType;
  }

  if (activeType) {
    const typeNames = getTradeMapping(options.version).typeNames;
    const categoryLabel = typeNames[activeType] || activeType.toUpperCase();

    items.push({
      id: 'switch_category',
      type: 'switch_category',
      label: t('tierDropdown.switchCategory', { category: categoryLabel }),
      categoryLabel,
    });

    const filtered = options.tierDomainService.filterTiersByCategory(normalTiers, activeType);
    if (filtered.length === 0) {
      items.push({
        id: 'no-category-tiers',
        type: 'header',
        label: t('tierDropdown.noCategoryTiers'),
      });
    } else {
      const modGroups = options.tierDomainService.groupTiersByMod(filtered);
      let tierSource = filtered;
      let activeGroupId: string | null = null;

      if (modGroups.length > 1) {
        const detectedGroupId = filterEl.getAttribute('data-poexd-mod-group');
        let activeGroup = modGroups.find((g) => g.id === detectedGroupId);
        if (!activeGroup && detectedGroupId) {
          const { template: rawTemplate } = parseAffinityModGroupId(detectedGroupId);
          activeGroup = modGroups.find((g) => g.templateZh === rawTemplate);
        }
        if (!activeGroup) {
          activeGroup = modGroups.find((g) => g.isPure) || modGroups[0];
          filterEl.setAttribute('data-poexd-mod-group', activeGroup.id);
        }

        modGroups.forEach((g, modGroupIndex) => {
          items.push({
            id: `group-${g.id}`,
            type: 'mod_group_option',
            label: g.label,
            groupId: g.id,
            groupIndex: modGroupIndex,
            ...(g.affinityLabel ? { affinityLabel: g.affinityLabel } : {}),
            isActive: g.id === activeGroup!.id,
          });
        });

        tierSource = activeGroup.tiers;
        activeGroupId = activeGroup.id;
      }

      const mapped = tierSource
        .map((tier, idx) => {
          const tierName = `T${tierSource.length - idx}`;
          return { tier, tierName };
        })
        .reverse();

      mapped.forEach(({ tier, tierName }) => {
        const { rangeText, valMin, valMax, isRange } = options.tierDomainService.parseTierValues(
          tier,
          effectiveStatId,
        );
        items.push({
          id: activeGroupId ? `tier-${activeGroupId}-${tierName}` : `tier-${tierName}`,
          type: 'tier',
          label: `${tierName}${tier.level != null ? ` (Lv.${tier.level})` : ''}${rangeText}`,
          tierName,
          tierLevel: tier.level,
          rangeText: rangeText.trim(),
          valMin,
          valMax,
          isRange,
        });
      });
    }
  } else {
    items.push({
      id: 'trigger_modal',
      type: 'trigger_modal',
      label: t('common.selectItemCategory'),
    });
  }

  const onSelect = (item: TierDropdownItemSpec, mode?: 'min' | 'both' | 'max') => {
    const slotKey = slotEl.getAttribute('data-poexd-slot-key') || '';
    if (item.type === 'switch_category' || item.type === 'trigger_modal') {
      if (gIdx !== null && fIdx !== null) {
        setTierCategorySelectionTarget({
          slotKey,
          groupIndex: gIdx,
          filterIndex: fIdx,
          bindingId,
          availableTypes: typeList,
          currentCategory: detectedType || '',
        });
        dispatchPoeEvent('poexd-trigger-select-type-modal');
      }
    } else if (item.type === 'mod_group_option') {
      if (item.groupId) {
        filterEl.setAttribute('data-poexd-mod-group', item.groupId);
        if (bindingId) {
          dispatchPoeEvent('poexd-update-stat-category', {
            bindingId,
            groupIndex: gIdx ?? undefined,
            filterIndex: fIdx ?? undefined,
            modGroup: item.groupId,
          });
        }
      }
      const nextData = createTierSlotDomainData(tiers, filterEl, slotEl, options, statId);
      upsertTierSlot({
        key: slotKey,
        targetEl: slotEl,
        items: nextData.items,
        onSelect: nextData.onSelect,
        getCurrentValues: nextData.getCurrentValues,
      });
    } else if (item.type === 'tier') {
      if (mode === 'both') {
        applyValues(item.valMin || '', item.valMax || '');
      } else if (mode === 'max') {
        applyValues('', item.valMax || '');
      } else {
        applyValues(item.valMin || '', '');
      }
    }
  };

  return { items, onSelect, getCurrentValues };
}

function createTierSeparator(slotKey: string): HTMLSpanElement {
  const sep = document.createElement('span');
  sep.className = 'sep';
  sep.setAttribute('data-poexd-tier-sep', slotKey);
  return sep;
}

export function createTierSlotController(options: TierSlotControllerOptions): TierSlotController {
  let clearEpoch = 0;

  const resolveEligibleSlotDescriptor = (
    slotKey: string,
    slotEl: HTMLElement,
    filterEl: Element,
    statId: string,
    tiers: any[] | null | undefined,
  ): TierSlotDescriptor => {
    const { items, onSelect, getCurrentValues } = createTierSlotDomainData(
      tiers,
      filterEl,
      slotEl,
      options,
      statId,
    );
    return {
      key: slotKey,
      targetEl: slotEl,
      items,
      onSelect,
      getCurrentValues,
    };
  };

  const sync = async (generation: number): Promise<void> => {
    const epochAtStart = clearEpoch;
    const rawMods = await options.tierDomainService.loadModsData(
      generation,
      options.isCurrentGeneration,
    );
    if (!rawMods || !options.isCurrentGeneration(generation) || clearEpoch !== epochAtStart) {
      return;
    }

    const allGroups = document.querySelectorAll('.search-advanced-pane.brown .filter-group');
    const statGroups = Array.from(allGroups).filter(isStatFilterGroup);

    const filterElements: Element[] = [];
    statGroups.forEach((group) => {
      const filters = group.querySelectorAll('.filter-group-body .filter:not(.filter-padded)');
      filters.forEach((f) => filterElements.push(f));
    });

    const discoveredSlots: TierSlotDescriptor[] = [];

    filterElements.forEach((filterEl) => {
      const statId = filterEl.getAttribute('data-poexd-stat-id');
      const existingSlot = filterEl.querySelector<HTMLElement>('.poexd-tier-trigger-slot');
      if (!statId) {
        removeTierSlotArtifacts(existingSlot);
        return;
      }

      const tiers = options.tierDomainService.findModTiersByStatId(statId, rawMods);
      const eligibility = options.tierDomainService.resolveTierModEligibility(tiers, statId);
      if (!eligibility.isEligible) {
        removeTierSlotArtifacts(existingSlot);
        return;
      }

      const { minInput } = findMinMaxInputs(filterEl);
      if (!minInput) {
        removeTierSlotArtifacts(existingSlot);
        return;
      }

      // 尋找或建立 Light DOM Teleport slot
      let slotEl = existingSlot;
      if (!slotEl) {
        const slotKey = `tier-slot-${++nextTierSlotSeq}-${statId}`;
        slotEl = document.createElement('span');
        slotEl.className = 'poexd-tier-trigger-slot';
        slotEl.setAttribute('data-poexd-slot-key', slotKey);

        const prevSep = minInput.previousElementSibling;
        if (prevSep && prevSep.classList.contains('sep')) {
          const sepSpan = createTierSeparator(slotKey);
          minInput.parentNode?.insertBefore(sepSpan, minInput);
          minInput.parentNode?.insertBefore(slotEl, sepSpan);
        } else {
          const sepLeft = createTierSeparator(slotKey);
          const sepRight = createTierSeparator(slotKey);
          minInput.parentNode?.insertBefore(sepRight, minInput);
          minInput.parentNode?.insertBefore(slotEl, sepRight);
          minInput.parentNode?.insertBefore(sepLeft, slotEl);
        }
      }

      const slotKey = slotEl.getAttribute('data-poexd-slot-key') || `tier-slot-${statId}`;
      discoveredSlots.push(resolveEligibleSlotDescriptor(slotKey, slotEl, filterEl, statId, tiers));
    });

    // 清除不在 discoveredSlots 中的任何孤立 slot 與 bound separators
    const discoveredSlotKeys = new Set(discoveredSlots.map((s) => s.key));
    statGroups.forEach((group) => {
      group.querySelectorAll<HTMLElement>('.poexd-tier-trigger-slot').forEach((slotEl) => {
        const key = slotEl.getAttribute('data-poexd-slot-key');
        if (!key || !discoveredSlotKeys.has(key)) {
          removeTierSlotArtifacts(slotEl);
        }
      });
    });

    syncTierSlots(discoveredSlots);
  };

  const refreshSlot = async (slotKey: string): Promise<boolean> => {
    const slotEl = document.querySelector<HTMLElement>(`[data-poexd-slot-key="${slotKey}"]`);
    if (!slotEl) return false;
    const filterEl = slotEl.closest('[data-poexd-stat-id]') || slotEl.closest('.filter');
    if (!filterEl) return false;
    const statId = filterEl.getAttribute('data-poexd-stat-id');
    if (!statId) return false;

    const gen = options.getCurrentGeneration ? options.getCurrentGeneration() : 0;
    const rawMods =
      options.tierDomainService.getRawModsData() ??
      (await options.tierDomainService.loadModsData(gen, options.isCurrentGeneration));
    if (!rawMods) return false;
    const tiers = options.tierDomainService.findModTiersByStatId(statId, rawMods);
    const eligibility = options.tierDomainService.resolveTierModEligibility(tiers, statId);
    if (!eligibility.isEligible) {
      removeTierSlotArtifacts(slotEl);
      return false;
    }

    upsertTierSlot(resolveEligibleSlotDescriptor(slotKey, slotEl, filterEl, statId, tiers));
    return true;
  };

  const clear = (): void => {
    clearEpoch += 1;
    cleanAllTierSlotArtifacts();
  };

  return {
    sync,
    refreshSlot,
    clear,
  };
}
