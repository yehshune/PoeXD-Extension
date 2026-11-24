import { describe, expect, it } from 'vitest';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import { toBoardEntry, type BoardEntry } from '@/utils/result-board/board-entry';
import {
  availableSortModes,
  projectBoardView,
  projectSellerStashGroups,
  sumPrices,
  type BoardViewProjectionInput,
} from '@/utils/result-board/board-projection';
import { rawResult, type RawResultOptions } from './helpers/result-board-fixtures';

const rates: CurrencyRateSnapshot = { primary: 'chaos', rates: { chaos: 1, divine: 200 } };

function entries(list: RawResultOptions[]): BoardEntry[] {
  return list.map((options, index) => toBoardEntry(rawResult(options), index)!);
}

const ids = (list: readonly BoardEntry[]) => list.map((entry) => entry.id);

function project(
  list: readonly BoardEntry[],
  overrides: Partial<BoardViewProjectionInput> = {},
) {
  return projectBoardView({
    entries: list,
    marks: {},
    hiddenAccounts: new Set(),
    view: 'items',
    sortMode: 'official',
    instantOnly: false,
    hideSold: false,
    keyword: '',
    minSellerCount: 0,
    modConditions: [],
    modPickerQuery: '',
    modQuickFilter: 'all',
    rates,
    resolveStatLabel: (hash) => hash,
    ...overrides,
  });
}

describe('board-projection: price totals and summaries', () => {
  const prices = [
    { amount: 2, currency: 'divine' },
    { amount: 150, currency: 'chaos' },
    { amount: 1, currency: 'mirror' },
    undefined,
  ];

  it('totals converted prices and counts unconverted or inherited currency keys', () => {
    expect(sumPrices(prices, rates)).toEqual({
      kind: 'converted',
      currency: 'chaos',
      amount: 550,
      unconverted: 2,
    });
    expect(sumPrices([{ amount: 1, currency: 'toString' }], rates)).toEqual({
      kind: 'converted',
      currency: 'chaos',
      amount: 0,
      unconverted: 1,
    });
  });

  it('totals per currency without rates and avoids floating point noise', () => {
    expect(sumPrices(prices, undefined)).toEqual({
      kind: 'per-currency',
      totals: [
        { currency: 'divine', amount: 2 },
        { currency: 'chaos', amount: 150 },
        { currency: 'mirror', amount: 1 },
      ],
      unpriced: 1,
    });
    expect(
      sumPrices(
        [
          { amount: 0.1, currency: 'divine' },
          { amount: 0.2, currency: 'divine' },
        ],
        undefined,
      ),
    ).toEqual({
      kind: 'per-currency',
      totals: [{ currency: 'divine', amount: 0.3 }],
      unpriced: 0,
    });
  });

  it('summarizes lowest and median converted prices and omits summary without rates or convertible items', () => {
    const odd = project(
      entries([
        { id: 'a', amount: 1, currency: 'divine' },
        { id: 'b', amount: 10 },
        { id: 'c', amount: 30 },
        { id: 'd', amount: 1, currency: 'mirror' },
      ]),
    );
    expect(odd.priceSummary).toEqual({ currency: 'chaos', min: 10, median: 30, count: 3 });

    const even = project(
      entries([
        { id: 'a', amount: 10 },
        { id: 'b', amount: 20 },
      ]),
    );
    expect(even.priceSummary?.median).toBe(15);

    expect(project(entries([{ id: 'a' }]), { rates: undefined }).priceSummary).toBeUndefined();
    expect(
      project(entries([{ id: 'a', amount: 1, currency: 'mirror' }])).priceSummary,
    ).toBeUndefined();
  });
});

