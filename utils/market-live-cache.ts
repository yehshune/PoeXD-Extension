/**
 * 市集漢化即時快取的儲存格式：快取鍵、結構驗證、新鮮度判斷，以及與內建分片的合併。
 * 頁面端只讀這裡；背景抓取與寫入在 market-translation-live。
 */
import type { MarketTranslationLocale } from './market-translation';
import type { MarketTradeDictionary } from './market-translation-data';
import type { PoeVersion } from './trade-context';

export const MARKET_LIVE_SCHEMA_VERSION = 1;
export const MARKET_LIVE_TTL_MS = 6 * 60 * 60 * 1000;

export type MarketLiveDataSourceKey =
  | 'stats'
  | 'static'
  | 'filters'
  | 'items'
  | 'enStats'
  | 'enFilters'
  | 'enItems';
export type MarketLiveSourceKey = 'ui' | MarketLiveDataSourceKey;

export interface MarketLiveUiCache {
  schemaVersion: number;
  locale: MarketTranslationLocale;
  updatedAt: number;
  strings: Record<string, string>;
}

export interface MarketLiveDiscItemsRaw {
  byDisc: Record<string, Array<{ type: string; text: string }>>;
  discSuffixes: Record<string, string>;
}

export interface MarketLiveEnglishItems {
  byDisc: Record<string, Record<string, string>>;
  legacySuffix?: string;
}

export interface MarketLiveDataCache {
  schemaVersion: number;
  version: PoeVersion;
  locale: MarketTranslationLocale;
  updatedAt: number;
  endpointUpdatedAt?: Partial<Record<MarketLiveDataSourceKey, number>>;
  stats?: NonNullable<MarketTradeDictionary['stats']>;
  static?: NonNullable<MarketTradeDictionary['static']>;
  filters?: NonNullable<MarketTradeDictionary['filters']>;
  tradeItems?: NonNullable<MarketTradeDictionary['tradeItems']>;
  enStats?: Record<string, string | string[]>;
  enFields?: Record<string, string>;
  enItems?: MarketLiveEnglishItems;
}

/** 英文資料的獨立快取（見 getMarketLiveEnglishCacheKey）；時間戳記在 data 快取的 endpointUpdatedAt */
export interface MarketLiveEnglishCache {
  schemaVersion: number;
  version: PoeVersion;
  locale: MarketTranslationLocale;
  enStats?: Record<string, string | string[]>;
  enFields?: Record<string, string>;
  enItems?: MarketLiveEnglishItems;
}
export const getMarketLiveUiCacheKey = (locale: MarketTranslationLocale) =>
  `poexd_market_live_ui_${locale}`;

export const getMarketLiveDataCacheKey = (version: PoeVersion, locale: MarketTranslationLocale) =>
  `poexd_market_live_data_${version}_${locale}`;

/**
 * 國際服英文資料（enStats / enFields / enItems）另存一筆：約占即時快取的六成，
 * 只有背景對齊與結果列翻譯用得到，頁面啟動時不必連同 data 字典一起讀出來。
 */
export const getMarketLiveEnglishCacheKey = (
  version: PoeVersion,
  locale: MarketTranslationLocale,
) => `poexd_market_live_en_${version}_${locale}`;

export const getMarketLiveErrorCacheKey = (version: PoeVersion, locale: MarketTranslationLocale) =>
  `poexd_market_live_error_${version}_${locale}`;

const MARKET_LIVE_VERSIONS: readonly PoeVersion[] = ['poe1', 'poe2'];
const MARKET_LIVE_LOCALES: readonly MarketTranslationLocale[] = ['zh-TW', 'zh-CN'];

export const MARKET_LIVE_ALL_CACHE_KEYS: readonly string[] = Object.freeze([
  ...MARKET_LIVE_LOCALES.map((locale) => getMarketLiveUiCacheKey(locale)),
  ...MARKET_LIVE_VERSIONS.flatMap((version) =>
    MARKET_LIVE_LOCALES.flatMap((locale) => [
      getMarketLiveDataCacheKey(version, locale),
      getMarketLiveEnglishCacheKey(version, locale),
      getMarketLiveErrorCacheKey(version, locale),
    ]),
  ),
]);

