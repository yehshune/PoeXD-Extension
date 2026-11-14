/**
 * 即時市集資料（ADR-0014）：把官方市集頁面自己載入的資料轉成擴充使用的標籤。
 *
 * - `static_.propertyFilters` 等同 `/data/filters` 的 `result` → 與打包 `trade-filters.json` 相同的
 *   `groups` / `fields` / `options`（規則移植自 poexd-data `src/trade/trade-filter-api.ts`）。
 * - `static_.knownStats` 等同 `/data/stats` 的 `result` → 每個 id 第一次出現的市集寫法，與打包
 *   `trade-stats.json` 的取法一致（`knownStatsFlat` 在重複 id 取最後一筆，所以不用它）。
 *
 * 資料來自 MAIN world，視為不可信：形狀、型別、筆數或長度任一不符就整份回傳 null，不做部分採用，
 * 呼叫端退回打包資料。全部是純函式、不改動輸入；這支在頁面環境也會執行，不能依賴擴充 API。
 */
import type { TradeFiltersData } from './trade-filters-store';

/** 驗證上限：比官方資料（2026-11 PoE 1 約 12 群組、18,000 筆 stats）寬鬆數倍，只擋異常輸入 */
export const LIVE_TRADE_DATA_LIMITS = Object.freeze({
  maxFilterGroups: 64,
  maxFiltersPerGroup: 256,
  maxOptionsPerFilter: 2048,
  maxStatGroups: 64,
  maxStatEntries: 100_000,
  maxTextLength: 1024,
  /** 少於這個數量視為頁面資料不完整（同 poexd-data 的 MIN_FIELD_COUNT） */
  minFieldCount: 10,
});

/** filters API 以 `id: null` 表示預設選項；只有這些欄位的預設值在查詢 JSON 中有明確值 */
const NULL_OPTION_IDS: Readonly<Record<string, string>> = Object.freeze({ sale_type: 'priced' });

/** 篩選標籤；三個欄位一定存在（打包的 `TradeFiltersData` 都是選填） */
export type LiveTradeFilters = Required<Pick<TradeFiltersData, 'groups' | 'fields' | 'options'>>;

export interface LiveStatLabels {
  /** 完整 stat id → 第一次出現的市集寫法 */
  readonly stats: Readonly<Record<string, string>>;
  /** `pseudo` 群組的文字，格式同 `trade-filters.json` 的 `pseudoStats` */
  readonly pseudoStats: Readonly<Record<string, string>>;
}

/** 驗證失敗時中斷整份解析 */
class InvalidLiveData extends Error {}

const fail = (reason: string): never => {
  throw new InvalidLiveData(reason);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function requireArray(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value)) return fail(`${label} 不是陣列`);
  if (value.length > max) return fail(`${label} 超過 ${max} 筆`);
  return value;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > LIVE_TRADE_DATA_LIMITS.maxTextLength) {
    return fail(`${label} 缺少 id`);
  }
  return value;
}

/** 允許缺少文字（略過該筆），但出現時必須是長度合理的字串 */
function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(`${label} 文字不是字串`);
  if (value.length > LIVE_TRADE_DATA_LIMITS.maxTextLength) return fail(`${label} 文字過長`);
  return value;
}

/** 同 poexd-data trade-filter-api 的 cleanText：去掉零寬空白之後的提示、合併空白 */
const cleanFilterText = (text: string): string => text.split('​')[0].replace(/\s+/g, ' ').trim();

function assignUnique(target: Record<string, string>, key: string, value: string, label: string) {
  if (key in target && target[key] !== value) fail(`${label} 重複 id「${key}」且文字不同`);
  target[key] = value;
}

function collectOptions(filterId: string, option: unknown): Record<string, string> {
  if (option === undefined || option === null) return {};
  if (!isRecord(option)) return fail(`${filterId} 的 option 形狀不符`);
  if (option.options === undefined) return {};
  const entries = requireArray(
    option.options,
    LIVE_TRADE_DATA_LIMITS.maxOptionsPerFilter,
    `${filterId} 選項`,
  );
  const options: Record<string, string> = {};
  const nullTexts: string[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) return fail(`${filterId} 選項形狀不符`);
    const raw = optionalText(entry.text, `${filterId} 選項`);
    const text = raw === null ? '' : cleanFilterText(raw);
    if (!text) continue;
    const { id } = entry;
    if (id === null || id === undefined) nullTexts.push(text);
    else if (typeof id === 'string' || typeof id === 'number') {
      assignUnique(options, String(id), text, `${filterId} 選項`);
    } else return fail(`${filterId} 選項 id 型別不符`);
  }
  // 各網域的預設選項不一致（例如國服 PoE 1 的 null 是「任何」、priced 另有明確選項），
  // 只有在沒有明確選項時才把 null 對應到查詢值
  const nullId = NULL_OPTION_IDS[filterId];
  if (nullId && !(nullId in options) && nullTexts.length === 1) options[nullId] = nullTexts[0];
  return options;
}

