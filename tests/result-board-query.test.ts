import { describe, expect, it } from 'vitest';
import { toBoardEntry, type BoardEntry } from '@/utils/result-board/board-entry';
import {
  availableSortModes,
  filterEntries,
  sortEntries,
  type EntryFilter,
} from '@/utils/result-board/board-query';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import { rawResult, type RawResultOptions } from './helpers/result-board-fixtures';

const rates: CurrencyRateSnapshot = { primary: 'chaos', rates: { chaos: 1, divine: 200 } };

function entries(list: RawResultOptions[]): BoardEntry[] {
  return list.map((options, index) => toBoardEntry(rawResult(options), index)!);
}

const ids = (list: readonly BoardEntry[]) => list.map((entry) => entry.id);

const noFilter: EntryFilter = {
  instantBuyoutOnly: false,
  keyword: '',
  hiddenAccounts: new Set(),
};

describe('availableSortModes', () => {
  it('offers price sorting only when prices can be converted', () => {
    expect(availableSortModes(true)).toEqual([
      'official',
      'price-asc',
      'price-desc',
      'indexed-desc',
      'seller-count-desc',
    ]);
    expect(availableSortModes(false)).toEqual(['official', 'indexed-desc', 'seller-count-desc']);
  });
});

describe('sortEntries', () => {
  const list = entries([
    { id: 'a', amount: 1, currency: 'divine', indexed: '2026-11-17T00:00:00Z' },
    { id: 'b', amount: 1, currency: 'mirror', indexed: '2026-11-19T00:00:00Z' },
    { id: 'c', amount: 50, currency: 'chaos', indexed: '2026-11-18T00:00:00Z' },
    { id: 'd', amount: 0, indexed: 'bad' },
  ]);

  it('sorts by converted price with unconvertible results last in both directions', () => {
    expect(ids(sortEntries(list, 'price-asc', rates))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(sortEntries(list, 'price-desc', rates))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('falls back to the official order for price sorting without rates', () => {
    expect(ids(sortEntries(list, 'price-asc', undefined))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts by newest listing with unknown times last', () => {
    expect(ids(sortEntries(list, 'indexed-desc', rates))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('restores the official order without mutating the input', () => {
    const reversed = [...list].reverse();
    expect(ids(sortEntries(reversed, 'official', rates))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(reversed)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('puts sellers holding more results first and keeps their results together', () => {
    const grouped = entries([
      { id: 'a', account: 'One#1' },
      { id: 'b', account: 'Two#2' },
      { id: 'c', account: 'Three#3' },
      { id: 'd', account: 'Two#2' },
      { id: 'e', account: 'Three#3' },
    ]);
    expect(ids(sortEntries(grouped, 'seller-count-desc', rates))).toEqual([
      'b',
      'd',
      'c',
      'e',
      'a',
    ]);
  });
});

describe('filterEntries', () => {
  const list = entries([
    {
      id: 'a',
      account: 'Alice#1',
      character: 'Frost',
      name: 'Doom Shell',
      amount: 1,
      currency: 'divine',
    },
    { id: 'b', account: 'Bob#2', amount: 50, currency: 'chaos', instantBuyout: false },
    { id: 'c', account: 'Carol#3', typeLine: 'Hubris Circlet', amount: 1, currency: 'mirror' },
  ]);

  it('keeps everything without criteria', () => {
    expect(ids(filterEntries(list, noFilter, rates))).toEqual(['a', 'b', 'c']);
  });

  it('keeps only instant buyout results', () => {
    expect(ids(filterEntries(list, { ...noFilter, instantBuyoutOnly: true }, rates))).toEqual([
      'a',
      'c',
    ]);
  });

  it('matches the keyword against item and seller names, ignoring case', () => {
    const match = (keyword: string) => ids(filterEntries(list, { ...noFilter, keyword }, rates));
    expect(match('  doom ')).toEqual(['a']);
    expect(match('circlet')).toEqual(['c']);
    expect(match('bob')).toEqual(['b']);
    expect(match('frost')).toEqual(['a']);
  });

  it('hides sellers', () => {
    const filter = { ...noFilter, hiddenAccounts: new Set(['Alice#1']) };
    expect(ids(filterEntries(list, filter, rates))).toEqual(['b', 'c']);
  });

  it('filters by converted price range and drops unconvertible results', () => {
    expect(ids(filterEntries(list, { ...noFilter, priceMin: 100 }, rates))).toEqual(['a']);
    expect(ids(filterEntries(list, { ...noFilter, priceMax: 100 }, rates))).toEqual(['b']);
  });

  it('ignores the price range without rates', () => {
    expect(ids(filterEntries(list, { ...noFilter, priceMin: 100 }, undefined))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
