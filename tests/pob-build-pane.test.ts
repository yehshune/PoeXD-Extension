// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, h, nextTick, ref, type App, type Component } from 'vue';
import { ConfigProvider } from 'reka-ui';
import type { BuildView, UsePobBuild } from '@/components/sidebar/pob-build/usePobBuild';
import { resetI18nStateForTests } from '@/utils/i18n';

vi.mock('@/utils/trade-context', () => ({ getPoeVersion: () => 'poe1' }));

const { prefState, prefListeners } = vi.hoisted(() => ({
  prefState: { searchEntryClickAction: 'open' as 'open' | 'preview' },
  prefListeners: new Set<(snapshot: { searchEntryClickAction: 'open' | 'preview' }) => void>(),
}));

vi.mock('@/utils/preferences', () => ({
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      read: () => ({ searchEntryClickAction: prefState.searchEntryClickAction }),
      subscribe: (listener: (snapshot: { searchEntryClickAction: 'open' | 'preview' }) => void) => {
        prefListeners.add(listener);
        listener({ searchEntryClickAction: prefState.searchEntryClickAction });
        return () => prefListeners.delete(listener);
      },
    },
  })),
}));

const buildsRef = ref<BuildView[]>([]);
const errorKey = ref<UsePobBuild['errorKey']['value']>(null);
const fake = {
  builds: computed(() => buildsRef.value),
  errorKey,
  isBusy: ref(false),
  restore: vi.fn<() => Promise<void>>(async () => undefined),
  importCode: vi.fn(async () => true),
  updateCode: vi.fn(async () => true),
  setHideDone: vi.fn(),
  openLiveSearch: vi.fn(async () => true),
  sendToLiveSearch: vi.fn(async () => true),
  saveCurrentSearch: vi.fn(() => true),
  listBookmarkFolders: vi.fn(async () => [
    { id: 'g1', name: 'PoB', depth: 0 },
    { id: 'g2', name: 'Rings', depth: 1 },
  ]),
  addToBookmarks: vi.fn(async () => true),
  rename: vi.fn(),
  removeBuild: vi.fn(),
  toggleCollapsed: vi.fn(),
  selectItemSet: vi.fn(),
  selectSkillSet: vi.fn(),
  toggleDone: vi.fn(),
  removeEntry: vi.fn(),
  restoreRemoved: vi.fn(),
  openSearch: vi.fn(() => true),
  resolveSearchUrl: vi.fn((_buildId: string, entry: { query: unknown; searchOverride?: boolean }) =>
    entry.query || entry.searchOverride
      ? 'https://www.pathofexile.com/trade/search/Covens?q=test'
      : undefined,
  ),
  setStatEnabled: vi.fn(),
  setStatBound: vi.fn(),
  setCountMin: vi.fn(),
  setPseudo: vi.fn(),
  saveSelection: vi.fn(),
  resetSearch: vi.fn(),
  setSearchDefaults: vi.fn(),
  openSharePermissionPage: vi.fn(),
  dispose: vi.fn(),
} satisfies UsePobBuild;

vi.mock('@/components/sidebar/pob-build/usePobBuild', () => ({ usePobBuild: () => fake }));

const ICON = 'https://web.poecdn.com/gen/image/abc/Shield.png';

const sampleBuild = (): BuildView => ({
  id: 'b1',
  name: 'RF 酋長',
  collapsed: false,
  itemSetOptions: [
    { id: '1', title: 'Endgame', position: 1 },
    { id: '2', title: '', position: 2 },
  ],
  skillSetOptions: [{ id: '1', title: '', position: 1 }],
  itemSetId: '1',
  skillSetId: '1',
  groups: [
    {
      id: 'equipment',
      kind: 'equipment',
      rows: [
        {
          key: 'k-unique',
          kind: 'unique',
          label: 'Rise of the Phoenix',
          englishName: 'Rise of the Phoenix',
          slot: 'Weapon 2',
          rarity: 'UNIQUE',
          mods: [],
          count: 1,
          searchBase: { type: 'x' },
          query: { type: 'x' },
          done: true,
          icon: ICON,
          filters: [],
          pseudo: false,
          searchCustomized: false,
          searchOverride: false,
        },
        {
          key: 'k-rare',
          kind: 'equipment',
          label: 'Leviathan Gauntlets',
          englishName: 'Leviathan Gauntlets',
          slot: 'Gloves',
          rarity: 'RARE',
          sockets: 'R-G-B-B',
          iconSize: { width: 2, height: 2 },
          mods: [
            { text: '+7% to Fire Damage over Time Multiplier', kind: 'implicit', searched: false },
            {
              text: '+100 to maximum Life',
              kind: 'explicit',
              searched: true,
              stat: {
                id: 'explicit.stat_life',
                value: 100,
                defaultEnabled: true,
                pseudo: [{ id: 'pseudo.pseudo_total_life', weight: 1 }],
              },
            },
            {
              text: '-10 to Strength Requirement',
              kind: 'explicit',
              searched: false,
              stat: { id: 'explicit.stat_str_req', value: -10, defaultEnabled: true },
            },
            { text: '12% increased Area of Effect', kind: 'crafted', searched: false },
          ],
          count: 2,
          searchBase: { type: 'y' },
          query: { type: 'y' },
          done: false,
          filters: [
            {
              id: 'explicit.stat_life',
              key: 'explicit.stat_life',
              value: 100,
              enabled: true,
              min: 80,
              customized: false,
            },
            {
              id: 'explicit.stat_str_req',
              key: 'explicit.stat_str_req',
              value: -10,
              enabled: false,
              max: -8,
              customized: true,
            },
          ],
          countMin: 1,
          pseudo: false,
          searchCustomized: true,
          searchOverride: false,
        },
        {
          key: 'k-none',
          kind: 'equipment',
          label: 'Mystery Base',
          englishName: 'Mystery Base',
          slot: 'Helmet',
          rarity: 'RARE',
          mods: [],
          count: 1,
          searchBase: null,
          query: null,
          done: false,
          filters: [],
          pseudo: false,
          searchCustomized: false,
          searchOverride: false,
        },
      ],
    },
    {
      id: 'gem:Body Armour',
      kind: 'gem',
      slot: 'Body Armour',
      rows: [
        {
          key: 'k-gem',
          kind: 'gem',
          label: 'Punishment',
          englishName: 'Punishment',
          level: 20,
          quality: 20,
          count: 1,
          searchBase: { type: 'z' },
          query: { type: 'z' },
          done: false,
          filters: [],
          pseudo: false,
          searchCustomized: false,
          searchOverride: false,
        },
      ],
    },
  ],
  progress: { done: 1, total: 4 },
  hideDone: false,
  removedCount: 2,
  searchDefaults: {},
});

const flushAsync = async (ms = 20) => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await nextTick();
};

async function chooseSelectOption(trigger: HTMLElement, value: string) {
  trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  trigger.click();
  await flushAsync(40);
  const items = Array.from(
    document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
  );
  const target = items.find((item) => item.getAttribute('data-value') === value);
  expect(target).toBeDefined();
  const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  target!.focus?.();
  target!.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true }));
  target!.dispatchEvent(new EventCtor('pointerup', { bubbles: true, cancelable: true }));
  target!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  target!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  target!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  await flushAsync(40);
}

