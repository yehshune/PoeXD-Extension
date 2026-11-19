/**
 * 看板物品清單的篩選與排序。只在側邊欄內作用，不改動官方結果列。
 *
 * 價格排序與價格篩選需要匯率；沒有匯率時不提供價格排序，價格區間也不套用。
 */
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from './board-entry';
import { convertPrice } from './board-price';

export type BoardSortMode =
  | 'official'
  | 'price-asc'
  | 'price-desc'
  | 'indexed-desc'
  | 'seller-count-desc';

export interface EntryFilter {
  instantBuyoutOnly: boolean;
  keyword: string;
  hiddenAccounts: ReadonlySet<string>;
  /** 以匯率快照的主通貨計，只在有匯率時套用 */
  priceMin?: number;
  priceMax?: number;
}

export function availableSortModes(conversionAvailable: boolean): BoardSortMode[] {
  return conversionAvailable
    ? ['official', 'price-asc', 'price-desc', 'indexed-desc', 'seller-count-desc']
    : ['official', 'indexed-desc', 'seller-count-desc'];
}

const byOrder = (a: BoardEntry, b: BoardEntry): number => a.order - b.order;

/** 有值的依 compare 排，沒有值的一律排在最後並維持官方順序 */
function sortByOptional(
  entries: readonly BoardEntry[],
  value: (entry: BoardEntry) => number | undefined,
  direction: 1 | -1,
): BoardEntry[] {
  return [...entries].sort((a, b) => {
    const valueA = value(a);
    const valueB = value(b);
    if (valueA === undefined || valueB === undefined) {
      if (valueA !== valueB) return valueA === undefined ? 1 : -1;
      return byOrder(a, b);
    }
    return valueA === valueB ? byOrder(a, b) : (valueA - valueB) * direction;
  });
}

function sortBySellerCount(entries: readonly BoardEntry[]): BoardEntry[] {
  const counts = new Map<string, number>();
  const firstOrder = new Map<string, number>();
  for (const entry of entries) {
    const { account } = entry.seller;
    counts.set(account, (counts.get(account) ?? 0) + 1);
    firstOrder.set(account, Math.min(firstOrder.get(account) ?? Infinity, entry.order));
  }
  const countOf = (entry: BoardEntry) => counts.get(entry.seller.account) ?? 0;
  const firstOf = (entry: BoardEntry) => firstOrder.get(entry.seller.account) ?? 0;
  return [...entries].sort(
    (a, b) => countOf(b) - countOf(a) || firstOf(a) - firstOf(b) || byOrder(a, b),
  );
}

export function sortEntries(
  entries: readonly BoardEntry[],
  mode: BoardSortMode,
  rates: CurrencyRateSnapshot | undefined,
): BoardEntry[] {
  const converted = (entry: BoardEntry) => convertPrice(entry.price, rates);
  switch (mode) {
    case 'price-asc':
      return rates ? sortByOptional(entries, converted, 1) : [...entries].sort(byOrder);
    case 'price-desc':
      return rates ? sortByOptional(entries, converted, -1) : [...entries].sort(byOrder);
    case 'indexed-desc':
      return sortByOptional(entries, (entry) => entry.indexedAt, -1);
    case 'seller-count-desc':
      return sortBySellerCount(entries);
    case 'official':
    default:
      return [...entries].sort(byOrder);
  }
}

function matchesKeyword(entry: BoardEntry, keyword: string): boolean {
  if (!keyword) return true;
  return [entry.name, entry.typeLine, entry.seller.account, entry.seller.character ?? ''].some(
    (field) => field.toLowerCase().includes(keyword),
  );
}

function withinPrice(
  entry: BoardEntry,
  filter: EntryFilter,
  rates: CurrencyRateSnapshot | undefined,
): boolean {
  const hasBound = filter.priceMin !== undefined || filter.priceMax !== undefined;
  if (!rates || !hasBound) return true;
  const value = convertPrice(entry.price, rates);
  if (value === undefined) return false;
  if (filter.priceMin !== undefined && value < filter.priceMin) return false;
  if (filter.priceMax !== undefined && value > filter.priceMax) return false;
  return true;
}

export function filterEntries(
  entries: readonly BoardEntry[],
  filter: EntryFilter,
  rates: CurrencyRateSnapshot | undefined,
): BoardEntry[] {
  const keyword = filter.keyword.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (!filter.instantBuyoutOnly || entry.instantBuyout) &&
      !filter.hiddenAccounts.has(entry.seller.account) &&
      matchesKeyword(entry, keyword) &&
      withinPrice(entry, filter, rates),
  );
}
