import {
  SUPPORTED_LOCALES,
  type DisplayLocalePreference,
  type SupportedLocale,
  type SupportedUiLocale,
} from './preferences-contract';

/**
 * 語系解析：由官方市集主機、頁面 <html lang> 與瀏覽器語系推導 Page Locale、
 * Display Locale 與 UI Locale。純函式、不持有狀態，供 i18n 與遊戲資料模組共用。
 */

const TENCENT_TRADE_HOST = 'poe.game.qq.com';

export interface LocaleResolutionInput {
  hostname?: string;
  htmlLang?: string;
  browserLocale?: string;
}

const SUBDOMAIN_TO_LOCALE: Readonly<Record<string, SupportedLocale>> = Object.freeze({
  www: 'en',
  ru: 'ru',
  kr: 'ko',
  jp: 'ja',
  de: 'de',
  fr: 'fr',
  es: 'es',
  br: 'pt',
  pt: 'pt',
  th: 'th',
});

function normalizeLocaleTag(tag?: string | null): SupportedLocale | null {
  if (!tag) return null;
  const trimmed = tag.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase().replace(/_/g, '-');

  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower.startsWith('zh-hant')) {
    return 'zh-TW';
  }
  if (lower === 'zh-cn' || lower === 'zh-sg' || lower.startsWith('zh-hans') || lower === 'zh') {
    return 'zh-CN';
  }
  const primary = lower.split('-')[0];
  switch (primary) {
    case 'en':
      return 'en';
    case 'ja':
    case 'jp':
      return 'ja';
    case 'ko':
    case 'kr':
      return 'ko';
    case 'ru':
      return 'ru';
    case 'de':
      return 'de';
    case 'fr':
      return 'fr';
    case 'es':
      return 'es';
    case 'pt':
    case 'br':
      return 'pt';
    case 'th':
      return 'th';
    default:
      return null;
  }
}

export function detectBrowserLocale(): string {
  try {
    const uiLang = (globalThis as any).chrome?.i18n?.getUILanguage?.();
    if (typeof uiLang === 'string' && uiLang.trim()) {
      return uiLang.trim();
    }
  } catch {
    // ignore
  }
  if (typeof navigator !== 'undefined') {
    if (typeof navigator.language === 'string' && navigator.language.trim()) {
      return navigator.language.trim();
    }
  }
  return 'en';
}

export function resolvePageLocale(input: LocaleResolutionInput = {}): SupportedLocale {
  const rawHost =
    input.hostname ??
    (typeof window !== 'undefined' && window.location ? window.location.hostname : '');
  const host = rawHost.trim().toLowerCase();

  if (host) {
    if (host === 'pathofexile.tw' || host.endsWith('.pathofexile.tw')) {
      return 'zh-TW';
    }
    if (host === TENCENT_TRADE_HOST) {
      return 'zh-CN';
    }
    if (host === 'pathofexile.com' || host.endsWith('.pathofexile.com')) {
      const parts = host.split('.');
      const sub = parts.length > 2 ? parts[0] : 'www';
      if (sub in SUBDOMAIN_TO_LOCALE && sub !== 'www') {
        return SUBDOMAIN_TO_LOCALE[sub];
      }
      const fromHtml = normalizeLocaleTag(input.htmlLang);
      if (fromHtml) return fromHtml;
      return 'en';
    }
  }

  const fromHtml = normalizeLocaleTag(
    input.htmlLang ??
      (typeof document !== 'undefined' ? document.documentElement?.lang : undefined),
  );
  if (fromHtml) return fromHtml;

  const fromBrowser = normalizeLocaleTag(input.browserLocale);
  if (fromBrowser) return fromBrowser;

  return 'en';
}

function isOfficialTradeHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase();
  if (!host) return false;
  return (
    host === 'pathofexile.tw' ||
    host.endsWith('.pathofexile.tw') ||
    host === TENCENT_TRADE_HOST ||
    host === 'pathofexile.com' ||
    host.endsWith('.pathofexile.com')
  );
}

export function resolveDisplayLocale(
  preference: DisplayLocalePreference = 'auto',
  input: LocaleResolutionInput = {},
): SupportedLocale {
  if (preference !== 'auto' && (SUPPORTED_LOCALES as readonly string[]).includes(preference)) {
    return preference;
  }

  const rawHost =
    input.hostname ??
    (typeof window !== 'undefined' && window.location ? window.location.hostname : '');

  if (isOfficialTradeHost(rawHost) || input.htmlLang !== undefined) {
    const pageLocale = resolvePageLocale(input);
    if (pageLocale !== 'en') {
      return pageLocale;
    }

    const browserTag = normalizeLocaleTag(input.browserLocale ?? detectBrowserLocale());
    if (browserTag === 'zh-TW' || browserTag === 'zh-CN') {
      return browserTag;
    }

    return pageLocale;
  }

  const browserTag = normalizeLocaleTag(input.browserLocale ?? detectBrowserLocale());
  return browserTag ?? 'en';
}

export function resolveUiLocale(
  displayLocale: SupportedLocale | DisplayLocalePreference = 'en',
  input?: LocaleResolutionInput,
): SupportedUiLocale {
  const resolved = displayLocale === 'auto' ? resolveDisplayLocale('auto', input) : displayLocale;
  if (resolved === 'zh-TW') return 'zh-TW';
  if (resolved === 'zh-CN') return 'zh-CN';
  return 'en';
}
