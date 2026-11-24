import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import {
  PRICE_COMPARISON_CURRENCIES,
  compareListingPrice,
  convertPrice,
  type CurrencyRateSnapshot,
  type PriceComparison,
} from '@/utils/price-comparison';
import type { PoeVersion } from '@/utils/trade-context';

export const PINNED_SORT_MODES = ['custom', 'newest', 'price-asc', 'price-desc'] as const;
export type PinnedSortMode = (typeof PINNED_SORT_MODES)[number];

function resolveSortablePrice(
  item: PinnedItemSnapshot,
  rates: CurrencyRateSnapshot | undefined,
): number | undefined {
  const price = item.listing.price;
  if (!price || !Number.isFinite(price.amount) || price.amount <= 0) return undefined;
  if (rates) return convertPrice({ amount: price.amount, currency: price.currency }, rates);
  return price.amount;
}

/**
 * 依指定排序模式排列釘選物品；價格排序時若有匯率則先換算為主通貨，
 * 無法換算或未標價的項目固定排在最後。
 */
export function sortPinnedItems(
  items: readonly PinnedItemSnapshot[],
  mode: PinnedSortMode,
  rates: CurrencyRateSnapshot | undefined,
): PinnedItemSnapshot[] {
  if (mode === 'custom') return [...items];
  const copy = [...items];
  if (mode === 'newest') {
    return copy.sort((a, b) => b.pinnedAt - a.pinnedAt);
  }
  const direction = mode === 'price-asc' ? 1 : -1;
  return copy.sort((a, b) => {
    const priceA = resolveSortablePrice(a, rates);
    const priceB = resolveSortablePrice(b, rates);
    if (priceA === undefined && priceB === undefined) return 0;
    if (priceA === undefined) return 1;
    if (priceB === undefined) return -1;
    return (priceA - priceB) * direction;
  });
}

export interface PinnedPriceComparison {
  amount: string;
  currency: PriceComparison['currency'];
  currencyName: string;
  icon: string;
  tooltip: string;
}

export type PinnedPriceComparisonTranslateKey =
  | 'pricePresenter.currency.chaos'
  | 'pricePresenter.currency.divine'
  | 'pricePresenter.currency.exalted'
  | 'pricePresenter.tooltip';

/** 依 poe.ninja 匯率算出展開後顯示的換算參考價（與標價同幣別或無法換算時回傳 undefined） */
export function resolvePinnedPriceComparison(
  item: PinnedItemSnapshot,
  version: PoeVersion,
  rates: CurrencyRateSnapshot | undefined,
  locale: string,
  translate: (
    key: PinnedPriceComparisonTranslateKey,
    params?: Record<string, string | number>,
  ) => string,
): PinnedPriceComparison | undefined {
  const price = item.listing.price;
  if (!price || !rates) return undefined;
  const comparison = compareListingPrice(version, rates, {
    amount: price.amount,
    currency: price.currency,
  });
  if (!comparison) return undefined;
  const currencyMeta = PRICE_COMPARISON_CURRENCIES[comparison.currency];
  const currencyName = translate(currencyMeta.labelKey);
  const amount = new Intl.NumberFormat(locale, {
    maximumSignificantDigits: 4,
  }).format(comparison.amount);
  return {
    amount,
    currency: comparison.currency,
    currencyName,
    icon: currencyMeta.icon,
    tooltip: translate('pricePresenter.tooltip', { amount, currency: currencyName }),
  };
}
