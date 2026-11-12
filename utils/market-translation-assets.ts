/**
 * 市集漢化第 3 階段的資料載入（isolated world）：讀擴充內建的分片，組成給 MAIN world 改寫
 * data API 的字典（見 market-translation-data.ts）。
 *
 * 各類分片獨立載入：任一類失敗或格式不符時只略過那一類，該類下拉選單維持英文。
 */
import type { MarketTradeDictionary } from './market-translation-data';
import type { ModLinePairs } from './market-mod-lines';
import type { ResultTranslatorData } from './market-result-translator';
import type { MarketTranslationLocale } from './market-translation';
import {
  getLocaleItemsAssetPath,
  getLocaleModLinesAssetPath,
  getLocaleResultLabelsAssetPath,
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

function parseModLines(data: unknown, locale: string): Record<string, ModLinePairs> {
  const shard = requireMarketShard(data, locale, 'mod-lines.json');
  if (!isRecord(shard.lines)) throw new Error('mod-lines.json 格式錯誤');
  return shard.lines as Record<string, ModLinePairs>;
}

function parseResultLabels(data: unknown, locale: string) {
  const shard = requireMarketShard(data, locale, 'result-labels.json');
  if (!isRecord(shard.labels) || !Array.isArray(shard.templates)) {
    throw new Error('result-labels.json 格式錯誤');
  }
  return {
    labels: shard.labels as Record<string, string>,
    templates: shard.templates as Array<[string, string]>,
  };
}

function parseEnglishStats(data: unknown): Record<string, string | string[]> {
  const shard = requireMarketShard(data, 'en', 'trade-stats.json (en)');
  if (!isRecord(shard.stats)) throw new Error('trade-stats.json (en) 格式錯誤');
  return shard.stats as Record<string, string | string[]>;
}

/** 篩選器欄位名稱（英文 → 譯文），以 id 對接 */
function fieldLabels(english: unknown, localized: Record<string, string> | undefined) {
  const fields = isRecord(english) && isRecord(english.fields) ? english.fields : {};
  const labels: Record<string, string> = {};
  if (!localized) return labels;
  for (const [id, text] of Object.entries(fields)) {
    if (typeof text === 'string' && localized[id]) labels[text] = localized[id];
  }
  return labels;
}

/**
 * 結果列翻譯的資料：遊戲寫法變體、市集寫法備援（中英 trade-stats）、物品名、標籤與句型模板。
 * 已載入的 data 字典直接沿用；各部分獨立，失敗的部分為空。
 */
export async function loadResultTranslatorData(
  loadJson: (path: string) => Promise<unknown>,
  options: {
    version: PoeVersion;
    locale: MarketTranslationLocale;
    dictionary: Omit<MarketTradeDictionary, 'ui'>;
    ui: Record<string, string>;
  },
): Promise<ResultTranslatorData> {
  const { version, locale, dictionary, ui } = options;
  const [modLines, englishStats, englishFilters, resultLabels] = await Promise.allSettled([
    loadJson(getLocaleModLinesAssetPath(version, locale)).then((data) =>
      parseModLines(data, locale),
    ),
    loadJson(getLocaleTradeStatsAssetPath(version, 'en')).then(parseEnglishStats),
    loadJson(getLocaleTradeFiltersAssetPath(version, 'en')),
    loadJson(getLocaleResultLabelsAssetPath(version, locale)).then((data) =>
      parseResultLabels(data, locale),
    ),
  ]);
  const en = settledValue(englishStats);
  const gameLabels = settledValue(resultLabels);
  const localized = dictionary.stats?.stats;
  return {
    modLines: settledValue(modLines) ?? {},
    tradeStats: en && localized ? { en, localized } : undefined,
    items: dictionary.items ?? {},
    // 官方介面字典是官網實際顯示的寫法，優先於篩選器欄位名稱，遊戲資料表的標籤最後
    labels: {
      ...gameLabels?.labels,
      ...fieldLabels(settledValue(englishFilters), dictionary.filters?.fields),
      ...ui,
    },
    templates: gameLabels?.templates ?? [],
    locale,
  };
}
