/**
 * 市集漢化即時官方資料（背景抓取與快取）：
 * 直接向官方各區 API 與靜態字典抓取最新譯文，不需等擴充發版即可覆蓋新賽季詞綴、篩選器、靜態分類與介面字串；
 * 抓取或驗證失敗時退回擴充內建打包分片，且不影響開頁 1.5 秒閘門。
 */
import { extensionMessaging } from './extension-protocol';
import { parseLiveTradeFilters } from './live-trade-data';
import type { MarketTranslationLocale } from './market-translation';
import type { MarketTradeDictionary } from './market-translation-data';
import type { PoeVersion } from './trade-context';

export const MARKET_LIVE_SCHEMA_VERSION = 1;
export const MARKET_LIVE_TTL_MS = 6 * 60 * 60 * 1000;
export const MARKET_LIVE_ERROR_COOLDOWN_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MIN_UI_STRINGS = 100;
const MIN_STATS_COUNT = 500;
const MIN_STATIC_GROUPS = 3;
const MIN_STATIC_ENTRIES = 20;

const CJK_RE = /[\u4e00-\u9fff]/;

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

function hasAnyCjk(values: Iterable<string>): boolean {
  for (const value of values) {
    if (CJK_RE.test(value)) return true;
  }
  return false;
}

/** 解碼 JS 單/雙引號字串內容（不含外層引號）；遇到不支援的跳脫時回傳 null */
function unescapeJsString(raw: string): string | null {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length) return null;
    const esc = raw[i];
    if (esc === "'" || esc === '"' || esc === '\\' || esc === '/') out += esc;
    else if (esc === 'n') out += '\n';
    else if (esc === 'r') out += '\r';
    else if (esc === 't') out += '\t';
    else if (esc === 'b') out += '\b';
    else if (esc === 'f') out += '\f';
    else if (esc === 'x') {
      const hex = raw.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 2;
    } else if (esc === 'u') {
      if (raw[i + 1] === '{') {
        const end = raw.indexOf('}', i + 2);
        if (end < 0) return null;
        const hex = raw.slice(i + 2, end);
        if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
        out += String.fromCodePoint(parseInt(hex, 16));
        i = end;
      } else {
        const hex = raw.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      }
    } else {
      out += esc;
    }
  }
  return out;
}

/** 從行首開始讀取一個 JS 單引號或雙引號字串字面值，回傳解碼文字與結束後索引 */
function readJsStringLiteral(line: string, start: number): { value: string; next: number } | null {
  const quote = line[start];
  if (quote !== "'" && quote !== '"') return null;
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      const value = unescapeJsString(line.slice(start + 1, i));
      return value === null ? null : { value, next: i + 1 };
    }
    i += 1;
  }
  return null;
}

/**
 * 嚴格解析官方 `translate.zh_TW.js` / `translate.zh_CN.js`（不使用 eval）：
 * 僅允許空白、註解、宣告 `__` 的標頭與 `__['k'] = 'v';` 賦值行；任何無法辨識的行都整份拒絕。
 */
export function parseOfficialTranslateJs(source: string): Record<string, string> | null {
  const cleaned = source.replace(/^\uFEFF/, '');
  if (!cleaned || /^\s*</.test(cleaned.slice(0, 64))) return null;

  const strings: Record<string, string> = {};
  const lines = cleaned.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^(?:var\s+)?(?:window\.)?__\s*=\s*(?:(?:window\.)?__\s*\|\|\s*)?\{\}\s*;?$/.test(line)) {
      continue;
    }
    if (!line.startsWith('__[')) return null;
    const keyPart = readJsStringLiteral(line, 3);
    if (!keyPart) return null;
    const midMatch = line.slice(keyPart.next).match(/^\]\s*=\s*/);
    if (!midMatch) return null;
    const valStart = keyPart.next + midMatch[0].length;
    const valPart = readJsStringLiteral(line, valStart);
    if (!valPart) return null;
    const tail = line.slice(valPart.next).trim();
    if (tail && tail !== ';') return null;

    if (keyPart.value && valPart.value && valPart.value !== keyPart.value) {
      strings[keyPart.value] = valPart.value;
    }
  }

  const values = Object.values(strings);
  if (values.length < MIN_UI_STRINGS || !hasAnyCjk(values)) return null;
  return strings;
}

