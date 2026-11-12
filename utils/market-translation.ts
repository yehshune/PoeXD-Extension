/**
 * 市集漢化（Market Translation，ADR-0012）的共用判定：何時翻譯、翻成哪個語系、分片放在哪裡。
 * 純函式、不持有狀態，isolated world 與測試共用；MAIN world 腳本不 import 這支（避免打包 i18n 相依）。
 */
import type { DisplayLocalePreference } from './preferences-contract';
import { resolveDisplayLocale } from './locale-resolution';

export const MARKET_TRANSLATION_LOCALES = ['zh-TW', 'zh-CN'] as const;
export type MarketTranslationLocale = (typeof MARKET_TRANSLATION_LOCALES)[number];

/** 國際服英文市集的主機；在地化子網域（jp.、ru.…）頁面本身已是當地語言，不處理 */
const MARKET_TRANSLATION_HOSTS = new Set(['www.pathofexile.com', 'pathofexile.com']);

export function isMarketTranslationHost(hostname: string): boolean {
  return MARKET_TRANSLATION_HOSTS.has(hostname.trim().toLowerCase());
}

const isMarketTranslationLocale = (value: string): value is MarketTranslationLocale =>
  (MARKET_TRANSLATION_LOCALES as readonly string[]).includes(value);

export interface MarketTranslationLocaleInput {
  enabled: boolean;
  displayLocale: DisplayLocalePreference;
  hostname: string;
  browserLocale?: string;
}

/** 回傳本頁要翻成的語系；不需翻譯時回傳 null。 */
export function resolveMarketTranslationLocale(
  input: MarketTranslationLocaleInput,
): MarketTranslationLocale | null {
  if (!input.enabled || !isMarketTranslationHost(input.hostname)) return null;
  const resolved = resolveDisplayLocale(input.displayLocale, {
    hostname: input.hostname,
    browserLocale: input.browserLocale,
  });
  return isMarketTranslationLocale(resolved) ? resolved : null;
}

export function getMarketUiAssetPath(locale: MarketTranslationLocale): string {
  return `json/locales/${locale}/trade-ui.json`;
}
