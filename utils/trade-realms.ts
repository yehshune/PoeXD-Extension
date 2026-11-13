/**
 * 官方市集網域（Trade Realm）註冊表：所有「是否為支援的官方市集網域」判斷的單一來源。
 *
 * - 國際服：`www.pathofexile.com` 與各語系子網域（`ru.`、`br.`、`th.`、`de.`、`fr.`、`es.`、`jp.`、`kr.` 等）
 * - 台服：`pathofexile.tw`
 * - 國服（騰訊）：`poe.game.qq.com`
 */

import type { I18nKey } from './i18n/messages/zh-TW';
import { detectBrowserLocale, resolveDisplayLocale } from './locale-resolution';
import type { DisplayLocalePreference, SupportedLocale } from './preferences-contract';
import type { PoeVersion } from './trade-context';

export type TradeRealmId = 'international' | 'garena-tw' | 'tencent';

export interface TradeRealm {
  readonly id: TradeRealmId;
  /** 介面顯示用的簡短名稱 */
  /** 顯示名稱的翻譯 key；由 UI 端以 t() 翻譯，避免 Background 打包 UI 字典 */
  readonly labelKey: I18nKey;
  /** 是否提供價格換算：資料來源 poe.ninja 只有國際服的匯率 */
  readonly priceConversion: boolean;
  /** 完全相符的主機名稱 */
  readonly hosts: readonly string[];
  /** 允許任意子網域的根網域（同時涵蓋根網域本身） */
  readonly wildcardDomains: readonly string[];
  readonly defaultOrigin: string;
}

export const TRADE_REALMS: readonly TradeRealm[] = [
  {
    id: 'international',
    labelKey: 'realm.international',
    priceConversion: true,
    hosts: [],
    wildcardDomains: ['pathofexile.com'],
    defaultOrigin: 'https://www.pathofexile.com',
  },
  {
    id: 'garena-tw',
    labelKey: 'realm.garena-tw',
    priceConversion: false,
    hosts: [],
    wildcardDomains: ['pathofexile.tw'],
    defaultOrigin: 'https://pathofexile.tw',
  },
  {
    id: 'tencent',
    labelKey: 'realm.tencent',
    priceConversion: false,
    hosts: ['poe.game.qq.com'],
    wildcardDomains: [],
    defaultOrigin: 'https://poe.game.qq.com',
  },
];

export const DEFAULT_TRADE_ORIGIN = 'https://www.pathofexile.com';

/**
 * WXT content script / tabs.query 使用的 match pattern（頁面路徑 `/trade*` 同時涵蓋 `/trade2*`）。
 * 需與 `wxt.config.ts` 的 host_permissions 保持一致。
 */
export const TRADE_PAGE_MATCH_PATTERNS: readonly string[] = [
  '*://*.pathofexile.com/trade*',
  '*://*.pathofexile.tw/trade*',
  '*://poe.game.qq.com/trade*',
];

export function findTradeRealm(hostname: string): TradeRealm | undefined {
  const host = hostname.trim().toLowerCase();
  if (!host) return undefined;
  return TRADE_REALMS.find(
    (realm) =>
      realm.hosts.includes(host) ||
      realm.wildcardDomains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  );
}

export function isSupportedTradeHost(hostname: string): boolean {
  return findTradeRealm(hostname) !== undefined;
}

