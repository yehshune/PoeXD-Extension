/**
 * 看板的賣家聚合：找出能在同一個賣家倉庫一次直購多件的賣家。
 *
 * 依帳號分組（同帳號不同角色算同一位賣家）。總價只算可直購的結果；價格範圍涵蓋該賣家所有結果。
 */
import { convertPrice, type CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry, BoardPrice, SellerPresence } from './board-entry';

export type PriceTotal =
  | {
      kind: 'converted';
      /** 匯率快照的主通貨 */
      currency: string;
      amount: number;
      /** 沒有標價或無法換算、未計入的件數 */
      unconverted: number;
    }
  | {
      kind: 'per-currency';
      /** 依首次出現的順序 */
      totals: readonly BoardPrice[];
      /** 沒有標價、未計入的件數 */
      unpriced: number;
    };

/** 去掉浮點誤差（例如 0.1 + 0.2） */
const roundAmount = (value: number): number => Math.round(value * 1e6) / 1e6;

/** 有匯率時換成主通貨加總；沒有匯率時依幣種分開加總 */
export function sumPrices(
  prices: readonly (BoardPrice | undefined)[],
  rates: CurrencyRateSnapshot | undefined,
): PriceTotal {
  if (rates) {
    const converted = prices.map((price) => convertPrice(price, rates));
    const known = converted.filter((value): value is number => value !== undefined);
    return {
      kind: 'converted',
      currency: rates.primary,
      amount: roundAmount(known.reduce((sum, value) => sum + value, 0)),
      unconverted: converted.length - known.length,
    };
  }

  const totals = new Map<string, number>();
  let unpriced = 0;
  for (const price of prices) {
    if (!price) {
      unpriced += 1;
      continue;
    }
    totals.set(price.currency, (totals.get(price.currency) ?? 0) + price.amount);
  }
  return {
    kind: 'per-currency',
    totals: Array.from(totals, ([currency, amount]) => ({ currency, amount: roundAmount(amount) })),
    unpriced,
  };
}

export interface PriceRange {
  min: BoardPrice;
  max: BoardPrice;
}

export interface SellerSummary {
  account: string;
  /** 最近一筆刊登的角色名稱 */
  character?: string;
  presence: SellerPresence;
  /** 依官方順序 */
  entries: readonly BoardEntry[];
  /** 尚未售出的可直購件數 */
  instantBuyoutCount: number;
  /** 包含已售出在內的總可直購件數（用於篩選門檻，避免賣掉一件就讓正在看的卡片突然消失） */
  totalInstantBuyoutCount: number;
  /** 已標記為售出的件數 */
  soldCount: number;
  /** 該賣家所有結果皆已售出 */
  allSold: boolean;
  /** 尚可購買（或全部已售出時所有結果）涵蓋的倉庫分頁數 */
  stashTabCount: number;
  /** 尚未售出的可直購結果總價 */
  total: PriceTotal;
  /** 無法比較價格（沒有匯率且混用幣種，或沒有標價）時為 undefined */
  priceRange?: PriceRange;
  /** 第一次出現在官方結果中的順序 */
  firstOrder: number;
}

export interface SellerFilter {
  minInstantBuyout: number;
  hiddenAccounts: ReadonlySet<string>;
}

const PRESENCE_RANK: Readonly<Record<SellerPresence, number>> = { online: 2, afk: 1, offline: 0 };

function latestCharacter(entries: readonly BoardEntry[]): string | undefined {
  const latest = entries.reduce((best, entry) =>
    (entry.indexedAt ?? -Infinity) > (best.indexedAt ?? -Infinity) ? entry : best,
  );
  return latest.seller.character;
}

function bestPresence(entries: readonly BoardEntry[]): SellerPresence {
  return entries.reduce<SellerPresence>(
    (best, entry) =>
      PRESENCE_RANK[entry.seller.presence] > PRESENCE_RANK[best] ? entry.seller.presence : best,
    'offline',
  );
}

