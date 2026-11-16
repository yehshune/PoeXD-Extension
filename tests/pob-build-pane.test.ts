// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, nextTick, ref, type App, type Component } from 'vue';
import type { BuildView, UsePobBuild } from '@/components/sidebar/pob-build/usePobBuild';
import { resetI18nStateForTests } from '@/utils/i18n';

vi.mock('@/utils/trade-context', () => ({ getPoeVersion: () => 'poe1' }));

const buildsRef = ref<BuildView[]>([]);
const errorKey = ref<UsePobBuild['errorKey']['value']>(null);
const fake = {
  builds: computed(() => buildsRef.value),
  errorKey,
  isBusy: ref(false),
  restore: vi.fn(async () => undefined),
  importCode: vi.fn(async () => true),
  rename: vi.fn(),
  removeBuild: vi.fn(),
  toggleCollapsed: vi.fn(),
  selectItemSet: vi.fn(),
  selectSkillSet: vi.fn(),
  toggleDone: vi.fn(),
  removeEntry: vi.fn(),
  restoreRemoved: vi.fn(),
  openSearch: vi.fn(() => true),
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
      kind: 'unique',
      rows: [
        {
          key: 'k-unique',
          kind: 'unique',
          label: 'Rise of the Phoenix',
          englishName: 'Rise of the Phoenix',
          slot: 'Weapon 2',
          rarity: 'UNIQUE',
          mods: [],
          query: { type: 'x' },
          done: true,
          icon: ICON,
        },
      ],
    },
    {
      kind: 'equipment',
      rows: [
        {
          key: 'k-rare',
          kind: 'equipment',
          label: 'Leviathan Gauntlets',
          englishName: 'Leviathan Gauntlets',
          slot: 'Gloves',
          rarity: 'RARE',
          mods: [
            { text: '+7% to Fire Damage over Time Multiplier', kind: 'implicit', searched: false },
            { text: '+100 to maximum Life', kind: 'explicit', searched: true },
            { text: '12% increased Area of Effect', kind: 'crafted', searched: false },
          ],
          query: { type: 'y' },
          done: false,
        },
        {
          key: 'k-none',
          kind: 'equipment',
          label: 'Mystery Base',
          englishName: 'Mystery Base',
          slot: 'Helmet',
          rarity: 'RARE',
          mods: [],
          query: null,
          done: false,
        },
      ],
    },
    {
      kind: 'gem',
      rows: [
        {
          key: 'k-gem',
          kind: 'gem',
          label: 'Punishment',
          englishName: 'Punishment',
          level: 20,
          quality: 20,
          query: { type: 'z' },
          done: false,
        },
      ],
    },
  ],
  progress: { done: 1, total: 4 },
  removedCount: 2,
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

  const mount = async () => {
    app = createApp(PobBuildPane);
    app.mount(container);
    await nextTick();
  };
  const query = <T extends Element = HTMLElement>(selector: string) =>
    container.querySelector<T>(selector);
  const queryBody = <T extends Element = HTMLElement>(selector: string) =>
    document.body.querySelector<T>(selector);
  const queryAll = (selector: string) => Array.from(container.querySelectorAll(selector));
  const row = (index: number) => queryAll('[data-pob-build-row]')[index] as HTMLElement;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
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
    expect(query('[data-pob-build-empty-state]')).not.toBeNull();
    expect(query('[data-pob-build-add]')).not.toBeNull();
    expect(queryBody('[data-pob-build-input]')).toBeNull();
  });

  it('打開匯入對話框後貼上代碼可匯入，成功後關閉對話框並清空欄位', async () => {
    await mount();
    query<HTMLButtonElement>('[data-pob-build-add]')!.click();
    await flushAsync();

    const input = queryBody<HTMLTextAreaElement>('[data-pob-build-input]')!;
    expect(input).not.toBeNull();
    expect(queryBody<HTMLButtonElement>('[data-pob-build-import]')?.disabled).toBe(true);

    input.value = 'CODE';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    queryBody<HTMLButtonElement>('[data-pob-build-import]')!.click();
    await flushAsync();
    expect(fake.importCode).toHaveBeenCalledWith('CODE');
    expect(queryBody('[data-pob-build-input]')).toBeNull();
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
    ).toEqual(['unique', 'equipment', 'gem']);
    expect(queryAll('[data-pob-build-row]')).toHaveLength(4);
  });

  it('項目顯示中文部位、寶石等級品質、擷取到的圖片與已完成狀態', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();

    expect(row(0).textContent).toContain('副手');
    expect(row(0).getAttribute('data-done')).toBe('true');
    expect(row(0).querySelector<HTMLImageElement>('[data-pob-build-icon]')?.src).toBe(ICON);
    expect(row(1).textContent).toContain('手套');
    expect(row(1).querySelector('[data-pob-build-icon]')).toBeNull();
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

    row(1).querySelector<HTMLButtonElement>('[data-pob-build-remove]')!.click();
    expect(fake.removeEntry).toHaveBeenCalledWith('b1', 'k-rare');

    query<HTMLButtonElement>('[data-pob-build-restore-removed]')!.click();
    expect(fake.restoreRemoved).toHaveBeenCalledWith('b1');

    const trigger = query<HTMLElement>('[data-pob-build-item-set]')!;
    await chooseSelectOption(trigger, '2');
    expect(fake.selectItemSet).toHaveBeenCalledWith('b1', '2');
  });

  it('展開後列出詞綴，標出有帶入搜尋條件的那幾行', async () => {
    buildsRef.value = [sampleBuild()];
    await mount();
    expect(query('[data-pob-build-mods]')).toBeNull();
    // 沒有詞綴的項目沒有展開按鈕
    expect(row(0).querySelector('[data-pob-build-mods-toggle]')).toBeNull();

    row(1).querySelector<HTMLButtonElement>('[data-pob-build-mods-toggle]')!.click();
    await nextTick();
    const mods = queryAll('[data-pob-build-mods] li');
    expect(mods.map((mod) => mod.getAttribute('data-mod-kind'))).toEqual([
      'implicit',
      'explicit',
      'crafted',
    ]);
    expect(mods.map((mod) => mod.getAttribute('data-mod-searched'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(mods[1].textContent).toContain('+100 to maximum Life');
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
    await nextTick();
    expect(queryAll('[data-pob-build-row]')).toHaveLength(1);
    expect(row(0).textContent).toContain('Punishment');

    filterInput.value = '';
    filterInput.dispatchEvent(new Event('input'));
    await nextTick();

    query<HTMLButtonElement>('[data-pob-build-rename]')!.click();
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
    query<HTMLButtonElement>('[data-pob-build-delete]')!.click();
    await flushAsync();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(fake.removeBuild).not.toHaveBeenCalled();

    confirmSpy.mockResolvedValueOnce(true);
    query<HTMLButtonElement>('[data-pob-build-delete]')!.click();
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
});
