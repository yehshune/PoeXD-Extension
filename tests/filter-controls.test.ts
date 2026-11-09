// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { ConfigProvider } from 'reka-ui';
import FilterPane from '@/components/sidebar/FilterPane.vue';

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
