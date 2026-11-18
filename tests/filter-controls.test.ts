// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { ConfigProvider } from 'reka-ui';
import FilterPane from '@/components/sidebar/FilterPane.vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';

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

const sampleModsData = {
  mod_life: [
    {
      id: 'stat_life_1',
      officialId: 'explicit.stat_life_1',
      displayKey: '最大生命',
      displayTemplate: '+# 最大生命',
      level: '1',
      generation_type: '1', // prefix
      affinities: ['normal'],
      types: ['body-armour'],
    },
  ],
  mod_fire_res: [
    {
      id: 'stat_fire_res_1',
      officialId: 'explicit.stat_fire_res_1',
      displayKey: '火焰抗性',
      displayTemplate: '+#% 火焰抗性',
      level: '1',
      generation_type: '2', // suffix
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

describe('FilterPane Controls Row (Static Contracts)', () => {
  it('eliminates legacy controls row classes (.gen-tab-btn, .search-wrapper, .clear-btn, .batch-actions-group, .poe-input)', () => {
    expect(source).not.toContain('generation-filter-group');
    expect(source).not.toContain('gen-tab-btn');
    expect(source).not.toContain('search-wrapper');
    expect(source).not.toContain('.clear-btn {');
    expect(source).not.toContain('.clear-btn:hover');
    expect(source).not.toContain('class="clear-btn"');
    expect(source).not.toMatch(/class="[^"]*(?<![\w-])clear-btn(?![\w-])/);
    expect(source).not.toContain('batch-actions-group');
    expect(source).not.toContain('.poe-input {');
    expect(source).not.toContain('.poe-input:focus');
    expect(source).not.toContain('class="poe-input"');
  });

  it('eliminates .poe-btn-batch once right selected mods panel is migrated', () => {
    expect(source).not.toContain('.poe-btn-batch {');
    expect(source).not.toContain('.poe-btn-batch:hover');
    expect(source).not.toContain('.poe-btn-batch:disabled');
    expect(source).not.toContain('poe-btn-batch');
  });

  it('ensures searchInputRef has type-safe ref and does not use as any', () => {
    expect(source).not.toContain('searchInputRef.value as any');
    expect(source).not.toContain('searchInputRef.value as');
    expect(source).toContain(
      'searchInputRef = ref<HTMLInputElement | { $el?: HTMLInputElement } | null>(null)',
    );
    expect(source).toContain('getSearchInputElement');
  });

  it('uses shadcn ToggleGroup and ToggleGroupItem for generation filter', () => {
    expect(source).toContain('ToggleGroup');
    expect(source).toContain('ToggleGroupItem');
    expect(source).toContain(
      "import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'",
    );
    expect(source).toContain("import { ChevronDown, X } from '@lucide/vue'");
  });

  it('conforms top controls to Foundation Button and Input primitives with size="sm" and "icon-sm"', () => {
    // Item Type button
    expect(source).toMatch(/<Button[^>]*size="sm"[^>]*@click="toggleSelectDropdown"/);
    // Search Input
    expect(source).toMatch(/<Input[^>]*ref="searchInputRef"[^>]*size="sm"/);
    // Clear search button
    expect(source).toMatch(/<Button[^>]*size="icon-sm"[^>]*@click="clearSearchQuery"/);
    // Item Level Range Inputs & Clear button
    expect(source).toMatch(/<Input[^>]*id="filter-pane-item-level-min"[^>]*size="sm"/);
    expect(source).toMatch(/<Input[^>]*id="filter-pane-item-level-max"[^>]*size="sm"/);
    expect(source).toMatch(/<Button[^>]*size="icon-sm"[^>]*@click="clearItemLevelFilter"/);
    // Select all & clear all
    expect(source).toMatch(/<Button[^>]*size="sm"[^>]*@click="selectAllCurrent"/);
    expect(source).toMatch(/<Button[^>]*size="sm"[^>]*@click="clearAllSelection"/);

    // No geometry overrides or focus suppression in top controls
    expect(source).not.toContain('size-5');
    expect(source).not.toContain('focus-visible:ring-0');
    expect(source).not.toContain('w-3.5 h-3.5');
  });

  it('ensures .split-layout does not declare overflow: hidden to preserve focus rings on top controls', () => {
    expect(source).not.toMatch(/\.split-layout\s*\{[^}]*overflow:\s*hidden/);
  });
});

describe('FilterPane Controls Row (Runtime Contracts)', () => {
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
    if (app) {
      app.unmount();
    }
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
    vi.restoreAllMocks();
  });

  it('A. binds searchQuery to shadcn Input and filters affix list', async () => {
    await mountFilterPane();

    const searchInput = appRoot.querySelector('.item-search input') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    expect(searchInput.value).toBe('');

    // Both categories/affixes present initially
    expect(appRoot.textContent).toContain('最大生命');
    expect(appRoot.textContent).toContain('火焰抗性');

    // Input "生命"
    searchInput.value = '生命';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(appRoot.textContent).toContain('最大生命');
    expect(appRoot.textContent).not.toContain('火焰抗性');
  });

  it('B. toggles clear button based on searchQuery and clears input on click', async () => {
    await mountFilterPane();

    const searchWrapper = appRoot.querySelector('.item-search') as HTMLElement;
    const searchInput = searchWrapper.querySelector('input') as HTMLInputElement;

    // Initially no clear button
    let clearBtn = searchWrapper.querySelector('button');
    expect(clearBtn).toBeNull();

    // Type query
    searchInput.value = '生命';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    clearBtn = searchWrapper.querySelector('button');
    expect(clearBtn).toBeTruthy();
    expect(clearBtn?.title).toBe('清空篩選器');

    // Click clear button
    clearBtn?.click();
    await nextTick();

    expect(searchInput.value).toBe('');
    expect(searchWrapper.querySelector('button')).toBeNull();
    // Affixes are restored
    expect(appRoot.textContent).toContain('最大生命');
    expect(appRoot.textContent).toContain('火焰抗性');
  });

  it('C. invokes focus() and select() on searchInputRef when isOpen becomes true', async () => {
    const isOpenRef = ref(false);

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
            h(FilterPane, { isOpen: isOpenRef.value }),
          ]);
      },
    });

    app = createApp(Wrapper);
    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const searchInput = appRoot.querySelector('.item-search input') as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    const focusSpy = vi.spyOn(searchInput, 'focus');
    const selectSpy = vi.spyOn(searchInput, 'select');

    isOpenRef.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 70));

    expect(focusSpy).toHaveBeenCalled();
    expect(selectSpy).toHaveBeenCalled();
  });

  it('D. defaults generation filter to "all" with checked toggle item', async () => {
    await mountFilterPane();

    const toggleGroup = appRoot.querySelector('[data-slot="toggle-group"]');
    expect(toggleGroup).toBeTruthy();

    const items = appRoot.querySelectorAll('[data-slot="toggle-group-item"]');
    expect(items.length).toBe(3);

    const [allItem, prefixItem, suffixItem] = Array.from(items) as HTMLElement[];
    expect(allItem.getAttribute('data-state')).toBe('on');
    expect(allItem.getAttribute('value')).toBe('all');
    expect(allItem.textContent?.trim()).toBe('全部');

    expect(prefixItem.getAttribute('data-state')).toBe('off');
    expect(suffixItem.getAttribute('data-state')).toBe('off');

    // Both prefixes and suffixes visible
    expect(appRoot.textContent).toContain('最大生命');
    expect(appRoot.textContent).toContain('火焰抗性');
  });

  it('E. filters to prefixes only when clicking "前綴" ToggleGroupItem', async () => {
    await mountFilterPane();

    const items = appRoot.querySelectorAll('[data-slot="toggle-group-item"]');
    const [allItem, prefixItem, suffixItem] = Array.from(items) as HTMLElement[];

    prefixItem.click();
    await nextTick();

    expect(prefixItem.getAttribute('data-state')).toBe('on');
    expect(allItem.getAttribute('data-state')).toBe('off');
    expect(suffixItem.getAttribute('data-state')).toBe('off');

    // Max life (prefix) exists, fire res (suffix) should not appear
    expect(appRoot.textContent).toContain('最大生命');
    expect(appRoot.textContent).not.toContain('火焰抗性');
  });

  it('F. filters to suffixes only when clicking "後綴" ToggleGroupItem', async () => {
    await mountFilterPane();

    const items = appRoot.querySelectorAll('[data-slot="toggle-group-item"]');
    const [allItem, prefixItem, suffixItem] = Array.from(items) as HTMLElement[];

    suffixItem.click();
    await nextTick();

    expect(suffixItem.getAttribute('data-state')).toBe('on');
    expect(allItem.getAttribute('data-state')).toBe('off');
    expect(prefixItem.getAttribute('data-state')).toBe('off');

    // Fire res (suffix) exists, max life (prefix) should not appear
    expect(appRoot.textContent).toContain('火焰抗性');
    expect(appRoot.textContent).not.toContain('最大生命');
  });

  it('G. prevents deselecting when clicking already checked ToggleGroupItem', async () => {
    await mountFilterPane();

    const items = appRoot.querySelectorAll('[data-slot="toggle-group-item"]');
    const [allItem] = Array.from(items) as HTMLElement[];

    expect(allItem.getAttribute('data-state')).toBe('on');

    // Click again
    allItem.click();
    await nextTick();

    expect(allItem.getAttribute('data-state')).toBe('on');
  });

  it('H. selects all currently filtered mods when clicking 全選 Button', async () => {
    await mountFilterPane();

    const selectAllBtn = appRoot.querySelector(
      'button[title="全選目前篩選出來的詞綴"]',
    ) as HTMLButtonElement;
    expect(selectAllBtn).toBeTruthy();
    expect(selectAllBtn.textContent?.trim()).toBe('全選');

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.textContent).toContain('(0 筆)');
    expect(confirmBtn.disabled).toBe(true);
    expect(appRoot.querySelector('.no-selected-placeholder')?.textContent).toContain(
      '尚未選擇任何詞綴',
    );

    // Click select all
    selectAllBtn.click();
    await nextTick();

    expect(confirmBtn.textContent).toContain('(2 筆)');
    expect(confirmBtn.disabled).toBe(false);
    expect(appRoot.querySelectorAll('.selected-mod-item').length).toBe(2);
  });

  it('I. clears all selected mods when clicking 取消全選 Button', async () => {
    await mountFilterPane();

    const selectAllBtn = appRoot.querySelector(
      'button[title="全選目前篩選出來的詞綴"]',
    ) as HTMLButtonElement;
    const clearAllBtn = appRoot.querySelector('button[title="取消所有勾選"]') as HTMLButtonElement;
    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;

    selectAllBtn.click();
    await nextTick();
    expect(confirmBtn.textContent).toContain('(2 筆)');
    expect(confirmBtn.disabled).toBe(false);

    clearAllBtn.click();
    await nextTick();
    expect(confirmBtn.textContent).toContain('(0 筆)');
    expect(confirmBtn.disabled).toBe(true);
    expect(appRoot.querySelector('.no-selected-placeholder')?.textContent).toContain(
      '尚未選擇任何詞綴',
    );
  });

  it('J. verifies runtime classes of top controls match Foundation sm/icon-sm contract', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    expect(triggerBtn.className).toContain('h-[var(--control-height-sm,1.75rem)]');
    expect(triggerBtn.className).not.toContain('h-auto');

    const searchInput = appRoot.querySelector('.item-search input') as HTMLInputElement;
    expect(searchInput.className).toContain('h-[var(--control-height-sm,1.75rem)]');
    expect(searchInput.className).not.toContain('h-auto');

    // Type query to show clear button
    searchInput.value = '生命';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    const clearBtn = appRoot.querySelector('.item-search button') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    expect(clearBtn.className).toContain('size-[var(--control-height-sm)]');
    expect(clearBtn.className).not.toContain('size-5');

    const selectAllBtn = appRoot.querySelector(
      'button[title="全選目前篩選出來的詞綴"]',
    ) as HTMLButtonElement;
    expect(selectAllBtn.className).toContain('h-[var(--control-height-sm,1.75rem)]');
  });
});

