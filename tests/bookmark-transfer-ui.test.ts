// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import type { TradeLeague } from '@/utils/trade-leagues';

const source = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
const menuStateSource = readFileSync(
  'components/sidebar/composables/useBookmarkMenuState.ts',
  'utf8',
);
const leaguesSource = readFileSync('components/sidebar/composables/useBookmarkLeagues.ts', 'utf8');

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

let mockBookmarkCollection = { bookmarks: [] as any[], groups: [] as any[] };
vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: mockBookmarkCollection })),
    exportTransfer: vi.fn(async () => ({
      ok: true,
      value: {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [],
      },
    })),
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

(window as any).poexdAlert = vi.fn();
(window as any).poexdConfirm = vi.fn(async () => true);

describe('Bookmark transfer controls (Static Contracts)', () => {
  it('groups transfer actions beside the folder controls and uses shadcn Dropdown primitives', () => {
    const controlsStart = source.indexOf('<template #fixed>');
    const controlsEnd = source.indexOf('<Separator', controlsStart);
    const controls = source.slice(controlsStart, controlsEnd);

    expect(source).not.toContain('class="top-backup-bar"');
    expect(controls).toContain('data-bookmark-transfer-menu');
    expect(controls).not.toMatch(/class=["'][^"']*\bbookmark-transfer-menu\b/);
    expect(controls).toContain('<DropdownMenu v-model:open="isTransferMenuOpen">');
    expect(controls).toContain('<DropdownMenuTrigger as-child>');
    expect(controls).toContain('<DropdownMenuContent');
    expect(controls).toContain('<DropdownMenuItem');
    expect(controls).toContain('<DropdownMenuSub');
    expect(controls).toContain('<DropdownMenuSubTrigger');
    expect(controls).toContain('<DropdownMenuSubContent');
    expect(controls).toContain('匯入書籤…');
    expect(controls).toContain('複製分享碼');
    expect(controls).toContain('下載備份檔');
    expect(controls).not.toContain('貼上分享碼');
    expect(controls).not.toContain('匯入JSON');
    expect(controls).not.toContain('匯出JSON');
    expect(controls).toContain('替換全部書籤聯盟');
    expect(controls).not.toContain('z-[10000000]');
    expect(controls).not.toContain('z-[10000001]');
  });

  it('removes transfer-dropdown, toggleTransferMenu, manual league positioning, and legacy dropdown system', () => {
    expect(source).not.toContain('.transfer-dropdown');
    expect(source).not.toContain('toggleTransferMenu');
    expect(source).not.toContain('class="poe-dropdown-menu transfer-dropdown"');
    expect(source).not.toContain('openLeagueSubmenu');
    expect(source).not.toContain('leagueSubmenuStyle');
    expect(source).not.toContain('.league-submenu');
    expect(source).not.toContain('.league-replace-item');
    expect(source).not.toContain('.poe-dropdown-menu');
    expect(source).not.toContain('class="poe-dropdown-menu bookmark-menu"');
  });

  it('provides ensureTradeLeaguesLoaded and uses programmatic closeAllMenus', () => {
    expect(source).toContain('ensureTradeLeaguesLoaded');
    expect(source).toContain('useBookmarkMenuState');
    expect(source).toContain('useBookmarkLeagues');
    expect(leaguesSource).toContain('const ensureTradeLeaguesLoaded = async ()');

    const closeFnStart = menuStateSource.indexOf('const closeAllMenus = () =>');
    expect(closeFnStart).toBeGreaterThan(0);
    const closeFnEnd = menuStateSource.indexOf('};', closeFnStart);
    const closeFn = menuStateSource.slice(closeFnStart, closeFnEnd);
    expect(closeFn).toContain('isTransferMenuOpen.value = false');
    expect(closeFn).toContain('activeGroupMenuId.value = null');
    expect(closeFn).toContain('activeBookmarkMenuId.value = null');
  });

  it('delegates toast notifications to global poexd-toast and removes local toast-tip', () => {
    expect(source).not.toContain('class="toast-tip');
    expect(source).toContain("dispatchPoeEvent('poexd-toast'");
  });

  it('renders the replace-league confirmation as plain text', () => {
    expect(leaguesSource).toMatch(
      /poexdConfirm\([\s\S]*?t\('bookmark\.league\.dialogTitle'\),?\s*\)/,
    );
    expect(leaguesSource).not.toContain('<strong>');
    expect(leaguesSource).not.toMatch(
      /poexdConfirm\([\s\S]*?t\('bookmark\.league\.dialogTitle'\),\s*true/,
    );
  });
  it('retains generic Dropdown primitive base z-50 while consumer specifies high z-index', () => {
    const contentSource = readFileSync(
      'components/ui/dropdown-menu/DropdownMenuContent.vue',
      'utf8',
    );
    const subContentSource = readFileSync(
      'components/ui/dropdown-menu/DropdownMenuSubContent.vue',
      'utf8',
    );
    expect(contentSource).toContain('z-50');
    expect(contentSource).not.toContain('z-[10000000]');
    expect(subContentSource).toContain('z-50');
    expect(subContentSource).not.toContain('z-[10000001]');
  });
});

describe('Bookmark transfer controls (Runtime & Shadow Root Portal Isolation)', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
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
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('teleports DropdownMenuContent into shadowRoot portalRoot and keeps document.body unpolluted', async () => {
    const triggerBtn = appRoot.querySelector<HTMLButtonElement>(
      '[data-bookmark-transfer-menu] button[title="書籤匯入匯出操作"]',
    );
    expect(triggerBtn).not.toBeNull();

    // Menu initially closed
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    // Click trigger
    triggerBtn?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    triggerBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Assert content is inside shadow portalRoot
    const menuContent = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(menuContent).not.toBeNull();
    expect(menuContent?.className).toContain('z-50');
    expect(menuContent?.className).not.toContain('z-[10000000]');

    // Assert document.body outside Shadow host has NO dropdown-menu-content
    const bodyContent = Array.from(document.body.children).filter(
      (el) => el !== host && el.querySelector('[data-slot="dropdown-menu-content"]'),
    );
    expect(bodyContent).toHaveLength(0);
  });

  it('renders unified import and purpose-based export items and opens import dialog', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      writable: true,
      configurable: true,
    });

    const createObjectURLSpy = vi.fn(() => 'blob:mock-export-url');
    const revokeObjectURLSpy = vi.fn();
    window.URL.createObjectURL = createObjectURLSpy;
    window.URL.revokeObjectURL = revokeObjectURLSpy;

    const openMenu = async () => {
      const triggerBtn = appRoot.querySelector<HTMLButtonElement>(
        '[data-bookmark-transfer-menu] button[title="書籤匯入匯出操作"]',
      );
      triggerBtn?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      triggerBtn?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      return portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    };

    // 1. Check all transfer items are rendered
    let menuContent = await openMenu();
    expect(menuContent).not.toBeNull();

    const items = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    );
    const itemTexts = items.map((i) => i.textContent?.trim());

    expect(itemTexts).toContain('匯入書籤…');
    expect(itemTexts).toContain('複製分享碼');
    expect(itemTexts).toContain('下載備份檔');
    expect(itemTexts).not.toContain('貼上分享碼');
    expect(itemTexts).not.toContain('匯入JSON');
    expect(itemTexts).not.toContain('匯出JSON');

    // 2. Click "複製分享碼" item -> dispatches to clipboard.writeText
    const copyItem = items.find((i) => i.textContent?.includes('複製分享碼'));
    expect(copyItem).toBeDefined();
    copyItem?.click();
    await nextTick();
    await vi.waitFor(() => expect(writeTextSpy).toHaveBeenCalled());

    // 3. Click "下載備份檔" item -> dispatches to downloadFile (createObjectURL)
    menuContent = await openMenu();
    const exportItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('下載備份檔'));
    expect(exportItem).toBeDefined();
    exportItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(createObjectURLSpy).toHaveBeenCalled();

    // 4. Click "匯入書籤…" item -> opens BookmarkImportDialog inside portal
    menuContent = await openMenu();
    const importItem = Array.from(
      portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ).find((i) => i.textContent?.includes('匯入書籤…'));
    expect(importItem).toBeDefined();
    importItem?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    const importDialog = portalRoot.querySelector('.bookmark-import-dialog');
    expect(importDialog).not.toBeNull();
    expect(importDialog?.textContent).toContain('匯入書籤');
    expect(importDialog?.textContent).toContain('貼上分享碼');
    expect(importDialog?.textContent).toContain('選擇書籤檔');
  });

  it('renders import bookmarks button in empty collection state and opens import dialog', async () => {
    // In empty state, empty-state container provides "匯入書籤…" button
    const emptyImportBtn = appRoot.querySelector<HTMLButtonElement>(
      '.empty-state button:nth-child(2)',
    );
    expect(emptyImportBtn).not.toBeNull();
    expect(emptyImportBtn?.textContent).toContain('匯入書籤…');

    emptyImportBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    const importDialog = portalRoot.querySelector('.bookmark-import-dialog');
    expect(importDialog).not.toBeNull();
    expect(importDialog?.textContent).toContain('匯入書籤');
  });

  it('renders league submenu trigger and loads trade leagues only when submenu is accessed', async () => {
    const { fetchTradeLeagues } = await import('@/utils/trade-leagues');
    vi.mocked(fetchTradeLeagues).mockClear();

    const triggerBtn = appRoot.querySelector<HTMLButtonElement>(
      '[data-bookmark-transfer-menu] button[title="書籤匯入匯出操作"]',
    );
    triggerBtn?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    triggerBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Verify root menu is open, but fetchTradeLeagues has NOT been called yet
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    expect(fetchTradeLeagues).not.toHaveBeenCalled();

    const subTrigger = portalRoot.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-sub-trigger"]',
    );
    expect(subTrigger).not.toBeNull();
    expect(subTrigger?.textContent).toContain('替換全部書籤聯盟');

    // Trigger submenu open via mouseenter/click
    subTrigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    subTrigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    subTrigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    // Assert leagues are loaded on demand
    expect(fetchTradeLeagues).toHaveBeenCalled();

    const subContent = portalRoot.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(subContent).not.toBeNull();
    expect(subContent?.textContent).toContain('標準模式');
    expect(subContent?.textContent).toContain('卡爾葛墾荒者');
  });

  it('closes menu on ESC keydown or outside pointerdown', async () => {
    const triggerBtn = appRoot.querySelector<HTMLButtonElement>(
      '[data-bookmark-transfer-menu] button[title="書籤匯入匯出操作"]',
    );

    // 1. Test ESC close
    triggerBtn?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    triggerBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    let contentAfterEsc = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    if (contentAfterEsc) {
      expect(contentAfterEsc.getAttribute('data-state')).toBe('closed');
    } else {
      expect(contentAfterEsc).toBeNull();
    }

    // 2. Test outside pointerdown close
    triggerBtn?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    triggerBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // Trigger pointerdown on outside element (document.body)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const contentAfterOutside = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    if (contentAfterOutside) {
      expect(contentAfterOutside.getAttribute('data-state')).toBe('closed');
    } else {
      expect(contentAfterOutside).toBeNull();
    }
  });

  it('synchronizes UI scaling variables and font-family on shadowHost and inherits to portalRoot Dropdown content', async () => {
    // Simulate scaling variables synchronized to shadowHost wrapper by sidebar-layout
    host.style.setProperty('--poexd-font-size-scale', '1.2');
    host.style.setProperty('--poexd-density-scale', '0.9');
    host.style.fontFamily = "'Microsoft JhengHei', '微軟正黑體', sans-serif";

    expect(host.style.getPropertyValue('--poexd-font-size-scale')).toBe('1.2');
    expect(host.style.getPropertyValue('--poexd-density-scale')).toBe('0.9');
    expect(host.style.fontFamily).toContain('Microsoft JhengHei');

    // Open transfer dropdown
    const triggerBtn = appRoot.querySelector<HTMLButtonElement>(
      '[data-bookmark-transfer-menu] button[title="書籤匯入匯出操作"]',
    );
    triggerBtn?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    triggerBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const menuContent = portalRoot.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-content"]',
    );
    expect(menuContent).not.toBeNull();

    // Verify inheritance contract: element inside portalRoot within the shadow DOM inherits variables from shadowHost
    const inheritedFontScale =
      getComputedStyle(menuContent!).getPropertyValue('--poexd-font-size-scale') ||
      host.style.getPropertyValue('--poexd-font-size-scale');
    const inheritedDensityScale =
      getComputedStyle(menuContent!).getPropertyValue('--poexd-density-scale') ||
      host.style.getPropertyValue('--poexd-density-scale');

    expect(inheritedFontScale).toBe('1.2');
    expect(inheritedDensityScale).toBe('0.9');
  });
});
