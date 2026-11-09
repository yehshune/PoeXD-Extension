// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInjectedControls,
  createTierSlotDomainData,
} from '@/entrypoints/content/logic/injected-controls';
import {
  createTierDomainService,
  filterTiersByCategory,
  findModTiersByStatId,
  groupTiersByMod,
  parseTierValues,
  resolveTargetAffinitiesByStatId,
  resolveTierModEligibility,
} from '@/entrypoints/content/logic/tier-domain-service';
import { activeTierSlots, clearTierSlots } from '@/utils/tier-slot-registry';
import { listenPoeEvent } from '@/utils/event-contracts';

describe('Tier slot eligibility & dropdown empty-state contracts', () => {
  let container: HTMLElement;
  let filterGroup: HTMLElement;
  let filterEl: HTMLElement;
  let minInput: HTMLInputElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    clearTierSlots();

    // 建置 PoE 官方結構: .search-advanced-pane.brown .filter-group
    container = document.createElement('div');
    container.className = 'search-advanced-pane brown';

    filterGroup = document.createElement('div');
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

    filterEl = document.createElement('div');
    filterEl.className = 'filter';
    filterEl.setAttribute('data-poexd-filter-idx', '0');

    const minContainer = document.createElement('div');
    minContainer.className = 'min';
    minInput = document.createElement('input');
    minInput.placeholder = '最小';
    minContainer.appendChild(minInput);
    filterEl.appendChild(minContainer);

    body.appendChild(filterEl);
    filterGroup.appendChild(body);
    container.appendChild(filterGroup);
    document.body.appendChild(container);
  });

  afterEach(() => {
    clearTierSlots();
    document.body.innerHTML = '';
    delete (window as any).__poexd_selecting_target__;
  });

  describe('1. 詞綴完全沒有任何 usable item type (Regression 1)', () => {
    it('多階級 tiers 存在但沒有任何 normal tier 時，不建立 T slot 且 items 為空', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-no-normal');

      const corruptedOnlyTiers = [
        {
          affinities: ['corrupted'],
          types: ['helmet'],
          level: 80,
          values: [[10, 20]],
        },
        {
          affinities: ['corrupted'],
          types: ['helmet'],
          level: 70,
          values: [[5, 10]],
        },
      ];

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(corruptedOnlyTiers);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      // DOM 內不應存在 slot
      expect(filterEl.querySelector('.poexd-tier-trigger-slot')).toBeNull();
      expect(activeTierSlots.value).toHaveLength(0);

      // 直接呼叫 createTierSlotDomainData 亦回傳 items 為空
      const dummySlot = document.createElement('span');
      const domainData = createTierSlotDomainData(corruptedOnlyTiers, filterEl, dummySlot, {
        version: 'poe1',
        tierDomainService,
      });
      expect(domainData.items).toEqual([]);
    });

    it('單一 tier 且有 values 時（即使非 normal 如 corrupted），建立 T slot 且可顯示並填入數值', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-corrupted-single');

      const singleCorruptedTier = [
        {
          affinities: ['corrupted'],
          types: ['helmet'],
          level: 80,
          values: [[10, 20]],
        },
      ];

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(singleCorruptedTier);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      // DOM 內應建立 slot
      expect(filterEl.querySelector('.poexd-tier-trigger-slot')).not.toBeNull();
      expect(activeTierSlots.value).toHaveLength(1);

      const slot = activeTierSlots.value[0];
      const tierItem = slot.items.find((i) => i.type === 'tier');
      expect(tierItem).toBeDefined();
      expect(tierItem?.label).toContain('T1');

      // 點擊填入數值
      slot.onSelect(tierItem!, 'min');
      expect(minInput.value).toBe('10');
    });

    it('normal tiers 存在但 types 聯集為空時，不建立 T slot 且不顯示「此詞綴無可用的物品類別 T 階」', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-empty-types');

      const noTypesTiers = [
        {
          affinities: ['normal'],
          types: [],
          level: 80,
          values: [[10, 20]],
        },
        {
          affinities: ['normal'],
          types: [''],
          level: 70,
          values: [[5, 15]],
        },
      ];

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(noTypesTiers);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      // 不建立 T slot
      expect(filterEl.querySelector('.poexd-tier-trigger-slot')).toBeNull();
      expect(activeTierSlots.value).toHaveLength(0);

      // domainData items 為空，絕不包含舊提示文字
      const dummySlot = document.createElement('span');
      const domainData = createTierSlotDomainData(noTypesTiers, filterEl, dummySlot, {
        version: 'poe1',
        tierDomainService,
      });
      expect(domainData.items).toEqual([]);
      expect(domainData.items.some((i) => i.label.includes('此詞綴無可用的物品類別'))).toBe(false);
    });

    it('單一 tier 且無 values 時，不建立 T slot', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-single-tier-no-val');

      const singleTierNoValues = [
        {
          affinities: ['normal'],
          types: ['helmet'],
          level: 80,
          values: [],
        },
      ];

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(singleTierNoValues);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      expect(filterEl.querySelector('.poexd-tier-trigger-slot')).toBeNull();
      expect(activeTierSlots.value).toHaveLength(0);
    });
  });

  describe('2. usable types = helmet/gloves，current category = ring (Regression 2)', () => {
    const multiTypeTiers = [
      {
        affinities: ['normal'],
        types: ['helmet', 'gloves'],
        level: 84,
        values: [[40, 50]],
      },
      {
        affinities: ['normal'],
        types: ['helmet', 'gloves'],
        level: 70,
        values: [[30, 39]],
      },
    ];

    it('T按鈕存在，dropdown 有「戒指 (點選切換)」、有「此類別無此詞綴」、無 Tier rows', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-helm-gloves');
      filterEl.setAttribute('data-poexd-category', 'ring');

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(multiTypeTiers);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      // T 按鈕 / slot 必須存在
      const slotEl = filterEl.querySelector<HTMLElement>('.poexd-tier-trigger-slot');
      expect(slotEl).not.toBeNull();
      expect(activeTierSlots.value).toHaveLength(1);

      const slotData = activeTierSlots.value[0];
      const items = slotData.items;

      // 1. 保留「戒指 (點選切換)」
      const switchItem = items.find((i) => i.type === 'switch_category');
      expect(switchItem).toBeDefined();
      expect(switchItem?.label).not.toContain('目前類別：');
      expect(switchItem?.label).toContain('戒指');
      expect(switchItem?.label).toContain('(點選切換)');

      // 2. 顯示明確 empty state: 「此類別無此詞綴」
      const emptyStateItem = items.find((i) => i.id === 'no-category-tiers');
      expect(emptyStateItem).toBeDefined();
      expect(emptyStateItem?.type).toBe('header');
      expect(emptyStateItem?.label).toBe('此類別無此詞綴');

      // 3. 不得顯示任何 Tier rows (不顯示假的 T1/T2)
      const tierRows = items.filter((i) => i.type === 'tier');
      expect(tierRows).toHaveLength(0);
    });

    it('使用者點擊「戒指 (點選切換)」切換時，攜帶可用類型 helmet/gloves 觸發選擇 modal', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-helm-gloves');
      filterEl.setAttribute('data-poexd-category', 'ring');

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(multiTypeTiers);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);
      const slotData = activeTierSlots.value[0];

      let modalTriggered = false;
      const unlisten = listenPoeEvent('poexd-trigger-select-type-modal', () => {
        modalTriggered = true;
      });

      const switchItem = slotData.items.find((i) => i.type === 'switch_category')!;
      slotData.onSelect(switchItem);

      expect(modalTriggered).toBe(true);
      expect((window as any).__poexd_selecting_target__).toMatchObject({
        availableTypes: ['helmet', 'gloves'],
        currentCategory: 'ring',
      });

      unlisten();
    });
  });

  describe('3. current category 改為 helmet (Regression 3)', () => {
    const multiTypeTiers = [
      {
        affinities: ['normal'],
        types: ['helmet', 'gloves'],
        level: 84,
        values: [[40, 50]],
      },
      {
        affinities: ['normal'],
        types: ['helmet', 'gloves'],
        level: 70,
        values: [[30, 39]],
      },
    ];

    it('category 切換至 helmet 後，同一 T 按鈕正常顯示 Helmet tiers 且無 empty-state', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-helm-gloves');
      filterEl.setAttribute('data-poexd-category', 'ring');

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(multiTypeTiers);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      // 初始: ring 狀態
      await injectedControls.injectTierSelectorButtons(1);
      expect(activeTierSlots.value[0].items.some((i) => i.id === 'no-category-tiers')).toBe(true);

      const slotKey = activeTierSlots.value[0].key;

      // 使用者切換類別 -> Main World 更新 DOM 屬性為 helmet
      filterEl.setAttribute('data-poexd-category', 'helmet');

      // 觸發 refresh
      const refreshed = await injectedControls.refreshTierSlotDomain(slotKey);
      expect(refreshed).toBe(true);

      const refreshedSlot = activeTierSlots.value.find((s) => s.key === slotKey);
      expect(refreshedSlot).toBeDefined();

      const items = refreshedSlot!.items;

      // 1. switch_category 顯示頭盔
      const switchItem = items.find((i) => i.type === 'switch_category');
      expect(switchItem?.label).toContain('頭盔');

      // 2. 不應再有「此類別無此詞綴」
      expect(items.some((i) => i.id === 'no-category-tiers')).toBe(false);

      // 3. 正常呈現 Helmet 階級項目 T1, T2
      const tierRows = items.filter((i) => i.type === 'tier');
      expect(tierRows).toHaveLength(2);
      expect(tierRows[0].label).toContain('T1');
      expect(tierRows[1].label).toContain('T2');
    });
  });

  describe('4. filter 沒有 category，但只有一個 usable type (Regression 4)', () => {
    it('維持 auto-select single type 行為，直接顯示目前類別與對應 T階', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-helmet-only');
      filterEl.removeAttribute('data-poexd-category');

      const singleUsableTypeTiers = [
        {
          affinities: ['normal'],
          types: ['helmet'],
          level: 84,
          values: [[50, 60]],
        },
      ];

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(singleUsableTypeTiers);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      expect(activeTierSlots.value).toHaveLength(1);
      const items = activeTierSlots.value[0].items;

      // 1. 自動帶入唯一的 helmet 類別
      const switchItem = items.find((i) => i.type === 'switch_category');
      expect(switchItem).toBeDefined();
      expect(switchItem?.label).toContain('頭盔');

      // 2. 正常顯示 T1
      const tierRows = items.filter((i) => i.type === 'tier');
      expect(tierRows).toHaveLength(1);
      expect(tierRows[0].label).toContain('T1');

      // 3. 不顯示「選擇物品類別」modal trigger
      expect(items.some((i) => i.type === 'trigger_modal')).toBe(false);
    });
  });

  describe('5. filter 沒有 category 且有多個 usable types (Regression 5)', () => {
    it('維持「選擇物品類別」行為，點擊觸發選擇類別 modal', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'stat-unbound-multi');
      filterEl.removeAttribute('data-poexd-category');

      const multiTypeTiers = [
        {
          affinities: ['normal'],
          types: ['helmet', 'gloves', 'boots'],
          level: 84,
          values: [[50, 60]],
        },
      ];

      const tierDomainService = createTierDomainService('poe1');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue({});
      vi.spyOn(tierDomainService, 'findModTiersByStatId').mockReturnValue(multiTypeTiers);

      const injectedControls = createInjectedControls({
        version: 'poe1',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      expect(activeTierSlots.value).toHaveLength(1);
      const items = activeTierSlots.value[0].items;

      // 1. 顯示「選擇物品類別」按鈕
      expect(items).toHaveLength(1);
      const triggerItem = items[0];
      expect(triggerItem.type).toBe('trigger_modal');
      expect(triggerItem.label).toBe('選擇物品類別');

      // 2. 不顯示 switch_category 或 tier rows
      expect(items.some((i) => i.type === 'switch_category')).toBe(false);
      expect(items.some((i) => i.type === 'tier')).toBe(false);

      // 3. 點擊觸發 modal
      let modalFired = false;
      const unlisten = listenPoeEvent('poexd-trigger-select-type-modal', () => {
        modalFired = true;
      });

      activeTierSlots.value[0].onSelect(triggerItem);

      expect(modalFired).toBe(true);
      expect((window as any).__poexd_selecting_target__).toMatchObject({
        availableTypes: ['helmet', 'gloves', 'boots'],
        currentCategory: '',
      });

      unlisten();
    });
  });

  describe('6. Tier domain eligibility & filter SSOT helper contracts', () => {
    it('resolveTierModEligibility contract check', () => {
      expect(resolveTierModEligibility(null)).toEqual({
        isEligible: false,
        normalTiers: [],
        availableTypes: [],
      });
      expect(resolveTierModEligibility([])).toEqual({
        isEligible: false,
        normalTiers: [],
        availableTypes: [],
      });
      expect(
        resolveTierModEligibility([
          { affinities: ['corrupted'], types: ['helmet'], values: [[1, 2]] },
          { affinities: ['corrupted'], types: ['helmet'], values: [[3, 4]] },
        ]),
      ).toEqual({
        isEligible: false,
        normalTiers: [],
        availableTypes: [],
      });
      expect(
        resolveTierModEligibility([
          { affinities: ['corrupted'], types: ['helmet'], values: [[1, 2]] },
        ]),
      ).toEqual({
        isEligible: true,
        normalTiers: [{ affinities: ['corrupted'], types: ['helmet'], values: [[1, 2]] }],
        availableTypes: ['helmet'],
      });
      expect(
        resolveTierModEligibility([{ affinities: ['normal'], types: [], values: [[1, 2]] }]),
      ).toEqual({
        isEligible: false,
        normalTiers: [{ affinities: ['normal'], types: [], values: [[1, 2]] }],
        availableTypes: [],
      });

      const validTiers = [{ affinities: ['normal'], types: ['helmet', 'ring'], values: [[1, 2]] }];
      expect(resolveTierModEligibility(validTiers)).toEqual({
        isEligible: true,
        normalTiers: validTiers,
        availableTypes: ['helmet', 'ring'],
      });
    });

    it('filterTiersByCategory contract check', () => {
      const normalTiers = [
        { types: ['helmet', 'gloves'] },
        { types: ['helmet'] },
        { types: ['boots'] },
      ];

      expect(filterTiersByCategory(normalTiers, 'helmet')).toHaveLength(2);
      expect(filterTiersByCategory(normalTiers, 'gloves')).toHaveLength(1);
      expect(filterTiersByCategory(normalTiers, 'ring')).toEqual([]);
      expect(filterTiersByCategory(normalTiers, null)).toEqual([]);
    });
  });

  describe('7. Prefix-driven affinity and fallback contracts (enchant, rune, desecrated)', () => {
    it('findModTiersByStatId 支援直接查詢以及 enchant / rune fallback 至 explicit', () => {
      const rawMods = {
        'explicit.stat_movement_speed': [{ level: 1, affinities: ['normal'], values: [[10, 20]] }],
        'enchant.stat_direct': [{ level: 1, affinities: ['corrupted'], values: [[5, 10]] }],
      };

      // 1. 直接命中
      expect(findModTiersByStatId('enchant.stat_direct', rawMods)).toEqual(
        rawMods['enchant.stat_direct'],
      );

      // 2. enchant fallback
      expect(findModTiersByStatId('enchant.stat_movement_speed', rawMods)).toEqual(
        rawMods['explicit.stat_movement_speed'],
      );

      // 3. rune fallback
      expect(findModTiersByStatId('rune.stat_movement_speed', rawMods)).toEqual(
        rawMods['explicit.stat_movement_speed'],
      );

      // 4. 不存在的 ID
      expect(findModTiersByStatId('enchant.stat_not_found', rawMods)).toBeNull();
    });

    it('resolveTargetAffinitiesByStatId 正確映射各大類前綴至相應 affinities', () => {
      expect(resolveTargetAffinitiesByStatId('enchant.stat_2923486259')).toEqual([
        'corrupted',
        'enchant',
      ]);
      expect(resolveTargetAffinitiesByStatId('rune.stat_12345')).toEqual(['socketable', 'bonded']);
      expect(resolveTargetAffinitiesByStatId('desecrated.stat_12345')).toEqual(['desecrated']);
      expect(resolveTargetAffinitiesByStatId('implicit.stat_1658498488')).toEqual([
        'normal',
        'corrupted',
      ]);
      expect(resolveTargetAffinitiesByStatId('explicit.stat_12345')).toEqual(['normal']);
      expect(resolveTargetAffinitiesByStatId('fractured.stat_12345')).toEqual(['normal']);
      expect(resolveTargetAffinitiesByStatId(null)).toEqual(['normal']);
      expect(resolveTargetAffinitiesByStatId(undefined)).toEqual(['normal']);
    });

    it('resolveTierModEligibility 依據 statId 前綴篩選相應 affinity 階級', () => {
      const hybridTiers = [
        {
          level: 75,
          types: ['boots'],
          affinities: ['normal'],
          values: [[24, 27]],
        },
        {
          level: 60,
          types: ['boots'],
          affinities: ['normal'],
          values: [[20, 23]],
        },
        {
          level: 1,
          types: ['boots'],
          affinities: ['corrupted'],
          values: [[13, 19]],
        },
        {
          level: 1,
          types: ['boots'],
          affinities: ['socketable'],
          values: [[5, 10]],
        },
      ];

      // explicit: 挑選 normal 階級 (2 筆)
      const explicitResult = resolveTierModEligibility(hybridTiers, 'explicit.stat_movement');
      expect(explicitResult.isEligible).toBe(true);
      expect(explicitResult.normalTiers).toHaveLength(2);
      expect(explicitResult.normalTiers[0].values).toEqual([[24, 27]]);
      expect(explicitResult.normalTiers[1].values).toEqual([[20, 23]]);

      // enchant: 精確挑選 corrupted 階級 (1 筆 13~19%)
      const enchantResult = resolveTierModEligibility(hybridTiers, 'enchant.stat_movement');
      expect(enchantResult.isEligible).toBe(true);
      expect(enchantResult.normalTiers).toHaveLength(1);
      expect(enchantResult.normalTiers[0].values).toEqual([[13, 19]]);

      // rune: 精確挑選 socketable 階級 (1 筆 5~10%)
      const runeResult = resolveTierModEligibility(hybridTiers, 'rune.stat_movement');
      expect(runeResult.isEligible).toBe(true);
      expect(runeResult.normalTiers).toHaveLength(1);
      expect(runeResult.normalTiers[0].values).toEqual([[5, 10]]);

      // desecrated: 若無 desecrated affinity，安全 fallback 至 normal 階級
      const desecratedResult = resolveTierModEligibility(hybridTiers, 'desecrated.stat_movement');
      expect(desecratedResult.isEligible).toBe(true);
      expect(desecratedResult.normalTiers).toHaveLength(2);

      // influence (shaper, redeemer 等): 純勢力詞綴在 explicit. 查詢時成功納入候選階級
      const influenceTiers = [
        {
          level: 75,
          types: ['boots'],
          affinities: ['shaper'],
          values: [[8, 10]],
        },
        {
          level: 80,
          types: ['boots'],
          affinities: ['shaper'],
          values: [[11, 15]],
        },
      ];
      const influenceResult = resolveTierModEligibility(
        influenceTiers,
        'explicit.stat_shaper_cooldown',
      );
      expect(influenceResult.isEligible).toBe(true);
      expect(influenceResult.normalTiers).toHaveLength(2);
      expect(influenceResult.availableTypes).toEqual(['boots']);

      // bestiary (野獸詞綴 如蟹將祝福 2 階: Lv.20 & Lv.30): 在 explicit. 查詢時成功納入候選階級
      const bestiaryTiers = [
        {
          level: 20,
          types: ['boots', 'gloves'],
          affinities: ['bestiary'],
          values: [[20, 20]],
        },
        {
          level: 20,
          types: ['boots', 'gloves'],
          affinities: ['bestiary'],
          values: [[30, 30]],
        },
      ];
      const bestiaryResult = resolveTierModEligibility(bestiaryTiers, 'explicit.stat_4102318278');
      expect(bestiaryResult.isEligible).toBe(true);
      expect(bestiaryResult.normalTiers).toHaveLength(2);
      expect(bestiaryResult.availableTypes).toEqual(['boots', 'gloves']);

      // infamous (傭兵詞綴): 在 explicit. 查詢時成功納入候選階級
      const infamousTiers = [
        {
          level: 68,
          types: ['body-armour'],
          affinities: ['infamous'],
          values: [[1, 3]],
        },
      ];
      const infamousResult = resolveTierModEligibility(infamousTiers, 'explicit.stat_1235229114');
      expect(infamousResult.isEligible).toBe(true);
      expect(infamousResult.normalTiers).toHaveLength(1);
      expect(infamousResult.availableTypes).toEqual(['body-armour']);
    });

    it('整合測試: DOM 上帶有 enchant.stat 前綴時，T 階按鈕精確呈現並填入 corrupted 階級數值', async () => {
      // 模擬 PoE2 官方交易網 filter 行：已汙染詞綴帶有 enchant 前綴
      filterEl.setAttribute('data-poexd-stat-id', 'enchant.stat_2923486259');
      filterEl.setAttribute('data-poexd-category', 'boots');

      const maxContainer = document.createElement('div');
      maxContainer.className = 'max';
      const maxInput = document.createElement('input');
      maxInput.placeholder = '最大';
      maxContainer.appendChild(maxInput);
      filterEl.appendChild(maxContainer);

      const hybridTiers = [
        {
          level: 75,
          types: ['boots'],
          affinities: ['normal'],
          values: [[24, 27]],
        },
        {
          level: 1,
          types: ['boots'],
          affinities: ['corrupted'],
          values: [[13, 19]],
        },
      ];

      const rawMods = {
        'explicit.stat_2923486259': hybridTiers,
      };

      const tierDomainService = createTierDomainService('poe2');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);
      vi.spyOn(tierDomainService, 'getRawModsData').mockReturnValue(rawMods);

      const injectedControls = createInjectedControls({
        version: 'poe2',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);

      // 驗證 slot 已建立
      expect(activeTierSlots.value).toHaveLength(1);
      const slot = activeTierSlots.value[0];
      const items = slot.items;

      // 應包含類別切換按鈕以及 corrupted 對應的 T1 階級 (13 ~ 19)
      expect(items.some((i) => i.type === 'switch_category')).toBe(true);
      const tierItems = items.filter((i) => i.type === 'tier');
      expect(tierItems).toHaveLength(1);
      expect(tierItems[0].id).toBe('tier-T1');
      expect(tierItems[0].valMin).toBe('13');
      expect(tierItems[0].valMax).toBe('19');
      expect(tierItems[0].label).toContain('(13 ~ 19)');

      // 點擊填入數值
      slot.onSelect(tierItems[0], 'both');
      expect(minInput.value).toBe('13');
      expect(maxInput.value).toBe('19');
    });
  });

  describe('9. 詞綴分組與複合詞綴 T 階切換 (Option C)', () => {
    it('parseTierValues 遇複合詞綴 (ids.length > 1) 依 statId 精確取值，不與其他詞綴數值取平均', () => {
      const compoundTier = {
        ids: ['explicit.stat_4015621042', 'explicit.stat_3299347043'],
        values: [
          ['6', '13'],
          ['7', '10'],
        ],
      };

      // 查詢 energy shield (index 0)
      const esResult = parseTierValues(compoundTier, 'explicit.stat_4015621042');
      expect(esResult.valMin).toBe('6');
      expect(esResult.valMax).toBe('13');
      expect(esResult.rangeText).toBe(' (6 ~ 13)');

      // 查詢 life (index 1)
      const lifeResult = parseTierValues(compoundTier, 'explicit.stat_3299347043');
      expect(lifeResult.valMin).toBe('7');
      expect(lifeResult.valMax).toBe('10');
      expect(lifeResult.rangeText).toBe(' (7 ~ 10)');
    });

    it('parseTierValues 遇複合詞綴包含無數值布林詞綴 (如不會被點燃) 時保留空陣列且不誤用後續詞綴數值', () => {
      const igniteCompoundTier = {
        displayKey: '不會被點燃|||||-10受到的攻擊擊中物理傷害',
        displayTemplate: '不會被點燃|||||#受到的攻擊擊中物理傷害',
        ids: ['rune.stat_331731406', 'rune.stat_3441651621'],
        values: [[], ['-10']],
      };

      // 查詢 不會被點燃 (index 0，無數值)
      const igniteResult = parseTierValues(igniteCompoundTier, 'rune.stat_331731406');
      expect(igniteResult.valMin).toBe('');
      expect(igniteResult.valMax).toBe('');
      expect(igniteResult.rangeText).toBe('');
      expect(igniteResult.isRange).toBe(false);

      // 查詢 受到的攻擊擊中物理傷害 (index 1，值 -10)
      const dmgResult = parseTierValues(igniteCompoundTier, 'rune.stat_3441651621');
      expect(dmgResult.valMin).toBe('-10');
      expect(dmgResult.valMax).toBe('-10');
      expect(dmgResult.rangeText).toBe(' (-10 ~ -10)');
      expect(dmgResult.isRange).toBe(true);
    });

    it('groupTiersByMod 將純粹詞綴排在首位，並將 ||||| 轉為 \\n 換行', () => {
      const tiers = [
        { displayTemplate: '增加#%能量護盾|||||#最大生命', level: 8 },
        { displayTemplate: '增加#%能量護盾', level: 2 },
        { displayTemplate: '增加#%能量護盾|||||#最大魔力', level: 8 },
      ];

      const groups = groupTiersByMod(tiers);
      expect(groups).toHaveLength(3);
      expect(groups[0].isPure).toBe(true);
      expect(groups[0].label).toBe('增加#%能量護盾');
      expect(groups[1].label).toBe('增加#%能量護盾\n#最大生命');
      expect(groups[2].label).toBe('增加#%能量護盾\n#最大魔力');
    });

    it('多詞綴分組時呈現頂部 switch_mod_group，點擊可切換至分組列表並各自具備獨立 T 階', async () => {
      filterEl.setAttribute('data-poexd-stat-id', 'explicit.stat_4015621042');
      filterEl.setAttribute('data-poexd-category', 'body-armour');

      const sampleTiers = [
        // Pure ES
        {
          displayTemplate: '增加#%能量護盾',
          level: 2,
          types: ['body-armour'],
          affinities: ['normal'],
          ids: ['explicit.stat_4015621042'],
          values: [['15', '26']],
        },
        {
          displayTemplate: '增加#%能量護盾',
          level: 75,
          types: ['body-armour'],
          affinities: ['normal'],
          ids: ['explicit.stat_4015621042'],
          values: [['101', '110']],
        },
        // Hybrid ES + Life
        {
          displayTemplate: '增加#%能量護盾|||||#最大生命',
          level: 8,
          types: ['body-armour'],
          affinities: ['normal'],
          ids: ['explicit.stat_4015621042', 'explicit.stat_3299347043'],
          values: [
            ['6', '13'],
            ['7', '10'],
          ],
        },
        {
          displayTemplate: '增加#%能量護盾|||||#最大生命',
          level: 78,
          types: ['body-armour'],
          affinities: ['normal'],
          ids: ['explicit.stat_4015621042', 'explicit.stat_3299347043'],
          values: [
            ['39', '42'],
            ['42', '49'],
          ],
        },
      ];

      const rawMods = {
        'explicit.stat_4015621042': sampleTiers,
      };

      const tierDomainService = createTierDomainService('poe2');
      vi.spyOn(tierDomainService, 'loadModsData').mockResolvedValue(rawMods);
      vi.spyOn(tierDomainService, 'getRawModsData').mockReturnValue(rawMods);

      const injectedControls = createInjectedControls({
        version: 'poe2',
        tierDomainService,
        isCurrentGeneration: () => true,
      });

      await injectedControls.injectTierSelectorButtons(1);
      const slot = activeTierSlots.value[0];

      // 1. 預設顯示純粹詞綴之階級 (T1 Lv.75, T2 Lv.2) 與頂部 switch_mod_group
      const switchModGroup = slot.items.find((i) => i.type === 'switch_mod_group');
      expect(switchModGroup).toBeDefined();
      expect(switchModGroup?.label).toBe('增加#%能量護盾');

      const tierItems = slot.items.filter((i) => i.type === 'tier');
      expect(tierItems).toHaveLength(2);
      expect(tierItems[0].label).toContain('T1 (Lv.75) (101 ~ 110)');
      expect(tierItems[1].label).toContain('T2 (Lv.2) (15 ~ 26)');

      // 2. 點擊 switch_mod_group 切換至 groups 檢視
      slot.onSelect(switchModGroup!);
      const groupsSlot = activeTierSlots.value[0];
      const backItem = groupsSlot.items.find((i) => i.type === 'back_to_tiers');
      expect(backItem).toBeDefined();

      const groupOptions = groupsSlot.items.filter((i) => i.type === 'mod_group_option');
      expect(groupOptions).toHaveLength(2);
      expect(groupOptions[0].label).toBe('增加#%能量護盾');
      expect(groupOptions[0].isActive).toBe(true);
      expect(groupOptions[0].groupIndex).toBe(0);
      expect(groupOptions[1].label).toBe('增加#%能量護盾\n#最大生命');
      expect(groupOptions[1].isActive).toBe(false);
      expect(groupOptions[1].groupIndex).toBe(1);

      // 3. 點選第二個分組 (複合生命)
      groupsSlot.onSelect(groupOptions[1]);
      const hybridSlot = activeTierSlots.value[0];

      // 切換後回到 tiers 檢視，頂部標籤更新為複合詞綴 (換行)
      const updatedSwitch = hybridSlot.items.find((i) => i.type === 'switch_mod_group');
      expect(updatedSwitch?.label).toBe('增加#%能量護盾\n#最大生命');

      // 階級獨立編號為 T1 (Lv.78) 與 T2 (Lv.8)，數值精確為 ES% 區間 (39 ~ 42 與 6 ~ 13)
      const hybridTiers = hybridSlot.items.filter((i) => i.type === 'tier');
      expect(hybridTiers).toHaveLength(2);
      expect(hybridTiers[0].label).toContain('T1 (Lv.78) (39 ~ 42)');
      expect(hybridTiers[0].valMin).toBe('39');
      expect(hybridTiers[0].valMax).toBe('42');
      expect(hybridTiers[1].label).toContain('T2 (Lv.8) (6 ~ 13)');
      expect(hybridTiers[1].valMin).toBe('6');
      expect(hybridTiers[1].valMax).toBe('13');

      // 點擊 T1 填入值
      hybridSlot.onSelect(hybridTiers[0], 'min');
      expect(minInput.value).toBe('39');
      expect(filterEl.getAttribute('data-poexd-mod-group')).toBe('增加#%能量護盾|||||#最大生命');
    });
  });

  describe('resolveTargetAffinitiesByStatId prefix mapping', () => {
    it('maps crafted. prefix according to version profile', () => {
      // PoE 1 版本: 僅對應工藝台與隱匿詞綴
      expect(resolveTargetAffinitiesByStatId('crafted.stat_3299347043', 'poe1')).toEqual([
        'master',
        'veiled',
      ]);

      // PoE 2 版本: 僅對應精髓、完美精髓、工藝與液態情感
      expect(resolveTargetAffinitiesByStatId('crafted.stat_3299347043', 'poe2')).toEqual([
        'essence',
        'perfect_essence',
        'crafted',
        'liquid',
      ]);
    });

    it('maps rune. prefix in poe2 and veiled. in poe1', () => {
      expect(resolveTargetAffinitiesByStatId('rune.stat_123', 'poe2')).toEqual([
        'socketable',
        'bonded',
      ]);
      expect(resolveTargetAffinitiesByStatId('veiled.stat_123', 'poe1')).toEqual(['veiled']);
    });

    it('maps crafted. prefix without version to backwards-compatible union from profiles', () => {
      expect(resolveTargetAffinitiesByStatId('crafted.stat_3299347043')).toEqual([
        'master',
        'veiled',
        'essence',
        'perfect_essence',
        'crafted',
        'liquid',
      ]);
      expect(resolveTargetAffinitiesByStatId('rune.stat_123')).toEqual(['socketable', 'bonded']);
    });
  });

  describe('10. 隱性單一數值 1 智慧識別與真無數值判定', () => {
    it('parseTierValues 遇 loads an additional bolt / 裝填額外1發弩箭 智慧補全數值為 1', () => {
      const boltTier = {
        key: 'loads an additional bolt',
        displayKey: '裝填額外1發弩箭',
        displayTemplate: '裝填額外1發弩箭',
        level: '55',
        values: [],
        id: 'explicit.stat_1967051901',
      };
      const result = parseTierValues(boltTier, 'explicit.stat_1967051901');
      expect(result.valMin).toBe('1');
      expect(result.valMax).toBe('1');
      expect(result.isRange).toBe(true);
      expect(result.rangeText).toBe(' (1 ~ 1)');
    });

    it('parseTierValues 遇 grenade skills fire an additional projectile / 弓攻擊發射 1 個額外箭矢 補全數值 1', () => {
      const projTier = {
        key: 'grenade skills fire an additional projectile',
        displayKey: '擲彈技能發射額外一個投射物',
        values: [],
      };
      const result = parseTierValues(projTier);
      expect(result.valMin).toBe('1');
      expect(result.valMax).toBe('1');
      expect(result.isRange).toBe(true);

      const arrowTier = {
        key: 'bow attacks fire an additional arrow',
        displayKey: '弓攻擊發射 1 個額外箭矢',
        values: [],
      };
      const result2 = parseTierValues(arrowTier);
      expect(result2.valMin).toBe('1');
      expect(result2.valMax).toBe('1');
    });

    it('parseTierValues 遇真正無數值之定性詞綴 (如升級範圍至中) 不會錯誤補全數值', () => {
      const qualitativeTier = {
        key: 'upgrades radius to medium',
        displayKey: '升級範圍至中',
        displayTemplate: '升級範圍至中',
        values: [],
      };
      const result = parseTierValues(qualitativeTier);
      expect(result.valMin).toBe('');
      expect(result.valMax).toBe('');
      expect(result.isRange).toBe(false);
      expect(result.rangeText).toBe('');
    });

    it('resolveTierModEligibility 對單階隱性數值 1 詞綴 (如 rune.stat_3885405204) 正確判定具備 T 階資格', () => {
      const runeTier = [
        {
          affinities: ['socketable'],
          generation_type: '0',
          key: 'bow attacks fire an additional arrow',
          displayKey: '弓的攻擊額外發射1支箭矢',
          displayTemplate: '弓的攻擊額外發射1支箭矢',
          level: '1',
          values: [],
          types: ['bow', 'bows'],
          id: 'rune.stat_3885405204',
          ids: ['rune.stat_3885405204'],
        },
      ];
      const result = resolveTierModEligibility(runeTier, 'rune.stat_3885405204');
      expect(result.isEligible).toBe(true);
      expect(result.normalTiers).toHaveLength(1);
      expect(result.availableTypes).toEqual(['bow', 'bows']);
    });

    it('resolveTierModEligibility 對單階真正無數值之定性詞綴維持 isEligible: false', () => {
      const qualitativeTiers = [
        {
          affinities: ['normal'],
          key: 'upgrades radius to medium',
          displayKey: '升級範圍至中',
          types: ['jewel'],
          values: [],
        },
      ];
      const result = resolveTierModEligibility(qualitativeTiers);
      expect(result.isEligible).toBe(false);
    });
  });
});
