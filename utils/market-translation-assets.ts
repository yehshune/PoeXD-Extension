/**
 * 市集漢化第 3 階段的資料載入（isolated world）：讀擴充內建的分片，組成給 MAIN world 改寫
 * data API 的字典（見 market-translation-data.ts）。
 *
 * 各類分片獨立載入：任一類失敗或格式不符時只略過那一類，該類下拉選單維持英文。
 */
import type { MarketTradeDictionary } from './market-translation-data';
import type { MarketTranslationLocale } from './market-translation';
import {
  getLocaleItemsAssetPath,
  getLocaleTradeFiltersAssetPath,
  getLocaleTradeStaticAssetPath,
  getLocaleTradeStatsAssetPath,
  type PoeVersion,
} from './trade-context';

const MARKET_SCHEMA_VERSION = 1;

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function requireMarketShard(data: unknown, locale: string, name: string): Json {
  if (!isRecord(data) || data.schemaVersion !== MARKET_SCHEMA_VERSION || data.locale !== locale) {
    throw new Error(`${name} 的 schemaVersion 或語系不符`);
  }
  return data;
}

function parseStats(data: unknown, locale: string): MarketTradeDictionary['stats'] {
  const shard = requireMarketShard(data, locale, 'trade-stats.json');
  if (!isRecord(shard.stats) || !isRecord(shard.labels) || !isRecord(shard.options)) {
    throw new Error('trade-stats.json 格式錯誤');
  }
  return shard as unknown as MarketTradeDictionary['stats'];
}

function parseStatic(data: unknown, locale: string): MarketTradeDictionary['static'] {
  const shard = requireMarketShard(data, locale, 'trade-static.json');
  if (!isRecord(shard.entries) || !isRecord(shard.labels)) {
    throw new Error('trade-static.json 格式錯誤');
  }
  return shard as unknown as MarketTradeDictionary['static'];
}

function parseFilters(data: unknown): MarketTradeDictionary['filters'] {
  if (!isRecord(data) || !isRecord(data.groups) || !isRecord(data.fields)) {
    throw new Error('trade-filters.json 格式錯誤');
  }
  return {
    groups: data.groups as Record<string, string>,
    fields: data.fields as Record<string, string>,
    options: (isRecord(data.options) ? data.options : {}) as Record<string, Record<string, string>>,
  };
}

/** 兩份 items.json 以索引對齊；長度不同代表不是同一次建置，整份不採用 */
function buildItemMap(english: unknown, localized: unknown): Record<string, string> {
  const en = isRecord(english) ? english.items : undefined;
  const zh = isRecord(localized) ? localized.items : undefined;
  if (!isStringArray(en) || !isStringArray(zh) || en.length !== zh.length) {
    throw new Error('items.json 索引無法對齊');
  }
  const map: Record<string, string> = {};
  en.forEach((name, index) => {
    if (name && zh[index]) map[name.toLowerCase()] = zh[index];
  });
  return map;
}

const settledValue = <T>(result: PromiseSettledResult<T>): T | undefined =>
  result.status === 'fulfilled' ? result.value : undefined;

export async function loadMarketTradeDictionary(
  loadJson: (path: string) => Promise<unknown>,
  options: { version: PoeVersion; locale: MarketTranslationLocale },
): Promise<Omit<MarketTradeDictionary, 'ui'>> {
  const { version, locale } = options;
  const [stats, statics, filters, items] = await Promise.allSettled([
    loadJson(getLocaleTradeStatsAssetPath(version, locale)).then((data) =>
      parseStats(data, locale),
    ),
    loadJson(getLocaleTradeStaticAssetPath(version, locale)).then((data) =>
      parseStatic(data, locale),
    ),
    loadJson(getLocaleTradeFiltersAssetPath(version, locale)).then(parseFilters),
    Promise.all([
      loadJson(getLocaleItemsAssetPath(version, 'en')),
      loadJson(getLocaleItemsAssetPath(version, locale)),
    ]).then(([en, zh]) => buildItemMap(en, zh)),
  ]);

  return {
    stats: settledValue(stats),
    static: settledValue(statics),
    filters: settledValue(filters),
    items: settledValue(items),
  };
}