/** 清除所有市集漢化即時快取（例如擴充升級時，避免舊版快取覆蓋新版內建分片） */
export async function clearMarketTranslationLiveCache(
  area: { remove(keys: string | string[]): Promise<void> } = chrome.storage.local,
): Promise<void> {
  await area.remove([...MARKET_LIVE_ALL_CACHE_KEYS]);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const isStatsValueMap = (value: unknown): value is Record<string, string | string[]> =>
  isRecord(value) &&
  Object.values(value).every(
    (entry) =>
      typeof entry === 'string' ||
      (Array.isArray(entry) && entry.every((item) => typeof item === 'string')),
  );

const isNestedStringMap = (value: unknown): value is Record<string, Record<string, string>> =>
  isRecord(value) && Object.values(value).every(isStringMap);

/** 驗證並讀出儲存於 chrome.storage.local 的 UI 快取 */
export function readValidMarketLiveUiCache(
  value: unknown,
  locale: MarketTranslationLocale,
): MarketLiveUiCache | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MARKET_LIVE_SCHEMA_VERSION ||
    value.locale !== locale ||
    typeof value.updatedAt !== 'number' ||
    !isStringMap(value.strings)
  ) {
    return null;
  }
  return value as unknown as MarketLiveUiCache;
}

export const DATA_SOURCE_KEYS: readonly MarketLiveDataSourceKey[] = [
  'stats',
  'static',
  'filters',
  'items',
  'enStats',
  'enFilters',
  'enItems',
];

/** 驗證並讀出儲存於 chrome.storage.local 的 data API 快取 */
export function readValidMarketLiveDataCache(
  value: unknown,
  version: PoeVersion,
  locale: MarketTranslationLocale,
): MarketLiveDataCache | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MARKET_LIVE_SCHEMA_VERSION ||
    value.version !== version ||
    value.locale !== locale ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }
  const out: MarketLiveDataCache = {
    schemaVersion: MARKET_LIVE_SCHEMA_VERSION,
    version,
    locale,
    updatedAt: value.updatedAt,
  };
  if (isRecord(value.endpointUpdatedAt)) {
    const endpointUpdatedAt: Partial<Record<MarketLiveDataSourceKey, number>> = {};
    for (const key of DATA_SOURCE_KEYS) {
      const ts = value.endpointUpdatedAt[key];
      if (typeof ts === 'number' && Number.isFinite(ts)) endpointUpdatedAt[key] = ts;
    }
    if (Object.keys(endpointUpdatedAt).length > 0) out.endpointUpdatedAt = endpointUpdatedAt;
  }
  if (
    isRecord(value.stats) &&
    isStringMap(value.stats.labels) &&
    isStatsValueMap(value.stats.stats) &&
    isNestedStringMap(value.stats.options)
  ) {
    out.stats = value.stats as NonNullable<MarketTradeDictionary['stats']>;
  }
  if (
    isRecord(value.static) &&
    isStringMap(value.static.labels) &&
    isNestedStringMap(value.static.entries)
  ) {
    out.static = value.static as NonNullable<MarketTradeDictionary['static']>;
  }
  if (
    isRecord(value.filters) &&
    isStringMap(value.filters.groups) &&
    isStringMap(value.filters.fields) &&
    isNestedStringMap(value.filters.options)
  ) {
    out.filters = value.filters as NonNullable<MarketTradeDictionary['filters']>;
  }
  if (
    isRecord(value.tradeItems) &&
    isNestedStringMap(value.tradeItems.discEntries) &&
    isStringMap(value.tradeItems.discSuffixes)
  ) {
    out.tradeItems = value.tradeItems as NonNullable<MarketTradeDictionary['tradeItems']>;
  }
  // 舊版把英文資料存在同一筆；背景下次刷新時會拆到英文快取
  Object.assign(out, readEnglishFields(value));
  return out;
}

