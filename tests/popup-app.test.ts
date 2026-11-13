// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from 'vue';
import PopupApp from '@/entrypoints/popup/App.vue';
import { createInMemoryPreferencesStorage, type PreferencesModule } from '@/utils/preferences';
import { resetI18nStateForTests } from '@/utils/i18n';
import {
  buildTradeRootUrl,
  formatTradeHostLabel,
  resolveQuickTradeRealms,
} from '@/utils/trade-realms';

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

  const originalNavigatorLanguage = navigator.language;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    storage = createInMemoryPreferencesStorage();
    container = document.createElement('div');
    document.body.appendChild(container);
    requestedVersion = undefined;
    Object.defineProperty(navigator, 'language', {
      value: 'zh-TW',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetI18nStateForTests('zh-TW');
    Object.defineProperty(navigator, 'language', {
      value: originalNavigatorLanguage,
      configurable: true,
      writable: true,
    });
    (globalThis as any).chrome = undefined;
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

    // All 8 PoE1 modules exist
    const rows = container.querySelectorAll('[data-popup-module-row]');
    expect(rows.length).toBe(8);

    // Checkbox elements exist for all 8 items
    const checkboxes = container.querySelectorAll('[data-slot="checkbox"]');
    expect(checkboxes.length).toBe(8);

    const text = container.textContent || '';
    expect(text).not.toContain('側邊欄主體');
    expect(text).toContain('T 階快捷按鈕');
    expect(text).toContain('詞綴選擇器');
    expect(text).toContain('價格換算');
    expect(text).toContain('結果詞綴高亮');
    expect(text).toContain('結果詞綴快篩');
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
    expect(container.querySelectorAll('[data-popup-module-row]').length).toBe(9);
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

    // Quick trade links exist (default zh-TW browser -> International + Taiwan)
    const realmGroups = Array.from(container.querySelectorAll('[data-trade-realm-group]')).map(
      (el) => el.getAttribute('data-trade-realm-group'),
    );
    expect(realmGroups).toEqual(['international', 'garena-tw']);

    const openPoe1Btn = container.querySelector('[data-open-trade="poe1"]') as HTMLButtonElement;
    const openPoe2Btn = container.querySelector('[data-open-trade="poe2"]') as HTMLButtonElement;
    const openTwPoe1Btn = container.querySelector(
      '[data-open-realm="garena-tw"][data-open-trade="poe1"]',
    ) as HTMLButtonElement;
    const openTwPoe2Btn = container.querySelector(
      '[data-open-realm="garena-tw"][data-open-trade="poe2"]',
    ) as HTMLButtonElement;
    expect(openPoe1Btn).not.toBeNull();
    expect(openPoe2Btn).not.toBeNull();
    expect(openTwPoe1Btn).not.toBeNull();
    expect(openTwPoe2Btn).not.toBeNull();

    openPoe1Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://www.pathofexile.com/trade',
    });

    openPoe2Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://www.pathofexile.com/trade2',
    });

    openTwPoe1Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://pathofexile.tw/trade',
    });

    openTwPoe2Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://pathofexile.tw/trade2',
    });
  });

  it('shows international + tencent quick links when browser or displayLocale is zh-CN, and international only for non-Chinese', async () => {
    const createTabMock = vi.fn();
    (globalThis as any).chrome = {
      i18n: {
        getUILanguage: () => 'zh-CN',
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ url: 'https://example.com' }]),
        create: createTabMock,
      },
    };

    app = createApp(PopupApp);
    app.mount(container);
    await new Promise((r) => setTimeout(r, 25));

    expect(
      Array.from(container.querySelectorAll('[data-trade-realm-group]')).map((el) =>
        el.getAttribute('data-trade-realm-group'),
      ),
    ).toEqual(['international', 'tencent']);
    expect(container.textContent).toContain('国际服');
    expect(container.textContent).toContain('国服（腾讯）');

    const openQqPoe1Btn = container.querySelector(
      '[data-open-realm="tencent"][data-open-trade="poe1"]',
    ) as HTMLButtonElement;
    const openQqPoe2Btn = container.querySelector(
      '[data-open-realm="tencent"][data-open-trade="poe2"]',
    ) as HTMLButtonElement;
    openQqPoe1Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://poe.game.qq.com/trade',
    });
    openQqPoe2Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://poe.game.qq.com/trade2',
    });

    // Explicitly switching displayLocale to zh-TW overrides zh-CN browser
    await currentModule?.update({ displayLocale: 'zh-TW' });
    await new Promise((r) => setTimeout(r, 25));
    expect(
      Array.from(container.querySelectorAll('[data-trade-realm-group]')).map((el) =>
        el.getAttribute('data-trade-realm-group'),
      ),
    ).toEqual(['international', 'garena-tw']);
    expect(container.textContent).toContain('國際服');
    expect(container.textContent).toContain('台服');

    // Non-Chinese browser + auto displayLocale shows International only
    (globalThis as any).chrome.i18n.getUILanguage = () => 'en-US';
    await currentModule?.update({ displayLocale: 'auto' });
    await new Promise((r) => setTimeout(r, 25));
    expect(
      Array.from(container.querySelectorAll('[data-trade-realm-group]')).map((el) =>
        el.getAttribute('data-trade-realm-group'),
      ),
    ).toEqual(['international']);

    // Explicit non-Chinese displayLocale (ja) on zh-TW browser shows localized International subdomain only
    (globalThis as any).chrome.i18n.getUILanguage = () => 'zh-TW';
    await currentModule?.update({ displayLocale: 'ja' });
    await new Promise((r) => setTimeout(r, 25));
    expect(
      Array.from(container.querySelectorAll('[data-trade-realm-group]')).map((el) =>
        el.getAttribute('data-trade-realm-group'),
      ),
    ).toEqual(['international']);
    expect(container.textContent).toContain('jp.pathofexile.com');
    const openJpPoe2Btn = container.querySelector(
      '[data-open-realm="international"][data-open-trade="poe2"]',
    ) as HTMLButtonElement;
    openJpPoe2Btn.click();
    expect(createTabMock).toHaveBeenCalledWith({
      url: 'https://jp.pathofexile.com/trade2',
    });
  });

  it('resolves quick trade realms, subdomains, host labels, and root URLs across auto and explicit displayLocales', () => {
    // auto follows browser locale
    expect(
      resolveQuickTradeRealms({ displayLocale: 'auto', browserLocale: 'zh-TW' }).map((r) => [
        r.id,
        r.origin,
      ]),
    ).toEqual([
      ['international', 'https://www.pathofexile.com'],
      ['garena-tw', 'https://pathofexile.tw'],
    ]);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'auto', browserLocale: 'zh-HK' }).map((r) => r.id),
    ).toEqual(['international', 'garena-tw']);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'auto', browserLocale: 'zh-CN' }).map((r) => [
        r.id,
        r.origin,
      ]),
    ).toEqual([
      ['international', 'https://www.pathofexile.com'],
      ['tencent', 'https://poe.game.qq.com'],
    ]);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'auto', browserLocale: 'zh-SG' }).map((r) => r.id),
    ).toEqual(['international', 'tencent']);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'auto', browserLocale: 'en-US' }).map((r) => [
        r.id,
        r.origin,
      ]),
    ).toEqual([['international', 'https://www.pathofexile.com']]);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'auto', browserLocale: 'ja-JP' }).map((r) => [
        r.id,
        r.origin,
      ]),
    ).toEqual([['international', 'https://jp.pathofexile.com']]);

    // Explicit Chinese displayLocale overrides browserLocale
    expect(
      resolveQuickTradeRealms({ displayLocale: 'zh-CN', browserLocale: 'zh-TW' }).map((r) => r.id),
    ).toEqual(['international', 'tencent']);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'zh-TW', browserLocale: 'en-US' }).map((r) => r.id),
    ).toEqual(['international', 'garena-tw']);

    // Explicit non-Chinese displayLocale uses that language's international subdomain only
    expect(
      resolveQuickTradeRealms({ displayLocale: 'en', browserLocale: 'zh-TW' }).map((r) => [
        r.id,
        r.origin,
      ]),
    ).toEqual([['international', 'https://www.pathofexile.com']]);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'en', browserLocale: 'zh-CN' }).map((r) => [
        r.id,
        r.origin,
      ]),
    ).toEqual([['international', 'https://www.pathofexile.com']]);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'ja', browserLocale: 'zh-TW' }).map((r) => r.origin),
    ).toEqual(['https://jp.pathofexile.com']);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'ko', browserLocale: 'zh-TW' }).map((r) => r.origin),
    ).toEqual(['https://kr.pathofexile.com']);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'pt', browserLocale: 'zh-TW' }).map((r) => r.origin),
    ).toEqual(['https://br.pathofexile.com']);
    expect(
      resolveQuickTradeRealms({ displayLocale: 'ru', browserLocale: 'zh-TW' }).map((r) => r.origin),
    ).toEqual(['https://ru.pathofexile.com']);

    expect(formatTradeHostLabel('https://www.pathofexile.com')).toBe('pathofexile.com');
    expect(formatTradeHostLabel('https://jp.pathofexile.com')).toBe('jp.pathofexile.com');
    expect(formatTradeHostLabel('https://pathofexile.tw')).toBe('pathofexile.tw');
    expect(formatTradeHostLabel('https://poe.game.qq.com')).toBe('poe.game.qq.com');

    expect(buildTradeRootUrl('https://www.pathofexile.com', 'poe1')).toBe(
      'https://www.pathofexile.com/trade',
    );
    expect(buildTradeRootUrl('https://www.pathofexile.com', 'poe2')).toBe(
      'https://www.pathofexile.com/trade2',
    );
    expect(buildTradeRootUrl('https://jp.pathofexile.com', 'poe2')).toBe(
      'https://jp.pathofexile.com/trade2',
    );
    expect(buildTradeRootUrl('https://pathofexile.tw', 'poe1')).toBe(
      'https://pathofexile.tw/trade',
    );
    expect(buildTradeRootUrl('https://poe.game.qq.com', 'poe2')).toBe(
      'https://poe.game.qq.com/trade2',
    );
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
