// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import FilterPane from '@/components/sidebar/FilterPane.vue';
import { listenPoeEvent } from '@/utils/event-contracts';
import { setKnownStats } from '@/utils/known-stats-store';

const source = readFileSync('components/sidebar/FilterPane.vue', 'utf8');

// Mock chrome extension APIs
(globalThis as any).chrome = {
  runtime: {
    getURL: vi.fn((path: string) => path),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

const sampleKnownStats = {
  stat_life_1: {
    id: 'explicit.stat_life_1',
    text: '+# to maximum Life',
    type: 'explicit',
  },
  stat_life_2: {
    id: 'explicit.stat_life_2',
    text: '+# to maximum Life',
    type: 'explicit',
  },
  stat_fire_res_1: {
    id: 'explicit.stat_fire_res_1',
    text: '+#% to Fire Resistance',
    type: 'explicit',
  },
  'explicit.stat_life_1': {
    id: 'explicit.stat_life_1',
    text: '+# to maximum Life',
    type: 'explicit',
  },
  'explicit.stat_life_2': {
    id: 'explicit.stat_life_2',
    text: '+# to maximum Life',
    type: 'explicit',
  },
  'explicit.stat_fire_res_1': {
    id: 'explicit.stat_fire_res_1',
    text: '+#% to Fire Resistance',
    type: 'explicit',
  },
};
setKnownStats(sampleKnownStats);

const sampleModsData = {
  '+# 最大生命': [
    {
      id: 'stat_life_1',
      officialId: 'explicit.stat_life_1',
      displayKey: '最大生命',
      displayTemplate: '+# 最大生命',
      values: [['10', '20']],
      level: '1',
      generation_type: '1',
      affinities: ['normal'],
      types: ['body-armour'],
    },
    {
      id: 'stat_life_2',
      officialId: 'explicit.stat_life_2',
      displayKey: '最大生命',
      displayTemplate: '+# 最大生命',
      values: [['21', '30']],
      level: '2',
      generation_type: '1',
      affinities: ['normal'],
      types: ['body-armour'],
    },
  ],
  '+#% 火焰抗性': [
    {
      id: 'stat_fire_res_1',
      officialId: 'explicit.stat_fire_res_1',
      displayKey: '火焰抗性',
      displayTemplate: '+#% 火焰抗性',
      values: [['15', '25']],
      level: '1',
      generation_type: '1',
      affinities: ['normal'],
      types: ['body-armour'],
    },
  ],
};

global.fetch = vi.fn().mockImplementation(async () => ({
  ok: true,
  json: async () => sampleModsData,
}));

beforeEach(() => mockModsData(sampleModsData));

describe('FilterPane Selected Mods Panel (Static Contracts)', () => {
  it('eliminates legacy panel action buttons classes and duplicate CSS selectors', () => {
    expect(source).not.toContain('remove-selected-btn');
    expect(source).not.toContain('poe-btn-confirm');
    expect(source).not.toContain('panel-action-btn');
    expect(source).not.toContain('hero-confirm-btn');
    expect(source).not.toContain('secondary-actions-row');
    expect(source).not.toContain('secondary-action-btn');
    expect(source).not.toContain('clear-btn-action');
    expect(source).not.toContain('poe-btn-batch');
    expect(source).not.toContain('.hero-confirm-btn');
    expect(source).not.toContain('.secondary-action-btn');
    expect(source).not.toContain('.poe-btn-batch');
  });

  it('preserves .panel-actions container and uses semantic data-filter-action attributes', () => {
    expect(source).toContain('class="panel-actions');
    expect(source).toContain('data-filter-action="confirm-selected"');
    expect(source).toContain('data-filter-action="apply-t1"');
    expect(source).toContain('data-filter-action="clear-selected"');
    expect(source).toContain('data-filter-action="remove-selected"');
  });

  it('conforms selected panel action buttons to Foundation Button primitive with proper sizes', () => {
    expect(source).toMatch(/<Button[^>]*size="default"[^>]*data-filter-action="confirm-selected"/);
    expect(source).toMatch(/<Button[^>]*size="sm"[^>]*data-filter-action="apply-t1"/);
    expect(source).toMatch(/<Button[^>]*size="sm"[^>]*data-filter-action="clear-selected"/);
    expect(source).toMatch(/<Button[^>]*size="icon-sm"[^>]*data-filter-action="remove-selected"/);

    // No consumer disabled geometry/opacity overrides or rounded-[2px] on Button
    expect(source).not.toContain('rounded-[2px]');
    expect(source).not.toContain('disabled:opacity');
    expect(source).not.toContain('disabled:cursor');
  });
});

describe('FilterPane Selected Mods Panel (Runtime Contracts)', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  const mountFilterPane = async (props: Record<string, any> = {}) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    shadowRoot.appendChild(appRoot);
    shadowRoot.appendChild(portalRoot);

    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(FilterPane, { isOpen: true, ...props }),
          ]);
      },
    });

    app = createApp(Wrapper);
    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 70));
    await nextTick();
  };

  afterEach(() => {
    if (app) app.unmount();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    vi.restoreAllMocks();
  });

  it('A. renders empty state placeholder with action buttons disabled initially', async () => {
    await mountFilterPane();

    expect(appRoot.querySelector('.no-selected-placeholder')?.textContent).toContain(
      '尚未選擇任何詞綴',
    );

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    const applyT1Btn = appRoot.querySelector(
      '[data-filter-action="apply-t1"]',
    ) as HTMLButtonElement;
    const clearBtn = appRoot.querySelector(
      '[data-filter-action="clear-selected"]',
    ) as HTMLButtonElement;

    expect(confirmBtn.disabled).toBe(true);
    expect(confirmBtn.textContent).toContain('(0 筆)');
    expect(applyT1Btn.disabled).toBe(true);
    expect(clearBtn.disabled).toBe(true);
  });

  it('B. transitions to selected state with enabled buttons when selecting an item', async () => {
    await mountFilterPane();

    const firstCheckbox = appRoot.querySelector(
      '.mod-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    firstCheckbox.click();
    await nextTick();

    expect(appRoot.querySelector('.no-selected-placeholder')).toBeNull();
    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(1);

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    const applyT1Btn = appRoot.querySelector(
      '[data-filter-action="apply-t1"]',
    ) as HTMLButtonElement;
    const clearBtn = appRoot.querySelector(
      '[data-filter-action="clear-selected"]',
    ) as HTMLButtonElement;

    expect(confirmBtn.disabled).toBe(false);
    expect(confirmBtn.textContent).toContain('(1 筆)');
    expect(applyT1Btn.disabled).toBe(false);
    expect(clearBtn.disabled).toBe(false);
  });

  it('C. removes a single selected item when clicking remove-selected button', async () => {
    await mountFilterPane();

    const firstCheckbox = appRoot.querySelector(
      '.mod-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    firstCheckbox.click();
    await nextTick();

    const removeBtn = appRoot.querySelector(
      '[data-filter-action="remove-selected"]',
    ) as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();

    removeBtn.click();
    await nextTick();

    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(0);
    expect(appRoot.querySelector('.no-selected-placeholder')?.textContent).toContain(
      '尚未選擇任何詞綴',
    );

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    expect(confirmBtn.textContent).toContain('(0 筆)');
  });

  it('D. removes only the targeted item when multiple items are selected', async () => {
    await mountFilterPane();

    // Select both mods
    const checkboxes = appRoot.querySelectorAll('.mod-row [data-slot="checkbox"]');
    expect(checkboxes.length).toBe(2);
    (checkboxes[0] as HTMLButtonElement).click();
    (checkboxes[1] as HTMLButtonElement).click();
    await nextTick();

    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(2);

    // Click first item's remove button
    const removeBtns = appRoot.querySelectorAll('[data-filter-action="remove-selected"]');
    (removeBtns[0] as HTMLButtonElement).click();
    await nextTick();

    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(1);
    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.textContent).toContain('(1 筆)');
    expect(confirmBtn.disabled).toBe(false);
  });

  it('E. clears all selections when clicking clear-selected button', async () => {
    await mountFilterPane();

    const selectAllBtn = appRoot.querySelector(
      'button[title="全選目前篩選出來的詞綴"]',
    ) as HTMLButtonElement;
    selectAllBtn.click();
    await nextTick();

    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(2);

    const clearBtn = appRoot.querySelector(
      '[data-filter-action="clear-selected"]',
    ) as HTMLButtonElement;
    clearBtn.click();
    await nextTick();

    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(0);
    expect(appRoot.querySelector('.no-selected-placeholder')?.textContent).toContain(
      '尚未選擇任何詞綴',
    );
    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('F. applies T1 to selected mods when clicking apply-t1 button', async () => {
    await mountFilterPane();

    const firstCheckbox = appRoot.querySelector(
      '.mod-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    firstCheckbox.click();
    await nextTick();

    const applyT1Btn = appRoot.querySelector(
      '[data-filter-action="apply-t1"]',
    ) as HTMLButtonElement;
    applyT1Btn.click();
    await nextTick();

    const tierBadge = appRoot.querySelector('.selected-mod-tier');
    expect(tierBadge).toBeTruthy();
    expect(tierBadge?.textContent).toContain('T1+');
  });

  it('G. toggles min/max limit on .vals-limit-trigger click', async () => {
    await mountFilterPane();

    // Expand the first mod to click a specific tier
    const expandBtn = appRoot.querySelector('[data-mod-action="toggle-expand"]') as HTMLElement;
    expandBtn.click();
    await nextTick();

    const tierCheckboxes = appRoot.querySelectorAll('.tier-row [data-slot="checkbox"]');
    (tierCheckboxes[0] as HTMLButtonElement).click();
    await nextTick();

    const valsTrigger = appRoot.querySelector('.vals-limit-trigger') as HTMLElement;
    expect(valsTrigger).toBeTruthy();
    expect(valsTrigger.textContent).toContain('≥10');

    // Toggle max limit on
    valsTrigger.click();
    await nextTick();

    const updatedTrigger = appRoot.querySelector('.vals-limit-trigger') as HTMLElement;
    expect(updatedTrigger.textContent).toContain('10~20');

    // Toggle max limit off
    updatedTrigger.click();
    await nextTick();

    expect(appRoot.querySelector('.vals-limit-trigger')?.textContent).toContain('≥10');
  });

  it('H. does not dispatch poexd-close-affix-modal when clicking disabled confirm button with 0 selection', async () => {
    await mountFilterPane();

    let closeEventDispatched = false;
    const cleanup = listenPoeEvent('poexd-close-affix-modal', () => {
      closeEventDispatched = true;
    });

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await nextTick();

    expect(closeEventDispatched).toBe(false);
    cleanup();
  });

  it('I. executes batch confirm workflow: dispatches poexd-add-stat-filter and poexd-close-affix-modal exactly once', async () => {
    await mountFilterPane();

    const selectAllBtn = appRoot.querySelector(
      'button[title="全選目前篩選出來的詞綴"]',
    ) as HTMLButtonElement;
    selectAllBtn.click();
    await nextTick();

    let closeCount = 0;
    const closeCleanup = listenPoeEvent('poexd-close-affix-modal', () => {
      closeCount++;
    });

    const addedFilters: Array<{
      statId: string | null;
      groupIndex: number;
      min?: string;
      max?: string;
      category: string;
    }> = [];
    const filterCleanup = listenPoeEvent('poexd-add-stat-filter', (payload) => {
      addedFilters.push(payload);
    });

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await nextTick();

    expect(closeCount).toBe(1);
    expect(addedFilters.length).toBe(2);
    expect(addedFilters.every((f) => Boolean(f.statId))).toBe(true);

    // Selected list should be cleared immediately
    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(0);

    closeCleanup();
    filterCleanup();
  });

  it('J. does not dispatch poexd-close-affix-modal when clicking clear-selected', async () => {
    await mountFilterPane();

    const firstCheckbox = appRoot.querySelector(
      '.mod-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    firstCheckbox.click();
    await nextTick();

    let closeCount = 0;
    const closeCleanup = listenPoeEvent('poexd-close-affix-modal', () => {
      closeCount++;
    });

    const clearBtn = appRoot.querySelector(
      '[data-filter-action="clear-selected"]',
    ) as HTMLButtonElement;
    clearBtn.click();
    await nextTick();

    expect(closeCount).toBe(0);
    closeCleanup();
  });

  it('K. does not dispatch poexd-close-affix-modal when clicking apply-t1', async () => {
    await mountFilterPane();

    const firstCheckbox = appRoot.querySelector(
      '.mod-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    firstCheckbox.click();
    await nextTick();

    let closeCount = 0;
    const closeCleanup = listenPoeEvent('poexd-close-affix-modal', () => {
      closeCount++;
    });

    const applyT1Btn = appRoot.querySelector(
      '[data-filter-action="apply-t1"]',
    ) as HTMLButtonElement;
    applyT1Btn.click();
    await nextTick();

    expect(closeCount).toBe(0);
    closeCleanup();
  });

  it('L. verifies runtime classes of panel action buttons match Foundation size contracts', async () => {
    await mountFilterPane();

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.className).toContain('h-[var(--control-height-default,2rem)]');
    expect(confirmBtn.className).not.toContain('h-auto');

    const applyT1Btn = appRoot.querySelector(
      '[data-filter-action="apply-t1"]',
    ) as HTMLButtonElement;
    expect(applyT1Btn.className).toContain('h-[var(--control-height-sm,1.75rem)]');
    expect(applyT1Btn.className).not.toContain('h-auto');

    const clearSelectedBtn = appRoot.querySelector(
      '[data-filter-action="clear-selected"]',
    ) as HTMLButtonElement;
    expect(clearSelectedBtn.className).toContain('h-[var(--control-height-sm,1.75rem)]');
    expect(clearSelectedBtn.className).not.toContain('h-auto');
  });

  it('M. skips mods without officialId during batch confirmation and reports skipped count in toast', async () => {
    // 構造包含有官方 ID 與無官方 ID 混合的 mock 資料
    const mixedModsData = {
      '+# 最大生命': sampleModsData['+# 最大生命'],
      無官方ID詞綴: [
        {
          displayKey: '無官方ID詞綴',
          displayTemplate: '無官方ID詞綴',
          values: [['5']],
          level: '1',
          generation_type: '1',
          affinities: ['normal'],
          types: ['body-armour'],
        },
      ],
    };
    mockModsData(mixedModsData);

    await mountFilterPane();

    // 勾選第 1 條 (有官方 ID)
    const checkboxes = appRoot.querySelectorAll(
      '.mod-row [data-slot="checkbox"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(checkboxes.length).toBe(2);
    // 第 1 條可勾選
    expect(checkboxes[0].disabled).toBe(false);
    checkboxes[0].click();
    await nextTick();

    // 第 2 條為無官方 ID，應為 disabled
    expect(checkboxes[1].disabled).toBe(true);

    const addedFilters: any[] = [];
    const addCleanup = listenPoeEvent('poexd-add-stat-filter', (detail) => {
      addedFilters.push(detail);
    });

    const toastMsgs: string[] = [];
    const toastCleanup = listenPoeEvent('poexd-toast', (detail) => {
      toastMsgs.push(detail.message);
    });

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await nextTick();

    // 應只派發第 1 條的過濾條件
    expect(addedFilters.length).toBe(1);
    expect(addedFilters[0].statId).toBe('stat_life_1');

    addCleanup();
    toastCleanup();
  });

  it('N. does not supply min/max values when triggering tier filter on mod without officialId', async () => {
    const noIdModsData = {
      unsupported_stat: [
        {
          key: 'unsupported_stat_t1',
          displayKey: '無官方ID詞綴',
          displayTemplate: '無官方ID詞綴',
          values: [['99', '100']],
          level: '1',
          generation_type: '1',
          affinities: ['normal'],
          types: ['body-armour'],
        },
      ],
    };
    mockModsData(noIdModsData);

    await mountFilterPane();

    // 展開該詞綴
    const expandBtn = appRoot.querySelector('.mod-name-section') as HTMLButtonElement;
    expandBtn.click();
    await nextTick();

    const addedFilters: any[] = [];
    const addCleanup = listenPoeEvent('poexd-add-stat-filter', (detail) => {
      addedFilters.push(detail);
    });

    // 點擊 Tier 的填入搜尋按鈕
    const tierSearchBtn = appRoot.querySelector(
      '.tier-row .tier-action-zone button',
    ) as HTMLButtonElement;
    expect(tierSearchBtn).toBeTruthy();
    expect(tierSearchBtn.textContent?.trim()).toContain('填入搜尋');

    tierSearchBtn.click();
    await nextTick();

    expect(addedFilters.length).toBe(1);
    expect(addedFilters[0].statId).toBeNull();
    // 嚴格保證不帶入任何 min 或 max 數值
    expect(addedFilters[0].min).toBeUndefined();
    expect(addedFilters[0].max).toBeUndefined();

    addCleanup();
  });

  it('N2. dispatches fallbackQuery and statId null when clicking main mod row "填入搜尋" button without officialId', async () => {
    const noIdModsData = {
      '+#% compound unsupported stat': [
        {
          key: '+#% compound unsupported stat|||||+#% secondary line',
          displayKey: '複合無官方ID詞綴',
          displayTemplate: '複合無官方ID詞綴',
          values: [
            ['10', '20'],
            ['30', '40'],
          ],
          level: '1',
          generation_type: '1',
          affinities: ['normal'],
          types: ['body-armour'],
        },
      ],
    };
    mockModsData(noIdModsData);

    await mountFilterPane();

    const addedFilters: any[] = [];
    const addCleanup = listenPoeEvent('poexd-add-stat-filter', (detail) => {
      addedFilters.push(detail);
    });

    const toastMsgs: string[] = [];
    const toastCleanup = listenPoeEvent('poexd-toast', (detail) => {
      toastMsgs.push(detail.message);
    });

    // 點擊主詞綴列上的「填入搜尋」按鈕 (不展開 Tier)
    const mainSearchBtn = appRoot.querySelector(
      '.mod-row .mod-action-zone button',
    ) as HTMLButtonElement;
    expect(mainSearchBtn).toBeTruthy();
    expect(mainSearchBtn.textContent?.trim()).toContain('填入搜尋');

    mainSearchBtn.click();
    await nextTick();

    expect(addedFilters.length).toBe(1);
    expect(addedFilters[0].statId).toBeNull();
    // 複合詞綴且無官方 ID 時，應擷取首行並去除特殊符號
    expect(addedFilters[0].fallbackQuery).toBe('compound unsupported stat');
    expect(toastMsgs.length).toBe(1);
    expect(toastMsgs[0]).toContain('無官方ID，已將英文詞綴填入搜尋框並聚焦');

    addCleanup();
    toastCleanup();
  });

  it('O. directly uses data affix ID without fallback to text search even if not present in knownStats', async () => {
    const customIdModsData = {
      '+# to maximum frenzy charges': [
        {
          key: '+(1-2) to maximum frenzy charges',
          displayKey: '+(1-2) 狂怒球上限',
          displayTemplate: '+# 狂怒球上限',
          values: [['1', '2']],
          level: '1',
          generation_type: '5',
          affinities: ['corrupted'],
          types: ['body-armour'],
          id: 'implicit.stat_1760576992',
          ids: ['implicit.stat_1760576992'],
        },
      ],
    };
    mockModsData(customIdModsData);

    await mountFilterPane();

    const expandBtn = appRoot.querySelector('.mod-name-section') as HTMLButtonElement;
    expandBtn.click();
    await nextTick();

    const addedFilters: any[] = [];
    const addCleanup = listenPoeEvent('poexd-add-stat-filter', (detail) => {
      addedFilters.push(detail);
    });

    const tierAddBtn = appRoot.querySelector(
      '.tier-row .tier-action-zone button',
    ) as HTMLButtonElement;
    expect(tierAddBtn).toBeTruthy();
    expect(tierAddBtn.textContent?.trim()).toContain('立即加入');

    tierAddBtn.click();
    await nextTick();

    expect(addedFilters.length).toBe(1);
    expect(addedFilters[0].statId).toBe('implicit.stat_1760576992');
    expect(addedFilters[0].min).toBe('1');
    expect(addedFilters[0].modGroup).toBe('+# 狂怒球上限');

    addCleanup();
  });

  it('P. preserves parent compound modGroup on each dispatched filter when adding a multi-ID compound mod', async () => {
    const compoundModsData = {
      '#% increased Energy Shield ||||| +# to maximum Life': [
        {
          key: '#% increased Energy Shield|||||+# to maximum Life',
          displayKey: '增加 (39-42)% 能量護盾|||||+(18-24) 最大生命',
          displayTemplate: '增加#%能量護盾|||||#最大生命',
          values: [
            ['39', '42'],
            ['18', '24'],
          ],
          level: '78',
          generation_type: '1',
          affinities: ['normal'],
          types: ['body-armour'],
          ids: ['explicit.stat_4015621042', 'explicit.stat_3299347043'],
        },
      ],
    };
    mockModsData(compoundModsData);

    await mountFilterPane();

    const addedFilters: any[] = [];
    const addCleanup = listenPoeEvent('poexd-add-stat-filter', (detail) => {
      addedFilters.push(detail);
    });

    const mainAddBtn = appRoot.querySelector(
      '.mod-row .mod-action-zone button',
    ) as HTMLButtonElement;
    expect(mainAddBtn).toBeTruthy();
    mainAddBtn.click();
    await nextTick();

    expect(addedFilters).toHaveLength(2);
    expect(addedFilters[0].statId).toBe('explicit.stat_4015621042');
    expect(addedFilters[0].modGroup).toBe('增加#%能量護盾|||||#最大生命');
    expect(addedFilters[1].statId).toBe('explicit.stat_3299347043');
    expect(addedFilters[1].modGroup).toBe('增加#%能量護盾|||||#最大生命');

    addCleanup();
  });
});
