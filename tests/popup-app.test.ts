// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from 'vue';
import PopupApp from '@/entrypoints/popup/App.vue';
import { createInMemoryPreferencesStorage, type PreferencesModule } from '@/utils/preferences';
import { resetI18nStateForTests } from '@/utils/i18n';

let storage = createInMemoryPreferencesStorage();
let currentModule: PreferencesModule | undefined;
let requestedVersion: string | undefined;

vi.mock('@/utils/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/preferences')>();
  return {
    ...actual,
    getPreferences: vi.fn(async (version: string) => {
      requestedVersion = version;
      const outcome = await actual.createPreferencesModule(version as any, storage);
      if (outcome.ok) currentModule = outcome.value;
      return outcome;
    }),
  };
});

describe('Popup App Component (Brand Emblem, Theme Token & Auto Detection)', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    storage = createInMemoryPreferencesStorage();
    container = document.createElement('div');
    document.body.appendChild(container);
    requestedVersion = undefined;
  });

  afterEach(() => {
    resetI18nStateForTests('zh-TW');
    app?.unmount();
    container.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    vi.restoreAllMocks();
  });

  it('renders brand emblem ToolboxIcon, title, and all 6 module toggle items with Checkboxes on trade page', async () => {
    app = createApp(PopupApp, { initialIsTradePage: true });
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    // Brand emblem ToolboxIcon exists
    const emblem = container.querySelector('svg[aria-label="PoeXD Brand Gear Emblem"]');
    expect(emblem).toBeDefined();

    // Title exists
    expect(container.textContent).toContain('PoeXD');
    expect(container.textContent).toContain('模組啟用控制');

    // All 7 modules exist
    const rows = container.querySelectorAll('[data-popup-module-row]');
    expect(rows.length).toBe(7);

    // Checkbox elements exist for all 7 items
    const checkboxes = container.querySelectorAll('[data-slot="checkbox"]');
    expect(checkboxes.length).toBe(7);

    const text = container.textContent || '';
    expect(text).not.toContain('側邊欄主體');
    expect(text).toContain('T 階快捷按鈕');
    expect(text).toContain('詞綴選擇器');
    expect(text).toContain('價格換算');
    expect(text).toContain('結果詞綴高亮');
    expect(text).toContain('隱藏官方背景');
    expect(text).toContain('替換網頁標題');
    expect(text).toContain('市集漢化');
  });

  it('applies data-poexd-theme attribute matching preferences theme to root and documentElement', async () => {
    app = createApp(PopupApp);
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeDefined();
    expect(root.getAttribute('data-poexd-theme')).toBe('modern-dark');
    expect(document.documentElement.getAttribute('data-poexd-theme')).toBe('modern-dark');
  });

  it('toggles a module setting when clicked on trade page and persists to preferences', async () => {
    app = createApp(PopupApp, { initialIsTradePage: true });
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    expect(currentModule?.read().enableTierHelper).toBe(true);

    const tierHelperRow = container.querySelector(
      '[data-module-key="enableTierHelper"]',
    ) as HTMLElement;
    expect(tierHelperRow).toBeDefined();

    tierHelperRow.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(currentModule?.read().enableTierHelper).toBe(false);

    tierHelperRow.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(currentModule?.read().enableTierHelper).toBe(true);
  });

  it('rolls back toggle state if currentModule.update fails', async () => {
    app = createApp(PopupApp, { initialIsTradePage: true });
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    expect(currentModule?.read().enableTierHelper).toBe(true);

    if (currentModule) {
      vi.spyOn(currentModule, 'update').mockResolvedValueOnce({
        ok: false,
        error: { code: 'unavailable', message: 'Storage unavailable' },
      });
    }

    const tierHelperRow = container.querySelector(
      '[data-module-key="enableTierHelper"]',
    ) as HTMLElement;
    tierHelperRow.click();
    await new Promise((r) => setTimeout(r, 20));

    // Should rollback to true
    const checkbox = container.querySelector('#enableTierHelper') as HTMLButtonElement;
    expect(checkbox.getAttribute('data-state')).toBe('checked');
  });

  it('auto detects poe2 when active tab url contains /trade2', async () => {
    (globalThis as any).chrome = {
      tabs: {
        query: vi
          .fn()
          .mockResolvedValue([{ url: 'https://www.pathofexile.com/trade2/search/Standard' }]),
      },
    };

    app = createApp(PopupApp);
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    expect(requestedVersion).toBe('poe2');
    expect(container.textContent).toContain('PoE 2');
    expect(container.querySelector('[data-trade-badge]')).not.toBeNull();
    expect(container.querySelectorAll('[data-popup-module-row]').length).toBe(8);
    expect(container.querySelector('[data-module-key="enableItemNormalizer"]')).not.toBeNull();
  });

  it('renders only website links and NO settings or switcher on non-poe pages', async () => {
    const createTabMock = vi.fn();
    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ url: 'https://google.com' }]),
        create: createTabMock,
      },
    };

    app = createApp(PopupApp);
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    // Non-trade view exists
    expect(container.querySelector('[data-not-trade-view]')).not.toBeNull();
    expect(container.querySelector('[data-trade-badge]')).toBeNull();

    // STRICT: No settings rows, no checkboxes, no version switcher tabs
    expect(container.querySelectorAll('[data-popup-module-row]').length).toBe(0);
    expect(container.querySelectorAll('[data-slot="checkbox"]').length).toBe(0);
    expect(container.querySelector('[data-version-tabs]')).toBeNull();

    // Quick trade links exist
    const openPoe1Btn = container.querySelector('[data-open-trade="poe1"]') as HTMLButtonElement;
    const openPoe2Btn = container.querySelector('[data-open-trade="poe2"]') as HTMLButtonElement;
    expect(openPoe1Btn).not.toBeNull();
    expect(openPoe2Btn).not.toBeNull();

    openPoe1Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://www.pathofexile.com/trade',
    });

    openPoe2Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://www.pathofexile.com/trade2',
    });
  });

  it('reactively updates Popup UI text, html[lang], and document.title when displayLocale changes across zh-TW, zh-CN, en, and fallback locales', async () => {
    app = createApp(PopupApp, { initialIsTradePage: true, initialVersion: 'poe2' });
    app.mount(container);
    await new Promise((r) => setTimeout(r, 25));

    // Default zh-TW
    expect(document.documentElement.lang).toBe('zh-TW');
    expect(document.title).toBe('PoeXD 模組控制');
    expect(container.textContent).toContain('PoE 2 交易官網');
    expect(container.textContent).toContain('模組啟用控制');
    expect(container.textContent).toContain('符文覆寫試算');

    // Switch to zh-CN
    await currentModule?.update({ displayLocale: 'zh-CN' });
    await new Promise((r) => setTimeout(r, 25));
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('PoeXD 模块控制');
    expect(container.textContent).toContain('PoE 2 交易官网');
    expect(container.textContent).toContain('模块启用控制');
    expect(container.textContent).toContain('符文覆写试算');

    // Switch to en
    await currentModule?.update({ displayLocale: 'en' });
    await new Promise((r) => setTimeout(r, 25));
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('PoeXD Module Controls');
    expect(container.textContent).toContain('PoE 2 Official Trade');
    expect(container.textContent).toContain('Module Controls');
    expect(container.textContent).toContain('Rune Override Calculator');

    // Switch to ja (fallback to en UI)
    await currentModule?.update({ displayLocale: 'ja' });
    await new Promise((r) => setTimeout(r, 25));
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('PoeXD Module Controls');
    expect(container.textContent).toContain('Rune Override Calculator');
  });
});
