// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import FilterPane from '@/components/sidebar/FilterPane.vue';
import ModItem from '@/components/sidebar/ModItem.vue';
import {
  setActiveDisplayLocalePreference,
  setActiveDisplayLocale,
  resetI18nStateForTests,
} from '@/utils/i18n';
import { listenPoeEvent } from '@/utils/event-contracts';
import { ensureAffixLexiconLoaded, resetAffixLexiconCacheForTests } from '@/utils/affix-lexicon';

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
  '# to maximum life': [
    {
      id: 'stat_life_1',
      officialId: 'explicit.stat_life_1',
      key: '# to maximum life',
      displayKey: '最大生命',
      displayTemplate: '+# 最大生命',
      level: '1',
      generation_type: '1', // prefix
      affinities: ['normal'],
      types: ['body-armour'],
      values: [['10', '20']],
    },
  ],
  '#% to fire resistance': [
    {
      id: 'stat_fire_res_1',
      officialId: 'explicit.stat_fire_res_1',
      key: '#% to fire resistance',
      displayKey: '火焰抗性',
      displayTemplate: '+#% 火焰抗性',
      level: '1',
      generation_type: '2', // suffix
      affinities: ['normal'],
      types: ['body-armour'],
      values: [['5', '10']],
    },
  ],
  '#% increased local physical damage': [
    {
      id: '',
      key: '#% increased local physical damage',
      displayKey: '增加物理傷害',
      displayTemplate: '增加 #% 物理傷害',
      level: '1',
      generation_type: '1',
      affinities: ['normal'],
      types: ['body-armour'],
      values: [['20', '30']],
    },
  ],
};

global.fetch = vi.fn().mockImplementation(async () => ({
  ok: true,
  json: async () => sampleModsData,
}));