describe('FilterPane Category Group Header Presentation & Contract', () => {
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
  };

  afterEach(() => {
    if (app) app.unmount();
    if (host) host.remove();
  });

  it('verifies static DOM contracts and removes obsolete expand-arrow and after horizontal rule', () => {
    // Contract elements remain
    expect(source).toContain(':id="\'category_\' + cat.label"');
    expect(source).toContain('@click="toggleCategory(cat.label)"');
    expect(source).toContain(':aria-expanded="expandedCategories.has(cat.label)"');
    expect(source).toContain('group-header');

    // Obsolete presentation elements removed from FilterPane header
    expect(source).not.toContain('after:h-px');
    expect(source).not.toContain('after:bg-border');
    expect(source).not.toContain('after:flex-1');
    expect(source).not.toMatch(/class="[^"]*expand-arrow[^"]*">▶/);
  });

  it('renders compact section header with separated title, count, and toggles Plus/Minus on click', async () => {
    await mountFilterPane();

    const header = appRoot.querySelector('.group-header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.id).toBe('category_一般');

    // Initial state: expanded
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.className).toContain('bg-muted');

    const titleEl = header.querySelector('.group-title') as HTMLElement;
    expect(titleEl.textContent?.trim()).toBe('一般');

    const countEl = header.querySelector('.group-count') as HTMLElement;
    expect(countEl.textContent?.trim()).toBe('2');

    // Should render Minus icon when expanded
    expect(header.querySelector('.lucide-minus')).toBeTruthy();
    expect(header.querySelector('.lucide-plus')).toBeFalsy();
    expect(appRoot.querySelector('.group-content')).toBeTruthy();

    // Click header to collapse
    header.click();
    await nextTick();

    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.className).toContain('bg-transparent');
    expect(header.querySelector('.lucide-minus')).toBeFalsy();
    expect(header.querySelector('.lucide-plus')).toBeTruthy();
    expect(appRoot.querySelector('.group-content')).toBeFalsy();

    // Click header again to expand
    header.click();
    await nextTick();

    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.className).toContain('bg-muted');
    expect(header.querySelector('.lucide-minus')).toBeTruthy();
    expect(header.querySelector('.lucide-plus')).toBeFalsy();
    expect(appRoot.querySelector('.group-content')).toBeTruthy();
  });
});

