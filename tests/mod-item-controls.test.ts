// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { ConfigProvider } from 'reka-ui';
import ModItem from '@/components/sidebar/ModItem.vue';
import FilterPane from '@/components/sidebar/FilterPane.vue';
import type { ModGroup } from '@/components/sidebar/types';
import { createUiRuntimeTokenValues } from '@/lib/tokens';

const modItemSource = readFileSync('components/sidebar/ModItem.vue', 'utf8');
const filterPaneSource = readFileSync('components/sidebar/FilterPane.vue', 'utf8');

const sampleMod: ModGroup = {
  id: 'mod_life_normal',
  officialId: 'explicit.stat_life',
  key: 'maximum_life',
  displayKey: '最大生命',
  displayTemplate: '+# 最大生命',
  details: 'Lv.1\nLv.2',
  generation_type: '1',
  affinities: ['normal'],
  tiers: [
    {
      level: '1',
      id: 'tier_1',
      key: 'maximum_life_t1',
      displayKey: '+10 最大生命',
      displayTemplate: '+10 最大生命',
      values: [['10']],
      types: ['body-armour'],
      generation_type: '1',
      affinities: ['normal'],
    },
    {
      level: '2',
      id: 'tier_2',
      key: 'maximum_life_t2',
      displayKey: '+20 最大生命',
      displayTemplate: '+20 最大生命',
      values: [['20']],
      types: ['body-armour'],
      generation_type: '1',
      affinities: ['normal'],
    },
  ],
};