describe('board-projection: item sorting and filtering', () => {
  it('offers price sorting only when conversion rates are available', () => {
    expect(availableSortModes(true)).toEqual([
      'official',
      'price-asc',
      'price-desc',
      'indexed-desc',
      'seller-count-desc',
    ]);
    expect(availableSortModes(false)).toEqual(['official', 'indexed-desc', 'seller-count-desc']);
  });

  it('sorts by price, newest listing, official order, and seller count', () => {
    const list = entries([
      { id: 'a', amount: 1, currency: 'divine', indexed: '2026-11-17T00:00:00Z' },
      { id: 'b', amount: 1, currency: 'mirror', indexed: '2026-11-19T00:00:00Z' },
      { id: 'c', amount: 50, currency: 'chaos', indexed: '2026-11-18T00:00:00Z' },
      { id: 'd', amount: 0, indexed: 'bad' },
    ]);

    expect(ids(project(list, { sortMode: 'price-asc' }).filteredEntries)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
    expect(ids(project(list, { sortMode: 'price-desc' }).filteredEntries)).toEqual([
      'a',
      'c',
      'b',
      'd',
    ]);
    expect(
      ids(project(list, { sortMode: 'price-asc', rates: undefined }).filteredEntries),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(project(list, { sortMode: 'indexed-desc' }).filteredEntries)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);

    const reversed = [...list].reverse();
    expect(ids(project(reversed, { sortMode: 'official' }).filteredEntries)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(ids(reversed)).toEqual(['d', 'c', 'b', 'a']);

    const grouped = entries([
      { id: 'a', account: 'One#1' },
      { id: 'b', account: 'Two#2' },
      { id: 'c', account: 'Three#3' },
      { id: 'd', account: 'Two#2' },
      { id: 'e', account: 'Three#3' },
    ]);
    expect(ids(project(grouped, { sortMode: 'seller-count-desc' }).filteredEntries)).toEqual([
      'b',
      'd',
      'c',
      'e',
      'a',
    ]);
  });

  it('filters items by instant buyout, keyword, hidden accounts, and converted price bounds', () => {
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

    expect(ids(project(list).filteredEntries)).toEqual(['a', 'b', 'c']);
    expect(ids(project(list, { instantOnly: true }).filteredEntries)).toEqual(['a', 'c']);
    expect(ids(project(list, { keyword: '  doom ' }).filteredEntries)).toEqual(['a']);
    expect(ids(project(list, { keyword: 'circlet' }).filteredEntries)).toEqual(['c']);
    expect(ids(project(list, { keyword: 'bob' }).filteredEntries)).toEqual(['b']);
    expect(ids(project(list, { keyword: 'frost' }).filteredEntries)).toEqual(['a']);
    expect(
      ids(project(list, { hiddenAccounts: new Set(['Alice#1']) }).filteredEntries),
    ).toEqual(['b', 'c']);
    expect(ids(project(list, { priceMin: 100 }).filteredEntries)).toEqual(['a']);
    expect(ids(project(list, { priceMax: 100 }).filteredEntries)).toEqual(['b']);
    expect(ids(project(list, { priceMin: 100, rates: undefined }).filteredEntries)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('matches mods, tiers, multi-keywords, exclusions, fuzzy subsequences, and localized lines', () => {
    const rich = entries([
      {
        id: 'bow-t1',
        name: 'Victory Nock',
        typeLine: 'Imperial Bow',
        explicitMods: ['179% increased Physical Damage', '+54 to Dexterity'],
        extendedMods: { explicit: [{ name: 'Merciless', tier: 'P1' }, { tier: 'S1' }] },
      },
      {
        id: 'bow-hybrid',
        name: 'Bramble Thirst',
        typeLine: 'Citadel Bow',
        explicitMods: ['174% increased Physical Damage', 'Adds 37 to 68 Fire Damage'],
        extendedMods: { explicit: [{ tier: 'P7' }, { tier: 'P3' }] },
      },
      {
        id: 'ring-chaos',
        name: 'Miracle Loop',
        typeLine: 'Amethyst Ring',
        implicitMods: ['+23% to Chaos Resistance'],
        fracturedMods: ['+75 to maximum Life'],
      },
    ]);

    const localizedMap: Record<string, string[]> = {
      'bow-t1': ['帝國之弓', '增加 179% 物理傷害', '+54 敏捷', 'P1'],
      'bow-hybrid': ['城塞戰弓', '增加 174% 物理傷害', '附加 37 至 68 火焰傷害', 'P7 + P3'],
      'ring-chaos': ['紫晶戒指', '+23% 混沌抗性', '+75 最大生命'],
    };

    const match = (keyword: string) =>
      ids(
        project(rich, {
          keyword,
          extraSearchLines: (entry) => localizedMap[entry.id] ?? [],
        }).filteredEntries,
      );

    expect(match('physical')).toEqual(['bow-t1', 'bow-hybrid']);
    expect(match('merciless')).toEqual(['bow-t1']);
    expect(match('p1')).toEqual(['bow-t1']);
    expect(match('chaos resistance')).toEqual(['ring-chaos']);
    expect(match('帝國之弓')).toEqual(['bow-t1']);
    expect(match('火焰傷害')).toEqual(['bow-hybrid']);
    expect(match('物理傷')).toEqual(['bow-t1', 'bow-hybrid']);
    expect(match('混抗')).toEqual(['ring-chaos']);
    expect(match('physdmg')).toEqual(['bow-t1', 'bow-hybrid']);
    expect(match('物理傷 p1')).toEqual(['bow-t1']);
    expect(match('物理傷 -火焰')).toEqual(['bow-t1']);
    expect(match('弓 -城塞')).toEqual(['bow-t1']);
  });
});

describe('board-projection: seller aggregation, sorting, filtering and item-vs-seller parity', () => {
  it('groups characters per account, calculates totals/ranges/presence, and sorts sellers', () => {
    const list = entries([
      { id: 'a', account: 'A#1', character: 'Old', indexed: '2026-11-18T00:00:00Z', amount: 1, currency: 'divine', online: 'offline' },
      { id: 'b', account: 'B#2', amount: 50, currency: 'chaos' },
      { id: 'c', account: 'A#1', character: 'New', indexed: '2026-11-19T00:00:00Z', amount: 50, currency: 'chaos', online: 'afk' },
      { id: 'd', account: 'A#1', character: 'Old', indexed: '2026-11-17T00:00:00Z', amount: 999, currency: 'chaos', instantBuyout: false, online: 'offline' },
    ]);

    const { sellers } = project(list, { view: 'sellers' });
    expect(sellers.map((s) => s.account)).toEqual(['A#1', 'B#2']);
    expect(sellers[0]).toMatchObject({
      account: 'A#1',
      character: 'New',
      presence: 'afk',
      instantBuyoutCount: 2,
      total: { kind: 'converted', currency: 'chaos', amount: 250, unconverted: 0 },
      priceRange: { min: { amount: 50, currency: 'chaos' }, max: { amount: 999, currency: 'chaos' } },
    });
  });

  it('handles price range without rates (single vs mixed currency) and ranks incomplete totals after complete ones', () => {
    const singleCurrency = project(
      entries([
        { id: 'a', amount: 3, currency: 'divine' },
        { id: 'b', amount: 1, currency: 'divine' },
      ]),
      { rates: undefined, view: 'sellers' },
    );
    expect(singleCurrency.sellers[0].priceRange).toEqual({
      min: { amount: 1, currency: 'divine' },
      max: { amount: 3, currency: 'divine' },
    });

    const mixedCurrency = project(
      entries([
        { id: 'a', amount: 3, currency: 'divine' },
        { id: 'b', amount: 1, currency: 'chaos' },
      ]),
      { rates: undefined, view: 'sellers' },
    );
    expect(mixedCurrency.sellers[0].priceRange).toBeUndefined();
    expect(mixedCurrency.sellers[0].total).toEqual({
      kind: 'per-currency',
      totals: [
        { currency: 'divine', amount: 3 },
        { currency: 'chaos', amount: 1 },
      ],
      unpriced: 0,
    });

    const partialVsComplete = project(
      entries([
        { id: 'a', account: 'Partial#1', amount: 1, currency: 'mirror' },
        { id: 'b', account: 'Partial#1', amount: 1 },
        { id: 'c', account: 'Complete#2', amount: 90 },
        { id: 'd', account: 'Complete#2', amount: 90 },
      ]),
      { view: 'sellers' },
    );
    expect(partialVsComplete.sellers.map((s) => s.account)).toEqual(['Complete#2', 'Partial#1']);
  });

  it('filters sellers by minInstantBuyout and hiddenAccounts, and sinks all-sold sellers while keeping threshold stability', () => {
    const list = entries([
      { id: 'a1', account: 'SoldOut#1', amount: 5, stash: { name: '1' } },
      { id: 'a2', account: 'SoldOut#1', amount: 5, stash: { name: '1' } },
      { id: 'b1', account: 'Partial#2', amount: 10, stash: { name: 'A' } },
      { id: 'b2', account: 'Partial#2', amount: 20, stash: { name: 'B' } },
      { id: 'c1', account: 'Hidden#3', amount: 10 },
      { id: 'c2', account: 'Hidden#3', amount: 10 },
    ]);
    const res = project(list, {
      view: 'sellers',
      marks: { a1: 'sold', a2: 'sold', b1: 'sold' },
      minSellerCount: 2,
      hiddenAccounts: new Set(['Hidden#3']),
    });
    expect(res.sellers.map((s) => s.account)).toEqual(['Partial#2', 'SoldOut#1']);
    expect(res.sellers[0]).toMatchObject({
      instantBuyoutCount: 1,
      totalInstantBuyoutCount: 2,
      soldCount: 1,
      allSold: false,
      stashTabCount: 1,
      total: { kind: 'converted', currency: 'chaos', amount: 20, unconverted: 0 },
    });
    expect(res.sellers[1]).toMatchObject({
      instantBuyoutCount: 0,
      totalInstantBuyoutCount: 2,
      soldCount: 2,
      allSold: true,
    });
  });

  it('preserves sold items in Seller list under hideSold with no filters, keyword filters, and modConditions, while Item list hides them', () => {
    const PHYS_HASH = 'explicit.stat_1509134228';
    const list = entries([
      {
        id: 's1',
        account: 'Vendor#1',
        name: 'Imperial Bow',
        amount: 50,
        extendedMods: {
          explicit: [{ name: 'Merciless', tier: 'P1', magnitudes: [{ hash: PHYS_HASH, min: '170', max: '179' }] }],
        },
      },
      {
        id: 's2',
        account: 'Vendor#1',
        name: 'Imperial Bow',
        amount: 50,
        extendedMods: {
          explicit: [{ name: 'Merciless', tier: 'P1', magnitudes: [{ hash: PHYS_HASH, min: '170', max: '179' }] }],
        },
      },
      { id: 'o1', account: 'Other#2', name: 'Amethyst Ring', amount: 10 },
    ]);
    const marks = { s1: 'sold' as const };

    // Without keyword/mods: Item list hides s1, Seller list keeps Vendor#1 at totalInstantBuyoutCount = 2
    const noKeyword = project(list, {
      view: 'sellers',
      marks,
      hideSold: true,
      minSellerCount: 2,
    });
    expect(ids(noKeyword.filteredEntries)).toEqual(['s2', 'o1']);
    expect(noKeyword.sellers.map((s) => s.account)).toEqual(['Vendor#1']);
    expect(noKeyword.sellers[0].totalInstantBuyoutCount).toBe(2);
    expect(noKeyword.sellers[0].instantBuyoutCount).toBe(1);

    // With keyword: Item list hides s1, Seller list STILL keeps Vendor#1 at totalInstantBuyoutCount = 2
    const withKeyword = project(list, {
      view: 'sellers',
      marks,
      hideSold: true,
      keyword: 'imperial',
      minSellerCount: 2,
    });
    expect(ids(withKeyword.filteredEntries)).toEqual(['s2']);
    expect(withKeyword.sellers.map((s) => s.account)).toEqual(['Vendor#1']);
    expect(withKeyword.sellers[0].totalInstantBuyoutCount).toBe(2);
    expect(withKeyword.sellers[0].instantBuyoutCount).toBe(1);
    expect(Array.from(withKeyword.matchedIds)).toEqual(['s1', 's2']);

    // With modConditions + hideSold: Item list hides s1, Seller list STILL keeps Vendor#1 at totalInstantBuyoutCount = 2
    const physKey = noKeyword.modOptions.find((o) => !o.isHybrid && o.hashes[0] === PHYS_HASH)!.key;
    const withMods = project(list, {
      view: 'sellers',
      marks,
      hideSold: true,
      modConditions: [{ key: physKey, maxTier: 1 }],
      minSellerCount: 2,
    });
    expect(ids(withMods.filteredEntries)).toEqual(['s2']);
    expect(withMods.sellers.map((s) => s.account)).toEqual(['Vendor#1']);
    expect(withMods.sellers[0].totalInstantBuyoutCount).toBe(2);
    expect(withMods.sellers[0].instantBuyoutCount).toBe(1);
    expect(Array.from(withMods.matchedIds)).toEqual(['s1', 's2']);
  });

  it('projects seller stash groups lazily sorted by price with sold items and all-sold tabs sunk', () => {
    const list = entries([
      { id: 'a', account: 'S#1', amount: 1, currency: 'divine', stash: { name: 'SoldTab' } },
      { id: 'b', account: 'S#1', amount: 50, currency: 'chaos', stash: { name: 'MixTab' } },
      { id: 'c', account: 'S#1', amount: 10, currency: 'chaos', stash: { name: 'MixTab' } },
      { id: 'd', account: 'S#1', amount: 20, currency: 'chaos', stash: { name: 'MixTab' } },
    ]);
    const { sellers, soldIds } = project(list, {
      view: 'sellers',
      marks: { a: 'sold', c: 'sold' },
    });
    const groups = projectSellerStashGroups(sellers[0], rates, soldIds);
    expect(
      groups.map((g) => ({
        stashName: g.stashName,
        ids: g.entries.map((e) => e.id),
        instantBuyoutCount: g.instantBuyoutCount,
        allSold: g.allSold,
      })),
    ).toEqual([
      { stashName: 'MixTab', ids: ['d', 'b', 'c'], instantBuyoutCount: 2, allSold: false },
      { stashName: 'SoldTab', ids: ['a'], instantBuyoutCount: 0, allSold: true },
    ]);
  });
});

describe('board-projection: independent mod options, faceted counts, and structured mods', () => {
  const PHYS_HASH = 'explicit.stat_1509134228';
  const ACC_HASH = 'explicit.stat_691932474';
  const IMPALE_HASH = 'explicit.stat_3377888098';
  const ASPD_HASH = 'explicit.stat_210067635';
  const STAT_LABELS: Record<string, string> = {
    [PHYS_HASH]: '增加 #% 物理傷害',
    [ACC_HASH]: '+# 命中值',
    [IMPALE_HASH]: '攻擊擊中時有 #% 機率穿刺敵人',
    [ASPD_HASH]: '增加 #% 攻擊速度',
  };
  const resolveStatLabel = (hash: string) => STAT_LABELS[hash] ?? hash;

  it('distinguishes pure vs hybrid mods, computes faceted counts, and filters picker options', () => {
    const list = [
      toBoardEntry(
        rawResult({
          id: 'pure-t1',
          extendedMods: {
            explicit: [
              { name: 'Merciless', tier: 'P1', magnitudes: [{ hash: PHYS_HASH, min: '170', max: '179' }] },
              { name: 'of Celebration', tier: 'S1', magnitudes: [{ hash: ASPD_HASH, min: '17', max: '19' }] },
            ],
          },
        }),
        0,
      )!,
      toBoardEntry(
        rawResult({
          id: 'pure-t1-plus-hybrid',
          extendedMods: {
            explicit: [
              { name: 'Merciless', tier: 'P1', magnitudes: [{ hash: PHYS_HASH, min: '170', max: '179' }] },
              {
                name: 'Squire',
                tier: 'P8',
                magnitudes: [
                  { hash: PHYS_HASH, min: '15', max: '19' },
                  { hash: ACC_HASH, min: '16', max: '20' },
                ],
              },
            ],
          },
        }),
        1,
      )!,
      toBoardEntry(
        rawResult({
          id: 'fake-t1-p3-p4',
          extendedMods: {
            explicit: [
              { name: 'Cruel', tier: 'P3', magnitudes: [{ hash: PHYS_HASH, min: '135', max: '154' }] },
              {
                name: 'Champion',
                tier: 'P4',
                magnitudes: [
                  { hash: PHYS_HASH, min: '45', max: '54' },
                  { hash: ACC_HASH, min: '98', max: '123' },
                ],
              },
            ],
          },
        }),
        2,
      )!,
      toBoardEntry(
        rawResult({
          id: 'hybrid-t1-impale',
          extendedMods: {
            explicit: [
              {
                name: 'Transfixing',
                tier: 'P1',
                magnitudes: [
                  { hash: PHYS_HASH, min: '115', max: '129' },
                  { hash: IMPALE_HASH, min: '21', max: '25' },
                ],
              },
            ],
          },
        }),
        3,
      )!,
    ];

    const base = project(list, { resolveStatLabel });
    const purePhys = base.modOptions.find((o) => !o.isHybrid && o.hashes[0] === PHYS_HASH)!;
    const hybridAcc = base.modOptions.find(
      (o) => o.isHybrid && o.hashes.includes(PHYS_HASH) && o.hashes.includes(ACC_HASH),
    )!;
    const hybridImpale = base.modOptions.find(
      (o) => o.isHybrid && o.hashes.includes(PHYS_HASH) && o.hashes.includes(IMPALE_HASH),
    )!;
    const aspdOpt = base.modOptions.find((o) => o.hashes[0] === ASPD_HASH)!;

    expect(purePhys.label).toBe('增加 #% 物理傷害');
    expect(purePhys.itemCount).toBe(3);
    expect(purePhys.tierCounts).toEqual({ 1: 2, 2: 2, 3: 3 });
    expect(purePhys.bestTier).toBe('P1');
    expect(purePhys.sampleNames).toEqual(expect.arrayContaining(['Merciless', 'Cruel']));
    expect(hybridAcc.tierCounts).toEqual({ 1: 0, 2: 0, 3: 0 });
    expect(hybridImpale.tierCounts).toEqual({ 1: 1, 2: 1, 3: 1 });

    // Filter by pure %phys T1 -> matches only pure-t1 & pure-t1-plus-hybrid, and computes faceted counts
    const withT1 = project(list, {
      resolveStatLabel,
      modConditions: [{ key: purePhys.key, maxTier: 1 }],
    });
    expect(ids(withT1.filteredEntries)).toEqual(['pure-t1', 'pure-t1-plus-hybrid']);
    expect(withT1.modOptionByKey.get(purePhys.key)?.itemCount).toBe(3);
    expect(withT1.modOptionByKey.get(aspdOpt.key)?.itemCount).toBe(1);
    expect(withT1.modOptionByKey.get(hybridAcc.key)?.itemCount).toBe(1);
    expect(withT1.modOptionByKey.get(hybridImpale.key)?.itemCount).toBe(0);
    // Selected option pins to top, 0-count option sinks to bottom
    expect(withT1.filteredModOptions[0].key).toBe(purePhys.key);
    expect(withT1.filteredModOptions[withT1.filteredModOptions.length - 1].key).toBe(
      hybridImpale.key,
    );

    // Filter by pure %phys <=T3 and AND with Attack Speed T1
    expect(
      ids(
        project(list, {
          resolveStatLabel,
          modConditions: [{ key: purePhys.key, maxTier: 3 }],
        }).filteredEntries,
      ),
    ).toEqual(['pure-t1', 'pure-t1-plus-hybrid', 'fake-t1-p3-p4']);
    expect(
      ids(
        project(list, {
          resolveStatLabel,
          modConditions: [
            { key: purePhys.key, maxTier: 1 },
            { key: aspdOpt.key, maxTier: 1 },
          ],
        }).filteredEntries,
      ),
    ).toEqual(['pure-t1']);

    // Picker fuzzy & quick filters
    expect(
      project(list, { resolveStatLabel, modPickerQuery: '物理傷 單詞' }).filteredModOptions.map(
        (o) => o.key,
      ),
    ).toEqual([purePhys.key]);
    expect(
      project(list, { resolveStatLabel, modPickerQuery: '物理傷 複合' }).filteredModOptions.map(
        (o) => o.key,
      ),
    ).toEqual([hybridAcc.key, hybridImpale.key]);
    expect(
      project(list, { resolveStatLabel, modQuickFilter: 'pure' }).filteredModOptions.every(
        (o) => !o.isHybrid,
      ),
    ).toBe(true);
    expect(
      project(list, { resolveStatLabel, modQuickFilter: 'hybrid' }).filteredModOptions.every(
        (o) => o.isHybrid,
      ),
    ).toBe(true);
    expect(
      project(list, { resolveStatLabel, modQuickFilter: 't1' }).filteredModOptions.some(
        (o) => o.key === hybridAcc.key,
      ),
    ).toBe(false);
  });

  it('projects structured official *Mods entries with extended.hashes (PoE 1 & PoE 2)', () => {
    const rawStructured = (id: string, itemOverrides: Record<string, unknown>) => {
      const base = rawResult({ id });
      return { ...base, item: { ...(base.item as Record<string, unknown>), ...itemOverrides } };
    };

    const list = [
      toBoardEntry(
        rawStructured('structured-pure-t1', {
          explicitMods: [
            {
              description: '234% increased Physical Damage',
              domain: 'explicit',
              hash: `stat.${PHYS_HASH}`,
              mods: [
                { name: "Conqueror's", tier: 'P3', level: 60, magnitudes: [{ min: '55', max: '64' }] },
                { name: 'Merciless', tier: 'P1', level: 83, magnitudes: [{ min: '170', max: '179' }] },
              ],
            },
            {
              description: '+135 to Accuracy Rating',
              domain: 'explicit',
              hash: `stat.${ACC_HASH}`,
              mods: [
                { name: "Conqueror's", tier: 'P3', level: 60, magnitudes: [{ min: '124', max: '149' }] },
              ],
            },
            {
              description: '19% increased Attack Speed',
              domain: 'fractured',
              hash: 'stat.fractured.stat_210067635',
              flags: { fractured: true },
              mods: [
                { name: 'of Celebration', tier: 'S1', level: 82, magnitudes: [{ min: '17', max: '19' }] },
              ],
            },
          ],
          implicitMods: [
            {
              description: '31% increased Critical Strike Chance',
              domain: 'implicit',
              hash: 'stat.implicit.stat_2375316951',
              mods: [{ magnitudes: [{ min: '30', max: '50' }] }],
            },
          ],
          extended: {
            hashes: {
              explicit: [
                [PHYS_HASH, [2, 5]],
                [ACC_HASH, [2]],
              ],
              fractured: [['fractured.stat_210067635', [0]]],
              implicit: [['implicit.stat_2375316951', [0]]],
            },
          },
        }),
        0,
      )!,
      toBoardEntry(
        rawStructured('structured-fallback-no-hashes', {
          explicitMods: [
            {
              description: '200% increased Physical Damage',
              domain: 'explicit',
              hash: `stat.${PHYS_HASH}`,
              mods: [
                { name: 'Cruel', tier: 'P3', level: 60, magnitudes: [{ min: '135', max: '154' }] },
                { name: "Champion's", tier: 'P4', level: 46, magnitudes: [{ min: '45', max: '54' }] },
              ],
            },
            {
              description: '+111 to Accuracy Rating',
              domain: 'explicit',
              hash: `stat.${ACC_HASH}`,
              mods: [
                { name: "Champion's", tier: 'P4', level: 46, magnitudes: [{ min: '98', max: '123' }] },
              ],
            },
          ],
          extended: {},
        }),
        1,
      )!,
    ];

    const base = project(list, { resolveStatLabel });
    const purePhys = base.modOptions.find((o) => !o.isHybrid && o.hashes[0] === PHYS_HASH)!;
    const hybridAcc = base.modOptions.find(
      (o) => o.isHybrid && o.hashes.includes(PHYS_HASH) && o.hashes.includes(ACC_HASH),
    )!;
    const implicitCrit = base.modOptions.find((o) => o.category === 'implicit')!;
    const fracturedAspd = base.modOptions.find((o) => o.category === 'fractured')!;

    expect(purePhys.itemCount).toBe(2);
    expect(purePhys.tierCounts).toEqual({ 1: 1, 2: 1, 3: 2 });
    expect(hybridAcc.tierCounts).toEqual({ 1: 0, 2: 0, 3: 1 });
    expect(implicitCrit.hasTiers).toBe(false);
    expect(fracturedAspd.hashes).toEqual(['fractured.stat_210067635']);

    expect(
      ids(
        project(list, {
          resolveStatLabel,
          modConditions: [{ key: purePhys.key, maxTier: 1 }],
        }).filteredEntries,
      ),
    ).toEqual(['structured-pure-t1']);
  });
});