describe('FilterPane Item Level Filter (Runtime Contracts)', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  const multiLevelModsData = {
    '+# 最大生命': [
      {
        id: 'stat_life_1',
        officialId: 'explicit.stat_life_1',
        displayKey: '+(10-19) 最大生命',
        displayTemplate: '+# 最大生命',
        values: [['10', '19']],
        level: '1',
        generation_type: '1',
        affinities: ['normal'],
        types: ['body-armour'],
      },
      {
        id: 'stat_life_2',
        officialId: 'explicit.stat_life_2',
        displayKey: '+(40-49) 最大生命',
        displayTemplate: '+# 最大生命',
        values: [['40', '49']],
        level: '44',
        generation_type: '1',
        affinities: ['normal'],
        types: ['body-armour'],
      },
      {
        id: 'stat_life_3',
        officialId: 'explicit.stat_life_3',
        displayKey: '+(90-99) 最大生命',
        displayTemplate: '+# 最大生命',
        values: [['90', '99']],
        level: '73',
        generation_type: '1',
        affinities: ['normal'],
        types: ['body-armour'],
      },
    ],
    '+#% 混沌抗性': [
      {
        id: 'stat_chaos_res_1',
        officialId: 'explicit.stat_chaos_res_1',
        displayKey: '+(26-30)% 混沌抗性',
        displayTemplate: '+#% 混沌抗性',
        values: [['26', '30']],
        level: '80',
        generation_type: '2',
        affinities: ['normal'],
        types: ['body-armour'],
      },
    ],
  };

  const mountFilterPane = async (modsData: Record<string, any> = multiLevelModsData) => {
    mockModsData(modsData);
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
            h(FilterPane, { isOpen: true }),
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

  it('filters affixes and tiers within min~max item level range and restores on clear', async () => {
    await mountFilterPane();

    const ilvlWrapper = appRoot.querySelector('.item-level') as HTMLElement;
    const minInput = ilvlWrapper.querySelector('#filter-pane-item-level-min') as HTMLInputElement;
    const maxInput = ilvlWrapper.querySelector('#filter-pane-item-level-max') as HTMLInputElement;
    expect(minInput).toBeTruthy();
    expect(maxInput).toBeTruthy();
    expect(minInput.value).toBe('');
    expect(maxInput.value).toBe('');
    expect(ilvlWrapper.querySelector('button')).toBeNull();

    const scrollArea = appRoot.querySelector('.mods-scroll-container') as HTMLElement;
    expect(scrollArea).toBeTruthy();

    // Both mods visible initially
    expect(scrollArea.textContent).toContain('最大生命');
    expect(scrollArea.textContent).toContain('混沌抗性');

    // Enter max ilvl 50: 最大生命 (Lv.1, Lv.44) qualifies; 混沌抗性 (Lv.80) does not
    maxInput.value = '50';
    maxInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(scrollArea.textContent).toContain('最大生命');
    expect(scrollArea.textContent).not.toContain('混沌抗性');
    expect(ilvlWrapper.querySelector('button')).toBeTruthy();

    // Expand 最大生命 -> only Lv.1 and Lv.44 tiers are displayed, Lv.73 is hidden
    const expandBtn = appRoot.querySelector('[data-mod-action="toggle-expand"]') as HTMLElement;
    expandBtn.click();
    await nextTick();

    let tierRows = appRoot.querySelectorAll('.tier-row');
    expect(tierRows.length).toBe(2);
    expect(tierRows[0].textContent).toContain('Lv.1');
    expect(tierRows[1].textContent).toContain('Lv.44');

    // Enter min 40 + max 60 -> only Lv.44 remains, and canonical tier index (1 -> T2+) is preserved
    minInput.value = '40';
    minInput.dispatchEvent(new Event('input'));
    maxInput.value = '60';
    maxInput.dispatchEvent(new Event('input'));
    await nextTick();

    tierRows = appRoot.querySelectorAll('.tier-row');
    expect(tierRows.length).toBe(1);
    expect(tierRows[0].textContent).toContain('Lv.44');

    // Clicking the filtered tier Lv.44 selects canonical index 1 (T2+ out of 3 tiers)
    const tierCheckbox = tierRows[0].querySelector('[data-slot="checkbox"]') as HTMLButtonElement;
    tierCheckbox.click();
    await nextTick();
    expect(tierCheckbox.getAttribute('data-state')).toBe('checked');
    expect(appRoot.querySelector('.selected-mod-tier')?.textContent?.trim()).toBe('T2+');
    expect(appRoot.querySelector('.selected-mod-vals')?.textContent).toContain('≥40');

    // Enter min 75 (with empty max): shows mods/tiers requiring >= 75 (混沌抗性 Lv.80)
    maxInput.value = '';
    maxInput.dispatchEvent(new Event('input'));
    minInput.value = '75';
    minInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(scrollArea.textContent).not.toContain('最大生命');
    expect(scrollArea.textContent).toContain('混沌抗性');

    // Apply T1 respects range (selects 混沌抗性 first and checks T1+)
    const selectAllBtn = appRoot.querySelector(
      'button[title="全選目前篩選出來的詞綴"]',
    ) as HTMLButtonElement;
    selectAllBtn.click();
    await nextTick();
    const applyT1Btn = appRoot.querySelector(
      '[data-filter-action="apply-t1"]',
    ) as HTMLButtonElement;
    applyT1Btn.click();
    await nextTick();

    expect(appRoot.textContent).toContain('≥26');

    // Enter min 90: shows empty state when no mod can roll
    minInput.value = '90';
    minInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(appRoot.querySelector('.empty-mods')).toBeTruthy();

    // Clear button restores everything
    const clearBtn = ilvlWrapper.querySelector('button') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    clearBtn.click();
    await nextTick();

    expect(minInput.value).toBe('');
    expect(maxInput.value).toBe('');
    expect(ilvlWrapper.querySelector('button')).toBeNull();
    expect(scrollArea.textContent).toContain('最大生命');
    expect(scrollArea.textContent).toContain('混沌抗性');
    expect(appRoot.querySelectorAll('.tier-row').length).toBe(3);
  });

  it('ignores negative item level input without hiding affixes', async () => {
    await mountFilterPane();

    const minInput = appRoot.querySelector('#filter-pane-item-level-min') as HTMLInputElement;
    const maxInput = appRoot.querySelector('#filter-pane-item-level-max') as HTMLInputElement;
    minInput.value = '-5';
    minInput.dispatchEvent(new Event('input'));
    maxInput.value = '-1';
    maxInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(appRoot.textContent).toContain('最大生命');
    expect(appRoot.textContent).toContain('混沌抗性');
  });

  it('shows invalid range hint when min exceeds max item level', async () => {
    await mountFilterPane();

    const minInput = appRoot.querySelector('#filter-pane-item-level-min') as HTMLInputElement;
    const maxInput = appRoot.querySelector('#filter-pane-item-level-max') as HTMLInputElement;
    minInput.value = '85';
    minInput.dispatchEvent(new Event('input'));
    maxInput.value = '70';
    maxInput.dispatchEvent(new Event('input'));
    await nextTick();

    const empty = appRoot.querySelector('.empty-mods');
    expect(empty?.textContent?.trim()).toBe('物品等級下限不可大於上限，請調整區間');
  });

  it('renders non-prefix/suffix mods under split categories and hides them when filtering prefix/suffix only', async () => {
    mockModsData({
      ...multiLevelModsData,
      '#% 移動速度': [
        {
          id: 'stat_ms_1',
          officialId: 'explicit.stat_ms_1',
          displayKey: '增加 #% 移動速度',
          displayTemplate: '增加 #% 移動速度',
          values: [['10', '30']],
          level: '1',
          generation_type: '0',
          affinities: ['normal'],
          types: ['body-armour'],
        },
      ],
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });
    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    shadowRoot.appendChild(appRoot);
    shadowRoot.appendChild(portalRoot);

    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
              h(FilterPane, { isOpen: true }),
            ]);
        },
      }),
    );
    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 70));
    await nextTick();

    const scrollArea = appRoot.querySelector('.mods-scroll-container') as HTMLElement;
    expect(appRoot.querySelector('.group-count')?.textContent?.trim()).toBe('3');
    expect(scrollArea.textContent).toContain('其他 (1)');
    expect(scrollArea.textContent).toContain('移動速度');

    // Switch to prefix only -> other mod should not appear
    const items = appRoot.querySelectorAll('[data-slot="toggle-group-item"]');
    (items[1] as HTMLElement).click();
    await nextTick();

    expect(scrollArea.textContent).not.toContain('移動速度');
    expect(scrollArea.textContent).toContain('最大生命');
  });

  it('applies initial official equipment category and focuses search input when FilterPane lazy-mounts on first open', async () => {
    // 模擬 dom-tagger 在收到 poexd-request-official-category 時同步回傳裝備類別（此時 loadData 尚未完成）
    const stopOfficialCategoryResponder = listenPoeEvent('poexd-request-official-category', () => {
      dispatchPoeEvent('poexd-equipment-type-changed', { type: 'boots' });
    });

    try {
      await mountFilterPane({
        ...multiLevelModsData,
        '+# 敏捷': [
          {
            id: 'stat_dex_1',
            officialId: 'explicit.stat_dex_1',
            displayKey: '敏捷',
            displayTemplate: '+# 敏捷',
            values: [['20', '30']],
            level: '1',
            generation_type: '2',
            affinities: ['normal'],
            types: ['boots'],
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 80));
      await nextTick();

      const scrollArea = appRoot.querySelector('.mods-scroll-container') as HTMLElement;
      expect(scrollArea.textContent).toContain('敏捷');
      expect(scrollArea.textContent).not.toContain('最大生命');

      const searchInput = appRoot.querySelector(
        'input[placeholder="搜尋詞綴關鍵字..."]',
      ) as HTMLInputElement;
      expect(searchInput).toBeTruthy();
      expect(shadowRoot.activeElement).toBe(searchInput);
    } finally {
      stopOfficialCategoryResponder();
    }
  });

  it('expands affix categories when switching equipment type and applies official body-armour after initial null category', async () => {
    let officialCategory: string | null = null;
    const stopOfficialCategoryResponder = listenPoeEvent('poexd-request-official-category', () => {
      dispatchPoeEvent('poexd-equipment-type-changed', { type: officialCategory });
    });

    try {
      await mountFilterPane({
        ...multiLevelModsData,
        '+# 敏捷': [
          {
            id: 'stat_dex_1',
            officialId: 'explicit.stat_dex_1',
            displayKey: '敏捷',
            displayTemplate: '+# 敏捷',
            values: [['20', '30']],
            level: '1',
            generation_type: '2',
            affinities: ['normal'],
            types: ['boots'],
          },
        ],
      });
      await nextTick();

      const scrollArea = appRoot.querySelector('.mods-scroll-container') as HTMLElement;
      expect(scrollArea.textContent).toContain('最大生命');

      // 官方分類切換為 boots -> 切換至鞋子且詞綴分類維持展開
      officialCategory = 'boots';
      dispatchPoeEvent('poexd-equipment-type-changed', { type: 'boots' });
      await nextTick();
      expect(scrollArea.textContent).toContain('敏捷');
      expect(scrollArea.textContent).not.toContain('最大生命');

      // 隨後官方分類明確選擇 body-armour（即使初始曾為 null）-> 仍應切換回胸甲並展開
      officialCategory = 'body-armour';
      dispatchPoeEvent('poexd-equipment-type-changed', { type: 'body-armour' });
      await nextTick();
      expect(scrollArea.textContent).toContain('最大生命');
      expect(scrollArea.textContent).not.toContain('敏捷');
    } finally {
      stopOfficialCategoryResponder();
    }
  });
});
