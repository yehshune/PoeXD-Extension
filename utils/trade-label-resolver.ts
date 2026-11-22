/**
 * Trade Label Resolver：市集標籤（篩選群組／欄位／選項、詞綴的市集寫法、stat 網域標籤）的唯一查詢入口。
 *
 * 所有來源的優先順序都在這裡決定，呼叫端只問「這個 id 要顯示什麼」：
 * - 即時市集資料（ADR-0014）：頁面自己載入的資料，只在顯示語系等於頁面語系時採用；
 *   國際服顯示中文時改用市集漢化的目標服快取（ADR-0012），頁面資料一律不用。
 * - 打包分片（ADR-0011）：官方 `trade-stats.json`、`trade-filters.json`，顯示語系 → UI 語系 → en。
 * - 詞綴的後備鏈（ADR-0015）：市集寫法 → 詞綴字典 → pseudo → 傭兵詞綴 → 去掉前綴的 id。
 *
 * 只換顯示文字，不產生 id，也不影響送給 Trade API 的值。即時資料只存在記憶體，
 * 不轉成深層 reactive（stats 有上萬筆）；分片與即時資料各自有 reactive 訊號，
 * 某一類資料到達時只讓讀到它的 computed 重新計算。
 */
import { ref, shallowRef } from 'vue';
import type {
  SupportedAffixLocale,
  SupportedLocale,
  SupportedUiLocale,
} from './preferences-contract';
import {
  getLocaleTradeFiltersAssetPath,
  getLocaleTradeStatsAssetPath,
  type PoeVersion,
} from './trade-context';
import { getActiveDisplayLocale, getActiveUiLocale } from './i18n';
import { getCandidateStatIds, renderGenericTemplate, translateAffixStat } from './affix-lexicon';
import { translateMercenaryStat } from './mercenary-data';
import { isMarketTranslationHost } from './market-translation';
import { buildStatDomainIndex, statDomainsOf, type StatDomainIndex } from './stat-domain-order';
import { loadExtensionJson } from './extension-json-cache';
import type { LiveStatLabels, LiveTradeFilters } from './live-trade-data';
import {
  officialCategoryMapPoe1,
  officialCategoryMapPoe2,
  typeNamesPoe1,
  typeNamesPoe2,
} from '@/components/sidebar/typeMaps';
import poe1En from '../public/json/poe1/locales/en/trade-filters.json';
import poe1ZhTw from '../public/json/poe1/locales/zh-TW/trade-filters.json';
import poe1ZhCn from '../public/json/poe1/locales/zh-CN/trade-filters.json';
import poe2En from '../public/json/poe2/locales/en/trade-filters.json';
import poe2ZhTw from '../public/json/poe2/locales/zh-TW/trade-filters.json';
import poe2ZhCn from '../public/json/poe2/locales/zh-CN/trade-filters.json';

// ───────────────────────────── 資料形狀 ─────────────────────────────

/**
 * 市集篩選翻譯（官方 /api/{trade,trade2}/data/filters 產生，由 poexd-data 產生，見 docs/trade-filter-data.md）。
 * 欄位以 API 的穩定 id 為 key，各語系獨立，不需索引對齊。
 */
export interface TradeFiltersData {
  /** 產生此檔的語系（官方網域語言） */
  readonly locale?: string;
  readonly groups?: Readonly<Record<string, string>>;
  readonly fields?: Readonly<Record<string, string>>;
  readonly options?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 官方 /data/stats 的 pseudo 偽屬性文字，key 為完整 stat id（例如 `pseudo.pseudo_total_life`） */
  readonly pseudoStats?: Readonly<Record<string, string>>;
}

/**
 * 一份即時市集資料：頁面自己載入、經 isolated world 驗證過的篩選標籤與市集寫法，
 * 或市集漢化從目標服官方 API 更新的快取（形狀相同）。
 */
export interface LiveTradeDataSnapshot {
  /** 資料所屬語系：頁面資料是收到時的頁面語系（由 isolated world 判斷），市集漢化快取是目標服語系 */
  readonly pageLocale: SupportedLocale;
  readonly filters: LiveTradeFilters | null;
  readonly statLabels: LiveStatLabels | null;
}

