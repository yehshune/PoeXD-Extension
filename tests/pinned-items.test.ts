import { describe, expect, it } from 'vitest';
import {
  applyPinnedOrder,
  createPinnedItemSnapshot,
  createPinnedItemStore,
  isSameLeague,
  parsePinnedItemCommand,
  parseStoredPinnedList,
  PINNED_ITEM_LIMIT,
  pinnedItemStorageKey,
  type PinnedItemSnapshot,
  type PinnedItemStorage,
} from '@/utils/pinned-items';

const ITEM = {
  name: 'Kraken Span',
  typeLine: 'Goathide Boots',
  baseType: 'Goathide Boots',
  rarity: 'Rare',
  frameType: 2,
  ilvl: 70,
  icon: 'https://web.poecdn.com/gen/image/boots.png',
  explicitMods: ['+20 to Dexterity'],
  extended: { hashes: { explicit: [['explicit.stat_3261801346', [0]]] } },
  // 白名單外的欄位
  secretFlag: 'drop me',
};

const LISTING = {
  method: 'psapi',
  indexed: '2026-11-16T23:47:45Z',
  price: { type: '~b/o', amount: 1, currency: 'alch' },
  account: { name: 'seller#1234', online: { league: 'Covens' } },
  whisper: '@Char Hi, I would like to buy your Kraken Span',
  whisper_token: 'jwt.whisper.token',
  hideout_token: 'jwt.hideout.token',
  fee: 301,
  stash: { name: '9', x: 10, y: 7 },
};

const SOURCE = {
  gameVersion: 'poe1' as const,
  origin: 'https://www.pathofexile.com',
  league: 'Covens',
  sourceSearchId: 'abc123',
  locale: 'en',
};

function snapshot(id = 'r1', pinnedAt = 1): PinnedItemSnapshot {
  const result = createPinnedItemSnapshot({ id, item: ITEM, listing: LISTING }, SOURCE, pinnedAt);
  if (!result) throw new Error('snapshot failed');
  return result;
}

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const storage: PinnedItemStorage = {
    get: async (keys) => Object.fromEntries(keys.map((k) => [k, data[k]])),
    set: async (values) => {
      Object.assign(data, values);
    },
  };
  return { data, storage };
}

describe('createPinnedItemSnapshot', () => {
  it('keeps whitelisted fields and never stores tokens', () => {
    const result = snapshot();
    expect(result.item).not.toHaveProperty('secretFlag');
    expect(result.item.explicitMods).toEqual(['+20 to Dexterity']);
    expect(result.listing).toEqual({
      method: 'psapi',
      indexed: '2026-11-16T23:47:45Z',
      price: { type: '~b/o', amount: 1, currency: 'alch' },
      accountName: 'seller#1234',
      whisper: LISTING.whisper,
      fee: 301,
      stash: { name: '9', x: 10, y: 7 },
      instantBuyout: true,
    });
    expect(JSON.stringify(result)).not.toContain('jwt.');
    expect(result).toMatchObject({ realm: 'international', league: 'Covens', locale: 'en' });
  });

  it('drops icons that are not on the official CDN', () => {
    const result = createPinnedItemSnapshot(
      { id: 'r1', item: { ...ITEM, icon: 'https://evil.example/x.png' }, listing: LISTING },
      SOURCE,
      1,
    );
    expect(result?.item.icon).toBeUndefined();
  });

  it('rejects unsupported origins and items without a type line', () => {
    expect(
      createPinnedItemSnapshot(
        { id: 'r1', item: ITEM, listing: LISTING },
        { ...SOURCE, origin: 'https://evil.example' },
        1,
      ),
    ).toBeUndefined();
    expect(
      createPinnedItemSnapshot({ id: 'r1', item: { name: 'x' }, listing: LISTING }, SOURCE, 1),
    ).toBeUndefined();
  });

  it('keeps the row currency icon only from the official CDN', () => {
    const icon = 'https://web.poecdn.com/gen/image/divine.png';
    const withIcon = createPinnedItemSnapshot(
      { id: 'r1', item: ITEM, listing: LISTING },
      { ...SOURCE, currency: { icon, name: 'Divine Orb' } },
      1,
    );
    expect(withIcon?.listing.price).toEqual({
      type: '~b/o',
      amount: 1,
      currency: 'alch',
      icon,
      currencyName: 'Divine Orb',
    });
    expect(parseStoredPinnedList([withIcon], 'poe1').items[0]?.listing.price?.icon).toBe(icon);

    const foreign = createPinnedItemSnapshot(
      { id: 'r1', item: ITEM, listing: LISTING },
      { ...SOURCE, currency: { icon: 'https://evil.example/divine.png' } },
      1,
    );
    expect(foreign?.listing.price?.icon).toBeUndefined();
  });

  it('round-trips through storage parsing', () => {
    const stored = JSON.parse(JSON.stringify([snapshot()]));
    expect(parseStoredPinnedList(stored, 'poe1').items).toEqual([snapshot()]);
    // 其他遊戲版本的資料不會混進來
    expect(parseStoredPinnedList(stored, 'poe2')).toEqual({ items: [], unparsed: stored });
  });
});

