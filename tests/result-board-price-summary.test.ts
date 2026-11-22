import { describe, expect, it } from 'vitest';
import { toBoardEntry, type BoardEntry } from '@/utils/result-board/board-entry';
import { summarizePrices } from '@/utils/result-board/board-price';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import { rawResult, type RawResultOptions } from './helpers/result-board-fixtures';

const rates: CurrencyRateSnapshot = { primary: 'chaos', rates: { chaos: 1, divine: 200 } };
const entries = (list: RawResultOptions[]): BoardEntry[] =>
  list.map((options, index) => toBoardEntry(rawResult(options), index)!);

describe('summarizePrices', () => {
  it('reports the lowest and median converted price, skipping unconvertible ones', () => {
    expect(
      summarizePrices(
        entries([
          { id: 'a', amount: 1, currency: 'divine' },
          { id: 'b', amount: 10 },
          { id: 'c', amount: 30 },
          { id: 'd', amount: 1, currency: 'mirror' },
        ]),
        rates,
      ),
    ).toEqual({ currency: 'chaos', min: 10, median: 30, count: 3 });
  });

  it('averages the two middle prices for an even count', () => {
    expect(
      summarizePrices(
        entries([
          { id: 'a', amount: 10 },
          { id: 'b', amount: 20 },
        ]),
        rates,
      )?.median,
    ).toBe(15);
  });

  it('returns undefined without rates or convertible prices', () => {
    expect(summarizePrices(entries([{ id: 'a' }]), undefined)).toBeUndefined();
    expect(
      summarizePrices(entries([{ id: 'a', amount: 1, currency: 'mirror' }]), rates),
    ).toBeUndefined();
  });
});