export const OFFICIAL_STAT_TEXT_LOCALES = ['en', 'zh-TW', 'zh-CN'] as const;
type OfficialStatTextLocale = (typeof OFFICIAL_STAT_TEXT_LOCALES)[number];

type StatTexts = Readonly<Record<string, string | readonly string[]>>;
type StatDomainLabels = Readonly<Record<string, string>>;

interface StatShard {
  readonly stats: StatTexts;
  readonly labels: StatDomainLabels;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ───────────────────────────── 即時市集資料 ─────────────────────────────

type SnapshotsByVersion = Readonly<Partial<Record<PoeVersion, LiveTradeDataSnapshot>>>;

/** 頁面自己載入的資料（只存在這次 Search Observation Session，不寫 chrome.storage） */
const pageSnapshots = shallowRef<SnapshotsByVersion>({});
/** 市集漢化啟用時的目標服快取；市集漢化未啟用時一律是空的 */
const marketSnapshots = shallowRef<SnapshotsByVersion>({});

export function setLiveTradeData(version: PoeVersion, snapshot: LiveTradeDataSnapshot): void {
  pageSnapshots.value = {
    ...pageSnapshots.value,
    [version]: Object.freeze({ ...snapshot }),
  };
}

/** 傳入 null 清除（市集漢化停用、沒有快取或快取格式不符） */
export function setMarketLiveTradeData(
  version: PoeVersion,
  snapshot: LiveTradeDataSnapshot | null,
): void {
  const { [version]: _removed, ...rest } = marketSnapshots.value;
  marketSnapshots.value = snapshot ? { ...rest, [version]: Object.freeze({ ...snapshot }) } : rest;
}

const currentHostname = (): string =>
  typeof window !== 'undefined' && window.location ? window.location.hostname : '';

/**
 * 可用的即時資料（ADR-0014 的語系閘門）：只回傳語系等於顯示語系的資料，不混用語系。
 * - 一般情況：頁面自己載入的資料，顯示語系等於收到資料時的頁面語系才用。
 * - 國際服顯示中文：頁面資料是英文，且可能已被市集漢化改寫成中英並列，一律不用；
 *   改用市集漢化從目標服官方 API 更新的快取（只在市集漢化啟用時存在）。
 * 會讀取 reactive 狀態，在 computed / render 中呼叫時資料到達會重新計算。
 */
export function getUsableLiveTradeData(
  version: PoeVersion,
  displayLocale: SupportedLocale | string,
  hostname: string = currentHostname(),
): LiveTradeDataSnapshot | undefined {
  if (isMarketTranslationHost(hostname) && displayLocale !== 'en') {
    const market = marketSnapshots.value[version];
    return market && market.pageLocale === displayLocale ? market : undefined;
  }
  const snapshot = pageSnapshots.value[version];
  if (!snapshot || snapshot.pageLocale !== displayLocale) return undefined;
  return snapshot;
}

// ───────────────────────────── 官方詞綴文字分片 ─────────────────────────────

interface StatShardState {
  shards: Map<OfficialStatTextLocale, StatShard>;
  pending: Map<OfficialStatTextLocale, Promise<boolean>>;
  unavailable: Set<OfficialStatTextLocale>;
}

const statStateByVersion = new Map<PoeVersion, StatShardState>();
/** 官方詞綴分片載入完成時遞增 */
const statShardRevision = ref(0);

function getStatState(version: PoeVersion): StatShardState {
  let state = statStateByVersion.get(version);
  if (!state) {
    state = { shards: new Map(), pending: new Map(), unavailable: new Set() };
    statStateByVersion.set(version, state);
  }
  return state;
}

const isOfficialLocale = (locale: string): locale is OfficialStatTextLocale =>
  (OFFICIAL_STAT_TEXT_LOCALES as readonly string[]).includes(locale);

function parseStatLabels(raw: unknown): StatDomainLabels {
  if (!isRecord(raw)) return {};
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim()) labels[key] = value.trim();
  }
  return labels;
}