describe('createPinnedItemStore', () => {
  const key = pinnedItemStorageKey('poe1');

  it('pins newest first and replaces an existing pin of the same item', async () => {
    const { data, storage } = memoryStorage();
    const store = createPinnedItemStore(storage);
    await store.execute({ type: 'pin', gameVersion: 'poe1', snapshot: snapshot('a', 1) });
    await store.execute({ type: 'pin', gameVersion: 'poe1', snapshot: snapshot('b', 2) });
    await store.execute({ type: 'pin', gameVersion: 'poe1', snapshot: snapshot('a', 3) });
    expect((data[key] as PinnedItemSnapshot[]).map((i) => [i.id, i.pinnedAt])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('rejects new pins at the limit instead of dropping the oldest', async () => {
    const full = Array.from({ length: PINNED_ITEM_LIMIT }, (_, i) => snapshot(`id${i}`));
    const { data, storage } = memoryStorage({ [key]: full });
    const store = createPinnedItemStore(storage);
    const outcome = await store.execute({
      type: 'pin',
      gameVersion: 'poe1',
      snapshot: snapshot('new'),
    });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'limit' } });
    expect(data[key]).toHaveLength(PINNED_ITEM_LIMIT);
    // 已釘選的物品重新釘選不受上限影響
    await expect(
      store.execute({ type: 'pin', gameVersion: 'poe1', snapshot: snapshot('id0', 9) }),
    ).resolves.toEqual({ ok: true });
  });

  it('unpins, clears one league, and keeps unparsed entries', async () => {
    const other = { ...snapshot('other'), league: 'Standard' };
    const unknown = { future: true };
    const { data, storage } = memoryStorage({ [key]: [snapshot('a'), other, unknown] });
    const store = createPinnedItemStore(storage);
    await store.execute({ type: 'unpin', gameVersion: 'poe1', id: 'a' });
    expect(data[key]).toEqual([other, unknown]);
    await store.execute({ type: 'clear', gameVersion: 'poe1', league: 'Standard' });
    expect(data[key]).toEqual([unknown]);
  });

  it('clears a league regardless of case (console subscriptions use lowercase)', async () => {
    const consolePin = { ...snapshot('console'), league: 'covens' };
    const pagePin = { ...snapshot('page'), league: 'Covens' };
    const other = { ...snapshot('other'), league: 'Standard' };
    const { data, storage } = memoryStorage({ [key]: [consolePin, pagePin, other] });
    await createPinnedItemStore(storage).execute({
      type: 'clear',
      gameVersion: 'poe1',
      league: 'Covens',
    });
    expect(data[key]).toEqual([other]);
  });

  it('rejects invalid commands and snapshots', async () => {
    const { storage } = memoryStorage();
    const store = createPinnedItemStore(storage);
    await expect(store.execute({ type: 'drop-table' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    await expect(
      store.execute({ type: 'pin', gameVersion: 'poe1', snapshot: { id: 'x' } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } });
  });

  it('reorders the listed pins within their own slots and leaves the rest in place', async () => {
    const other = { ...snapshot('x'), league: 'Standard' };
    const unknown = { future: true };
    const { data, storage } = memoryStorage({
      [key]: [snapshot('a'), other, snapshot('b'), unknown, snapshot('c')],
    });
    await expect(
      createPinnedItemStore(storage).execute({
        type: 'reorder',
        gameVersion: 'poe1',
        ids: ['c', 'missing', 'a', 'b'],
      }),
    ).resolves.toEqual({ ok: true });
    expect((data[key] as { id?: string }[]).map((entry) => entry.id ?? 'unknown')).toEqual([
      'c',
      'x',
      'a',
      'b',
      // 無法解析的項目照既有規則保留在最後
      'unknown',
    ]);
  });

  it('serializes concurrent writes', async () => {
    const { data, storage } = memoryStorage();
    const store = createPinnedItemStore(storage);
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        store.execute({ type: 'pin', gameVersion: 'poe1', snapshot: snapshot(id) }),
      ),
    );
    expect(data[key]).toHaveLength(3);
  });

  it('marks an item sold, clears sold on re-pin, and clears sold items selectively', async () => {
    const covens1 = { ...snapshot('a', 1), league: 'Covens' };
    const covens2 = { ...snapshot('b', 2), league: 'Covens' };
    const standard = { ...snapshot('c', 3), league: 'Standard' };
    const { data, storage } = memoryStorage({ [key]: [covens1, covens2, standard] });
    const store = createPinnedItemStore(storage);
    const stored = () => data[key] as PinnedItemSnapshot[];

    await expect(
      store.execute({ type: 'mark-sold', gameVersion: 'poe1', id: 'a' }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(stored().find((x) => x.id === 'a')?.sold).toBe(true);
    expect(stored().find((x) => x.id === 'b')?.sold).toBeUndefined();

    // Mark c sold as well to verify league-scoped clear-sold
    await store.execute({ type: 'mark-sold', gameVersion: 'poe1', id: 'c' });

    // Clearing sold in Covens only removes 'a'
    await expect(
      store.execute({ type: 'clear-sold', gameVersion: 'poe1', league: 'covens' }),
    ).resolves.toEqual({ ok: true });
    expect(stored().map((x) => x.id)).toEqual(['b', 'c']);

    // Re-pinning 'c' replaces it with a fresh snapshot (not sold)
    await expect(
      store.execute({
        type: 'pin',
        gameVersion: 'poe1',
        snapshot: { ...snapshot('c', 4), league: 'Standard' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(stored().find((x) => x.id === 'c')?.sold).toBeUndefined();

    // Marking 'b' sold then clearing sold globally removes only sold items
    await store.execute({ type: 'mark-sold', gameVersion: 'poe1', id: 'b' });
    await expect(store.execute({ type: 'clear-sold', gameVersion: 'poe1' })).resolves.toEqual({
      ok: true,
    });
    expect(stored().map((x) => x.id)).toEqual(['c']);
  });
});

describe('parseStoredPinnedList sold flag', () => {
  it('preserves sold: true and ignores non-boolean sold values', () => {
    const parsed = parseStoredPinnedList(
      [{ ...snapshot('a'), sold: true }, { ...snapshot('b'), sold: 'yes' }, snapshot('c')],
      'poe1',
    );
    expect(parsed.items.map((x) => [x.id, x.sold])).toEqual([
      ['a', true],
      ['b', undefined],
      ['c', undefined],
    ]);
  });
});

describe('applyPinnedOrder', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

  it('returns a new array without touching the input', () => {
    const next = applyPinnedOrder(list, ['d', 'a']);
    expect(next.map((item) => item.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(list.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores unknown and repeated ids', () => {
    expect(applyPinnedOrder(list, ['b', 'b', 'zz', 'a']).map((item) => item.id)).toEqual([
      'b',
      'a',
      'c',
      'd',
    ]);
  });
});

describe('isSameLeague', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(isSameLeague('covens', 'Covens')).toBe(true);
    expect(isSameLeague(' Covens ', 'COVENS')).toBe(true);
    expect(isSameLeague('Covens', 'Standard')).toBe(false);
  });
});

describe('parsePinnedItemCommand', () => {
  it('validates the game version and fields', () => {
    expect(parsePinnedItemCommand({ type: 'unpin', gameVersion: 'poe3', id: 'a' })).toBeUndefined();
    expect(parsePinnedItemCommand({ type: 'unpin', gameVersion: 'poe1', id: '' })).toBeUndefined();
    expect(
      parsePinnedItemCommand({ type: 'clear', gameVersion: 'poe2', league: 5 }),
    ).toBeUndefined();
    expect(parsePinnedItemCommand({ type: 'clear', gameVersion: 'poe2' })).toEqual({
      type: 'clear',
      gameVersion: 'poe2',
    });
    expect(
      parsePinnedItemCommand({ type: 'mark-sold', gameVersion: 'poe1', id: '' }),
    ).toBeUndefined();
    expect(parsePinnedItemCommand({ type: 'mark-sold', gameVersion: 'poe1', id: 'a' })).toEqual({
      type: 'mark-sold',
      gameVersion: 'poe1',
      id: 'a',
    });
    expect(
      parsePinnedItemCommand({ type: 'clear-sold', gameVersion: 'poe1', league: 5 }),
    ).toBeUndefined();
    expect(
      parsePinnedItemCommand({ type: 'clear-sold', gameVersion: 'poe1', league: 'Covens' }),
    ).toEqual({
      type: 'clear-sold',
      gameVersion: 'poe1',
      league: 'Covens',
    });
  });

  it('validates reorder ids', () => {
    const reorder = (ids: unknown) =>
      parsePinnedItemCommand({ type: 'reorder', gameVersion: 'poe1', ids });
    expect(reorder(['a', 'b'])).toEqual({ type: 'reorder', gameVersion: 'poe1', ids: ['a', 'b'] });
    expect(reorder('a')).toBeUndefined();
    expect(reorder(['a', 'a'])).toBeUndefined();
    expect(reorder(['a', 5])).toBeUndefined();
    expect(reorder([''])).toBeUndefined();
    expect(reorder(Array.from({ length: 101 }, (_, i) => `id${i}`))).toBeUndefined();
  });
});