/** 回傳官方市集網址的 origin；非支援網域或非 http(s) 時回傳 undefined。 */
export function getSupportedTradeOrigin(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return isSupportedTradeHost(url.hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** 依市集網址取得所屬網域顯示名稱（國際服／台服／QQ）的翻譯 key；非支援網域回傳 `undefined`。 */
export function getTradeRealmLabelKey(url: string): I18nKey | undefined {
  try {
    return findTradeRealm(new URL(url).hostname)?.labelKey;
  } catch {
    return undefined;
  }
}

/**
 * 目前網域是否支援價格換算與換算資料更新（poe.ninja 只有國際服資料）。
 * 台服、QQ 等其他網域一律略過。
 */
export function isPriceConversionSupported(
  hostname: string | undefined = typeof window !== 'undefined'
    ? window.location.hostname
    : undefined,
): boolean {
  return hostname ? findTradeRealm(hostname)?.priceConversion === true : false;
}

const REALM_BY_ID: Readonly<Record<TradeRealmId, TradeRealm>> = Object.freeze(
  Object.fromEntries(TRADE_REALMS.map((realm) => [realm.id, realm])) as Record<
    TradeRealmId,
    TradeRealm
  >,
);

const POPUP_REALM_LABEL_KEYS: Readonly<Record<TradeRealmId, I18nKey>> = Object.freeze({
  international: 'popup.notTrade.realm.international',
  'garena-tw': 'popup.notTrade.realm.garena-tw',
  tencent: 'popup.notTrade.realm.tencent',
});

const INTERNATIONAL_LOCALE_SUBDOMAINS: Readonly<
  Record<Exclude<SupportedLocale, 'zh-TW' | 'zh-CN'>, string>
> = Object.freeze({
  en: 'www',
  ja: 'jp',
  ko: 'kr',
  ru: 'ru',
  de: 'de',
  fr: 'fr',
  es: 'es',
  pt: 'br',
  th: 'th',
});

export interface QuickTradeRealmEntry {
  readonly id: TradeRealmId;
  readonly origin: string;
  readonly hostLabel: string;
  readonly labelKey: I18nKey;
}

export function getTradeRealm(id: TradeRealmId): TradeRealm {
  return REALM_BY_ID[id];
}

export function formatTradeHostLabel(origin: string): string {
  return new URL(origin).hostname.replace(/^www\./, '');
}

export function buildTradeRootUrl(origin: string, version: PoeVersion): string {
  // 直接對應 /trade 與 /trade2，避免與 trade-context 形成執行期循環相依
  const routeRoot = version === 'poe2' ? 'trade2' : 'trade';
  return `${origin}/${routeRoot}`;
}

function createQuickTradeRealmEntry(
  id: TradeRealmId,
  origin: string = getTradeRealm(id).defaultOrigin,
): QuickTradeRealmEntry {
  return {
    id,
    origin,
    hostLabel: formatTradeHostLabel(origin),
    labelKey: POPUP_REALM_LABEL_KEYS[id],
  };
}

export interface QuickTradeRealmsInput {
  displayLocale?: DisplayLocalePreference;
  browserLocale?: string;
}

/**
 * 依擴充語言設定與瀏覽器語系決定非官網 Popover 顯示的市集連結組合：
 * - `displayLocale` 為 `auto` 時依瀏覽器語系解析；否則直接使用設定的目標語系
 * - 繁中 (`zh-TW`)：國際服英文 (`www.pathofexile.com`) + 台服 (`pathofexile.tw`)
 * - 簡中 (`zh-CN`)：國際服英文 (`www.pathofexile.com`) + 國服（騰訊 `poe.game.qq.com`）
 * - 其他語系：僅顯示該語系對應的國際服子網域（例如 `en` → `www`、`ja` → `jp`、`pt` → `br`）
 */
export function resolveQuickTradeRealms(
  input: QuickTradeRealmsInput = {},
): readonly QuickTradeRealmEntry[] {
  const resolved = resolveDisplayLocale(input.displayLocale ?? 'auto', {
    hostname: '',
    browserLocale: input.browserLocale ?? detectBrowserLocale(),
  });

  if (resolved === 'zh-TW') {
    return [createQuickTradeRealmEntry('international'), createQuickTradeRealmEntry('garena-tw')];
  }
  if (resolved === 'zh-CN') {
    return [createQuickTradeRealmEntry('international'), createQuickTradeRealmEntry('tencent')];
  }

  const subdomain = INTERNATIONAL_LOCALE_SUBDOMAINS[resolved] ?? 'www';
  return [createQuickTradeRealmEntry('international', `https://${subdomain}.pathofexile.com`)];
}
