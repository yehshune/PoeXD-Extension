// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTierDomainService } from '@/entrypoints/content/logic/tier-domain-service';
import { createTierSlotController } from '@/entrypoints/content/logic/tier-slot-controller';
import { listenPoeEvent } from '@/utils/event-contracts';
import { resetI18nStateForTests } from '@/utils/i18n';
import {
  activeTierSlots,
  clearTierCategorySelectionTarget,
  clearTierSlots,
  getTierCategorySelectionTarget,
} from '@/utils/tier-slot-registry';

function buildStatFilterDom(options?: {
  statId?: string;
  category?: string;
  bindingId?: string;
  useContainers?: boolean;
}) {
  const {
    statId = 'explicit.stat_life',
    category = 'body-armour',
    bindingId = 'bind-1',
    useContainers = true,
  } = options ?? {};

  const container = document.createElement('div');
  container.className = 'search-advanced-pane brown';

  const filterGroup = document.createElement('div');
  filterGroup.className = 'filter-group';
  filterGroup.setAttribute('data-poexd-group-idx', '0');

  const header = document.createElement('div');
  header.className = 'filter-group-header';
  const select = document.createElement('div');
  select.className = 'filter-select';
  header.appendChild(select);
  filterGroup.appendChild(header);

  const body = document.createElement('div');
  body.className = 'filter-group-body';

  const filterEl = document.createElement('div');
  filterEl.className = 'filter';
  filterEl.setAttribute('data-poexd-filter-idx', '2');
  filterEl.setAttribute('data-poexd-stat-id', statId);
  if (category) {
    filterEl.setAttribute('data-poexd-category', category);
  }
  filterEl.setAttribute('data-poexd-binding-id', bindingId);

  const minInput = document.createElement('input');
  minInput.placeholder = 'min';
  const maxInput = document.createElement('input');
  maxInput.placeholder = 'max';

  if (useContainers) {
    const minWrap = document.createElement('div');
    minWrap.className = 'min';
    minWrap.appendChild(minInput);
    const maxWrap = document.createElement('div');
    maxWrap.className = 'max';
    maxWrap.appendChild(maxInput);
    filterEl.appendChild(minWrap);
    filterEl.appendChild(maxWrap);
  } else {
    filterEl.appendChild(minInput);
    filterEl.appendChild(maxInput);
  }

  body.appendChild(filterEl);
  filterGroup.appendChild(body);
  container.appendChild(filterGroup);
  document.body.appendChild(container);

  return { container, filterGroup, filterEl, minInput, maxInput };
}

