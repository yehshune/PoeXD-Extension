// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { activateBookmarkRows, readBookmarkNodeSource } from './helpers/bookmark-node-source';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import SidebarPane from '@/components/sidebar/layout/SidebarPane.vue';
import HistoryPane from '@/components/sidebar/HistoryPane.vue';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import {
  COMPONENT_SIZE_SPECS,
  FORM_INDICATOR_SPECS,
  SPACING_TOKENS,
  NON_DENSITY_INVARIANTS,
  createUiRuntimeTokenValues,
} from '@/lib/tokens';
import Sortable from 'sortablejs';
import {
  createInMemorySearchRecordStorage,
  createSearchRecordModule,
} from '@/utils/search-records';

let currentSearchModule = createSearchRecordModule(createInMemorySearchRecordStorage());

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn(), option: vi.fn() })),
  },
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
  },
};

vi.mock('@/utils/search-record-messaging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/search-record-messaging')>();
  return {
    ...actual,
    createChromeSearchRecordClient: () => ({
      execute: vi.fn(async (cmd) => currentSearchModule.execute(cmd as any)),
      read: vi.fn(async (cmd) => currentSearchModule.read(cmd as any)),
      subscribe: vi.fn(() => () => {}),
    }),
  };
});

let mockBookmarkCollection = { bookmarks: [] as any[], groups: [] as any[] };
vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: mockBookmarkCollection })),
    subscribe: vi.fn(() => () => {}),
  }),
}));

const historyPaneSource = readFileSync('components/sidebar/HistoryPane.vue', 'utf8');
const bookmarkPaneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
const settingsPaneSource = readFileSync('components/sidebar/SettingsPane.vue', 'utf8');
const toolsPaneSource = readFileSync('components/sidebar/ToolsPane.vue', 'utf8');
const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8');
const sidebarPaneSource = readFileSync('components/sidebar/layout/SidebarPane.vue', 'utf8');
const mainCssSource = readFileSync('assets/main.css', 'utf8');