describe('PobBuildPane', () => {
  let container: HTMLElement;
  let app: App;
  let confirmSpy: ReturnType<typeof vi.fn>;

  let PobBuildPane: Component;

  // 第一次載入元件要轉譯整串相依模組，比單一測試的時限久
  beforeAll(async () => {
    PobBuildPane = (await import('@/components/sidebar/pob-build/PobBuildPane.vue')).default;
  }, 60_000);

  /** 預設是裝備欄檢視；大部分測試檢查清單列，掛載後切到清單 */
  const mount = async ({ view = 'list' }: { view?: 'list' | 'gear' } = {}) => {
    app = createApp(PobBuildPane);
    app.mount(container);
    await nextTick();
    await nextTick();
    await nextTick();
    if (view === 'list') {
      container
        .querySelectorAll<HTMLElement>('[data-pob-build-view-option="list"]')
        .forEach((option) => option.click());
      await nextTick();
    }
  };
  const query = <T extends Element = HTMLElement>(selector: string) =>
    container.querySelector<T>(selector);
  const queryBody = <T extends Element = HTMLElement>(selector: string) =>
    document.body.querySelector<T>(selector);
  const queryAll = (selector: string) => Array.from(container.querySelectorAll(selector));
  const queryAllBody = (selector: string) => Array.from(document.body.querySelectorAll(selector));
  const row = (index: number) => queryAll('[data-pob-build-row]')[index] as HTMLElement;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    prefState.searchEntryClickAction = 'open';
    prefListeners.clear();
    buildsRef.value = [];
    errorKey.value = null;
    vi.clearAllMocks();
    confirmSpy = vi.fn(async () => true);
    (window as any).poexdConfirm = confirmSpy;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    app.unmount();
    container.remove();
    delete (window as any).poexdConfirm;
    document.body.querySelectorAll('[data-reka-portal]').forEach((el) => el.remove());
  });

  it('採用 SidebarPane 架構，沒有 build 時顯示空狀態與匯入對話框按鈕，掛載時讀回上次的 build', async () => {
    await mount();
    expect(fake.restore).toHaveBeenCalledTimes(1);
    expect(query('[data-slot="sidebar-pane"]')).not.toBeNull();
    expect(query('[data-slot="sidebar-pane-fixed"]')).not.toBeNull();
    expect(query('[data-slot="sidebar-pane-scroll"]')).not.toBeNull();
    expect(query('[data-pob-build-loading]')).toBeNull();
    expect(query('[data-pob-build-empty-state]')).not.toBeNull();
    expect(query('[data-pob-build-add]')).not.toBeNull();
    expect(queryBody('[data-pob-build-input]')).toBeNull();
  });

  it('初次掛載尚未讀完本機資料時顯示載入中，不會閃現空狀態', async () => {
    let resolveRestore!: () => void;
    fake.restore.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRestore = resolve;
        }),
    );

    app = createApp(PobBuildPane);
    app.mount(container);
    await nextTick();

    expect(query('[data-pob-build-loading]')).not.toBeNull();
    expect(query('[data-pob-build-empty-state]')).toBeNull();

    buildsRef.value = [sampleBuild()];
    resolveRestore();
    await flushAsync(0);

    expect(query('[data-pob-build-loading]')).toBeNull();
    expect(query('[data-pob-build-empty-state]')).toBeNull();
    expect(query('[data-pob-build-name]')?.textContent?.trim()).toBe('RF 酋長');
  });

  it('讀完本機資料確認沒有 build 時，才從載入中切換為空狀態', async () => {
    let resolveRestore!: () => void;
    fake.restore.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRestore = resolve;
        }),
    );

    app = createApp(PobBuildPane);
    app.mount(container);
    await nextTick();

    expect(query('[data-pob-build-loading]')).not.toBeNull();
    expect(query('[data-pob-build-empty-state]')).toBeNull();

    resolveRestore();
    await flushAsync(0);

    expect(query('[data-pob-build-loading]')).toBeNull();
    expect(query('[data-pob-build-empty-state]')).not.toBeNull();
  });

  it('打開匯入對話框後貼上代碼可匯入，成功後關閉對話框並清空欄位', async () => {
    await mount();
    query<HTMLButtonElement>('[data-pob-build-add]')!.click();
    await flushAsync();

    const input = queryBody<HTMLInputElement>('[data-pob-build-input]')!;
    expect(input).not.toBeNull();
    expect(input.tagName).toBe('INPUT');
    expect(queryBody<HTMLButtonElement>('[data-pob-build-import]')?.disabled).toBe(true);

    input.value = 'CODE';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    queryBody<HTMLButtonElement>('[data-pob-build-import]')!.click();
    await flushAsync();
    expect(fake.importCode).toHaveBeenCalledWith('CODE');
    expect(queryBody('[data-pob-build-input]')).toBeNull();
  });

  it('分享網址缺少權限時，對話框顯示前往授權按鈕並開啟授權頁', async () => {
    await mount();
    query<HTMLButtonElement>('[data-pob-build-add]')!.click();
    await flushAsync();
    expect(queryBody('[data-pob-build-grant-permission]')).toBeNull();

    errorKey.value = 'pobBuild.error.share.permission';
    await flushAsync();
    const grant = queryBody<HTMLButtonElement>('[data-pob-build-grant-permission]')!;
    expect(grant).not.toBeNull();
    grant.click();
    expect(fake.openSharePermissionPage).toHaveBeenCalledTimes(1);
  });

  it('有 build 時列出名稱、進度、shadcn Select 套裝選單與各組項目', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    expect(query('[data-pob-build-add]')).not.toBeNull();
    expect(query('[data-pob-build-name]')?.textContent?.trim()).toBe('RF 酋長');
    expect(query('[data-pob-build-progress]')?.textContent?.trim()).toBe('1/4');

    const itemSetTrigger = query<HTMLElement>('[data-pob-build-item-set]')!;
    expect(itemSetTrigger.getAttribute('data-slot')).toBe('select-trigger');
    expect(itemSetTrigger.textContent).toContain('Endgame');

    // 技能組只有一組，不顯示選單
    expect(query('[data-pob-build-skill-set]')).toBeNull();
    expect(
      queryAll('[data-pob-build-group]').map((group) => group.getAttribute('data-pob-build-group')),
    ).toEqual(['equipment', 'gem']);
    expect(
      queryAll('[data-pob-build-group] h4 > span:first-child').map((title) => title.textContent),
    ).toEqual(['裝備', '寶石 · 胸甲']);
    expect(queryAll('[data-pob-build-row]')).toHaveLength(4);
  });

  it('沒有部位的寶石分組以連線名稱為標題', async () => {
    const build = sampleBuild();
    buildsRef.value = [
      {
        ...build,
        groups: [{ ...build.groups[1], id: 'gem:link:Arc', slot: undefined, skill: '電弧' }],
      },
    ];
    await mount();
    expect(query('[data-pob-build-group] h4')?.textContent).toContain('寶石 · 電弧');
  });

  it('隱藏已完成交給狀態處理；全部完成且隱藏時顯示已隱藏的數量', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    query<HTMLElement>('[data-pob-build-hide-done]')!.click();
    expect(fake.setHideDone).toHaveBeenCalledWith('b1', true);

    buildsRef.value = [
      { ...sampleBuild(), groups: [], hideDone: true, progress: { done: 4, total: 4 } },
    ];
    await nextTick();
    expect(query('[data-pob-build-empty]')?.textContent).toContain('全部完成，已隱藏 4 項');
    expect(query('[data-pob-build-hide-done]')?.getAttribute('aria-pressed')).toBe('true');
    expect(query('[data-pob-build-hide-done-indicator]')).not.toBeNull();
  });

  it('汙染與穢生：清單加上標籤，裝備欄格子加上汙染標記與穢生圖片效果', async () => {
    const base = sampleBuild();
    const [equip, gems] = base.groups;
    const rare = { ...equip.rows[1], corrupted: true as const, icon: ICON };
    const unique = { ...equip.rows[0], foulborn: true as const, done: false };
    buildsRef.value = [
      { ...base, groups: [{ ...equip, rows: [unique, rare, equip.rows[2]] }, gems] },
    ];
    await mount();
    expect(row(0).querySelector('[data-pob-build-foulborn]')?.textContent).toContain('穢生');
    expect(row(0).querySelector('.pxd-item--foulborn')).not.toBeNull();
    expect(row(1).querySelector('[data-pob-build-corrupted]')?.textContent).toContain('已汙染');

    query<HTMLElement>('[data-pob-build-view-option="gear"]')!.click();
    await nextTick();
    expect(
      query('[data-pob-build-gear-tile="gloves"] [data-pob-build-gear-corrupted]'),
    ).not.toBeNull();
    expect(query('[data-pob-build-gear-tile="weapon2"] .pxd-item--foulborn')).not.toBeNull();
  });

  it('插槽內顯示內容物圖片，外圈保留插槽顏色；滑過插槽顯示內容說明', async () => {
    const base = sampleBuild();
    const [equip, gems] = base.groups;
    const rare = {
      ...equip.rows[1],
      socketContents: [
        { kind: 'gem' as const, label: '懲戒', detail: 'Lv.20 / 20%', icon: ICON, rowKey: 'k-gem' },
        { kind: 'gem' as const, label: '增加持續時間輔助', support: true },
      ],
    };
    buildsRef.value = [
      { ...base, groups: [{ ...equip, rows: [equip.rows[0], rare, equip.rows[2]] }, gems] },
    ];
    await mount({ view: 'gear' });
    const sockets = queryAll('[data-pob-build-gear-tile="gloves"] .pxd-socket');
    expect(sockets).toHaveLength(4);
    expect(sockets[0].getAttribute('data-socket-filled')).toBe('true');
    expect(sockets[0].getAttribute('data-socket-color')).toBe('R');
    expect(sockets[0].querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(sockets[2].getAttribute('data-socket-filled')).toBeNull();

    sockets[0].dispatchEvent(new MouseEvent('mouseenter'));
    await nextTick();
    expect(query('[data-pob-build-socket-tip]')?.textContent).toContain('懲戒');
    expect(query('[data-pob-build-socket-tip]')?.textContent).toContain('Lv.20 / 20%');
    sockets[0].dispatchEvent(new MouseEvent('mouseleave'));
    await nextTick();
    expect(query('[data-pob-build-socket-tip]')).toBeNull();

    // 點插槽裡的寶石開該寶石的設定框，不觸發外層格子
    sockets[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();
    expect(queryBody('[data-pob-build-gem-filters]')).not.toBeNull();
    expect(query('[data-pob-build-gear-tile="gloves"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(fake.openSearch).not.toHaveBeenCalled();
  });

  it('寶石的預覽框可以改等級與品質下限並存回', async () => {
    const base = sampleBuild();
    const [equip, gems] = base.groups;
    const gem = { ...gems.rows[0], gemLevelMin: 20, gemQualityMin: 20 };
    buildsRef.value = [{ ...base, groups: [equip, { ...gems, rows: [gem] }] }];
    await mount();
    const gemRow = queryAll('[data-pob-build-row]').find((el) =>
      el.textContent?.includes('Punishment'),
    )!;
    gemRow.querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();
    const level = queryBody<HTMLInputElement>('[data-pob-build-gem-level]')!;
    expect(level.value).toBe('20');
    level.value = '1';
    level.dispatchEvent(new Event('change'));
    await flushAsync();
    const quality = queryBody<HTMLInputElement>('[data-pob-build-gem-quality]')!;
    quality.value = '';
    quality.dispatchEvent(new Event('change'));
    await flushAsync();
    queryBody<HTMLButtonElement>('[data-pob-build-save-selection]')!.click();
    expect(fake.saveSelection).toHaveBeenCalledWith('b1', 'k-gem', {
      gemLevel: 1,
      gemQuality: null,
    });
  });

  it('名稱按鈕上按空白鍵標記完成，Enter 仍是搜尋', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    const button = row(1).querySelector<HTMLButtonElement>('[data-pob-build-search]')!;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(fake.toggleDone).toHaveBeenCalledWith('b1', 'k-rare');
    expect(fake.openSearch).not.toHaveBeenCalled();
  });

  const openMenu = async (index: number) => {
    const trigger = row(index).querySelector<HTMLElement>('[data-pob-build-more]')!;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushAsync(40);
  };
  const openBuildMenu = async () => {
    const trigger = query<HTMLElement>('[data-pob-build-menu]')!;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushAsync(40);
  };
  const clickMenuItem = async (selector: string) => {
    const item = queryBody<HTMLElement>(selector)!;
    expect(item).not.toBeNull();
    item.click();
    await flushAsync(40);
  };

  it('更多動作：送進主控台、線上搜尋開啟、存回目前頁面的搜尋', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    await openMenu(1);
    expect(queryBody('[data-pob-build-menu-reset]')).not.toBeNull();
    await clickMenuItem('[data-pob-build-send-console]');
    expect(fake.sendToLiveSearch).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
    );

    await openMenu(1);
    await clickMenuItem('[data-pob-build-open-live]');
    expect(fake.openLiveSearch).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
    );

    await openMenu(1);
    await clickMenuItem('[data-pob-build-save-current]');
    expect(fake.saveCurrentSearch).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
    );
  });

  it('無法搜尋的項目不能送主控台；未調整的項目沒有還原預設', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    await openMenu(2);
    expect(
      queryBody('[data-pob-build-send-console]')?.getAttribute('data-disabled'),
    ).not.toBeNull();
    expect(queryBody('[data-pob-build-menu-reset]')).toBeNull();
  });

  it('開啟選單時讀取書籤資料夾', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    await openMenu(1);
    expect(fake.listBookmarkFolders).toHaveBeenCalledTimes(1);
  });

  it('存回市集搜尋的項目在詞綴面板顯示說明', async () => {
    const build = sampleBuild();
    const [equipment, gems] = build.groups;
    buildsRef.value = [
      {
        ...build,
        groups: [
          {
            ...equipment,
            rows: equipment.rows.map((entry) =>
              entry.key === 'k-rare' ? { ...entry, searchOverride: true } : entry,
            ),
          },
          gems,
        ],
      },
    ];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();
    expect(queryBody('[data-pob-build-override-notice]')).not.toBeNull();
  });

  it('更新代碼開啟同一個對話框的更新模式，送出後交給 updateCode', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    await openBuildMenu();
    await clickMenuItem('[data-pob-build-update-code]');
    await flushAsync();

    expect(document.body.textContent).toContain('更新「RF 酋長」的 PoB 代碼');
    const input = queryBody<HTMLInputElement>('[data-pob-build-input]')!;
    input.value = 'NEW';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    const submit = queryBody<HTMLButtonElement>('[data-pob-build-import]')!;
    expect(submit.textContent?.trim()).toBe('更新');
    submit.click();
    await flushAsync();
    expect(fake.updateCode).toHaveBeenCalledWith('b1', 'NEW');
    expect(fake.importCode).not.toHaveBeenCalled();
    expect(queryBody('[data-pob-build-input]')).toBeNull();
  });

  it('項目顯示中文部位、寶石等級品質、物品圖片（沒有時為問號空圖）與已完成狀態', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    expect(row(0).textContent).toContain('副手');
    expect(row(0).getAttribute('data-done')).toBe('true');
    expect(row(0).querySelector<HTMLImageElement>('[data-pob-build-icon]')?.src).toBe(ICON);
    expect(row(1).textContent).toContain('手套');
    expect(row(1).querySelector('[data-pob-build-icon]')).toBeNull();
    expect(row(1).querySelector('[data-pob-build-icon-placeholder]')?.textContent).toBe('?');
    expect(row(0).querySelector('[data-pob-build-icon-placeholder]')).toBeNull();
    expect(row(3).textContent).toContain('Lv.20 / 20%');
  });

  it('點名稱在目前頁面搜尋，另有開新分頁按鈕；無法搜尋的項目停用', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    row(1).querySelector<HTMLButtonElement>('[data-pob-build-search]')!.click();
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
      'current',
    );
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-open-new-tab]')!.click();
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
      'new-tab',
    );

    expect(row(2).querySelector<HTMLButtonElement>('[data-pob-build-search]')?.disabled).toBe(true);
    expect(row(2).querySelector('[data-pob-build-open-new-tab]')).toBeNull();
  });

  it('勾選完成、移除項目、還原、切換套裝都交給狀態處理', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    row(1).querySelector<HTMLElement>('[data-pob-build-done]')!.click();
    expect(fake.toggleDone).toHaveBeenCalledWith('b1', 'k-rare');

    await openMenu(1);
    await clickMenuItem('[data-pob-build-remove]');
    expect(fake.removeEntry).toHaveBeenCalledWith('b1', 'k-rare');

    query<HTMLButtonElement>('[data-pob-build-restore-removed]')!.click();
    expect(fake.restoreRemoved).toHaveBeenCalledWith('b1');

    const trigger = query<HTMLElement>('[data-pob-build-item-set]')!;
    await chooseSelectOption(trigger, '2');
    expect(fake.selectItemSet).toHaveBeenCalledWith('b1', '2');
  });

  it('相同項目顯示數量，調整過搜尋條件的項目有標示', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    expect(row(1).querySelector('[data-pob-build-count]')?.textContent).toBe('×2');
    expect(row(0).querySelector('[data-pob-build-count]')).toBeNull();
    expect(row(1).querySelector('[data-pob-build-customized]')).not.toBeNull();
    expect(row(3).querySelector('[data-pob-build-customized]')).toBeNull();
  });

  it('開啟預覽 Popover 後暫存微調不立即存檔，有變更時顯示存回條件與還原，搜尋套用微調後條件', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    expect(queryBody('[data-pob-build-mods-popover]')).not.toBeNull();
    // 尚未微調時不顯示存回條件與放棄草稿，顯示已自訂的還原預設
    expect(queryBody('[data-pob-build-save-selection]')).toBeNull();
    expect(queryBody('[data-pob-build-discard-draft]')).toBeNull();
    expect(queryBody('[data-pob-build-reset-search]')).not.toBeNull();

    const toggles = queryAllBody('[data-pob-build-mods] [data-stat-toggle]') as HTMLElement[];
    // 工藝詞綴沒有市集代碼，不能勾選
    expect(toggles).toHaveLength(2);
    expect(toggles.map((toggle) => toggle.getAttribute('data-state'))).toEqual([
      'checked',
      'unchecked',
    ]);
    toggles[1].click();
    await nextTick();
    // 暫存模式不會直接觸發寫入
    expect(fake.setStatEnabled).not.toHaveBeenCalled();
    expect(fake.saveSelection).not.toHaveBeenCalled();
    expect(queryBody('[data-pob-build-save-selection]')?.textContent?.trim()).toBe('存回條件');
    expect(queryBody('[data-pob-build-discard-draft]')?.textContent?.trim()).toBe('還原');
    expect(queryBody('[data-pob-build-reset-search]')).toBeNull();

    const bounds = queryAllBody('[data-pob-build-mods] [data-stat-bound]') as HTMLInputElement[];
    bounds[0].value = '95';
    bounds[0].dispatchEvent(new Event('change'));
    await nextTick();

    const countMin = queryBody<HTMLInputElement>('[data-pob-build-count-min]')!;
    countMin.value = '2';
    countMin.dispatchEvent(new Event('change'));
    await nextTick();

    queryBody<HTMLElement>('[data-pob-build-pseudo]')!.click();
    await nextTick();

    // 以暫存草稿搜尋時會帶出微調後的 query
    queryBody<HTMLButtonElement>('[data-pob-build-popover-search]')!.click();
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({
        key: 'k-rare',
        pseudo: true,
        countMin: 2,
      }),
      'current',
    );
    expect(fake.saveSelection).not.toHaveBeenCalled();

    // 按下「還原」可放棄未存檔的微調，回到原本儲存狀態與「還原預設」按鈕
    queryBody<HTMLButtonElement>('[data-pob-build-discard-draft]')!.click();
    await nextTick();
    expect(queryBody('[data-pob-build-save-selection]')).toBeNull();
    expect(queryBody('[data-pob-build-reset-search]')).not.toBeNull();
    expect(
      (queryAllBody('[data-pob-build-mods] [data-stat-bound]')[0] as HTMLInputElement).value,
    ).toBe('80');

    // 重新微調並按下「存回條件」才真正寫回此項目
    bounds[0].value = '95';
    bounds[0].dispatchEvent(new Event('change'));
    await nextTick();
    queryBody<HTMLButtonElement>('[data-pob-build-save-selection]')!.click();
    await nextTick();
    expect(fake.saveSelection).toHaveBeenCalledWith('b1', 'k-rare', {
      stats: {
        'explicit.stat_life': { min: 95 },
        'explicit.stat_str_req': { enabled: false },
      },
      countMin: 1,
    });

    // 未微調且已自訂時可還原預設
    queryBody<HTMLButtonElement>('[data-pob-build-reset-search]')!.click();
    expect(fake.resetSearch).toHaveBeenCalledWith('b1', 'k-rare');

    queryBody<HTMLButtonElement>(
      '[data-pob-build-mods-popover] [data-test="preview-close"]',
    )!.click();
    await flushAsync();
    expect(queryBody('[data-pob-build-mods-popover]')).toBeNull();
  });

  it('PoB 五連以上的裝備在預覽顯示物品條件，可把連結改成不限並存回', async () => {
    const build = sampleBuild();
    const [equipment] = build.groups;
    const linked = { ...equipment.rows[1], links: 6, linksMin: 6 };
    buildsRef.value = [
      {
        ...build,
        groups: [{ ...equipment, rows: equipment.rows.map((r, i) => (i === 1 ? linked : r)) }],
      },
    ];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    expect(queryBody('[data-pob-build-item-filters]')).not.toBeNull();
    const option = (value: string) =>
      queryBody<HTMLElement>(`[data-pob-build-links-option="${value}"]`)!;
    expect(option('6').getAttribute('data-state')).toBe('on');
    expect(queryBody('[data-pob-build-item-filters]')?.textContent).toContain('PoB：6 連');

    option('any').click();
    await nextTick();
    expect(option('any').getAttribute('data-state')).toBe('on');
    queryBody<HTMLButtonElement>('[data-pob-build-save-selection]')!.click();
    await nextTick();
    expect(fake.saveSelection).toHaveBeenCalledWith(
      'b1',
      'k-rare',
      expect.objectContaining({ links: null }),
    );
  });

  it('沒有五連以上的裝備不顯示物品條件', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();
    expect(queryBody('[data-pob-build-mods-popover]')).not.toBeNull();
    expect(queryBody('[data-pob-build-item-filters]')).toBeNull();
  });

  it('有類別的稀有裝可在預覽改以類別＋防禦類型搜尋並存回', async () => {
    const build = sampleBuild();
    const [equipment] = build.groups;
    const gloves = {
      ...equipment.rows[1],
      category: {
        id: 'armour.gloves',
        defences: ['ar' as const, 'es' as const],
        defenceSection: 'armour_filters' as const,
      },
      searchBy: 'base' as const,
    };
    buildsRef.value = [
      {
        ...build,
        groups: [{ ...equipment, rows: equipment.rows.map((r, i) => (i === 1 ? gloves : r)) }],
      },
    ];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    expect(queryBody('[data-pob-build-item-filters]')).not.toBeNull();
    const option = (value: string) =>
      queryBody<HTMLElement>(`[data-pob-build-search-by-option="${value}"]`)!;
    expect(option('base').getAttribute('data-state')).toBe('on');
    expect(queryBody('[data-pob-build-category-hint]')).toBeNull();

    option('category').click();
    await nextTick();
    expect(option('category').getAttribute('data-state')).toBe('on');
    expect(queryBody('[data-pob-build-category-hint]')?.textContent?.trim()).toBe(
      '手套・護甲／能量護盾',
    );
    queryBody<HTMLButtonElement>('[data-pob-build-save-selection]')!.click();
    await nextTick();
    expect(fake.saveSelection).toHaveBeenCalledWith(
      'b1',
      'k-rare',
      expect.objectContaining({ searchBy: 'category' }),
    );
  });

  it('整體搜尋設定可把稀有裝改成類別搜尋', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    query<HTMLButtonElement>('[data-pob-build-search-settings]')!.click();
    await flushAsync();
    const option = (value: string) =>
      queryBody<HTMLElement>(`[data-pob-build-rare-search-option="${value}"]`)!;
    expect(option('base').getAttribute('data-state')).toBe('on');
    option('category').click();
    await nextTick();
    expect(fake.setSearchDefaults).toHaveBeenCalledWith('b1', { rareSearch: 'category' });
  });

  it('整體搜尋設定的防禦數值下限與預設總和開關交給狀態處理', async () => {
    buildsRef.value = [{ ...sampleBuild(), searchDefaults: { pseudo: true } }];
    await mount();
    query<HTMLButtonElement>('[data-pob-build-search-settings]')!.click();
    await flushAsync();
    const pseudo = queryBody<HTMLElement>('[data-pob-build-pseudo-default]')!;
    expect(pseudo.getAttribute('data-state')).toBe('checked');
    queryBody<HTMLElement>('[data-pob-build-defence-min]')!.click();
    await nextTick();
    expect(fake.setSearchDefaults).toHaveBeenLastCalledWith('b1', {
      pseudo: true,
      defenceMin: true,
    });
    pseudo.click();
    await nextTick();
    expect(fake.setSearchDefaults).toHaveBeenLastCalledWith('b1', { pseudo: false });
  });

  it('build 標題的整體搜尋設定改連結條件與數值比例時交給狀態處理', async () => {
    buildsRef.value = [{ ...sampleBuild(), searchDefaults: { statPercent: 70 } }];
    await mount();
    const trigger = query<HTMLButtonElement>('[data-pob-build-search-settings]')!;
    expect(trigger.classList.contains('text-primary')).toBe(true);
    trigger.click();
    await flushAsync();

    expect(queryBody('[data-pob-build-search-settings-panel]')).not.toBeNull();
    queryBody<HTMLElement>('[data-pob-build-link-policy-option="none"]')!.click();
    await nextTick();
    expect(fake.setSearchDefaults).toHaveBeenCalledWith('b1', { statPercent: 70, links: 'none' });

    queryBody<HTMLButtonElement>('[data-pob-build-search-settings-reset]')!.click();
    expect(fake.setSearchDefaults).toHaveBeenLastCalledWith('b1', {});
  });

  it('詞綴可同時改下限與上限；符合方式以下拉選單在且／計數之間切換', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    const bounds = () =>
      queryAllBody('[data-pob-build-mods] [data-stat-bound]') as HTMLInputElement[];
    // 生命（下限 80）與力量需求（上限 -8）各有下限與上限兩格
    expect(bounds().map((input) => [input.dataset.bound, input.value])).toEqual([
      ['min', '80'],
      ['max', ''],
      ['min', ''],
      ['max', '-8'],
    ]);
    bounds()[1].value = '150';
    bounds()[1].dispatchEvent(new Event('change'));
    await nextTick();

    const mode = () => queryBody<HTMLElement>('[data-pob-build-count-mode]')!;
    expect(mode().textContent).toContain('計數 (COUNT)');
    await chooseSelectOption(mode(), 'and');
    expect(mode().textContent).toContain('且 (AND)');
    expect(queryBody('[data-pob-build-count-min]')).toBeNull();
    // 選單在 Popover 外，選完 Popover 仍開著
    expect(queryBody('[data-pob-build-mods-popover]')).not.toBeNull();

    queryBody<HTMLButtonElement>('[data-pob-build-save-selection]')!.click();
    await nextTick();
    expect(fake.saveSelection).toHaveBeenCalledWith('b1', 'k-rare', {
      stats: {
        'explicit.stat_life': { max: 150 },
        'explicit.stat_str_req': { enabled: false },
      },
    });
  });

  it('可切換網域的詞綴標籤：點開選單直接選前綴，存回條件時以原代碼記住', async () => {
    const build = sampleBuild();
    const rare = build.groups[0].rows[1];
    const domains = ['explicit', 'fractured', 'crafted'];
    rare.mods = rare.mods!.map((mod) =>
      mod.stat?.id === 'explicit.stat_life' ? { ...mod, stat: { ...mod.stat, domains } } : mod,
    );
    rare.filters = rare.filters.map((filter) =>
      filter.key === 'explicit.stat_life' ? { ...filter, domains } : filter,
    );
    buildsRef.value = [build];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    const domainButton = () =>
      queryBody<HTMLButtonElement>('[data-pob-build-mods] [data-stat-domain-trigger]')!;
    const openMenu = async () => {
      domainButton().dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      domainButton().click();
      await flushAsync();
    };
    const options = () => queryAllBody('[data-stat-domain-option]') as HTMLElement[];

    // 一般詞綴可切換時也顯示標籤
    expect(domainButton().textContent?.trim()).toBe('隨機');
    await openMenu();
    expect(options().map((option) => option.textContent?.trim())).toEqual(['隨機', '破裂', '工藝']);
    // 直接選第三個，不必逐一切換（比照真實點擊：先 pointerdown 再 click）
    const choose = async (option: HTMLElement) => {
      option.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      option.click();
      await flushAsync();
    };
    await choose(options()[2]);
    await flushAsync();
    expect(domainButton().textContent?.trim()).toBe('工藝');
    expect(domainButton().dataset.statDomain).toBe('crafted');
    // 選完 Popover 仍開著
    expect(queryBody('[data-pob-build-mods-popover]')).not.toBeNull();

    queryBody<HTMLButtonElement>('[data-pob-build-popover-search]')!.click();
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({
        query: expect.objectContaining({
          stats: [
            expect.objectContaining({
              filters: [{ id: 'crafted.stat_life', value: { min: 80 } }],
            }),
          ],
        }),
      }),
      'current',
    );

    await openMenu();
    await choose(options()[1]);
    queryBody<HTMLButtonElement>('[data-pob-build-save-selection]')!.click();
    await nextTick();
    expect(fake.saveSelection).toHaveBeenCalledWith('b1', 'k-rare', {
      stats: {
        'explicit.stat_life': { domain: 'fractured' },
        'explicit.stat_str_req': { enabled: false },
      },
      countMin: 1,
    });
  });

  it('側欄在 Shadow DOM 裡時，從網域選單選完不會關閉 Popover', async () => {
    const build = sampleBuild();
    const rare = build.groups[0].rows[1];
    const domains = ['explicit', 'fractured', 'crafted'];
    rare.mods = rare.mods!.map((mod) =>
      mod.stat?.id === 'explicit.stat_life' ? { ...mod, stat: { ...mod.stat, domains } } : mod,
    );
    rare.filters = rare.filters.map((filter) =>
      filter.key === 'explicit.stat_life' ? { ...filter, domains } : filter,
    );
    buildsRef.value = [build];

    // 比照正式環境：側欄與 portal 都在同一個 shadow root 裡
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowContainer = document.createElement('div');
    const portal = document.createElement('div');
    shadow.append(shadowContainer, portal);
    app = createApp({
      render: () => h(ConfigProvider, { teleportTo: portal }, () => h(PobBuildPane)),
    });
    app.mount(shadowContainer);
    await flushAsync();
    try {
      const inShadow = <T extends Element = HTMLElement>(selector: string) =>
        shadow.querySelector<T>(selector);
      const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
      const press = async (target: HTMLElement) => {
        target.focus();
        target.dispatchEvent(
          new EventCtor('pointerdown', {
            bubbles: true,
            composed: true,
            cancelable: true,
            button: 0,
          }),
        );
        target.dispatchEvent(
          new EventCtor('pointerup', { bubbles: true, composed: true, cancelable: true }),
        );
        target.click();
        await flushAsync(40);
      };

      shadow
        .querySelectorAll<HTMLElement>('[data-pob-build-view-option="list"]')
        .forEach((option) => option.click());
      await flushAsync();
      const rows = Array.from(shadow.querySelectorAll<HTMLElement>('[data-pob-build-row]'));
      rows[1].querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
      await flushAsync(40);
      expect(inShadow('[data-pob-build-mods-popover]')).not.toBeNull();

      const trigger = () =>
        inShadow<HTMLButtonElement>('[data-pob-build-mods] [data-stat-domain-trigger]')!;
      await press(trigger());
      expect(shadow.querySelectorAll('[data-stat-domain-option]')).toHaveLength(3);

      // 再次點擊同一個網域標籤可收回選單，且外層 Popover 保持開啟
      await press(trigger());
      expect(shadow.querySelectorAll('[data-stat-domain-option]')).toHaveLength(0);
      expect(inShadow('[data-pob-build-mods-popover]')).not.toBeNull();

      // 重新點開並選擇項目
      await press(trigger());
      const options = Array.from(shadow.querySelectorAll<HTMLElement>('[data-stat-domain-option]'));
      expect(options).toHaveLength(3);
      await press(options[1]);
      await flushAsync(40);

      expect(inShadow('[data-pob-build-mods-popover]')).not.toBeNull();
      expect(
        inShadow('[data-pob-build-mods] [data-stat-domain-trigger]')?.textContent?.trim(),
      ).toBe('破裂');
    } finally {
      // app 由 afterEach 卸載
      host.remove();
    }
  });

  it('searchOverride 為 true 時禁用 Popover 內的詞綴勾選、數值輸入與條件模式', async () => {
    const build = sampleBuild();
    build.groups[0].rows[1].searchOverride = true;
    buildsRef.value = [build];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    expect(queryBody('[data-pob-build-override-notice]')).not.toBeNull();
    const toggles = queryAllBody('[data-pob-build-mods] [data-stat-toggle]');
    for (const toggle of toggles) expect(toggle.hasAttribute('disabled')).toBe(true);
    const bounds = queryAllBody('[data-pob-build-mods] [data-stat-bound]') as HTMLInputElement[];
    for (const bound of bounds) expect(bound.disabled).toBe(true);
    expect(queryBody('[data-pob-build-count-mode]')?.hasAttribute('disabled')).toBe(true);
    expect(queryBody<HTMLInputElement>('[data-pob-build-count-min]')?.disabled).toBe(true);
    expect(queryBody('[data-pob-build-pseudo]')?.hasAttribute('disabled')).toBe(true);
  });

  it('預覽 Popover 列出詞綴並標出有帶入搜尋條件的那幾行，再次點按鈕可關閉', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    expect(queryBody('[data-pob-build-mods]')).toBeNull();
    // 沒有詞綴的項目沒有預覽按鈕
    expect(row(0).querySelector('[data-pob-build-mods-toggle]')).toBeNull();

    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();
    const mods = queryAllBody('[data-pob-build-mods] .preview-stat-row');
    expect(mods.map((mod) => mod.getAttribute('data-mod-kind'))).toEqual([
      'implicit',
      'explicit',
      'explicit',
      'crafted',
    ]);
    expect(mods.map((mod) => mod.getAttribute('data-mod-searched'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    expect(mods[1].textContent).toContain('+100 to maximum Life');

    // 與書籤／歷史預覽共用 --pxd-stat-* 色票與官方網域標籤（explicit 不顯示徽章）
    expect((mods[0] as HTMLElement).style.getPropertyValue('--pxd-stat-color')).toBe(
      'var(--pxd-stat-implicit)',
    );
    expect(mods[0].querySelector('[data-stat-domain="implicit"]')?.textContent?.trim()).toBe(
      '固定',
    );
    expect(mods[1].querySelector('[data-stat-domain]')).toBeNull();
    expect(mods[1].querySelector('.stat-name')?.className).toContain('text-foreground');
    expect((mods[3] as HTMLElement).style.getPropertyValue('--pxd-stat-color')).toBe(
      'var(--pxd-stat-crafted)',
    );
    expect(mods[3].querySelector('[data-stat-domain="crafted"]')?.textContent?.trim()).toBe('工藝');

    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();
    expect(queryBody('[data-pob-build-mods-popover]')).toBeNull();
  });

  it('build 可收合、全部展開/收合、搜尋過濾、改名，刪除使用 poexdConfirm 確認', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    query<HTMLButtonElement>('[data-pob-build-toggle]')!.click();
    expect(fake.toggleCollapsed).toHaveBeenCalledWith('b1');

    query<HTMLButtonElement>('[data-pob-build-expand-all]')!.click();
    expect(fake.toggleCollapsed).toHaveBeenCalledTimes(2);

    query<HTMLButtonElement>('[data-pob-build-search-toggle]')!.click();
    await nextTick();
    const filterInput = query<HTMLInputElement>('[data-pob-build-filter]')!;
    filterInput.value = 'Punishment';
    filterInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 180));
    await nextTick();
    expect(queryAll('[data-pob-build-row]')).toHaveLength(1);
    expect(row(0).textContent).toContain('Punishment');

    filterInput.value = '';
    filterInput.dispatchEvent(new Event('input'));
    await nextTick();

    await openBuildMenu();
    await clickMenuItem('[data-pob-build-rename]');
    await nextTick();
    const input = query<HTMLInputElement>('[data-pob-build-rename-input]')!;
    expect(input.value).toBe('RF 酋長');
    input.value = '新名稱';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await nextTick();
    expect(fake.rename).toHaveBeenCalledWith('b1', '新名稱');
    expect(query('[data-pob-build-rename-input]')).toBeNull();

    confirmSpy.mockResolvedValueOnce(false);
    await openBuildMenu();
    await clickMenuItem('[data-pob-build-delete]');
    await flushAsync();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(fake.removeBuild).not.toHaveBeenCalled();

    confirmSpy.mockResolvedValueOnce(true);
    await openBuildMenu();
    await clickMenuItem('[data-pob-build-delete]');
    await flushAsync();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(fake.removeBuild).toHaveBeenCalledWith('b1');
  });

  it('收合的 build 只顯示標題列', async () => {
    buildsRef.value = [{ ...sampleBuild(), collapsed: true }];
    await mount();
    expect(query('[data-pob-build-name]')).not.toBeNull();
    expect(queryAll('[data-pob-build-row]')).toHaveLength(0);
    expect(query('[data-pob-build-item-set]')).toBeNull();
  });

  it('顯示錯誤訊息；卸載時停止等待圖片', async () => {
    errorKey.value = 'pobBuild.error.noLeague';
    await mount();
    expect(query('[data-pob-build-error]')?.textContent).toContain('聯盟');

    app.unmount();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    app = createApp({ render: () => null });
    app.mount(container);
  });

  it('對齊書籤與歷史點擊格式：preview 模式左鍵展開預覽、右鍵頭前往搜尋；沒有詞綴的項目直接前往搜尋', async () => {
    prefState.searchEntryClickAction = 'preview';
    buildsRef.value = [sampleBuild()];
    await mount();

    // 有詞綴的項目左鍵點名稱展開預覽，hover 顯示前往搜尋按鈕而非預覽按鈕
    const rareLink = row(1).querySelector<HTMLAnchorElement>('[data-pob-build-search]')!;
    expect(rareLink.tagName).toBe('A');
    expect(rareLink.getAttribute('href')).toBe(
      'https://www.pathofexile.com/trade/search/Covens?q=test',
    );
    expect(row(1).querySelector('[data-pob-build-mods-toggle]')).toBeNull();
    const goBtn = row(1).querySelector<HTMLButtonElement>('[data-pob-build-open]')!;
    expect(goBtn).not.toBeNull();

    rareLink.click();
    await flushAsync();
    expect(fake.openSearch).not.toHaveBeenCalled();
    expect(queryBody('[data-pob-build-mods-popover]')).not.toBeNull();

    // 再點一次關閉預覽
    rareLink.click();
    await flushAsync();
    expect(queryBody('[data-pob-build-mods-popover]')).toBeNull();

    // 點 hover 的前往搜尋鈕直接前往目前頁面
    goBtn.click();
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
      'current',
    );

    // 沒有詞綴且無存回搜尋的項目在 preview 模式左鍵仍直接搜尋
    const uniqueLink = row(0).querySelector<HTMLAnchorElement>('[data-pob-build-search]')!;
    uniqueLink.click();
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-unique' }),
      'current',
    );
  });

  it('購物車可搜尋項目使用 <a href> 支援中鍵原生開新分頁與 Ctrl+點擊開新分頁，無網址時中鍵仍走 openSearch', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    const rareLink = row(1).querySelector<HTMLAnchorElement>('[data-pob-build-search]')!;
    expect(rareLink.tagName).toBe('A');
    expect(rareLink.getAttribute('href')).toBe(
      'https://www.pathofexile.com/trade/search/Covens?q=test',
    );

    // 中鍵點擊：有 href 時由瀏覽器原生開分頁，不重複呼叫 openSearch
    rareLink.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(fake.openSearch).not.toHaveBeenCalled();

    // Ctrl+左鍵開新分頁
    rareLink.dispatchEvent(
      new MouseEvent('click', { button: 0, ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
      'new-tab',
    );

    // 若頁面無聯盟導致 href 無法組成，中鍵回退呼叫 openSearch('new-tab') 觸發無聯盟提示
    fake.resolveSearchUrl.mockReturnValueOnce(undefined);
    rareLink.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(fake.openSearch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
      'new-tab',
    );
  });

  it('顯示分組進度；點擊分組標題可收合／展開，搜尋時自動展開', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    expect(query('[data-pob-build-progress-bar]')).toBeNull();

    const groupCounts = queryAll('[data-pob-build-group-count]').map((el) =>
      el.textContent?.trim(),
    );
    expect(groupCounts).toEqual(['1/3', '1']);

    // 點擊裝備分組標題收合，僅剩寶石分組的 1 列
    const toggles = queryAll('[data-pob-build-group-toggle]') as HTMLElement[];
    expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
    toggles[0].click();
    await nextTick();
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
    expect(queryAll('[data-pob-build-row]')).toHaveLength(1);

    // 展開搜尋並篩選裝備名稱時，已收合的分組會自動展開顯示結果
    query<HTMLButtonElement>('[data-pob-build-search-toggle]')!.click();
    await nextTick();
    const filterInput = query<HTMLInputElement>('[data-pob-build-filter]')!;
    filterInput.value = 'Leviathan';
    filterInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 180));
    await nextTick();
    expect(queryAll('[data-pob-build-row]')).toHaveLength(1);
    expect(row(0).textContent).toContain('Leviathan Gauntlets');
  });

  it('快速分類篩選可依裝備／藥劑／珠寶／寶石切換', async () => {
    const base = sampleBuild();
    const equipGroup = base.groups[0];
    buildsRef.value = [
      {
        ...base,
        groups: [
          {
            ...equipGroup,
            rows: [
              ...equipGroup.rows,
              {
                ...equipGroup.rows[0],
                key: 'k-flask',
                label: 'Quicksilver Flask',
                englishName: 'Quicksilver Flask',
                slot: 'Flask 1',
                done: false,
              },
              {
                ...equipGroup.rows[0],
                key: 'k-jewel',
                label: 'Watcher Eye',
                englishName: 'Watcher Eye',
                slot: 'Jewel 1',
                done: false,
              },
            ],
          },
          base.groups[1],
        ],
      },
    ];
    await mount();

    const cats = queryAll('[data-pob-build-category]').map((el) =>
      el.getAttribute('data-pob-build-category'),
    );
    expect(cats).toEqual(['all', 'gear', 'flask', 'jewel', 'gem']);

    query<HTMLButtonElement>('[data-pob-build-category="flask"]')!.click();
    await nextTick();
    expect(queryAll('[data-pob-build-row]')).toHaveLength(1);
    expect(row(0).textContent).toContain('Quicksilver Flask');

    query<HTMLButtonElement>('[data-pob-build-category="jewel"]')!.click();
    await nextTick();
    expect(queryAll('[data-pob-build-row]')).toHaveLength(1);
    expect(row(0).textContent).toContain('Watcher Eye');

    query<HTMLButtonElement>('[data-pob-build-category="gem"]')!.click();
    await nextTick();
    expect(queryAll('[data-pob-build-row]')).toHaveLength(1);
    expect(row(0).textContent).toContain('Punishment');
  });

  it('預設為裝備欄檢視：裝備依部位放進格子，寶石仍是清單，滑鼠移入格子開啟預覽；可切回清單', async () => {
    buildsRef.value = [sampleBuild()];
    await mount({ view: 'gear' });
    const option = (value: string) =>
      query<HTMLElement>(`[data-pob-build-view-option="${value}"]`)!;
    expect(option('gear').getAttribute('data-state')).toBe('on');
    expect(query('[data-pob-build-gear]')).not.toBeNull();
    expect(query('[data-pob-build-category-filter]')).toBeNull();
    const tiles = queryAll('[data-pob-build-gear-tile]').map((el) =>
      el.getAttribute('data-pob-build-gear-tile'),
    );
    expect(tiles).toEqual(['helmet', 'weapon2', 'gloves']);
    expect(query('[data-pob-build-gear-empty="weapon1"]')).not.toBeNull();
    // 第三戒指只有裝了才佔格子
    expect(query('[data-pob-build-gear-empty="ring3"]')).toBeNull();
    // 裝備不再以清單列出，只剩寶石
    expect(queryAll('[data-pob-build-row]').map((el) => el.textContent)).toEqual([
      expect.stringContaining('Punishment'),
    ]);

    vi.useFakeTimers();
    try {
      const gloves = query<HTMLButtonElement>('[data-pob-build-gear-tile="gloves"]')!;
      gloves.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(300);
      await nextTick();
      expect(gloves.getAttribute('aria-pressed')).toBe('true');
      // 沒進入預覽框就移出時關閉
      gloves.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(600);
      await nextTick();
      expect(gloves.getAttribute('aria-pressed')).toBe('false');
      gloves.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(300);
    } finally {
      vi.useRealTimers();
    }
    await flushAsync();
    expect(queryBody('[data-pob-build-mods]')).not.toBeNull();

    // 點擊格子開關預覽，不直接搜尋；Ctrl 點擊開新分頁搜尋
    const glovesTile = query<HTMLButtonElement>('[data-pob-build-gear-tile="gloves"]')!;
    glovesTile.click();
    await nextTick();
    expect(glovesTile.getAttribute('aria-pressed')).toBe('false');
    glovesTile.click();
    await nextTick();
    expect(glovesTile.getAttribute('aria-pressed')).toBe('true');
    expect(fake.openSearch).not.toHaveBeenCalled();
    glovesTile.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(fake.openSearch).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-rare' }),
      'new-tab',
    );

    query<HTMLElement>('[data-pob-build-gear-tile="gloves"] [data-pob-build-gear-done]')!.click();
    expect(fake.toggleDone).toHaveBeenCalledWith('b1', 'k-rare');

    // 有插槽的裝備畫出插槽（滑過時顯示）
    expect(
      query('[data-pob-build-gear-tile="gloves"] [data-pob-build-sockets]')?.getAttribute(
        'data-socket-count',
      ),
    ).toBe('4');

    query<HTMLButtonElement>('[data-pob-build-gear-tile="weapon2"]')!.click();
    expect(fake.openSearch).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ key: 'k-unique' }),
      'current',
    );
    // 切回清單後裝備以列顯示
    option('list').click();
    await nextTick();
    expect(query('[data-pob-build-gear]')).toBeNull();
    expect(queryAll('[data-pob-build-row]').length).toBeGreaterThan(1);
  });

  it('藥劑、寶石的三格 sprite 疊成一張圖', async () => {
    const base = sampleBuild();
    buildsRef.value = [
      {
        ...base,
        groups: [
          {
            ...base.groups[0],
            rows: [
              {
                ...base.groups[0].rows[1],
                key: 'k-flask',
                slot: 'Flask 1',
                icon: 'https://web.poecdn.com/image/Art/2DItems/Flasks/sprint.png',
                iconSize: { width: 1, height: 2 },
                iconLayers: [1, 2, 0],
              },
            ],
          },
          base.groups[1],
        ],
      },
    ];
    await mount({ view: 'gear' });
    const sprite = query('[data-pob-build-gear-tile="flask"] [data-pob-item-sprite]')!;
    expect(
      Array.from(sprite.querySelectorAll('[data-sprite-frame]')).map((el) =>
        el.getAttribute('data-sprite-frame'),
      ),
    ).toEqual(['1', '2', '0']);
    const liquid = sprite.querySelector('[data-sprite-frame="2"]') as HTMLImageElement;
    expect(liquid.style.left).toBe('-200%');
    expect(liquid.style.width).toBe('300%');
    expect(liquid.getAttribute('referrerpolicy')).toBe('no-referrer');

    // 載入後發現是單張圖（寬高比不到三格）時改為直接顯示整張圖
    const shell = sprite.querySelector('[data-sprite-frame="1"]') as HTMLImageElement;
    Object.defineProperty(shell, 'naturalWidth', { value: 78 });
    Object.defineProperty(shell, 'naturalHeight', { value: 156 });
    shell.dispatchEvent(new Event('load'));
    await nextTick();
    const tile = query('[data-pob-build-gear-tile="flask"]')!;
    expect(tile.querySelector('[data-pob-item-sprite]')).toBeNull();
    expect(tile.querySelector('img')?.getAttribute('src')).toContain('Flasks/sprint');
  });

  it('詞綴 Popover 支援一鍵放寬 -10%、清除數值，且關閉再開啟時保留未儲存草稿', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    const bounds = () =>
      queryAllBody('[data-pob-build-mods] [data-stat-bound]') as HTMLInputElement[];

    // 點擊 -10%：已勾選的生命下限 80 → 72；未勾選的力量需求維持 -8 不受影響
    queryBody<HTMLButtonElement>('[data-pob-build-relax-bounds]')!.click();
    await nextTick();
    expect(bounds()[0].value).toBe('72');
    expect(bounds()[3].value).toBe('-8');
    expect(queryBody('[data-pob-build-save-selection]')).not.toBeNull();

    // 關閉 Popover 後重新開啟同一項，未儲存草稿仍保留
    queryBody<HTMLButtonElement>(
      '[data-pob-build-mods-popover] [data-test="preview-close"]',
    )!.click();
    await flushAsync();
    expect(queryBody('[data-pob-build-mods-popover]')).toBeNull();

    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();
    expect(bounds()[0].value).toBe('72');
    expect(bounds()[3].value).toBe('-8');
    expect(queryBody('[data-pob-build-save-selection]')).not.toBeNull();

    // 點擊「清除數值」清空已勾選詞綴的上下限（未勾選詞綴維持原值）
    queryBody<HTMLButtonElement>('[data-pob-build-clear-bounds]')!.click();
    await nextTick();
    expect(bounds()[0].value).toBe('');
    expect(bounds()[1].value).toBe('');
    expect(bounds()[3].value).toBe('-8');

    // 按下「還原」清空草稿，重開後回到原始狀態
    queryBody<HTMLButtonElement>('[data-pob-build-discard-draft]')!.click();
    await nextTick();
    expect(bounds()[0].value).toBe('80');
  });

  it('上下限相同的精確鎖定條件（如種子碼、星團天賦數）不顯示 -10% 放寬按鈕', async () => {
    const lockedBuild = sampleBuild();
    const rareRow = lockedBuild.groups[0].rows[1];
    rareRow.filters = [
      {
        key: 'explicit.seed',
        id: 'explicit.seed',
        value: 11057,
        min: 11057,
        max: 11057,
        enabled: true,
        customized: false,
      },
    ];
    buildsRef.value = [lockedBuild];
    await mount();
    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await flushAsync();

    expect(queryBody('[data-pob-build-relax-bounds]')).toBeNull();
    expect(queryBody('[data-pob-build-clear-bounds]')).not.toBeNull();
  });
});