function parseStatShard(data: unknown): StatShard | null {
  if (!isRecord(data) || !isRecord(data.stats)) return null;
  const valid = Object.values(data.stats).every(
    (value) =>
      typeof value === 'string' ||
      (Array.isArray(value) && value.every((text) => typeof text === 'string')),
  );
  return valid ? { stats: data.stats as StatTexts, labels: parseStatLabels(data.labels) } : null;
}

/** 載入指定語系的官方詞綴文字；沒有官方資料的語系或載入失敗回傳 false，且不重複請求 */
function ensureStatShardLoaded(version: PoeVersion, locale: string): Promise<boolean> {
  if (!isOfficialLocale(locale)) return Promise.resolve(false);
  const state = getStatState(version);
  if (state.shards.has(locale)) return Promise.resolve(true);
  if (state.unavailable.has(locale)) return Promise.resolve(false);
  const inflight = state.pending.get(locale);
  if (inflight) return inflight;

  const promise = loadExtensionJson(getLocaleTradeStatsAssetPath(version, locale))
    .then(parseStatShard, () => null)
    .then((shard) => {
      state.pending.delete(locale);
      if (!shard) {
        state.unavailable.add(locale);
        return false;
      }
      state.shards.set(locale, shard);
      statShardRevision.value += 1;
      return true;
    });
  state.pending.set(locale, promise);
  return promise;
}

/** 讀取已載入的分片；尚未載入時在背景載入並回傳 undefined，載入後讀取者會重新計算 */
function readStatShard(version: PoeVersion, locale: OfficialStatTextLocale): StatShard | undefined {
  void statShardRevision.value;
  const shard = getStatState(version).shards.get(locale);
  if (!shard) void ensureStatShardLoaded(version, locale);
  return shard;
}

function lookupRawStatText(
  stats: StatTexts | Readonly<Record<string, string>> | undefined,
  statId: string,
): string | null {
  if (!stats) return null;
  for (const candidate of getCandidateStatIds(statId)) {
    const value = stats[candidate];
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text === 'string' && text.trim()) return text;
  }
  return null;
}

// ───────────────────────────── 篩選翻譯分片 ─────────────────────────────

/** UI 語系隨程式打包（同步可用，en 為最終後備）；其他顯示語系按需載入 */
const BUNDLED_FILTERS: Readonly<
  Record<PoeVersion, Readonly<Record<SupportedUiLocale, TradeFiltersData>>>
> = {
  poe1: { en: poe1En, 'zh-TW': poe1ZhTw, 'zh-CN': poe1ZhCn },
  poe2: { en: poe2En, 'zh-TW': poe2ZhTw, 'zh-CN': poe2ZhCn },
};

const getBundledFilters = (
  version: PoeVersion,
  locale: SupportedLocale,
): TradeFiltersData | undefined =>
  (BUNDLED_FILTERS[version] as Partial<Record<SupportedLocale, TradeFiltersData>>)[locale];

interface FilterShardState {
  shards: Map<SupportedLocale, TradeFiltersData>;
  pending: Map<SupportedLocale, Promise<void>>;
  /** 載入失敗的語系（例如尚未產生的 ko），不重複請求 */
  unavailable: Set<SupportedLocale>;
  /** 測試資料：排在所有來源之前 */
  testOverride: TradeFiltersData | null;
}

const filterStateByVersion = new Map<PoeVersion, FilterShardState>();
/** 篩選分片載入完成或測試資料變更時遞增 */
const filterShardRevision = ref(0);

function getFilterState(version: PoeVersion): FilterShardState {
  let state = filterStateByVersion.get(version);
  if (!state) {
    state = {
      shards: new Map(),
      pending: new Map(),
      unavailable: new Set(),
      testOverride: null,
    };
    filterStateByVersion.set(version, state);
  }
  return state;
}

function isTradeFiltersData(value: unknown): value is TradeFiltersData {
  return isRecord(value) && isRecord(value.groups) && isRecord(value.fields);
}

