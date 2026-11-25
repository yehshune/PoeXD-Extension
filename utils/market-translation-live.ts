/**
 * 市集漢化即時官方資料（背景抓取與快取）：
 * 直接向官方各區 API 與靜態字典抓取最新譯文，不需等擴充發版即可覆蓋新賽季詞綴、篩選器、靜態分類與介面字串；
 * 抓取或驗證失敗時退回擴充內建打包分片，且不影響開頁 1.5 秒閘門。
 */
import { extensionMessaging } from './extension-protocol';
import {
  MARKET_LIVE_SCHEMA_VERSION,
  getMarketLiveUiCacheKey,
  getMarketLiveDataCacheKey,
  getMarketLiveEnglishCacheKey,
  getMarketLiveErrorCacheKey,
  readValidMarketLiveUiCache,
  DATA_SOURCE_KEYS,
  readValidMarketLiveDataCache,
  readValidMarketLiveEnglishCache,
  isLegacyMarketLiveDataCache,
  isMarketLiveCacheFresh,
  type MarketLiveDataSourceKey,
  type MarketLiveSourceKey,
  type MarketLiveUiCache,
  type MarketLiveDataCache,
  type MarketLiveEnglishCache,
} from './market-live-cache';
import {
  parseOfficialTranslateJs,
  parseOfficialTradeStats,
  parseOfficialEnglishTradeStats,
  parseOfficialTradeStatic,
  parseOfficialTradeFilters,
  parseOfficialEnglishTradeFilters,
  parseOfficialTradeItems,
  parseOfficialEnglishTradeItems,
  alignLiveStatsWithEnglish,
  alignLiveTradeItemsWithEnglish,
  isFiltersMostlyEnglish,
} from './market-live-parsers';
import type { MarketTranslationLocale } from './market-translation';
import type { PoeVersion } from './trade-context';

export const MARKET_LIVE_ERROR_COOLDOWN_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export interface MarketTranslationRefreshRequest {
  version: PoeVersion;
  locale: MarketTranslationLocale;
  force?: boolean;
}

export type MarketTranslationRefreshOutcome =
  | { ok: true; updated: boolean; sources: string[] }
  | { ok: false; error: string };

export interface MarketLiveStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type MarketLiveHttpClient = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'json'>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function getRealmEndpoints(version: PoeVersion, locale: MarketTranslationLocale) {
  const apiBase = version === 'poe2' ? '/api/trade2/data' : '/api/trade/data';
  const origin = locale === 'zh-TW' ? 'https://pathofexile.tw' : 'https://poe.game.qq.com';
  const uiUrls =
    locale === 'zh-TW'
      ? ['https://webtw.poecdn.com/js/translate.zh_TW.js']
      : [
          'https://poecdn.game.qq.com/js/translate.zh_CN.js',
          'https://poe.game.qq.com/js/translate.zh_CN.js',
        ];
  return {
    uiUrls,
    statsUrl: `${origin}${apiBase}/stats`,
    staticUrl: `${origin}${apiBase}/static`,
    filtersUrl: `${origin}${apiBase}/filters`,
    itemsUrl: `${origin}${apiBase}/items`,
    enStatsUrl: `https://www.pathofexile.com${apiBase}/stats`,
    enFiltersUrl: `https://www.pathofexile.com${apiBase}/filters`,
    enItemsUrl: `https://www.pathofexile.com${apiBase}/items`,
  };
}

