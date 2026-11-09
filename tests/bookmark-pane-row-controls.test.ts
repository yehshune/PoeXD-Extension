// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { activateBookmarkRows, readBookmarkNodeSource } from './helpers/bookmark-node-source';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import {
  COMPONENT_SIZE_SPECS,
  calcEffectiveSpacing,
  createUiRuntimeTokenValues,
  SPACING_TOKENS,
} from '@/lib/tokens';

const bookmarkPaneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
const bookmarkFolderNodeSource = readBookmarkNodeSource();

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

const mockChromeStorageData: Record<string, any> = {
  addBookmarkBtnPosition: 'top',
};

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

describe('Business Layer Migration Phase 2B — BookmarkPane Group / Bookmark Row Controls', () => {
  describe('1. Static Source Contracts: Group Header Row & Rename', () => {
    it('uses Scale-aware foundation icon token for folder icon and not hardcoded size-3.5', () => {
      expect(bookmarkFolderNodeSource).toContain('size-[var(--control-icon-sm,14px)]');
      expect(bookmarkFolderNodeSource).not.toMatch(/<Folder[^>]*size-3\.5/);
    });

    it('uses Input size="sm" for Group Rename without manual geometry or focus-visible:ring-0', () => {
      expect(bookmarkFolderNodeSource).toMatch(
        /<Input[^>]*v-model="ctx\.editingGroupName\.value"[^>]*size="sm"[^>]*class="w-full min-w-0"/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingGroupName\.value"[^>]*h-\[calc/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingGroupName\.value"[^>]*px-1\.5/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingGroupName\.value"[^>]*py-0\.5/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingGroupName\.value"[^>]*rounded-none/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingGroupName\.value"[^>]*focus-visible:ring-0/,
      );
    });

    it('uses Button size="icon-sm" for Group Top Add-Current action and removes 18px geometry', () => {
      expect(bookmarkFolderNodeSource).toMatch(
        /v-if="shouldShowHeaderAdd"[^>]*variant="ghost"[^>]*size="icon-sm"[^>]*class="font-bold"/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /title=(?:"|&quot;)新增當前網頁到此資料夾(?:"|&quot;)[^>]*h-\[calc\(18px/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /title=(?:"|&quot;)新增當前網頁到此資料夾(?:"|&quot;)[^>]*leading-none/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /title=(?:"|&quot;)新增當前網頁到此資料夾(?:"|&quot;)[^>]*rounded-none/,
      );
    });

    it('uses Button size="icon-sm" for Group Menu trigger and eliminates size-5 / p-0 / focus-visible:ring-0', () => {
      expect(bookmarkFolderNodeSource).toMatch(
        /<Button[^>]*variant="ghost"[^>]*size="icon-sm"[^>]*title=(?:"|&quot;)操作選單(?:"|&quot;)/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(/isGroupMenuOpen[\s\S]*?size-5/);
      expect(bookmarkFolderNodeSource).not.toMatch(/isGroupMenuOpen[\s\S]*?focus-visible:ring-0/);
      expect(bookmarkFolderNodeSource).toMatch(/isGroupMenuOpen[\s\S]*?<MoreVertical \/>/);
    });
  });

  describe('2. Static Source Contracts: Bookmark Row Items & Actions', () => {
    it('uses Input size="sm" for Bookmark Rename with full-width w-full min-w-0 without manual height, density, or focus-visible:ring-0', () => {
      expect(bookmarkFolderNodeSource).toMatch(
        /<Input[^>]*v-model="ctx\.editingBookmarkName\.value"[^>]*size="sm"[^>]*class="w-full min-w-0"/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingBookmarkName\.value"[^>]*w-\[90%\]/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingBookmarkName\.value"[^>]*h-\[calc/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-model="ctx\.editingBookmarkName\.value"[^>]*focus-visible:ring-0/,
      );
    });

    it('ensures Bookmark Link has accessible keyboard focus ring instead of bare outline-none', () => {
      expect(bookmarkFolderNodeSource).toMatch(
        /class="bookmark-link[^"]*focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(/class="bookmark-link[^"]*\soutline-none\s/);
    });

    it('uses Button size="icon-sm" for Bookmark Row actions including quick external link and context menu button', () => {
      // External link quick button on row
      expect(bookmarkFolderNodeSource).toMatch(
        /<Button[^>]*variant="ghost"[^>]*size="icon-sm"[^>]*title=(?:"|&quot;)在新分頁開啟(?:"|&quot;)/,
      );
      expect(bookmarkFolderNodeSource).toMatch(/@click\.stop="ctx\.openBookmarkNewTab\(bm\)"/);

      // Bookmark context menu button
      expect(bookmarkFolderNodeSource).toMatch(
        /<Button[^>]*variant="ghost"[^>]*size="icon-sm"[^>]*title=(?:"|&quot;)操作選單(?:"|&quot;)/,
      );
      expect(bookmarkFolderNodeSource).toMatch(/isMenuOpen[\s\S]*?<MoreVertical \/>/);

      // No size-5 or focus-visible:ring-0 on bookmark row actions
      expect(bookmarkFolderNodeSource).not.toContain('size-5');
      expect(bookmarkFolderNodeSource).not.toContain('focus-visible:ring-0');
    });

    it('uses Button size="sm" for Bottom Add-Current action', () => {
      expect(bookmarkFolderNodeSource).toMatch(
        /v-if="shouldShowBottomAdd"[\s\S]*?<Button[^>]*variant="secondary"[^>]*size="sm"[^>]*class="w-full font-bold"/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-if="ctx\.addBookmarkBtnPosition\.value === 'bottom'"[\s\S]*?h-auto/,
      );
      expect(bookmarkFolderNodeSource).not.toMatch(
        /v-if="ctx\.addBookmarkBtnPosition\.value === 'bottom'"[\s\S]*?py-\[calc/,
      );
    });
  });

  describe('3. Static Source Contracts: Row Layout Density & Spacing', () => {
    it('enforces class-first layout ownership for group header and row item padding/gaps', () => {
      expect(bookmarkFolderNodeSource).toContain(
        'py-[var(--pxd-bookmark-folder-header-padding-y)] px-[var(--pxd-space-lg)]',
      );
      expect(bookmarkFolderNodeSource).toContain(
        'py-[var(--pxd-bookmark-row-padding-y)] px-[var(--pxd-space-md)]',
      );
      expect(bookmarkFolderNodeSource).toContain('gap-[var(--pxd-space-lg)]');
      expect(bookmarkFolderNodeSource).toContain('gap-[var(--pxd-space-md)]');
      expect(bookmarkFolderNodeSource).toContain('gap-[var(--pxd-space-sm)]');
    });

    it('guarantees complete purge of var(--poexd-density-scale) from the entire BookmarkPane.vue', () => {
      expect(bookmarkPaneSource).not.toContain('var(--poexd-density-scale');
      expect(bookmarkFolderNodeSource).not.toContain('var(--poexd-density-scale');
    });

    it('ensures scoped CSS does not retain group-actions rules', () => {
      const styleSection = bookmarkPaneSource.substring(
        bookmarkPaneSource.indexOf('<style scoped>'),
      );
      expect(styleSection).not.toContain('.group-actions');
    });

    it('enforces absolute overlay with opaque Theme background and local z-index for bookmark-item-actions', () => {
      expect(bookmarkFolderNodeSource).toContain('bookmark-item-actions');
      expect(bookmarkFolderNodeSource).toContain('absolute');
      expect(bookmarkFolderNodeSource).toContain('right-[var(--pxd-space-md)]');
      expect(bookmarkFolderNodeSource).toContain('top-1/2 -translate-y-1/2');
      expect(bookmarkFolderNodeSource).toContain('z-[1]');
      expect(bookmarkFolderNodeSource).toContain(
        'bg-[color-mix(in_srgb,var(--muted)_40%,var(--background))]',
      );
      expect(bookmarkFolderNodeSource).toContain('group-hover:opacity-100');
      expect(bookmarkFolderNodeSource).toContain('group-hover:pointer-events-auto');
    });
  });

  describe('4. Runtime DOM Geometry & Verification', () => {
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

    it('renders Group row controls with standard sm and icon-sm primitive geometry classes', async () => {
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // Group Top Add-Current button
      const groupAddBtn = appRoot.querySelector<HTMLButtonElement>(
        'button[title="新增當前網頁到此資料夾"]',
      );
      expect(groupAddBtn).not.toBeNull();
      expect(groupAddBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);
      expect(groupAddBtn?.className).not.toContain('h-[calc(18px');

      // Group menu trigger button
      const groupMenuBtn = appRoot.querySelector<HTMLButtonElement>(
        '.group-actions button[title="操作選單"]',
      );
      expect(groupMenuBtn).not.toBeNull();
      expect(groupMenuBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);
      expect(groupMenuBtn?.className).toContain('p-0');
      expect(groupMenuBtn?.className).not.toContain('size-5');
    });

    it('aligns Bookmark row to Folder header overlay contract with full-width title and conditional action mounting', async () => {
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      await activateBookmarkRows(appRoot);
      const row = appRoot.querySelector<HTMLElement>('.bookmark-row-item');
      expect(row).not.toBeNull();
      expect(row?.className).toContain('last:border-b-0');

      // 1. Title wrapper uses full available width
      const titleWrapper = row?.firstElementChild as HTMLElement;
      expect(titleWrapper).not.toBeNull();
      expect(titleWrapper.className).toContain('w-full');
      expect(titleWrapper.className).toContain('min-w-0');

      // 2. Quick action: ExternalLink quick button exists on row
      const quickOpenBtn = row?.querySelector<HTMLButtonElement>('button[title="在新分頁開啟"]');
      expect(quickOpenBtn).not.toBeNull();
      expect(quickOpenBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);

      // 3. Bookmark row menu button rendered with icon-sm
      const bmMenuBtn = row?.querySelector<HTMLButtonElement>(
        '.bookmark-item-actions button[title="操作選單"]',
      );
      expect(bmMenuBtn).not.toBeNull();
      expect(bmMenuBtn?.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);
      expect(bmMenuBtn?.className).toContain('p-0');

      // 4. Actions container is present initially
      const actions = row?.querySelector<HTMLElement>('.bookmark-item-actions');
      expect(actions).not.toBeNull();

      // 5. Open menu and trigger rename to verify conditional unmounting & full-width rename input
      bmMenuBtn?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      bmMenuBtn?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const renameItem = Array.from(
        portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
      ).find((i) => i.textContent?.includes('重新命名'));
      expect(renameItem).toBeDefined();
      renameItem?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // Actions completely unmounted from DOM during rename
      expect(row?.querySelector('.bookmark-item-actions')).toBeNull();

      // Rename input takes full width
      const renameInput = row?.querySelector<HTMLInputElement>('input');
      expect(renameInput).not.toBeNull();
      expect(renameInput?.className).toContain('w-full');
      expect(renameInput?.className).toContain('min-w-0');

      // Cancel rename -> actions restored
      renameInput?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      expect(row?.querySelector('.bookmark-item-actions')).not.toBeNull();
    });

    it('renders accessible keyboard focus ring on bookmark anchor', async () => {
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const bookmarkLink = appRoot.querySelector<HTMLAnchorElement>('a.bookmark-link');
      expect(bookmarkLink).not.toBeNull();
      expect(bookmarkLink?.className).toContain('focus-visible:outline-none');
      expect(bookmarkLink?.className).toContain('focus-visible:ring-1');
      expect(bookmarkLink?.className).toContain('focus-visible:ring-ring');
    });

    it('proves Scale changes control geometry while Density exclusively alters layout spacing', () => {
      // Default: scale 1.0, density 1.0
      const tDefault = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
      // Scaled: scale 1.2, density 1.0
      const tScale = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });
      // Compact: scale 1.0, density 0.8
      const tDensity = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });

      // 1. Control Geometry is affected by Scale:
      expect(tScale[COMPONENT_SIZE_SPECS.sm.heightVar]).not.toBe(
        tDefault[COMPONENT_SIZE_SPECS.sm.heightVar],
      );
      expect(tScale[COMPONENT_SIZE_SPECS.sm.heightVar]).toBe('33.6px'); // 28 * 1.2 = 33.6px
      expect(tScale[COMPONENT_SIZE_SPECS.sm.fontVar]).toBe('14.4px'); // 12 * 1.2 = 14.4px
      expect(tScale[COMPONENT_SIZE_SPECS.sm.iconVar]).toBe('16.8px'); // 14 * 1.2 = 16.8px

      // 2. Control Geometry is NEVER affected by Density:
      expect(tDensity[COMPONENT_SIZE_SPECS.sm.heightVar]).toBe(
        tDefault[COMPONENT_SIZE_SPECS.sm.heightVar],
      );
      expect(tDensity[COMPONENT_SIZE_SPECS.sm.fontVar]).toBe(
        tDefault[COMPONENT_SIZE_SPECS.sm.fontVar],
      );
      expect(tDensity[COMPONENT_SIZE_SPECS.sm.iconVar]).toBe(
        tDefault[COMPONENT_SIZE_SPECS.sm.iconVar],
      );
      expect(tDensity[COMPONENT_SIZE_SPECS.sm.buttonPaddingXVar]).toBe(
        tDefault[COMPONENT_SIZE_SPECS.sm.buttonPaddingXVar],
      );

      // 3. Layout Spacing is affected by both Scale and Density:
      expect(tDefault[SPACING_TOKENS.spaceXsVar]).toBe('4px');
      expect(tDefault[SPACING_TOKENS.spaceSmVar]).toBe('6px');
      expect(tDefault[SPACING_TOKENS.spaceMdVar]).toBe('8px');

      // Density compact (0.8) shrinks layout spacing:
      expect(tDensity[SPACING_TOKENS.spaceXsVar]).toBe('3.2px'); // 4 * 0.8 = 3.2px
      expect(tDensity[SPACING_TOKENS.spaceSmVar]).toBe('4.8px'); // 6 * 0.8 = 4.8px
      expect(tDensity[SPACING_TOKENS.spaceMdVar]).toBe('6.4px'); // 8 * 0.8 = 6.4px
      expect(tDensity[SPACING_TOKENS.rowGapVar]).toBe('6.4px'); // 8 * 0.8 = 6.4px
    });

    it('removes bottom dashed divider on last bookmark row item', () => {
      expect(bookmarkFolderNodeSource).toContain('last:border-b-0');
    });
  });
});
