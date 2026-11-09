// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import { COMPONENT_SIZE_SPECS } from '@/lib/tokens';

const bookmarkPaneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn(), option: vi.fn() })),
  },
}));

vi.mock('@/utils/trade-leagues', () => ({
  fetchTradeLeagues: vi.fn(async () => [
    { id: 'Standard', text: '標準模式' },
    { id: 'Settlers', text: '卡爾葛墾荒者' },
  ]),
}));

let mockBookmarkCollection = {
  bookmarks: [
    {
      id: 'bm-1',
      name: 'Headhunter',
      url: 'https://www.pathofexile.com/trade/search/Standard/test1',
      league: 'Standard',
      groupId: 'g-1',
      createdAt: Date.now(),
    },
  ],
  groups: [{ id: 'g-1', name: 'Belts', createdAt: Date.now() }],
};

const mockClearCollection = vi.fn(async () => ({ ok: true as const, changed: true }));

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
    clearCollection: mockClearCollection,
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
};

const poexdConfirmSpy = vi.fn(async () => true);
(window as any).poexdConfirm = poexdConfirmSpy;

describe('Business Layer Migration Phase 2A — BookmarkPane Top Controls', () => {
  const fixedSection = bookmarkPaneSource.substring(
    bookmarkPaneSource.indexOf('<template #fixed>'),
    bookmarkPaneSource.indexOf('</template>', bookmarkPaneSource.indexOf('<template #fixed>')),
  );

  describe('1. Static Source Contracts: Top Toolbar Buttons', () => {
    it('uses standard size="sm" for text buttons and size="icon-sm" for icon buttons', () => {
      // 新建資料夾 Button
      expect(fixedSection).toMatch(
        /<Button[^>]*variant="default"[^>]*size="sm"[^>]*class="flex-1 font-bold"/,
      );

      // 全部展開 / 全部收合 Button
      expect(fixedSection).toMatch(
        /<Button[^>]*variant="secondary"[^>]*size="sm"[^>]*class="font-bold"/,
      );
      expect(fixedSection).not.toContain('min-w-[calc(72px');

      // 搜尋切換 Button (icon-sm)
      expect(fixedSection).toMatch(/<Button[^>]*variant="secondary"[^>]*size="icon-sm"/);

      // 匯入匯出更多操作 Button (icon-sm)
      expect(fixedSection).toMatch(
        /<Button[^>]*variant="secondary"[^>]*size="icon-sm"[^>]*title=(?:"|&quot;)書籤匯入匯出操作(?:"|&quot;)/,
      );
    });

    it('removes manual geometry overrides and density scaling from top toolbar buttons', () => {
      // No button geometry overrides in fixed template
      expect(fixedSection).not.toMatch(/<Button[^>]*h-\[calc\(28px/);
      expect(fixedSection).not.toMatch(/<Button[^>]*px-\[calc\(12px/);
      expect(fixedSection).not.toMatch(/<Button[^>]*px-\[calc\(8px/);
      expect(fixedSection).not.toMatch(/<Button[^>]*py-0/);
      expect(fixedSection).not.toMatch(/<Button[^>]*rounded-none/);

      // Density must not affect button geometry
      expect(fixedSection).not.toMatch(/<Button[^>]*var\(--poexd-density-scale/);

      // Icons inside top toolbar buttons do not have redundant size-3.5
      expect(fixedSection).toMatch(/<Button[^>]*size="icon-sm"[^>]*>[\s\S]*?<Search \/>/);
      expect(fixedSection).toMatch(/<Button[^>]*size="icon-sm"[^>]*>[\s\S]*?<MoreVertical \/>/);
    });
  });

  describe('2. Static Source Contracts: Search Input & Clear Action', () => {
    it('uses standard size="sm" for Search Input and removes manual geometry', () => {
      expect(fixedSection).toMatch(/<Input[^>]*size="sm"/);
      expect(fixedSection).not.toMatch(/<Input[^>]*h-\[calc/);
      expect(fixedSection).not.toMatch(/<Input[^>]*text-\[calc/);
      expect(fixedSection).not.toMatch(/<Input[^>]*rounded-none/);
      expect(fixedSection).not.toMatch(/<Input[^>]*focus-visible:ring-0/);

      // Retains composite positioning padding
      expect(fixedSection).toMatch(/<Input[^>]*pl-8 pr-7/);
    });

    it('uses Scale-aware foundation icon token for Search indicator', () => {
      expect(fixedSection).toContain('size-[var(--control-icon-sm,14px)]');
      expect(fixedSection).not.toMatch(/<Search[^>]*size-3\.5/);
    });

    it('uses size="icon-sm" for Clear Button and purges size-5 / p-0 / focus-visible:ring-0', () => {
      expect(fixedSection).toMatch(
        /<Button[^>]*variant="ghost"[^>]*size="icon-sm"[^>]*title=(?:"|&quot;)清除搜尋(?:"|&quot;)/,
      );
      expect(fixedSection).not.toMatch(/title=(?:"|&quot;)清除搜尋(?:"|&quot;)[^>]*size-5/);
      expect(fixedSection).not.toMatch(
        /title=(?:"|&quot;)清除搜尋(?:"|&quot;)[^>]*focus-visible:ring-0/,
      );
      expect(fixedSection).toMatch(/title=(?:"|&quot;)清除搜尋(?:"|&quot;)[\s\S]*?<X \/>/);
    });
  });

  describe('3. Static Source Contracts: Layout Spacing', () => {
    it('uses Foundation spacing tokens instead of raw density scale in top controls', () => {
      expect(fixedSection).toContain('gap-[var(--pxd-space-sm)]');
      expect(fixedSection).toContain('pb-[var(--pxd-space-md)]');
      expect(fixedSection).toContain('mb-[var(--pxd-space-md)]');
      expect(fixedSection).not.toContain('var(--poexd-density-scale');
    });
  });

  describe('4. Static Source Contracts: DropdownMenu Items and Content', () => {
    it('purges text-[calc(...)] overrides from DropdownMenuItem across BookmarkPane', () => {
      expect(bookmarkPaneSource).not.toMatch(/<DropdownMenuItem[^>]*text-\[calc/);
      expect(bookmarkPaneSource).not.toMatch(/<DropdownMenuSubTrigger[^>]*text-\[calc/);
      expect(bookmarkPaneSource).not.toMatch(/<DropdownMenuContent[^>]*text-\[calc/);
      expect(bookmarkPaneSource).not.toMatch(/<DropdownMenuSubContent[^>]*text-\[calc/);
    });

    it('removes hardcoded icon geometry (size-3.5, size-3, mr-2) from menu items', () => {
      expect(bookmarkPaneSource).not.toMatch(/<ExternalLink[^>]*mr-2/);
      expect(bookmarkPaneSource).not.toMatch(/<Radio[^>]*mr-2/);
      expect(bookmarkPaneSource).not.toMatch(/<Pencil[^>]*mr-2/);
      expect(bookmarkPaneSource).not.toMatch(/<Image[^>]*mr-2/);
      expect(bookmarkPaneSource).not.toMatch(/<FolderInput[^>]*mr-2/);
      expect(bookmarkPaneSource).not.toMatch(/<Folder[^>]*mr-2/);
      expect(bookmarkPaneSource).not.toMatch(/<Trash2[^>]*mr-2/);
    });
  });

  describe('5. Phase 2B Row Controls Convergence Confirmation', () => {
    it('confirms 18px/20px geometry, size-5 buttons, and focus-visible:ring-0 are purged from scroll section', () => {
      const scrollSection = bookmarkPaneSource.substring(
        bookmarkPaneSource.indexOf('<template #scroll>'),
      );

      // No 20px manual height
      expect(scrollSection).not.toMatch(/h-\[calc\(20px/);
      // No size-5 buttons
      expect(scrollSection).not.toContain('size-5');
      // No 18px buttons
      expect(scrollSection).not.toMatch(/h-\[calc\(18px/);
      // No focus-visible:ring-0
      expect(scrollSection).not.toContain('focus-visible:ring-0');
      // No raw density scale in scroll section
      expect(scrollSection).not.toContain('var(--poexd-density-scale');
    });
  });

  describe('6. Runtime DOM Geometry & Hierarchy Verification', () => {
    let shadowHost: HTMLElement;
    let shadowRoot: ShadowRoot;
    let portalRoot: HTMLElement;
    let appRoot: HTMLElement;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      document.body.innerHTML = '';
      shadowHost = document.createElement('div');
      shadowHost.id = 'poexd-shadow-host';
      shadowRoot = shadowHost.attachShadow({ mode: 'open' });

      portalRoot = document.createElement('div');
      portalRoot.id = 'poexd-portal-root';
      shadowRoot.appendChild(portalRoot);

      appRoot = document.createElement('div');
      appRoot.id = 'app';
      shadowRoot.appendChild(appRoot);
      document.body.appendChild(shadowHost);

      const RootComponent = defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
              h(BookmarkPane),
            ]);
        },
      });

      app = createApp(RootComponent);
      app.mount(appRoot);
    });

    afterEach(() => {
      app?.unmount();
      document.body.innerHTML = '';
    });

    it('renders top toolbar buttons with sm and icon-sm primitive geometry classes', async () => {
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // 新建資料夾: size="sm" Button
      const newFolderBtn = Array.from(appRoot.querySelectorAll<HTMLButtonElement>('button')).find(
        (btn) => btn.textContent?.includes('新建資料夾'),
      );
      expect(newFolderBtn).not.toBeUndefined();
      expect(newFolderBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.heightClass);
      expect(newFolderBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.buttonPaddingXClass);
      expect(newFolderBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.fontSizeClass);
      expect(newFolderBtn?.className).not.toContain('h-[calc(');

      // 全部展開 / 全部收合: size="sm" Button
      const expandBtn = Array.from(appRoot.querySelectorAll<HTMLButtonElement>('button')).find(
        (btn) => btn.textContent?.includes('全部展開') || btn.textContent?.includes('全部收合'),
      );
      expect(expandBtn).not.toBeUndefined();
      expect(expandBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.heightClass);
      expect(expandBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.buttonPaddingXClass);

      // 搜尋切換 Button: size="icon-sm"
      const searchToggleBtn = appRoot.querySelector<HTMLButtonElement>(
        'button[title="搜尋書籤"], button[title*="關閉搜尋"]',
      );
      expect(searchToggleBtn).not.toBeUndefined();
      expect(searchToggleBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);
      expect(searchToggleBtn?.className).toContain('p-0');

      // MoreVertical 更多操作 Button: size="icon-sm"
      const transferMenuBtn = appRoot.querySelector<HTMLButtonElement>(
        'button[title="書籤匯入匯出操作"]',
      );
      expect(transferMenuBtn).not.toBeUndefined();
      expect(transferMenuBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);
      expect(transferMenuBtn?.className).toContain('p-0');
    });

    it('renders Search Input and Clear action with sm and icon-sm geometry when search is open', async () => {
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // Click search toggle to open search input
      const searchToggleBtn = appRoot.querySelector<HTMLButtonElement>('button[title="搜尋書籤"]');
      searchToggleBtn?.click();
      await nextTick();

      const searchInput = appRoot.querySelector<HTMLInputElement>('input[placeholder*="搜尋書籤"]');
      expect(searchInput).not.toBeNull();
      expect(searchInput?.className).toContain(COMPONENT_SIZE_SPECS.sm.heightClass);
      expect(searchInput?.className).toContain(COMPONENT_SIZE_SPECS.sm.fontSizeClass);
      expect(searchInput?.className).toContain('pl-8');
      expect(searchInput?.className).toContain('pr-7');
      expect(searchInput?.className).not.toContain('focus-visible:ring-0');

      // Type into search input to show clear button
      searchInput!.value = 'test';
      searchInput!.dispatchEvent(new Event('input'));
      await nextTick();

      const clearBtn = appRoot.querySelector<HTMLButtonElement>('button[title="清除搜尋"]');
      expect(clearBtn).not.toBeNull();
      expect(clearBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);
      expect(clearBtn?.className).toContain('p-0');
      expect(clearBtn?.className).not.toContain('size-5');
      expect(clearBtn?.className).not.toContain('focus-visible:ring-0');
    });

    it('renders DropdownMenuItems governed by collection-item sm profile without business font override', async () => {
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const transferMenuBtn = appRoot.querySelector<HTMLButtonElement>(
        'button[title="書籤匯入匯出操作"]',
      );
      transferMenuBtn?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      transferMenuBtn?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const menuContent = portalRoot.querySelector<HTMLElement>(
        '[data-slot="dropdown-menu-content"]',
      );
      expect(menuContent).not.toBeNull();
      expect(menuContent?.className).not.toContain('text-[calc(');

      const items = portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]');
      expect(items.length).toBeGreaterThan(0);

      items.forEach((item) => {
        // Items receive collection-item sm profile classes from DropdownMenuItem primitive
        expect(item.className).toContain(COMPONENT_SIZE_SPECS.sm.minHeightClass);
        expect(item.className).toContain(COMPONENT_SIZE_SPECS.sm.fontSizeClass);
        // No custom business text-[calc(...)]
        expect(item.className).not.toContain('text-[calc(');
      });
    });

    it('shows confirmation with impact counts and warning, aborts on cancel, and calls clear on confirm', async () => {
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const transferMenuBtn = appRoot.querySelector<HTMLButtonElement>(
        'button[title="書籤匯入匯出操作"]',
      );
      transferMenuBtn?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      transferMenuBtn?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const items = Array.from(
        portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
      );
      const clearItem = items.find((item) => item.textContent?.includes('清空所有書籤'));
      expect(clearItem).not.toBeUndefined();

      // Test cancel: zero mutation
      poexdConfirmSpy.mockClear();
      mockClearCollection.mockClear();
      poexdConfirmSpy.mockResolvedValueOnce(false);

      clearItem?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      expect(poexdConfirmSpy).toHaveBeenCalledWith(
        expect.stringMatching(/1\s*個資料夾[\s\S]*1\s*個書籤[\s\S]*無法復原/),
        '清空所有書籤',
      );
      expect(mockClearCollection).not.toHaveBeenCalled();

      // Test confirm: calls clear once
      poexdConfirmSpy.mockClear();
      mockClearCollection.mockClear();
      poexdConfirmSpy.mockResolvedValueOnce(true);

      clearItem?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      expect(poexdConfirmSpy).toHaveBeenCalledWith(
        expect.stringMatching(/1\s*個資料夾[\s\S]*1\s*個書籤[\s\S]*無法復原/),
        '清空所有書籤',
      );
      expect(mockClearCollection).toHaveBeenCalledOnce();
    });

    it('disables clear-collection action when collection is empty and clicking it performs zero mutation', async () => {
      // Unmount previous and mount with empty collection
      app?.unmount();
      const previousCollection = mockBookmarkCollection;
      mockBookmarkCollection = { bookmarks: [], groups: [] };

      const RootComponent = defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
              h(BookmarkPane),
            ]);
        },
      });
      app = createApp(RootComponent);
      app.mount(appRoot);

      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const transferMenuBtn = appRoot.querySelector<HTMLButtonElement>(
        'button[title="書籤匯入匯出操作"]',
      );
      transferMenuBtn?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      transferMenuBtn?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const items = Array.from(
        portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
      );
      const clearItem = items.find((item) => item.textContent?.includes('清空所有書籤'));
      expect(clearItem).not.toBeUndefined();
      expect(clearItem?.hasAttribute('data-disabled')).toBe(true);

      poexdConfirmSpy.mockClear();
      mockClearCollection.mockClear();
      clearItem?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      expect(poexdConfirmSpy).not.toHaveBeenCalled();
      expect(mockClearCollection).not.toHaveBeenCalled();

      // Restore collection for other tests
      mockBookmarkCollection = previousCollection;
    });
  });
});
