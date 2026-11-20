import type { PoeVersion } from './trade-context';

export interface CurrencyRateSnapshot {
  primary: string;
  rates: Record<string, number>;
}

export interface ListingPrice {
  amount: number;
  currency: string;
}

export interface PriceComparison {
  amount: number;
  currency: 'chaos' | 'divine' | 'exalted';
}

export interface PriceComparisonCurrencyUnit {
  labelKey:
    | 'pricePresenter.currency.chaos'
    | 'pricePresenter.currency.divine'
    | 'pricePresenter.currency.exalted';
  icon: string;
}

/** 換算後顯示的目標通貨名稱鍵與官方 CDN 圖示，供結果列表與釘選物品共用 */
export const PRICE_COMPARISON_CURRENCIES: Readonly<
  Record<PriceComparison['currency'], PriceComparisonCurrencyUnit>
> = Object.freeze({
  chaos: {
    labelKey: 'pricePresenter.currency.chaos',
    icon: 'https://webtw.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lSZXJvbGxSYXJlIiwic2NhbGUiOjF9XQ/46a2347805/CurrencyRerollRare.png',
  },
  divine: {
    labelKey: 'pricePresenter.currency.divine',
    icon: 'https://webtw.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lNb2RWYWx1ZXMiLCJzY2FsZSI6MX1d/ec48896769/CurrencyModValues.png',
  },
  exalted: {
    labelKey: 'pricePresenter.currency.exalted',
    icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lBZGRNb2RUb1JhcmUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/ad7c366789/CurrencyAddModToRare.png',
  },
});

export function parseCurrencyRateSnapshot(value: unknown): CurrencyRateSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const normalized = value as { primary?: unknown; rates?: unknown };
  if (
    typeof normalized.primary === 'string' &&
    normalized.rates &&
    typeof normalized.rates === 'object'
  ) {
    return {
      primary: normalized.primary,
      rates: sanitizeRates(normalized.rates as Record<string, unknown>),
    };
  }

  const overview = value as { core?: { primary?: unknown }; lines?: unknown };
  if (typeof overview.core?.primary !== 'string' || !Array.isArray(overview.lines))
    return undefined;

  const rates: Record<string, number> = {};
  overview.lines.forEach((line) => {
    if (!line || typeof line !== 'object') return;
    const { id, primaryValue } = line as { id?: unknown; primaryValue?: unknown };
    if (
      typeof id === 'string' &&
      typeof primaryValue === 'number' &&
      Number.isFinite(primaryValue) &&
      primaryValue > 0
    ) {
      rates[id] = primaryValue;
    }
  });

  return { primary: overview.core.primary, rates };
}

function sanitizeRates(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
    ),
  );
}

export function compareListingPrice(
  version: PoeVersion,
  snapshot: CurrencyRateSnapshot | undefined,
  price: ListingPrice,
): PriceComparison | null {
  if (!snapshot || !Number.isFinite(price.amount) || price.amount <= 0) return null;
  const sourceRate = snapshot.rates[price.currency];
  if (!sourceRate) return null;

  let targetCurrency: PriceComparison['currency'] = 'exalted';
  if (version === 'poe1') {
    if (price.currency === 'divine') return null;
    const divineRate = snapshot.rates.divine;
    targetCurrency = divineRate && price.amount * sourceRate >= divineRate ? 'divine' : 'chaos';
  }
  if (price.currency === targetCurrency) return null;
  const targetRate = snapshot.rates[targetCurrency];
  if (!targetRate) return null;
  return {
    amount: (price.amount * sourceRate) / targetRate,
    currency: targetCurrency,
  };
}

export function createResultPriceComparisons(
  version: PoeVersion,
  snapshot: CurrencyRateSnapshot | undefined,
  results: unknown,
) {
  if (!Array.isArray(results)) return {};
  const comparisons: Record<string, PriceComparison> = {};
  results.forEach((result) => {
    if (!result || typeof result !== 'object') return;
    const { id, listing } = result as { id?: unknown; listing?: { price?: Partial<ListingPrice> } };
    const price = listing?.price;
    if (
      typeof id !== 'string' ||
      typeof price?.amount !== 'number' ||
      typeof price.currency !== 'string'
    )
      return;
    const comparison = compareListingPrice(version, snapshot, {
      amount: price.amount,
      currency: price.currency,
    });
    if (comparison) comparisons[id] = comparison;
  });
  return comparisons;
}
