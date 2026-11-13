// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.pathofexile.com/trade2/search/poe2"}
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { ONBOARDING_STORAGE_KEY } from '@/utils/onboarding';

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
    sidebarSize: 'medium',
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

describe('Sidebar first-install onboarding', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp> | null = null;

  beforeEach(() => {
    mockStorage = {};
    storageListeners.clear();
    snapshot = {
      sidebarPosition: 'left',
      sidebarSize: 'medium',
      sidebarWidth: 380,
      fontSizeScale: 1,
      densityScale: 1,
      displayLocale: 'zh-TW',
      marketTranslation: false,
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

  const mountSidebar = async (initialStorage: Record<string, any> = {}) => {
    Object.assign(mockStorage, initialStorage);
    app = createApp(Sidebar, { portalTarget: document.body });
    app.mount(container);
    await settle();
  };
  const freshInstall = { welcomePending: true, expandHintPending: true, lastSeenVersion: '1.5.0' };
  const query = (selector: string) => container.querySelector(selector) as HTMLElement | null;

  it('shows nothing for existing users without onboarding state', async () => {
    await mountSidebar();
    expect(query('[data-onboarding-hint]')).toBeNull();
    query('[data-sidebar-action="expand"]')!.click();
    await settle();
    expect(query('[data-onboarding-welcome]')).toBeNull();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toBeUndefined();
  });

  it('shows the hint dot while collapsed and clears it on the first expand', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall });
    expect(query('[data-onboarding-hint]')).not.toBeNull();

    query('[data-sidebar-action="expand"]')!.click();
    await settle();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toMatchObject({
      expandHintPending: false,
      welcomePending: true,
    });

    query('[data-sidebar-action="collapse"]')!.click();
    await settle();
    expect(query('[data-onboarding-hint]')).toBeNull();
  });

  it('shows the welcome card on the bookmark tab and dismisses it permanently', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    const card = query('[data-onboarding-welcome]');
    expect(card).not.toBeNull();
    expect(card!.compareDocumentPosition(query('[data-test="bookmark-pane"]')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    query('[data-onboarding-action="dismiss"]')!.click();
    await settle();
    expect(query('[data-onboarding-welcome]')).toBeNull();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toMatchObject({ welcomePending: false });
  });

  it('reacts when the install state arrives after the sidebar mounted', async () => {
    await mountSidebar({ isCollapsed_poe2: false });
    expect(query('[data-onboarding-welcome]')).toBeNull();
    await (globalThis as any).chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: freshInstall });
    await settle();
    expect(query('[data-onboarding-welcome]')).not.toBeNull();
  });

  it('offers market translation on the international site and enables it through preferences', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    const toggle = query('[data-onboarding-action="market-translation"]');
    expect(toggle).not.toBeNull();
    toggle!.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ marketTranslation: true });
  });

  it('hides the market translation offer for non-Chinese display locales', async () => {
    snapshot = { ...snapshot, displayLocale: 'en' };
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    expect(query('[data-onboarding-welcome]')).not.toBeNull();
    expect(query('[data-onboarding-action="market-translation"]')).toBeNull();
  });
});