function rangeBy(
  prices: readonly BoardPrice[],
  value: (price: BoardPrice) => number,
): PriceRange | undefined {
  if (prices.length === 0) return undefined;
  const sorted = [...prices].sort((a, b) => value(a) - value(b));
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

function priceRangeOf(
  entries: readonly BoardEntry[],
  rates: CurrencyRateSnapshot | undefined,
): PriceRange | undefined {
  const prices = entries
    .map((entry) => entry.price)
    .filter((price): price is BoardPrice => price !== undefined);
  if (rates) {
    const convertible = prices.filter((price) => convertPrice(price, rates) !== undefined);
    return rangeBy(convertible, (price) => convertPrice(price, rates) ?? 0);
  }
  const currencies = new Set(prices.map((price) => price.currency));
  return currencies.size === 1 ? rangeBy(prices, (price) => price.amount) : undefined;
}

function stashTabCountOf(entries: readonly BoardEntry[]): number {
  const keys = new Set(entries.map((entry) => entry.stash?.name ?? ''));
  return keys.size;
}

function summarize(
  account: string,
  entries: readonly BoardEntry[],
  rates: CurrencyRateSnapshot | undefined,
  soldIds: ReadonlySet<string>,
): SellerSummary {
  const soldCount = entries.reduce((count, entry) => count + (soldIds.has(entry.id) ? 1 : 0), 0);
  const allSold = entries.length > 0 && soldCount === entries.length;
  const activeEntries = allSold ? entries : entries.filter((entry) => !soldIds.has(entry.id));
  const totalBuyable = entries.filter((entry) => entry.instantBuyout);
  const availableBuyable = totalBuyable.filter((entry) => !soldIds.has(entry.id));
  const character = latestCharacter(entries);
  const priceRange = priceRangeOf(activeEntries, rates);
  return {
    account,
    ...(character ? { character } : {}),
    presence: bestPresence(entries),
    entries,
    instantBuyoutCount: availableBuyable.length,
    totalInstantBuyoutCount: totalBuyable.length,
    soldCount,
    allSold,
    stashTabCount: stashTabCountOf(activeEntries),
    total: sumPrices(
      availableBuyable.map((entry) => entry.price),
      rates,
    ),
    ...(priceRange ? { priceRange } : {}),
    firstOrder: entries[0].order,
  };
}

const EMPTY_SOLD_IDS: ReadonlySet<string> = new Set();

/** 依賣家第一次出現的順序回傳；若提供 `soldIds`，件數與總價會排除已售出項目 */
export function aggregateSellers(
  entries: readonly BoardEntry[],
  rates: CurrencyRateSnapshot | undefined,
  soldIds: ReadonlySet<string> = EMPTY_SOLD_IDS,
): SellerSummary[] {
  const groups = new Map<string, BoardEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.seller.account);
    groups.set(entry.seller.account, group ? [...group, entry] : [entry]);
  }
  return Array.from(groups, ([account, group]) => summarize(account, group, rates, soldIds));
}

/** 只有每件都換算得出來的總價才能拿來比較 */
const convertedTotal = (seller: SellerSummary): number | undefined =>
  seller.total.kind === 'converted' && seller.total.unconverted === 0
    ? seller.total.amount
    : undefined;

/**
 * 全部已售出的賣家沉底；其餘依尚可直購件數多→少、同件數時換算總價低→高，
 * 總價不完整的排在完整的後面；無法比較時維持官方順序
 */
export function sortSellers(sellers: readonly SellerSummary[]): SellerSummary[] {
  return [...sellers].sort((a, b) => {
    if (a.allSold !== b.allSold) return a.allSold ? 1 : -1;
    if (a.instantBuyoutCount !== b.instantBuyoutCount) {
      return b.instantBuyoutCount - a.instantBuyoutCount;
    }
    const totalA = convertedTotal(a);
    const totalB = convertedTotal(b);
    if (totalA !== undefined && totalB !== undefined && totalA !== totalB) return totalA - totalB;
    if ((totalA === undefined) !== (totalB === undefined)) return totalA === undefined ? 1 : -1;
    return a.firstOrder - b.firstOrder;
  });
}

export function filterSellers(
  sellers: readonly SellerSummary[],
  filter: SellerFilter,
): SellerSummary[] {
  return sellers.filter(
    (seller) =>
      seller.totalInstantBuyoutCount >= filter.minInstantBuyout &&
      !filter.hiddenAccounts.has(seller.account),
  );
}

export interface SellerStashGroup {
  key: string;
  /** 倉庫分頁名稱；官方結果未提供時為 undefined */
  stashName?: string;
  entries: readonly BoardEntry[];
  /** 該分頁中尚未售出的可直購件數 */
  instantBuyoutCount: number;
  allSold: boolean;
}

/**
 * 依倉庫分頁名稱將同一位賣家的物品分區，維持分頁與各分頁內既有的排序。
 * 已售出的物品沉到該分頁最底；全部已售出的分頁沉到賣家展開區最底。
 */
export function groupSellerEntriesByStash(
  entries: readonly BoardEntry[],
  soldIds: ReadonlySet<string> = EMPTY_SOLD_IDS,
): SellerStashGroup[] {
  const groups = new Map<string, { stashName?: string; entries: BoardEntry[] }>();
  for (const entry of entries) {
    const stashName = entry.stash?.name;
    const key = stashName !== undefined ? `tab:${stashName}` : 'unknown';
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, { stashName, entries: [entry] });
    }
  }
  const built = Array.from(groups, ([key, group]) => {
    const active = group.entries.filter((entry) => !soldIds.has(entry.id));
    const sold = group.entries.filter((entry) => soldIds.has(entry.id));
    const ordered = [...active, ...sold];
    return {
      key,
      ...(group.stashName !== undefined ? { stashName: group.stashName } : {}),
      entries: ordered,
      instantBuyoutCount: active.filter((entry) => entry.instantBuyout).length,
      allSold: ordered.length > 0 && active.length === 0,
    };
  });
  return [...built.filter((g) => !g.allSold), ...built.filter((g) => g.allSold)];
}
