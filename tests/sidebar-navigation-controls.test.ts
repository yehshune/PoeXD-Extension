// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { listenPoeEvent } from '@/utils/event-contracts';
import { createVersionedStorageKeys } from '@/utils/storage-contracts';
import { getPoeVersion } from '@/utils/trade-context';

const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8');

// Spy records for child pane mount persistence
const paneMountCounts = {
  bookmark: 0,
  history: 0,
  tools: 0,
  settings: 0,
};
const paneUnmountCounts = {
  bookmark: 0,
  history: 0,
  tools: 0,
  settings: 0,
};

function resetPaneCounts() {
  paneMountCounts.bookmark = 0;
  paneMountCounts.history = 0;
  paneMountCounts.tools = 0;
  paneMountCounts.settings = 0;
  paneUnmountCounts.bookmark = 0;
  paneUnmountCounts.history = 0;
  paneUnmountCounts.tools = 0;
  paneUnmountCounts.settings = 0;
}

vi.mock('@/components/sidebar/FilterPane.vue', () => ({
  default: defineComponent({
    name: 'FilterPane',
    setup() {
      return () => h('div', { 'data-test': 'filter-pane-mock' });
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
      return () => h('div', { 'data-test': 'bookmark-pane' });
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
      return () => h('div', { 'data-test': 'history-pane' });
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
      return () => h('div', { 'data-test': 'tools-pane' });
    },
  }),
}));

vi.mock('@/components/sidebar/SettingsPane.vue', () => ({
  default: defineComponent({
    name: 'SettingsPane',
    emits: ['ready'],
    setup(props, { emit }) {
      paneMountCounts.settings++;
      onMounted(() => {
        emit('ready');
      });
      onUnmounted(() => {
        paneUnmountCounts.settings++;
      });
      return () => h('div', { 'data-test': 'settings-pane' });
    },
  }),
}));

let activeMockPreferences: any = {
  sidebarPosition: 'left',
  sidebarSize: 'medium',
  sidebarWidth: 380,
  customSidebarWidth: 380,
  fontSizeScale: 1,
  densityScale: 1,
};
const updatePreferencesSpy = vi.fn(async () => {});

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
      subscribe: vi.fn((cb) => {
        cb(activeMockPreferences);
        return () => {};
      }),
      getSnapshot: vi.fn(() => activeMockPreferences),
      update: updatePreferencesSpy,
    },
  })),
}));

let mockStorage: Record<string, any> = {};