describe('SidebarPane layout component contract', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('renders fixed and scroll slots with canonical data-slots and layout classes', async () => {
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(
              SidebarPane,
              {},
              {
                fixed: () => h('div', { id: 'test-fixed' }, 'Fixed Area'),
                scroll: () => h('div', { id: 'test-scroll' }, 'Scroll Area'),
              },
            );
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const paneRoot = container.querySelector('[data-slot="sidebar-pane"]');
    expect(paneRoot).not.toBeNull();
    expect(paneRoot?.className).toContain('flex');
    expect(paneRoot?.className).toContain('h-full');
    expect(paneRoot?.className).toContain('min-h-0');
    expect(paneRoot?.className).toContain('flex-col');
    expect(paneRoot?.className).toContain('overflow-hidden');

    const fixedSlot = container.querySelector('[data-slot="sidebar-pane-fixed"]');
    expect(fixedSlot).not.toBeNull();
    expect(fixedSlot?.className).toContain('shrink-0');
    expect(fixedSlot?.className).toContain('p-[var(--pxd-pane-padding)]');
    expect(fixedSlot?.className).toContain('pb-0');
    expect(fixedSlot?.textContent).toBe('Fixed Area');

    const scrollSlot = container.querySelector('[data-slot="sidebar-pane-scroll"]');
    expect(scrollSlot).not.toBeNull();
    expect(scrollSlot?.className).toContain('min-h-0');
    expect(scrollSlot?.className).toContain('h-full');
    expect(scrollSlot?.className).toContain('w-full');
    expect(scrollSlot?.hasAttribute('data-reka-scroll-area-viewport')).toBe(true);

    const scrollContent = container.querySelector('[data-slot="sidebar-pane-scroll-content"]');
    expect(scrollContent).not.toBeNull();
    expect(scrollContent?.parentElement).toBe(scrollSlot);
    expect(scrollContent?.className).toContain('p-[var(--pxd-pane-padding)]');
    expect(scrollContent?.className).toContain('pt-0');
    expect(scrollContent?.textContent).toBe('Scroll Area');
  });

  it('omits fixed container and applies top padding to scroll content when fixed slot is not provided', async () => {
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(
              SidebarPane,
              {},
              {
                scroll: () => h('div', 'Only Scroll'),
              },
            );
        },
      }),
    );
    app.mount(container);
    await nextTick();

    expect(container.querySelector('[data-slot="sidebar-pane-fixed"]')).toBeNull();
    const scrollContent = container.querySelector('[data-slot="sidebar-pane-scroll-content"]');
    expect(scrollContent).not.toBeNull();
    expect(scrollContent?.className).toContain('p-[var(--pxd-pane-padding)]');
    expect(scrollContent?.className).not.toContain('pt-0');
  });

  it('renders external mode host container without internal overflow-y-auto viewport or scrollbar', async () => {
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(
              SidebarPane,
              { scrollMode: 'external' },
              {
                fixed: () => h('div', 'Fixed Area'),
                scroll: () => h('div', { id: 'consumer-scroll' }, 'Consumer Viewport'),
              },
            );
        },
      }),
    );
    app.mount(container);
    await nextTick();

    expect(container.querySelector('[data-slot="sidebar-pane-scroll"]')).toBeNull();
    const host = container.querySelector('[data-slot="sidebar-pane-scroll-host"]');
    expect(host).not.toBeNull();
    expect(host?.className).toContain('min-h-0');
    expect(host?.className).toContain('flex-1');
    expect(host?.className).toContain('overflow-hidden');
    expect(host?.className).not.toContain('overflow-y-auto');
    expect(host?.className).not.toContain('pxd-scrollbar');
    expect(host?.textContent).toContain('Consumer Viewport');
  });

  it('implements ScrollArea foundation for overlay scrollbar without pxd-scrollbar or gutter', () => {
    expect(sidebarPaneSource).toContain('ScrollAreaRoot');
    expect(sidebarPaneSource).toContain('ScrollAreaViewport');
    expect(sidebarPaneSource).toContain('ScrollBar');
    expect(sidebarPaneSource).not.toContain('pxd-scrollbar');
  });

  it('defines unified .pxd-scrollbar styling exclusively in assets/main.css', () => {
    expect(mainCssSource).toContain('.pxd-scrollbar');
    expect(mainCssSource).toContain('scrollbar-gutter: stable;');
    expect(mainCssSource).toContain('scrollbar-gutter: stable both-edges;');
    expect(mainCssSource).toContain('background: transparent');
    expect(mainCssSource).toContain('width: 4px');
    expect(mainCssSource).toContain('background: var(--border)');
    expect(mainCssSource).toContain('.pxd-scrollbar::-webkit-scrollbar-button');
    expect(mainCssSource).toContain('display: none');

    // .pxd-scrollbar only defined in assets/main.css, not duplicated in SidebarPane or Sidebar scoped style
    expect(sidebarPaneSource).not.toContain('.pxd-scrollbar::-webkit-scrollbar');
    expect(sidebarSource).not.toContain('.pxd-scrollbar');

    // Chromium retains full ::-webkit-scrollbar control: scrollbar-width/color isolated to Firefox fallback
    expect(mainCssSource).toContain('@supports not selector(::-webkit-scrollbar)');
    expect(mainCssSource).not.toMatch(/\*\s*\{[^}]*scrollbar-width/);
    expect(mainCssSource).not.toMatch(/\*\s*::-webkit-scrollbar/);
  });
});