function collectTradeStatsEntries(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const labels: Record<string, string> = {};
  const groupedTexts = new Map<string, string[]>();
  const options: Record<string, Record<string, string>> = {};
  let hasPseudo = false;
  let totalEntries = 0;

  for (const group of raw.result) {
    if (!isRecord(group) || typeof group.id !== 'string' || !group.id) return null;
    if (group.id === 'pseudo') hasPseudo = true;
    if (typeof group.label === 'string' && group.label.trim()) {
      labels[group.id] = group.label.trim();
    }
    if (!Array.isArray(group.entries)) return null;
    for (const entry of group.entries) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) return null;
      if (typeof entry.text !== 'string') continue;
      const text = entry.text.trim();
      if (!text) continue;
      totalEntries += 1;
      const list = groupedTexts.get(entry.id);
      if (list) list.push(text);
      else groupedTexts.set(entry.id, [text]);

      if (isRecord(entry.option) && Array.isArray(entry.option.options)) {
        const optionMap: Record<string, string> = options[entry.id] ?? {};
        for (const opt of entry.option.options) {
          if (!isRecord(opt)) continue;
          if (
            (typeof opt.id === 'string' || typeof opt.id === 'number') &&
            typeof opt.text === 'string'
          ) {
            const optText = opt.text.trim();
            if (optText) optionMap[String(opt.id)] = optText;
          }
        }
        if (Object.keys(optionMap).length > 0) options[entry.id] = optionMap;
      }
    }
  }

  if (!hasPseudo || totalEntries < MIN_STATS_COUNT) return null;
  const stats: Record<string, string | string[]> = {};
  for (const [id, list] of groupedTexts) {
    stats[id] = list.length === 1 ? list[0] : list;
  }
  return { labels, stats, options };
}

function hasCjkStatValues(stats: Record<string, string | string[]>): boolean {
  for (const val of Object.values(stats)) {
    if (typeof val === 'string' ? CJK_RE.test(val) : val.some((item) => CJK_RE.test(item))) {
      return true;
    }
  }
  return false;
}

export function parseOfficialTradeStats(
  raw: unknown,
): NonNullable<MarketTradeDictionary['stats']> | null {
  const parsed = collectTradeStatsEntries(raw);
  if (!parsed) return null;
  if (!hasCjkStatValues(parsed.stats)) return null;
  return parsed;
}

export function parseOfficialEnglishTradeStats(
  raw: unknown,
): Record<string, string | string[]> | null {
  const parsed = collectTradeStatsEntries(raw);
  return parsed ? parsed.stats : null;
}

export function parseOfficialTradeStatic(
  raw: unknown,
): NonNullable<MarketTradeDictionary['static']> | null {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const labels: Record<string, string> = {};
  const entries: Record<string, Record<string, string>> = {};
  let entryCount = 0;

  for (const group of raw.result) {
    if (!isRecord(group) || typeof group.id !== 'string' || !group.id) return null;
    if (typeof group.label === 'string' && group.label.trim()) {
      labels[group.id] = group.label.trim();
    }
    if (!Array.isArray(group.entries)) return null;
    const groupEntries: Record<string, string> = {};
    for (const entry of group.entries) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;
      // sep 僅為視覺分隔標題，同群組可能有多筆重複 id，不可覆蓋寫入
      if (entry.id === 'sep' || typeof entry.text !== 'string') continue;
      const text = entry.text.trim();
      if (!text) continue;
      groupEntries[entry.id] = text;
      entryCount += 1;
    }
    if (Object.keys(groupEntries).length > 0) entries[group.id] = groupEntries;
  }

  if (Object.keys(entries).length < MIN_STATIC_GROUPS || entryCount < MIN_STATIC_ENTRIES) {
    return null;
  }
  const hasCjkEntries = Object.values(entries).some((group) => hasAnyCjk(Object.values(group)));
  if (!hasCjkEntries) return null;
  return { labels, entries };
}

