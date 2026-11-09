// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { activateBookmarkRows, readBookmarkNodeSource } from './helpers/bookmark-node-source';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import type { TradeLeague } from '@/utils/trade-leagues';
import { dispatchPoeEvent } from '@/utils/event-contracts';

const source = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
const nodeSource = readBookmarkNodeSource();
const menuStateSource = readFileSync(
  'components/sidebar/composables/useBookmarkMenuState.ts',
  'utf8',
);
const contentSource = readFileSync('components/ui/dropdown-menu/DropdownMenuContent.vue', 'utf8');
const subContentSource = readFileSync(
  'components/ui/dropdown-menu/DropdownMenuSubContent.vue',
  'utf8',
);
const itemSource = readFileSync('components/ui/dropdown-menu/DropdownMenuItem.vue', 'utf8');
const subTriggerSource = readFileSync(
  'components/ui/dropdown-menu/DropdownMenuSubTrigger.vue',
  'utf8',
);
import { createUiRuntimeTokenValues, LAYOUT_TOKENS } from '@/lib/tokens';

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

let mockBookmarkCollection = {
  bookmarks: [
    {
      id: 'bm-1',
      name: '崇高石',
      url: 'https://www.pathofexile.com/trade/search/Standard/exalt',
      groupId: 'group-1',
      coverImageUrl: 'https://web.poecdn.com/exalt.png',
    },
    {
      id: 'bm-2',
      name: '神聖石',
      url: 'https://www.pathofexile.com/trade/search/Standard/divine',
      groupId: 'group-2',
    },
  ],
  groups: [
    { id: 'group-1', name: '通貨' },
    { id: 'group-2', name: '裝備' },
  ],
};

const putBookmarkSpy = vi.fn(async (_arg?: any) => ({ ok: true }));
const deleteBookmarkSpy = vi.fn(async () => ({ ok: true }));
const reorderBookmarksSpy = vi.fn(async () => ({ ok: true }));
const exportTransferSpy = vi.fn(async () => ({ ok: true, value: {} }));

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: mockBookmarkCollection })),
    putGroup: vi.fn(async () => ({ ok: true })),
    deleteGroup: vi.fn(async () => ({ ok: true })),
    reorderGroups: vi.fn(async () => ({ ok: true })),
    putBookmark: putBookmarkSpy,
    deleteBookmark: deleteBookmarkSpy,
    reorderBookmarks: reorderBookmarksSpy,
    exportTransfer: exportTransferSpy,
    importTransfer: vi.fn(async () => ({ ok: true })),
    replaceLeague: vi.fn(async () => ({ ok: true })),
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