describe('Sidebar Header activeTabName and scroll ownership contract', () => {
  it('defines activeTabName in Sidebar.vue template and exports it', () => {
    expect(sidebarSource).toContain('{{ activeTabName }}');
    expect(sidebarSource).toContain('activeTabName = computed(');
    expect(sidebarSource).toContain('activeTabName,');
  });

  it('contains header-left and active-tab-title classes in content-header', () => {
    expect(sidebarSource).toContain('header-left');
    expect(sidebarSource).toContain('active-tab-title');
    expect(sidebarSource).not.toContain('<style');
  });

  it('applies has-pane-scroll when activeTab is history, bookmark or stat-group-template (usesPaneScroll) and zeroes outer padding for edge-to-edge scroll viewport', () => {
    expect(sidebarSource).toContain('has-pane-scroll');
    expect(sidebarSource).toContain('usesPaneScroll = computed(');
    ['history', 'bookmark', 'stat-group-template'].forEach((tab) => {
      expect(sidebarSource).toContain(`activeTab.value === '${tab}'`);
    });
    expect(sidebarSource).toContain('usesPaneScroll,');
    expect(sidebarSource).toContain('p-0');
  });

  it('ensures BookmarkPane, SettingsPane, ToolsPane, and HistoryPane do not contain in-page titles', () => {
    // HistoryPane
    expect(historyPaneSource).not.toContain('<h3 class="section-title">');
    expect(historyPaneSource).not.toContain('.section-title');
    expect(historyPaneSource).not.toContain('<h3>搜尋歷史</h3>');

    // BookmarkPane
    expect(bookmarkPaneSource).not.toContain('快速書籤');
    expect(bookmarkPaneSource).not.toContain('pane-header-container');

    // SettingsPane
    expect(settingsPaneSource).not.toContain('系統設定');

    // ToolsPane
    expect(toolsPaneSource).not.toContain('工具與資訊');
  });
});

describe('HistoryPane shadcn migration & runtime integration', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    currentSearchModule = createSearchRecordModule(createInMemorySearchRecordStorage());
    await currentSearchModule.initialize();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('renders with SidebarPane and uses shadcn Checkbox, Separator without legacy classes', async () => {
    app = createApp(HistoryPane);
    app.mount(container);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));
    await nextTick();

    // 1. Verifies SidebarPane layout slots exist
    expect(container.querySelector('[data-slot="sidebar-pane"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="sidebar-pane-fixed"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="sidebar-pane-scroll"]')).not.toBeNull();

    // 2. Verifies shadcn Checkbox exists
    const checkbox = container.querySelector('[data-slot="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.className).toContain(FORM_INDICATOR_SPECS.checkbox.sizeClass);
    const indicator = checkbox?.querySelector('[data-slot="checkbox-indicator"]');
    expect(indicator).not.toBeNull();

    // 3. Verifies shadcn Separator exists
    const separator = container.querySelector('[data-slot="separator"]');
    expect(separator).not.toBeNull();

    // 4. Verifies no legacy controls or styles
    expect(container.querySelector('input[type="checkbox"]:not(.sr-only)')).toBeNull();
    expect(container.querySelector('.divider')).toBeNull();
    expect(container.querySelector('.section-title')).toBeNull();
    expect(container.querySelector('.poe-checkbox-container')).toBeNull();
    expect(container.querySelector('.poe-mini-btn')).toBeNull();

    // 5. Verifies empty state when no history
    expect(container.textContent).toContain('尚無歷史搜尋紀錄');
  });

  it('renders history entries with action buttons when history exists', async () => {
    currentSearchModule = createSearchRecordModule(
      createInMemorySearchRecordStorage({
        history_poe1: [
          {
            name: 'Chaos Orb',
            url: 'https://www.pathofexile.com/trade/search/Standard/test',
            date: new Date().toISOString(),
          },
        ],
      }),
    );
    await currentSearchModule.initialize();

    app = createApp(HistoryPane);
    app.mount(container);
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    // Verifies Chaos Orb record is rendered
    expect(container.textContent).toContain('Chaos Orb');

    // Verifies Clear All button is rendered
    const clearBtn = container.querySelector('button[title="清除所有搜尋歷史"]');
    expect(clearBtn).not.toBeNull();
    expect(clearBtn?.textContent).toContain('清除全部');

    // Verifies action buttons (ExternalLink and Delete) exist
    const newTabBtn = container.querySelector('button[title="在新分頁開啟"]');
    expect(newTabBtn).not.toBeNull();

    const deleteBtn = container.querySelector('button[title="刪除此紀錄"]');
    expect(deleteBtn).not.toBeNull();
  });
});