export function parseOfficialTradeFilters(
  raw: unknown,
): NonNullable<MarketTradeDictionary['filters']> | null {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const parsed = parseLiveTradeFilters(raw.result);
  if (!parsed) return null;
  if (!hasAnyCjk(Object.values(parsed.groups)) && !hasAnyCjk(Object.values(parsed.fields))) {
    return null;
  }
  return parsed;
}

export function parseOfficialEnglishTradeFilters(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const parsed = parseLiveTradeFilters(raw.result);
  return parsed ? parsed.fields : null;
}

function collectTradeDiscItems(raw: unknown): MarketLiveDiscItemsRaw | null {
  if (!isRecord(raw) || !Array.isArray(raw.result) || raw.result.length === 0) return null;
  const byDisc: Record<string, Array<{ type: string; text: string }>> = {};
  const suffixCounts = new Map<string, Map<string, number>>();
  let hasGroupEntries = false;

  for (const group of raw.result) {
    if (!isRecord(group) || !Array.isArray(group.entries)) return null;
    if (group.entries.length > 0) hasGroupEntries = true;
    for (const entry of group.entries) {
      if (!isRecord(entry)) continue;
      const disc = typeof entry.disc === 'string' ? entry.disc.trim() : '';
      const type = typeof entry.type === 'string' ? entry.type.trim() : '';
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!disc || !type || !text) continue;
      (byDisc[disc] ??= []).push({ type, text });

      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (name) {
        const prefix = `${name} ${type}`;
        if (text.startsWith(prefix) && text.length > prefix.length) {
          const suffix = text.slice(prefix.length);
          let counts = suffixCounts.get(disc);
          if (!counts) {
            counts = new Map();
            suffixCounts.set(disc, counts);
          }
          counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
        }
      }
    }
  }

  if (!hasGroupEntries) return null;
  const discSuffixes: Record<string, string> = {};
  for (const [disc, counts] of suffixCounts) {
    let bestSuffix = '';
    let bestCount = 0;
    for (const [suffix, count] of counts) {
      if (count > bestCount) {
        bestSuffix = suffix;
        bestCount = count;
      }
    }
    if (bestSuffix) discSuffixes[disc] = bestSuffix;
  }
  return { byDisc, discSuffixes };
}

export function parseOfficialTradeItems(raw: unknown): MarketLiveDiscItemsRaw | null {
  const parsed = collectTradeDiscItems(raw);
  if (!parsed) return null;
  const hasCjkEntries = Object.values(parsed.byDisc).some((entries) =>
    entries.some((entry) => CJK_RE.test(entry.text)),
  );
  const hasCjkSuffix = hasAnyCjk(Object.values(parsed.discSuffixes));
  if (!hasCjkEntries && !hasCjkSuffix) return null;
  return parsed;
}

export function parseOfficialEnglishTradeItems(raw: unknown): MarketLiveEnglishItems | null {
  const parsed = collectTradeDiscItems(raw);
  if (!parsed) return null;
  const byDisc: Record<string, Record<string, string>> = {};
  for (const [disc, entries] of Object.entries(parsed.byDisc)) {
    const map: Record<string, string> = {};
    for (const entry of entries) map[entry.type] = entry.text;
    if (Object.keys(map).length > 0) byDisc[disc] = map;
  }
  return {
    byDisc,
    ...(parsed.discSuffixes.legacy ? { legacySuffix: parsed.discSuffixes.legacy } : {}),
  };
}

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

const DATA_SOURCE_KEYS: readonly MarketLiveDataSourceKey[] = [
  'stats',
  'static',
  'filters',
  'items',
  'enStats',
  'enFilters',
  'enItems',
];
const MIN_ENGLISH_RATIO_SAMPLE = 10;
const MAX_IDENTICAL_TO_ENGLISH_RATIO = 0.5;

function isMostlyIdenticalToEnglish(compared: number, identical: number): boolean {
  return (
    compared >= MIN_ENGLISH_RATIO_SAMPLE && identical / compared > MAX_IDENTICAL_TO_ENGLISH_RATIO
  );
}

