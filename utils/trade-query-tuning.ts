import { withStatDomain } from './stat-domain-order';
import { normalizeStatFilter, type CriteriaOverlayStatFilter } from './criteria-overlay';
import { withTradeSearchId } from './trade-search-identity';
import { encodeQueryToGzipBase64Url } from './trade-url-codec';

const EDITABLE_GROUP_TYPES = new Set(['count', 'weight', 'weight2']);
/** 市集詞綴群組的類別（且、非、若、計數、加權總和） */
export const STAT_GROUP_TYPES = ['and', 'not', 'if', 'count', 'weight', 'weight2'] as const;
export type StatGroupType = (typeof STAT_GROUP_TYPES)[number];
export const isStatGroupType = (value: string): value is StatGroupType =>
  (STAT_GROUP_TYPES as readonly string[]).includes(value);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深拷貝一個 Trade query payload；不是物件時回傳 null。 */
export function cloneTradeQuery(payload: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(payload)) return null;
  try {
    return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 取得真正的 query 物件（支援直接是 query，或包在 `{ query, sort }` 裡）。 */
function getQueryRoot(payload: Record<string, unknown>): Record<string, unknown> {
  return isPlainRecord(payload.query) ? payload.query : payload;
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalValue(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function areTradeQueriesEqual(left: unknown, right: unknown): boolean {
  return canonicalValue(left) === canonicalValue(right);
}

export function isGroupValueEditable(groupType: string): boolean {
  return EDITABLE_GROUP_TYPES.has(groupType);
}

export function isNumericStatFilter(filter: Pick<CriteriaOverlayStatFilter, 'value'>): boolean {
  return filter.value?.option === undefined;
}

/** 將微調後的查詢重新編碼寫入搜尋網址；無修改時直接回傳原網址，編碼失敗則回傳 null。 */
export async function resolveTunedTradeSearchUrl(
  baseUrl: string,
  modifiedQuery: Record<string, unknown> | null,
): Promise<string | null> {
  if (!modifiedQuery) return baseUrl;
  try {
    const code = await encodeQueryToGzipBase64Url(modifiedQuery);
    return withTradeSearchId(baseUrl, code) ?? baseUrl;
  } catch {
    return null;
  }
}

/** 對齊 `criteriaFromTradeQuery` 略過無效／空群組後的索引，找出在 `root.stats` 裡的實際群組。 */
function findVisibleGroup(
  root: Record<string, unknown>,
  visibleGroupIndex: number,
): Record<string, unknown> | null {
  if (!Array.isArray(root.stats)) return null;
  let seen = 0;
  for (const raw of root.stats) {
    if (!isPlainRecord(raw) || typeof raw.type !== 'string' || raw.type === '') continue;
    const rawFilters = Array.isArray(raw.filters) ? raw.filters : [];
    const hasValidFilter = rawFilters.some((f) => normalizeStatFilter(f) !== undefined);
    if (!hasValidFilter) continue;
    if (seen === visibleGroupIndex) return raw;
    seen++;
  }
  return null;
}

/** 找出可見群組裡第 `visibleFilterIndex` 個有效詞綴物件。 */
function findVisibleFilter(
  group: Record<string, unknown>,
  visibleFilterIndex: number,
): Record<string, unknown> | null {
  if (!Array.isArray(group.filters)) return null;
  let seen = 0;
  for (const raw of group.filters) {
    if (!isPlainRecord(raw) || normalizeStatFilter(raw) === undefined) continue;
    if (seen === visibleFilterIndex) return raw;
    seen++;
  }
  return null;
}

function mutateQuery(
  payload: Record<string, unknown>,
  mutator: (root: Record<string, unknown>) => void,
): Record<string, unknown> {
  const cloned = cloneTradeQuery(payload) ?? {};
  mutator(getQueryRoot(cloned));
  return cloned;
}

function applyBound(
  holder: Record<string, unknown>,
  bound: 'min' | 'max',
  value: number | null,
): void {
  const current = isPlainRecord(holder.value) ? { ...holder.value } : {};
  if (value === null || !Number.isFinite(value)) {
    delete current[bound];
  } else {
    current[bound] = value;
  }
  if (Object.keys(current).length === 0) {
    delete holder.value;
  } else {
    holder.value = current;
  }
}

export function setTradeQueryStatus(
  payload: Record<string, unknown>,
  statusOption: string,
): Record<string, unknown> {
  return mutateQuery(payload, (root) => {
    root.status = { option: statusOption };
  });
}

export function setTradeStatGroupDisabled(
  payload: Record<string, unknown>,
  visibleGroupIndex: number,
  disabled: boolean,
): Record<string, unknown> {
  return mutateQuery(payload, (root) => {
    const group = findVisibleGroup(root, visibleGroupIndex);
    if (!group) return;
    if (disabled) group.disabled = true;
    else delete group.disabled;
  });
}

/**
 * 改變詞綴群組的類別。換成沒有數值的類別（且、非、若）時清掉群組數值；換成計數且沒有下限時
 * 帶入下限 1（計數沒有下限等於不限制）。不認得的類別不更動。
 */
export function setTradeStatGroupType(
  payload: Record<string, unknown>,
  visibleGroupIndex: number,
  type: StatGroupType,
): Record<string, unknown> {
  if (!isStatGroupType(type)) return cloneTradeQuery(payload) ?? {};
  return mutateQuery(payload, (root) => {
    const group = findVisibleGroup(root, visibleGroupIndex);
    if (!group || group.type === type) return;
    group.type = type;
    if (!EDITABLE_GROUP_TYPES.has(type)) {
      delete group.value;
      return;
    }
    const value = isPlainRecord(group.value) ? group.value : {};
    if (type === 'count' && typeof value.min !== 'number') group.value = { ...value, min: 1 };
  });
}

export function setTradeStatGroupBound(
  payload: Record<string, unknown>,
  visibleGroupIndex: number,
  bound: 'min' | 'max',
  value: number | null,
): Record<string, unknown> {
  return mutateQuery(payload, (root) => {
    const group = findVisibleGroup(root, visibleGroupIndex);
    if (!group) return;
    applyBound(group, bound, value);
  });
}

export function setTradeStatFilterDisabled(
  payload: Record<string, unknown>,
  visibleGroupIndex: number,
  visibleFilterIndex: number,
  disabled: boolean,
): Record<string, unknown> {
  return mutateQuery(payload, (root) => {
    const group = findVisibleGroup(root, visibleGroupIndex);
    const filter = group ? findVisibleFilter(group, visibleFilterIndex) : null;
    if (!filter) return;
    if (disabled) filter.disabled = true;
    else delete filter.disabled;
  });
}

/**
 * 換掉單一詞綴條件代碼的網域前綴（`explicit.stat_1` → `fractured.stat_1`）。
 * 只接受同一個後綴在市集上存在的前綴（由 `allowed` 提供），其他值不更動。
 */
export function setTradeStatFilterDomain(
  payload: Record<string, unknown>,
  visibleGroupIndex: number,
  visibleFilterIndex: number,
  domain: string,
  allowed: readonly string[],
): Record<string, unknown> {
  return mutateQuery(payload, (root) => {
    const group = findVisibleGroup(root, visibleGroupIndex);
    const filter = group ? findVisibleFilter(group, visibleFilterIndex) : null;
    if (!filter || typeof filter.id !== 'string' || !allowed.includes(domain)) return;
    filter.id = withStatDomain(filter.id, domain);
  });
}

export function setTradeStatFilterBound(
  payload: Record<string, unknown>,
  visibleGroupIndex: number,
  visibleFilterIndex: number,
  bound: 'min' | 'max',
  value: number | null,
): Record<string, unknown> {
  return mutateQuery(payload, (root) => {
    const group = findVisibleGroup(root, visibleGroupIndex);
    const filter = group ? findVisibleFilter(group, visibleFilterIndex) : null;
    if (!filter) return;
    applyBound(filter, bound, value);
  });
}
