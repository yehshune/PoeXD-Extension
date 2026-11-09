import type { SupportedLocale } from './preferences-contract';
import { getLocaleItemsAssetPath, type PoeVersion } from './trade-context';
import {
  ensureAffixLexiconLoaded,
  setAffixLexiconMockData,
  translateAffixStat,
} from './affix-lexicon';
import { getActiveDisplayLocale, getActiveUiLocale } from './i18n';
import {
  describeShardMismatch,
  isShardCompatible,
  type ShardFingerprint,
} from './game-data-shard-compat';
import {
  officialCategoryMapPoe1,
  officialCategoryMapPoe2,
  typeNamesPoe1,
  typeNamesPoe2,
} from '@/components/sidebar/typeMaps';
import {
  ensureTradeFiltersLoaded,
  getTradeFiltersSources,
  setMockTradeFilters,
  type TradeFiltersData,
} from './trade-filters-store';

export interface LocaleItemsShard {
  /** 產生此檔的遊戲 patch；各語系 items 以索引對齊 */
  patch?: string;
  items: string[];
}

interface VersionItemState {
  shards: Map<SupportedLocale, string[]>;
  /** 已接受分片的指紋；以 en 為基準檢查其他語系是否來自同一次建置 */
  fingerprints: Map<SupportedLocale, ShardFingerprint>;
  shardPromises: Map<SupportedLocale, Promise<string[] | null>>;
  indexByLowerName: Map<string, number>;
  mockItemMap: Map<string, string> | null;
  mockItemReverseMap: Map<string, string> | null;
}

const itemStateByVersion = new Map<PoeVersion, VersionItemState>();

function getOrCreateItemState(version: PoeVersion): VersionItemState {
  let state = itemStateByVersion.get(version);
  if (!state) {
    state = {
      shards: new Map(),
      fingerprints: new Map(),
      shardPromises: new Map(),
      indexByLowerName: new Map(),
      mockItemMap: null,
      mockItemReverseMap: null,
    };
    itemStateByVersion.set(version, state);
  }
  return state;
}

function resolveAssetUrl(assetPath: string): string {
  const runtimeGetUrl = (globalThis as any).chrome?.runtime?.getURL;
  return typeof runtimeGetUrl === 'function' ? runtimeGetUrl(assetPath) : assetPath;
}

function indexItemShard(
  state: VersionItemState,
  locale: SupportedLocale,
  items: string[],
  patch?: string,
): void {
  state.shards.set(locale, items);
  state.fingerprints.set(locale, { patch, length: items.length });
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (typeof raw === 'string' && raw.trim()) {
      state.indexByLowerName.set(raw.trim().toLowerCase(), i);
    }
  }
}

/** 非 en 分片必須與 en 分片來自同一次建置，否則索引對照會錯位 */
function acceptItemShard(
  state: VersionItemState,
  locale: SupportedLocale,
  candidate: ShardFingerprint,
): boolean {
  const reference = state.fingerprints.get('en');
  if (locale === 'en' || !reference) return true;
  if (isShardCompatible(reference, candidate)) return true;
  console.warn(describeShardMismatch(`items.json (${locale})`, reference, candidate));
  return false;
}

export async function ensureItemShardLoaded(
  version: PoeVersion,
  locale: SupportedLocale,
): Promise<string[] | null> {
  const state = getOrCreateItemState(version);
  const existing = state.shards.get(locale);
  if (existing) return existing;

  const inflight = state.shardPromises.get(locale);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      // 先載入 en 作為相容性基準，也讓反查索引的寫入順序固定
      if (locale !== 'en') await ensureItemShardLoaded(version, 'en');
      const url = resolveAssetUrl(getLocaleItemsAssetPath(version, locale));
      const res = await fetch(url);
      if (!res || !res.ok) return null;
      const json = await res.json();
      const items: string[] | null = Array.isArray(json)
        ? json
        : json && Array.isArray(json.items)
          ? json.items
          : null;
      const patch: string | undefined =
        json && !Array.isArray(json) && typeof json.patch === 'string' ? json.patch : undefined;
      if (items) {
        if (!acceptItemShard(state, locale, { patch, length: items.length })) return null;
        indexItemShard(state, locale, items, patch);
        return items;
      }
      return null;
    } catch {
      return null;
    } finally {
      state.shardPromises.delete(locale);
    }
  })();

  state.shardPromises.set(locale, promise);
  return promise;
}

