/**
 * 搜尋結果看板的統一投影介面（單一外部 seam）：
 * - 以同一套關鍵字與詞綴條件通道同時投影物品清單、賣家清單、詞綴選項與價格摘要
 * - 賣家清單一律保留已售出結果（不受 `hideSold` 影響），維持賣掉一件時卡片不突然消失的穩定性
 * - 展開賣家卡片時按需計算倉庫分頁分組與價格排序
 */
import { convertPrice, type CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from './board-entry';
import {
  BOARD_MOD_QUICK_FILTERS,
  BOARD_MOD_TIER_CAPS,
  aggregateBoardModOptions,
  filterModOptions,
  matchesModConditions,
  type BoardModAffixKind,
  type BoardModCondition,
  type BoardModOption,
  type BoardModQuickFilter,
  type BoardModRoll,
  type BoardModTierCap,
} from './board-mods';
import {
  availableSortModes,
  filterEntries,
  matchesBoardEntry,
  parseSearchTokens,
  sortEntries,
  type BoardSortMode,
} from './board-query';
import {
  aggregateSellers,
  filterSellers,
  groupSellerEntriesByStash,
  sortSellers,
  sumPrices,
  type PriceRange,
  type PriceTotal,
  type SellerStashGroup,
  type SellerSummary,
} from './board-sellers';
import type { BoardMark } from './board-session';

export {
  BOARD_MOD_QUICK_FILTERS,
  BOARD_MOD_TIER_CAPS,
  availableSortModes,
  sumPrices,
  type BoardModAffixKind,
  type BoardModCondition,
  type BoardModOption,
  type BoardModQuickFilter,
  type BoardModRoll,
  type BoardModTierCap,
  type BoardSortMode,
  type PriceRange,
  type PriceTotal,
  type SellerStashGroup,
  type SellerSummary,
};

export type BoardView = 'items' | 'sellers';

export interface PriceSummary {
  /** 匯率快照的主通貨 */
  currency: string;
  min: number;
  median: number;
  /** 參與計算（能換算）的件數 */
  count: number;
}

export interface BoardViewProjectionInput {
  entries: readonly BoardEntry[];
  marks: Readonly<Record<string, BoardMark>>;
  hiddenAccounts: ReadonlySet<string>;
  view: BoardView;
  sortMode: BoardSortMode;
  instantOnly: boolean;
  hideSold: boolean;
  keyword: string;
  priceMin?: number;
  priceMax?: number;
  minSellerCount: number;
  modConditions: readonly BoardModCondition[];
  modPickerQuery: string;
  modQuickFilter: BoardModQuickFilter;
  rates: CurrencyRateSnapshot | undefined;
  extraSearchLines?: (entry: BoardEntry) => readonly string[];
  resolveStatLabel: (hash: string) => string;
}

export interface BoardViewProjection {
  soldIds: ReadonlySet<string>;
  hasSoldEntries: boolean;
  hasMixedInstantBuyout: boolean;
  conversionAvailable: boolean;
  sortModes: readonly BoardSortMode[];
  filteredEntries: readonly BoardEntry[];
  sellers: readonly SellerSummary[];
  modOptions: readonly BoardModOption[];
  filteredModOptions: readonly BoardModOption[];
  modOptionByKey: ReadonlyMap<string, BoardModOption>;
  priceSummary: PriceSummary | undefined;
  hasActiveFilters: boolean;
  matchedIds: ReadonlySet<string>;
}

/** 看板頂端的價格摘要：已取得結果中的最低價與中位數（僅能換算的服） */
function summarizePrices(
  entries: readonly BoardEntry[],
  rates: CurrencyRateSnapshot | undefined,
): PriceSummary | undefined {
  if (!rates) return undefined;
  const values = entries
    .map((entry) => convertPrice(entry.price, rates))
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return { currency: rates.primary, min: values[0], median, count: values.length };
}

function detectMixedInstantBuyout(entries: readonly BoardEntry[]): boolean {
  let hasInstant = false;
  let hasWhisperOnly = false;
  for (const entry of entries) {
    if (entry.instantBuyout) hasInstant = true;
    else hasWhisperOnly = true;
    if (hasInstant && hasWhisperOnly) return true;
  }
  return false;
}

/**
 * 一次計算看板所有衍生檢視狀態：
 * - 物品清單與賣家清單共用同一套關鍵字與詞綴條件過濾邏輯
 * - 賣家清單永遠從完整 `entries` 出發（保留已售出結果），不套用 `hideSold`／價格區間／`instantOnly`
 */
export function projectBoardView(input: BoardViewProjectionInput): BoardViewProjection {
  const {
    entries,
    marks,
    hiddenAccounts,
    view,
    sortMode,
    instantOnly,
    hideSold,
    keyword,
    priceMin,
    priceMax,
    minSellerCount,
    modConditions,
    modPickerQuery,
    modQuickFilter,
    rates,
    extraSearchLines,
    resolveStatLabel,
  } = input;

  const soldIds = new Set<string>();
  for (const [id, mark] of Object.entries(marks)) {
    if (mark === 'sold') soldIds.add(id);
  }
  const hasSoldEntries = soldIds.size > 0;
  const hasMixedInstantBuyout = detectMixedInstantBuyout(entries);
  const conversionAvailable = rates !== undefined;
  const sortModes = availableSortModes(conversionAvailable);

  const visibleEntries =
    hasSoldEntries && hideSold ? entries.filter((entry) => !soldIds.has(entry.id)) : entries;

  const tokens = parseSearchTokens(keyword);
  const hasTokens = tokens.include.length > 0 || tokens.exclude.length > 0;
  const hasMods = modConditions.length > 0;

  // 物品清單：先套用 hideSold，再經由共同關鍵字／詞綴條件與物品清單專屬條件
  const filteredEntries = sortEntries(
    filterEntries(
      visibleEntries,
      {
        instantBuyoutOnly: hasMixedInstantBuyout && instantOnly,
        keyword,
        hiddenAccounts,
        priceMin,
        priceMax,
        extraSearchLines,
        modConditions,
      },
      rates,
    ),
    sortMode,
    rates,
  );

  // 賣家清單：一律保留已售出結果，只套用共同關鍵字與詞綴條件，再做賣家聚合與門檻篩選
  const sellerSourceEntries =
    hasTokens || hasMods
      ? entries.filter(
          (entry) =>
            (!hasTokens || matchesBoardEntry(entry, tokens, extraSearchLines?.(entry))) &&
            matchesModConditions(entry, modConditions),
        )
      : entries;

  const sellers = filterSellers(sortSellers(aggregateSellers(sellerSourceEntries, rates, soldIds)), {
    minInstantBuyout: minSellerCount,
    hiddenAccounts,
  });

  const modOptions = aggregateBoardModOptions(visibleEntries, resolveStatLabel, modConditions);
  const selectedModKeys = new Set(modConditions.map((cond) => cond.key));
  const filteredModOptions = filterModOptions(
    modOptions,
    modPickerQuery,
    modQuickFilter,
    selectedModKeys,
  );
  const modOptionByKey = new Map<string, BoardModOption>();
  for (const option of modOptions) modOptionByKey.set(option.key, option);

  const priceSummary = summarizePrices(entries, rates);

  const commonFiltersActive =
    hasMods || keyword.trim().length > 0 || hiddenAccounts.size > 0;
  const hasActiveFilters =
    view === 'sellers'
      ? commonFiltersActive || minSellerCount > 0
      : commonFiltersActive ||
        (conversionAvailable && (priceMin !== undefined || priceMax !== undefined)) ||
        (hasMixedInstantBuyout && instantOnly) ||
        (hasSoldEntries && hideSold);

  const matchedIds = new Set(
    view === 'items'
      ? filteredEntries.map((entry) => entry.id)
      : sellers.flatMap((seller) => seller.entries.map((entry) => entry.id)),
  );

  return {
    soldIds,
    hasSoldEntries,
    hasMixedInstantBuyout,
    conversionAvailable,
    sortModes,
    filteredEntries,
    sellers,
    modOptions,
    filteredModOptions,
    modOptionByKey,
    priceSummary,
    hasActiveFilters,
    matchedIds,
  };
}

/** 展開賣家卡片時按需依價格由低到高（無匯率維持官方順序）排序並依倉庫分頁分區，已售出沉底 */
export function projectSellerStashGroups(
  seller: SellerSummary,
  rates: CurrencyRateSnapshot | undefined,
  soldIds: ReadonlySet<string>,
): SellerStashGroup[] {
  const ordered = sortEntries(seller.entries, rates ? 'price-asc' : 'official', rates);
  return groupSellerEntriesByStash(ordered, soldIds);
}
