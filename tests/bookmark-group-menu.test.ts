// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { readBookmarkNodeSource } from './helpers/bookmark-node-source';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import type { TradeLeague } from '@/utils/trade-leagues';

const source = readBookmarkNodeSource();
const paneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn(), option: vi.fn() })),
  },
}));

const mockTradeLeagues: TradeLeague[] = [
  { id: 'Standard', text: '標準模式' },
  { id: 'Settlers', text: '卡爾葛墾荒者' },
];

vi.mock('@/utils/trade-leagues', () => ({
  fetchTradeLeagues: vi.fn(async () => mockTradeLeagues),
}));

const mockBookmarkCollection = {
  bookmarks: [
    {
      id: 'bm-1',
      title: '崇高石',
      url: 'https://www.pathofexile.com/trade/search/Standard/exalt',
      groupId: 'group-1',
    },
    {
      id: 'bm-2',
      title: '神聖石',
      url: 'https://www.pathofexile.com/trade/search/Standard/divine',
      groupId: 'group-2',
    },
  ],
  groups: [
    { id: 'group-1', name: '通貨', order: 0 },
    { id: 'group-2', name: '裝備', order: 1 },
    { id: 'group-3', name: '武器', parentId: 'group-2', order: 0 },
    { id: 'group-4', name: '弓', parentId: 'group-3', order: 0 },
    { id: 'group-5', name: '地圖', order: 2 },
  ],
};

const exportTransferSpy = vi.fn(async ({ scope, groupId }: any) => ({
  ok: true,
  value: {
    kind: 'poexd-bookmarks',
    schemaVersion: 2,
    gameVersion: 'poe1',
    scope,
    folders: [{ id: groupId, name: '通貨', bookmarks: [] }],
  },
}));

const replaceLeagueSpy = vi.fn(async () => ({ ok: true }));
const saveCollectionSpy = vi.fn(async () => ({ ok: true }));
const moveFolderSpy = vi.fn(async () => ({ ok: true }));
const deleteGroupSpy = vi.fn(async () => ({ ok: true }));

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: mockBookmarkCollection })),
    putGroup: vi.fn(async () => ({ ok: true })),
    deleteGroup: deleteGroupSpy,
    moveFolder: moveFolderSpy,
    reorderGroups: vi.fn(async () => ({ ok: true })),
    putBookmark: vi.fn(async () => ({ ok: true })),
    deleteBookmark: vi.fn(async () => ({ ok: true })),
    reorderBookmarks: vi.fn(async () => ({ ok: true })),
    exportTransfer: exportTransferSpy,
    importTransfer: vi.fn(async () => ({ ok: true })),
    replaceLeague: replaceLeagueSpy,
    subscribe: vi.fn(() => () => {}),
  }),
}));

