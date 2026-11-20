import { describe, expect, it } from 'vitest';
import {
  resolvePinnedPriceComparison,
  sortPinnedItems,
  type PinnedPriceComparisonTranslateKey,
} from '@/components/sidebar/pinned-items/pinned-item-sort';
import { createPinnedItemSnapshot, type PinnedItemSnapshot } from '@/utils/pinned-items';
import { PRICE_COMPARISON_CURRENCIES, type CurrencyRateSnapshot } from '@/utils/price-comparison';

function makePin(
  id: string,
  pinnedAt: number,
  price?: { amount: number; currency: string },
): PinnedItemSnapshot {
  const snapshot = createPinnedItemSnapshot(
    {
      id,
      item: { typeLine: `Item ${id}`, frameType: 2 },
      listing: price ? { price } : {},
    },
    { gameVersion: 'poe1', origin: 'https://www.pathofexile.com', league: 'Covens' },
    pinnedAt,
  );
  if (!snapshot) throw new Error(`Failed to create snapshot ${id}`);
  return snapshot;
}

const rates: CurrencyRateSnapshot = {
  primary: 'chaos',
  rates: {
    chaos: 1,
    divine: 200,
    exalted: 15,
  },
};

describe('sortPinnedItems', () => {
  const items = [
    makePin('a', 100, { amount: 1, currency: 'divine' }), // 200c
    makePin('b', 300, { amount: 120, currency: 'chaos' }), // 120c
    makePin('c', 200), // unpriced
    makePin('d', 400, { amount: 2, currency: 'divine' }), // 400c
  ];

  it('preserves user order in custom mode', () => {
    expect(sortPinnedItems(items, 'custom', rates).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts by newest pinnedAt descending in newest mode', () => {
    expect(sortPinnedItems(items, 'newest', rates).map((i) => i.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('sorts by converted currency value ascending/descending and puts unpriced items last', () => {
    expect(sortPinnedItems(items, 'price-asc', rates).map((i) => i.id)).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
    expect(sortPinnedItems(items, 'price-desc', rates).map((i) => i.id)).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
  });

  it('falls back to raw amount when currency rates are unavailable', () => {
    expect(sortPinnedItems(items, 'price-asc', undefined).map((i) => i.id)).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
  });
});

describe('resolvePinnedPriceComparison', () => {
  const translate = (
    key: PinnedPriceComparisonTranslateKey,
    params?: Record<string, string | number>,
  ) => {
    if (key === 'pricePresenter.tooltip') {
      return `約合 ${params?.amount} ${params?.currency}`;
    }
    if (key === 'pricePresenter.currency.chaos') return '混沌石';
    if (key === 'pricePresenter.currency.divine') return '神聖石';
    return '崇高石';
  };

  it('formats chaos-to-divine and exalted-to-chaos comparisons with official CDN icons', () => {
    const highChaos = makePin('h', 100, { amount: 250, currency: 'chaos' });
    expect(resolvePinnedPriceComparison(highChaos, 'poe1', rates, 'zh-TW', translate)).toEqual({
      amount: '1.25',
      currency: 'divine',
      currencyName: '神聖石',
      icon: PRICE_COMPARISON_CURRENCIES.divine.icon,
      tooltip: '約合 1.25 神聖石',
    });

    const divItem = makePin('d', 100, { amount: 1, currency: 'divine' });
    expect(
      resolvePinnedPriceComparison(divItem, 'poe1', rates, 'zh-TW', translate),
    ).toBeUndefined();

    const exItem = makePin('e', 100, { amount: 2, currency: 'exalted' });
    expect(resolvePinnedPriceComparison(exItem, 'poe1', rates, 'zh-TW', translate)).toEqual({
      amount: '30',
      currency: 'chaos',
      currencyName: '混沌石',
      icon: PRICE_COMPARISON_CURRENCIES.chaos.icon,
      tooltip: '約合 30 混沌石',
    });
  });
});