describe('ModItem Controls (Static Contracts)', () => {
  it('eliminates legacy checkbox and add-button classes from ModItem.vue template and style', () => {
    expect(modItemSource).not.toContain('<input type="checkbox"');
    expect(modItemSource).not.toContain('class="poe-checkbox"');
    expect(modItemSource).not.toContain('class="poe-btn-add"');
    expect(modItemSource).not.toContain('class="poe-btn-add-tier"');
    expect(modItemSource).not.toContain('.poe-checkbox');
    expect(modItemSource).not.toContain('.poe-btn-add {');
    expect(modItemSource).not.toContain('.poe-btn-add:hover');
    expect(modItemSource).not.toContain('.poe-btn-add-tier {');
    expect(modItemSource).not.toContain('.poe-btn-add-tier:hover');
    expect(modItemSource).not.toContain('.left-checkbox-trigger');
  });

  it('eliminates duplicate legacy ModItem control classes from FilterPane.vue scoped style', () => {
    expect(filterPaneSource).not.toContain('.poe-checkbox');
    expect(filterPaneSource).not.toContain('.poe-btn-add {');
    expect(filterPaneSource).not.toContain('.poe-btn-add:hover');
    expect(filterPaneSource).not.toContain('.poe-btn-add-tier {');
    expect(filterPaneSource).not.toContain('.poe-btn-add-tier:hover');
    expect(filterPaneSource).not.toContain('.left-checkbox-trigger');
    expect(filterPaneSource).not.toContain('.poe-btn-batch {');
  });

  it('preserves 2px bottom geometry on FilterPane ModItem render paths via class="mb-[2px]"', () => {
    expect(filterPaneSource).not.toContain('.mod-item-container {');
    const modItemMatches = filterPaneSource.match(/<ModItem[\s\S]*?\/>/g);
    expect(modItemMatches).toBeTruthy();
    expect(modItemMatches!.length).toBe(5);
    modItemMatches!.forEach((chunk) => {
      expect(chunk).toContain('class="mb-[2px]"');
    });
  });

  it('uses shadcn Checkbox and Button with Lucide ArrowRight in ModItem.vue', () => {
    expect(modItemSource).toContain("import { Checkbox } from '@/components/ui/checkbox'");
    expect(modItemSource).toContain("import { Button } from '@/components/ui/button'");
    expect(modItemSource).toContain("import { ArrowRight } from '@lucide/vue'");
    expect(modItemSource).toContain('Checkbox,');
    expect(modItemSource).toContain('Button,');
    expect(modItemSource).toContain('ArrowRight,');
  });

  it('strictly satisfies Phase 2E ZERO Gate contracts in ModItem.vue', () => {
    expect(modItemSource).not.toContain('--poexd-font-size-scale');
    expect(modItemSource).not.toContain('--poexd-density-scale');
    expect(modItemSource).not.toContain('h-auto');
    expect(modItemSource).not.toContain('size-[calc(');
    expect(modItemSource).not.toContain('text-[calc(');
    expect(modItemSource).not.toMatch(/font-size:\s*calc\(/);
    expect(modItemSource).not.toContain('mr-1.5');
    expect(modItemSource).not.toContain('ml-1.5');
  });

  it('ensures .mod-row is a pure layout container without click bindings and delegates selection to .mod-select-zone', () => {
    const modRowOpeningTagMatch = modItemSource.match(
      /<([a-zA-Z0-9_-]+)[^>]*class="[^"]*mod-row[^"]*"[^>]*>/s,
    );
    expect(modRowOpeningTagMatch).not.toBeNull();
    expect(modRowOpeningTagMatch![0]).not.toMatch(/@click|v-on:click/);

    const selectZoneMatch = modItemSource.match(
      /<([a-zA-Z0-9_-]+)[^>]*class="[^"]*mod-select-zone[^"]*"[^>]*>/s,
    );
    expect(selectZoneMatch).not.toBeNull();
    expect(selectZoneMatch![0]).toMatch(/@click|v-on:click/);

    const tierRowOpeningTagMatch = modItemSource.match(
      /<([a-zA-Z0-9_-]+)[^>]*class="[^"]*tier-row[^"]*"[^>]*>/s,
    );
    expect(tierRowOpeningTagMatch).not.toBeNull();
    expect(tierRowOpeningTagMatch![0]).toMatch(/@click|v-on:click/);
  });
});

describe('ModItem Controls (Unit Runtime Contracts)', () => {
  let host: HTMLElement;
  let app: ReturnType<typeof createApp>;

  afterEach(() => {
    if (app) app.unmount();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    vi.restoreAllMocks();
  });

  const mountModItem = async (props: Record<string, any> = {}) => {
    host = document.createElement('div');
    document.body.appendChild(host);

    const emitted: Record<string, any[][]> = {
      'toggle-select': [],
      'toggle-expand': [],
      'toggle-tier-select': [],
      'add-filter': [],
      'add-tier-filter': [],
    };

    const defaultProps = {
      mod: sampleMod,
      affinity: 'normal',
      isExpanded: false,
      isSelected: false,
      isTierSelected: (_idx: number) => false,
      searchQuery: '',
      ...props,
    };

    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ModItem, {
            ...defaultProps,
            'onToggle-select': (...args: any[]) => emitted['toggle-select'].push(args),
            'onToggle-expand': (...args: any[]) => emitted['toggle-expand'].push(args),
            'onToggle-tier-select': (...args: any[]) => emitted['toggle-tier-select'].push(args),
            'onAdd-filter': (...args: any[]) => emitted['add-filter'].push(args),
            'onAdd-tier-filter': (...args: any[]) => emitted['add-tier-filter'].push(args),
          });
      },
    });

    app = createApp(Wrapper);
    app.mount(host);
    await nextTick();

    return { host, emitted };
  };

  it('A. renders main Checkbox unchecked when isSelected=false', async () => {
    const { host } = await mountModItem({ isSelected: false });
    const checkbox = host.querySelector('.mod-row [data-slot="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect(checkbox?.getAttribute('data-state')).toBe('unchecked');
  });

  it('B. renders main Checkbox checked with indicator when isSelected=true', async () => {
    const { host } = await mountModItem({ isSelected: true });
    const checkbox = host.querySelector('.mod-row [data-slot="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect(checkbox?.getAttribute('data-state')).toBe('checked');
    const indicator = checkbox?.querySelector('[data-slot="checkbox-indicator"]');
    expect(indicator).toBeTruthy();
  });

  it('C. dispatches toggle-select EXACTLY ONCE on visual checkbox click without toggle-expand', async () => {
    const { host, emitted } = await mountModItem({ isSelected: false });
    const checkbox = host.querySelector('.mod-row [data-slot="checkbox"]') as HTMLButtonElement;

    checkbox.click();
    await nextTick();

    expect(emitted['toggle-select'].length).toBe(1);
    expect(emitted['toggle-select'][0]).toEqual([sampleMod, 'normal']);
    expect(emitted['toggle-expand'].length).toBe(0);
  });

  it('D. renders Checkbox inside .mod-select-zone without outer label hit-area wrapper', async () => {
    const { host, emitted } = await mountModItem({ isSelected: false });
    const label = host.querySelector('.mod-row label');
    expect(label).toBeNull();

    const checkbox = host.querySelector(
      '.mod-select-zone [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.getAttribute('aria-label')).toBe('選取此詞綴');

    checkbox.click();
    await nextTick();

    expect(emitted['toggle-select'].length).toBe(1);
    expect(emitted['toggle-select'][0]).toEqual([sampleMod, 'normal']);
    expect(emitted['toggle-expand'].length).toBe(0);
  });

  it('C2. dispatches toggle-select EXACTLY ONCE on .mod-select-zone click without toggle-expand', async () => {
    const { host, emitted } = await mountModItem({ isSelected: false });
    const selectZone = host.querySelector('.mod-select-zone') as HTMLElement;
    expect(selectZone).toBeTruthy();

    selectZone.click();
    await nextTick();

    expect(emitted['toggle-select'].length).toBe(1);
    expect(emitted['toggle-select'][0]).toEqual([sampleMod, 'normal']);
    expect(emitted['toggle-expand'].length).toBe(0);
  });

  it('C3. ensures .mod-row layout container does not dispatch toggle-select directly', async () => {
    const { host, emitted } = await mountModItem({ isSelected: false });
    const modRow = host.querySelector('.mod-row') as HTMLElement;
    expect(modRow).toBeTruthy();

    modRow.click();
    await nextTick();

    expect(emitted['toggle-select'].length).toBe(0);
    expect(emitted['toggle-expand'].length).toBe(0);
  });

  it('E1. renders mod-name-section as native composite button with toggle-expand action semantics', async () => {
    const { host } = await mountModItem({ isExpanded: false });
    const nameBtn = host.querySelector('.mod-name-section') as HTMLButtonElement;
    expect(nameBtn).toBeTruthy();
    expect(nameBtn.tagName).toBe('BUTTON');
    expect(nameBtn.getAttribute('type')).toBe('button');
    expect(nameBtn.classList.contains('mod-content-action')).toBe(true);
    expect(nameBtn.getAttribute('data-mod-action')).toBe('toggle-expand');
    expect(nameBtn.getAttribute('aria-expanded')).toBe('false');

    if (app) app.unmount();

    const { host: hostExpanded } = await mountModItem({ isExpanded: true });
    const nameBtnExpanded = hostExpanded.querySelector('.mod-name-section') as HTMLButtonElement;
    expect(nameBtnExpanded.getAttribute('aria-expanded')).toBe('true');
  });

  it('E. dispatches toggle-expand on composite title action, text, or chevron click without toggle-select', async () => {
    const { host, emitted } = await mountModItem({ isSelected: false });

    // 1. Click text inside title action
    const modName = host.querySelector('.mod-name') as HTMLElement;
    modName.click();
    await nextTick();

    expect(emitted['toggle-expand'].length).toBe(1);
    expect(emitted['toggle-expand'][0]).toEqual([sampleMod.id]);
    expect(emitted['toggle-select'].length).toBe(0);

    // 2. Click chevron indicator inside title action
    const chevron = host.querySelector('.expand-arrow') as HTMLElement;
    chevron.click();
    await nextTick();

    expect(emitted['toggle-expand'].length).toBe(2);
    expect(emitted['toggle-expand'][0]).toEqual([sampleMod.id]);
    expect(emitted['toggle-select'].length).toBe(0);

    // 3. Click title button container / padding itself
    const titleBtn = host.querySelector('.mod-name-section') as HTMLElement;
    titleBtn.click();
    await nextTick();

    expect(emitted['toggle-expand'].length).toBe(3);
    expect(emitted['toggle-select'].length).toBe(0);
  });

  it('F. dispatches add-filter EXACTLY ONCE on main add button click without expand or select', async () => {
    const { host, emitted } = await mountModItem();
    const addBtn = host.querySelector(
      '.mod-row button[title="立即加入此屬性"]',
    ) as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    expect(addBtn.getAttribute('data-slot')).toBe('button');
    expect(addBtn.getAttribute('aria-label')).toBe('立即加入此屬性');
    expect(addBtn.className).toContain('h-full');
    expect(addBtn.querySelector('svg')).toBeTruthy();

    addBtn.click();
    await nextTick();

    expect(emitted['add-filter'].length).toBe(1);
    expect(emitted['add-filter'][0]).toEqual([sampleMod, 'normal']);
    expect(emitted['toggle-expand'].length).toBe(0);
    expect(emitted['toggle-select'].length).toBe(0);
  });

  it('G. renders tiers list only when isExpanded=true', async () => {
    const { host: hostCollapsed } = await mountModItem({ isExpanded: false });
    expect(hostCollapsed.querySelector('.mod-tiers-list')).toBeNull();

    if (app) app.unmount();

    const { host: hostExpanded } = await mountModItem({ isExpanded: true });
    const tiersList = hostExpanded.querySelector('.mod-tiers-list');
    expect(tiersList).toBeTruthy();
    expect(tiersList?.querySelectorAll('.tier-row').length).toBe(2);
  });

  it('H. sets tier checkbox data-state based on isTierSelected(idx)', async () => {
    const { host } = await mountModItem({
      isExpanded: true,
      isTierSelected: (idx: number) => idx === 1,
    });

    const tierCheckboxes = host.querySelectorAll('.tier-row [data-slot="checkbox"]');
    expect(tierCheckboxes.length).toBe(2);
    expect(tierCheckboxes[0].getAttribute('data-state')).toBe('unchecked');
    expect(tierCheckboxes[1].getAttribute('data-state')).toBe('checked');
  });

  it('H1. renders tier content as layout section without duplicate inner action buttons', async () => {
    const { host } = await mountModItem({
      isExpanded: true,
      isTierSelected: (idx: number) => idx === 1,
    });

    const tierContentSections = host.querySelectorAll('.tier-content-section');
    expect(tierContentSections.length).toBe(sampleMod.tiers!.length);

    const innerButtons = host.querySelectorAll('.tier-content-section button');
    expect(innerButtons.length).toBe(0);
  });

  it('I. dispatches toggle-tier-select EXACTLY ONCE on Tier Checkbox click without bubbling double trigger', async () => {
    const { host, emitted } = await mountModItem({
      isExpanded: true,
      isTierSelected: (_idx: number) => false,
    });

    // Checkbox is direct child of tier-row without wrapper div
    expect(host.querySelector('.tier-row > [data-slot="checkbox"]')).toBeTruthy();

    const firstTierCheckbox = host.querySelector(
      '.tier-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    expect(firstTierCheckbox).toBeTruthy();
    expect(firstTierCheckbox.getAttribute('aria-label')).toBe('選取此階級');

    firstTierCheckbox.click();
    await nextTick();

    expect(emitted['toggle-tier-select'].length).toBe(1);
    expect(emitted['toggle-tier-select'][0]).toEqual([sampleMod, sampleMod.tiers![0], 0, 'normal']);
  });

  it('J. dispatches toggle-tier-select EXACTLY ONCE on tier-row padding / layout click', async () => {
    const { host, emitted } = await mountModItem({
      isExpanded: true,
      isTierSelected: (_idx: number) => false,
    });

    const firstTierRow = host.querySelector('.tier-row') as HTMLElement;
    expect(firstTierRow).toBeTruthy();

    firstTierRow.click();
    await nextTick();

    expect(emitted['toggle-tier-select'].length).toBe(1);
    expect(emitted['toggle-tier-select'][0]).toEqual([sampleMod, sampleMod.tiers![0], 0, 'normal']);
  });

  it('J2. dispatches toggle-tier-select EXACTLY ONCE on tier text click', async () => {
    const { host, emitted } = await mountModItem({
      isExpanded: true,
      isTierSelected: (_idx: number) => false,
    });

    const tierDesc = host.querySelector('.tier-desc') as HTMLElement;
    expect(tierDesc).toBeTruthy();

    tierDesc.click();
    await nextTick();

    expect(emitted['toggle-tier-select'].length).toBe(1);
    expect(emitted['toggle-tier-select'][0]).toEqual([sampleMod, sampleMod.tiers![0], 0, 'normal']);
  });

  it('K. dispatches add-tier-filter EXACTLY ONCE on Tier add button click without toggle-tier-select', async () => {
    const { host, emitted } = await mountModItem({
      isExpanded: true,
      isTierSelected: (_idx: number) => false,
    });

    const tierAddBtn = host.querySelector(
      '.tier-row button[title="立即加入並帶入此階級數值"]',
    ) as HTMLButtonElement;
    expect(tierAddBtn).toBeTruthy();
    expect(tierAddBtn.getAttribute('data-slot')).toBe('button');
    expect(tierAddBtn.getAttribute('aria-label')).toBe('立即加入並帶入此階級數值');
    expect(tierAddBtn.className).toContain('h-full');
    expect(tierAddBtn.querySelector('svg')).toBeTruthy();

    tierAddBtn.click();
    await nextTick();

    expect(emitted['add-tier-filter'].length).toBe(1);
    expect(emitted['add-tier-filter'][0]).toEqual([sampleMod, sampleMod.tiers![0], 'normal']);
    expect(emitted['toggle-tier-select'].length).toBe(0);
  });

  it('renders HTML-like strings as pure text and prevents DOM element injection', async () => {
    const { host } = await mountModItem({
      mod: {
        id: 'test-xss-mod',
        displayTemplate:
          '<img src="x" onerror="alert(1)"> +#% 最大生命 <script>alert("xss")</script>',
        key: 'test',
        tiers: [
          {
            level: 1,
            displayKey: '<strong>Tier 1</strong>: <iframe src="evil.html"></iframe>',
            key: 't1',
          },
        ],
      },
      searchQuery: '生命',
      isExpanded: true,
    });

    // 檢查主詞綴區域：不產生 img 或 script 元素
    const modName = host.querySelector('.mod-name');
    expect(modName).not.toBeNull();
    expect(modName!.querySelector('img')).toBeNull();
    expect(modName!.querySelector('script')).toBeNull();
    expect(modName!.textContent).toContain('<img src="x" onerror="alert(1)">');
    expect(modName!.textContent).toContain('<script>alert("xss")</script>');

    // 檢查 mark 節點正確包覆搜尋詞
    const mark = modName!.querySelector('mark.mod-search-highlight');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe('生命');

    // 檢查 Tier 清單區域：不產生 strong 或 iframe 元素
    const tierDesc = host.querySelector('.tier-desc');
    expect(tierDesc).not.toBeNull();
    expect(tierDesc!.querySelector('strong')).toBeNull();
    expect(tierDesc!.querySelector('iframe')).toBeNull();
    expect(tierDesc!.textContent).toContain('<strong>Tier 1</strong>:');
  });

  it('safely highlights search query containing regex special characters without breaking', async () => {
    const { host } = await mountModItem({
      mod: {
        id: 'test-regex-mod',
        displayTemplate: '+[10-20]% (最大) 生命 *特別*',
        key: 'test',
      },
      searchQuery: '+[10-20]% (最大)',
    });

    const modName = host.querySelector('.mod-name');
    expect(modName).not.toBeNull();
    const marks = modName!.querySelectorAll<HTMLElement>('mark.mod-search-highlight');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    const highlightedTexts = Array.from(marks).map((m: HTMLElement) => m.textContent);
    expect(highlightedTexts).toContain('+[10-20]%');
    expect(highlightedTexts).toContain('(最大)');
  });

  it('preserves ||||| as newline in formatted text', async () => {
    const { host } = await mountModItem({
      mod: {
        id: 'test-newline-mod',
        displayTemplate: '第一行|||||第二行|||||第三行',
        key: 'test',
      },
      searchQuery: '',
    });

    const modName = host.querySelector('.mod-name');
    expect(modName).not.toBeNull();
    expect(modName!.textContent).toBe('第一行\n第二行\n第三行');
  });

  it('renders "無官方ID" badge and switches action button to "填入搜尋" with Search icon when mod has no officialId', async () => {
    const modWithoutId: ModGroup = {
      id: 'mod_no_id_test',
      key: 'unsupported_stat',
      displayKey: '無官方ID測試詞綴',
      displayTemplate: '無官方ID測試詞綴',
      details: 'Lv.1',
      generation_type: '1',
      affinities: ['normal'],
      tiers: [
        {
          level: '1',
          key: 'unsupported_stat_t1',
          displayKey: '無官方ID測試階級',
          displayTemplate: '無官方ID測試階級',
          values: [['10']],
          types: ['body-armour'],
          generation_type: '1',
          affinities: ['normal'],
        },
      ],
    };

    const { host, emitted } = await mountModItem({
      mod: modWithoutId,
      isExpanded: true,
    });

    // 1. 詞綴標題應渲染「無官方ID」標籤
    const badge = host.querySelector('.mod-row [data-badge="no-official-id"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe('無官方ID');
    expect(badge?.getAttribute('title')).toContain('此詞綴尚無官方精確 ID');

    // 2. 主動作按鈕應切換為「填入搜尋」
    const mainActionBtn = host.querySelector(
      '.mod-row .mod-action-zone button',
    ) as HTMLButtonElement;
    expect(mainActionBtn).toBeTruthy();
    expect(mainActionBtn.textContent?.trim()).toContain('填入搜尋');
    expect(mainActionBtn.getAttribute('aria-label')).toBe('無官方ID，點擊將填入搜尋框');
    expect(mainActionBtn.getAttribute('title')).toBe('無官方ID，點擊將填入搜尋框');

    // 3. 點擊主動作按鈕應正常派發 add-filter
    mainActionBtn.click();
    await nextTick();
    expect(emitted['add-filter'].length).toBe(1);
    expect(emitted['add-filter'][0]).toEqual([modWithoutId, 'normal']);

    // 4. Tier 動作按鈕亦應切換為「填入搜尋」
    const tierActionBtn = host.querySelector(
      '.tier-row .tier-action-zone button',
    ) as HTMLButtonElement;
    expect(tierActionBtn).toBeTruthy();
    expect(tierActionBtn.textContent?.trim()).toContain('填入搜尋');
    expect(tierActionBtn.getAttribute('aria-label')).toBe('無官方ID，點擊將填入搜尋框');
    expect(tierActionBtn.getAttribute('title')).toBe('無官方ID，點擊將填入搜尋框');

    // 5. 點擊 Tier 動作按鈕應正常派發 add-tier-filter
    tierActionBtn.click();
    await nextTick();
    expect(emitted['add-tier-filter'].length).toBe(1);
    expect(emitted['add-tier-filter'][0]).toEqual([modWithoutId, modWithoutId.tiers![0], 'normal']);

    // 6. 無官方 ID 時主 Checkbox 應為 disabled 且點擊不觸發 toggle-select
    const mainCheckbox = host.querySelector('.mod-row [data-slot="checkbox"]') as HTMLButtonElement;
    expect(mainCheckbox).toBeTruthy();
    expect(mainCheckbox.disabled || mainCheckbox.getAttribute('disabled') !== null).toBe(true);
    expect(mainCheckbox.getAttribute('title')).toContain('此詞綴無官方ID，不支援批次套用');

    const selectZone = host.querySelector('.mod-select-zone') as HTMLElement;
    selectZone.click();
    await nextTick();
    expect(emitted['toggle-select'].length).toBe(0);

    // 7. 無官方 ID 時 Tier Checkbox 應為 disabled 且點擊不觸發 toggle-tier-select
    const tierCheckbox = host.querySelector(
      '.tier-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    expect(tierCheckbox).toBeTruthy();
    expect(tierCheckbox.disabled || tierCheckbox.getAttribute('disabled') !== null).toBe(true);
    expect(tierCheckbox.getAttribute('title')).toContain('此詞綴無官方ID，不支援批次套用');

    const tierRow = host.querySelector('.tier-row') as HTMLElement;
    tierRow.click();
    await nextTick();
    expect(emitted['toggle-tier-select'].length).toBe(0);
  });
});

describe('FilterPane + ModItem Integration Contracts', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  // Mock chrome runtime & fetch for FilterPane
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
        generation_type: '1',
        affinities: ['normal'],
        types: ['body-armour'],
      },
      {
        id: 'stat_life_2',
        officialId: 'explicit.stat_life_2',
        displayKey: '最大生命 (T2)',
        displayTemplate: '+# 最大生命',
        level: '2',
        generation_type: '1',
        affinities: ['normal'],
        types: ['body-armour'],
      },
    ],
  };

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => sampleModsData,
    }));
    mockModsData(sampleModsData);
  });

  afterEach(() => {
    if (app) app.unmount();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    vi.restoreAllMocks();
  });

  const mountFilterPane = async () => {
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

  it('L. links ModItem main Checkbox click to FilterPane selection state (0 -> 1 -> 0)', async () => {
    await mountFilterPane();

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.textContent).toContain('(0 筆)');

    const modCheckbox = appRoot.querySelector(
      '.mod-row [data-slot="checkbox"]',
    ) as HTMLButtonElement;
    expect(modCheckbox).toBeTruthy();

    // Select mod
    modCheckbox.click();
    await nextTick();

    expect(confirmBtn.textContent).toContain('(1 筆)');
    expect(modCheckbox.getAttribute('data-state')).toBe('checked');

    // Deselect mod
    modCheckbox.click();
    await nextTick();

    expect(confirmBtn.textContent).toContain('(0 筆)');
    expect(modCheckbox.getAttribute('data-state')).toBe('unchecked');
  });

  it('M. links Tier Checkbox click in expanded ModItem to FilterPane selection', async () => {
    await mountFilterPane();

    const confirmBtn = appRoot.querySelector(
      '[data-filter-action="confirm-selected"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.textContent).toContain('(0 筆)');

    // Expand mod
    const nameSection = appRoot.querySelector('[data-mod-action="toggle-expand"]') as HTMLElement;
    nameSection.click();
    await nextTick();

    // Find first tier checkbox
    const tierCheckboxes = appRoot.querySelectorAll('.tier-row [data-slot="checkbox"]');
    expect(tierCheckboxes.length).toBeGreaterThan(0);

    const firstTierCheckbox = tierCheckboxes[0] as HTMLButtonElement;
    firstTierCheckbox.click();
    await nextTick();

    expect(confirmBtn.textContent).toContain('(1 筆)');
  });
});