(globalThis as any).chrome = {
  runtime: {
    getURL: vi.fn((path: string) => path),
  },
  storage: {
    local: {
      get: vi.fn(async (keys?: any) => {
        if (!keys) return { ...mockStorage };
        if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
        if (Array.isArray(keys)) {
          const res: Record<string, any> = {};
          for (const k of keys) res[k] = mockStorage[k];
          return res;
        }
        return { ...mockStorage };
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(mockStorage, items);
      }),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

describe('Sidebar Navigation Controls Migration', () => {
  let container: HTMLElement;
  let app: any;

  beforeEach(() => {
    mockStorage = {};
    activeMockPreferences = {
      sidebarPosition: 'left',
      sidebarSize: 'medium',
      sidebarWidth: 380,
      customSidebarWidth: 380,
      fontSizeScale: 1,
      densityScale: 1,
    };
    updatePreferencesSpy.mockClear();
    resetPaneCounts();
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    container.remove();
    document.body.innerHTML = '';
  });

  const mountSidebar = async (initialStorage: Record<string, any> = {}) => {
    Object.assign(mockStorage, initialStorage);
    app = createApp(Sidebar, { portalTarget: document.body });
    const vm = app.mount(container);
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));
    await nextTick();
    return { container, app, vm };
  };

  describe('Static cleanup assertions', () => {
    it('does not contain legacy navigation CSS classes in styles', () => {
      expect(sidebarSource).not.toMatch(/\.collapsed-bar\s*\{/);
      expect(sidebarSource).not.toMatch(/\.collapsed-bar:hover/);
      expect(sidebarSource).not.toMatch(/\.nav-item\s*\{/);
      expect(sidebarSource).not.toMatch(/\.nav-item:hover/);
      expect(sidebarSource).not.toMatch(/\.nav-item\.active/);
      expect(sidebarSource).not.toMatch(/\.close-btn\s*\{/);
      expect(sidebarSource).not.toMatch(/\.close-btn:hover/);
    });

    it('preserves retained navigation and layout selectors and eliminates redundant ones', () => {
      expect(sidebarSource).toContain('sidebar-nav');
      expect(sidebarSource).toContain('nav-divider');
      expect(sidebarSource).toContain('sidebar-resize-handle');
      expect(sidebarSource).toContain('pxd-sidebar-wrapper');
      expect(sidebarSource).not.toContain('poe-sidebar-wrapper');
      expect(sidebarSource).not.toContain('data-poexd-density');
      expect(sidebarSource).not.toMatch(/\.arrow-icon/);
      expect(sidebarSource).not.toMatch(/\.nav-icon/);
      expect(sidebarSource).not.toMatch(/\.poe-scrollbar/);
      expect(sidebarSource).not.toContain('pxd-scrollbar');
      expect(sidebarSource).not.toContain('<style');
    });

    it('uses Button primitives with Foundation profiles for navigation actions in template', () => {
      expect(sidebarSource).toMatch(
        /<Button[\s\S]*?size="default"[\s\S]*?data-sidebar-action="expand"/,
      );
      expect(sidebarSource).toMatch(
        /<Button[\s\S]*?size="icon-lg"[\s\S]*?data-sidebar-action="collapse"/,
      );
      expect(sidebarSource).toMatch(
        /<Button[\s\S]*?variant="ghost"[\s\S]*?size="icon-lg"[\s\S]*?:data-sidebar-tab="tab\.id"/,
      );
    });

    it('enforces collapsed handle fixed rounded-none and [placeholder][arrow] geometry exception in template', () => {
      expect(sidebarSource).toMatch(/rounded-none[\s\S]*?data-sidebar-action="expand"/);
      expect(sidebarSource).toContain('data-sidebar-brand-placeholder');
      expect(sidebarSource).toMatch(
        /<(ToolboxIcon|Box)[^>]*data-sidebar-brand-placeholder[\s\S]*?<ChevronLeft/,
      );
    });
  });

  describe('Runtime controls & accessibility contract', () => {
    it('A. renders expand, collapse, and tab controls as native BUTTON elements with type="button"', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector('[data-sidebar-action="expand"]');
      const collapseBtn = container.querySelector('[data-sidebar-action="collapse"]');
      const bookmarkTab = container.querySelector('[data-sidebar-tab="bookmark"]');
      const historyTab = container.querySelector('[data-sidebar-tab="history"]');
      const settingsTab = container.querySelector('[data-sidebar-tab="settings"]');

      expect(expandBtn).not.toBeNull();
      expect(collapseBtn).not.toBeNull();
      expect(bookmarkTab).not.toBeNull();
      expect(historyTab).not.toBeNull();
      expect(settingsTab).not.toBeNull();

      expect(expandBtn?.tagName).toBe('BUTTON');
      expect(expandBtn?.getAttribute('type')).toBe('button');

      expect(collapseBtn?.tagName).toBe('BUTTON');
      expect(collapseBtn?.getAttribute('type')).toBe('button');

      expect(bookmarkTab?.tagName).toBe('BUTTON');
      expect(bookmarkTab?.getAttribute('type')).toBe('button');

      expect(historyTab?.tagName).toBe('BUTTON');
      expect(historyTab?.getAttribute('type')).toBe('button');

      expect(settingsTab?.tagName).toBe('BUTTON');
      expect(settingsTab?.getAttribute('type')).toBe('button');
    });

    it('B. exposes proper title and aria-label accessibility attributes on all controls', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector('[data-sidebar-action="expand"]');
      const collapseBtn = container.querySelector('[data-sidebar-action="collapse"]');
      const bookmarkTab = container.querySelector('[data-sidebar-tab="bookmark"]');
      const historyTab = container.querySelector('[data-sidebar-tab="history"]');
      const settingsTab = container.querySelector('[data-sidebar-tab="settings"]');

      expect(expandBtn?.getAttribute('aria-label')).toBe('展開面板');
      expect(expandBtn?.getAttribute('title')).toBe('展開面板');

      expect(collapseBtn?.getAttribute('aria-label')).toBe('關閉面板');
      expect(collapseBtn?.getAttribute('title')).toBe('關閉面板');

      expect(bookmarkTab?.getAttribute('aria-label')).toBe('快速書籤');
      expect(bookmarkTab?.getAttribute('title')).toBe('快速書籤');

      expect(historyTab?.getAttribute('aria-label')).toBe('搜尋歷史');
      expect(historyTab?.getAttribute('title')).toBe('搜尋歷史');

      expect(settingsTab?.getAttribute('aria-label')).toBe('系統設定');
      expect(settingsTab?.getAttribute('title')).toBe('系統設定');
    });

    it('B3. pushes Tools & Info and Settings tabs to bottom utility area via mt-auto with Settings as bottom-most', async () => {
      await mountSidebar();

      const bookmarkTab = container.querySelector('[data-sidebar-tab="bookmark"]');
      const historyTab = container.querySelector('[data-sidebar-tab="history"]');
      const toolsTab = container.querySelector('[data-sidebar-tab="tools"]');
      const settingsTab = container.querySelector('[data-sidebar-tab="settings"]');

      expect(bookmarkTab?.className).not.toContain('mt-auto');
      expect(historyTab?.className).not.toContain('mt-auto');
      expect(
        container.querySelector('[data-sidebar-tab="stat-group-template"]')?.className,
      ).not.toContain('mt-auto');
      expect(toolsTab?.className).toContain('mt-auto');
      expect(settingsTab).not.toBeNull();

      // Navigation hierarchy verification: settings tab is strictly placed after tools tab at bottom-most
      const navButtons = Array.from(
        container.querySelectorAll('.sidebar-nav button[data-sidebar-tab]'),
      );
      expect(navButtons.length).toBe(5);
      expect(navButtons[navButtons.length - 1]).toBe(settingsTab);
      expect(navButtons[navButtons.length - 2]).toBe(toolsTab);

      // Static source confirms padding with existing space token in template class
      expect(sidebarSource).toContain('py-[var(--pxd-space-md)]');
    });

    it('B4. visually separates Live Search action from pane tabs with divider and outline variant without aria-pressed', async () => {
      await mountSidebar();

      const actionBtn = container.querySelector<HTMLButtonElement>(
        '[data-sidebar-action="open-live-search"]',
      );
      expect(actionBtn).not.toBeNull();
      expect(actionBtn?.getAttribute('type')).toBe('button');
      expect(actionBtn?.getAttribute('title')).toBe('開啟線上搜尋主控台');
      expect(actionBtn?.getAttribute('aria-label')).toBe('開啟線上搜尋主控台');

      // Action semantic contract: MUST NOT have aria-pressed
      expect(actionBtn?.hasAttribute('aria-pressed')).toBe(false);

      // Template presentation: outline variant and divider separation
      expect(sidebarSource).toMatch(
        /<div class="nav-divider[\s\S]*?<Button[\s\S]*?variant="outline"[\s\S]*?data-sidebar-action="open-live-search"/,
      );
    });

    it('C. reflects initial collapsed state: expand button visible and expanded container hidden', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      const sidebarContainer = container.querySelector<HTMLElement>('.sidebar-container');

      expect(expandBtn).not.toBeNull();
      expect(sidebarContainer).not.toBeNull();

      // isCollapsed = true (default)
      expect(expandBtn?.style.display).not.toBe('none');
      expect(sidebarContainer?.style.display).toBe('none');
    });

    it('C2. renders collapsed handle with fixed rounded-none and [placeholder][arrow] icons', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      expect(expandBtn).not.toBeNull();
      expect(expandBtn?.className).toContain('rounded-none');

      const placeholder = expandBtn?.querySelector('[data-sidebar-brand-placeholder]');
      expect(placeholder).not.toBeNull();

      const svgs = expandBtn?.querySelectorAll('svg');
      expect(svgs?.length).toBe(2);
      expect(svgs?.[0]).toBe(placeholder);
      // Left position rotates chevron 180
      expect(svgs?.[1]?.classList.contains('rotate-180')).toBe(true);
    });

    it('D. expands sidebar upon clicking expand button and updates storage', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      const sidebarContainer = container.querySelector<HTMLElement>('.sidebar-container');

      expandBtn?.click();
      await nextTick();

      expect(expandBtn?.style.display).toBe('none');
      expect(sidebarContainer?.style.display).not.toBe('none');

      const version = getPoeVersion();
      const keys = createVersionedStorageKeys(version);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [keys.isCollapsed]: false,
      });
    });

    it('E. collapses sidebar upon clicking collapse button and updates storage', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      const collapseBtn = container.querySelector<HTMLElement>('[data-sidebar-action="collapse"]');
      const sidebarContainer = container.querySelector<HTMLElement>('.sidebar-container');

      // Expand first
      expandBtn?.click();
      await nextTick();
      expect(sidebarContainer?.style.display).not.toBe('none');

      // Now collapse
      collapseBtn?.click();
      await nextTick();

      expect(expandBtn?.style.display).not.toBe('none');
      expect(sidebarContainer?.style.display).toBe('none');

      const version = getPoeVersion();
      const keys = createVersionedStorageKeys(version);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [keys.isCollapsed]: true,
      });
    });

    it('F. dispatches poexd-sidebar-collapsed-changed exactly once per toggle action', async () => {
      await mountSidebar();

      const events: boolean[] = [];
      const cleanup = listenPoeEvent('poexd-sidebar-collapsed-changed', (val: boolean) => {
        events.push(val);
      });

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      const collapseBtn = container.querySelector<HTMLElement>('[data-sidebar-action="collapse"]');

      expandBtn?.click();
      await nextTick();
      expect(events).toEqual([false]);

      collapseBtn?.click();
      await nextTick();
      expect(events).toEqual([false, true]);

      cleanup();
    });

    it('G. switches to History tab and updates aria-pressed and pane visibility', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      expandBtn?.click();
      await nextTick();

      const bookmarkTab = container.querySelector<HTMLElement>('[data-sidebar-tab="bookmark"]');
      const historyTab = container.querySelector<HTMLElement>('[data-sidebar-tab="history"]');
      const toolsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="tools"]');
      const settingsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="settings"]');

      const bookmarkPane = container.querySelector<HTMLElement>('[data-test="bookmark-pane"]');
      const historyPane = container.querySelector<HTMLElement>('[data-test="history-pane"]');
      const toolsPane = container.querySelector<HTMLElement>('[data-test="tools-pane"]');
      const settingsPane = container.querySelector<HTMLElement>('[data-test="settings-pane"]');

      // Initial tab is bookmark
      expect(bookmarkTab?.getAttribute('aria-pressed')).toBe('true');
      expect(historyTab?.getAttribute('aria-pressed')).toBe('false');
      expect(toolsTab?.getAttribute('aria-pressed')).toBe('false');
      expect(settingsTab?.getAttribute('aria-pressed')).toBe('false');
      expect(bookmarkTab?.className).not.toContain('border-border');
      expect(historyTab?.className).not.toContain('border-border');
      expect(bookmarkTab?.className).toContain('aria-[pressed=true]:bg-primary');

      // Click history
      historyTab?.click();
      await nextTick();

      expect(historyTab?.getAttribute('aria-pressed')).toBe('true');
      expect(bookmarkTab?.getAttribute('aria-pressed')).toBe('false');
      expect(toolsTab?.getAttribute('aria-pressed')).toBe('false');
      expect(settingsTab?.getAttribute('aria-pressed')).toBe('false');
      expect(historyTab?.className).not.toContain('border-border');
      expect(bookmarkTab?.className).not.toContain('border-border');

      expect(historyPane?.style.display).not.toBe('none');
      expect(bookmarkPane?.style.display).toBe('none');
      expect(toolsPane?.style.display).toBe('none');
      expect(settingsPane?.style.display).toBe('none');
    });

    it('H. switches to Settings tab and updates aria-pressed and pane visibility', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      expandBtn?.click();
      await nextTick();

      const settingsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="settings"]');
      const historyTab = container.querySelector<HTMLElement>('[data-sidebar-tab="history"]');
      const toolsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="tools"]');
      const bookmarkTab = container.querySelector<HTMLElement>('[data-sidebar-tab="bookmark"]');

      const settingsPane = container.querySelector<HTMLElement>('[data-test="settings-pane"]');
      const toolsPane = container.querySelector<HTMLElement>('[data-test="tools-pane"]');

      settingsTab?.click();
      await nextTick();

      expect(settingsTab?.getAttribute('aria-pressed')).toBe('true');
      expect(historyTab?.getAttribute('aria-pressed')).toBe('false');
      expect(toolsTab?.getAttribute('aria-pressed')).toBe('false');
      expect(bookmarkTab?.getAttribute('aria-pressed')).toBe('false');

      expect(settingsPane?.style.display).not.toBe('none');
      expect(toolsPane?.style.display).toBe('none');
    });

    it('H2. switches to Tools & Info tab and updates aria-pressed and pane visibility', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      expandBtn?.click();
      await nextTick();

      const toolsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="tools"]');
      const settingsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="settings"]');
      const bookmarkTab = container.querySelector<HTMLElement>('[data-sidebar-tab="bookmark"]');

      const toolsPane = container.querySelector<HTMLElement>('[data-test="tools-pane"]');
      const settingsPane = container.querySelector<HTMLElement>('[data-test="settings-pane"]');

      toolsTab?.click();
      await nextTick();

      expect(toolsTab?.getAttribute('aria-pressed')).toBe('true');
      expect(settingsTab?.getAttribute('aria-pressed')).toBe('false');
      expect(bookmarkTab?.getAttribute('aria-pressed')).toBe('false');

      expect(toolsPane?.style.display).not.toBe('none');
      expect(settingsPane?.style.display).toBe('none');
    });

    it('I. persists activeTab into chrome storage using versioned activeTabKey', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      expandBtn?.click();
      await nextTick();

      const historyTab = container.querySelector<HTMLElement>('[data-sidebar-tab="history"]');
      historyTab?.click();
      await nextTick();

      const version = getPoeVersion();
      const keys = createVersionedStorageKeys(version);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [keys.activeTab]: 'history',
      });

      const toolsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="tools"]');
      toolsTab?.click();
      await nextTick();

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [keys.activeTab]: 'tools',
      });

      const settingsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="settings"]');
      settingsTab?.click();
      await nextTick();

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [keys.activeTab]: 'settings',
      });
    });

    it('J. keeps all panes mounted across repeated tab switching (pane mount persistence)', async () => {
      await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      expandBtn?.click();
      await nextTick();

      // Verify all four panes mounted exactly once on initial load
      expect(paneMountCounts.bookmark).toBe(1);
      expect(paneMountCounts.history).toBe(1);
      expect(paneMountCounts.tools).toBe(1);
      expect(paneMountCounts.settings).toBe(1);
      expect(paneUnmountCounts.bookmark).toBe(0);
      expect(paneUnmountCounts.history).toBe(0);
      expect(paneUnmountCounts.tools).toBe(0);
      expect(paneUnmountCounts.settings).toBe(0);

      const bookmarkTab = container.querySelector<HTMLElement>('[data-sidebar-tab="bookmark"]');
      const historyTab = container.querySelector<HTMLElement>('[data-sidebar-tab="history"]');
      const toolsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="tools"]');
      const settingsTab = container.querySelector<HTMLElement>('[data-sidebar-tab="settings"]');

      // bookmark -> history
      historyTab?.click();
      await nextTick();

      // history -> tools
      toolsTab?.click();
      await nextTick();

      // tools -> settings
      settingsTab?.click();
      await nextTick();

      // settings -> bookmark
      bookmarkTab?.click();
      await nextTick();

      // None of the panes should have unmounted or remounted
      expect(paneMountCounts.bookmark).toBe(1);
      expect(paneMountCounts.history).toBe(1);
      expect(paneMountCounts.tools).toBe(1);
      expect(paneMountCounts.settings).toBe(1);
      expect(paneUnmountCounts.bookmark).toBe(0);
      expect(paneUnmountCounts.history).toBe(0);
      expect(paneUnmountCounts.tools).toBe(0);
      expect(paneUnmountCounts.settings).toBe(0);
    });

    it('I. drags resize handle in custom mode and commits sidebarSize, sidebarWidth, and customSidebarWidth', async () => {
      activeMockPreferences = {
        sidebarPosition: 'left',
        sidebarSize: 'custom',
        sidebarWidth: 420,
        customSidebarWidth: 420,
        fontSizeScale: 1,
        densityScale: 1,
      };

      const version = getPoeVersion();
      const keys = createVersionedStorageKeys(version);
      // Mount in expanded state
      await mountSidebar({ [keys.isCollapsed]: false });

      const resizeHandle = container.querySelector<HTMLElement>('.sidebar-resize-handle');
      expect(resizeHandle).not.toBeNull();

      const sidebarWrapper = container.querySelector<HTMLElement>('.pxd-sidebar-wrapper');
      expect(sidebarWrapper).not.toBeNull();

      const previewWidths: number[] = [];
      const cleanupPreview = listenPoeEvent('poexd-sidebar-width-preview', (w) => {
        previewWidths.push(w);
      });

      // Start drag: startVisualWidth = 420, startX = 420
      resizeHandle?.dispatchEvent(new MouseEvent('mousedown', { clientX: 420, bubbles: true }));

      // Move: clientX = 500 -> deltaX = +80 -> visualWidth = 500
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();
      expect(sidebarWrapper?.style.width).toBe('500px');
      expect(previewWidths).toContain(500);

      // Transient mousemove must NOT write preferences
      expect(updatePreferencesSpy).not.toHaveBeenCalled();

      // End drag: mouseup on window
      window.dispatchEvent(new MouseEvent('mouseup'));

      // Formal commit must contain sidebarSize, sidebarWidth, and customSidebarWidth
      expect(updatePreferencesSpy).toHaveBeenCalledWith({
        sidebarSize: 'custom',
        sidebarWidth: 500,
        customSidebarWidth: 500,
      });

      cleanupPreview();
    });

    it('I2. respects sidebarPosition right diff calculation during drag and limits bounds 300 to 800', async () => {
      activeMockPreferences = {
        sidebarPosition: 'right',
        sidebarSize: 'custom',
        sidebarWidth: 420,
        customSidebarWidth: 420,
        fontSizeScale: 1,
        densityScale: 1,
      };

      const version = getPoeVersion();
      const keys = createVersionedStorageKeys(version);
      await mountSidebar({ [keys.isCollapsed]: false });

      const resizeHandle = container.querySelector<HTMLElement>('.sidebar-resize-handle');
      expect(resizeHandle).not.toBeNull();

      const rightPreviewWidths: number[] = [];
      const cleanupRightPreview = listenPoeEvent('poexd-sidebar-width-preview', (w) => {
        rightPreviewWidths.push(w);
      });

      // Right position: dragging left (deltaX < 0) expands width
      resizeHandle?.dispatchEvent(new MouseEvent('mousedown', { clientX: 420, bubbles: true }));

      // deltaX = -80 -> diff = -(-80) = +80 -> 420 + 80 = 500
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 340 }));
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();
      expect(rightPreviewWidths).toContain(500);

      // Transient mousemove must NOT write preferences
      expect(updatePreferencesSpy).not.toHaveBeenCalled();

      // Mouseup to commit
      window.dispatchEvent(new MouseEvent('mouseup'));

      expect(updatePreferencesSpy).toHaveBeenCalledWith({
        sidebarSize: 'custom',
        sidebarWidth: 500,
        customSidebarWidth: 500,
      });

      // Test bounds: drag way beyond 800
      updatePreferencesSpy.mockClear();
      resizeHandle?.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: -500 })); // huge left drag
      window.dispatchEvent(new MouseEvent('mouseup'));

      expect(updatePreferencesSpy).toHaveBeenCalledWith({
        sidebarSize: 'custom',
        sidebarWidth: 800,
        customSidebarWidth: 800,
      });

      cleanupRightPreview();
    });
  });
});