function ensureFilterShardLoaded(version: PoeVersion, locale: SupportedLocale): Promise<void> {
  if (getBundledFilters(version, locale)) return Promise.resolve();
  const state = getFilterState(version);
  if (state.shards.has(locale) || state.unavailable.has(locale)) return Promise.resolve();
  const inflight = state.pending.get(locale);
  if (inflight) return inflight;

  const promise = loadExtensionJson(getLocaleTradeFiltersAssetPath(version, locale))
    .then(
      (json: unknown) => (isTradeFiltersData(json) ? json : null),
      () => null,
    )
    .then((shard) => {
      state.pending.delete(locale);
      if (!shard) {
        state.unavailable.add(locale);
        return;
      }
      state.shards.set(locale, shard);
      filterShardRevision.value += 1;
    });
  state.pending.set(locale, promise);
  return promise;
}

/** 同一份即時快照只轉一次，讓讀取者拿到穩定的物件 */
const liveFilterSources = new WeakMap<LiveTradeDataSnapshot, TradeFiltersData | null>();

function toLiveFilterSource(snapshot: LiveTradeDataSnapshot): TradeFiltersData | null {
  const cached = liveFilterSources.get(snapshot);
  if (cached !== undefined) return cached;
  const { filters, statLabels } = snapshot;
  const source: TradeFiltersData | null =
    filters || statLabels
      ? Object.freeze({
          locale: snapshot.pageLocale,
          groups: filters?.groups ?? {},
          fields: filters?.fields ?? {},
          options: filters?.options ?? {},
          pseudoStats: statLabels?.pseudoStats ?? {},
        })
      : null;
  liveFilterSources.set(snapshot, source);
  return source;
}

/**
 * 依優先順序排列的篩選翻譯：測試資料 → 即時市集資料（僅顯示語系等於頁面語系時）
 * → 顯示語系 → UI 語系 → en。即時資料沒有的 id 由後面的打包分片補上。
 * 顯示語系尚未載入時在背景載入，完成後讀取者會重新計算。
 */
function filterSources(version: PoeVersion): TradeFiltersData[] {
  void filterShardRevision.value;
  const state = getFilterState(version);
  const sources: TradeFiltersData[] = [];
  if (state.testOverride) sources.push(state.testOverride);
  const displayLocale = getActiveDisplayLocale();
  const live = getUsableLiveTradeData(version, displayLocale);
  const liveSource = live ? toLiveFilterSource(live) : null;
  if (liveSource) sources.push(liveSource);
  for (const locale of new Set<SupportedLocale>([displayLocale, getActiveUiLocale()])) {
    const shard = getBundledFilters(version, locale) ?? state.shards.get(locale);
    if (shard) sources.push(shard);
    else void ensureFilterShardLoaded(version, locale);
  }
  sources.push(BUNDLED_FILTERS[version].en);
  return sources;
}

/** 預先載入指定語系（預設為顯示語系與 UI 語系）的篩選翻譯；失敗的語系之後不再請求 */
export async function preloadTradeLabels(
  version: PoeVersion,
  locales: Iterable<SupportedLocale> = [getActiveDisplayLocale(), getActiveUiLocale()],
): Promise<void> {
  await Promise.all(
    [...new Set(locales)].map((locale) => ensureFilterShardLoaded(version, locale)),
  );
}

// ───────────────────────────── 市集寫法 ─────────────────────────────

/**
 * 中文等非英文市集回傳的仍是英文原文時視為沒有翻譯（回傳 null，讓呼叫端改用詞綴字典）。
 * 英文分片尚未載入時先採用，載入後讀取者會重新判斷。
 */
function rejectUntranslated(
  text: string,
  statId: string,
  version: PoeVersion,
  locale: string,
): string | null {
  if (locale === 'en') return text;
  return text === lookupRawStatText(readStatShard(version, 'en')?.stats, statId) ? null : text;
}

/** 即時資料的市集寫法；沒有可用的即時資料或查不到該 id 時回傳 undefined，由打包分片接手 */
function lookupLiveStatText(
  statId: string,
  version: PoeVersion,
  locale: string,
): string | null | undefined {
  const stats = getUsableLiveTradeData(version, locale)?.statLabels?.stats;
  const text = lookupRawStatText(stats, statId);
  return text ? rejectUntranslated(text, statId, version, locale) : undefined;
}

