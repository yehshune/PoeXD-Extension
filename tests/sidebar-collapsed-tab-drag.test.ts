// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.pathofexile.com/trade2/search/poe2"}
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { listenPoeEvent } from '@/utils/event-contracts';

vi.mock('@/components/sidebar/FilterPane.vue', () => ({
  default: defineComponent({ name: 'FilterPane', setup: () => () => h('div') }),
}));
vi.mock('@/components/sidebar/BookmarkPane.vue', () => ({
  default: defineComponent({
    name: 'BookmarkPane',
    setup: () => () => h('div', { 'data-test': 'bookmark-pane' }),
  }),
}));
vi.mock('@/components/sidebar/HistoryPane.vue', () => ({
  default: defineComponent({ name: 'HistoryPane', setup: () => () => h('div') }),
}));
vi.mock('@/components/sidebar/ToolsPane.vue', () => ({
  default: defineComponent({ name: 'ToolsPane', setup: () => () => h('div') }),
}));
vi.mock('@/components/sidebar/SettingsPane.vue', () => ({
  default: defineComponent({
    name: 'SettingsPane',
    emits: ['ready'],
    setup(_props, { emit }) {
      onMounted(() => emit('ready'));
      return () => h('div');
    },
  }),
}));

let snapshot: Record<string, unknown> = {};
const updatePreferencesSpy = vi.fn(async () => ({ ok: true, changed: true }));

vi.mock('@/utils/preferences', () => ({
  DEFAULT_PREFERENCES: {
    sidebarPosition: 'left',
    sidebarWidth: 380,
    fontSizeScale: 1,
    densityScale: 1,
  },
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      subscribe: vi.fn((cb) => {
        cb(snapshot);
        return () => {};
      }),
      update: updatePreferencesSpy,
      read: vi.fn(() => snapshot),
    },
  })),
}));

let mockStorage: Record<string, any> = {};
const storageListeners = new Set<(changes: Record<string, any>, area: string) => void>();

(globalThis as any).chrome = {
  runtime: { getURL: vi.fn((path: string) => path) },
  storage: {
    local: {
      get: vi.fn(async (keys?: any) => {
        if (!keys) return { ...mockStorage };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.map((k: string) => [k, mockStorage[k]]));
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(mockStorage, items);
        const changes = Object.fromEntries(
          Object.entries(items).map(([k, v]) => [k, { newValue: v }]),
        );
        storageListeners.forEach((listener) => listener(changes, 'local'));
      }),
    },
    onChanged: {
      addListener: vi.fn((listener) => storageListeners.add(listener)),
      removeListener: vi.fn((listener) => storageListeners.delete(listener)),
    },
  },
};

const settle = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
};

describe('Sidebar collapsed tab drag', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp> | null = null;

  beforeEach(() => {
    mockStorage = {};
    storageListeners.clear();
    snapshot = {
      sidebarPosition: 'left',
      sidebarWidth: 380,
      fontSizeScale: 1,
      densityScale: 1,
      displayLocale: 'zh-TW',
      marketTranslation: false,
      collapsedTabTop: 100,
    };
    updatePreferencesSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    container.remove();
    document.body.innerHTML = '';
  });

  const mountSidebar = async () => {
    mockStorage.isCollapsed_poe2 = true;
    app = createApp(Sidebar, { portalTarget: document.body });
    app.mount(container);
    await settle();
  };
  const tab = () => container.querySelector('[data-sidebar-action="expand"]') as HTMLElement;
  const wrapper = () => container.querySelector('.pxd-sidebar-wrapper') as HTMLElement;
  const pointer = (type: string, clientY: number) =>
    new PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerId: 1, clientY });
  const stubRect = (top: number) => {
    tab().getBoundingClientRect = () => ({ top, height: 32 }) as DOMRect;
  };

  it('renders the stored top with a viewport clamp', async () => {
    snapshot.collapsedTabTop = 260;
    await mountSidebar();
    expect(wrapper().style.top).toBe('var(--pxd-collapsed-tab-top, 100px)');
    expect(wrapper().style.getPropertyValue('--pxd-collapsed-tab-top')).toContain('260px');
  });

  it('renders edge-peek micro-handle attributes and passes through wrapper pointer events when collapsed', async () => {
    snapshot.sidebarPosition = 'right';
    await mountSidebar();
    expect(wrapper().classList.contains('pointer-events-none')).toBe(true);
    expect(tab().classList.contains('pxd-collapsed-tab')).toBe(true);
    expect(tab().getAttribute('data-edge')).toBe('right');
    expect(tab().querySelector('.pxd-collapsed-tab-grip')).not.toBeNull();
  });

  it('moves the tab vertically, previews live and saves on release without expanding', async () => {
    await mountSidebar();
    stubRect(100);
    const previews: number[] = [];
    const stop = listenPoeEvent('poexd-sidebar-collapsed-top-preview', (top) => previews.push(top));

    tab().dispatchEvent(pointer('pointerdown', 110));
    tab().dispatchEvent(pointer('pointermove', 190));
    tab().dispatchEvent(pointer('pointerup', 190));
    tab().click();
    await settle();
    stop();

    expect(previews.at(-1)).toBe(180);
    expect(wrapper().style.getPropertyValue('--pxd-collapsed-tab-top')).toContain('180px');
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ collapsedTabTop: 180 });
    expect(mockStorage.isCollapsed_poe2).toBe(true);
  });

  it('treats a tiny movement as a click and expands the panel', async () => {
    await mountSidebar();
    stubRect(100);
    tab().dispatchEvent(pointer('pointerdown', 110));
    tab().dispatchEvent(pointer('pointermove', 112));
    tab().dispatchEvent(pointer('pointerup', 112));
    tab().click();
    await settle();

    expect(updatePreferencesSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ collapsedTabTop: expect.anything() }),
    );
    expect(mockStorage.isCollapsed_poe2).toBe(false);
  });

  it('moves the tab with Alt + arrow keys', async () => {
    await mountSidebar();
    stubRect(100);
    tab().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
    );
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ collapsedTabTop: 120 });
  });

  it('resets drag state and uncommitted preview if expanded externally mid-drag', async () => {
    await mountSidebar();
    stubRect(100);
    tab().dispatchEvent(pointer('pointerdown', 110));
    tab().dispatchEvent(pointer('pointermove', 190));
    await nextTick();
    expect(tab().getAttribute('data-dragging')).toBe('true');

    // 模擬外部（例如擴充圖示或跨分頁同步）展開側邊欄
    await (globalThis as any).chrome.storage.local.set({ isCollapsed_poe2: false });
    await settle();
    await (globalThis as any).chrome.storage.local.set({ isCollapsed_poe2: true });
    await settle();

    expect(tab().getAttribute('data-dragging')).toBeNull();
    expect(wrapper().style.getPropertyValue('--pxd-collapsed-tab-top')).toContain('100px');
    expect(updatePreferencesSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ collapsedTabTop: expect.anything() }),
    );
  });
});
