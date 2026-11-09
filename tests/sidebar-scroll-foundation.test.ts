// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted, onUnmounted, type App } from 'vue';
import { readFileSync } from 'fs';
import {
  ScrollArea,
  ScrollBar,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
} from '@/components/ui/scroll-area';
import SidebarPane from '@/components/sidebar/layout/SidebarPane.vue';
import Sidebar from '@/components/Sidebar.vue';

// Spy records for child pane mount persistence
const paneMountCounts = {
  bookmark: 0,
  history: 0,
  tools: 0,
  settings: 0,
  liveSearchPrimary: 0,
  liveSearchConsoleSettings: 0,
};
const paneUnmountCounts = {
  bookmark: 0,
  history: 0,
  tools: 0,
  settings: 0,
  liveSearchPrimary: 0,
  liveSearchConsoleSettings: 0,
};

function resetPaneCounts() {
  paneMountCounts.bookmark = 0;
  paneMountCounts.history = 0;
  paneMountCounts.tools = 0;
  paneMountCounts.settings = 0;
  paneMountCounts.liveSearchPrimary = 0;
  paneMountCounts.liveSearchConsoleSettings = 0;
  paneUnmountCounts.bookmark = 0;
  paneUnmountCounts.history = 0;
  paneUnmountCounts.tools = 0;
  paneUnmountCounts.settings = 0;
  paneUnmountCounts.liveSearchPrimary = 0;
  paneUnmountCounts.liveSearchConsoleSettings = 0;
}

vi.mock('@/components/sidebar/FilterPane.vue', () => ({
  default: defineComponent({
    name: 'FilterPane',
    setup() {
      return () => h('div', { 'data-test': 'filter-pane-mock' });
    },
  }),
}));

vi.mock('@/components/sidebar/TemporarySearchDialog.vue', () => ({
  default: defineComponent({
    name: 'TemporarySearchDialog',
    props: ['open', 'sourceController'],
    emits: ['update:open'],
    setup(props, { emit }) {
      return () =>
        props.open
          ? h('div', {
              'data-test': 'temporary-search-dialog-mock',
              onClick: () => emit('update:open', false),
            })
          : null;
    },
  }),
}));

vi.mock('@/components/sidebar/BookmarkPane.vue', () => ({
  default: defineComponent({
    name: 'BookmarkPane',
    setup() {
      paneMountCounts.bookmark++;
      onUnmounted(() => {
        paneUnmountCounts.bookmark++;
      });
      return () =>
        h(
          SidebarPane,
          { class: 'bookmark-pane', scrollMode: 'external', 'data-test': 'bookmark-pane' },
          {
            fixed: () => h('div', { class: 'fixed-toolbar' }, 'Toolbar'),
            scroll: () =>
              h(
                ScrollAreaRoot,
                { class: 'flex-1 box-border h-full min-h-0 relative overflow-hidden' },
                {
                  default: () => [
                    h(
                      ScrollAreaViewport,
                      {
                        class:
                          'bookmark-accordion-list flex flex-col gap-[var(--pxd-row-gap)] box-border h-full w-full min-h-0 px-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] pt-[var(--pxd-space-xs)]',
                      },
                      () => h('div', 'Bookmark Item'),
                    ),
                    h(ScrollBar),
                  ],
                },
              ),
          },
        );
    },
  }),
}));

vi.mock('@/components/sidebar/HistoryPane.vue', () => ({
  default: defineComponent({
    name: 'HistoryPane',
    setup() {
      paneMountCounts.history++;
      onUnmounted(() => {
        paneUnmountCounts.history++;
      });
      return () =>
        h(
          SidebarPane,
          { scrollMode: 'internal', 'data-test': 'history-pane' },
          {
            fixed: () => h('div', { class: 'history-fixed' }, 'History Toolbar'),
            scroll: () => h('div', 'History Item'),
          },
        );
    },
  }),
}));

