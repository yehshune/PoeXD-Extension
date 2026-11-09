// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import TierDropdownHost from '@/components/injected/TierDropdownHost.vue';
import {
  syncTierSlots,
  clearTierSlots,
  type TierDropdownItemSpec,
} from '@/utils/tier-slot-registry';
import {
  createInjectedControls,
  createTierSlotDomainData,
} from '@/entrypoints/content/logic/injected-controls';
import { createTierDomainService } from '@/entrypoints/content/logic/tier-domain-service';
import {
  setActiveDisplayLocalePreference,
  setActiveDisplayLocale,
  resetI18nStateForTests,
} from '@/utils/i18n';

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

describe('Seam 2: In-Page Tier Dropdown (`TierDropdownHost.vue`) & Search Form Injected Buttons (`injected-controls.ts`)', () => {
  let shadowHost: HTMLElement;
  let shadowRoot: ShadowRoot;
  let uiContainer: HTMLElement;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let slotEl1: HTMLElement;
  let app: any;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');

    slotEl1 = document.createElement('span');
    slotEl1.className = 'poexd-tier-trigger-slot';
    slotEl1.setAttribute('data-poexd-slot-key', 'slot-1');
    document.body.appendChild(slotEl1);

    shadowHost = document.createElement('div');
    shadowHost.id = 'poexd-sidebar-container';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    uiContainer = document.createElement('div');
    shadowRoot.appendChild(uiContainer);

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    uiContainer.appendChild(appRoot);

    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    uiContainer.appendChild(portalRoot);

    const RootComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(TierDropdownHost),
          ]);
      },
    });

    app = createApp(RootComponent);
    app.mount(appRoot);
  });

  afterEach(() => {
    clearTierSlots();
    app?.unmount();
    shadowHost?.remove();
    slotEl1?.remove();
    document.querySelectorAll('.search-panel, .search-advanced-pane').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('renders and reactively switches injected button labels in injected-controls.ts', () => {
    setActiveDisplayLocale('zh-TW');

    // Create container for send to console button
    const searchPanel = document.createElement('div');
    searchPanel.className = 'search-panel';
    const controls = document.createElement('div');
    controls.className = 'controls';
    searchPanel.appendChild(controls);
    document.body.appendChild(searchPanel);

    // Create container for filter group buttons
    const advancedPane = document.createElement('div');
    advancedPane.className = 'search-advanced-pane brown';
    const filterGroup = document.createElement('div');
    filterGroup.className = 'filter-group';
    const header = document.createElement('div');
    header.className = 'filter-group-header';
    const title = document.createElement('div');
    title.className = 'filter-title';
    title.textContent = '類別過濾 (Type Filters)';
    header.appendChild(title);
    filterGroup.appendChild(header);
    advancedPane.appendChild(filterGroup);
    document.body.appendChild(advancedPane);

    const tierDomainService = createTierDomainService('poe2');
    const injected = createInjectedControls({
      version: 'poe2',
      tierDomainService,
      isCurrentGeneration: () => true,
    });

    injected.injectSendToConsoleButton();
    injected.injectFilterGroupButtons();

    const consoleBtn = searchPanel.querySelector<HTMLButtonElement>('.poexd-send-to-console-btn');
    expect(consoleBtn).toBeTruthy();
    expect(consoleBtn?.textContent).toBe('送入主控台');
    expect(consoleBtn?.title).toBe('將目前搜尋條件送入線上搜尋主控台監聽');

    const selectAffixBtn = advancedPane.querySelector<HTMLButtonElement>(
      '.poexd-category-select-btn',
    );
    expect(selectAffixBtn).toBeTruthy();
    expect(selectAffixBtn?.textContent).toBe('＋ 選擇詞綴');
    expect(selectAffixBtn?.title).toBe('開啟詞綴選擇器，將詞綴加入篩選群組');

    // Switch to English
    setActiveDisplayLocale('en');
    injected.updateInjectedControlsLocale?.();

    expect(consoleBtn?.textContent).toBe('Send to Console');
    expect(consoleBtn?.title).toBe('Send current search criteria to LiveSearch Console');
    expect(selectAffixBtn?.textContent).toBe('+ Select Affix');
    expect(selectAffixBtn?.title).toBe('Open Affix Selector to add affixes to this group');

    // Switch to Simplified Chinese
    setActiveDisplayLocale('zh-CN');
    injected.updateInjectedControlsLocale?.();

    expect(consoleBtn?.textContent).toBe('送入主控台');
    expect(consoleBtn?.title).toBe('将当前搜索条件送入实时搜索控制台监听');
    expect(selectAffixBtn?.textContent).toBe('＋ 选择词缀');
    expect(selectAffixBtn?.title).toBe('开启词缀选择器，将词缀加入筛选群组');
  });

  it('localizes domain item labels created by createTierSlotDomainData', () => {
    const tierDomainService = createTierDomainService('poe2');
    const options = {
      version: 'poe2' as const,
      tierDomainService,
    };

    const filterEl = document.createElement('div');
    filterEl.className = 'filter';
    filterEl.setAttribute('data-poexd-stat-id', 'explicit.stat_life');
    filterEl.setAttribute('data-poexd-category', 'body-armour');

    const mockSlotEl = document.createElement('span');
    mockSlotEl.setAttribute('data-poexd-slot-key', 'slot-mock');

    // 1. With zh-TW
    setActiveDisplayLocale('zh-TW');
    const sampleTiers = [
      {
        id: 'tier_1',
        level: '80',
        types: ['body-armour'],
        values: [{ min: '100', max: '120' }],
      },
    ];

    const dataTw = createTierSlotDomainData(
      sampleTiers,
      filterEl,
      mockSlotEl,
      options,
      'explicit.stat_life',
    );
    const switchItemTw = dataTw.items.find((i) => i.type === 'switch_category');
    expect(switchItemTw?.label).toContain('(點選切換)');

    // 2. With en
    setActiveDisplayLocale('en');
    const dataEn = createTierSlotDomainData(
      sampleTiers,
      filterEl,
      mockSlotEl,
      options,
      'explicit.stat_life',
    );
    const switchItemEn = dataEn.items.find((i) => i.type === 'switch_category');
    expect(switchItemEn?.label).toContain('(Click to switch)');

    // 3. Empty category fallback
    filterEl.setAttribute('data-poexd-category', 'helmet');
    const emptyDataEn = createTierSlotDomainData(
      sampleTiers,
      filterEl,
      mockSlotEl,
      options,
      'explicit.stat_life',
    );
    const emptyHeaderEn = emptyDataEn.items.find((i) => i.type === 'header');
    expect(emptyHeaderEn?.label).toBe('No affixes for this category');
  });

  it('reactively switches UI text in TierDropdownHost.vue', async () => {
    setActiveDisplayLocale('zh-TW');

    const items: TierDropdownItemSpec[] = [
      {
        id: 't1',
        type: 'tier',
        label: 'T1 (Lv.80) (100 ~ 120)',
        valMin: '100',
        valMax: '120',
      },
    ];

    syncTierSlots([
      {
        key: 'slot-1',
        targetEl: slotEl1,
        items,
        onSelect: () => {},
      },
    ]);
    await nextTick();

    const triggerBtn = slotEl1.querySelector<HTMLButtonElement>('.poexd-tier-trigger');
    expect(triggerBtn).toBeTruthy();
    expect(triggerBtn?.getAttribute('title')).toBe('此詞綴階級設定');

    // Open dropdown to render menu contents in portalRoot
    triggerBtn?.click();
    await nextTick();

    const tuningBar = portalRoot.querySelector('[data-slot="tier-tuning-bar"]');
    expect(tuningBar).toBeTruthy();
    expect(tuningBar?.textContent).toContain('微調:');

    const applyBtn = portalRoot.querySelector<HTMLButtonElement>('[data-slot="tuning-apply-btn"]');
    expect(applyBtn?.textContent?.trim()).toBe('套用');
    expect(applyBtn?.getAttribute('title')).toBe('套用自訂數值');

    // Now switch to en
    setActiveDisplayLocale('en');
    await nextTick();

    expect(triggerBtn?.getAttribute('title')).toBe('Configure affix tier');
    expect(tuningBar?.textContent).toContain('Tuning:');
    expect(applyBtn?.textContent?.trim()).toBe('Apply');
    expect(applyBtn?.getAttribute('title')).toBe('Apply custom values');
  });
});