/**
 * 載入並解析統一詞綴字典 (mods-tiers.json + locales/{locale}/stats.json) 與 items.json 分片
 */
export async function loadTradeDictionaries(version: PoeVersion = 'poe1'): Promise<void> {
  const tasks: Promise<any>[] = [];

  // 1. 載入統一詞綴字典與當前顯示語系分片
  tasks.push(ensureAffixLexiconLoaded(version));

  // 2. 載入緊湊語系物品名稱分片 (locales/{locale}/items.json)
  const displayLocale = getActiveDisplayLocale();
  const requiredItemLocales = new Set<SupportedLocale>(['en', 'zh-TW', 'zh-CN', displayLocale]);
  for (const loc of requiredItemLocales) {
    tasks.push(ensureItemShardLoaded(version, loc));
  }

  // 3. 載入顯示語系與 UI 語系的市集篩選翻譯（locales/{locale}/trade-filters.json）
  for (const loc of new Set<SupportedLocale>([displayLocale, getActiveUiLocale()])) {
    tasks.push(ensureTradeFiltersLoaded(version, loc));
  }

  await Promise.all(tasks);
}

/**
 * 設定測試用物品名稱語系分片
 */
export function setMockItemShards(
  version: PoeVersion,
  shards: Partial<Record<SupportedLocale, LocaleItemsShard | string[]>> | null,
): void {
  const state = getOrCreateItemState(version);
  state.shards.clear();
  state.fingerprints.clear();
  state.shardPromises.clear();
  state.indexByLowerName.clear();
  state.mockItemMap = null;
  state.mockItemReverseMap = null;

  if (!shards) return;
  for (const [locale, shard] of Object.entries(shards)) {
    if (!shard) continue;
    const items = Array.isArray(shard) ? shard : shard.items;
    if (Array.isArray(items)) {
      indexItemShard(state, locale as SupportedLocale, items);
    }
  }
}

/**
 * 設定測試用資料快取
 */
export function setMockDictionaries(
  version: PoeVersion,
  mods: any,
  filters?: any,
  itemNames?: Map<string, string> | null,
) {
  if (mods) setAffixLexiconMockData(version, mods);
  if (filters !== undefined) setMockTradeFilters(version, filters as TradeFiltersData | null);
  if (itemNames === null) {
    const state = getOrCreateItemState(version);
    state.mockItemMap = null;
    state.mockItemReverseMap = null;
  } else if (itemNames instanceof Map) {
    const state = getOrCreateItemState(version);
    state.shards.clear();
    state.fingerprints.clear();
    state.indexByLowerName.clear();
    const normMap = new Map<string, string>();
    const revMap = new Map<string, string>();
    for (const [k, v] of itemNames.entries()) {
      const kLower = k.trim().toLowerCase();
      normMap.set(kLower, v);
      revMap.set(v.trim().toLowerCase(), k);
    }
    state.mockItemMap = normMap;
    state.mockItemReverseMap = revMap;
  }
}

/**
 * 取得指定版本已載入的 trade-filters 字典
 */
export function getLoadedFiltersData(version: PoeVersion = 'poe1'): TradeFiltersData {
  return getTradeFiltersSources(version)[0];
}

/**
 * 將過濾條件 Key 轉為當前 Display Locale 標籤（優先查 trade-filters 字典的 fields 與 groups）
 */
export function translateFilterKey(key: string, version: PoeVersion = 'poe1'): string {
  const parts = key.split('.');
  const fieldKey = parts.pop() || key;

  for (const filtersData of getTradeFiltersSources(version)) {
    if (filtersData?.fields?.[fieldKey]) {
      return filtersData.fields[fieldKey].split('\u200b')[0].trim();
    }
    if (filtersData?.groups?.[fieldKey]) {
      return filtersData.groups[fieldKey].split('\u200b')[0].trim();
    }
  }

  return fieldKey;
}

