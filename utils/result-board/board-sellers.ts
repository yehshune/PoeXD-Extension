/**
 * 看板的賣家聚合：找出能在同一個賣家倉庫一次直購多件的賣家。
 *
 * 依帳號分組（同帳號不同角色算同一位賣家）。總價只算可直購的結果；價格範圍涵蓋該賣家所有結果。
 */
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry, BoardPrice, SellerPresence } from './board-entry';
import { convertPrice, sumPrices, type PriceTotal } from './board-price';

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
  instantBuyoutCount: number;
  /** 可直購結果的總價 */
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

function summarize(
  account: string,
  entries: readonly BoardEntry[],
  rates: CurrencyRateSnapshot | undefined,
): SellerSummary {
  const buyable = entries.filter((entry) => entry.instantBuyout);
  const character = latestCharacter(entries);
  const priceRange = priceRangeOf(entries, rates);
  return {
    account,
    ...(character ? { character } : {}),
    presence: bestPresence(entries),
    entries,
    instantBuyoutCount: buyable.length,
    total: sumPrices(
      buyable.map((entry) => entry.price),
      rates,
    ),
    ...(priceRange ? { priceRange } : {}),
    firstOrder: entries[0].order,
  };
}

/** 依賣家第一次出現的順序回傳 */
export function aggregateSellers(
  entries: readonly BoardEntry[],
  rates: CurrencyRateSnapshot | undefined,
): SellerSummary[] {
  const groups = new Map<string, BoardEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.seller.account);
    groups.set(entry.seller.account, group ? [...group, entry] : [entry]);
  }
  return Array.from(groups, ([account, group]) => summarize(account, group, rates));
}

/** 只有每件都換算得出來的總價才能拿來比較 */
const convertedTotal = (seller: SellerSummary): number | undefined =>
  seller.total.kind === 'converted' && seller.total.unconverted === 0
    ? seller.total.amount
    : undefined;

/**
 * 可直購件數多→少；同件數時換算總價低→高，總價不完整的排在完整的後面；
 * 無法比較時維持官方順序
 */
export function sortSellers(sellers: readonly SellerSummary[]): SellerSummary[] {
  return [...sellers].sort((a, b) => {
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
      seller.instantBuyoutCount >= filter.minInstantBuyout &&
      !filter.hiddenAccounts.has(seller.account),
  );
}
