import { describe, expect, it } from 'vitest';
import { toBoardEntry } from '@/utils/result-board/board-entry';
import {
  appendToLedger,
  createLedger,
  ledgerForSearch,
  skipInLedger,
} from '@/utils/result-board/board-ledger';
import { rawResult } from './helpers/result-board-fixtures';

describe('toBoardEntry', () => {
  it('normalizes an instant buyout result', () => {
    const entry = toBoardEntry(
      rawResult({ id: 'a', name: 'Doom Shell', amount: 5, currency: 'divine' }),
      3,
    );
    expect(entry).toEqual({
      id: 'a',
      order: 3,
      name: 'Doom Shell',
      typeLine: 'Vaal Regalia',
      baseType: 'Vaal Regalia',
      frameType: 2,
      icon: 'https://web.poecdn.com/x.png',
      price: { amount: 5, currency: 'divine' },
      note: '~price 5 divine',
      indexedAt: Date.parse('2026-11-19T10:00:00Z'),
      instantBuyout: true,
      seller: { account: 'Seller#0001', character: 'SellerChar', presence: 'online' },
    });
  });

  it('marks whisper-only results and reads seller presence', () => {
    expect(toBoardEntry(rawResult({ id: 'a', instantBuyout: false }), 0)?.instantBuyout).toBe(
      false,
    );
    expect(toBoardEntry(rawResult({ id: 'a', online: 'afk' }), 0)?.seller.presence).toBe('afk');
    expect(toBoardEntry(rawResult({ id: 'a', online: 'offline' }), 0)?.seller.presence).toBe(
      'offline',
    );
  });

  it('drops an icon that is not on the official CDN', () => {
    const raw = rawResult({ id: 'a' });
    const entry = toBoardEntry(
      { ...raw, item: { ...(raw.item as object), icon: 'https://evil.example/x.png' } },
      0,
    );
    expect(entry?.icon).toBeUndefined();
  });

  it('strips PoE 2 markup from names', () => {
    const entry = toBoardEntry(rawResult({ id: 'a', typeLine: '[Spear|長矛]' }), 0);
    expect(entry?.typeLine).toBe('長矛');
  });

  it('drops an unusable price and an invalid listing time but keeps the result', () => {
    const raw = rawResult({ id: 'a', amount: -1, indexed: 'not a date' });
    const entry = toBoardEntry(raw, 0);
    expect(entry?.price).toBeUndefined();
    expect(entry?.indexedAt).toBeUndefined();
  });

  it('rejects results without a seller account or item name', () => {
    const noAccount = {
      ...rawResult({ id: 'a' }),
      listing: { price: { amount: 1, currency: 'c' } },
    };
    expect(toBoardEntry(noAccount, 0)).toBeUndefined();
    const noName = { ...rawResult({ id: 'a' }), item: { frameType: 2 } };
    expect(toBoardEntry(noName, 0)).toBeUndefined();
    expect(toBoardEntry({ ...rawResult({ id: 'a' }), listing: undefined }, 0)).toBeUndefined();
  });
});

describe('ledger', () => {
  it('keeps the official order and ignores duplicates', () => {
    const ledger = appendToLedger(createLedger('search-1'), [
      rawResult({ id: 'a' }),
      rawResult({ id: 'b' }),
      rawResult({ id: 'a' }),
    ]);
    expect(ledger.entries.map((entry) => [entry.id, entry.order])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('does not mutate the previous ledger', () => {
    const first = appendToLedger(createLedger('search-1'), [rawResult({ id: 'a' })]);
    const second = appendToLedger(first, [rawResult({ id: 'b' })]);
    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(2);
  });

  it('ignores results from another search and counts malformed ones', () => {
    const ledger = appendToLedger(createLedger('search-1'), [
      rawResult({ id: 'a', searchId: 'search-2' }),
      { id: 'bad', item: {}, listing: undefined, receivedAt: 0, sourceSearchId: 'search-1' },
      rawResult({ id: 'b' }),
    ]);
    expect(ledger.entries.map((entry) => entry.id)).toEqual(['b']);
    expect(ledger.skippedIds).toEqual(['bad']);
  });

  it('counts a malformed result once when it arrives again', () => {
    const bad = {
      id: 'bad',
      item: {},
      listing: undefined,
      receivedAt: 0,
      sourceSearchId: 'search-1',
    };
    const first = appendToLedger(createLedger('search-1'), [bad]);
    const second = appendToLedger(first, [bad]);
    expect(second).toBe(first);
    expect(second.skippedIds).toEqual(['bad']);
  });

  it('ignores entries that are not results at all', () => {
    const junk = [null, 42, { id: '' }] as unknown as Parameters<typeof appendToLedger>[1];
    const ledger = createLedger('search-1');
    expect(appendToLedger(ledger, junk)).toBe(ledger);
  });

  it('starts over when the search changes and keeps itself otherwise', () => {
    const ledger = appendToLedger(createLedger('search-1'), [rawResult({ id: 'a' })]);
    expect(ledgerForSearch(ledger, 'search-1')).toBe(ledger);
    const next = ledgerForSearch(ledger, 'search-2');
    expect(next.searchId).toBe('search-2');
    expect(next.entries).toEqual([]);
  });
});

describe('skipInLedger', () => {
  it('adds unknown ids once and keeps the ledger when nothing is new', () => {
    const ledger = appendToLedger(createLedger('s1'), [rawResult({ id: 'a', searchId: 's1' })]);
    const skipped = skipInLedger(ledger, ['a', 'b', 'b', '']);
    expect(skipped.skippedIds).toEqual(['b']);
    expect(skipInLedger(skipped, ['a', 'b'])).toBe(skipped);
  });
});