vi.mock('@/components/sidebar/ToolsPane.vue', () => ({
  default: defineComponent({
    name: 'ToolsPane',
    setup() {
      paneMountCounts.tools++;
      onUnmounted(() => {
        paneUnmountCounts.tools++;
      });
      return () => h('div', { 'data-test': 'tools-pane', class: 'flex flex-col' }, 'Tools Content');
    },
  }),
}));

vi.mock('@/components/sidebar/SettingsPane.vue', () => ({
  default: defineComponent({
    name: 'SettingsPane',
    emits: ['ready'],
    setup(props, { emit }) {
      paneMountCounts.settings++;
      onMounted(() => emit('ready'));
      onUnmounted(() => {
        paneUnmountCounts.settings++;
      });
      return () =>
        h('div', { 'data-test': 'settings-pane', class: 'flex flex-col' }, 'Settings Content');
    },
  }),
}));

vi.mock('@/components/sidebar/LiveSearchPrimaryPane.vue', () => ({
  default: defineComponent({
    name: 'LiveSearchPrimaryPane',
    props: ['controller', 'bookmarkController', 'resumeController'],
    setup() {
      paneMountCounts.liveSearchPrimary++;
      onUnmounted(() => {
        paneUnmountCounts.liveSearchPrimary++;
      });
      return () =>
        h(
          'div',
          {
            'data-sidebar-pane': 'live-search-primary',
            'data-test': 'live-search-primary-pane',
            class:
              'livesearch-primary-pane flex flex-col h-full min-h-0 select-none overflow-hidden',
          },
          [
            h('div', { class: 'shrink-0', 'data-test': 'primary-fixed-area' }, 'Fixed Area'),
            h(
              ScrollAreaRoot,
              { class: 'flex-1 box-border h-full min-h-0 relative overflow-hidden' },
              {
                default: () => [
                  h(
                    ScrollAreaViewport,
                    {
                      'data-test': 'search-connections-list',
                      class:
                        'flex flex-col gap-[var(--pxd-space-xs)] box-border h-full w-full min-h-0 px-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)]',
                    },
                    () => h('div', 'Connections List'),
                  ),
                  h(ScrollBar),
                ],
              },
            ),
          ],
        );
    },
  }),
}));

vi.mock('@/components/sidebar/LiveSearchConsoleSettingsPane.vue', () => ({
  default: defineComponent({
    name: 'LiveSearchConsoleSettingsPane',
    props: ['resumeController'],
    setup() {
      paneMountCounts.liveSearchConsoleSettings++;
      onUnmounted(() => {
        paneUnmountCounts.liveSearchConsoleSettings++;
      });
      return () =>
        h(
          ScrollAreaRoot,
          {
            'data-sidebar-pane': 'live-search-console-settings',
            'data-test': 'live-search-console-settings-pane',
            class: 'flex-1 box-border h-full min-h-0 relative overflow-hidden select-none',
          },
          {
            default: () => [
              h(
                ScrollAreaViewport,
                {
                  class:
                    'h-full w-full min-h-0 flex flex-col p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] box-border gap-[var(--pxd-space-md)]',
                },
                () => h('div', 'Console Settings Content'),
              ),
              h(ScrollBar),
            ],
          },
        );
    },
  }),
}));

let activeMockPreferences: any = {
  sidebarPosition: 'left',
  sidebarSize: 'medium',
  sidebarWidth: 380,
  fontSizeScale: 1,
  densityScale: 1,
};

vi.mock('@/utils/preferences', () => ({
  DEFAULT_PREFERENCES: {
    sidebarPosition: 'left',
    sidebarSize: 'medium',
    sidebarWidth: 380,
    fontSizeScale: 1,
    densityScale: 1,
  },
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      subscribe: (cb: any) => {
        cb(activeMockPreferences);
        return () => {};
      },
    },
  })),
}));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async () => ({
        isCollapsed: false,
        activeTab: 'bookmark',
      })),
      set: vi.fn(async () => {}),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
});

