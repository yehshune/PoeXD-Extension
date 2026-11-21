import { describe, expect, it } from 'vitest';
import { toBoardEntry, type BoardEntry } from '@/utils/result-board/board-entry';
import {
  aggregateSellers,
  filterSellers,
  groupSellerEntriesByStash,
  sortSellers,
} from '@/utils/result-board/board-sellers';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import { rawResult, type RawResultOptions } from './helpers/result-board-fixtures';

const rates: CurrencyRateSnapshot = { primary: 'chaos', rates: { chaos: 1, divine: 200 } };

function entries(list: RawResultOptions[]): BoardEntry[] {
  return list.map((options, index) => toBoardEntry(rawResult(options), index)!);
}

describe('aggregateSellers', () => {
  it('groups characters of one account into one seller', () => {
    const sellers = aggregateSellers(
      entries([
        { id: 'a', account: 'A#1', character: 'Old', indexed: '2026-11-18T00:00:00Z' },
        { id: 'b', account: 'B#2' },
        { id: 'c', account: 'A#1', character: 'New', indexed: '2026-11-19T00:00:00Z' },
      ]),
      rates,
    );
    expect(sellers.map((seller) => [seller.account, seller.entries.map((e) => e.id)])).toEqual([
      ['A#1', ['a', 'c']],
      ['B#2', ['b']],
    ]);
    expect(sellers[0].character).toBe('New');
  });

  it('counts instant buyout results and totals only those', () => {
    const [seller] = aggregateSellers(
      entries([
        { id: 'a', amount: 1, currency: 'divine' },
        { id: 'b', amount: 50, currency: 'chaos' },
        { id: 'c', amount: 999, currency: 'chaos', instantBuyout: false },
      ]),
      rates,
    );
    expect(seller.instantBuyoutCount).toBe(2);
    expect(seller.total).toEqual({
      kind: 'converted',
      currency: 'chaos',
      amount: 250,
      unconverted: 0,
    });
  });

  it('reports the converted price range across all results', () => {
    const [seller] = aggregateSellers(
      entries([
        { id: 'a', amount: 1, currency: 'divine' },
        { id: 'b', amount: 50, currency: 'chaos' },
        { id: 'c', amount: 1, currency: 'mirror' },
      ]),
      rates,
    );
    expect(seller.priceRange).toEqual({
      min: { amount: 50, currency: 'chaos' },
      max: { amount: 1, currency: 'divine' },
    });
  });

  it('reports a price range without rates only when one currency is used', () => {
    const [single] = aggregateSellers(
      entries([
        { id: 'a', amount: 3, currency: 'divine' },
        { id: 'b', amount: 1, currency: 'divine' },
      ]),
      undefined,
    );
    expect(single.priceRange).toEqual({
      min: { amount: 1, currency: 'divine' },
      max: { amount: 3, currency: 'divine' },
    });
    const [mixed] = aggregateSellers(
      entries([
        { id: 'a', amount: 3, currency: 'divine' },
        { id: 'b', amount: 1, currency: 'chaos' },
      ]),
      undefined,
    );
    expect(mixed.priceRange).toBeUndefined();
    expect(mixed.total).toEqual({
      kind: 'per-currency',
      totals: [
        { currency: 'divine', amount: 3 },
        { currency: 'chaos', amount: 1 },
      ],
      unpriced: 0,
    });
  });

  it('uses the most available presence among the results', () => {
    const [seller] = aggregateSellers(
      entries([
        { id: 'a', online: 'offline' },
        { id: 'b', online: 'afk' },
      ]),
      rates,
    );
    expect(seller.presence).toBe('afk');
  });
});

describe('sortSellers', () => {
  it('orders by instant buyout count, then by cheaper converted total', () => {
    const sellers = aggregateSellers(
      entries([
        { id: 'a', account: 'Few#1', amount: 1 },
        { id: 'b', account: 'Pricey#2', amount: 5, currency: 'divine' },
        { id: 'c', account: 'Pricey#2', amount: 5, currency: 'divine' },
        { id: 'd', account: 'Cheap#3', amount: 10 },
        { id: 'e', account: 'Cheap#3', amount: 10 },
      ]),
      rates,
    );
    expect(sortSellers(sellers).map((seller) => seller.account)).toEqual([
      'Cheap#3',
      'Pricey#2',
      'Few#1',
    ]);
  });

  it('ranks a seller with an incomplete total after complete ones of the same count', () => {
    const sellers = aggregateSellers(
      entries([
        { id: 'a', account: 'Partial#1', amount: 1, currency: 'mirror' },
        { id: 'b', account: 'Partial#1', amount: 1 },
        { id: 'c', account: 'Complete#2', amount: 90 },
        { id: 'd', account: 'Complete#2', amount: 90 },
      ]),
      rates,
    );
    expect(sortSellers(sellers).map((seller) => seller.account)).toEqual([
      'Complete#2',
      'Partial#1',
    ]);
  });

  it('keeps first appearance order when totals cannot be compared', () => {
    const sellers = aggregateSellers(
      entries([
        { id: 'a', account: 'First#1', amount: 9 },
        { id: 'b', account: 'Second#2', amount: 1 },
      ]),
      undefined,
    );
    expect(sortSellers(sellers).map((seller) => seller.account)).toEqual(['First#1', 'Second#2']);
  });
});

