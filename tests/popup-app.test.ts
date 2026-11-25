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

vi.mock('@/utils/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/preferences')>();
  return {
    ...actual,
    getPreferences: vi.fn(async (version: string) => {
      const outcome = await actual.createPreferencesModule(version as any, storage);
      if (outcome.ok) currentModule = outcome.value;
      return outcome;
    }),
  };
});

describe('Popup App Component (Quick Trade Links, Theme Token & Locale Reactivity)', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp>;

  const originalNavigatorLanguage = navigator.language;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    storage = createInMemoryPreferencesStorage();
    container = document.createElement('div');
    document.body.appendChild(container);
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

  it('applies data-poexd-theme attribute matching preferences theme to root and documentElement', async () => {
    app = createApp(PopupApp);
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeDefined();
    expect(root.getAttribute('data-poexd-theme')).toBe('modern-dark');
    expect(document.documentElement.getAttribute('data-poexd-theme')).toBe('modern-dark');
  });

  it('renders brand emblem and quick trade website links with NO module toggle popover menu', async () => {
    const createTabMock = vi.fn();
    (globalThis as any).chrome = {
      tabs: {
        create: createTabMock,
      },
    };

    app = createApp(PopupApp);
    app.mount(container);
    await new Promise((r) => setTimeout(r, 20));

    // Brand emblem ToolboxIcon exists
    const emblem = container.querySelector('svg[aria-label="PoeXD Brand Gear Emblem"]');
    expect(emblem).toBeDefined();
    expect(container.textContent).toContain('PoeXD');

    // Quick trade view exists, and NO trade-page module toggle menu or checkboxes
    expect(container.querySelector('[data-not-trade-view]')).not.toBeNull();
    expect(container.querySelector('[data-trade-badge]')).toBeNull();
    expect(container.querySelectorAll('[data-popup-module-row]').length).toBe(0);
    expect(container.querySelectorAll('[data-slot="checkbox"]').length).toBe(0);

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
    expect(container.textContent).toContain('腾讯服');

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
    app = createApp(PopupApp);
    app.mount(container);
    await new Promise((r) => setTimeout(r, 25));

    // Default zh-TW
    expect(document.documentElement.lang).toBe('zh-TW');
    expect(document.title).toBe('PoeXD 交易市集小幫手');
    expect(container.textContent).toContain('Path of Exile 交易市集小幫手');

    // Switch to zh-CN
    await currentModule?.update({ displayLocale: 'zh-CN' });
    await new Promise((r) => setTimeout(r, 25));
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('PoeXD 交易市集助手');
    expect(container.textContent).toContain('Path of Exile 交易市集助手');

    // Switch to en
    await currentModule?.update({ displayLocale: 'en' });
    await new Promise((r) => setTimeout(r, 25));
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('PoeXD Trade Assistant');
    expect(container.textContent).toContain('Path of Exile Trade Assistant');

    // Switch to ja (fallback to en UI)
    await currentModule?.update({ displayLocale: 'ja' });
    await new Promise((r) => setTimeout(r, 25));
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('PoeXD Trade Assistant');
  });
});