describe('Sidebar Scrollbar Foundation & Overlay Contract', () => {
  let app: App | null = null;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    container.remove();
  });

  describe('1. ScrollArea Primitive Contract', () => {
    it('enforces persistent-overflow policy (default type="auto") on Foundation primitives', async () => {
      // 1. ScrollAreaRoot primitive defaults to type="auto"
      app = createApp({
        render() {
          return h(ScrollAreaRoot, null, {
            default: () => [h(ScrollAreaViewport, null, () => h('div', 'Content')), h(ScrollBar)],
          });
        },
      });
      app.mount(container);
      await nextTick();

      const root = container.querySelector('[data-slot="scroll-area-root"]');
      expect(root).not.toBeNull();
      // Verify Foundation wrapper sets data-slot="scroll-area-root"
      expect(root?.className).toContain('relative');
      expect(root?.className).toContain('overflow-hidden');

      app.unmount();
      app = null;

      // 2. ScrollArea component delegates to local ScrollAreaRoot foundation
      const scrollAreaSource = readFileSync('components/ui/scroll-area/ScrollArea.vue', 'utf8');
      expect(scrollAreaSource).toContain("import ScrollAreaRoot from './ScrollAreaRoot.vue'");
      expect(scrollAreaSource).not.toMatch(
        /import\s*\{[^}]*ScrollAreaRoot[^}]*\}\s*from\s*['"]reka-ui['"]/,
      );
      expect(scrollAreaSource).not.toMatch(/type:\s*['"]hover['"]/);

      // 3. ScrollAreaRoot component is the sole type="auto" default owner
      const scrollAreaRootSource = readFileSync(
        'components/ui/scroll-area/ScrollAreaRoot.vue',
        'utf8',
      );
      expect(scrollAreaRootSource).toMatch(/type:\s*['"]auto['"]/);
      expect(scrollAreaRootSource).not.toMatch(/type:\s*['"]hover['"]/);
    });

    it('renders ScrollArea with relative overflow-hidden root and data-reka viewport', async () => {
      app = createApp({
        render() {
          return h(
            ScrollArea,
            { class: 'w-[300px] h-[200px]' },
            {
              default: () => h('div', { class: 'h-[500px] w-full' }, 'Long content'),
            },
          );
        },
      });
      app.mount(container);
      await nextTick();

      const root = container.querySelector('[data-slot="scroll-area-root"]');
      expect(root).not.toBeNull();
      expect(root?.className).toContain('relative');
      expect(root?.className).toContain('overflow-hidden');

      const viewport = container.querySelector('[data-reka-scroll-area-viewport]');
      expect(viewport).not.toBeNull();
      expect(viewport?.className).toContain('h-full');
      expect(viewport?.className).toContain('w-full');
    });

    it('renders ScrollBar with 4px overlay geometry and semantic theme tokens', async () => {
      app = createApp({
        render() {
          return h(
            ScrollAreaRoot,
            { type: 'always', class: 'relative w-[300px] h-[200px]' },
            {
              default: () => [
                h(ScrollAreaViewport, { class: 'h-full w-full' }, () =>
                  h('div', { class: 'h-[500px]' }, 'Content'),
                ),
                h(ScrollBar, { orientation: 'vertical' }),
              ],
            },
          );
        },
      });
      app.mount(container);
      await nextTick();

      const scrollbar = container.querySelector('[data-slot="scroll-area-scrollbar"]');
      expect(scrollbar).not.toBeNull();
      // 4px vertical overlay scrollbar
      expect(scrollbar?.className).toContain('w-[4px]');
      expect(scrollbar?.className).toContain('bg-transparent');
      expect(scrollbar?.className).toContain('touch-none');
      expect(scrollbar?.className).toContain('select-none');

      const thumb = container.querySelector('[data-slot="scroll-area-thumb"]');
      expect(thumb).not.toBeNull();
      expect(thumb?.className).toContain('bg-border');
      expect(thumb?.className).toContain('hover:bg-muted-foreground');
      expect(thumb?.className).toContain('rounded-[var(--radius)]');
    });
  });

  describe('2. Scope 1: SidebarPane Internal Scroll Migration', () => {
    it('uses ScrollArea without native pxd-scrollbar and preserves breathing room', async () => {
      app = createApp({
        render() {
          return h(
            SidebarPane,
            { scrollMode: 'internal' },
            {
              scroll: () => h('div', { id: 'pane-body' }, 'History items'),
            },
          );
        },
      });
      app.mount(container);
      await nextTick();

      const scrollRoot = container.querySelector('[data-slot="sidebar-pane-scroll-root"]');
      expect(scrollRoot).not.toBeNull();
      expect(scrollRoot?.className).toContain('min-h-0');
      expect(scrollRoot?.className).toContain('flex-1');

      const viewport = container.querySelector('[data-slot="sidebar-pane-scroll"]');
      expect(viewport).not.toBeNull();
      expect(viewport?.hasAttribute('data-reka-scroll-area-viewport')).toBe(true);
      expect(viewport?.className).not.toContain('pxd-scrollbar');

      const scrollContent = container.querySelector('[data-slot="sidebar-pane-scroll-content"]');
      expect(scrollContent).not.toBeNull();
      expect(scrollContent?.parentElement).toBe(viewport);
      expect(scrollContent?.className).toContain('pb-[var(--pxd-pane-scroll-end-space)]');

      const sidebarPaneSource = readFileSync('components/sidebar/layout/SidebarPane.vue', 'utf8');
      expect(sidebarPaneSource).toContain('<ScrollBar />');
    });
  });

  describe('3. Scope 2: Outer Settings / Tools Scroll & Nested Panes Bounded-Height Contract', () => {
    it('keeps .content-body as a pure bounded flex host and isolates outer ScrollArea for Settings/Tools', () => {
      const sidebarSource = readFileSync('components/Sidebar.vue', 'utf-8');

      // .content-body is a flex container directly hosting panes (bounded parent), not wrapping all panes in ScrollAreaViewport
      expect(sidebarSource).toMatch(
        /<div[\s\S]*?class="content-body flex-1 box-border min-w-0 min-h-0 flex flex-col overflow-hidden relative"/,
      );
      expect(sidebarSource).not.toContain('class="content-body pxd-scrollbar');

      // Outer ScrollAreaRoot is only rendered for Settings and Tools tabs
      expect(sidebarSource).toContain('data-sidebar-outer-scroll');
      expect(sidebarSource).toMatch(
        /<ScrollAreaRoot[\s\S]*?v-show="activeTab === 'tools' \|\| activeTab === 'settings'[\s\S]*?data-sidebar-outer-scroll/,
      );

      // Outer viewport retains breathing room token
      expect(sidebarSource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
    });
  });

  describe('4. Scope 3: BookmarkPane External Scroll Migration', () => {
    it('.bookmark-accordion-list is a ScrollAreaViewport with SortableJS compatibility', () => {
      const bookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf-8');

      // .bookmark-accordion-list is ScrollAreaViewport
      expect(bookmarkSource).toContain(
        '<ScrollAreaRoot class="flex-1 box-border h-full min-h-0 relative overflow-hidden">',
      );
      expect(bookmarkSource).toContain('<ScrollAreaViewport');
      expect(bookmarkSource).toContain('bookmark-accordion-list flex flex-col');
      expect(bookmarkSource).not.toMatch(/class="[^"]*bookmark-accordion-list[^"]*pxd-scrollbar/);

      // Preserves breathing room
      expect(bookmarkSource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');

      // Retains pxd-scrollbar for Reka floating dropdown submenus
      expect(bookmarkSource).toMatch(/<DropdownMenuSubContent[^>]*pxd-scrollbar/);
    });
  });

  describe('5. Scope 4: Shared Dialog Scroll Body Migration', () => {
    it('uses ScrollAreaRoot and ScrollAreaViewport for data-sidebar-dialog-body', () => {
      const sidebarSource = readFileSync('components/Sidebar.vue', 'utf-8');

      expect(sidebarSource).toMatch(
        /<ScrollAreaRoot[\s\S]*?data-sidebar-dialog-body[\s\S]*?>[\s\S]*?<ScrollAreaViewport/,
      );
      expect(sidebarSource).not.toMatch(/data-sidebar-dialog-body[\s\S]*?pxd-scrollbar/);
    });
  });

  describe('6. Scope 5: LiveSearch Primary & Console Settings ScrollArea Migration', () => {
    it('LiveSearchPrimaryPane search-connections-list uses ScrollArea Foundation and eliminates pxd-scrollbar', () => {
      const primarySource = readFileSync('components/sidebar/LiveSearchPrimaryPane.vue', 'utf-8');

      // Uses ScrollAreaRoot and ScrollAreaViewport for connections list
      expect(primarySource).toContain('<ScrollAreaRoot');
      expect(primarySource).toContain('<ScrollAreaViewport');
      expect(primarySource).toMatch(
        /<ScrollAreaViewport[\s\S]*?data-test="search-connections-list"/,
      );
      expect(primarySource).not.toMatch(/search-connections-list[^>]*pxd-scrollbar/);
      expect(primarySource).not.toMatch(/search-connections-list[^>]*overflow-y-auto/);

      // Preserves breathing room
      expect(primarySource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');

      // Fixed toolbar is outside ScrollArea and marked shrink-0
      expect(primarySource).toMatch(/data-test="primary-fixed-area"[\s\S]*?shrink-0/);
    });

    it('LiveSearchConsoleSettingsPane uses ScrollAreaRoot and eliminates pxd-scrollbar', () => {
      const consoleSource = readFileSync(
        'components/sidebar/LiveSearchConsoleSettingsPane.vue',
        'utf-8',
      );

      // Root is ScrollAreaRoot and contains ScrollAreaViewport
      expect(consoleSource).toMatch(
        /<ScrollAreaRoot[\s\S]*?data-sidebar-pane="live-search-console-settings"/,
      );
      expect(consoleSource).toContain('<ScrollAreaViewport');
      expect(consoleSource).not.toContain('pxd-scrollbar');
      expect(consoleSource).not.toContain('overflow-y-auto');

      // Preserves breathing room
      expect(consoleSource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
    });

    it('all migrated pane viewports eliminate pxd-scrollbar and do not rely on scrollbar-gutter: stable', () => {
      const sidebarPaneSource = readFileSync('components/sidebar/layout/SidebarPane.vue', 'utf-8');
      const sidebarSource = readFileSync('components/Sidebar.vue', 'utf-8');
      const bookmarkSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf-8');
      const primarySource = readFileSync('components/sidebar/LiveSearchPrimaryPane.vue', 'utf-8');
      const consoleSource = readFileSync(
        'components/sidebar/LiveSearchConsoleSettingsPane.vue',
        'utf-8',
      );

      expect(sidebarPaneSource).not.toContain('pxd-scrollbar');
      expect(sidebarSource).not.toContain('pxd-scrollbar');
      expect(bookmarkSource).not.toMatch(/bookmark-accordion-list[^>]*pxd-scrollbar/);
      expect(primarySource).not.toContain('pxd-scrollbar');
      expect(consoleSource).not.toContain('pxd-scrollbar');
    });
  });

  describe('7. Runtime Regression Tests: Bounded-Height Chain, Scroll Ownership & Mount Persistence', () => {
    let hostApp: App | null = null;
    let hostContainer: HTMLElement;

    beforeEach(() => {
      hostContainer = document.createElement('div');
      document.body.appendChild(hostContainer);
      resetPaneCounts();
    });

    afterEach(() => {
      if (hostApp) {
        hostApp.unmount();
        hostApp = null;
      }
      hostContainer.remove();
    });

    it('BookmarkPane active: establishes unbroken bounded-height flex chain from .content-body to inner ScrollAreaViewport', async () => {
      hostApp = createApp({
        render() {
          return h(Sidebar, { pageRole: 'normal' });
        },
      });
      hostApp.mount(hostContainer);
      await nextTick();
      await nextTick();

      const contentBody = hostContainer.querySelector('.content-body');
      expect(contentBody).not.toBeNull();
      // .content-body is a direct flex container with bounded min-h-0 and flex-col
      expect(contentBody?.className).toContain('flex');
      expect(contentBody?.className).toContain('flex-col');
      expect(contentBody?.className).toContain('min-h-0');
      expect(contentBody?.className).toContain('overflow-hidden');

      // BookmarkPane is a direct child of .content-body (no outer ScrollAreaViewport interposition)
      const bookmarkPane = hostContainer.querySelector('[data-test="bookmark-pane"]');
      expect(bookmarkPane).not.toBeNull();
      expect(bookmarkPane?.parentElement).toBe(contentBody);

      // BookmarkPane uses SidebarPane which has h-full min-h-0 flex flex-col
      expect(bookmarkPane?.className).toContain('h-full');
      expect(bookmarkPane?.className).toContain('min-h-0');
      expect(bookmarkPane?.className).toContain('flex');
      expect(bookmarkPane?.className).toContain('flex-col');

      // Scroll host in SidebarPane (external scroll host) has min-h-0 flex-1
      const scrollHost = bookmarkPane?.querySelector('[data-slot="sidebar-pane-scroll-host"]');
      expect(scrollHost).not.toBeNull();
      expect(scrollHost?.className).toContain('min-h-0');
      expect(scrollHost?.className).toContain('flex-1');

      // Inside scroll host, ScrollAreaRoot has flex-1 h-full min-h-0
      const innerScrollRoot = scrollHost?.firstElementChild as HTMLElement;
      expect(innerScrollRoot).not.toBeNull();
      expect(innerScrollRoot?.className).toContain('min-h-0');
      expect(innerScrollRoot?.className).toContain('flex-1');
      expect(innerScrollRoot?.className).toContain('h-full');

      // Inner ScrollAreaViewport (.bookmark-accordion-list) has h-full w-full min-h-0
      const innerViewport = scrollHost?.querySelector('.bookmark-accordion-list');
      expect(innerViewport).not.toBeNull();
      expect(innerViewport?.className).toContain('h-full');
      expect(innerViewport?.className).toContain('w-full');
      expect(innerViewport?.className).toContain('min-h-0');

      // Outer scroll is hidden and has no scrollbar
      const outerScroll = hostContainer.querySelector('[data-sidebar-outer-scroll]') as HTMLElement;
      expect(outerScroll).not.toBeNull();
      expect(outerScroll.style.display).toBe('none');
    });

    it('HistoryPane active: internal ScrollAreaViewport retains scroll ownership and breathing room', async () => {
      hostApp = createApp({
        render() {
          return h(Sidebar, { pageRole: 'normal' });
        },
      });
      hostApp.mount(hostContainer);
      await nextTick();
      await nextTick();

      // Switch to history tab
      const historyTabBtn = hostContainer.querySelector(
        '[data-sidebar-tab="history"]',
      ) as HTMLElement;
      expect(historyTabBtn).not.toBeNull();
      historyTabBtn.click();
      await nextTick();
      await nextTick();

      const historyPane = hostContainer.querySelector('[data-test="history-pane"]');
      expect(historyPane).not.toBeNull();
      expect(historyPane?.parentElement).toBe(hostContainer.querySelector('.content-body'));

      // HistoryPane owns internal ScrollAreaRoot and ScrollAreaViewport
      const internalRoot = historyPane?.querySelector('[data-slot="sidebar-pane-scroll-root"]');
      expect(internalRoot).not.toBeNull();
      const internalViewport = historyPane?.querySelector('[data-slot="sidebar-pane-scroll"]');
      expect(internalViewport).not.toBeNull();

      // Internal scroll content has breathing room
      const internalContent = historyPane?.querySelector(
        '[data-slot="sidebar-pane-scroll-content"]',
      );
      expect(internalContent?.className).toContain('pb-[var(--pxd-pane-scroll-end-space)]');

      // Outer scroll container remains hidden
      const outerScroll = hostContainer.querySelector('[data-sidebar-outer-scroll]') as HTMLElement;
      expect(outerScroll.style.display).toBe('none');
    });

    it('Settings / Tools active: outer ScrollArea is visible, active, and retains breathing room', async () => {
      hostApp = createApp({
        render() {
          return h(Sidebar, { pageRole: 'normal' });
        },
      });
      hostApp.mount(hostContainer);
      await nextTick();
      await nextTick();

      // Switch to tools tab
      const toolsTabBtn = hostContainer.querySelector('[data-sidebar-tab="tools"]') as HTMLElement;
      expect(toolsTabBtn).not.toBeNull();
      toolsTabBtn.click();
      await nextTick();
      await nextTick();

      const outerScroll = hostContainer.querySelector('[data-sidebar-outer-scroll]') as HTMLElement;
      expect(outerScroll).not.toBeNull();
      expect(outerScroll.style.display).not.toBe('none');

      // Outer viewport has breathing room and padding
      const outerViewport = outerScroll.querySelector('[data-reka-scroll-area-viewport]');
      expect(outerViewport).not.toBeNull();
      expect(outerViewport?.className).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
      expect(outerViewport?.className).toContain('p-[var(--pxd-pane-padding)]');

      // Tools pane is visible inside outer viewport
      const toolsPane = outerViewport?.querySelector('[data-test="tools-pane"]') as HTMLElement;
      expect(toolsPane).not.toBeNull();
      expect(toolsPane.style.display).not.toBe('none');

      // Switch to settings tab
      const settingsTabBtn = hostContainer.querySelector(
        '[data-sidebar-tab="settings"]',
      ) as HTMLElement;
      expect(settingsTabBtn).not.toBeNull();
      settingsTabBtn.click();
      await nextTick();
      await nextTick();

      expect(outerScroll.style.display).not.toBe('none');
      const settingsPane = outerViewport?.querySelector(
        '[data-test="settings-pane"]',
      ) as HTMLElement;
      expect(settingsPane).not.toBeNull();
      expect(settingsPane.style.display).not.toBe('none');
      expect(toolsPane.style.display).toBe('none');
    });

    it('LiveSearch panes: direct children of .content-body with bounded-height and no outer scroll wrapper', async () => {
      hostApp = createApp({
        render() {
          return h(Sidebar, { pageRole: 'live-search-primary' });
        },
      });
      hostApp.mount(hostContainer);
      await nextTick();
      await nextTick();

      const contentBody = hostContainer.querySelector('.content-body');
      expect(contentBody).not.toBeNull();
      expect(contentBody?.className).toContain('has-pane-scroll');

      // Outer scroll is not rendered in live-search-primary mode
      const outerScroll = hostContainer.querySelector('[data-sidebar-outer-scroll]');
      expect(outerScroll).toBeNull();

      // LiveSearchPrimaryPane is direct child
      const primaryPane = hostContainer.querySelector(
        '[data-test="live-search-primary-pane"]',
      ) as HTMLElement;
      expect(primaryPane).not.toBeNull();
      expect(primaryPane.parentElement).toBe(contentBody);
      expect(primaryPane.className).toContain('h-full');
      expect(primaryPane.className).toContain('min-h-0');

      // Fixed toolbar is outside ScrollArea and marked shrink-0
      const fixedArea = primaryPane.querySelector('[data-test="primary-fixed-area"]');
      expect(fixedArea).not.toBeNull();
      expect(fixedArea?.className).toContain('shrink-0');

      // Connections list is a ScrollAreaViewport with breathing room
      const connectionsViewport = primaryPane.querySelector(
        '[data-test="search-connections-list"]',
      );
      expect(connectionsViewport).not.toBeNull();
      expect(connectionsViewport?.hasAttribute('data-reka-scroll-area-viewport')).toBe(true);
      expect(connectionsViewport?.className).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
      expect(connectionsViewport?.className).not.toContain('pxd-scrollbar');

      // ScrollAreaRoot wraps the connections list
      const connectionsRoot = connectionsViewport?.closest('[data-slot="scroll-area-root"]');
      expect(connectionsRoot).not.toBeNull();
      expect(connectionsRoot?.className).toContain('min-h-0');
      expect(connectionsRoot?.className).toContain('flex-1');

      // Switch to console settings
      const consoleSettingsBtn = hostContainer.querySelector(
        '[data-sidebar-primary-tab="console-settings"]',
      ) as HTMLElement;
      expect(consoleSettingsBtn).not.toBeNull();
      consoleSettingsBtn.click();
      await nextTick();
      await nextTick();

      const consoleSettingsPane = hostContainer.querySelector(
        '[data-test="live-search-console-settings-pane"]',
      ) as HTMLElement;
      expect(consoleSettingsPane).not.toBeNull();
      expect(consoleSettingsPane.parentElement).toBe(contentBody);
      expect(consoleSettingsPane.className).toContain('h-full');
      expect(consoleSettingsPane.className).toContain('min-h-0');
      expect(consoleSettingsPane.getAttribute('data-slot')).toBe('scroll-area-root');

      // Console settings internal viewport has breathing room
      const consoleViewport = consoleSettingsPane.querySelector('[data-reka-scroll-area-viewport]');
      expect(consoleViewport).not.toBeNull();
      expect(consoleViewport?.className).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
      expect(consoleViewport?.className).not.toContain('pxd-scrollbar');
    });

    it('Tab switching maintains mounted persistence (v-show invariant, zero remounts)', async () => {
      hostApp = createApp({
        render() {
          return h(Sidebar, { pageRole: 'normal' });
        },
      });
      hostApp.mount(hostContainer);
      await nextTick();
      await nextTick();

      // Initially all normal panes are mounted exactly once
      expect(paneMountCounts.bookmark).toBe(1);
      expect(paneMountCounts.history).toBe(1);
      expect(paneMountCounts.tools).toBe(1);
      expect(paneMountCounts.settings).toBe(1);
      expect(paneUnmountCounts.bookmark).toBe(0);
      expect(paneUnmountCounts.history).toBe(0);
      expect(paneUnmountCounts.tools).toBe(0);
      expect(paneUnmountCounts.settings).toBe(0);

      const tabIds = ['history', 'tools', 'settings', 'bookmark', 'tools', 'history'];
      for (const tabId of tabIds) {
        const tabBtn = hostContainer.querySelector(`[data-sidebar-tab="${tabId}"]`) as HTMLElement;
        expect(tabBtn).not.toBeNull();
        tabBtn.click();
        await nextTick();
      }

      // After round-trip tab switching, no panes have ever unmounted or remounted
      expect(paneMountCounts.bookmark).toBe(1);
      expect(paneMountCounts.history).toBe(1);
      expect(paneMountCounts.tools).toBe(1);
      expect(paneMountCounts.settings).toBe(1);
      expect(paneUnmountCounts.bookmark).toBe(0);
      expect(paneUnmountCounts.history).toBe(0);
      expect(paneUnmountCounts.tools).toBe(0);
      expect(paneUnmountCounts.settings).toBe(0);
    });

    it('No unintended outer clipping or scrollbar exists during pane-scroll tabs', async () => {
      hostApp = createApp({
        render() {
          return h(Sidebar, { pageRole: 'normal' });
        },
      });
      hostApp.mount(hostContainer);
      await nextTick();
      await nextTick();

      // During bookmark tab
      const outerScroll = hostContainer.querySelector('[data-sidebar-outer-scroll]') as HTMLElement;
      expect(outerScroll.style.display).toBe('none');

      // Outer content-body does not have overflow-y-auto or pxd-scrollbar
      const contentBody = hostContainer.querySelector('.content-body');
      expect(contentBody?.className).not.toContain('overflow-y-auto');
      expect(contentBody?.className).not.toContain('pxd-scrollbar');
    });
  });
});