/**
 * 詞綴代碼在該語系市集的寫法，格式與詞綴字典的標籤相同（`#` 佔位、英文小寫）。
 * 優先用即時市集資料（顯示語系等於頁面語系時，任何語系都可用），再用打包的官方分片（en、zh-TW、zh-CN）。
 * 打包分片尚未載入時在背景載入並回傳 null；中文市集回傳的仍是英文原文時也視為沒有翻譯。
 */
export function getOfficialStatLabel(
  statId: string,
  version: PoeVersion,
  locale: SupportedAffixLocale | string,
): string | null {
  if (!statId) return null;
  const live = lookupLiveStatText(statId, version, locale);
  if (live !== undefined) return live === null ? null : renderGenericTemplate(live, locale);
  if (!isOfficialLocale(locale)) return null;
  const text = lookupRawStatText(readStatShard(version, locale)?.stats, statId);
  if (!text) return null;
  const translated = rejectUntranslated(text, statId, version, locale);
  return translated === null ? null : renderGenericTemplate(translated, locale);
}

/** 官方市集 stat 網域（`pseudo` / `implicit` / `crafted` 等）對應的顯示標籤 */
export function getOfficialStatDomainLabel(
  domain: string,
  version: PoeVersion,
  locale: SupportedAffixLocale | string,
): string | null {
  if (!domain) return null;
  const liveLabel = getUsableLiveTradeData(version, locale)?.statLabels?.domainLabels?.[domain];
  if (typeof liveLabel === 'string' && liveLabel.trim()) return liveLabel.trim();
  if (!isOfficialLocale(locale)) return null;
  return readStatShard(version, locale)?.labels[domain] ?? null;
}

const domainIndexByShard = new WeakMap<StatTexts, StatDomainIndex>();

/**
 * 同一個代碼後綴在市集上存在的網域前綴（依常用程度排序），用英文官方分片判斷。
 * 分片尚未載入時在背景載入並回傳空陣列，載入後讀取者會重新判斷。
 */
export function getOfficialStatDomains(statId: string, version: PoeVersion): string[] {
  if (!statId) return [];
  const shard = readStatShard(version, 'en');
  if (!shard) return [];
  let index = domainIndexByShard.get(shard.stats);
  if (!index) {
    index = buildStatDomainIndex(Object.keys(shard.stats));
    domainIndexByShard.set(shard.stats, index);
  }
  return statDomainsOf(index, statId);
}

/** pseudo 偽屬性不在詞綴字典內，改查官方 /data/stats 產生的翻譯（同篩選翻譯的順序） */
function translatePseudoStat(statId: string, version: PoeVersion): string | null {
  if (!statId.startsWith('pseudo.')) return null;
  for (const source of filterSources(version)) {
    const text = source.pseudoStats?.[statId];
    // 與詞綴字典一致：英文模板以小寫呈現
    if (text) return source.locale === 'en' ? text.toLowerCase() : text;
  }
  return null;
}

/**
 * 市集上的詞綴標籤（顯示語系）：官方市集寫法（正負向跟市集一致）→ 詞綴字典 → pseudo
 * → 傭兵詞綴（僅 PoE 1）→ 去掉網域前綴的 id。
 */
export function translateStat(statId: string, version: PoeVersion = 'poe1'): string {
  const translated =
    getOfficialStatLabel(statId, version, getActiveDisplayLocale()) ??
    translateAffixStat(statId, version) ??
    translatePseudoStat(statId, version) ??
    (version === 'poe1' ? translateMercenaryStat(statId) : null);
  if (translated) return translated;
  return statId.replace(/^[a-z_]+\./, '');
}

// ───────────────────────────── 篩選標籤 ─────────────────────────────

/** 去掉零寬空白之後的提示文字 */
const cleanFilterLabel = (text: string): string => text.split('​')[0].trim();

/** 篩選欄位 key（可帶群組前綴，例如 `trade_filters.price`）的顯示標籤；查不到時回傳欄位 key */
export function translateFilterKey(key: string, version: PoeVersion = 'poe1'): string {
  const fieldKey = key.split('.').pop() || key;
  for (const source of filterSources(version)) {
    const text = source.fields?.[fieldKey] || source.groups?.[fieldKey];
    if (text) return cleanFilterLabel(text);
  }
  return fieldKey;
}