/**
 * 將過濾群組 Key 轉為當前 Display Locale 標籤（優先查 trade-filters 字典的 groups）
 */
export function translateFilterGroup(groupKey: string, version: PoeVersion = 'poe1'): string {
  for (const filtersData of getTradeFiltersSources(version)) {
    if (filtersData?.groups?.[groupKey]) {
      return filtersData.groups[groupKey].split('\u200b')[0].trim();
    }
  }

  return groupKey;
}

function cleanOptionText(text: string): string {
  if (!text) return '';
  return text.split('\u200b')[0].trim();
}

function lookupOptionInFiltersData(
  filtersData: TradeFiltersData | undefined,
  optionVal: string,
  optKey: string,
  fieldKey: string,
): string | null {
  if (!filtersData?.options) return null;
  if (filtersData.options[fieldKey]?.[optionVal] || filtersData.options[fieldKey]?.[optKey]) {
    return cleanOptionText(
      filtersData.options[fieldKey][optionVal] || filtersData.options[fieldKey][optKey],
    );
  }
  if (filtersData.options.price?.[optionVal] || filtersData.options.price?.[optKey]) {
    return cleanOptionText(
      filtersData.options.price[optionVal] || filtersData.options.price[optKey],
    );
  }
  if (filtersData.options.category?.[optionVal] || filtersData.options.category?.[optKey]) {
    return cleanOptionText(
      filtersData.options.category[optionVal] || filtersData.options.category[optKey],
    );
  }
  for (const optGroup of Object.values<any>(filtersData.options)) {
    if (optGroup && typeof optGroup === 'object' && optGroup[optionVal]) {
      return cleanOptionText(optGroup[optionVal]);
    }
  }
  return null;
}

/**
 * 查找選項文字在當前 Display Locale 的翻譯，利用 trade-filters 的 options 或 typeNames 表
 */
function resolveOptionLabel(
  optionVal: string,
  fieldKey: string,
  version: PoeVersion = 'poe1',
): string {
  const optKey = optionVal.toLowerCase();

  // 1. 從 trade-filters 的 options 中對照（顯示語系 → UI 語系 → 內建 en）
  for (const filtersData of getTradeFiltersSources(version)) {
    const hit = lookupOptionInFiltersData(filtersData, optionVal, optKey, fieldKey);
    if (hit) return hit;
  }

  // 2. 從既有的 typeNamesPoe1 / typeNamesPoe2 與 officialCategoryMap 中查找（物品分類與裝備型別）
  const typeNames = version === 'poe2' ? typeNamesPoe2 : typeNamesPoe1;
  const officialMap = version === 'poe2' ? officialCategoryMapPoe2 : officialCategoryMapPoe1;
  if (officialMap[optKey] && typeNames[officialMap[optKey]]) {
    return typeNames[officialMap[optKey]];
  }
  const cleanTypeKey = optKey.replace(/^[a-z_]+\./, '');
  if (typeNames[cleanTypeKey]) {
    return typeNames[cleanTypeKey];
  }

  return optionVal;
}

/**
 * 提取過濾條件中 option 的實質值與停用狀態。
 * 支援一般純量值 (string, number, boolean) 以及多層巢狀結構 (例如 { option: '20', disabled: false })。
 */
export function extractFilterOptionValue(rawOption: any): { value: any; disabled: boolean } | null {
  if (rawOption === undefined || rawOption === null) return null;
  if (typeof rawOption === 'object') {
    if (rawOption.disabled === true) {
      return { value: undefined, disabled: true };
    }
    const inner = rawOption.option;
    if (typeof inner === 'object' && inner !== null) {
      return extractFilterOptionValue(inner);
    }
    return { value: inner !== undefined ? inner : rawOption, disabled: false };
  }
  return { value: rawOption, disabled: false };
}

/**
 * 人性化格式化過濾數值，消除 raw JSON 並依當前 Display Locale 輸出
 */
