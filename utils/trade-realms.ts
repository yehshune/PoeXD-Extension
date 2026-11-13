/**
 * 官方市集網域（Trade Realm）註冊表：所有「是否為支援的官方市集網域」判斷的單一來源。
 *
 * - 國際服：`www.pathofexile.com` 與各語系子網域（`ru.`、`br.`、`th.`、`de.`、`fr.`、`es.`、`jp.`、`kr.` 等）
 * - 台服：`pathofexile.tw`
 * - 國服（騰訊）：`poe.game.qq.com`
 */

import type { I18nKey } from './i18n/messages/zh-TW';
import { detectBrowserLocale, normalizeLocaleTag, resolveDisplayLocale } from './locale-resolution';
import type { DisplayLocalePreference } from './preferences-contract';
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

export function getTradeRealm(id: TradeRealmId): TradeRealm {
  return REALM_BY_ID[id];
}

export function buildTradeRootUrl(
  realmOrId: TradeRealm | TradeRealmId,
  version: PoeVersion,
): string {
  const realm = typeof realmOrId === 'string' ? getTradeRealm(realmOrId) : realmOrId;
  const routeRoot = version === 'poe2' ? 'trade2' : 'trade';
  return `${realm.defaultOrigin}/${routeRoot}`;
}

export interface QuickTradeRealmsInput {
  displayLocale?: DisplayLocalePreference;
  browserLocale?: string;
}

/**
 * 依使用者語言設定與瀏覽器語系決定非官網 Popover 顯示的市集網域組合：
 * - 繁中 (`zh-TW`)：國際服 + 台服
 * - 簡中 (`zh-CN`)：國際服 + 國服（騰訊）
 * - 其他語系：僅國際服
 * 當 `displayLocale` 明確設為非中文語系（例如 `en`）時，仍會參考瀏覽器語系補上對應華語服，
 * 同時始終保留國際服連結。
 */
export function resolveQuickTradeRealms(input: QuickTradeRealmsInput = {}): readonly TradeRealm[] {
  const preference = input.displayLocale ?? 'auto';
  const browserLocale = input.browserLocale ?? detectBrowserLocale();
  const resolvedDisplayLocale = resolveDisplayLocale(preference, {
    hostname: '',
    browserLocale,
  });

  if (resolvedDisplayLocale === 'zh-TW') {
    return [REALM_BY_ID.international, REALM_BY_ID['garena-tw']];
  }
  if (resolvedDisplayLocale === 'zh-CN') {
    return [REALM_BY_ID.international, REALM_BY_ID.tencent];
  }

  const normalizedBrowserLocale = normalizeLocaleTag(browserLocale);
  if (normalizedBrowserLocale === 'zh-TW') {
    return [REALM_BY_ID.international, REALM_BY_ID['garena-tw']];
  }
  if (normalizedBrowserLocale === 'zh-CN') {
    return [REALM_BY_ID.international, REALM_BY_ID.tencent];
  }

  return [REALM_BY_ID.international];
}
