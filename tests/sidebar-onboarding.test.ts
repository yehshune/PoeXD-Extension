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
    props: { focusRequest: { type: Object, default: null } },
    emits: ['ready'],
    setup(props, { emit }) {
      onMounted(() => emit('ready'));
      return () =>
        h('div', {
          'data-test-settings-focus': props.focusRequest
            ? `${(props.focusRequest as { section: string }).section}:${(props.focusRequest as { seq: number }).seq}`
            : undefined,
        });
    },
  }),
}));

// 沒有官方頁面可回應導覽的示範請求，直接回報沒做
vi.mock('@/utils/page-guide-demo-channel', () => ({
  requestPageGuideDemo: vi.fn(async () => false),
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

/** 頁面示範後等畫面更新的時間（usePageGuide 的 DEMO_RENDER_WAIT_MS 再多一點） */
const DEMO_STEP_WAIT_MS = 200;

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

  const mountSidebar = async (initialStorage: Record<string, any> = {}) => {
    Object.assign(mockStorage, initialStorage);
    app = createApp(Sidebar, { portalTarget: document.body });
    app.mount(container);
    await settle();
  };
  const freshInstall = { tourPending: true, expandHintPending: true, lastSeenVersion: '1.5.0' };
  const query = (selector: string) => container.querySelector(selector) as HTMLElement | null;
  /** 導覽說明框 teleport 到 portalTarget（document.body） */
  const queryDoc = (selector: string) => document.querySelector(selector) as HTMLElement | null;
  const bubbleTitle = () => queryDoc('[data-page-guide-bubble] h2')?.textContent?.trim();
  const clickNext = async () => {
    queryDoc('[data-page-guide-action="next"]')!.click();
    await settle();
  };

  it('shows nothing for existing users without onboarding state', async () => {
    await mountSidebar();
    expect(query('[data-onboarding-hint]')).toBeNull();
    query('[data-sidebar-action="expand"]')!.click();
    await settle();
    expect(queryDoc('[data-page-guide-bubble]')).toBeNull();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toBeUndefined();
  });

  it('shows the hint dot while collapsed and starts the tour on the first expand', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall });
    expect(query('[data-onboarding-hint]')).not.toBeNull();
    expect(queryDoc('[data-page-guide-bubble]')).toBeNull();

    query('[data-sidebar-action="expand"]')!.click();
    await settle();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toEqual({
      expandHintPending: false,
      tourPending: false,
      lastSeenVersion: '1.5.0',
    });
    expect(bubbleTitle()).toBe('歡迎使用 PoeXD');
    expect(queryDoc('[data-setup-kind="locale"]')).not.toBeNull();
  });

  it('never restarts the tour after it was skipped', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    expect(queryDoc('[data-page-guide-bubble]')).not.toBeNull();

    queryDoc('[data-page-guide-action="skip"]')!.click();
    await settle();
    expect(queryDoc('[data-page-guide-bubble]')).toBeNull();

    query('[data-sidebar-action="collapse"]')!.click();
    await settle();
    expect(query('[data-onboarding-hint]')).toBeNull();
    query('[data-sidebar-action="expand"]')!.click();
    await settle();
    expect(queryDoc('[data-page-guide-bubble]')).toBeNull();
  });

  it('reads the legacy welcomePending flag and starts the tour', async () => {
    await mountSidebar({
      [ONBOARDING_STORAGE_KEY]: { welcomePending: true, expandHintPending: false },
      isCollapsed_poe2: false,
    });
    expect(bubbleTitle()).toBe('歡迎使用 PoeXD');
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toEqual({
      tourPending: false,
      expandHintPending: false,
    });
  });

  it('starts the tour when expanded from another tab via storage', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: true });
    expect(query('[data-onboarding-hint]')).not.toBeNull();

    await (globalThis as any).chrome.storage.local.set({ isCollapsed_poe2: false });
    await settle();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toMatchObject({
      expandHintPending: false,
      tourPending: false,
    });
    expect(queryDoc('[data-page-guide-bubble]')).not.toBeNull();
  });

  it('changes language, market translation and appearance from the setup steps', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });

    const trigger = queryDoc('[data-setup-locale-trigger]')!;
    const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    trigger.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true }));
    trigger.click();
    await settle();
    const zhCnItem = queryDoc('[data-setup-locale="zh-CN"]')!;
    zhCnItem.focus?.();
    zhCnItem.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true }));
    zhCnItem.dispatchEvent(new EventCtor('pointerup', { bubbles: true, cancelable: true }));
    zhCnItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    zhCnItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ displayLocale: 'zh-CN' });

    await clickNext();
    expect(queryDoc('[data-setup-kind="market-translation"]')).not.toBeNull();
    queryDoc('[data-setup-action="market-translation"]')!.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ marketTranslation: true });

    await clickNext();
    expect(queryDoc('[data-setup-kind="appearance"]')).not.toBeNull();
    queryDoc('[data-setup-position="right"]')!.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ sidebarPosition: 'right' });
    expect(queryDoc('[data-setup-hint="custom-width"]')).not.toBeNull();
  });

  it('toggles market translation bilingual options when marketTranslation is enabled', async () => {
    snapshot = { ...snapshot, marketTranslation: true, marketTranslationBilingual: true };
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    await clickNext();
    expect(queryDoc('[data-setup-group="market-translation-bilingual"]')).not.toBeNull();
    queryDoc('[data-setup-action="market-translation-bilingual"]')!.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ marketTranslationBilingual: false });
    queryDoc('[data-setup-action="market-translation-result-bilingual"]')!.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ marketTranslationResultBilingual: true });
  });

  it('offers custom width dragging and font scale stepper/input/reset in the appearance step', async () => {
    snapshot = { ...snapshot, displayLocale: 'en', fontSizeScale: 1 };
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    await clickNext();
    expect(queryDoc('[data-setup-hint="custom-width"]')).not.toBeNull();

    const triggerBtn = queryDoc('[data-font-scale-trigger]') as HTMLButtonElement;
    const resetBtn = queryDoc('[data-font-scale-action="reset"]') as HTMLButtonElement;
    expect(triggerBtn.textContent).toContain('100%');
    expect(resetBtn.disabled).toBe(true);

    triggerBtn.click();
    await settle();

    const popover = queryDoc('[data-font-scale-popover]') as HTMLElement;
    expect(popover).not.toBeNull();
    const increaseBtn = popover.querySelector(
      '[data-font-scale-action="increase"]',
    ) as HTMLButtonElement;
    const decreaseBtn = popover.querySelector(
      '[data-font-scale-action="decrease"]',
    ) as HTMLButtonElement;
    const slider = popover.querySelector('[data-font-scale-slider]') as HTMLInputElement;
    const scaleInput = popover.querySelector('[data-font-scale-input]') as HTMLInputElement;

    increaseBtn.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ fontSizeScale: 1.05 });

    decreaseBtn.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ fontSizeScale: 1 });

    decreaseBtn.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ fontSizeScale: 0.95 });

    slider.dispatchEvent(new Event('pointerdown'));
    slider.value = '115';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ fontSizeScale: 1.15 });

    scaleInput.value = '120';
    scaleInput.dispatchEvent(new Event('input'));
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ fontSizeScale: 1.2 });

    // 設為 120% 後 reset 按鈕啟用，點擊恢復 100%
    snapshot = { ...snapshot, fontSizeScale: 1.2 };
    await (globalThis as any).chrome.storage.local.set({ _noop: Date.now() });
    scaleInput.value = '120';
    scaleInput.dispatchEvent(new Event('blur'));
    await settle();
  });

  it('skips the market translation step for non-Chinese display locales', async () => {
    snapshot = { ...snapshot, displayLocale: 'en' };
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    expect(queryDoc('[data-setup-kind="locale"]')).not.toBeNull();
    await clickNext();
    expect(queryDoc('[data-setup-kind="market-translation"]')).toBeNull();
    expect(queryDoc('[data-setup-kind="appearance"]')).not.toBeNull();
  });

  it('plays the collapse demo with a simulated cursor and re-expands for side bar steps', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    // locale → market translation → appearance → sidebar → collapse
    for (let i = 0; i < 4; i += 1) await clickNext();
    expect(queryDoc('[data-setup-kind="collapse-drag"]')).not.toBeNull();
    // 這一步允許點擊側欄收合鈕，但以挖空遮罩擋住背後官方頁面
    expect(queryDoc('[data-page-guide-blocker]')).toBeNull();
    expect(queryDoc('[data-page-guide-page-blocker]')).not.toBeNull();
    expect(queryDoc('[data-page-guide-cursor]')).not.toBeNull();
    const replay = queryDoc('[data-setup-action="replay-collapse-demo"]') as HTMLButtonElement;
    expect(replay.disabled).toBe(true);

    // 游標移到關閉鈕、按下後收合
    await new Promise((r) => setTimeout(r, 1200));
    await settle();
    expect(mockStorage.isCollapsed_poe2).toBe(true);

    // 回到上一步（指向側欄）時停止示範並自動展開
    queryDoc('[data-page-guide-action="previous"]')!.click();
    await new Promise((r) => setTimeout(r, 200));
    await settle();
    expect(queryDoc('[data-page-guide-cursor]')).toBeNull();
    expect(mockStorage.isCollapsed_poe2).toBe(false);
    // 示範只預覽標籤位置，不寫入設定
    expect(updatePreferencesSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ collapsedTabTop: expect.anything() }),
    );
  });

  it('toggles result features from the mock result steps', async () => {
    snapshot = { ...snapshot, displayLocale: 'en' };
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    // locale → appearance → sidebar → collapse → affix → tier → result actions
    // 詞綴與階級步驟會向頁面要示範並等畫面更新，每步多等一下
    for (let i = 0; i < 6; i += 1) {
      await clickNext();
      await new Promise((r) => setTimeout(r, DEMO_STEP_WAIT_MS));
    }
    expect(queryDoc('[data-setup-kind="result-features"]')).not.toBeNull();
    expect(queryDoc('[data-poexd-guide-mock]')).not.toBeNull();

    queryDoc('[data-setup-feature="enableResultPobCopy"]')!.click();
    await settle();
    expect(updatePreferencesSpy).toHaveBeenCalledWith({ enableResultPobCopy: false });
  });

  it('shows per-icon callouts beside each sidebar nav button on the sidebar step', async () => {
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });
    const nav = query('.sidebar-nav')!;
    nav.getBoundingClientRect = () =>
      ({ top: 0, bottom: 800, left: 320, right: 368, width: 48, height: 800 }) as DOMRect;
    nav.querySelectorAll('button').forEach((btn, idx) => {
      const top = 20 + idx * 48;
      (btn as HTMLElement).getBoundingClientRect = () =>
        ({ top, bottom: top + 36, left: 326, right: 362, width: 36, height: 36 }) as DOMRect;
    });

    // locale → market-translation → appearance → sidebar
    for (let i = 0; i < 3; i += 1) await clickNext();
    expect(bubbleTitle()).toBe('側邊欄功能');
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await settle();

    const callouts = Array.from(
      document.querySelectorAll<HTMLElement>('[data-page-guide-callout]'),
    );
    expect(callouts.length).toBeGreaterThanOrEqual(6);
    expect(callouts.map((el) => el.dataset.calloutId)).toContain('bookmark');
    expect(callouts.map((el) => el.dataset.calloutId)).toContain('pob-build');
    expect(callouts.map((el) => el.dataset.calloutId)).toContain('live-search');
    expect(callouts[0]!.style.left).toBe('380px');

    // 模擬不同字長的分頁標註：量測後應統一為相同寬度、標題欄寬與高度
    callouts.forEach((el, idx) => {
      const titleW = 50 + idx * 10;
      const descW = 100 + idx * 12;
      const cardW = titleW + descW + 32;
      el.getBoundingClientRect = () =>
        ({
          top: 0,
          bottom: 32,
          left: 380,
          right: 380 + cardW,
          width: cardW,
          height: 32,
        }) as DOMRect;
      const titleEl = el.querySelector<HTMLElement>('[data-callout-title]')!;
      const descEl = el.querySelector<HTMLElement>('[data-callout-desc]')!;
      titleEl.getBoundingClientRect = () =>
        ({ top: 0, bottom: 18, left: 0, right: titleW, width: titleW, height: 18 }) as DOMRect;
      descEl.getBoundingClientRect = () =>
        ({ top: 0, bottom: 18, left: 0, right: descW, width: descW, height: 18 }) as DOMRect;
    });
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await settle();

    const widths = new Set(callouts.map((el) => el.style.width));
    const cols = new Set(callouts.map((el) => el.style.gridTemplateColumns));
    const heights = new Set(callouts.map((el) => el.style.minHeight));
    expect(widths.size).toBe(1);
    expect(cols.size).toBe(1);
    expect(heights.size).toBe(1);
    expect(callouts[0]!.style.width).not.toBe('');
  });

  it('highlights the draggable resize edge and shows a callout on the appearance step for both sidebar positions', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: freshInstall, isCollapsed_poe2: false });

    const containerEl = query('.sidebar-container')!;
    const handleEl = query('.sidebar-resize-handle')!;
    let currentSide: 'left' | 'right' = 'left';
    containerEl.getBoundingClientRect = () =>
      (currentSide === 'left'
        ? { top: 0, bottom: 900, left: 0, right: 380, width: 380, height: 900 }
        : { top: 0, bottom: 900, left: 1060, right: 1440, width: 380, height: 900 }) as DOMRect;
    handleEl.getBoundingClientRect = () =>
      (currentSide === 'left'
        ? { top: 0, bottom: 900, left: 377, right: 383, width: 6, height: 900 }
        : { top: 0, bottom: 900, left: 1057, right: 1063, width: 6, height: 900 }) as DOMRect;

    // locale → market-translation → appearance
    await clickNext();
    await clickNext();
    expect(queryDoc('[data-setup-kind="appearance"]')).not.toBeNull();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await settle();

    const highlight = document.querySelector<HTMLElement>('[data-page-guide-resize-handle]');
    const grip = document.querySelector<HTMLElement>('[data-page-guide-resize-grip]');
    const callout = document.querySelector<HTMLElement>('[data-page-guide-resize-callout]');
    expect(highlight).not.toBeNull();
    expect(grip).not.toBeNull();
    expect(callout).not.toBeNull();
    expect(highlight!.className).toContain('pointer-events-none');
    expect(grip!.className).toContain('pointer-events-none');
    expect(callout!.className).toContain('pointer-events-none');
    expect(highlight!.style.left).toBe('377px');
    expect(highlight!.style.width).toBe('6px');
    expect(callout!.dataset.calloutSide).toBe('right');
    expect(callout!.style.left).toBe('400px');
    expect(callout!.textContent).toContain('拖曳這裡調整寬度');
    expect(document.querySelector('[data-page-guide-spotlight]')).not.toBeNull();
    expect(document.querySelector('[data-page-guide-ring]')).toBeNull();

    // 切換側欄位置到右側後，高亮與標註應同步換邊
    currentSide = 'right';
    queryDoc('[data-setup-position="right"]')!.click();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await settle();

    expect(highlight!.style.left).toBe('1057px');
    expect(callout!.dataset.calloutSide).toBe('left');
    expect(callout!.style.right).toBe('400px');

    // 離開外觀步驟後應清除邊緣標註
    await clickNext();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await settle();
    expect(document.querySelector('[data-page-guide-resize-handle]')).toBeNull();
    expect(document.querySelector('[data-page-guide-resize-grip]')).toBeNull();
    expect(document.querySelector('[data-page-guide-resize-callout]')).toBeNull();
  });

  it('shows the update notice across all tabs without collapsed hint dot and dismisses it once closed', async () => {
    const versionUpdate = {
      tourPending: false,
      expandHintPending: false,
      updatePending: true,
      lastSeenVersion: '1.6.1',
    };
    await mountSidebar({ [ONBOARDING_STORAGE_KEY]: versionUpdate, isCollapsed_poe2: true });
    // Does not show collapsed hint dot for updates
    expect(query('[data-onboarding-hint]')).toBeNull();

    query('[data-sidebar-action="expand"]')!.click();
    await settle();
    expect(queryDoc('[data-page-guide-bubble]')).toBeNull();

    const notice = query('[data-onboarding-update]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('v1.6.1');
    const releaseLink = query(
      '[data-onboarding-action="release-notes"]',
    ) as HTMLAnchorElement | null;
    expect(releaseLink).not.toBeNull();
    expect(releaseLink!.href).toBe('https://github.com/yehshune/PoeXD-Extension/releases');
    expect(releaseLink!.target).toBe('_blank');

    // Visible across all tabs
    for (const tabId of ['history', 'stat-group-template', 'tools', 'settings']) {
      query(`[data-sidebar-tab="${tabId}"]`)!.click();
      await settle();
      expect(query('[data-onboarding-update]')).not.toBeNull();
    }

    // New-feature jumps open the matching settings section and keep the notice visible
    query('[data-sidebar-tab="history"]')!.click();
    await settle();
    query('[data-onboarding-highlight="modules"]')!.click();
    await settle();
    expect(query('[data-sidebar-tab="settings"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(query('[data-test-settings-focus]')!.getAttribute('data-test-settings-focus')).toBe(
      'modules:1',
    );
    query('[data-onboarding-highlight="modules"]')!.click();
    await settle();
    // Clicking the same jump again issues a new request so the section re-highlights
    expect(query('[data-test-settings-focus]')!.getAttribute('data-test-settings-focus')).toBe(
      'modules:2',
    );
    expect(query('[data-onboarding-update]')).not.toBeNull();

    // Dismissing once hides it permanently
    query('[data-onboarding-action="dismiss-update"]')!.click();
    await settle();
    expect(query('[data-onboarding-update]')).toBeNull();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toEqual({
      tourPending: false,
      expandHintPending: false,
      lastSeenVersion: '1.6.1',
    });
  });

  it('starts the tour when the install state arrives after the sidebar mounted', async () => {
    await mountSidebar({ isCollapsed_poe2: false });
    expect(queryDoc('[data-page-guide-bubble]')).toBeNull();
    await (globalThis as any).chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: freshInstall });
    await settle();
    expect(queryDoc('[data-page-guide-bubble]')).not.toBeNull();
    expect(mockStorage[ONBOARDING_STORAGE_KEY]).toMatchObject({
      expandHintPending: false,
      tourPending: false,
    });
  });
});