describe('Bookmark Menu (Static Contracts & Legacy Cleanup)', () => {
  it('J. removes global window click menu lifecycle listener', () => {
    expect(source).not.toContain("window.addEventListener('click', closeAllMenus)");
    expect(source).not.toContain("window.removeEventListener('click', closeAllMenus)");
    expect(source).toContain('useBookmarkMenuState');

    const closeFnStart = menuStateSource.indexOf('const closeAllMenus = () =>');
    expect(closeFnStart).toBeGreaterThan(0);
    const closeFnEnd = menuStateSource.indexOf('};', closeFnStart);
    const closeFn = menuStateSource.slice(closeFnStart, closeFnEnd);
    expect(closeFn).not.toContain('event');
    expect(closeFn).toContain('activeBookmarkMenuId.value = null');
  });

  it('K. eliminates legacy menu classes, methods, and back buttons', () => {
    expect(source).not.toContain('toggleBookmarkMenu');
    expect(source).not.toContain('.poe-dropdown-menu');
    expect(source).not.toContain('.bookmark-menu');
    expect(source).not.toContain('.sub-menu-back-btn');
    expect(source).not.toContain('.dropdown-divider');
    expect(source).not.toContain('ArrowLeft');
    expect(source).not.toContain('.bookmark-row-item:has(.poe-dropdown-menu)');
  });

  it('uses controlled shadcn / Reka Dropdown primitives with custom z-index', () => {
    expect(nodeSource).toContain(':open="isMenuOpen"');
    expect(nodeSource).toContain('@update:open="(open) => ctx.setBookmarkMenuOpen(bm.id, open)"');
    expect(nodeSource).toMatch(
      /@close-auto-focus="[\s\S]*?if\s*\(ctx\.editingBookmarkId\.value\)\s*e\.preventDefault\(\);?[\s\S]*?"/,
    );
    expect(nodeSource).toContain('<DropdownMenuSub');
    expect(nodeSource).toContain('<DropdownMenuSubTrigger');
    expect(nodeSource).toContain('<DropdownMenuSubContent');
    expect(nodeSource).not.toContain('z-[10000000]');
    expect(nodeSource).not.toContain('z-[10000001]');
  });

  it('Generic Dropdown primitives enforce available-width safety, scale-aware minimum, and shrink capability', () => {
    expect(contentSource).toContain('--reka-dropdown-menu-content-available-width');
    expect(contentSource).toContain('var(--pxd-menu-min-width');
    expect(subContentSource).toContain('--reka-dropdown-menu-content-available-width');
    expect(subContentSource).toContain('var(--pxd-menu-min-width');
    expect(itemSource).toContain('min-w-0');
    expect(subTriggerSource).toContain('min-w-0');
  });

  it('eliminates raw fixed menu widths and uses semantic scale-aware tokens in BookmarkPane', () => {
    expect(nodeSource).not.toContain('min-w-[140px]');
    expect(nodeSource).not.toContain('min-w-[165px]');
    expect(nodeSource).not.toContain('class="w-48');
    expect(nodeSource).toContain('var(--pxd-menu-sub-width');
    expect(nodeSource).toContain('var(--pxd-cover-picker-width');
    expect(nodeSource).toContain('var(--pxd-cover-picker-item-size');
  });

  it('scales Dropdown and Cover Picker visual geometry with UI Scale while keeping them Density invariant', () => {
    const t85 = createUiRuntimeTokenValues({ scale: 0.85, density: 1.0 });
    const t100 = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
    const t120 = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });
    const tCompact = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });

    // Scale 100% baselines
    expect(t100[LAYOUT_TOKENS.menuMinWidthVar]).toBe('128px');
    expect(t100[LAYOUT_TOKENS.menuSubPreferredWidthVar]).toBe('192px');
    expect(t100[LAYOUT_TOKENS.coverPickerItemSizeVar]).toBe('56px');
    expect(t100[LAYOUT_TOKENS.coverPickerWidthVar]).toBe('272px');

    // Scale 85% (proportional shrink)
    expect(t85[LAYOUT_TOKENS.menuMinWidthVar]).toBe('108.8px');
    expect(t85[LAYOUT_TOKENS.menuSubPreferredWidthVar]).toBe('163.2px');
    expect(t85[LAYOUT_TOKENS.coverPickerItemSizeVar]).toBe('47.6px');
    expect(t85[LAYOUT_TOKENS.coverPickerWidthVar]).toBe('231.2px');

    // Scale 120% (proportional expand)
    expect(t120[LAYOUT_TOKENS.menuMinWidthVar]).toBe('153.6px');
    expect(t120[LAYOUT_TOKENS.menuSubPreferredWidthVar]).toBe('230.4px');
    expect(t120[LAYOUT_TOKENS.coverPickerItemSizeVar]).toBe('67.2px');
    expect(t120[LAYOUT_TOKENS.coverPickerWidthVar]).toBe('326.4px');

    // Density Invariant
    expect(tCompact[LAYOUT_TOKENS.menuMinWidthVar]).toBe(t100[LAYOUT_TOKENS.menuMinWidthVar]);
    expect(tCompact[LAYOUT_TOKENS.menuSubPreferredWidthVar]).toBe(
      t100[LAYOUT_TOKENS.menuSubPreferredWidthVar],
    );
    expect(tCompact[LAYOUT_TOKENS.coverPickerItemSizeVar]).toBe(
      t100[LAYOUT_TOKENS.coverPickerItemSizeVar],
    );
    expect(tCompact[LAYOUT_TOKENS.coverPickerWidthVar]).toBe(
      t100[LAYOUT_TOKENS.coverPickerWidthVar],
    );
  });

  it('Remove Cover row uses ImageOff icon without padding alignment hacks', () => {
    expect(nodeSource).toContain('<ImageOff class="text-muted-foreground" />');
    expect(nodeSource).toMatch(/<DropdownMenuItem[^>]*>\s*<ImageOff/);
    expect(nodeSource).not.toContain('pl-[calc');
  });
});

