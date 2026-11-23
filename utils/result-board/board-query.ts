/**
 * 看板物品清單的篩選與排序。只在側邊欄內作用，不改動官方結果列。
 *
 * 價格排序與價格篩選需要匯率；沒有匯率時不提供價格排序，價格區間也不套用。
 */
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from './board-entry';
import { isSubsequence, matchesModConditions, type BoardModCondition } from './board-mods';
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
  /** 額外可搜尋文字（例如官方結果列經市集漢化後的品名與詞綴行） */
  extraSearchLines?: (entry: BoardEntry) => readonly string[];
  /** 必含獨立詞綴條件（全部皆須命中） */
  modConditions?: readonly BoardModCondition[];
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

export interface ParsedSearchTokens {
  include: readonly string[];
  exclude: readonly string[];
}

/** 拆成空白分隔的多個條件；`-詞` 表示排除 */
export function parseSearchTokens(keyword: string): ParsedSearchTokens {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of keyword.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith('-') && raw.length > 1) {
      exclude.push(raw.slice(1));
    } else {
      include.push(raw);
    }
  }
  return { include, exclude };
}

function matchesToken(lines: readonly string[], token: string, fuzzy: boolean): boolean {
  for (const line of lines) {
    if (line.includes(token)) return true;
  }
  if (!fuzzy || token.length < 2) return false;
  for (const line of lines) {
    if (isSubsequence(token, line)) return true;
  }
  return false;
}

function entrySearchLines(entry: BoardEntry, extraLines?: readonly string[]): readonly string[] {
  const lines: string[] = [];
  const push = (value: string | undefined) => {
    const normalized = value?.trim().toLowerCase();
    if (normalized) lines.push(normalized);
  };
  push(entry.name);
  push(entry.typeLine);
  if (entry.baseType && entry.baseType !== entry.typeLine) push(entry.baseType);
  push(entry.seller.account);
  push(entry.seller.character);
  if (entry.mods) {
    for (const mod of entry.mods) push(mod);
  }
  if (entry.modTiers) {
    for (const tier of entry.modTiers) push(tier);
  }
  if (extraLines) {
    for (const line of extraLines) push(line);
  }
  return lines;
}

export function matchesBoardEntry(
  entry: BoardEntry,
  tokens: ParsedSearchTokens,
  extraLines?: readonly string[],
): boolean {
  if (tokens.include.length === 0 && tokens.exclude.length === 0) return true;
  const lines = entrySearchLines(entry, extraLines);
  for (const excluded of tokens.exclude) {
    if (matchesToken(lines, excluded, false)) return false;
  }
  for (const included of tokens.include) {
    if (!matchesToken(lines, included, true)) return false;
  }
  return true;
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
  const tokens = parseSearchTokens(filter.keyword);
  const hasTokens = tokens.include.length > 0 || tokens.exclude.length > 0;
  const modConditions = filter.modConditions ?? [];
  return entries.filter(
    (entry) =>
      (!filter.instantBuyoutOnly || entry.instantBuyout) &&
      !filter.hiddenAccounts.has(entry.seller.account) &&
      (!hasTokens || matchesBoardEntry(entry, tokens, filter.extraSearchLines?.(entry))) &&
      matchesModConditions(entry, modConditions) &&
      withinPrice(entry, filter, rates),
  );
}
