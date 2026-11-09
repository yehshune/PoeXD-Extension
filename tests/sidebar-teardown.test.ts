// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import Sidebar from '@/components/Sidebar.vue';

const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8');

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
      return () => h('div', { 'data-test': 'bookmark-pane' });
    },
  }),
}));

vi.mock('@/components/sidebar/HistoryPane.vue', () => ({
  default: defineComponent({
    name: 'HistoryPane',
    setup() {
      return () => h('div', { 'data-test': 'history-pane' });
    },
  }),
}));

vi.mock('@/components/sidebar/ToolsPane.vue', () => ({
  default: defineComponent({
    name: 'ToolsPane',
    setup() {
      return () => h('div', { 'data-test': 'tools-pane' });
    },
  }),
}));

vi.mock('@/components/sidebar/SettingsPane.vue', () => ({
  default: defineComponent({
    name: 'SettingsPane',
    emits: ['ready'],
    setup(props, { emit }) {
      emit('ready');
      return () => h('div', { 'data-test': 'settings-pane' });
    },
  }),
}));

const unsubscribeSpy = vi.fn();
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
        cb({
          sidebarPosition: 'left',
          sidebarSize: 'medium',
          sidebarWidth: 380,
          fontSizeScale: 1,
          densityScale: 1,
        });
        return unsubscribeSpy;
      }),
      getSnapshot: vi.fn(() => ({
        sidebarPosition: 'left',
        sidebarSize: 'medium',
        sidebarWidth: 380,
        fontSizeScale: 1,
        densityScale: 1,
      })),
      update: vi.fn(async () => {}),
    },
  })),
}));

let mockStorage: Record<string, any> = {};
let registeredStorageListeners: ((changes: any) => void)[] = [];
const storageAddListenerSpy = vi.fn((fn) => {
  registeredStorageListeners.push(fn);
});
const storageRemoveListenerSpy = vi.fn((fn) => {
  registeredStorageListeners = registeredStorageListeners.filter((l) => l !== fn);
});

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
      addListener: storageAddListenerSpy,
      removeListener: storageRemoveListenerSpy,
    },
  },
};

describe('Sidebar Teardown Ownership', () => {
  let container: HTMLElement;
  let app: any;

  beforeEach(() => {
    mockStorage = {};
    registeredStorageListeners = [];
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

  const mountSidebar = async () => {
    app = createApp(Sidebar, { portalTarget: document.body });
    const vm = app.mount(container);
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));
    await nextTick();
    return { container, app, vm };
  };

  describe('Static teardown ownership contracts', () => {
    it('contains exactly one onUnmounted call in production source', () => {
      const matchCount = sidebarSource.match(/\bonUnmounted\s*\(/g)?.length ?? 0;
      expect(matchCount).toBe(1);
    });

    it('retains all essential teardown statements within single onUnmounted', () => {
      expect(sidebarSource).toContain(
        "document.removeEventListener('mouseup', clearOverlayMousedown)",
      );
      expect(sidebarSource).toContain("window.removeEventListener('keydown', handleGlobalKeyDown)");
      expect(sidebarSource).toContain('removeCloseAffixModalListener()');
      expect(sidebarSource).toContain('removeOpenAffixModalListener()');
      expect(sidebarSource).toContain('stopPreferences?.()');
      expect(sidebarSource).toContain(
        'chrome.storage.onChanged.removeListener(handleStorageChange)',
      );
      expect(sidebarSource).toContain("document.body.style.removeProperty('user-select')");
      expect(sidebarSource).toContain("document.body.style.removeProperty('cursor')");
    });
  });

  describe('Runtime teardown execution', () => {
    it('unsubscribes from preferences exactly once on unmount', async () => {
      const { app } = await mountSidebar();
      expect(unsubscribeSpy).not.toHaveBeenCalled();

      app.unmount();
      expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    });

    it('removes chrome storage listener exactly once on unmount', async () => {
      const { app } = await mountSidebar();
      expect(storageAddListenerSpy).toHaveBeenCalled();
      const sidebarStorageListener = storageAddListenerSpy.mock.calls[0]?.[0];
      expect(typeof sidebarStorageListener).toBe('function');

      app.unmount();

      const matchedRemovals = storageRemoveListenerSpy.mock.calls.filter(
        ([listener]) => listener === sidebarStorageListener,
      );
      expect(matchedRemovals).toHaveLength(1);
    });

    it('removes document and window event listeners on unmount', async () => {
      const docRemoveSpy = vi.spyOn(document, 'removeEventListener');
      const winRemoveSpy = vi.spyOn(window, 'removeEventListener');

      const { app } = await mountSidebar();
      app.unmount();

      expect(docRemoveSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(winRemoveSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      docRemoveSpy.mockRestore();
      winRemoveSpy.mockRestore();
    });

    it('cleans up resize event listeners and document body styles if unmounted during dragging', async () => {
      mockStorage['poe1:isCollapsed'] = false;
      mockStorage['isCollapsed'] = false;

      const { getPreferences } = await import('@/utils/preferences');
      (getPreferences as any).mockImplementationOnce(async () => ({
        ok: true,
        value: {
          subscribe: vi.fn((cb) => {
            cb({
              sidebarPosition: 'left',
              sidebarSize: 'custom',
              sidebarWidth: 340,
              fontSizeScale: 1,
              densityScale: 1,
            });
            return unsubscribeSpy;
          }),
          getSnapshot: vi.fn(() => ({
            sidebarPosition: 'left',
            sidebarSize: 'custom',
            sidebarWidth: 340,
            fontSizeScale: 1,
            densityScale: 1,
          })),
          update: vi.fn(async () => {}),
        },
      }));

      const { app } = await mountSidebar();

      const expandBtn = container.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
      if (expandBtn && expandBtn.style.display !== 'none') {
        expandBtn.click();
        await nextTick();
      }

      const resizeHandle = container.querySelector<HTMLElement>('.sidebar-resize-handle');
      expect(resizeHandle).not.toBeNull();
      resizeHandle?.dispatchEvent(new MouseEvent('mousedown', { clientX: 300, bubbles: true }));

      expect(document.body.style.getPropertyValue('user-select')).toBe('none');
      expect(document.body.style.getPropertyValue('cursor')).toBe('col-resize');

      const winRemoveSpy = vi.spyOn(window, 'removeEventListener');

      app.unmount();

      expect(winRemoveSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(winRemoveSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(document.body.style.getPropertyValue('user-select')).toBe('');
      expect(document.body.style.getPropertyValue('cursor')).toBe('');

      winRemoveSpy.mockRestore();
    });
  });
});