describe('BookmarkPane SidebarPane integration and SortableJS contract', () => {
  it('uses SidebarPane in external scrollMode without nesting an extra overflow-y-auto container', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    expect(freshBookmarkSource).toContain('<SidebarPane');
    expect(freshBookmarkSource).toContain('scroll-mode="external"');
    expect(freshBookmarkSource).not.toContain('<div class="tab-pane"');
  });

  it('preserves .bookmark-accordion-list as ScrollArea scroll viewport and retains pxd-scrollbar on league submenus', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    expect(freshBookmarkSource).toContain('bookmark-accordion-list');
    expect(freshBookmarkSource).toContain('ScrollAreaViewport');
    expect(freshBookmarkSource).not.toContain('poe-scrollbar');
    expect(freshBookmarkSource).toMatch(
      /<DropdownMenuSubContent[\s\S]*?max-h-60[\s\S]*?pxd-scrollbar/,
    );
  });

  it('preserves SortableJS DOM selectors and lifecycle identity attributes', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    const freshNodeSource = readBookmarkNodeSource();
    expect(freshBookmarkSource).toContain("useDragTrash('.bookmark-accordion-list')");
    expect(freshNodeSource).toContain(':data-group-id=');
    expect(freshNodeSource).toContain('class="group-container');
    expect(freshNodeSource).toContain('class="group-header-row');
    expect(freshNodeSource).toContain('class="bookmark-list-wrapper');
    expect(freshNodeSource).toContain('class="bookmark-row-item');
    expect(freshNodeSource).toContain(':data-id=');
    expect(freshBookmarkSource).toContain('trashZone');
  });

  it('applies secondary typography to empty bookmark folder text', () => {
    const freshNodeSource = readBookmarkNodeSource();
    expect(freshNodeSource).toContain('empty-group-text');
    expect(freshNodeSource).toMatch(
      /class="empty-group-text\s+text-\[length:var\(--pxd-font-secondary\)\]/,
    );
  });

  it('migrates toolbar and search to shadcn primitives and Lucide icons without legacy CSS', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    const freshNodeSource = readBookmarkNodeSource();
    expect(freshBookmarkSource).toContain('<Button');
    expect(freshBookmarkSource).toContain('<Input');
    expect(freshBookmarkSource).toContain('<Separator');
    expect(freshNodeSource).toContain('<Folder');
    expect(freshBookmarkSource).toContain('<Search');

    // Cleaned up legacy CSS
    expect(freshBookmarkSource).not.toContain('.tab-pane {');
    expect(freshBookmarkSource).not.toContain('.divider {');
    expect(freshBookmarkSource).not.toContain('.primary-btn {');
    expect(freshBookmarkSource).not.toContain('.controls-row {');
    expect(freshBookmarkSource).not.toContain('.search-filter-container {');
    expect(freshBookmarkSource).not.toContain('.search-toggle-btn {');
    expect(freshBookmarkSource).not.toContain('.search-input-wrapper {');
    expect(freshBookmarkSource).not.toContain('.clear-search-btn {');
  });

  it('includes box-border on .bookmark-accordion-list to prevent padding clipping under content-box', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    expect(freshBookmarkSource).toMatch(/class="[^"]*bookmark-accordion-list[^"]*box-border[^"]*"/);
  });

  it('assigns class="bookmark-pane" to SidebarPane and uses .bookmark-pane:has for drag trash ghost without stale .tab-pane', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    expect(freshBookmarkSource).toContain(
      '<SidebarPane ref="sidebarPaneRef" class="bookmark-pane"',
    );
    expect(freshBookmarkSource).toContain(
      '.bookmark-pane:has(.drag-trash-zone.drag-hover) .sortable-ghost',
    );
    expect(freshBookmarkSource).not.toContain('.tab-pane:has(');
  });

  it('uses outline instead of border for .sortable-ghost to preserve box geometry and clears outline on trash hover', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    expect(freshBookmarkSource).toMatch(
      /\.sortable-ghost\s*\{[^}]*outline:\s*1px dashed var\(--ring\)/,
    );
    expect(freshBookmarkSource).not.toMatch(/\.sortable-ghost\s*\{[^}]*border:\s*1px dashed/);
    expect(freshBookmarkSource).toMatch(
      /\.bookmark-pane:has\(\.drag-trash-zone\.drag-hover\)\s+\.sortable-ghost\s*\{[^}]*outline:\s*none !important;/,
    );
  });

  it('aligns toolbar controls and search with Foundation primitive contracts and spacing tokens', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    // Toolbar gap and padding use Foundation spacing tokens
    expect(freshBookmarkSource).toContain('gap-[var(--pxd-space-sm)]');
    expect(freshBookmarkSource).toContain('pb-[var(--pxd-space-md)]');
    // "新建資料夾" button uses size="sm" without density geometry
    expect(freshBookmarkSource).toContain('variant="default"');
    expect(freshBookmarkSource).toContain('size="sm"');
    // "全部展開" button uses standard sm size without min-width override
    expect(freshBookmarkSource).not.toContain('min-w-[calc(72px');
    // Icon buttons use size="icon-sm"
    expect(freshBookmarkSource).toContain('size="icon-sm"');
    // Separator and search margins use Foundation spacing tokens
    expect(freshBookmarkSource).toContain('mb-[var(--pxd-space-md)]');
    // Search input uses size="sm" with composite reserve
    expect(freshBookmarkSource).toMatch(/<Input[^>]*size="sm"[^>]*pl-8 pr-7/);
  });

  it('ensures empty and loading states reside inside .bookmark-accordion-list as template children', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    const accordionListIndex = freshBookmarkSource.indexOf('class="bookmark-accordion-list');
    const loadingStateIndex = freshBookmarkSource.search(
      /v-if="isLoading"[\s\S]*?class="empty-state/,
    );
    const emptyGroupIndex = freshBookmarkSource.search(
      /v-else-if="groups\.length === 0"[\s\S]*?class="empty-state/,
    );
    const closingAccordionIndex = freshBookmarkSource.indexOf('</ScrollAreaViewport>');

    expect(accordionListIndex).toBeGreaterThan(-1);
    expect(loadingStateIndex).toBeGreaterThan(accordionListIndex);
    expect(emptyGroupIndex).toBeGreaterThan(loadingStateIndex);
    expect(closingAccordionIndex).toBeGreaterThan(emptyGroupIndex);
    expect(freshBookmarkSource).not.toContain('toast-fade');
  });

  it('renders empty-state inside .bookmark-accordion-list at runtime when mounted with no folders', async () => {
    mockBookmarkCollection = { bookmarks: [], groups: [] };
    const mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);

    const testApp = createApp(BookmarkPane);
    testApp.mount(mountContainer);
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    const accordion = mountContainer.querySelector('.bookmark-accordion-list');
    expect(accordion).not.toBeNull();
    expect(accordion?.classList.contains('box-border')).toBe(true);

    const emptyState = mountContainer.querySelector('.empty-state');
    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent).toContain('尚無書籤資料');

    // Crucial: emptyState must be inside .bookmark-accordion-list, not a sibling under the flex host
    expect(accordion?.contains(emptyState)).toBe(true);

    // Ensure no redundant empty-state exists
    expect(mountContainer.querySelectorAll('.empty-state').length).toBe(1);

    testApp.unmount();
    mountContainer.remove();
  });

  it('migrates Group Header and Bookmark Row actions to shadcn Button and Lucide icons', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    const freshNodeSource = readBookmarkNodeSource();

    // Group Header actions
    expect(freshNodeSource).toMatch(/title=(?:"|&quot;)新增當前網頁到此資料夾(?:"|&quot;)/);
    expect(freshNodeSource).toContain('@click.stop="ctx.addBookmarkToGroup(node.folder.id)"');
    expect(freshNodeSource).toContain('v-model:open="isGroupMenuOpen"');

    // Bookmark Row actions
    expect(freshNodeSource).toMatch(/title=(?:"|&quot;)在新分頁開啟(?:"|&quot;)/);
    expect(freshNodeSource).toContain('@click.stop="ctx.openBookmarkNewTab(bm)"');
    expect(freshNodeSource).toContain(':open="isMenuOpen"');
    expect(freshNodeSource).toContain(':data-id="bm.id"');

    // Action visibility contracts (both Group Header and Bookmark Row use pure hover overlay)
    expect(freshNodeSource).not.toContain(
      ':class="{ \'opacity-100\': activeBookmarkMenuId === bm.id }"',
    );
    expect(freshNodeSource).not.toContain(
      ':class="{ \'opacity-100\': activeGroupMenuId === g.id }"',
    );

    // Inline rename contracts on shadcn Input
    expect(freshNodeSource).toContain('v-model="ctx.editingGroupName.value"');
    expect(freshNodeSource).toContain('@keyup.enter="ctx.saveRenameGroup"');
    expect(freshNodeSource).toContain('@keyup.escape="ctx.editingGroupId.value = null"');
    expect(freshNodeSource).toContain('v-model="ctx.editingBookmarkName.value"');
    expect(freshNodeSource).toContain('@keyup.enter="ctx.saveRenameBookmark"');
    expect(freshNodeSource).toContain('@keyup.escape="ctx.editingBookmarkId.value = null"');
  });

  it('cleans up replaced visual CSS rules and legacy dropdown styles', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    const freshNodeSource = readBookmarkNodeSource();

    // Cleaned up rules
    expect(freshBookmarkSource).not.toContain('.action-add-page-btn {');
    expect(freshBookmarkSource).not.toContain('.action-icon-btn-bm {');
    expect(freshBookmarkSource).not.toContain('.menu-trigger-btn-bm {');
    expect(freshBookmarkSource).not.toContain('.inline-edit-input {');
    expect(freshBookmarkSource).not.toContain('.inline-edit-input-bm {');
    expect(freshBookmarkSource).not.toContain('.folder-icon-svg {');
    expect(freshBookmarkSource).not.toContain('.bookmark-link {');
    expect(freshBookmarkSource).not.toContain('.action-svg-icon {');
    expect(freshBookmarkSource).not.toContain('.league-replace-item');
    expect(freshBookmarkSource).not.toContain('.league-submenu');
    expect(freshBookmarkSource).not.toContain('.group-header-row:has(.poe-dropdown-menu)');
    expect(freshBookmarkSource).not.toContain('.bookmark-row-item:has(.poe-dropdown-menu)');
    expect(freshBookmarkSource).not.toContain('.poe-dropdown-menu {');
    expect(freshBookmarkSource).not.toContain('.dropdown-item {');
    expect(freshBookmarkSource).not.toContain('.bookmark-menu {');
    expect(freshBookmarkSource).not.toContain('.dropdown-divider');
    expect(freshBookmarkSource).not.toContain('.sub-menu-back-btn');

    // Retained cover grid classes in template
    expect(freshNodeSource).toContain('cover-image-grid');
    expect(freshNodeSource).toContain('cover-image-option');
  });

  it('cleans up residual legacy button/input/modal CSS and migrates bottom add button to Button', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
    const freshNodeSource = readBookmarkNodeSource();

    // No legacy poe-btn / poe-input in template or styles
    expect(freshBookmarkSource).not.toContain('class="poe-btn');
    expect(freshBookmarkSource).not.toContain('.poe-btn {');
    expect(freshBookmarkSource).not.toContain('.poe-input {');

    // Cleaned up dead button & icon styles
    expect(freshBookmarkSource).not.toContain('.danger-btn');
    expect(freshBookmarkSource).not.toContain('.compact-btn');
    expect(freshBookmarkSource).not.toContain('.icon-btn-square');
    expect(freshBookmarkSource).not.toContain('.control-svg-icon');

    // Cleaned up dead modal styles
    expect(freshBookmarkSource).not.toContain('.poe-modal-mask');
    expect(freshBookmarkSource).not.toContain('.poe-modal-card');
    expect(freshBookmarkSource).not.toContain('.modal-title');
    expect(freshBookmarkSource).not.toContain('.modal-body');
    expect(freshBookmarkSource).not.toContain('.modal-actions-column');

    // No scoped duplicate .w-full
    expect(freshBookmarkSource).not.toContain('.w-full {');

    // Cleaned up bottom-add-btn
    expect(freshBookmarkSource).not.toContain('.bottom-add-btn');

    // Retains layout container
    expect(freshNodeSource).toContain('bookmark-bottom-add-container');

    // Bottom add action uses shadcn Button with click handler
    expect(freshNodeSource).toContain('＋ 新增當前網頁');
    expect(freshNodeSource).toMatch(
      /<Button[^>]*@click\.stop="ctx\.addBookmarkToGroup\(node\.folder\.id\)"[^>]*>[\s\S]*?＋ 新增當前網頁/,
    );
  });

  it('renders group headers, bookmark rows, and shadcn buttons at runtime when data exists', async () => {
    mockBookmarkCollection = {
      bookmarks: [
        {
          id: 'bm-test-1',
          name: 'Mageblood Search',
          url: 'https://www.pathofexile.com/trade/search/Standard/test-mageblood',
          groupId: 'grp-test-1',
          order: 0,
        },
      ],
      groups: [
        {
          id: 'grp-test-1',
          name: 'Unique Belts',
          order: 0,
        },
      ],
    };

    const mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);

    const testApp = createApp(BookmarkPane);
    testApp.mount(mountContainer);
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    // Verify folder group rendering
    const groupRow = mountContainer.querySelector('.group-header-row');
    expect(groupRow).not.toBeNull();
    expect(groupRow?.textContent).toContain('Unique Belts');
    expect(groupRow?.textContent).toContain('(1)');

    // Verify group actions (menu button)
    const groupMenuBtn = groupRow?.querySelector('button[title="操作選單"]');
    expect(groupMenuBtn).not.toBeNull();

    // Verify bookmark row rendering with data-id
    const bmRow = mountContainer.querySelector('.bookmark-row-item[data-id="bm-test-1"]');
    expect(bmRow).not.toBeNull();
    expect(bmRow?.textContent).toContain('Mageblood Search');

    // Verify bookmark action buttons: external quick button and menu button present
    await activateBookmarkRows(mountContainer);
    const newTabBtn = bmRow?.querySelector('button[title="在新分頁開啟"]');
    expect(newTabBtn).not.toBeNull();
    const bmMenuBtn = bmRow?.querySelector('button[title="操作選單"]');
    expect(bmMenuBtn).not.toBeNull();

    testApp.unmount();
    mountContainer.remove();
  });

  it('enforces no-Preflight border contract on Group Header (border-0 and border-solid accompanying border-l-2)', () => {
    const freshNodeSource = readBookmarkNodeSource();

    // Group Header class must explicitly define border-0 and border-solid alongside border-l-2
    expect(freshNodeSource).toContain('border-0 border-solid border-l-2 border-l-primary');

    // Ensure no scoped .group-header-row border CSS is introduced
    expect(freshNodeSource).not.toMatch(/\.group-header-row\s*\{[^}]*border/);
  });

  it('initializes SortableJS via a single path without double-init on initial mount', async () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');

    // Static contract: onMounted finally block must not invoke initSortable directly
    expect(freshBookmarkSource).not.toMatch(/finally\s*\{[^}]*initSortable\(\)/);

    // Watcher must handle loading false post-flush
    expect(freshBookmarkSource).toContain('watch(');
    expect(freshBookmarkSource).toContain('[sortableStructure, isLoading]');
    expect(freshBookmarkSource).toContain('if (!loading) void initSortable();');

    // Runtime verification: loading true -> false produces exactly one init pass
    mockBookmarkCollection = {
      bookmarks: [
        {
          id: 'bm-single-init-1',
          name: 'Headhunter',
          url: 'https://www.pathofexile.com/trade/search/Standard/test-hh',
          groupId: 'grp-single-init-1',
          order: 0,
        },
      ],
      groups: [
        {
          id: 'grp-single-init-1',
          name: 'Chanced Items',
          order: 0,
        },
      ],
    };

    vi.mocked(Sortable.create).mockClear();

    const mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);

    const testApp = createApp(BookmarkPane);
    testApp.mount(mountContainer);
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    // 1 call for groupSortable (.bookmark-accordion-list) + 1 call for bookmarkSortable (.bookmark-list-wrapper)
    // If double-init occurred, this would be 4 calls
    expect(Sortable.create).toHaveBeenCalledTimes(2);

    testApp.unmount();
    mountContainer.remove();
  });
});