/** 篩選群組的顯示標籤；查不到時回傳群組 key */
export function translateFilterGroup(groupKey: string, version: PoeVersion = 'poe1'): string {
  for (const source of filterSources(version)) {
    const text = source.groups?.[groupKey];
    if (text) return cleanFilterLabel(text);
  }
  return groupKey;
}

function lookupOptionInSource(
  source: TradeFiltersData,
  optionVal: string,
  optKey: string,
  fieldKey: string,
): string | null {
  const options = source.options;
  if (!options) return null;
  for (const group of [options[fieldKey], options.price, options.category]) {
    const text = group?.[optionVal] || group?.[optKey];
    if (text) return cleanFilterLabel(text);
  }
  for (const group of Object.values(options)) {
    if (isRecord(group) && typeof group[optionVal] === 'string' && group[optionVal]) {
      return cleanFilterLabel(group[optionVal] as string);
    }
  }
  return null;
}

/**
 * 篩選選項值的顯示標籤：篩選翻譯的 options（同篩選翻譯的順序）→ 物品分類與裝備型別表
 * → 原值。
 */
export function resolveFilterOptionLabel(
  optionVal: string,
  fieldKey: string,
  version: PoeVersion = 'poe1',
): string {
  const optKey = optionVal.toLowerCase();
  for (const source of filterSources(version)) {
    const hit = lookupOptionInSource(source, optionVal, optKey, fieldKey);
    if (hit) return hit;
  }

  const typeNames = version === 'poe2' ? typeNamesPoe2 : typeNamesPoe1;
  const officialMap = version === 'poe2' ? officialCategoryMapPoe2 : officialCategoryMapPoe1;
  if (officialMap[optKey] && typeNames[officialMap[optKey]]) return typeNames[officialMap[optKey]];
  const cleanTypeKey = optKey.replace(/^[a-z_]+\./, '');
  if (typeNames[cleanTypeKey]) return typeNames[cleanTypeKey];

  return optionVal;
}

// ───────────────────────────── 測試入口 ─────────────────────────────

export interface TradeLabelTestData {
  readonly version: PoeVersion;
  /** 指定語系的官方詞綴文字與網域標籤；null 清除該語系 */
  readonly officialStats?: Partial<
    Record<OfficialStatTextLocale, { stats: StatTexts; labels?: StatDomainLabels } | null>
  >;
  /** 排在所有來源之前的篩選翻譯；null 清除 */
  readonly filters?: TradeFiltersData | null;
  /** 頁面即時資料 */
  readonly pageLive?: LiveTradeDataSnapshot;
  /** 市集漢化快取；null 清除 */
  readonly marketLive?: LiveTradeDataSnapshot | null;
}

/** 測試用：放入指定版本的測試資料（只改有給的欄位） */
export function setTradeLabelTestData(data: TradeLabelTestData): void {
  const { version } = data;
  if (data.officialStats) {
    const state = getStatState(version);
    for (const [locale, shard] of Object.entries(data.officialStats) as [
      OfficialStatTextLocale,
      { stats: StatTexts; labels?: StatDomainLabels } | null,
    ][]) {
      if (shard)
        state.shards.set(locale, {
          stats: shard.stats,
          labels: shard.labels ?? {},
        });
      else state.shards.delete(locale);
    }
    statShardRevision.value += 1;
  }
  if (data.filters !== undefined) {
    getFilterState(version).testOverride = data.filters;
    filterShardRevision.value += 1;
  }
  if (data.pageLive) setLiveTradeData(version, data.pageLive);
  if (data.marketLive !== undefined) setMarketLiveTradeData(version, data.marketLive);
}

/** 測試用：清除所有分片、失敗紀錄、測試資料與即時資料 */
export function resetTradeLabelsForTests(): void {
  statStateByVersion.clear();
  filterStateByVersion.clear();
  statShardRevision.value += 1;
  filterShardRevision.value += 1;
  pageSnapshots.value = {};
  marketSnapshots.value = {};
}