describe('Seam 1: Affix Selector (`FilterPane.vue` and `ModItem.vue`) & Bilingual Search', () => {
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    resetAffixLexiconCacheForTests();
    mockModsData(sampleModsData);
  });

  afterEach(() => {
    if (app) {
      app.unmount();
    }
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
    vi.restoreAllMocks();
  });

  it('reactively switches UI text in FilterPane between zh-TW, zh-CN, and en', async () => {
    setActiveDisplayLocale('zh-TW');
    await mountFilterPane();

    // Check generation toggle items in zh-TW
    const genButtons = appRoot.querySelectorAll('[role="group"] button, .controls-row button');
    const genTexts = Array.from(genButtons).map((b) => b.textContent?.trim());
    expect(genTexts).toContain('全部');
    expect(genTexts).toContain('前綴');
    expect(genTexts).toContain('後綴');
    expect(genTexts).toContain('全選');
    expect(genTexts).toContain('取消全選');

    // Check search placeholder
    const searchInput = appRoot.querySelector<HTMLInputElement>('.item-search input');
    expect(searchInput?.placeholder).toBe('搜尋詞綴關鍵字...');

    // Now reactively switch to en
    setActiveDisplayLocale('en');
    await nextTick();

    const enGenButtons = appRoot.querySelectorAll('[role="group"] button, .controls-row button');
    const enGenTexts = Array.from(enGenButtons).map((b) => b.textContent?.trim());
    expect(enGenTexts).toContain('All');
    expect(enGenTexts).toContain('Prefix');
    expect(enGenTexts).toContain('Suffix');
    expect(enGenTexts).toContain('Select All');
    expect(enGenTexts).toContain('Deselect All');
    expect(searchInput?.placeholder).toBe('Search affix keywords...');

    // Switch to zh-CN
    setActiveDisplayLocale('zh-CN');
    await nextTick();

    const cnGenButtons = appRoot.querySelectorAll('[role="group"] button, .controls-row button');
    const cnGenTexts = Array.from(cnGenButtons).map((b) => b.textContent?.trim());
    expect(cnGenTexts).toContain('全部');
    expect(cnGenTexts).toContain('前缀');
    expect(cnGenTexts).toContain('后缀');
    expect(cnGenTexts).toContain('全选');
    expect(cnGenTexts).toContain('取消全选');
    expect(searchInput?.placeholder).toBe('搜索词缀关键词...');
  });

  it('reactively switches ModItem UI text and action tooltips', async () => {
    const mod = sampleModsData['# to maximum life'][0];
    const dummyModGroup = {
      id: 'mod_life_1_normal',
      officialId: mod.officialId,
      key: mod.key,
      displayKey: mod.displayKey,
      displayTemplate: mod.displayTemplate,
      details: '',
      generation_type: '1',
      affinities: ['normal'],
      tiers: [mod],
    };

    setActiveDisplayLocale('zh-TW');

    const modHost = document.createElement('div');
    document.body.appendChild(modHost);
    const modApp = createApp({
      render() {
        return h(ModItem, {
          mod: dummyModGroup,
          affinity: 'normal',
          isExpanded: false,
          isSelected: false,
          isTierSelected: () => false,
        });
      },
    });
    modApp.mount(modHost);
    await nextTick();

    const addBtn = modHost.querySelector<HTMLButtonElement>('.mod-action-zone button');
    expect(addBtn?.textContent?.trim()).toBe('立即加入');
    expect(addBtn?.getAttribute('title')).toBe('立即加入此屬性');

    // Switch to en
    setActiveDisplayLocale('en');
    await nextTick();

    expect(addBtn?.textContent?.trim()).toBe('Add Now');
    expect(addBtn?.getAttribute('title')).toBe('Add this stat immediately');

    modApp.unmount();
    modHost.remove();
  });

  it('supports bilingual search (both Chinese and English keywords) when displayLocale is zh-TW or zh-CN', async () => {
    setActiveDisplayLocalePreference('zh-TW');
    await mountFilterPane();

    const searchInput = appRoot.querySelector<HTMLInputElement>('.item-search input');
    expect(searchInput).toBeTruthy();

    // 1. Search by Chinese keyword '生命'
    searchInput!.value = '生命';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    let items = appRoot.querySelectorAll('.mod-item-container');
    expect(items.length).toBeGreaterThanOrEqual(1);

    // 2. Search by English keyword 'life'
    searchInput!.value = 'life';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    items = appRoot.querySelectorAll('.mod-item-container');
    expect(items.length).toBeGreaterThanOrEqual(1);

    // 3. Search by non-matching keyword 'chaos'
    searchInput!.value = 'chaos_non_existent';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    const empty = appRoot.querySelector('.empty-mods');
    expect(empty).toBeTruthy();
    expect(empty?.textContent?.trim()).toBe('沒有符合的詞綴');
  });

  it('preserves Page Locale for unmatched affix fallback query even when Display Locale is zh-TW', async () => {
    setActiveDisplayLocalePreference('zh-TW');
    await mountFilterPane();

    let eventDetail: any = null;
    const unlisten = listenPoeEvent('poexd-add-stat-filter', (detail) => {
      eventDetail = detail;
    });

    // 1. Verify unmatched mod inside FilterPane
    const unmatchedBadge = appRoot.querySelector('[data-badge="no-official-id"]');
    expect(unmatchedBadge).toBeTruthy();
    const unmatchedItem = unmatchedBadge?.closest('.mod-item-container');
    expect(unmatchedItem).toBeTruthy();

    const addBtn = unmatchedItem?.querySelector<HTMLButtonElement>('.mod-action-zone button');
    expect(addBtn?.textContent?.trim()).toBe('填入搜尋');
    expect(addBtn?.getAttribute('title')).toBe('無官方ID，點擊將填入搜尋框');

    // Click button to trigger FilterPane's handleAddFilter -> emitFallback
    addBtn?.click();
    await nextTick();

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.statId).toBeNull();
    // In happy-dom default environment, Page Locale resolves to 'en'
    expect(eventDetail.fallbackQuery).toBe('increased local physical damage');

    unlisten();
  });

  it('reactively updates pending batch-selection item labels when locale switches', async () => {
    setActiveDisplayLocale('zh-TW');
    await mountFilterPane();

    // Select the first valid mod into pending list
    const lifeItem = Array.from(appRoot.querySelectorAll('.mod-item-container')).find(
      (el) => !el.querySelector('[data-badge="no-official-id"]'),
    );
    expect(lifeItem).toBeTruthy();

    const selectCheckbox = lifeItem?.querySelector<HTMLButtonElement>('.mod-select-zone button');
    selectCheckbox?.click();
    await nextTick();

    // Verify pending item label in zh-TW
    const pendingName = appRoot.querySelector('.selected-mod-name');
    expect(pendingName).toBeTruthy();
    expect(pendingName?.textContent?.trim()).toBe('+# 最大生命');

    // Switch to en
    setActiveDisplayLocale('en');
    await nextTick();

    const pendingNameEn = appRoot.querySelector('.selected-mod-name');
    expect(pendingNameEn?.textContent?.trim()).toBe('# to maximum life');

    // Switch back to zh-TW
    setActiveDisplayLocale('zh-TW');
    await nextTick();

    const pendingNameTw = appRoot.querySelector('.selected-mod-name');
    expect(pendingNameTw?.textContent?.trim()).toBe('+# 最大生命');
  });
});
