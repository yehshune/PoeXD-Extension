/**
 * 內部實作：PoB 單筆搜尋調整（`EntrySearchSelection`）的草稿複製、正規化、比對與批次上下限調整。
 */
import { statDomainOf } from '../stat-domain-order';
import {
  effectiveCountMin,
  effectiveGemFilters,
  effectiveLinks,
  effectivePseudo,
  effectiveSearchBy,
  entryStatFilters,
  finiteOrUndefined,
  validDomain,
} from './resolve';
import {
  RARE_SEARCH_MODES,
  type BuildSearchDefaults,
  type EntrySearchSelection,
  type EntrySearchTarget,
  type SelectionRowSnapshot,
  type ShoppingStatFilter,
  type StatSelection,
} from './types';

/** 深拷貝使用者的項目搜尋調整草稿，避免改動到已儲存的狀態。 */
export function cloneEntrySearchSelection(selection?: EntrySearchSelection): EntrySearchSelection {
  if (!selection) return {};
  const stats = selection.stats
    ? Object.fromEntries(
        Object.entries(selection.stats).map(([id, value]) => [id, { ...value }] as const),
      )
    : undefined;
  return {
    ...(stats && Object.keys(stats).length > 0 ? { stats } : {}),
    ...(selection.countMin !== undefined ? { countMin: selection.countMin } : {}),
    ...(typeof selection.pseudo === 'boolean' ? { pseudo: selection.pseudo } : {}),
    ...('links' in selection ? { links: selection.links ?? null } : {}),
    ...(selection.searchBy ? { searchBy: selection.searchBy } : {}),
    ...('gemLevel' in selection ? { gemLevel: selection.gemLevel ?? null } : {}),
    ...('gemQuality' in selection ? { gemQuality: selection.gemQuality ?? null } : {}),
    ...('gemSockets' in selection ? { gemSockets: selection.gemSockets ?? null } : {}),
  };
}

/** 從購物列目前狀態建立可編輯草稿（優先採用已儲存的 searchSelection，缺乏時由 filters 推導）。 */
export function selectionFromRowState(
  row: SelectionRowSnapshot,
  searchDefaults?: BuildSearchDefaults,
): EntrySearchSelection {
  if (row.searchSelection) return cloneEntrySearchSelection(row.searchSelection);
  const defaults = entryStatFilters(row, undefined, searchDefaults);
  const stats: Record<string, StatSelection> = {};
  row.filters?.forEach((filter, index) => {
    const base = defaults[index];
    if (!base) return;
    const change: StatSelection = {};
    if (filter.enabled !== base.enabled) change.enabled = filter.enabled;
    if (filter.id !== base.id) change.domain = statDomainOf(filter.id);
    if (filter.min !== base.min) change.min = filter.min ?? null;
    if (filter.max !== base.max) change.max = filter.max ?? null;
    if (Object.keys(change).length > 0) stats[base.key] = change;
  });
  const defaultLinks = effectiveLinks(row, undefined, searchDefaults);
  const defaultSearchBy = effectiveSearchBy(row, undefined, searchDefaults);
  const defaultGem = row.kind === 'gem' ? effectiveGemFilters(row) : undefined;
  return {
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(row.countMin !== undefined ? { countMin: row.countMin } : {}),
    ...(Boolean(row.pseudo) !== effectivePseudo(row, undefined, searchDefaults)
      ? { pseudo: Boolean(row.pseudo) }
      : {}),
    ...((row.links !== undefined || row.linksMin !== undefined) && row.linksMin !== defaultLinks
      ? { links: row.linksMin ?? null }
      : {}),
    ...(row.searchBy && row.searchBy !== defaultSearchBy ? { searchBy: row.searchBy } : {}),
    ...(defaultGem && row.gemLevelMin !== defaultGem.level
      ? { gemLevel: row.gemLevelMin ?? null }
      : {}),
    ...(defaultGem && row.gemQualityMin !== defaultGem.quality
      ? { gemQuality: row.gemQualityMin ?? null }
      : {}),
    ...(defaultGem && row.gemSocketsMin !== defaultGem.sockets
      ? { gemSockets: row.gemSocketsMin ?? null }
      : {}),
  };
}