describe('ModItem Scale & Density Integration Contracts', () => {
  it('verifies Scale 1.2 and Density 0.8 / 1.2 layout token decoupling for ModItem', () => {
    // 1. Scale 1.2 (default density)
    const tScale12 = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });
    // icon-sm action height: 28 * 1.2 = 33.6px
    expect(tScale12['--control-height-sm']).toBe('33.6px');
    // Checkbox root & indicator: 18 * 1.2 = 21.6px, 12 * 1.2 = 14.4px
    expect(tScale12['--checkbox-size']).toBe('21.6px');
    expect(tScale12['--checkbox-indicator-size']).toBe('14.4px');
    // Tier level width: 38 * 1.2 = 45.6px
    expect(tScale12['--pxd-mod-tier-level-width']).toBe('45.6px');
    // Typography: micro 10 * 1.2 = 12px, caption 11 * 1.2 = 13.2px, secondary 12 * 1.2 = 14.4px, body 13 * 1.2 = 15.6px
    expect(tScale12['--pxd-font-micro']).toBe('12px');
    expect(tScale12['--pxd-font-caption']).toBe('13.2px');
    expect(tScale12['--pxd-font-secondary']).toBe('14.4px');
    expect(tScale12['--pxd-font-body']).toBe('15.6px');

    // 2. Density 0.8 (compact) and 1.2 (comfortable) invariants
    const tCompact = createUiRuntimeTokenValues({ scale: 1.2, density: 0.8 });
    const tComfortable = createUiRuntimeTokenValues({ scale: 1.2, density: 1.2 });

    // Button geometry invariant
    expect(tCompact['--control-height-sm']).toBe('33.6px');
    expect(tComfortable['--control-height-sm']).toBe('33.6px');

    // Checkbox geometry invariant
    expect(tCompact['--checkbox-size']).toBe('21.6px');
    expect(tComfortable['--checkbox-size']).toBe('21.6px');
    expect(tCompact['--checkbox-indicator-size']).toBe('14.4px');
    expect(tComfortable['--checkbox-indicator-size']).toBe('14.4px');

    // Tier level width invariant
    expect(tCompact['--pxd-mod-tier-level-width']).toBe('45.6px');
    expect(tComfortable['--pxd-mod-tier-level-width']).toBe('45.6px');

    // Typography invariant
    expect(tCompact['--pxd-font-micro']).toBe('12px');
    expect(tComfortable['--pxd-font-micro']).toBe('12px');
    expect(tCompact['--pxd-font-caption']).toBe('13.2px');
    expect(tComfortable['--pxd-font-caption']).toBe('13.2px');
    expect(tCompact['--pxd-font-secondary']).toBe('14.4px');
    expect(tComfortable['--pxd-font-secondary']).toBe('14.4px');
    expect(tCompact['--pxd-font-body']).toBe('15.6px');
    expect(tComfortable['--pxd-font-body']).toBe('15.6px');

    // Row gap / padding and tier list spacing scale with Density:
    // space-xs (4 baseline): 4 * 0.8 * 1.2 = 3.84px vs 4 * 1.2 * 1.2 = 5.76px
    expect(tCompact['--pxd-space-xs']).toBe('3.84px');
    expect(tComfortable['--pxd-space-xs']).toBe('5.76px');
    // space-sm (6 baseline): 6 * 0.8 * 1.2 = 5.76px vs 6 * 1.2 * 1.2 = 8.64px
    expect(tCompact['--pxd-space-sm']).toBe('5.76px');
    expect(tComfortable['--pxd-space-sm']).toBe('8.64px');
    // space-lg (12 baseline): 12 * 0.8 * 1.2 = 11.52px vs 12 * 1.2 * 1.2 = 17.28px
    expect(tCompact['--pxd-space-lg']).toBe('11.52px');
    expect(tComfortable['--pxd-space-lg']).toBe('17.28px');
  });
});