function buildFilters(raw: unknown): LiveTradeFilters {
  const groupsRaw = requireArray(raw, LIVE_TRADE_DATA_LIMITS.maxFilterGroups, 'filters');
  const groups: Record<string, string> = {};
  const fields: Record<string, string> = {};
  const options: Record<string, Record<string, string>> = {};

  for (const group of groupsRaw) {
    if (!isRecord(group)) return fail('filters 群組形狀不符');
    const groupId = requireId(group.id, 'filters 群組');
    const title = optionalText(group.title, groupId);
    if (title && cleanFilterText(title)) {
      assignUnique(groups, groupId, cleanFilterText(title), '群組');
    }
    if (group.filters === undefined) continue;
    const filters = requireArray(
      group.filters,
      LIVE_TRADE_DATA_LIMITS.maxFiltersPerGroup,
      `${groupId} 欄位`,
    );
    for (const filter of filters) {
      if (!isRecord(filter)) return fail(`${groupId} 欄位形狀不符`);
      const filterId = requireId(filter.id, `${groupId} 欄位`);
      const text = optionalText(filter.text, filterId);
      if (text && cleanFilterText(text)) {
        assignUnique(fields, filterId, cleanFilterText(text), '欄位');
      }
      const filterOptions = collectOptions(filterId, filter.option);
      if (Object.keys(filterOptions).length > 0) options[filterId] = filterOptions;
    }
  }

  if (Object.keys(groups).length === 0) fail('filters 沒有任何群組標題');
  if (Object.keys(fields).length < LIVE_TRADE_DATA_LIMITS.minFieldCount) fail('filters 欄位過少');
  return { groups, fields, options };
}

function buildStatLabels(raw: unknown): LiveStatLabels {
  const groupsRaw = requireArray(raw, LIVE_TRADE_DATA_LIMITS.maxStatGroups, 'stats');
  const stats: Record<string, string> = {};
  const pseudoStats: Record<string, string> = {};
  let entryCount = 0;
  let hasPseudo = false;

  for (const group of groupsRaw) {
    if (!isRecord(group)) return fail('stats 群組形狀不符');
    const groupId = requireId(group.id, 'stats 群組');
    const entries = requireArray(
      group.entries,
      LIVE_TRADE_DATA_LIMITS.maxStatEntries,
      `${groupId} 條目`,
    );
    entryCount += entries.length;
    if (entryCount > LIVE_TRADE_DATA_LIMITS.maxStatEntries) fail('stats 條目過多');
    const isPseudo = groupId === 'pseudo';
    hasPseudo ||= isPseudo;

    for (const entry of entries) {
      if (!isRecord(entry)) return fail(`${groupId} 條目形狀不符`);
      const id = requireId(entry.id, `${groupId} 條目`);
      const raw = optionalText(entry.text, id);
      if (raw === null) continue;
      // 同 poexd-data market-translation-api 的 textOf：只去頭尾空白
      const text = raw.trim();
      if (!text) continue;
      if (!(id in stats)) stats[id] = text;
      if (isPseudo) assignUnique(pseudoStats, id, cleanFilterText(raw), 'pseudo stat');
    }
  }

  if (!hasPseudo) fail('stats 缺少 pseudo 群組');
  return { stats, pseudoStats };
}

/**
 * 頁面 `static_.propertyFilters`（＝`/data/filters` 的 `result`）→ 篩選標籤；
 * 任何不符回傳 null。
 */
export function parseLiveTradeFilters(raw: unknown): LiveTradeFilters | null {
  try {
    return buildFilters(raw);
  } catch (error) {
    if (error instanceof InvalidLiveData) return null;
    throw error;
  }
}

/**
 * 頁面 `static_.knownStats`（＝`/data/stats` 的 `result`）→ 市集寫法與 pseudo 文字；
 * 任何不符回傳 null。
 */
export function parseLiveStatLabels(raw: unknown): LiveStatLabels | null {
  try {
    return buildStatLabels(raw);
  } catch (error) {
    if (error instanceof InvalidLiveData) return null;
    throw error;
  }
}
