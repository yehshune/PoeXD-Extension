// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { extensionMessaging } from '@/utils/extension-protocol';

// Spy records for child pane mount persistence
const paneMountCounts = {
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
      return () => h('div', { 'data-test': 'bookmark-pane' });
    },
  }),
}));

vi.mock('@/components/sidebar/HistoryPane.vue', () => ({
  default: defineComponent({
    name: 'HistoryPane',
    setup() {
      paneMountCounts.history++;
      return () => h('div', { 'data-test': 'history-pane' });
    },
  }),
}));

vi.mock('@/components/sidebar/ToolsPane.vue', () => ({
  default: defineComponent({
    name: 'ToolsPane',
    setup() {
      paneMountCounts.tools++;
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
      return () => h('div', { 'data-test': 'settings-pane' });
    },
  }),
}));

vi.mock('@/components/sidebar/LiveSearchPrimaryPane.vue', () => ({
  default: defineComponent({
    name: 'LiveSearchPrimaryPane',
    props: ['controller', 'bookmarkController'],
    emits: ['open-add-connection'],
    setup(props, { emit }) {
      paneMountCounts.liveSearchPrimary++;
      return () =>
        h(
          'div',
          {
            'data-sidebar-pane': 'live-search-primary',
            'data-test': 'live-search-primary-pane',
            'data-has-controller': Boolean(props.controller) ? 'true' : 'false',
            'data-has-bookmark-controller': Boolean(props.bookmarkController) ? 'true' : 'false',
          },
          [
            h('button', {
              'data-test': 'mock-pane-open-add-connection',
              onClick: () => emit('open-add-connection'),
            }),
          ],
        );
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

vi.mock('@/components/sidebar/LiveSearchConsoleSettingsPane.vue', () => ({
  default: defineComponent({
    name: 'LiveSearchConsoleSettingsPane',
    setup() {
      paneMountCounts.liveSearchConsoleSettings++;
      return () =>
        h('div', {
          'data-sidebar-pane': 'live-search-console-settings',
          'data-test': 'live-search-console-settings-pane',
        });
    },
  }),
}));

vi.mock('@/components/sidebar/LiveSearchResumeInspectPopover.vue', () => ({
  default: defineComponent({
    name: 'LiveSearchResumeInspectPopover',
    props: ['open', 'items', 'leagueDisplay', 'isBatchRunning'],
    emits: ['update:open', 'restore'],
    setup(props, { slots, emit }) {
      return () =>
        h('div', { 'data-test': 'live-search-resume-inspect-popover-mock' }, [
          slots.default ? slots.default() : null,
          props.open
            ? h('div', {
                'data-test': 'resume-inspect-content-mock',
                'data-items-count': String(props.items?.length ?? 0),
                'data-league': props.leagueDisplay,
                onClick: () => emit('restore'),
              })
            : null,
        ]);
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
      update: vi.fn(async () => {}),
      read: vi.fn(() => activeMockPreferences),
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
      get: vi.fn(async (keys?: string | string[]) => {
        if (!keys) return { ...mockStorage };
        if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
        return (keys as string[]).reduce(
          (acc, k) => {
            acc[k] = mockStorage[k];
            return acc;
          },
          {} as Record<string, any>,
        );
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

describe('Sidebar Page Role & UI Mode Integration Tests', () => {
  let container: HTMLElement;
  let app: any;

  beforeEach(() => {
    resetPaneCounts();
    mockStorage = {
      isCollapsed: false,
      'isCollapsed:poe1': false,
      'isCollapsed:poe2': false,
    };
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

  it('7. Normal page 維持原本 Sidebar：渲染 Bookmark/History/Settings 導覽與 panes，並提供開啟 LiveSearch 入口', async () => {
    app = createApp(Sidebar, { pageRole: 'normal' });
    app.mount(container);
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    // 驗證普通導覽按鈕存在
    const bookmarkBtn = container.querySelector('[data-sidebar-tab="bookmark"]');
    const historyBtn = container.querySelector('[data-sidebar-tab="history"]');
    const settingsBtn = container.querySelector('[data-sidebar-tab="settings"]');
    expect(bookmarkBtn).not.toBeNull();
    expect(historyBtn).not.toBeNull();
    expect(settingsBtn).not.toBeNull();

    // 驗證開啟 LiveSearch 按鈕存在
    const openLiveSearchBtn = container.querySelector(
      '[data-sidebar-action="open-live-search"]',
    ) as HTMLButtonElement | null;
    expect(openLiveSearchBtn).not.toBeNull();

    // 驗證 normal panes 有被 mount，而 Primary panes 未被 mount
    expect(paneMountCounts.bookmark).toBeGreaterThan(0);
    expect(paneMountCounts.history).toBeGreaterThan(0);
    expect(paneMountCounts.settings).toBeGreaterThan(0);
    expect(paneMountCounts.liveSearchPrimary).toBe(0);
    expect(paneMountCounts.liveSearchConsoleSettings).toBe(0);

    // 測試點擊開啟線上搜尋主控台發送 extension message（由 Background 以 Trade root bootstrap，不帶入 targetUrl）
    const sendSpy = vi.spyOn(extensionMessaging, 'sendMessage').mockResolvedValueOnce({
      success: true,
      tabId: 999,
    } as any);

    openLiveSearchBtn?.click();
    await nextTick();
    expect(sendSpy).toHaveBeenCalledWith('liveSearch:openPrimary', {
      gameVersion: expect.any(String),
    });
  });

  it('8. Primary page 渲染專用導覽（搜尋連線、＋ 自訂搜尋、主控台設定），同步切換 activeTabName 與 Panes，且絕不 mount 普通 Bookmark / History / Settings panes', async () => {
    const mockController = {
      read: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      addFromUrl: vi.fn(),
      remove: vi.fn(),
    };

    const mockBookmarkController = {
      subscribe: vi.fn(() => () => {}),
      add: vi.fn(),
      dispose: vi.fn(),
    };

    app = createApp(Sidebar, {
      pageRole: 'live-search-primary',
      liveSearchController: mockController,
      liveSearchBookmarkController: mockBookmarkController,
    });
    app.mount(container);
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    // 驗證普通導覽按鈕不可見/不存在
    const bookmarkBtn = container.querySelector('[data-sidebar-tab="bookmark"]');
    const historyBtn = container.querySelector('[data-sidebar-tab="history"]');
    const toolsBtn = container.querySelector('[data-sidebar-tab="tools"]');
    const settingsBtn = container.querySelector('[data-sidebar-tab="settings"]');
    const openLiveSearchBtn = container.querySelector('[data-sidebar-action="open-live-search"]');
    expect(bookmarkBtn).toBeNull();
    expect(historyBtn).toBeNull();
    expect(toolsBtn).toBeNull();
    expect(settingsBtn).toBeNull();
    expect(openLiveSearchBtn).toBeNull();

    // 驗證 Primary 專用導覽按鈕存在
    const connectionsNavBtn = container.querySelector<HTMLButtonElement>(
      '[data-sidebar-tab="connections"]',
    );
    const customSearchActionBtn = container.querySelector<HTMLButtonElement>(
      '[data-sidebar-action="open-custom-search"]',
    );
    const consoleSettingsNavBtn = container.querySelector<HTMLButtonElement>(
      '[data-sidebar-tab="console-settings"]',
    );

    expect(connectionsNavBtn).not.toBeNull();
    expect(connectionsNavBtn?.getAttribute('title')).toBe('搜尋連線');
    expect(connectionsNavBtn?.getAttribute('aria-pressed')).toBe('true');

    expect(customSearchActionBtn).not.toBeNull();
    expect(customSearchActionBtn?.getAttribute('title')).toBe('＋ 新增搜尋連線');

    expect(consoleSettingsNavBtn).not.toBeNull();
    expect(consoleSettingsNavBtn?.getAttribute('title')).toBe('主控台設定');
    expect(consoleSettingsNavBtn?.getAttribute('aria-pressed')).toBe('false');
    expect(consoleSettingsNavBtn?.className).toContain('mt-auto');

    // 驗證預設頂部標題為「搜尋連線」且無 Primary 字眼
    const activeTabTitle = container.querySelector('.active-tab-title');
    expect(activeTabTitle?.textContent?.trim()).toBe('搜尋連線');
    expect(activeTabTitle?.textContent).not.toMatch(/primary/i);

    // 核心驗證：絕對不 mount 普通 Bookmark/History/Tools/Settings panes
    expect(paneMountCounts.bookmark).toBe(0);
    expect(paneMountCounts.history).toBe(0);
    expect(paneMountCounts.tools).toBe(0);
    expect(paneMountCounts.settings).toBe(0);

    // 核心驗證：mount LiveSearch 專用 Primary pane 與 Console Settings pane
    expect(paneMountCounts.liveSearchPrimary).toBe(1);
    expect(paneMountCounts.liveSearchConsoleSettings).toBe(1);

    const primaryPane = container.querySelector<HTMLElement>(
      '[data-sidebar-pane="live-search-primary"]',
    );
    const consoleSettingsPane = container.querySelector<HTMLElement>(
      '[data-sidebar-pane="live-search-console-settings"]',
    );
    expect(primaryPane).not.toBeNull();
    expect(consoleSettingsPane).not.toBeNull();
    expect(primaryPane?.getAttribute('data-has-controller')).toBe('true');
    expect(primaryPane?.getAttribute('data-has-bookmark-controller')).toBe('true');
    expect(primaryPane?.style.display).not.toBe('none');
    expect(consoleSettingsPane?.style.display).toBe('none');

    // 切換至「主控台設定」
    consoleSettingsNavBtn?.click();
    await nextTick();

    expect(activeTabTitle?.textContent?.trim()).toBe('主控台設定');
    expect(connectionsNavBtn?.getAttribute('aria-pressed')).toBe('false');
    expect(consoleSettingsNavBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(primaryPane?.style.display).toBe('none');
    expect(consoleSettingsPane?.style.display).not.toBe('none');
    expect(paneMountCounts.settings).toBe(0);

    // 在「主控台設定」點擊「＋ 暫時搜尋」action -> 開啟暫時搜尋 Dialog，且不強制切換目前分頁
    expect(container.querySelector('[data-test="temporary-search-dialog-mock"]')).toBeNull();
    customSearchActionBtn?.click();
    await nextTick();

    expect(container.querySelector('[data-test="temporary-search-dialog-mock"]')).not.toBeNull();
    // 維持在「主控台設定」，不跳回「搜尋連線」
    expect(activeTabTitle?.textContent?.trim()).toBe('主控台設定');
    expect(consoleSettingsNavBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(connectionsNavBtn?.getAttribute('aria-pressed')).toBe('false');
    expect(primaryPane?.style.display).toBe('none');
    expect(consoleSettingsPane?.style.display).not.toBe('none');

    // 關閉 Dialog 亦維持原分頁
    const mockDialog = container.querySelector<HTMLElement>(
      '[data-test="temporary-search-dialog-mock"]',
    );
    mockDialog?.click();
    await nextTick();
    expect(container.querySelector('[data-test="temporary-search-dialog-mock"]')).toBeNull();
    expect(activeTabTitle?.textContent?.trim()).toBe('主控台設定');
  });

  it('9. 既有 Sidebar layout/theme/scale/density/resize contract 在 Primary 模式下不退化', async () => {
    activeMockPreferences.sidebarSize = 'custom';
    activeMockPreferences.sidebarWidth = 500;
    activeMockPreferences.fontSizeScale = 1.1;
    activeMockPreferences.densityScale = 1.2;

    app = createApp(Sidebar, { pageRole: 'live-search-primary' });
    app.mount(container);
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const wrapper = container.querySelector('.pxd-sidebar-wrapper') as HTMLElement;
    expect(wrapper).not.toBeNull();

    // 展開狀態下的寬度依舊符合 preferences
    expect(wrapper.style.width).toBe('500px');

    // 驗證 resize handle 在 custom 尺寸下依然正常存在
    const resizeHandle = container.querySelector('.sidebar-resize-handle');
    expect(resizeHandle).not.toBeNull();

    // 驗證收合按鈕依然可正常切換收合狀態 (維持 collapse geometry)
    const collapseBtn = container.querySelector(
      '[data-sidebar-action="collapse"]',
    ) as HTMLButtonElement | null;
    expect(collapseBtn).not.toBeNull();
    collapseBtn?.click();
    await nextTick();

    expect(wrapper.classList.contains('collapsed')).toBe(true);
    expect(wrapper.style.width).toBe('var(--pxd-sidebar-collapsed-width)');

    // 展開按鈕依然存在
    const expandBtn = container.querySelector(
      '[data-sidebar-action="expand"]',
    ) as HTMLButtonElement | null;
    expect(expandBtn).not.toBeNull();
    expandBtn?.click();
    await nextTick();

    expect(wrapper.classList.contains('collapsed')).toBe(false);
  });

  describe('Primary Arrival Feedback Presentation Tests', () => {
    it('10. Newly-created primary 透過 initialArrivalSignal 呈現 viewport feedback layer，具備 pointer-events none 語意並在 1200ms 後自然消退', async () => {
      vi.useFakeTimers();
      try {
        app = createApp(Sidebar, {
          pageRole: 'live-search-primary',
          initialArrivalSignal: true,
        });
        app.mount(container);
        await nextTick();
        await vi.advanceTimersByTimeAsync(50);

        const frame = container.querySelector('[data-live-search-arrival="viewport-frame"]');
        expect(frame).not.toBeNull();
        expect(frame?.classList.contains('pointer-events-none')).toBe(true);
        expect(frame?.getAttribute('aria-hidden')).toBe('true');

        // 1200ms 後 transient arrival state 自然消退
        await vi.advanceTimersByTimeAsync(1250);
        expect(container.querySelector('[data-live-search-arrival="viewport-frame"]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('11. 非 action-driven reload (initialArrivalSignal: false) 不會自行觸發 arrival viewport feedback layer', async () => {
      app = createApp(Sidebar, {
        pageRole: 'live-search-primary',
        initialArrivalSignal: false,
      });
      app.mount(container);
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const frame = container.querySelector('[data-live-search-arrival="viewport-frame"]');
      expect(frame).toBeNull();
    });

    it('12. 透過 liveSearch:notifyArrival 訊息可觸發 viewport feedback layer，且快速重複觸發可安全重啟而不累積 queue', async () => {
      vi.useFakeTimers();
      try {
        let arrivalHandler: (() => void) | undefined;
        vi.spyOn(extensionMessaging, 'onMessage').mockImplementation((type: any, handler: any) => {
          if (type === 'liveSearch:notifyArrival') {
            arrivalHandler = handler;
          }
          return () => {};
        });

        app = createApp(Sidebar, {
          pageRole: 'live-search-primary',
          initialArrivalSignal: false,
        });
        app.mount(container);
        await nextTick();

        expect(container.querySelector('[data-live-search-arrival="viewport-frame"]')).toBeNull();

        // 收到 notifyArrival 訊息
        expect(arrivalHandler).toBeDefined();
        arrivalHandler!();
        await nextTick();
        await vi.advanceTimersByTimeAsync(50);
        const frame = container.querySelector('[data-live-search-arrival="viewport-frame"]');
        expect(frame).not.toBeNull();
        expect(frame?.classList.contains('pointer-events-none')).toBe(true);

        // 在 400ms 時快速再次觸發（重複點擊），應安全重啟計時器
        await vi.advanceTimersByTimeAsync(400);
        expect(
          container.querySelector('[data-live-search-arrival="viewport-frame"]'),
        ).not.toBeNull();
        arrivalHandler!();
        await nextTick();
        await vi.advanceTimersByTimeAsync(50);
        expect(
          container.querySelector('[data-live-search-arrival="viewport-frame"]'),
        ).not.toBeNull();

        // 再經過 700ms（自第二次觸發起僅 750ms，未達 1200ms），狀態依然應為 active
        await vi.advanceTimersByTimeAsync(700);
        expect(
          container.querySelector('[data-live-search-arrival="viewport-frame"]'),
        ).not.toBeNull();

        // 再過 550ms（自第二次觸發滿 1300ms），自然消退
        await vi.advanceTimersByTimeAsync(550);
        expect(container.querySelector('[data-live-search-arrival="viewport-frame"]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('13. 恢復操作已收斂至「上次連線」分區，側邊導覽列不再渲染冗餘的 btn-sidebar-resume-action 按鈕', async () => {
      let resumeListener: ((snap: any) => void) | undefined;
      const currentSnap = {
        state: 'prompted',
        mode: 'prompt',
        hasPersistedPlan: true,
        resumableCount: 3,
        resumableSourceIds: ['bm_1', 'bm_2', 'bm_3'],
        bannerVisible: true,
        autoRestoreOutcome: null,
      };

      const mockResumeController = {
        read: () => ({ ...currentSnap }),
        subscribe: (cb: any) => {
          resumeListener = cb;
          return () => {};
        },
        restore: vi.fn(),
        skip: vi.fn(),
        dispose: vi.fn(),
      };

      const mockBookmarkController = {
        read: () => ({
          groups: [
            {
              id: 'grp_1',
              name: '我的書籤',
              order: 0,
              kind: 'bookmark',
              items: [
                { id: 'bm_1', name: '書籤 1', kind: 'bookmark', status: 'idle' },
                { id: 'bm_2', name: '書籤 2', kind: 'bookmark', status: 'idle' },
                { id: 'bm_3', name: '書籤 3', kind: 'bookmark', status: 'idle' },
              ],
            },
          ],
          selectedLeague: 'Standard',
          availableLeagues: ['Standard'],
          isSwitchingLeague: false,
        }),
        subscribe: () => () => {},
      };

      app = createApp(Sidebar, {
        pageRole: 'live-search-primary',
        liveSearchResumeController: mockResumeController,
        liveSearchBookmarkController: mockBookmarkController,
      });
      app.mount(container);
      await nextTick();

      // 無論 bannerVisible 為 true 或 false，側邊欄皆不再重複渲染恢復連線按鈕
      expect(container.querySelector('[data-sidebar-action="resume-connections"]')).toBeNull();

      currentSnap.bannerVisible = false;
      currentSnap.state = 'skipped';
      resumeListener?.({ ...currentSnap });
      await nextTick();

      expect(container.querySelector('[data-sidebar-action="resume-connections"]')).toBeNull();
    });

    it('14. LiveSearchPrimaryPane 發出 open-add-connection 事件時可直接開啟新增搜尋連線 Dialog', async () => {
      app = createApp(Sidebar, {
        pageRole: 'live-search-primary',
      });
      app.mount(container);
      await nextTick();

      expect(container.querySelector('[data-test="temporary-search-dialog-mock"]')).toBeNull();

      const paneAddBtn = container.querySelector(
        '[data-test="mock-pane-open-add-connection"]',
      ) as HTMLButtonElement;
      expect(paneAddBtn).not.toBeNull();
      paneAddBtn.click();
      await nextTick();

      expect(container.querySelector('[data-test="temporary-search-dialog-mock"]')).not.toBeNull();
    });
  });
});