const mockChromeStorageData: Record<string, any> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[]) => {
        if (!keys) return { ...mockChromeStorageData };
        if (typeof keys === 'string') return { [keys]: mockChromeStorageData[keys] };
        return (keys as string[]).reduce(
          (acc, k) => {
            acc[k] = mockChromeStorageData[k];
            return acc;
          },
          {} as Record<string, any>,
        );
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(mockChromeStorageData, items);
      }),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(async () => [{ title: 'Test Tab', url: 'https://www.pathofexile.com/trade' }]),
  },
  runtime: {
    getURL: vi.fn((path: string) => path),
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

const poexdAlertSpy = vi.fn();
const poexdConfirmSpy = vi.fn(async () => true);
(window as any).poexdAlert = poexdAlertSpy;
(window as any).poexdConfirm = poexdConfirmSpy;

describe('Group Menu (Static Contracts)', () => {
  it('uses shadcn / Reka Dropdown primitives with controlled state in Group Menu', () => {
    expect(source).toContain('v-model:open="isGroupMenuOpen"');
    expect(source).toContain('<DropdownMenuTrigger as-child>');
    expect(source).toContain('<DropdownMenuContent');
    expect(source).toContain('分享此資料夾');
    expect(source).toContain('重新命名');
    expect(source).toContain('替換此資料夾聯盟');
    expect(source).toContain('移動到資料夾...');
    expect(source).toContain('FolderPlus');
    expect(source).toContain('FolderInput');
    expect(source).toContain('DropdownMenuSeparator');
    expect(source).not.toContain('z-[10000000]');
    expect(source).not.toContain('z-[10000001]');
  });

  it('unifies visual language across collection menu with Lucide icons and separators', () => {
    expect(paneSource).toContain('匯入書籤…');
    expect(paneSource).toContain('複製分享碼');
    expect(paneSource).toContain('下載備份檔');
    expect(paneSource).not.toContain('貼上分享碼');
    expect(paneSource).not.toContain('匯入JSON');
    expect(paneSource).not.toContain('匯出JSON');
    expect(paneSource).toContain('替換全部書籤聯盟');
    expect(paneSource).toContain('<Upload class="text-muted-foreground" />');
    expect(paneSource).toContain('<Copy class="text-muted-foreground" />');
    expect(paneSource).toContain('<Download class="text-muted-foreground" />');
    expect(paneSource).toContain('<RefreshCw class="text-muted-foreground" />');
    expect(paneSource).toContain('<DropdownMenuSeparator />');
  });

  it('removes legacy group dropdown, openLeagueSubmenu, and manual league positioning', () => {
    expect(source).not.toContain('toggleGroupMenu');
    expect(source).not.toContain('openLeagueSubmenu');
    expect(source).not.toContain('leagueSubmenuStyle');
    expect(source).not.toContain('.league-submenu');
    expect(source).not.toContain('.league-replace-item');
    expect(source).not.toContain('.group-header-row:has(.poe-dropdown-menu)');
    expect(paneSource).not.toContain('toggleGroupMenu');
  });

  it('migrates Bookmark menu to controlled Dropdown primitives', () => {
    expect(source).toContain(':open="isMenuOpen"');
    expect(source).toContain('@update:open="(open) => ctx.setBookmarkMenuOpen(bm.id, open)"');
    expect(source).not.toContain('class="poe-dropdown-menu bookmark-menu"');
    expect(source).not.toContain('toggleBookmarkMenu');
    expect(source).toContain('在新分頁開啟');
    expect(source).toContain('使用線上搜尋開啟');
    expect(source).toContain('移動到資料夾');
    expect(source).toContain('更換封面');
  });

  it('retains generic Dropdown primitive floating z-index token while consumer specifies high z-index', () => {
    const contentSource = readFileSync(
      'components/ui/dropdown-menu/DropdownMenuContent.vue',
      'utf8',
    );
    const subContentSource = readFileSync(
      'components/ui/dropdown-menu/DropdownMenuSubContent.vue',
      'utf8',
    );
    expect(contentSource).toContain('z-(--pxd-z-floating)');
    expect(contentSource).not.toContain('z-[10000000]');
    expect(subContentSource).toContain('z-(--pxd-z-floating)');
    expect(subContentSource).not.toContain('z-[10000001]');
  });
});

describe('Group Menu (Runtime & Shadow Root Portal Isolation)', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    poexdAlertSpy.mockClear();
    poexdConfirmSpy.mockClear();
    exportTransferSpy.mockClear();
    replaceLeagueSpy.mockClear();
    saveCollectionSpy.mockClear();
    moveFolderSpy.mockClear();
    deleteGroupSpy.mockClear();

    host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    shadowRoot.appendChild(appRoot);
    shadowRoot.appendChild(portalRoot);

    const WrapperComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [h(BookmarkPane)]);
      },
    });

    app = createApp(WrapperComponent);
    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));
    await nextTick();
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  const getGroupContainers = () =>
    Array.from(appRoot.querySelectorAll<HTMLElement>('.group-container'));

  const getGroupTrigger = (groupContainer: HTMLElement) =>
    groupContainer.querySelector<HTMLButtonElement>('.group-actions button[title="操作選單"]');

  const openGroupMenu = async (groupContainer: HTMLElement) => {
    const trigger = getGroupTrigger(groupContainer);
    expect(trigger).not.toBeNull();
    trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    return portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
  };

  it('A. teleports Group Menu into shadowRoot portalRoot and keeps group container and document.body clean', async () => {
    const containers = getGroupContainers();
    expect(containers.length).toBeGreaterThanOrEqual(2);

    const group1 = containers[0];
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    const menuContent = await openGroupMenu(group1);
    expect(menuContent).not.toBeNull();
    expect(menuContent?.className).toContain('z-(--pxd-z-floating)');
    expect(menuContent?.className).not.toContain('z-[10000000]');

    // Assert it is inside portalRoot and NOT inside group-container
    expect(group1.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    // Assert document.body outside Shadow host has no dropdown-menu-content
    const bodyContent = Array.from(document.body.children).filter(
      (el) => el !== host && el.querySelector('[data-slot="dropdown-menu-content"]'),
    );
    expect(bodyContent).toHaveLength(0);
  });

  it('B. prevents accordion collapse/expand toggle when clicking menu trigger button', async () => {
    const containers = getGroupContainers();
    const group1 = containers[0];
    const headerRow = group1.querySelector<HTMLElement>('.group-header-row');
    expect(headerRow).not.toBeNull();

    // Initial state: not collapsed
    expect(headerRow?.classList.contains('collapsed')).toBe(false);

    // Clicking the trigger button must stop propagation and NOT toggle collapse
    await openGroupMenu(group1);

    expect(headerRow?.classList.contains('collapsed')).toBe(false);
  });

  it('C. executes group actions: copy folder transfer, rename group, and confirm delete group', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const containers = getGroupContainers();
    const group1 = containers[0];

    // 1. 分享此資料夾
    let menuContent = await openGroupMenu(group1);
    const shareItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('分享此資料夾'));
    expect(shareItem).toBeDefined();

    shareItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(exportTransferSpy).toHaveBeenCalledWith('folder', 'group-1');

    // 2. 重新命名
    menuContent = await openGroupMenu(group1);
    const renameItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('重新命名'));
    expect(renameItem).toBeDefined();

    renameItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Rename input should appear for group-1
    const renameInput = group1.querySelector<HTMLInputElement>('input');
    expect(renameInput).not.toBeNull();
    expect(renameInput?.value).toBe('通貨');

    // Cancel rename by pressing ESC
    renameInput?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    await nextTick();

    // 3. 刪除資料夾
    menuContent = await openGroupMenu(group1);
    const deleteItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('刪除資料夾'));
    expect(deleteItem?.className).toContain('text-destructive');

    deleteItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(poexdConfirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('確定要刪除「通貨」嗎？'),
      '刪除資料夾',
    );
  });

  it('D. maintains controlled single active menu and activeGroupMenuId no longer directly controls actions visibility', async () => {
    const containers = getGroupContainers();
    const group1 = containers[0];
    const group2 = containers[1];

    const group1Actions = group1.querySelector('.group-actions');
    const group2Actions = group2.querySelector('.group-actions');

    // Initially actions have no opacity-100
    expect(group1Actions?.classList.contains('opacity-100')).toBe(false);
    expect(group2Actions?.classList.contains('opacity-100')).toBe(false);

    // Open group 1 menu
    let content = await openGroupMenu(group1);
    expect(content).not.toBeNull();
    // activeGroupMenuId no longer adds opacity-100 visual override
    expect(group1Actions?.classList.contains('opacity-100')).toBe(false);
    expect(group2Actions?.classList.contains('opacity-100')).toBe(false);

    // Open group 2 menu -> controlled menu switches cleanly
    content = await openGroupMenu(group2);
    expect(content).not.toBeNull();
    expect(group1Actions?.classList.contains('opacity-100')).toBe(false);
    expect(group2Actions?.classList.contains('opacity-100')).toBe(false);
  });

  it('E. lazy loads trade leagues only when league submenu is opened and renders unconditional leagues', async () => {
    const { fetchTradeLeagues } = await import('@/utils/trade-leagues');
    vi.mocked(fetchTradeLeagues).mockClear();

    const containers = getGroupContainers();
    const group1 = containers[0];

    // Open root group menu
    await openGroupMenu(group1);
    expect(fetchTradeLeagues).not.toHaveBeenCalled();

    const subTriggers = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    );
    const subTrigger = subTriggers.find((t) => t.textContent?.includes('替換此資料夾聯盟')) ?? null;
    expect(subTrigger).not.toBeNull();
    expect(subTrigger?.textContent).toContain('替換此資料夾聯盟');

    // Trigger submenu open via mouseenter/click
    subTrigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    subTrigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    subTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    expect(fetchTradeLeagues).toHaveBeenCalled();

    const subContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContent).not.toBeNull();
    expect(subContent?.className).toContain('z-(--pxd-z-floating)');
    expect(subContent?.className).not.toContain('z-[10000001]');
    expect(subContent?.textContent).toContain('標準模式');
    expect(subContent?.textContent).toContain('卡爾葛墾荒者');
  });

  it('F. confirms replace league with folder scope and target group', async () => {
    const containers = getGroupContainers();
    const group1 = containers[0];

    await openGroupMenu(group1);

    const subTriggers = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    );
    const subTrigger = subTriggers.find((t) => t.textContent?.includes('替換此資料夾聯盟')) ?? null;
    expect(subTrigger).not.toBeNull();
    subTrigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    subTrigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    subTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    const subContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    const settlersItem = Array.from(
      subContent?.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]') || [],
    ).find((i) => i.textContent?.includes('卡爾葛墾荒者'));
    expect(settlersItem).toBeDefined();

    settlersItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(poexdConfirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('資料夾「通貨」'),
      '替換書籤聯盟',
    );
    expect(poexdConfirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('卡爾葛墾荒者'),
      '替換書籤聯盟',
    );
  });

  it('G. provides move-to-folder submenu with exclusion of self and descendants, and allows moving nested folder to root', async () => {
    const containers = getGroupContainers();
    // 依序為: group-1(通貨), group-2(裝備), group-3(武器), group-4(弓), group-5(地圖)
    const weaponContainer = appRoot.querySelector<HTMLElement>(
      '.group-container[data-group-id="group-3"]',
    );
    expect(weaponContainer).not.toBeNull();

    // 1. 測試 nested folder: group-3 (武器)
    await openGroupMenu(weaponContainer!);

    const subTriggers = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    );
    const moveSubTrigger =
      subTriggers.find((t) => t.textContent?.includes('移動到資料夾...')) ?? null;
    expect(moveSubTrigger).not.toBeNull();

    // Trigger submenu open
    moveSubTrigger?.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true, cancelable: true }),
    );
    moveSubTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    const subContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContent).not.toBeNull();

    const items = Array.from(
      subContent?.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]') || [],
    );

    // 1. self 不出現在合法 parent
    const selfItem = items.find(
      (i) => i.getAttribute('title') === '裝備 / 武器' || i.textContent?.trim() === '武器',
    );
    expect(selfItem).toBeUndefined();

    // 2. descendant 不出現在合法 parent (group-4 弓 為 group-3 的子資料夾)
    const descendantItem = items.find((i) => i.textContent?.includes('弓'));
    expect(descendantItem).toBeUndefined();

    // 3. unrelated folder 可作為 parent (通貨、地圖)；當前 parent (裝備) 顯示為 disabled
    const currencyItem = items.find((i) => i.textContent?.includes('通貨'));
    const mapItem = items.find((i) => i.textContent?.includes('地圖'));
    const currentParentItem = items.find((i) => i.textContent?.includes('裝備'));

    expect(currencyItem).toBeDefined();
    expect(
      currencyItem?.hasAttribute('disabled') ||
        currencyItem?.getAttribute('data-disabled') !== null,
    ).toBe(false);

    expect(mapItem).toBeDefined();
    expect(
      mapItem?.hasAttribute('disabled') || mapItem?.getAttribute('data-disabled') !== null,
    ).toBe(false);

    expect(currentParentItem).toBeDefined();
    expect(
      currentParentItem?.hasAttribute('disabled') ||
        currentParentItem?.getAttribute('data-disabled') !== null,
    ).toBe(true);

    // 4. nested folder 可透過 menu 移到最上層
    const rootItem = items.find((i) => i.textContent?.includes('最上層'));
    expect(rootItem).toBeDefined();

    rootItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // 移動到最上層應以目前最後一個 root folder (group-5 地圖) 的 'after' 派發 move-folder
    expect(moveFolderSpy).toHaveBeenCalledWith('group-3', undefined, undefined, {
      targetFolderId: 'group-5',
      position: 'after',
    });

    // 5. 驗證 root folder 本身選單絕不出現「最上層」
    const currencyContainer = containers[0]; // group-1 通貨 (root folder)
    await openGroupMenu(currencyContainer);
    const rootSubTriggers = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    );
    const rootMoveTrigger =
      rootSubTriggers.find((t) => t.textContent?.includes('移動到資料夾...')) ?? null;
    rootMoveTrigger?.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true, cancelable: true }),
    );
    rootMoveTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    const rootSubContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    const rootSubItems = Array.from(
      rootSubContent?.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]') || [],
    );
    expect(rootSubItems.some((i) => i.textContent?.includes('最上層'))).toBe(false);

    // 6. 驗證樹狀縮排與純名稱顯示契約（主要文字為自身 name，完整路徑保留於 title，縮排由內部 token-aware spacer 結構表達且不覆蓋 primitive padding）
    const equipmentItemInRoot = rootSubItems.find((i) => i.getAttribute('title') === '裝備');
    expect(equipmentItemInRoot).toBeDefined();
    expect(equipmentItemInRoot?.style.paddingLeft).toBe('');
    expect(equipmentItemInRoot?.querySelectorAll('[data-slot="indent-spacer"]')).toHaveLength(0);

    const weaponItemInRoot = rootSubItems.find((i) => i.getAttribute('title') === '裝備 / 武器');
    expect(weaponItemInRoot).toBeDefined();
    expect(weaponItemInRoot?.querySelector('span.truncate')?.textContent?.trim()).toBe('武器');
    expect(weaponItemInRoot?.style.paddingLeft).toBe('');
    expect(weaponItemInRoot?.querySelectorAll('[data-slot="indent-spacer"]')).toHaveLength(1);

    const bowItemInRoot = rootSubItems.find((i) => i.getAttribute('title') === '裝備 / 武器 / 弓');
    expect(bowItemInRoot).toBeDefined();
    expect(bowItemInRoot?.querySelector('span.truncate')?.textContent?.trim()).toBe('弓');
    expect(bowItemInRoot?.style.paddingLeft).toBe('');
    expect(bowItemInRoot?.querySelectorAll('[data-slot="indent-spacer"]')).toHaveLength(2);
  });

  it('H. directly deletes empty leaf folder without poexdConfirm dialog', async () => {
    // group-5 (地圖): 0 descendant folders, 0 bookmarks
    const mapContainer = appRoot.querySelector<HTMLElement>(
      '.group-container[data-group-id="group-5"]',
    );
    expect(mapContainer).not.toBeNull();

    await openGroupMenu(mapContainer!);
    const deleteItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('刪除資料夾'));
    expect(deleteItem).toBeDefined();

    deleteItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Must NOT call poexdConfirm for empty leaf folder
    expect(poexdConfirmSpy).not.toHaveBeenCalled();
    // deleteGroup must be executed directly
    expect(deleteGroupSpy).toHaveBeenCalledWith('group-5');
  });

  it('I. prompts poexdConfirm when deleting folder containing bookmarks (retains confirmation)', async () => {
    // group-1 (通貨): 0 descendant folders, 1 bookmark (bm-1)
    const currencyContainer = appRoot.querySelector<HTMLElement>(
      '.group-container[data-group-id="group-1"]',
    );
    expect(currencyContainer).not.toBeNull();

    await openGroupMenu(currencyContainer!);
    const deleteItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('刪除資料夾'));
    expect(deleteItem).toBeDefined();

    deleteItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Must call poexdConfirm with bookmark count
    expect(poexdConfirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('確定要刪除「通貨」嗎？\n該資料夾中包含 1 個書籤，將一併刪除。'),
      '刪除資料夾',
    );
    expect(deleteGroupSpy).toHaveBeenCalledWith('group-1');
  });

  it('J. prompts poexdConfirm when deleting folder with descendant folder even if 0 bookmarks', async () => {
    // group-3 (武器): 1 descendant folder (group-4 弓), 0 bookmarks in subtree
    const weaponContainer = appRoot.querySelector<HTMLElement>(
      '.group-container[data-group-id="group-3"]',
    );
    expect(weaponContainer).not.toBeNull();

    await openGroupMenu(weaponContainer!);
    const deleteItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('刪除資料夾'));
    expect(deleteItem).toBeDefined();

    deleteItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Must call poexdConfirm and reflect cascade count
    expect(poexdConfirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('該資料夾及其 1 個子資料夾中包含 0 個書籤，將一併刪除。'),
      '刪除資料夾',
    );
    expect(deleteGroupSpy).toHaveBeenCalledWith('group-3');
  });
});
