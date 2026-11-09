// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { readBookmarkNodeSource } from './helpers/bookmark-node-source';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import { SPACING_TOKENS, createUiRuntimeTokenValues } from '@/lib/tokens';

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
    { id: 'group-1', name: '通貨' },
    { id: 'group-2', name: '裝備' },
  ],
};

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: mockBookmarkCollection })),
    putGroup: vi.fn(async () => ({ ok: true })),
    deleteGroup: vi.fn(async () => ({ ok: true })),
    reorderGroups: vi.fn(async () => ({ ok: true })),
    putBookmark: vi.fn(async () => ({ ok: true })),
    deleteBookmark: vi.fn(async () => ({ ok: true })),
    reorderBookmarks: vi.fn(async () => ({ ok: true })),
    exportTransfer: vi.fn(async () => ({ ok: true })),
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

describe('Bookmark Folder Header & Density Ownership Contracts', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: App | null = null;

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

  describe('1. Bookmark Folder Header Layout & Actions Overlay', () => {
    it('verifies group-header-row is relative and title container spans full width without reserving flex space for actions', async () => {
      const containers = getGroupContainers();
      expect(containers.length).toBeGreaterThanOrEqual(2);

      const headerRow = containers[0].querySelector<HTMLElement>('.group-header-row');
      expect(headerRow).not.toBeNull();
      expect(headerRow?.className).toContain('relative');

      // Title wrapper has w-full and min-w-0
      const titleWrapper = headerRow?.firstElementChild as HTMLElement;
      expect(titleWrapper).not.toBeNull();
      expect(titleWrapper.className).toContain('w-full');
      expect(titleWrapper.className).toContain('min-w-0');

      // Title text has truncate
      const titleSpan = titleWrapper.querySelector('span.truncate');
      expect(titleSpan).not.toBeNull();
      expect(titleSpan?.textContent).toBe('通貨');
    });

    it('conditionally hides group-actions completely from DOM during group rename (editing)', async () => {
      const group1 = getGroupContainers()[0];
      let groupActions = group1.querySelector<HTMLElement>('.group-actions');
      expect(groupActions).not.toBeNull();

      // Open group menu
      const trigger = groupActions?.querySelector<HTMLButtonElement>('button[title="操作選單"]');
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      trigger?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // Click rename
      const renameItem = Array.from(
        portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
      ).find((i) => i.textContent?.includes('重新命名'));
      expect(renameItem).toBeDefined();
      renameItem?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // During rename: group-actions MUST be conditionally unmounted from DOM
      groupActions = group1.querySelector<HTMLElement>('.group-actions');
      expect(groupActions).toBeNull();

      // Rename input takes full width
      const renameInput = group1.querySelector<HTMLInputElement>('input');
      expect(renameInput).not.toBeNull();
      expect(renameInput?.className).toContain('w-full');
      expect(renameInput?.className).toContain('min-w-0');

      // Cancel rename -> group-actions is restored
      renameInput?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      groupActions = group1.querySelector<HTMLElement>('.group-actions');
      expect(groupActions).not.toBeNull();
    });

    it('conditionally hides group-actions completely from DOM when isDragging is active', () => {
      const source = readBookmarkNodeSource();

      // Uses conditional render with editingGroupId and isDragging
      expect(source).toContain(
        'v-if="ctx.editingGroupId.value !== node.folder.id && !ctx.isDragging.value"',
      );
    });

    it('enforces absolute overlay positioning for group-actions without focus-within trigger', () => {
      const source = readBookmarkNodeSource();

      // group-actions is absolute overlay with density-aware spacing, local stacking layer, and opaque theme background
      expect(source).toContain('group-actions');
      expect(source).toContain('absolute');
      expect(source).toContain('right-[var(--pxd-space-md)]');
      expect(source).toContain('top-1/2 -translate-y-1/2');
      expect(source).toContain('z-[1]');
      expect(source).toContain('bg-[color-mix(in_srgb,var(--muted)_70%,var(--card))]');
      expect(source).toContain('group-hover:opacity-100');
      expect(source).toContain('group-hover:pointer-events-auto');

      // Must NOT show on focus-within
      expect(source).not.toContain('group-header-row:focus-within');
    });
  });

  describe('2. Density Single Ownership & Spacing Tokens Audit', () => {
    it('converges folder vertical spacing to single owner without double ownership', () => {
      const paneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
      const nodeSource = readBookmarkNodeSource();

      // .bookmark-accordion-list owns the gap via single SSOT --pxd-bookmark-tree-gap
      expect(paneSource).toContain('gap-[var(--pxd-bookmark-tree-gap)]');

      // .group-container does NOT add extra margin-bottom
      expect(nodeSource).toContain('mb-0');
      expect(nodeSource).not.toContain('mb-[var(--pxd-space-xs)]');

      // Single SSOT: BookmarkPane does NOT duplicate or override --pxd-bookmark-tree-gap in scoped CSS
      expect(paneSource).not.toMatch(/\.bookmark-pane\s*\{[^}]*--pxd-bookmark-tree-gap/);
    });

    it('governs all primary Bookmark whitespace through density-aware tokens', () => {
      const paneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
      const nodeSource = readBookmarkNodeSource();

      // Folder header padding (semantic vertical token, horizontal preserved space-lg)
      expect(nodeSource).toContain(
        'py-[var(--pxd-bookmark-folder-header-padding-y)] px-[var(--pxd-space-lg)]',
      );
      // Folder body padding (semantic vertical token, horizontal preserved)
      expect(nodeSource).toContain(
        'pt-[var(--pxd-bookmark-folder-body-padding-y)] pb-[var(--pxd-bookmark-folder-body-padding-y)]',
      );
      expect(nodeSource).toContain('pr-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)]');
      // Bookmark row padding & gap (semantic vertical token)
      expect(nodeSource).toContain(
        'py-[var(--pxd-bookmark-row-padding-y)] px-[var(--pxd-space-md)]',
      );
      expect(nodeSource).toContain('gap-[var(--pxd-space-lg)]');
      // Bookmark row list gap
      expect(nodeSource).toContain('gap-[var(--pxd-space-xs)]');
      // Bottom add container margin
      expect(nodeSource).toContain('mt-[var(--pxd-bookmark-tree-gap)]');
      // Empty state padding
      expect(paneSource).toContain('py-[var(--pxd-space-2xl)]');
    });
  });

  describe('3. Bookmark Compact Mode Spacing & Density Convergence Contracts', () => {
    it('verifies Default density 1.0 strictly matches pre-convergence baseline without any reduction', () => {
      const defaultTokens = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });

      // Default maintains 100% pre-convergence baseline:
      // - header padding-y: 12px (space-lg baseline)
      // - bookmark row padding-y: 6px (space-sm baseline)
      // - folder body padding-y: 6px (space-sm baseline)
      // - tree gap: 8px (row-gap / space-md baseline)
      expect(defaultTokens[SPACING_TOKENS.bookmarkFolderHeaderPaddingYVar]).toBe('12px');
      expect(defaultTokens[SPACING_TOKENS.bookmarkRowPaddingYVar]).toBe('6px');
      expect(defaultTokens[SPACING_TOKENS.bookmarkFolderBodyPaddingYVar]).toBe('6px');
      expect(defaultTokens[SPACING_TOKENS.bookmarkTreeGapVar]).toBe('8px');

      // Global row-gap is unchanged
      expect(defaultTokens[SPACING_TOKENS.rowGapVar]).toBe('8px');

      // Default geometry exact match:
      // Collapsed folder height: 18px content + 2px border + 2 * 12px = 44px
      const collapsedFolderHeight =
        18 + 2 + parseFloat(defaultTokens[SPACING_TOKENS.bookmarkFolderHeaderPaddingYVar]) * 2;
      expect(collapsedFolderHeight).toBe(44);

      // Bookmark row height: 28px cover + 1px border + 2 * 6px = 41px
      const bookmarkRowHeight =
        28 + 1 + parseFloat(defaultTokens[SPACING_TOKENS.bookmarkRowPaddingYVar]) * 2;
      expect(bookmarkRowHeight).toBe(41);
    });

    it('verifies Compact density 0.8 activates tighter spacing tier and achieves 15-25% viewport capacity gain', () => {
      const defaultTokens = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
      const compactTokens = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });

      // Compact activates tightened spacing tier:
      // - header padding-y: space-md scale (8 * 0.8 = 6.4px)
      // - bookmark row padding-y: space-xs scale (4 * 0.8 = 3.2px)
      // - folder body padding-y: space-xs scale (4 * 0.8 = 3.2px)
      // - tree gap: space-sm scale (6 * 0.8 = 4.8px)
      expect(compactTokens[SPACING_TOKENS.bookmarkFolderHeaderPaddingYVar]).toBe('6.4px');
      expect(compactTokens[SPACING_TOKENS.bookmarkRowPaddingYVar]).toBe('3.2px');
      expect(compactTokens[SPACING_TOKENS.bookmarkFolderBodyPaddingYVar]).toBe('3.2px');
      expect(compactTokens[SPACING_TOKENS.bookmarkTreeGapVar]).toBe('4.8px');

      // Horizontal dimensions remain intact (preserving hierarchy / readability)
      expect(compactTokens[SPACING_TOKENS.spaceLgVar]).toBe('9.6px');
      expect(compactTokens[SPACING_TOKENS.spaceMdVar]).toBe('6.4px');

      // Compact Mode Height Comparison:
      // Collapsed folder height: ~18px title content + 2px border + 2 * padding
      // Before (p-space-lg): 18 + 2 + 19.2 = 39.2px
      // After (py-bookmarkFolderHeaderPaddingY): 18 + 2 + 12.8 = 32.8px -> 16.3% height reduction per collapsed card
      const collapsedBeforeCompact =
        18 + 2 + parseFloat(compactTokens[SPACING_TOKENS.spaceLgVar]) * 2;
      const collapsedAfterCompact =
        18 + 2 + parseFloat(compactTokens[SPACING_TOKENS.bookmarkFolderHeaderPaddingYVar]) * 2;
      const collapsedReductionPct =
        ((collapsedBeforeCompact - collapsedAfterCompact) / collapsedBeforeCompact) * 100;
      expect(collapsedReductionPct).toBeGreaterThan(15);

      // Total card footprint including gap: before 39.2 + 6.4 = 45.6px; after 32.8 + 4.8 = 37.6px
      // Viewport item capacity increase = (45.6 - 37.6) / 37.6 = 21.3% more items in same viewport height (meets 15-25% target)
      const footprintBefore =
        collapsedBeforeCompact + parseFloat(compactTokens[SPACING_TOKENS.rowGapVar]);
      const footprintAfter =
        collapsedAfterCompact + parseFloat(compactTokens[SPACING_TOKENS.bookmarkTreeGapVar]);
      const capacityIncreasePct = ((footprintBefore - footprintAfter) / footprintAfter) * 100;
      expect(capacityIncreasePct).toBeGreaterThanOrEqual(15);
      expect(capacityIncreasePct).toBeLessThanOrEqual(25);

      // Bookmark row height: 28px cover + 1px border + 2 * padding
      // Before (py-space-sm): 28 + 1 + 9.6 = 38.6px
      // After (py-bookmarkRowPaddingY): 28 + 1 + 6.4 = 35.4px -> 3.2px reduction per row
      const rowBeforeCompact = 28 + 1 + parseFloat(compactTokens[SPACING_TOKENS.spaceSmVar]) * 2;
      const rowAfterCompact =
        28 + 1 + parseFloat(compactTokens[SPACING_TOKENS.bookmarkRowPaddingYVar]) * 2;
      expect(rowBeforeCompact - rowAfterCompact).toBeCloseTo(3.2, 1);
    });

    it('verifies Comfortable density 1.2 scales default baseline proportionally without distortion', () => {
      const comfortableTokens = createUiRuntimeTokenValues({ scale: 1.0, density: 1.2 });

      // Comfortable mode scales default baseline smoothly:
      // - header: 12 * 1.2 = 14.4px
      // - row: 6 * 1.2 = 7.2px
      // - body: 6 * 1.2 = 7.2px
      // - tree gap: 8 * 1.2 = 9.6px
      expect(comfortableTokens[SPACING_TOKENS.bookmarkFolderHeaderPaddingYVar]).toBe('14.4px');
      expect(comfortableTokens[SPACING_TOKENS.bookmarkRowPaddingYVar]).toBe('7.2px');
      expect(comfortableTokens[SPACING_TOKENS.bookmarkFolderBodyPaddingYVar]).toBe('7.2px');
      expect(comfortableTokens[SPACING_TOKENS.bookmarkTreeGapVar]).toBe('9.6px');
    });
  });
});