describe('Bookmark Menu (Runtime Contracts & Shadow Root Portal Isolation)', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    poexdAlertSpy.mockClear();
    poexdConfirmSpy.mockClear();
    putBookmarkSpy.mockClear();
    deleteBookmarkSpy.mockClear();
    reorderBookmarksSpy.mockClear();
    exportTransferSpy.mockClear();

    mockBookmarkCollection = {
      bookmarks: [
        {
          id: 'bm-1',
          name: '崇高石',
          url: 'https://www.pathofexile.com/trade/search/Standard/exalt',
          groupId: 'group-1',
          coverImageUrl: 'https://web.poecdn.com/exalt.png',
        },
        {
          id: 'bm-2',
          name: '神聖石',
          url: 'https://www.pathofexile.com/trade/search/Standard/divine',
          groupId: 'group-2',
        },
      ],
      groups: [
        { id: 'group-1', name: '通貨' },
        { id: 'group-2', name: '裝備' },
        { id: 'group-3', name: '超級長無比的自訂資料夾名稱用於驗證截斷行為與選單寬度安全邊界' },
      ],
    };

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
    await activateBookmarkRows(appRoot);
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  const getBookmarkRows = () =>
    Array.from(appRoot.querySelectorAll<HTMLElement>('.bookmark-row-item'));

  const getBookmarkTrigger = (row: HTMLElement) =>
    row.querySelector<HTMLButtonElement>('.bookmark-item-actions button[title="操作選單"]');

  const openBookmarkMenu = async (row: HTMLElement) => {
    const trigger = getBookmarkTrigger(row);
    expect(trigger).not.toBeNull();
    trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    return portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
  };

  it('A. teleports Bookmark Menu into shadowRoot portalRoot and keeps row item and document.body unpolluted', async () => {
    const rows = getBookmarkRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const bm1 = rows[0];
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    const menuContent = await openBookmarkMenu(bm1);
    expect(menuContent).not.toBeNull();
    expect(menuContent?.className).toContain('z-50');
    expect(menuContent?.className).not.toContain('z-[10000000]');

    // Assert it is inside portalRoot and NOT inside bookmark-row-item
    expect(bm1.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    // Assert document.body outside Shadow host is unpolluted
    const bodyContent = Array.from(document.body.children).filter(
      (el) => el !== host && el.querySelector('[data-slot="dropdown-menu-content"]'),
    );
    expect(bodyContent).toHaveLength(0);
  });

  it('B. controls menu open state via activeBookmarkMenuId without forcing opacity-100 on row actions', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0];
    const bm2 = rows[1];

    const actions1 = bm1.querySelector('.bookmark-item-actions');
    const actions2 = bm2.querySelector('.bookmark-item-actions');

    // Row actions never receive opacity-100 (aligned to Folder header overlay contract)
    expect(actions1?.classList.contains('opacity-100')).toBe(false);
    expect(actions2?.classList.contains('opacity-100')).toBe(false);

    // Open bm1 menu
    const menuContent1 = await openBookmarkMenu(bm1);
    expect(menuContent1).not.toBeNull();
    expect(actions1?.classList.contains('opacity-100')).toBe(false);

    // Open bm2 menu -> bm2 opens, bm1 closes
    const menuContent2 = await openBookmarkMenu(bm2);
    expect(menuContent2).not.toBeNull();
    expect(actions2?.classList.contains('opacity-100')).toBe(false);

    // Outside click dismiss
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('B2. toggles to close and remains closed when clicking already open menu trigger', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0];

    // Open bm1 menu
    const menuContent = await openBookmarkMenu(bm1);
    expect(menuContent).not.toBeNull();
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // Click bm1 trigger again while open
    const trigger = getBookmarkTrigger(bm1);
    expect(trigger).not.toBeNull();
    trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    // Menu should be closed and remain closed
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('C. renders all root actions and dispatches newTab and 使用線上搜尋開啟 actions', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const sendMessageSpy = (globalThis as any).chrome.runtime.sendMessage as ReturnType<
      typeof vi.fn
    >;
    sendMessageSpy.mockClear();

    const rows = getBookmarkRows();
    const bm1 = rows[0]; // has coverImageUrl

    const menuContent = await openBookmarkMenu(bm1);
    expect(menuContent).not.toBeNull();

    const items = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).map((i) => i.textContent?.trim());

    expect(items.some((t) => t?.includes('在新分頁開啟'))).toBe(true);
    expect(items.some((t) => t?.includes('使用線上搜尋開啟'))).toBe(true);
    expect(items.some((t) => t?.includes('加入線上搜尋'))).toBe(false);
    expect(items.some((t) => t?.includes('已在線上'))).toBe(false);
    expect(items.some((t) => t?.includes('重新命名'))).toBe(true);
    expect(items.some((t) => t?.includes('移除封面'))).toBe(true);
    expect(items.some((t) => t?.includes('刪除書籤'))).toBe(true);

    const subTriggers = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).map((t) => t.textContent?.trim());
    expect(subTriggers.some((t) => t?.includes('更換封面'))).toBe(true);
    expect(subTriggers.some((t) => t?.includes('移動到資料夾'))).toBe(true);

    // Click "在新分頁開啟"
    const newTabItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('在新分頁開啟'));
    newTabItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.pathofexile.com/trade/search/Standard/exalt',
      '_blank',
    );
    openSpy.mockClear();

    // Reopen menu and click "使用線上搜尋開啟"
    await openBookmarkMenu(bm1);
    const liveItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('使用線上搜尋開啟'));
    expect(liveItem).toBeDefined();

    liveItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // 以 toLiveUrl(bookmark.url) 開啟官方 /live 新分頁，關閉選單且不送出任何主控台訊息
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.pathofexile.com/trade/search/Standard/exalt/live',
      '_blank',
    );
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
    expect(sendMessageSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it('C2. does not produce /live/live when bookmark.url already ends with /live', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockBookmarkCollection.bookmarks[0].url =
      'https://www.pathofexile.com/trade/search/Standard/exalt/live';

    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);
    const liveItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('使用線上搜尋開啟'));
    expect(liveItem).toBeDefined();

    liveItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(openSpy).toHaveBeenCalledWith(
      'https://www.pathofexile.com/trade/search/Standard/exalt/live',
      '_blank',
    );
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    openSpy.mockRestore();
  });

  it('D. prevents autofocus blur on inline rename input when menu closes', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);
    const renameItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('重新命名'));
    expect(renameItem).toBeDefined();

    renameItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Input should be present and mounted without premature blur unmount
    const input = bm1.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('崇高石');
  });

  it('E. renders Move submenu and triggers move-bookmark intent with bookmarkId and target groupId', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0]; // initially in group-1

    await openBookmarkMenu(bm1);

    const moveTrigger = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).find((t) => t.textContent?.includes('移動到資料夾'));
    expect(moveTrigger).toBeDefined();

    moveTrigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    moveTrigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    moveTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const subContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContent).not.toBeNull();
    expect(subContent?.className).toContain('z-50');
    expect(subContent?.className).not.toContain('z-[10000001]');

    // Click target folder "裝備" (group-2)
    const folder2Item = Array.from(
      subContent?.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]') || [],
    ).find((i) => i.textContent?.includes('裝備'));
    expect(folder2Item).toBeDefined();

    // Verify current folder "通貨" (group-1) is disabled and marked as "目前位置"
    const currentFolderItem = Array.from(
      subContent?.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]') || [],
    ).find((i) => i.getAttribute('title') === '通貨');
    expect(currentFolderItem).toBeDefined();
    expect(currentFolderItem?.textContent).toContain('目前位置');
    expect(
      currentFolderItem?.hasAttribute('disabled') ||
        currentFolderItem?.getAttribute('data-disabled') !== null,
    ).toBe(true);

    folder2Item?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Verify move-bookmark mutation was dispatched with exact bookmarkId and target groupId
    expect(reorderBookmarksSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'bm-1',
        groupId: 'group-2',
      }),
    ]);
  });

  it('E2. handles ultra-long folder name in Move submenu without unbounded width or state corruption', async () => {
    const longFolderName = '超級長無比的自訂資料夾名稱用於驗證截斷行為與選單寬度安全邊界';

    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);

    const moveTrigger = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).find((t) => t.textContent?.includes('移動到資料夾'));
    expect(moveTrigger).toBeDefined();

    moveTrigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    moveTrigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    moveTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const subContent = portalRoot.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-sub-content"]',
    );
    expect(subContent).not.toBeNull();

    // Generic primitive width contract
    expect(subContent?.className).toContain(
      'max-w-[var(--reka-dropdown-menu-content-available-width',
    );
    expect(subContent?.className).toContain('min-w-[min(var(--pxd-menu-min-width');
    // Scale-aware preferred width declared by consumer
    expect(subContent?.className).toContain('w-[var(--pxd-menu-sub-width');

    // Find the long folder item
    const longFolderItem = Array.from(
      subContent?.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]') || [],
    ).find((i) => i.getAttribute('title') === longFolderName);
    expect(longFolderItem).toBeDefined();

    // Verify folder row has min-w-0
    expect(longFolderItem?.className).toContain('min-w-0');

    // Verify folder icon has shrink-0
    const folderIcon = longFolderItem?.querySelector('svg');
    expect(folderIcon).not.toBeNull();
    expect(folderIcon?.className.baseVal || folderIcon?.getAttribute('class')).toContain(
      'shrink-0',
    );

    // Verify folder label has min-w-0 flex-1 truncate
    const labelSpan = longFolderItem?.querySelector('span');
    expect(labelSpan).not.toBeNull();
    expect(labelSpan?.className).toContain('min-w-0');
    expect(labelSpan?.className).toContain('flex-1');
    expect(labelSpan?.className).toContain('truncate');

    // Verify domain data is preserved and not truncated in data model
    expect(labelSpan?.textContent).toBe(longFolderName);
    expect(longFolderItem?.getAttribute('title')).toBe(longFolderName);

    // Click truncated item and verify move-bookmark mutation was dispatched with exact groupId
    longFolderItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(reorderBookmarksSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'bm-1',
        groupId: 'group-3',
      }),
    ]);
  });

  it('F1. does not alert and keeps root menu open on pointer hover / move over Cover trigger', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);

    const coverTrigger = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).find((t) => t.textContent?.includes('更換封面'));
    expect(coverTrigger).toBeDefined();

    // Hover only: pointerenter / pointermove / mouseenter without click or activation key
    coverTrigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    coverTrigger?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 160));
    await nextTick();

    // Must NOT trigger precondition alert
    expect(poexdAlertSpy).not.toHaveBeenCalled();

    // Root menu must remain open
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // Submenu content must NOT be opened without explicit activation
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]')).toBeNull();
  });

  it('F2. opens Cover submenu with disabled empty state and no alert upon explicit click when no cover images are available', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);

    const coverTrigger = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).find((t) => t.textContent?.includes('更換封面'));
    expect(coverTrigger).toBeDefined();

    // Explicit click activation only (no hover mixing)
    coverTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    // Must NOT alert:
    expect(poexdAlertSpy).not.toHaveBeenCalled();
    // Menu content stays open and submenu is opened with empty state
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    const subContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContent).not.toBeNull();
    expect(subContent?.textContent).toContain('無資料');
  });

  it('F3. opens Cover submenu with disabled empty state and does not alert upon explicit keyboard activation (ArrowRight / Enter) when no images', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);

    const coverTrigger = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).find((t) => t.textContent?.includes('更換封面'));
    expect(coverTrigger).toBeDefined();

    // Explicit keyboard activation with ArrowRight
    coverTrigger?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(poexdAlertSpy).not.toHaveBeenCalled();
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    const subContentRight = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContentRight).not.toBeNull();
    expect(subContentRight?.textContent).toContain('無資料');

    // Also verify Enter key activation: close menu first, then reopen
    const trigger = getBookmarkTrigger(bm1);
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    await openBookmarkMenu(bm1);
    const coverTriggerEnter = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).find((t) => t.textContent?.includes('更換封面'));
    poexdAlertSpy.mockClear();
    coverTriggerEnter?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(poexdAlertSpy).not.toHaveBeenCalled();
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    const subContentEnter = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContentEnter).not.toBeNull();
    expect(subContentEnter?.textContent).toContain('無資料');
  });

  it('G. renders 4-column Cover submenu and dispatches set-bookmark-cover with imageUrl upon explicit activation', async () => {
    // Simulate images available via dispatchPoeEvent
    dispatchPoeEvent('poexd-result-images', {
      url: 'https://www.pathofexile.com/trade/search/Standard/exalt',
      images: ['https://web.poecdn.com/image1.png', 'https://web.poecdn.com/image2.png'],
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);

    const coverTrigger = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ).find((t) => t.textContent?.includes('更換封面'));
    coverTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const subContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContent).not.toBeNull();
    const coverGrid = subContent?.querySelector('.cover-image-grid');
    expect(coverGrid).not.toBeNull();
    expect(coverGrid?.className).toContain('grid-cols-4');
    expect(subContent?.className).toContain('w-[var(--pxd-cover-picker-width');
    expect(subContent?.className).not.toContain('max-w-full');

    const imageOptions = subContent?.querySelectorAll<HTMLElement>('.cover-image-option');
    expect(imageOptions?.length).toBe(2);
    expect(imageOptions?.[0]?.className).toContain('max-w-[var(--pxd-cover-picker-item-size');
    expect(imageOptions?.[0]?.className).toContain('aspect-square');
    expect(imageOptions?.[0]?.className).not.toContain('size-[var(--pxd-cover-picker-item-size');

    // Select second image
    imageOptions?.[1]?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(putBookmarkSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'bm-1',
        coverImageUrl: 'https://web.poecdn.com/image2.png',
      }),
    );
  });

  it('H. removes cover via set-bookmark-cover intent with undefined coverImageUrl', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0]; // has coverImageUrl

    await openBookmarkMenu(bm1);

    const removeItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('移除封面'));
    expect(removeItem).toBeDefined();

    // Verify Lucide semantic icon exists as child of DropdownMenuItem
    const removeIcon = removeItem?.querySelector('svg');
    expect(removeIcon).not.toBeNull();

    // Verify no manual padding/margin alignment hack
    expect(removeItem?.className).not.toMatch(/pl-\d+|ml-\d+/);

    removeItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(putBookmarkSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'bm-1',
      }),
    );
    // coverImageUrl should be undefined
    const calledArg = (putBookmarkSpy.mock.calls[0] as any[])?.[0];
    expect(calledArg?.coverImageUrl).toBeUndefined();
  });

  it('I. deletes bookmark via deleteBookmark intent with correct bookmarkId', async () => {
    const rows = getBookmarkRows();
    const bm1 = rows[0];

    await openBookmarkMenu(bm1);

    const deleteItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('刪除書籤'));
    expect(deleteItem).toBeDefined();
    expect(deleteItem?.className).toContain('text-destructive');

    deleteItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(deleteBookmarkSpy).toHaveBeenCalledWith('bm-1');
  });
});