function readEnglishFields(value: Record<string, unknown>): Partial<MarketLiveEnglishCache> {
  const out: Partial<MarketLiveEnglishCache> = {};
  if (isStatsValueMap(value.enStats)) out.enStats = value.enStats;
  if (isStringMap(value.enFields)) out.enFields = value.enFields;
  if (
    isRecord(value.enItems) &&
    isNestedStringMap(value.enItems.byDisc) &&
    (value.enItems.legacySuffix === undefined || typeof value.enItems.legacySuffix === 'string')
  ) {
    out.enItems = value.enItems as unknown as MarketLiveEnglishItems;
  }
  return out;
}

export function readValidMarketLiveEnglishCache(
  value: unknown,
  version: PoeVersion,
  locale: MarketTranslationLocale,
): MarketLiveEnglishCache | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MARKET_LIVE_SCHEMA_VERSION ||
    value.version !== version ||
    value.locale !== locale
  ) {
    return null;
  }
  return {
    schemaVersion: MARKET_LIVE_SCHEMA_VERSION,
    version,
    locale,
    ...readEnglishFields(value),
  };
}

/** data 快取是否仍是英文資料合併存放的舊格式 */
export function isLegacyMarketLiveDataCache(data: MarketLiveDataCache | null): boolean {
  return Boolean(data && (data.enStats || data.enFields || data.enItems));
}

/**
 * 結果列翻譯用的國際服英文資料：英文快取優先，沒有時退回舊格式 data 快取裡的欄位。
 * 兩者都沒有時回傳 undefined。
 */
export function resolveMarketLiveEnglishData(
  english: MarketLiveEnglishCache | null,
  legacyData: MarketLiveDataCache | null,
): { stats?: Record<string, string | string[]>; fields?: Record<string, string> } | undefined {
  const stats = english?.enStats ?? legacyData?.enStats;
  const fields = english?.enFields ?? legacyData?.enFields;
  return stats || fields ? { stats, fields } : undefined;
}

export function isMarketLiveCacheFresh(
  updatedAt: number | undefined,
  now: number,
  ttlMs = MARKET_LIVE_TTL_MS,
): boolean {
  return typeof updatedAt === 'number' && Number.isFinite(updatedAt) && now - updatedAt < ttlMs;
}

function mergeNestedMaps(
  bundled: Readonly<Record<string, Readonly<Record<string, string>>>>,
  live: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(bundled)) merged[k] = { ...v };
  for (const [k, v] of Object.entries(live)) merged[k] = { ...merged[k], ...v };
  return merged;
}

function mergeSection<T>(
  bundled: T | undefined,
  live: T | undefined,
  combine: (base: T, overlay: T) => T,
): T | undefined {
  if (!live) return bundled;
  return bundled ? combine(bundled, live) : live;
}

export function mergeMarketUiStrings(
  bundled: Readonly<Record<string, string>>,
  live: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return live ? { ...bundled, ...live } : { ...bundled };
}

export function mergeMarketTradeDictionary(
  bundled: Omit<MarketTradeDictionary, 'ui'>,
  live: MarketLiveDataCache | null,
): Omit<MarketTradeDictionary, 'ui'> {
  if (!live) return bundled;
  return {
    stats: mergeSection(bundled.stats, live.stats, (base, overlay) => ({
      labels: { ...base.labels, ...overlay.labels },
      stats: { ...base.stats, ...overlay.stats },
      options: mergeNestedMaps(base.options, overlay.options),
    })),
    static: mergeSection(bundled.static, live.static, (base, overlay) => ({
      labels: { ...base.labels, ...overlay.labels },
      entries: mergeNestedMaps(base.entries, overlay.entries),
    })),
    filters: mergeSection(bundled.filters, live.filters, (base, overlay) => ({
      groups: { ...base.groups, ...overlay.groups },
      fields: { ...base.fields, ...overlay.fields },
      options: mergeNestedMaps(base.options, overlay.options),
    })),
    items: bundled.items,
    tradeItems: mergeSection(bundled.tradeItems, live.tradeItems, (base, overlay) => ({
      discEntries: mergeNestedMaps(base.discEntries, overlay.discEntries),
      discSuffixes: { ...base.discSuffixes, ...overlay.discSuffixes },
    })),
  };
}
