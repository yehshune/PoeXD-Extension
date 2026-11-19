import { describe, expect, it } from 'vitest';
import { convertPrice, sumPrices } from '@/utils/result-board/board-price';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';

const rates: CurrencyRateSnapshot = { primary: 'chaos', rates: { chaos: 1, divine: 200 } };

describe('convertPrice', () => {
  it('converts into the primary currency', () => {
    expect(convertPrice({ amount: 2, currency: 'divine' }, rates)).toBe(400);
    expect(convertPrice({ amount: 30, currency: 'chaos' }, rates)).toBe(30);
  });

  it('returns undefined without rates, a price or a known currency', () => {
    expect(convertPrice({ amount: 2, currency: 'divine' }, undefined)).toBeUndefined();
    expect(convertPrice(undefined, rates)).toBeUndefined();
    expect(convertPrice({ amount: 2, currency: 'mirror' }, rates)).toBeUndefined();
  });

  it('ignores inherited properties and non-finite results', () => {
    expect(convertPrice({ amount: 2, currency: 'constructor' }, rates)).toBeUndefined();
    expect(convertPrice({ amount: 2, currency: '__proto__' }, rates)).toBeUndefined();
    expect(convertPrice({ amount: 1e308, currency: 'divine' }, rates)).toBeUndefined();
    expect(sumPrices([{ amount: 1, currency: 'toString' }], rates)).toEqual({
      kind: 'converted',
      currency: 'chaos',
      amount: 0,
      unconverted: 1,
    });
  });
});

describe('sumPrices', () => {
  const prices = [
    { amount: 2, currency: 'divine' },
    { amount: 150, currency: 'chaos' },
    { amount: 1, currency: 'mirror' },
    undefined,
  ];

  it('totals converted prices and counts what could not be converted', () => {
    expect(sumPrices(prices, rates)).toEqual({
      kind: 'converted',
      currency: 'chaos',
      amount: 550,
      unconverted: 2,
    });
  });

  it('totals per currency when there are no rates', () => {
    expect(sumPrices(prices, undefined)).toEqual({
      kind: 'per-currency',
      totals: [
        { currency: 'divine', amount: 2 },
        { currency: 'chaos', amount: 150 },
        { currency: 'mirror', amount: 1 },
      ],
      unpriced: 1,
    });
  });

  it('adds up the same currency and avoids floating point noise', () => {
    const total = sumPrices(
      [
        { amount: 0.1, currency: 'divine' },
        { amount: 0.2, currency: 'divine' },
      ],
      undefined,
    );
    expect(total).toEqual({
      kind: 'per-currency',
      totals: [{ currency: 'divine', amount: 0.3 }],
      unpriced: 0,
    });
  });
});