describe('Tier Slot Controller', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    document.body.innerHTML = '';
    clearTierSlots();
    clearTierCategorySelectionTarget();
  });

  afterEach(() => {
    clearTierSlots();
    clearTierCategorySelectionTarget();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('populates min, max, and both inputs accurately via shared findMinMaxInputs lookup', async () => {
    const { minInput, maxInput } = buildStatFilterDom({ useContainers: false });

    const tierDomainService = createTierDomainService('poe1');
    const rawMods = {
      'explicit.stat_life': [
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 86,
          values: [[110, 129]],
        },
      ],
    };
    vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);
    vi.spyOn(tierDomainService, 'getRawModsData').mockReturnValue(rawMods);

    const controller = createTierSlotController({
      version: 'poe1',
      tierDomainService,
      isCurrentGeneration: () => true,
    });

    await controller.sync(1);
    const slot = activeTierSlots.value[0];
    expect(slot).toBeTruthy();

    const tierItem = slot.items.find((i) => i.type === 'tier')!;
    expect(tierItem).toBeTruthy();

    slot.onSelect(tierItem, 'min');
    expect(minInput.value).toBe('110');
    expect(maxInput.value).toBe('');
    expect(slot.getCurrentValues?.()).toEqual({ min: '110', max: '' });

    slot.onSelect(tierItem, 'max');
    expect(minInput.value).toBe('');
    expect(maxInput.value).toBe('129');

    slot.onSelect(tierItem, 'both');
    expect(minInput.value).toBe('110');
    expect(maxInput.value).toBe('129');
    expect(slot.getCurrentValues?.()).toEqual({ min: '110', max: '129' });
  });

  it('ignores stale async sync completions when generation advances mid-flight', async () => {
    buildStatFilterDom();

    let currentGen = 1;
    let resolveMods!: (mods: Record<string, any[]>) => void;
    const modsPromise = new Promise<Record<string, any[]>>((resolve) => {
      resolveMods = resolve;
    });

    const tierDomainService = createTierDomainService('poe1');
    vi.spyOn(tierDomainService, 'loadModsData').mockImplementation(() => modsPromise);

    const controller = createTierSlotController({
      version: 'poe1',
      tierDomainService,
      isCurrentGeneration: (gen) => gen === currentGen,
      getCurrentGeneration: () => currentGen,
    });

    const syncTask = controller.sync(1);
    currentGen = 2;
    resolveMods({
      'explicit.stat_life': [
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 86,
          values: [[100, 120]],
        },
      ],
    });
    await syncTask;

    expect(activeTierSlots.value).toHaveLength(0);
    expect(document.querySelector('.poexd-tier-trigger-slot')).toBeNull();
  });

  it('refreshes slot descriptors in place via refreshSlot(slotKey)', async () => {
    const { filterEl } = buildStatFilterDom({ category: 'body-armour' });

    const tierDomainService = createTierDomainService('poe1');
    const rawMods = {
      'explicit.stat_life': [
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 86,
          values: [[100, 120]],
        },
        {
          affinities: ['normal'],
          types: ['helmet'],
          level: 82,
          values: [[60, 79]],
        },
      ],
    };
    vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);
    vi.spyOn(tierDomainService, 'getRawModsData').mockReturnValue(rawMods);

    const controller = createTierSlotController({
      version: 'poe1',
      tierDomainService,
      isCurrentGeneration: () => true,
      getCurrentGeneration: () => 1,
    });

    await controller.sync(1);
    const slotKey = activeTierSlots.value[0].key;
    expect(activeTierSlots.value[0].items.find((i) => i.type === 'tier')?.valMin).toBe('100');

    filterEl.setAttribute('data-poexd-category', 'helmet');
    const refreshed = await controller.refreshSlot(slotKey);

    expect(refreshed).toBe(true);
    expect(activeTierSlots.value[0].items.find((i) => i.type === 'tier')?.valMin).toBe('60');
  });

  it('handles mod_group_option selection by updating attribute, dispatching category event, and refreshing slot', async () => {
    const { filterEl } = buildStatFilterDom();

    const tierDomainService = createTierDomainService('poe1');
    const rawMods = {
      'explicit.stat_life': [
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 86,
          values: [[100, 120]],
          key: '# 最大生命',
        },
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 80,
          values: [[30, 45]],
          key: '# 最大生命\n#% 護甲',
        },
      ],
    };
    vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);
    vi.spyOn(tierDomainService, 'getRawModsData').mockReturnValue(rawMods);

    const controller = createTierSlotController({
      version: 'poe1',
      tierDomainService,
      isCurrentGeneration: () => true,
    });

    await controller.sync(1);
    const initialSlot = activeTierSlots.value[0];
    const inactiveGroup = initialSlot.items.find(
      (i) => i.type === 'mod_group_option' && !i.isActive,
    );
    expect(inactiveGroup).toBeTruthy();

    const updateEvents: unknown[] = [];
    const unlisten = listenPoeEvent('poexd-update-stat-category', (detail) => {
      updateEvents.push(detail);
    });

    try {
      initialSlot.onSelect(inactiveGroup!);

      expect(filterEl.getAttribute('data-poexd-mod-group')).toBe(inactiveGroup!.groupId);
      expect(updateEvents).toEqual([
        {
          bindingId: 'bind-1',
          groupIndex: 0,
          filterIndex: 2,
          modGroup: inactiveGroup!.groupId,
        },
      ]);

      const updatedSlot = activeTierSlots.value[0];
      const newlyActiveGroup = updatedSlot.items.find((i) => i.id === inactiveGroup!.id);
      expect(newlyActiveGroup?.isActive).toBe(true);
      expect(updatedSlot.items.find((i) => i.type === 'tier')?.valMin).toBe('30');
    } finally {
      unlisten();
    }
  });

  it('writes typed category target to the tier slot registry (never window) on trigger_modal and switch_category', async () => {
    const { filterEl } = buildStatFilterDom({ category: '' });

    const tierDomainService = createTierDomainService('poe1');
    const rawMods = {
      'explicit.stat_life': [
        {
          affinities: ['normal'],
          types: ['body-armour', 'helmet'],
          level: 86,
          values: [[100, 120]],
        },
      ],
    };
    vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);
    vi.spyOn(tierDomainService, 'getRawModsData').mockReturnValue(rawMods);

    const controller = createTierSlotController({
      version: 'poe1',
      tierDomainService,
      isCurrentGeneration: () => true,
    });

    await controller.sync(1);
    const slot = activeTierSlots.value[0];
    const triggerItem = slot.items.find((i) => i.type === 'trigger_modal')!;
    expect(triggerItem).toBeTruthy();

    let modalTriggerCount = 0;
    const unlisten = listenPoeEvent('poexd-trigger-select-type-modal', () => {
      modalTriggerCount += 1;
    });

    try {
      slot.onSelect(triggerItem);

      expect(modalTriggerCount).toBe(1);
      expect((window as any).__poexd_selecting_target__).toBeUndefined();
      expect(getTierCategorySelectionTarget()).toEqual({
        slotKey: slot.key,
        groupIndex: 0,
        filterIndex: 2,
        bindingId: 'bind-1',
        availableTypes: ['body-armour', 'helmet'],
        currentCategory: '',
      });

      // Now verify switch_category with a populated currentCategory
      filterEl.setAttribute('data-poexd-category', 'body-armour');
      await controller.refreshSlot(slot.key);
      const updatedSlot = activeTierSlots.value[0];
      const switchItem = updatedSlot.items.find((i) => i.type === 'switch_category')!;
      expect(switchItem).toBeTruthy();

      updatedSlot.onSelect(switchItem);

      expect(modalTriggerCount).toBe(2);
      expect((window as any).__poexd_selecting_target__).toBeUndefined();
      expect(getTierCategorySelectionTarget()).toEqual({
        slotKey: updatedSlot.key,
        groupIndex: 0,
        filterIndex: 2,
        bindingId: 'bind-1',
        availableTypes: ['body-armour', 'helmet'],
        currentCategory: 'body-armour',
      });
    } finally {
      unlisten();
    }
  });

  it('removes all injected DOM artifacts and clears registered slots on clear()', async () => {
    buildStatFilterDom();

    const tierDomainService = createTierDomainService('poe1');
    const rawMods = {
      'explicit.stat_life': [
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 86,
          values: [[100, 120]],
        },
      ],
    };
    vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);

    const controller = createTierSlotController({
      version: 'poe1',
      tierDomainService,
      isCurrentGeneration: () => true,
    });

    await controller.sync(1);
    expect(activeTierSlots.value).toHaveLength(1);
    expect(document.querySelectorAll('.poexd-tier-trigger-slot')).toHaveLength(1);
    expect(document.querySelectorAll('[data-poexd-tier-sep]').length).toBeGreaterThan(0);

    controller.clear();

    expect(activeTierSlots.value).toHaveLength(0);
    expect(document.querySelectorAll('.poexd-tier-trigger-slot')).toHaveLength(0);
    expect(document.querySelectorAll('[data-poexd-tier-sep]')).toHaveLength(0);
  });

  it('does not stamp data-poexd-mod-group onto filterEl during default fallback sync (prevents dom-tagger/filter-observer loop)', async () => {
    const { filterEl } = buildStatFilterDom();
    expect(filterEl.hasAttribute('data-poexd-mod-group')).toBe(false);

    const tierDomainService = createTierDomainService('poe1');
    const rawMods = {
      'explicit.stat_life': [
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 86,
          values: [[100, 120]],
          key: '# 最大生命',
        },
        {
          affinities: ['normal'],
          types: ['body-armour'],
          level: 80,
          values: [[30, 45]],
          key: '# 最大生命\n#% 護甲',
        },
      ],
    };
    vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);

    const controller = createTierSlotController({
      version: 'poe1',
      tierDomainService,
      isCurrentGeneration: () => true,
    });

    await controller.sync(1);

    const slot = activeTierSlots.value[0];
    const groupOptions = slot.items.filter((i) => i.type === 'mod_group_option');
    expect(groupOptions).toHaveLength(2);
    expect(groupOptions[0].isActive).toBe(true);
    // 預設退回純粹分組時不得改寫 DOM 屬性，避免與 Main World dom-tagger 的 removeAttribute 形成微任務死鎖
    expect(filterEl.hasAttribute('data-poexd-mod-group')).toBe(false);
  });
});