describe('filterSellers', () => {
  const sellers = aggregateSellers(
    entries([
      { id: 'a', account: 'One#1' },
      { id: 'b', account: 'Two#2' },
      { id: 'c', account: 'Two#2' },
      { id: 'd', account: 'Hidden#3' },
      { id: 'e', account: 'Hidden#3' },
      { id: 'f', account: 'Whisper#4', instantBuyout: false },
      { id: 'g', account: 'Whisper#4', instantBuyout: false },
    ]),
    rates,
  );

  it('keeps sellers holding at least N instant buyout results who are not hidden', () => {
    const result = filterSellers(sellers, {
      minInstantBuyout: 2,
      hiddenAccounts: new Set(['Hidden#3']),
    });
    expect(result.map((seller) => seller.account)).toEqual(['Two#2']);
  });

  it('keeps everyone with a minimum of zero', () => {
    expect(filterSellers(sellers, { minInstantBuyout: 0, hiddenAccounts: new Set() })).toHaveLength(
      4,
    );
  });
});

describe('groupSellerEntriesByStash', () => {
  it('groups seller entries by stash tab name and keeps entry order', () => {
    const list = entries([
      { id: 'a', stash: { name: '24', x: 1, y: 9 }, instantBuyout: true },
      { id: 'b', stash: { name: 'Uniques', x: 3, y: 5 }, instantBuyout: false },
      { id: 'c', stash: { name: '24', x: 2, y: 9 }, instantBuyout: true },
      { id: 'd', stash: { x: 0, y: 0 }, instantBuyout: true },
    ]);
    expect(list[0].stash).toEqual({ name: '24', x: 1, y: 9 });
    const groups = groupSellerEntriesByStash(list);
    expect(
      groups.map((g) => ({
        stashName: g.stashName,
        ids: g.entries.map((e) => e.id),
        instantBuyoutCount: g.instantBuyoutCount,
      })),
    ).toEqual([
      { stashName: '24', ids: ['a', 'c'], instantBuyoutCount: 2 },
      { stashName: 'Uniques', ids: ['b'], instantBuyoutCount: 0 },
      { stashName: undefined, ids: ['d'], instantBuyoutCount: 1 },
    ]);
  });

  it('sinks sold entries within a stash group and sinks all-sold groups to the bottom', () => {
    const list = entries([
      { id: 'a', stash: { name: 'SoldTab' }, instantBuyout: true },
      { id: 'b', stash: { name: 'MixTab' }, instantBuyout: true },
      { id: 'c', stash: { name: 'MixTab' }, instantBuyout: true },
    ]);
    const groups = groupSellerEntriesByStash(list, new Set(['a', 'b']));
    expect(
      groups.map((g) => ({
        stashName: g.stashName,
        ids: g.entries.map((e) => e.id),
        instantBuyoutCount: g.instantBuyoutCount,
        allSold: g.allSold,
      })),
    ).toEqual([
      { stashName: 'MixTab', ids: ['c', 'b'], instantBuyoutCount: 1, allSold: false },
      { stashName: 'SoldTab', ids: ['a'], instantBuyoutCount: 0, allSold: true },
    ]);
  });
});

describe('sold-item seller aggregation, sorting and filtering', () => {
  it('excludes sold items from available count and total, keeps card under min filter, and sinks all-sold sellers', () => {
    const list = entries([
      { id: 'a1', account: 'SoldOut#1', amount: 5, stash: { name: '1' } },
      { id: 'a2', account: 'SoldOut#1', amount: 5, stash: { name: '1' } },
      { id: 'b1', account: 'Partial#2', amount: 10, stash: { name: 'A' } },
      { id: 'b2', account: 'Partial#2', amount: 20, stash: { name: 'B' } },
    ]);
    const sellers = aggregateSellers(list, rates, new Set(['a1', 'a2', 'b1']));
    const sorted = sortSellers(sellers);
    expect(sorted.map((s) => s.account)).toEqual(['Partial#2', 'SoldOut#1']);
    expect(sorted[0]).toMatchObject({
      instantBuyoutCount: 1,
      totalInstantBuyoutCount: 2,
      soldCount: 1,
      allSold: false,
      stashTabCount: 1,
      total: { kind: 'converted', currency: 'chaos', amount: 20, unconverted: 0 },
    });
    expect(sorted[1]).toMatchObject({
      instantBuyoutCount: 0,
      totalInstantBuyoutCount: 2,
      soldCount: 2,
      allSold: true,
    });
    // 篩選門檻依 totalInstantBuyoutCount 判斷，不因賣掉一件而讓正在看的卡片突然消失
    expect(
      filterSellers(sorted, { minInstantBuyout: 2, hiddenAccounts: new Set() }).map(
        (s) => s.account,
      ),
    ).toEqual(['Partial#2', 'SoldOut#1']);
  });
});