describe('Sidebar Scroll End Breathing Room contract (--pxd-pane-scroll-end-space)', () => {
  it('1. runtime token generates expected 72px baseline at 100% scale', () => {
    const tokens = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
    expect(tokens['--pxd-pane-scroll-end-space']).toBe('72px');
    expect(SPACING_TOKENS.paneScrollEndSpacePx).toBe(72);
    expect(SPACING_TOKENS.paneScrollEndSpaceVar).toBe('--pxd-pane-scroll-end-space');
  });

  it('2. scroll-end space scales proportionally with UI Scale', () => {
    const smTokens = createUiRuntimeTokenValues({ scale: 0.85, density: 1.0 });
    expect(smTokens['--pxd-pane-scroll-end-space']).toBe('61.2px');

    const lgTokens = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });
    expect(lgTokens['--pxd-pane-scroll-end-space']).toBe('86.4px');
  });

  it('3. scroll-end space is density invariant (identical between default and compact)', () => {
    const defaultTokens = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
    const compactTokens = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });
    expect(compactTokens['--pxd-pane-scroll-end-space']).toBe(
      defaultTokens['--pxd-pane-scroll-end-space'],
    );
    expect(compactTokens['--pxd-pane-scroll-end-space']).toBe('72px');
    expect(NON_DENSITY_INVARIANTS).toContain('pane-scroll-end-space');
  });

  it('4. SidebarPane internal scroll content uses --pxd-pane-scroll-end-space', () => {
    const paneSource = readFileSync('components/sidebar/layout/SidebarPane.vue', 'utf-8');
    expect(paneSource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
    expect(paneSource).toMatch(
      /sidebar-pane-scroll-content[\s\S]*?pb-\[var\(--pxd-pane-scroll-end-space\)\]/,
    );
  });

  it('5. BookmarkPane external scroll owner uses the same --pxd-pane-scroll-end-space and wraps content with shrink-0', () => {
    const freshBookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf-8');
    expect(freshBookmarkSource).toContain('bookmark-accordion-list');
    expect(freshBookmarkSource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
    // Ensure bookmark-sortable-root does not allow flex-shrink to truncate its layout box
    expect(freshBookmarkSource).toMatch(/bookmark-sortable-root[^>]*shrink-0/);
    expect(freshBookmarkSource).not.toMatch(/bookmark-sortable-root[^>]*min-h-0/);
  });

  it('6. Settings scroll path in Sidebar.vue uses the same --pxd-pane-scroll-end-space', () => {
    const freshSidebarSource = readFileSync('components/Sidebar.vue', 'utf-8');
    expect(freshSidebarSource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
    expect(freshSidebarSource).toMatch(
      /p-\[var\(--pxd-pane-padding\)\]\s+pb-\[var\(--pxd-pane-scroll-end-space\)\]/,
    );
  });

  it('7. does not produce parent + child double bottom spacing when usesPaneScroll is true', () => {
    const freshSidebarSource = readFileSync('components/Sidebar.vue', 'utf-8');
    expect(freshSidebarSource).toMatch(/usesPaneScroll\s*\?\s*['"]has-pane-scroll[^'"]*p-0['"]/);
  });
});
