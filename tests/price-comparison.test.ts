import { describe, expect, it } from 'vitest';
import {
  compareListingPrice,
  createResultPriceComparisons,
  parseCurrencyRateSnapshot,
} from '@/utils/price-comparison';

describe('price comparison', () => {
  it('compares a POE1 Chaos Orb listing worth at least one Divine Orb in Divine Orbs', () => {
    const snapshot = parseCurrencyRateSnapshot({
      core: { primary: 'chaos' },
      lines: [
        { id: 'chaos', primaryValue: 1 },
        { id: 'divine', primaryValue: 200 },
      ],
    });

    expect(compareListingPrice('poe1', snapshot, { amount: 200, currency: 'chaos' })).toEqual({
      amount: 1,
      currency: 'divine',
    });
  });

  it('compares a low-value POE1 non-core currency listing in Chaos Orbs', () => {
    const snapshot = parseCurrencyRateSnapshot({
      core: { primary: 'chaos' },
      lines: [
        { id: 'chaos', primaryValue: 1 },
        { id: 'divine', primaryValue: 200 },
        { id: 'alteration', primaryValue: 0.5 },
      ],
    });

    expect(compareListingPrice('poe1', snapshot, { amount: 10, currency: 'alteration' })).toEqual({
      amount: 5,
      currency: 'chaos',
    });
    expect(compareListingPrice('poe1', snapshot, { amount: 0.5, currency: 'divine' })).toBeNull();
  });

  it('compares a POE2 Chaos Orb listing in Exalted Orbs', () => {
    const snapshot = parseCurrencyRateSnapshot({
      core: { primary: 'divine' },
      lines: [
        { id: 'chaos', primaryValue: 0.1214 },
        { id: 'divine', primaryValue: 1 },
        { id: 'exalted', primaryValue: 0.003104 },
      ],
    });

    expect(compareListingPrice('poe2', snapshot, { amount: 40, currency: 'chaos' })).toEqual({
      amount: 1564.4329896907216,
      currency: 'exalted',
    });
  });

  it('reads a normalized snapshot back from storage', () => {
    expect(
      parseCurrencyRateSnapshot({
        primary: 'chaos',
        rates: { chaos: 1, divine: 196.3, broken: 0 },
      }),
    ).toEqual({
      primary: 'chaos',
      rates: { chaos: 1, divine: 196.3 },
    });
  });

  it('keys comparisons by result id and ignores listings without a convertible price', () => {
    const snapshot = parseCurrencyRateSnapshot({
      core: { primary: 'chaos' },
      lines: [
        { id: 'chaos', primaryValue: 1 },
        { id: 'divine', primaryValue: 196.3 },
      ],
    });

    expect(
      createResultPriceComparisons('poe1', snapshot, [
        { id: 'second', listing: { price: { amount: 190, currency: 'chaos' } } },
        { id: 'first', listing: { price: { amount: 196.3, currency: 'chaos' } } },
        { id: 'missing', listing: {} },
      ]),
    ).toEqual({
      first: { amount: 1, currency: 'divine' },
    });
  });

  it('does not compare a non-finite listing amount', () => {
    const snapshot = parseCurrencyRateSnapshot({
      primary: 'chaos',
      rates: { chaos: 1, divine: 196.3 },
    });

    expect(
      compareListingPrice('poe1', snapshot, { amount: Number.NaN, currency: 'divine' }),
    ).toBeNull();
  });
});
