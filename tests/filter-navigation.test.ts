// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { ref, computed, nextTick, defineComponent, h, createApp } from 'vue';
import fs from 'fs';
import path from 'path';
import { ConfigProvider } from 'reka-ui';
import { useFilterNavigation } from '@/components/sidebar/composables/useFilterNavigation';
import FilterPane from '@/components/sidebar/FilterPane.vue';
import { initPoeEventNonce } from '@/utils/event-contracts';

initPoeEventNonce('test-nonce-filter-nav');

// Global mock for chrome API
(global as any).chrome = {
  runtime: {
    getURL: (path: string) => path,
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
  ],
  '+#% 火焰抗性': [
    {
      id: 'stat_fire_res_1',
      officialId: 'explicit.stat_fire_res_1',
      displayKey: '火焰抗性',
      displayTemplate: '+#% 火焰抗性',
      values: [['15', '25']],
      level: '1',
      generation_type: '2',
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

describe('useFilterNavigation Composable (Unit Contracts)', () => {
  it('A. initial state has empty currentActiveCategory', () => {
    const groupedAffixes = ref([{ label: '前綴' }, { label: '後綴' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => aff;

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    expect(nav.currentActiveCategory.value).toBe('');
    expect(nav.navAnchorsRef.value).toBeNull();
    expect(nav.scrollContainerRef.value).toBeNull();
  });

  it('B. scrollToCategory updates container.scrollTop using relative coordinates', () => {
    const groupedAffixes = ref([{ label: '一般' }, { label: '精髓' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => aff;

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    const container = document.createElement('div');
    container.scrollTop = 100;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 50,
      bottom: 500,
      left: 0,
      right: 300,
      width: 300,
      height: 450,
      x: 0,
      y: 50,
      toJSON: () => {},
    });

    const target = document.createElement('div');
    target.id = 'category_精髓';
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 250,
      bottom: 300,
      left: 0,
      right: 300,
      width: 300,
      height: 50,
      x: 0,
      y: 250,
      toJSON: () => {},
    });
    container.appendChild(target);

    nav.scrollContainerRef.value = container;
    nav.scrollToCategory('精髓');

    // relativeTop = targetRect.top (250) - containerRect.top (50) + container.scrollTop (100) = 300
    expect(container.scrollTop).toBe(300);
  });

  it('C. handleScroll normal case: selects the last group-header with relativeTop <= 50', () => {
    const groupedAffixes = ref([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => aff;

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.scrollTop = 100;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 50,
      bottom: 450,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 50,
      toJSON: () => {},
    });

    // Header A: top = 60 -> relativeTop = 10 <= 50
    const headerA = document.createElement('div');
    headerA.className = 'group-header';
    headerA.id = 'category_A';
    vi.spyOn(headerA, 'getBoundingClientRect').mockReturnValue({
      top: 60,
      bottom: 90,
      left: 0,
      right: 300,
      width: 300,
      height: 30,
      x: 0,
      y: 60,
      toJSON: () => {},
    });

    // Header B: top = 95 -> relativeTop = 45 <= 50
    const headerB = document.createElement('div');
    headerB.className = 'group-header';
    headerB.id = 'category_B';
    vi.spyOn(headerB, 'getBoundingClientRect').mockReturnValue({
      top: 95,
      bottom: 125,
      left: 0,
      right: 300,
      width: 300,
      height: 30,
      x: 0,
      y: 95,
      toJSON: () => {},
    });

    // Header C: top = 160 -> relativeTop = 110 > 50
    const headerC = document.createElement('div');
    headerC.className = 'group-header';
    headerC.id = 'category_C';
    vi.spyOn(headerC, 'getBoundingClientRect').mockReturnValue({
      top: 160,
      bottom: 190,
      left: 0,
      right: 300,
      width: 300,
      height: 30,
      x: 0,
      y: 160,
      toJSON: () => {},
    });

    container.appendChild(headerA);
    container.appendChild(headerB);
    container.appendChild(headerC);

    nav.scrollContainerRef.value = container;
    nav.handleScroll();

    expect(nav.currentActiveCategory.value).toBe('B');
  });

  it('D. handleScroll bottom: activates the last group label when scrolled to bottom', () => {
    const groupedAffixes = ref([{ label: 'A' }, { label: 'B' }, { label: 'LastGroup' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => aff;

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    const container = document.createElement('div');
    // scrollHeight (1000) - scrollTop (600) = 400 <= clientHeight (400) + 10
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.scrollTop = 600;

    nav.scrollContainerRef.value = container;
    nav.handleScroll();

    expect(nav.currentActiveCategory.value).toBe('LastGroup');
  });

  it('E. handleScroll fallback: defaults to the first category label if no header is <= 50', () => {
    const groupedAffixes = ref([{ label: 'FirstGroup' }, { label: 'SecondGroup' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => aff;

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.scrollTop = 0;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 400,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const header = document.createElement('div');
    header.className = 'group-header';
    header.id = 'category_FirstGroup';
    // relativeTop = 100 > 50
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 130,
      left: 0,
      right: 300,
      width: 300,
      height: 30,
      x: 0,
      y: 100,
      toJSON: () => {},
    });
    container.appendChild(header);

    nav.scrollContainerRef.value = container;
    nav.handleScroll();

    expect(nav.currentActiveCategory.value).toBe('FirstGroup');
  });

  it('F. active anchor auto-scrolls into view smoothly when currentActiveCategory changes', async () => {
    const groupedAffixes = ref([{ label: 'CatA' }, { label: 'CatB' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => aff;

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    const anchorContainer = document.createElement('div');
    const activeBtn = document.createElement('button');
    activeBtn.className = 'anchor-btn-inline active';
    const scrollIntoViewSpy = vi.fn();
    activeBtn.scrollIntoView = scrollIntoViewSpy;
    anchorContainer.appendChild(activeBtn);

    nav.navAnchorsRef.value = anchorContainer;

    nav.currentActiveCategory.value = 'CatB';
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({
      block: 'nearest',
      behavior: 'smooth',
    });
  });

  it('G. nav ref null safety: changing currentActiveCategory does not throw if navAnchorsRef is null', async () => {
    const groupedAffixes = ref([{ label: 'CatA' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => aff;

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    nav.navAnchorsRef.value = null;

    expect(() => {
      nav.currentActiveCategory.value = 'CatA';
    }).not.toThrow();

    await nextTick();
    await new Promise((r) => setTimeout(r, 60));
  });

  it('H. scrollToMod expands target category and target mod key', () => {
    const groupedAffixes = ref([{ label: '一般' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => (aff === 'normal' ? '一般' : aff);

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    expect(expandedCategories.value.has('一般')).toBe(false);
    expect(expandedKeys.value.has('mod_123')).toBe(false);

    nav.scrollToMod('mod_123', 'normal');

    expect(expandedCategories.value.has('一般')).toBe(true);
    expect(expandedKeys.value.has('mod_123')).toBe(true);
  });

  it('I. scrollToMod scrolls container to target mod after 50ms', async () => {
    const groupedAffixes = ref([{ label: '一般' }]);
    const expandedCategories = ref(new Set<string>());
    const expandedKeys = ref(new Set<string>());
    const getCategoryLabel = (aff: string) => '一般';

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    const container = document.createElement('div');
    container.scrollTop = 50;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 20,
      bottom: 420,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 20,
      toJSON: () => {},
    });

    const targetMod = document.createElement('div');
    targetMod.id = 'mod_container_mod_999';
    vi.spyOn(targetMod, 'getBoundingClientRect').mockReturnValue({
      top: 180,
      bottom: 230,
      left: 0,
      right: 300,
      width: 300,
      height: 50,
      x: 0,
      y: 180,
      toJSON: () => {},
    });
    container.appendChild(targetMod);

    nav.scrollContainerRef.value = container;
    nav.scrollToMod('mod_999', 'normal');

    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    // relativeTop = 180 - 20 + 50 = 210
    expect(container.scrollTop).toBe(210);
  });

  it('J. existing expanded state is preserved and not cleared when calling scrollToMod', () => {
    const groupedAffixes = ref([{ label: '一般' }]);
    const expandedCategories = ref(new Set<string>(['既有大類']));
    const expandedKeys = ref(new Set<string>(['既有詞綴']));
    const getCategoryLabel = (aff: string) => '一般';

    const nav = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    nav.scrollToMod('新詞綴', 'normal');

    expect(expandedCategories.value.has('既有大類')).toBe(true);
    expect(expandedCategories.value.has('一般')).toBe(true);
    expect(expandedKeys.value.has('既有詞綴')).toBe(true);
    expect(expandedKeys.value.has('新詞綴')).toBe(true);
  });
});

describe('FilterPane Navigation Integration & Static Contracts', () => {
  const filterPanePath = path.resolve(__dirname, '../components/sidebar/FilterPane.vue');
  const filterPaneSource = fs.readFileSync(filterPanePath, 'utf-8');

  it('eliminates dead code (selectedModsArray, closeModalDirect, filterPaneRoot) from FilterPane.vue', () => {
    expect(filterPaneSource).not.toContain('selectedModsArray');
    expect(filterPaneSource).not.toContain('closeModalDirect');
    expect(filterPaneSource).not.toContain('filterPaneRoot');
  });

  it('enforces navigation ownership: imports and consumes useFilterNavigation without duplicate definitions', () => {
    expect(filterPaneSource).toContain(
      "import { useFilterNavigation } from './composables/useFilterNavigation'",
    );
    expect(filterPaneSource).toContain('useFilterNavigation({');

    // Should no longer declare its own definitions in script
    expect(filterPaneSource).not.toMatch(/const\s+scrollActiveCategory\s*=/);
    expect(filterPaneSource).not.toMatch(/const\s+navAnchorsRef\s*=\s*ref/);
    expect(filterPaneSource).not.toMatch(/const\s+scrollContainerRef\s*=\s*ref/);
    expect(filterPaneSource).not.toMatch(/const\s+scrollToCategory\s*=/);
    expect(filterPaneSource).not.toMatch(/const\s+handleScroll\s*=/);
    expect(filterPaneSource).not.toMatch(/const\s+scrollToMod\s*=/);
  });

  it('FilterPane integration: clicking navigation anchor triggers scrollToCategory path', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    const portalRoot = document.createElement('div');
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

    const app = createApp(Wrapper);
    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 70));
    await nextTick();

    const anchorBtn = appRoot.querySelector('.anchor-btn-inline') as HTMLElement;
    expect(anchorBtn).toBeTruthy();
    expect(() => anchorBtn.click()).not.toThrow();

    app.unmount();
    host.remove();
  });
});