export function formatFilterValue(
  val: any,
  fieldKey: string = '',
  version: PoeVersion = 'poe1',
): string {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'object') {
    return resolveOptionLabel(String(val), fieldKey, version);
  }

  if (Array.isArray(val)) {
    return val.map((item) => formatFilterValue(item, fieldKey, version)).join(', ');
  }

  const extracted = extractFilterOptionValue(val.option);
  const optVal = extracted && !extracted.disabled ? extracted.value : undefined;

  // 布林判定 (依當前 UI 語系輸出 是/否 或 Yes/No)
  const isEn = getActiveUiLocale() === 'en';
  if (optVal === 'true' || optVal === true) return isEn ? 'Yes' : '是';
  if (optVal === 'false' || optVal === false) return isEn ? 'No' : '否';

  const parts: string[] = [];
  if (val.min !== undefined && val.min !== null && val.max !== undefined && val.max !== null) {
    parts.push(`${val.min} ~ ${val.max}`);
  } else if (val.min !== undefined && val.min !== null) {
    parts.push(`≥ ${val.min}`);
  } else if (val.max !== undefined && val.max !== null) {
    parts.push(`≤ ${val.max}`);
  }

  if (optVal !== undefined && optVal !== null && optVal !== '') {
    const optStr = String(optVal);
    parts.push(resolveOptionLabel(optStr, fieldKey, version));
  }

  return parts.length > 0 ? parts.join(' ') : '';
}

/**
 * 同步查詢已快取的詞綴說明，找不到則降級去除 prefix
 */
/** 字典中混合詞綴（一條詞綴含多行效果）各行之間的分隔字串。 */
export const HYBRID_STAT_SEPARATOR = '|||||';

/** 翻譯詞綴並把混合詞綴拆成多行，供顯示使用。 */
export function translateStatLines(statId: string, version: PoeVersion = 'poe1'): string[] {
  const lines = translateStat(statId, version)
    .split(HYBRID_STAT_SEPARATOR)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines : [statId];
}

export function translateStat(statId: string, version: PoeVersion = 'poe1'): string {
  const translated = translateAffixStat(statId, version) ?? translatePseudoStat(statId, version);
  if (translated) return translated;
  return statId.replace(/^[a-z_]+\./, '');
}

/** pseudo 偽屬性不在詞綴字典內，改查官方 /data/stats 產生的翻譯（顯示語系 → UI 語系 → en） */
function translatePseudoStat(statId: string, version: PoeVersion): string | null {
  if (!statId.startsWith('pseudo.')) return null;
  for (const source of getTradeFiltersSources(version)) {
    const text = source.pseudoStats?.[statId];
    // 與詞綴字典一致：英文模板以小寫呈現
    if (text) return source.locale === 'en' ? text.toLowerCase() : text;
  }
  return null;
}

/**
 * 依據語系物品名稱分片 (locales/{locale}/items.json) 將物品名稱 / 基底類型轉換為當前 Display Locale
 */
export function translateItemName(name: string, version: PoeVersion = 'poe1'): string {
  if (!name) return '';
  const state = getOrCreateItemState(version);
  const key = name.trim().toLowerCase();
  const displayLocale = getActiveDisplayLocale();
  const uiLocale = getActiveUiLocale();

  const shardIdx = state.indexByLowerName.get(key);
  if (shardIdx !== undefined) {
    const targetShard =
      state.shards.get(displayLocale) ?? state.shards.get(uiLocale) ?? state.shards.get('en');
    const resolved = targetShard?.[shardIdx];
    if (resolved) return resolved;
  }

  if (state.mockItemMap) {
    if (uiLocale === 'en') {
      if (state.mockItemReverseMap?.has(key)) {
        return state.mockItemReverseMap.get(key)!;
      }
      return name;
    }
    if (state.mockItemMap.has(key)) {
      return state.mockItemMap.get(key)!;
    }
  }

  // 嘗試比對是否為分類 (category)
  const catLabel = resolveOptionLabel(name, 'category', version);
  if (catLabel !== name) {
    return catLabel;
  }

  return name;
}
