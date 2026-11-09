import { describe, expect, it, vi } from 'vitest';
import {
  buildTradeSearchCriteriaKey,
  createTradeSearchCriteriaKeyResolver,
  fingerprintTradeQuery,
} from '@/utils/trade-search-criteria-key';
import {
  createConnectionDedup,
  dedupePreviousConnectionItems,
  shouldAdoptExisting,
  type DedupEntry,
} from '@/entrypoints/content/logic/live-search-connection-dedup';
import { getTradeSearchCanonicalKey } from '@/utils/trade-search-identity';
import { reuseUnchangedItems } from '@/components/sidebar/bookmark-model';

const COVER = 'https://web.poecdn.com/gen/image/item.png';
const id = (searchId: string, league = 'Standard') => ({
  gameVersion: 'poe1' as const,
  league,
  searchId,
});

/** 以 searchId 對應假查詢內容，模擬「不同 search ID、相同條件」。 */
const QUERIES: Record<string, unknown> = {
  A1: { query: { status: { option: 'online' }, type: 'Ring' }, sort: { price: 'asc' } },
  A2: { sort: { price: 'desc' }, query: { type: 'Ring', status: { option: 'online' } } },
  B: { query: { type: 'Amulet' } },
};
const decode = vi.fn(async (searchId: string) => {
  if (!(searchId in QUERIES)) throw new Error('undecodable');
  return QUERIES[searchId];
});

describe('搜尋條件鍵', () => {
  it('忽略 sort 與欄位順序', () => {
    expect(fingerprintTradeQuery(QUERIES.A1)).toBe(fingerprintTradeQuery(QUERIES.A2));
    expect(fingerprintTradeQuery(QUERIES.A1)).not.toBe(fingerprintTradeQuery(QUERIES.B));
    expect(fingerprintTradeQuery(null)).toBeNull();
  });

  it('解碼失敗時退回 canonical key，且結果會快取', async () => {
    const resolver = createTradeSearchCriteriaKeyResolver(decode);
    expect(resolver.peek(id('X'))).toBeUndefined();
    expect(await resolver.resolve(id('X'))).toBe(getTradeSearchCanonicalKey(id('X')));
    expect(resolver.peek(id('X'))).toBe(getTradeSearchCanonicalKey(id('X')));
    const callsBefore = decode.mock.calls.length;
    await resolver.resolve(id('X'));
    expect(decode.mock.calls.length).toBe(callsBefore);
  });

  it('條件鍵包含版本與聯盟（大小寫無關）', () => {
    expect(buildTradeSearchCriteriaKey(id('A1', 'Mercenaries'), 'abc')).toBe(
      'poe1:mercenaries:q:abc',
    );
  });
});

describe('有圖片優先', () => {
  it('只有既有項目有圖、新加入者沒有時才沿用既有', () => {
    expect(shouldAdoptExisting(undefined, COVER)).toBe(true);
    expect(shouldAdoptExisting(COVER, COVER)).toBe(false);
    expect(shouldAdoptExisting(COVER, undefined)).toBe(false);
    expect(shouldAdoptExisting(undefined, undefined)).toBe(false);
  });
});

describe('createConnectionDedup', () => {
  const entry = (searchId: string, extra: Partial<DedupEntry> = {}): DedupEntry => ({
    key: getTradeSearchCanonicalKey(id(searchId)),
    identity: id(searchId),
    ...extra,
  });

  it('本次連線優先於上次連線，並辨識相同條件', async () => {
    const dedup = createConnectionDedup({
      resolver: createTradeSearchCriteriaKeyResolver(decode),
      listSessionEntries: () => [entry('A1')],
      listPreviousEntries: () => [entry('A2')],
    });
    const match = await dedup.findEquivalent(id('A2'), getTradeSearchCanonicalKey(id('A2')));
    expect(match).toMatchObject({
      section: 'session',
      sameKey: false,
      entry: { identity: { searchId: 'A1' } },
    });
  });

  it('同一 search ID 視為 sameKey；不同聯盟不視為相同', async () => {
    const dedup = createConnectionDedup({
      resolver: createTradeSearchCriteriaKeyResolver(decode),
      listSessionEntries: () => [],
      listPreviousEntries: () => [entry('A1')],
    });
    expect(
      await dedup.findEquivalent(id('A1'), getTradeSearchCanonicalKey(id('A1'))),
    ).toMatchObject({ section: 'previous', sameKey: true });
    const otherLeague = id('A2', 'Hardcore');
    expect(
      await dedup.findEquivalent(otherLeague, getTradeSearchCanonicalKey(otherLeague)),
    ).toBeNull();
  });
});

describe('dedupePreviousConnectionItems', () => {
  const item = (searchId: string, coverImageUrl?: string) => ({
    canonicalKey: getTradeSearchCanonicalKey(id(searchId)),
    canonicalIdentity: id(searchId),
    coverImageUrl,
    name: searchId,
  });

  it('移除與本次連線相同條件者，並合併相同條件（有圖片優先）', async () => {
    const resolver = createTradeSearchCriteriaKeyResolver(decode);
    await resolver.resolveMany([id('A1'), id('A2'), id('B')]);
    const result = dedupePreviousConnectionItems(
      [item('A1'), item('A2', COVER), item('B')],
      [],
      (identity) => resolver.peek(identity),
    );
    expect(result.items.map((i) => i.name)).toEqual(['A2', 'B']);
    expect(result.unresolved).toEqual([]);

    const withSession = dedupePreviousConnectionItems(
      [item('A1'), item('B')],
      [item('A2')],
      (identity) => resolver.peek(identity),
    );
    expect(withSession.items.map((i) => i.name)).toEqual(['B']);
  });

  it('尚未解析的項目以 canonical key 處理並回報待解析', () => {
    const result = dedupePreviousConnectionItems([item('A1'), item('A1')], [], () => undefined);
    expect(result.items).toHaveLength(1);
    expect(result.unresolved.length).toBeGreaterThan(0);
  });
});

describe('reuseUnchangedItems（書籤投影結構共享）', () => {
  it('內容相同時沿用原物件與原陣列', () => {
    const prev = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const same = reuseUnchangedItems(prev, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    expect(same).toBe(prev);
  });

  it('只替換有變更的項目', () => {
    const prev = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const next = reuseUnchangedItems(prev, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B2' },
      { id: 'c', name: 'C' },
    ]);
    expect(next).not.toBe(prev);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).not.toBe(prev[1]);
    expect(next.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