/** 寶石的等級／品質調整：和 PoB 的數值相同時不算自訂 */
function gemSelectionChanges(
  entry: Pick<EntrySearchTarget, 'kind' | 'level' | 'quality' | 'gemSockets'>,
  selection: EntrySearchSelection,
): Pick<EntrySearchSelection, 'gemLevel' | 'gemQuality' | 'gemSockets'> {
  if (entry.kind !== 'gem') return {};
  const pob = effectiveGemFilters(entry);
  const chosen = effectiveGemFilters(entry, selection);
  return {
    ...('gemLevel' in selection && chosen.level !== pob.level
      ? { gemLevel: chosen.level ?? null }
      : {}),
    ...('gemQuality' in selection && chosen.quality !== pob.quality
      ? { gemQuality: chosen.quality ?? null }
      : {}),
    ...('gemSockets' in selection && chosen.sockets !== pob.sockets
      ? { gemSockets: chosen.sockets ?? null }
      : {}),
  };
}

/** 僅保留相對於預設值（PoB 加上 build 整體設定）有差異的欄位；全部回到預設時回傳 undefined。 */
export function normalizeSelectionForEntry(
  entry: Pick<
    EntrySearchTarget,
    | 'mods'
    | 'visceraBundle'
    | 'visceraPart'
    | 'links'
    | 'category'
    | 'kind'
    | 'level'
    | 'quality'
    | 'gemSockets'
  >,
  selection: EntrySearchSelection | undefined,
  searchDefaults?: BuildSearchDefaults,
): EntrySearchSelection | undefined {
  if (!selection) return undefined;
  const defaults = new Map(
    entryStatFilters(entry, undefined, searchDefaults).map((filter) => [filter.key, filter]),
  );
  const stats: Record<string, StatSelection> = {};
  for (const [id, custom] of Object.entries(selection.stats ?? {})) {
    const base = defaults.get(id);
    if (!base) continue;
    const change: StatSelection = {};
    if (custom.enabled !== undefined && custom.enabled !== base.enabled) {
      change.enabled = custom.enabled;
    }
    const domain = validDomain({ id: base.key, domains: base.domains }, custom.domain);
    if (domain) change.domain = domain;
    if ('min' in custom) {
      const nextMin = finiteOrUndefined(custom.min);
      if (nextMin !== base.min) change.min = nextMin ?? null;
    }
    if ('max' in custom) {
      const nextMax = finiteOrUndefined(custom.max);
      if (nextMax !== base.max) change.max = nextMax ?? null;
    }
    if (Object.keys(change).length > 0) stats[id] = change;
  }
  const normalized: EntrySearchSelection = {
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(selection.countMin !== undefined &&
    Number.isInteger(selection.countMin) &&
    selection.countMin >= 1 &&
    selection.countMin !== effectiveCountMin(entry)
      ? { countMin: selection.countMin }
      : {}),
    ...(typeof selection.pseudo === 'boolean' &&
    selection.pseudo !== effectivePseudo(entry, undefined, searchDefaults)
      ? { pseudo: selection.pseudo }
      : {}),
    ...('links' in selection &&
    effectiveLinks(entry, selection, searchDefaults) !==
      effectiveLinks(entry, undefined, searchDefaults)
      ? { links: selection.links ?? null }
      : {}),
    ...(selection.searchBy &&
    RARE_SEARCH_MODES.includes(selection.searchBy) &&
    effectiveSearchBy(entry, selection, searchDefaults) !==
      effectiveSearchBy(entry, undefined, searchDefaults)
      ? { searchBy: selection.searchBy }
      : {}),
    ...gemSelectionChanges(entry, selection),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

type DraftSnapshot = Pick<
  SelectionRowSnapshot,
  | 'filters'
  | 'countMin'
  | 'pseudo'
  | 'linksMin'
  | 'searchBy'
  | 'gemLevelMin'
  | 'gemQualityMin'
  | 'gemSocketsMin'
>;

/** 比較兩個搜尋條件快照，判斷暫存微調是否與已儲存狀態不同。 */
export function isSelectionDraftModified(saved: DraftSnapshot, draft: DraftSnapshot): boolean {
  if (saved.gemLevelMin !== draft.gemLevelMin) return true;
  if (saved.gemQualityMin !== draft.gemQualityMin) return true;
  if (saved.gemSocketsMin !== draft.gemSocketsMin) return true;
  if (Boolean(saved.pseudo) !== Boolean(draft.pseudo)) return true;
  if ((saved.searchBy ?? 'base') !== (draft.searchBy ?? 'base')) return true;
  if (saved.linksMin !== draft.linksMin) return true;
  if (saved.countMin !== draft.countMin) return true;
  const left = saved.filters ?? [];
  const right = draft.filters ?? [];
  if (left.length !== right.length) return true;
  return left.some((filter, index) => {
    const target = right[index];
    return (
      !target ||
      filter.id !== target.id ||
      filter.enabled !== target.enabled ||
      filter.min !== target.min ||
      filter.max !== target.max
    );
  });
}

/** 上下限鎖定為同一個精確值（如星團天賦數、插槽數、永恆珠寶種子碼）不應被「-10%」放寬 */
function isExactLockedBound(filter: { min?: number; max?: number }): boolean {
  return filter.min !== undefined && filter.max !== undefined && filter.min === filter.max;
}

/** 檢查是否至少有一個已啟用且帶數值上下限的詞綴條件 */
export function hasEnabledNumericBounds(filters: readonly ShoppingStatFilter[]): boolean {
  return filters.some(
    (filter) =>
      filter.enabled &&
      filter.value !== undefined &&
      (filter.min !== undefined || filter.max !== undefined),
  );
}

/** 檢查是否至少有一個可被「-10%」放寬的已啟用數值條件（排除精確鎖定） */
export function hasRelaxableNumericBounds(filters: readonly ShoppingStatFilter[]): boolean {
  return filters.some(
    (filter) =>
      filter.enabled &&
      filter.value !== undefined &&
      (filter.min !== undefined || filter.max !== undefined) &&
      !isExactLockedBound(filter),
  );
}

/** 將已啟用且非精確鎖定的數值上下限放寬 10%（正數下限降 10%、負數上限升 10% 等） */
export function relaxSelectionBounds(
  draft: EntrySearchSelection,
  filters: readonly ShoppingStatFilter[],
): EntrySearchSelection {
  const nextStats: Record<string, StatSelection> = { ...draft.stats };
  for (const filter of filters) {
    if (!filter.enabled || filter.value === undefined) continue;
    if (filter.min === undefined && filter.max === undefined) continue;
    if (isExactLockedBound(filter)) continue;
    const entry: StatSelection = { ...nextStats[filter.key] };
    if (filter.min !== undefined) {
      entry.min =
        filter.min > 0
          ? Math.floor(filter.min * 0.9)
          : filter.min < 0
            ? Math.floor(filter.min * 1.1)
            : 0;
    }
    if (filter.max !== undefined) {
      entry.max =
        filter.max < 0
          ? Math.ceil(filter.max * 0.9)
          : filter.max > 0
            ? Math.ceil(filter.max * 1.1)
            : 0;
    }
    nextStats[filter.key] = entry;
  }
  return { ...draft, stats: nextStats };
}

/** 清除所有已啟用數值條件的上下限（保留停用與選項型條件） */
export function clearSelectionBounds(
  draft: EntrySearchSelection,
  filters: readonly ShoppingStatFilter[],
): EntrySearchSelection {
  const nextStats: Record<string, StatSelection> = { ...draft.stats };
  for (const filter of filters) {
    if (!filter.enabled || filter.value === undefined) continue;
    if (filter.min === undefined && filter.max === undefined) continue;
    nextStats[filter.key] = { ...nextStats[filter.key], min: null, max: null };
  }
  return { ...draft, stats: nextStats };
}