/**
 * 依國際服英文 stats 過濾與驗證在地化 stats：
 * 1. 只保留國際服存在的 id，且重複出現次數需完全一致（避免 `localizeStats` 依索引對位錯亂）。
 * 2. 若重疊條目與英文完全相同的比例超過 50%，視為目標網域退回英文而拒絕整份。
 */
export function alignLiveStatsWithEnglish(
  localized: NonNullable<MarketTradeDictionary['stats']>,
  enStats: Readonly<Record<string, string | string[]>>,
): NonNullable<MarketTradeDictionary['stats']> | null {
  const alignedStats: Record<string, string | string[]> = {};
  let compared = 0;
  let identical = 0;

  for (const [id, locVal] of Object.entries(localized.stats)) {
    const enVal = enStats[id];
    if (enVal === undefined) continue;
    if (typeof locVal === 'string' && typeof enVal === 'string') {
      compared += 1;
      if (locVal === enVal) identical += 1;
      alignedStats[id] = locVal;
      continue;
    }
    if (Array.isArray(locVal) && Array.isArray(enVal) && locVal.length === enVal.length) {
      for (let i = 0; i < locVal.length; i += 1) {
        compared += 1;
        if (locVal[i] === enVal[i]) identical += 1;
      }
      alignedStats[id] = locVal;
    }
  }

  if (
    Object.keys(alignedStats).length < MIN_STATS_COUNT ||
    isMostlyIdenticalToEnglish(compared, identical)
  ) {
    return null;
  }

  const alignedOptions: Record<string, Record<string, string>> = {};
  for (const [id, opts] of Object.entries(localized.options)) {
    if (id in alignedStats) alignedOptions[id] = opts;
  }
  return { labels: localized.labels, stats: alignedStats, options: alignedOptions };
}

function isFiltersMostlyEnglish(
  localized: NonNullable<MarketTradeDictionary['filters']>,
  enFields: Readonly<Record<string, string>>,
): boolean {
  let compared = 0;
  let identical = 0;
  for (const [id, locText] of Object.entries(localized.fields)) {
    const enText = enFields[id];
    if (typeof enText !== 'string') continue;
    compared += 1;
    if (locText === enText) identical += 1;
  }
  return isMostlyIdenticalToEnglish(compared, identical);
}

/**
 * 依國際服英文 items 過濾並驗證在地化 `disc` 群組：
 * 只收錄半數以上條目的 `type` 與英文相同且 `text` 已翻譯的群組（排除以在地化基底名為 type 的 `legacy`/`alt_x` 等），
 * 同時驗證 `legacy` 後綴未退回英文。
 */
export function alignLiveTradeItemsWithEnglish(
  localized: MarketLiveDiscItemsRaw,
  enItems: MarketLiveEnglishItems,
): NonNullable<MarketTradeDictionary['tradeItems']> | null {
  if (enItems.legacySuffix && localized.discSuffixes.legacy === enItems.legacySuffix) {
    return null;
  }
  const discEntries: Record<string, Record<string, string>> = {};
  let compared = 0;
  let identical = 0;

  for (const [disc, entries] of Object.entries(localized.byDisc)) {
    const enGroup = enItems.byDisc[disc];
    if (!enGroup) continue;
    const matched: Record<string, string> = {};
    let matchedCount = 0;
    for (const entry of entries) {
      const enText = enGroup[entry.type];
      if (!enText) continue;
      compared += 1;
      if (entry.text === enText) {
        identical += 1;
      } else {
        matched[entry.type] = entry.text;
        matchedCount += 1;
      }
    }
    if (matchedCount > 0 && matchedCount * 2 >= entries.length) {
      discEntries[disc] = matched;
    }
  }

  if (Object.keys(discEntries).length > 0 && isMostlyIdenticalToEnglish(compared, identical)) {
    return null;
  }
  // 只收已翻譯的後綴：官方退回英文的後綴不得覆蓋內建的中文後綴（不只 legacy，alt_x 等亦同）
  const discSuffixes = Object.fromEntries(
    Object.entries(localized.discSuffixes).filter(([, suffix]) => CJK_RE.test(suffix)),
  );
  if (Object.keys(discEntries).length === 0 && Object.keys(discSuffixes).length === 0) {
    return null;
  }
  return { discEntries, discSuffixes };
}

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