async function fetchWithTimeout(http: MarketLiveHttpClient, url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await http(url, { credentials: 'omit', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirstText(
  http: MarketLiveHttpClient,
  urls: readonly string[],
): Promise<string> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(http, url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchJson(http: MarketLiveHttpClient, url: string): Promise<unknown> {
  const res = await fetchWithTimeout(http, url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createChromeMarketLiveStorage(area?: {
  get(keys?: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}): MarketLiveStorage {
  const resolved = area ?? chrome.storage.local;
  return {
    get: (keys) => resolved.get(keys),
    set: (items) => resolved.set(items),
  };
}

export interface MarketTranslationLiveService {
  refresh(request: MarketTranslationRefreshRequest): Promise<MarketTranslationRefreshOutcome>;
}

/** 把完整的即時資料拆成 data 快取與英文快取兩筆寫入內容 */
function splitMarketLiveDataCache(
  cache: MarketLiveDataCache,
  dataKey: string,
  englishKey: string,
): Record<string, unknown> {
  const { enStats, enFields, enItems, ...data } = cache;
  return {
    [dataKey]: data satisfies MarketLiveDataCache,
    [englishKey]: {
      schemaVersion: cache.schemaVersion,
      version: cache.version,
      locale: cache.locale,
      enStats,
      enFields,
      enItems,
    } satisfies MarketLiveEnglishCache,
  };
}

function readEndpointUpdatedAt(
  cache: MarketLiveDataCache | null,
  source: MarketLiveDataSourceKey,
): number | undefined {
  if (!cache) return undefined;
  const explicit = cache.endpointUpdatedAt?.[source];
  if (typeof explicit === 'number') return explicit;
  const fieldPresent =
    source === 'enFilters'
      ? cache.enFields !== undefined
      : source === 'items'
        ? cache.tradeItems !== undefined
        : cache[source] !== undefined;
  return fieldPresent && cache.updatedAt > 0 ? cache.updatedAt : undefined;
}

function readCooldownSet(
  rawError: unknown,
  now: number,
  force: boolean | undefined,
): Set<MarketLiveSourceKey> | null {
  if (force || !isRecord(rawError) || typeof rawError.failedAt !== 'number') return null;
  if (rawError.failedAt <= 0 || now - rawError.failedAt >= MARKET_LIVE_ERROR_COOLDOWN_MS) {
    return null;
  }
  if (!Array.isArray(rawError.failedSources)) {
    return new Set(['ui', ...DATA_SOURCE_KEYS]);
  }
  const valid = new Set<MarketLiveSourceKey>(['ui', ...DATA_SOURCE_KEYS]);
  return new Set(
    rawError.failedSources.filter(
      (item): item is MarketLiveSourceKey =>
        typeof item === 'string' && valid.has(item as MarketLiveSourceKey),
    ),
  );
}

export function createMarketTranslationLiveService(
  options: {
    storage?: MarketLiveStorage;
    http?: MarketLiveHttpClient;
    now?: () => number;
  } = {},
): MarketTranslationLiveService {
  const storage = options.storage ?? createChromeMarketLiveStorage();
  const http: MarketLiveHttpClient = options.http ?? fetch;
  const now = options.now ?? Date.now;
  const activeRequests = new Map<string, Promise<MarketTranslationRefreshOutcome>>();

  async function runRefresh(
    request: MarketTranslationRefreshRequest,
  ): Promise<MarketTranslationRefreshOutcome> {
    const { version, locale, force } = request;
    const uiKey = getMarketLiveUiCacheKey(locale);
    const dataKey = getMarketLiveDataCacheKey(version, locale);
    const englishKey = getMarketLiveEnglishCacheKey(version, locale);
    const errorKey = getMarketLiveErrorCacheKey(version, locale);
    const currentNow = now();

    const stored = await storage.get([uiKey, dataKey, englishKey, errorKey]);
    const prevUi = readValidMarketLiveUiCache(stored[uiKey], locale);
    const storedData = readValidMarketLiveDataCache(stored[dataKey], version, locale);
    const storedEnglish = readValidMarketLiveEnglishCache(stored[englishKey], version, locale);
    // 英文快取優先；舊格式 data 快取裡的英文欄位只在英文快取缺該欄位時沿用
    const prevData: MarketLiveDataCache | null = storedData && {
      ...storedData,
      enStats: storedEnglish?.enStats ?? storedData.enStats,
      enFields: storedEnglish?.enFields ?? storedData.enFields,
      enItems: storedEnglish?.enItems ?? storedData.enItems,
    };
    const cooledDown = readCooldownSet(stored[errorKey], currentNow, force);

    const prevEndpointUpdatedAt: Partial<Record<MarketLiveDataSourceKey, number>> = {};
    for (const ep of DATA_SOURCE_KEYS) {
      const ts = readEndpointUpdatedAt(prevData, ep);
      if (ts !== undefined) prevEndpointUpdatedAt[ep] = ts;
    }

    const shouldFetch = (source: MarketLiveSourceKey, fresh: boolean): boolean =>
      Boolean(force) || (!fresh && !(cooledDown?.has(source) ?? false));

    const fetchUi = shouldFetch('ui', isMarketLiveCacheFresh(prevUi?.updatedAt, currentNow));
    const fetchStats = shouldFetch(
      'stats',
      isMarketLiveCacheFresh(prevEndpointUpdatedAt.stats, currentNow),
    );
    const fetchStatic = shouldFetch(
      'static',
      isMarketLiveCacheFresh(prevEndpointUpdatedAt.static, currentNow),
    );
    const fetchFilters = shouldFetch(
      'filters',
      isMarketLiveCacheFresh(prevEndpointUpdatedAt.filters, currentNow),
    );
    const fetchItems = shouldFetch(
      'items',
      isMarketLiveCacheFresh(prevEndpointUpdatedAt.items, currentNow),
    );
    const fetchEnStats = shouldFetch(
      'enStats',
      isMarketLiveCacheFresh(prevEndpointUpdatedAt.enStats, currentNow),
    );
    const fetchEnFilters = shouldFetch(
      'enFilters',
      isMarketLiveCacheFresh(prevEndpointUpdatedAt.enFilters, currentNow),
    );
    const fetchEnItems = shouldFetch(
      'enItems',
      isMarketLiveCacheFresh(prevEndpointUpdatedAt.enItems, currentNow),
    );

    const attemptedSources: MarketLiveSourceKey[] = [];
    if (fetchUi) attemptedSources.push('ui');
    if (fetchStats) attemptedSources.push('stats');
    if (fetchStatic) attemptedSources.push('static');
    if (fetchFilters) attemptedSources.push('filters');
    if (fetchItems) attemptedSources.push('items');
    if (fetchEnStats) attemptedSources.push('enStats');
    if (fetchEnFilters) attemptedSources.push('enFilters');
    if (fetchEnItems) attemptedSources.push('enItems');

    if (attemptedSources.length === 0) {
      // 都還新鮮但仍是舊格式：拆開存放，之後頁面啟動不必讀英文資料
      if (prevData && isLegacyMarketLiveDataCache(storedData)) {
        await storage.set(splitMarketLiveDataCache(prevData, dataKey, englishKey));
      }
      return { ok: true, updated: false, sources: [] };
    }

    const endpoints = getRealmEndpoints(version, locale);
    const [uiRes, statsRes, staticRes, filtersRes, itemsRes, enStatsRes, enFiltersRes, enItemsRes] =
      await Promise.allSettled([
        fetchUi
          ? fetchFirstText(http, endpoints.uiUrls).then(parseOfficialTranslateJs)
          : Promise.resolve(null),
        fetchStats
          ? fetchJson(http, endpoints.statsUrl).then(parseOfficialTradeStats)
          : Promise.resolve(null),
        fetchStatic
          ? fetchJson(http, endpoints.staticUrl).then(parseOfficialTradeStatic)
          : Promise.resolve(null),
        fetchFilters
          ? fetchJson(http, endpoints.filtersUrl).then(parseOfficialTradeFilters)
          : Promise.resolve(null),
        fetchItems
          ? fetchJson(http, endpoints.itemsUrl).then(parseOfficialTradeItems)
          : Promise.resolve(null),
        fetchEnStats
          ? fetchJson(http, endpoints.enStatsUrl).then(parseOfficialEnglishTradeStats)
          : Promise.resolve(null),
        fetchEnFilters
          ? fetchJson(http, endpoints.enFiltersUrl).then(parseOfficialEnglishTradeFilters)
          : Promise.resolve(null),
        fetchEnItems
          ? fetchJson(http, endpoints.enItemsUrl).then(parseOfficialEnglishTradeItems)
          : Promise.resolve(null),
      ]);

    const updatedSources: MarketLiveSourceKey[] = [];
    const nextWrites: Record<string, unknown> = {};
    const fetchedAt = now();

    const nextUi = uiRes.status === 'fulfilled' ? uiRes.value : null;
    if (nextUi) {
      nextWrites[uiKey] = {
        schemaVersion: MARKET_LIVE_SCHEMA_VERSION,
        locale,
        updatedAt: fetchedAt,
        strings: nextUi,
      } satisfies MarketLiveUiCache;
      updatedSources.push('ui');
    }

    const rawNextStats = statsRes.status === 'fulfilled' ? statsRes.value : null;
    const nextStatic = staticRes.status === 'fulfilled' ? staticRes.value : null;
    const rawNextFilters = filtersRes.status === 'fulfilled' ? filtersRes.value : null;
    const rawNextItems = itemsRes.status === 'fulfilled' ? itemsRes.value : null;
    const nextEnStats = enStatsRes.status === 'fulfilled' ? enStatsRes.value : null;
    const nextEnFields = enFiltersRes.status === 'fulfilled' ? enFiltersRes.value : null;
    const nextEnItems = enItemsRes.status === 'fulfilled' ? enItemsRes.value : null;

    const effectiveEnStats = nextEnStats ?? prevData?.enStats;
    const effectiveEnFields = nextEnFields ?? prevData?.enFields;
    const effectiveEnItems = nextEnItems ?? prevData?.enItems;

    let nextStats = rawNextStats;
    if (nextStats && effectiveEnStats) {
      nextStats = alignLiveStatsWithEnglish(nextStats, effectiveEnStats);
    }
    let nextFilters = rawNextFilters;
    if (
      nextFilters &&
      effectiveEnFields &&
      isFiltersMostlyEnglish(nextFilters, effectiveEnFields)
    ) {
      nextFilters = null;
    }
    const nextTradeItems =
      rawNextItems && effectiveEnItems
        ? alignLiveTradeItemsWithEnglish(rawNextItems, effectiveEnItems)
        : null;

    if (nextStats) updatedSources.push('stats');
    if (nextStatic) updatedSources.push('static');
    if (nextFilters) updatedSources.push('filters');
    if (nextTradeItems) updatedSources.push('items');
    if (nextEnStats) updatedSources.push('enStats');
    if (nextEnFields) updatedSources.push('enFilters');
    if (nextEnItems) updatedSources.push('enItems');

    // 若本次補抓到 enStats 而既有的 stats 尚未依英文對齊，一併修剪既有 stats 以免重複 id 錯位
    let retainedStats = prevData?.stats;
    if (!nextStats && retainedStats && nextEnStats) {
      retainedStats = alignLiveStatsWithEnglish(retainedStats, nextEnStats) ?? undefined;
    }

    const hasDataUpdate = Boolean(
      nextStats ||
      nextStatic ||
      nextFilters ||
      nextTradeItems ||
      nextEnStats ||
      nextEnFields ||
      nextEnItems,
    );
    if (hasDataUpdate) {
      const nextEndpointUpdatedAt: Partial<Record<MarketLiveDataSourceKey, number>> = {
        ...prevEndpointUpdatedAt,
      };
      if (nextStats) nextEndpointUpdatedAt.stats = fetchedAt;
      if (nextStatic) nextEndpointUpdatedAt.static = fetchedAt;
      if (nextFilters) nextEndpointUpdatedAt.filters = fetchedAt;
      if (nextTradeItems) nextEndpointUpdatedAt.items = fetchedAt;
      if (nextEnStats) nextEndpointUpdatedAt.enStats = fetchedAt;
      if (nextEnFields) nextEndpointUpdatedAt.enFilters = fetchedAt;
      if (nextEnItems) nextEndpointUpdatedAt.enItems = fetchedAt;

      const timestamps = DATA_SOURCE_KEYS.map((key) => nextEndpointUpdatedAt[key]).filter(
        (ts): ts is number => typeof ts === 'number',
      );
      const allDataPresent = timestamps.length === DATA_SOURCE_KEYS.length;

      Object.assign(
        nextWrites,
        splitMarketLiveDataCache(
          {
            schemaVersion: MARKET_LIVE_SCHEMA_VERSION,
            version,
            locale,
            updatedAt: allDataPresent ? Math.min(...timestamps) : 0,
            endpointUpdatedAt: nextEndpointUpdatedAt,
            stats: nextStats ?? retainedStats,
            static: nextStatic ?? prevData?.static,
            filters: nextFilters ?? prevData?.filters,
            tradeItems: nextTradeItems ?? prevData?.tradeItems,
            enStats: effectiveEnStats,
            enFields: effectiveEnFields,
            enItems: effectiveEnItems,
          },
          dataKey,
          englishKey,
        ),
      );
    }

    const updatedSet = new Set(updatedSources);
    const failedSources = attemptedSources.filter((s) => !updatedSet.has(s));
    if (failedSources.length > 0) {
      nextWrites[errorKey] = { failedAt: fetchedAt, failedSources };
    } else if (isRecord(stored[errorKey])) {
      nextWrites[errorKey] = { failedAt: 0, failedSources: [] };
    }

    if (Object.keys(nextWrites).length > 0) {
      await storage.set(nextWrites);
    }

    if (updatedSources.length > 0) {
      return { ok: true, updated: true, sources: updatedSources };
    }
    return { ok: false, error: '所有官方翻譯來源皆取得失敗或格式不符' };
  }

  return {
    refresh(request) {
      const key = `${request.version}:${request.locale}:${request.force ? '1' : '0'}`;
      const existing = activeRequests.get(key);
      if (existing) return existing;
      const promise = runRefresh(request).finally(() => activeRequests.delete(key));
      activeRequests.set(key, promise);
      return promise;
    },
  };
}

export function registerMarketTranslationBackgroundHandlers(
  options: {
    service?: MarketTranslationLiveService;
  } = {},
): MarketTranslationLiveService {
  const service = options.service ?? createMarketTranslationLiveService();
  extensionMessaging.onMessage('marketTranslation:refresh', ({ data }) => service.refresh(data));
  return service;
}
