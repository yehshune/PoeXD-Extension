import { describe, expect, it, vi } from 'vitest';
import {
  SEARCH_RECORD_STATE_KEY,
  createChromeSearchRecordStorage,
  createInMemorySearchRecordStorage,
  createSearchRecordModule,
  isPortableSearchRecord,
  type SearchRecordState,
  type SearchRecordStorage,
} from '@/utils/search-records';

const poe1 = {
  gameVersion: 'poe1' as const,
  league: '  Settlers   HC ',
  searchId: 'abc%2Fdef',
};

describe('Search Record module public seam', () => {
  it('canonicalizes identity, progressively enriches a record, and publishes only committed changes', async () => {
    const storage = createInMemorySearchRecordStorage();
    const module = createSearchRecordModule(storage);
    const changes: unknown[] = [];

    expect(await module.initialize()).toEqual({ ok: true, changed: true });
    const unsubscribe = module.subscribe((change) => changes.push(change));

    expect(
      await module.execute({
        type: 'upsert-search-record',
        identity: poe1,
        patch: { name: 'First name' },
        usedAt: 10,
      }),
    ).toEqual({ ok: true, changed: true });
    expect(
      await module.execute({
        type: 'upsert-search-record',
        identity: {
          gameVersion: 'poe1',
          league: 'settlers hc',
          searchId: 'abc/def',
        },
        patch: { icon: 'https://web.poecdn.com/image/icon.png' },
        usedAt: 20,
      }),
    ).toEqual({ ok: true, changed: true });

    const result = await module.read({
      type: 'get-search-record',
      identity: {
        gameVersion: 'poe1',
        url: 'https://www.pathofexile.com/trade/search/Settlers%20HC/abc%252Fdef',
      },
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        gameVersion: 'poe1',
        league: 'settlers hc',
        searchId: 'abc/def',
        name: 'First name',
        icon: 'https://web.poecdn.com/image/icon.png',
        lastUsedAt: 20,
      }),
    });
    expect(result.ok && result.value).not.toHaveProperty('query');
    expect(changes).toHaveLength(2);
    unsubscribe();
  });

  it('canonicalizes PoE2 URLs with the game path segment and isolates subscriber failures', async () => {
    const module = createSearchRecordModule(createInMemorySearchRecordStorage());
    await module.initialize();
    module.subscribe(() => {
      throw new Error('pane was closed');
    });

    expect(
      await module.execute({
        type: 'upsert-search-record',
        identity: {
          gameVersion: 'poe2',
          url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/id%252Fone',
        },
        patch: { url: 'https://example/openable' },
      }),
    ).toEqual({ ok: true, changed: true });
    expect(
      await module.read({
        type: 'get-search-record',
        identity: { gameVersion: 'poe2', league: 'standard', searchId: 'id/one' },
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({
        league: 'standard',
        searchId: 'id/one',
        url: 'https://example/openable',
      }),
    });
    expect(
      await module.execute({
        type: 'upsert-search-record',
        identity: { gameVersion: 'poe2', url: 'https://www.pathofexile.com/trade2/exchange' },
        patch: {},
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'invalid-identity',
        message: 'Search Record URL does not contain a search identity',
      },
    });
  });

  it('orders and deduplicates History Entries, honors the toggle and limit, and deletes references only', async () => {
    let historyTime = 0;
    const module = createSearchRecordModule(createInMemorySearchRecordStorage(), () => historyTime);
    await module.initialize();

    await module.execute({ type: 'set-history-enabled', gameVersion: 'poe1', enabled: false });
    historyTime = 1;
    await module.execute({
      type: 'record-history',
      identity: poe1,
      entry: { name: 'Hidden', url: 'https://example/hidden' },
    });
    expect(await module.read({ type: 'list-history', gameVersion: 'poe1' })).toEqual({
      ok: true,
      value: [],
    });

    await module.execute({ type: 'set-history-enabled', gameVersion: 'poe1', enabled: true });
    for (let index = 0; index < 52; index += 1) {
      historyTime = index + 10;
      await module.execute({
        type: 'record-history',
        identity: { gameVersion: 'poe1', league: 'Standard', searchId: `id-${index}` },
        entry: { name: `Search ${index}`, url: `https://example/${index}` },
      });
    }
    historyTime = 100;
    await module.execute({
      type: 'record-history',
      identity: { gameVersion: 'poe1', league: 'standard', searchId: 'id-10' },
      entry: { name: 'Search 10 refreshed', url: 'https://example/10' },
    });

    const history = await module.read({ type: 'list-history', gameVersion: 'poe1' });
    expect(history.ok && history.value).toHaveLength(50);
    expect(history.ok && history.value[0]).toEqual(
      expect.objectContaining({
        name: 'Search 10 refreshed',
        visitedAt: 100,
      }),
    );

    const recordBefore = await module.read({
      type: 'get-search-record',
      identity: { gameVersion: 'poe1', league: 'standard', searchId: 'id-10' },
    });
    const entryId = history.ok ? history.value[0].id : '';
    await module.execute({ type: 'delete-history-entry', entryId });
    const recordAfter = await module.read({
      type: 'get-search-record',
      identity: { gameVersion: 'poe1', league: 'standard', searchId: 'id-10' },
    });
    expect(recordAfter).toEqual(recordBefore);
  });

  it('protects bookmarked records and evicts the 25 oldest unreferenced records after crossing 50', async () => {
    const module = createSearchRecordModule(createInMemorySearchRecordStorage());
    await module.initialize();

    for (let index = 0; index < 52; index += 1) {
      const identity = {
        gameVersion: 'poe2' as const,
        league: 'Standard',
        searchId: `id-${index}`,
      };
      if (index === 0) {
        await module.execute({
          type: 'put-bookmark-reference',
          bookmark: {
            id: 'bookmark-0',
            identity,
            url: 'https://example/protected',
          },
        });
      } else {
        await module.execute({
          type: 'upsert-search-record',
          identity,
          patch: {},
          usedAt: index,
        });
      }
    }

    const state = await module.read({ type: 'get-state' });
    expect(state.ok && Object.keys(state.value.searchRecords)).toHaveLength(27);
    expect(
      await module.read({
        type: 'get-search-record',
        identity: { gameVersion: 'poe2', league: 'standard', searchId: 'id-0' },
      }),
    ).toEqual({ ok: true, value: expect.objectContaining({ searchId: 'id-0' }) });

    await module.execute({
      type: 'delete-bookmark-reference',
      gameVersion: 'poe2',
      bookmarkId: 'bookmark-0',
    });
    expect(
      await module.read({
        type: 'get-search-record',
        identity: { gameVersion: 'poe2', league: 'standard', searchId: 'id-0' },
      }),
    ).toEqual({ ok: true, value: expect.objectContaining({ searchId: 'id-0' }) });
  });

  it('commits a Bookmark and its progressively complete Search Record as one mutation', async () => {
    const module = createSearchRecordModule(createInMemorySearchRecordStorage());
    await module.initialize();

    expect(
      await module.execute({
        type: 'put-bookmark-reference',
        bookmark: {
          id: 'bookmark-1',
          identity: {
            gameVersion: 'poe1',
            url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
          },
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        },
      }),
    ).toEqual({ ok: true, changed: true });

    expect(await module.read({ type: 'get-bookmark-records', gameVersion: 'poe1' })).toEqual({
      ok: true,
      value: [
        {
          reference: {
            id: 'bookmark-1',
            searchRecordId: 'poe1:standard:id-1',
            gameVersion: 'poe1',
          },
          record: expect.objectContaining({
            id: 'poe1:standard:id-1',
            url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
          }),
        },
      ],
    });

    await module.execute({
      type: 'upsert-search-record',
      identity: {
        gameVersion: 'poe1',
        url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
      },
      patch: { name: 'Rings' },
    });
    expect(
      await module.read({
        type: 'get-search-record',
        identity: {
          gameVersion: 'poe1',
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        },
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({ name: 'Rings' }),
    });
  });

  it('does not publish a Bookmark or protection when its atomic commit fails', async () => {
    let writes = 0;
    const storage: SearchRecordStorage = {
      async load() {
        return { state: undefined, legacy: {} };
      },
      async commit() {
        writes += 1;
        if (writes > 1) throw new Error('quota exceeded');
      },
    };
    const module = createSearchRecordModule(storage);
    await module.initialize();
    const changes: unknown[] = [];
    module.subscribe((change) => changes.push(change));

    expect(
      await module.execute({
        type: 'put-bookmark-reference',
        bookmark: {
          id: 'bookmark-1',
          identity: {
            gameVersion: 'poe1',
            url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
          },
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'storage-failure', message: 'quota exceeded' },
    });
    expect(await module.read({ type: 'get-bookmark-records', gameVersion: 'poe1' })).toEqual({
      ok: true,
      value: [],
    });
    expect(
      await module.read({
        type: 'get-search-record',
        identity: {
          gameVersion: 'poe1',
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        },
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(changes).toEqual([]);
  });

  it('serializes mutations and exposes neither live nor durable partial state when a commit fails', async () => {
    let durable: unknown;
    let activeWrites = 0;
    let maxActiveWrites = 0;
    let writes = 0;
    const storage: SearchRecordStorage = {
      async load() {
        return { state: undefined, legacy: {} };
      },
      async commit(state) {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await Promise.resolve();
        writes += 1;
        activeWrites -= 1;
        if (writes === 2) throw new Error('disk full');
        durable = structuredClone(state);
      },
    };
    const module = createSearchRecordModule(storage);
    await module.initialize();

    const failed = module.execute({
      type: 'upsert-search-record',
      identity: poe1,
      patch: { name: 'Must not leak' },
    });
    const succeeded = module.execute({
      type: 'upsert-search-record',
      identity: { ...poe1, searchId: 'second' },
      patch: { name: 'Second' },
    });

    expect(await failed).toEqual({
      ok: false,
      error: { code: 'storage-failure', message: 'disk full' },
    });
    expect(await succeeded).toEqual({ ok: true, changed: true });
    expect(maxActiveWrites).toBe(1);
    expect(await module.read({ type: 'get-search-record', identity: poe1 })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(JSON.stringify(durable)).not.toContain('Must not leak');
  });

  it('migrates legacy data atomically and idempotently while retaining legacy keys', async () => {
    const legacy = {
      history_poe1: [
        {
          name: 'History name',
          url: 'https://www.pathofexile.com/trade/search/Settlers%20HC/abc%2Fdef',
          date: '2026-01-02T00:00:00.000Z',
        },
        {
          name: 'Older encoded duplicate',
          url: 'https://www.pathofexile.com/trade/search/Settlers%20HC/abc%252Fdef',
          icon: 'https://web.poecdn.com/image/history.png',
          date: '2026-01-01T00:00:00.000Z',
        },
      ],
      bookmarkGroups_poe1: [{ id: 'group-1', name: 'Favorites' }],
      bookmarks_poe1: [
        {
          id: 'bookmark-1',
          name: 'Bookmark name',
          url: 'https://www.pathofexile.com/trade/search/Settlers%20HC/abc%252Fdef',
          groupId: 'group-1',
          createdAt: 5,
        },
      ],
    };
    const storage = createInMemorySearchRecordStorage(legacy);
    const first = createSearchRecordModule(storage);

    expect(await first.initialize()).toEqual({ ok: true, changed: true });
    const migrated = await first.read({ type: 'get-state' });
    expect(migrated.ok && Object.values(migrated.value.searchRecords)).toHaveLength(1);
    expect(migrated.ok && Object.values(migrated.value.searchRecords)[0]).toEqual(
      expect.objectContaining({
        name: 'History name',
        icon: 'https://web.poecdn.com/image/history.png',
      }),
    );
    expect(migrated.ok && Object.values(migrated.value.searchRecords)[0]).not.toHaveProperty(
      'query',
    );
    expect(migrated.ok && migrated.value.historyEntries[0]).toEqual(
      expect.objectContaining({
        name: 'History name',
        icon: 'https://web.poecdn.com/image/history.png',
      }),
    );
    expect(migrated.ok && migrated.value.bookmarkReferences[0]).toEqual({
      id: 'bookmark-1',
      searchRecordId: 'poe1:settlers%20hc:abc%2Fdef',
      gameVersion: 'poe1',
    });
    expect(storage.inspect().history_poe1).toEqual(legacy.history_poe1);

    const second = createSearchRecordModule(storage);
    expect(await second.initialize()).toEqual({ ok: true, changed: false });
    expect(await second.read({ type: 'get-state' })).toEqual(migrated);
  });

  it('leaves migration unavailable and legacy data untouched when the initial commit fails', async () => {
    const legacy = {
      history_poe1: [
        {
          name: 'Still recoverable',
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        },
      ],
    };
    let durable: Record<string, unknown> = structuredClone(legacy);
    const storage: SearchRecordStorage = {
      async load() {
        return { state: undefined, legacy: structuredClone(durable) };
      },
      async commit() {
        throw new Error('storage unavailable');
      },
    };
    const module = createSearchRecordModule(storage);

    expect(await module.initialize()).toEqual({
      ok: false,
      error: { code: 'storage-failure', message: 'storage unavailable' },
    });
    expect(await module.read({ type: 'get-state' })).toEqual({
      ok: false,
      error: { code: 'not-initialized', message: 'Search Record module is not initialized' },
    });
    expect(durable).toEqual(legacy);
    expect(durable[SEARCH_RECORD_STATE_KEY]).toBeUndefined();
  });

  it('uses the same module interface with the Chrome storage adapter', async () => {
    const values: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (patch: Record<string, unknown>) => {
        Object.assign(values, patch);
      }),
    };
    const module = createSearchRecordModule(createChromeSearchRecordStorage(area));
    await module.initialize();
    await module.execute({
      type: 'upsert-search-record',
      identity: poe1,
      patch: { name: 'Chrome-backed' },
    });

    expect(values[SEARCH_RECORD_STATE_KEY]).toBeDefined();
    expect(await module.read({ type: 'get-search-record', identity: poe1 })).toEqual({
      ok: true,
      value: expect.objectContaining({ name: 'Chrome-backed' }),
    });
  });

  it('deterministically normalizes duplicate history entries by searchRecordId on initialization', async () => {
    const rawState: SearchRecordState = {
      schemaVersion: 1,
      migrationComplete: true,
      searchRecords: {
        'poe1:settlers:dup1': {
          id: 'poe1:settlers:dup1',
          gameVersion: 'poe1' as const,
          league: 'settlers',
          searchId: 'dup1',
          name: 'Dup 1',
          createdAt: 100,
          updatedAt: 100,
          lastUsedAt: 100,
        },
      },
      historyEntries: [
        {
          id: 'hist-older',
          searchRecordId: 'poe1:settlers:dup1',
          gameVersion: 'poe1' as const,
          name: 'Dup 1 (older duplicate)',
          url: 'https://www.pathofexile.com/trade/search/settlers/dup1',
          visitedAt: 100,
        },
        {
          id: 'hist-newer',
          searchRecordId: 'poe1:settlers:dup1',
          gameVersion: 'poe1' as const,
          name: 'Dup 1 (newer)',
          url: 'https://www.pathofexile.com/trade/search/settlers/dup1',
          visitedAt: 200,
        },
      ],
      bookmarkReferences: [],
      historyEnabled: { poe1: true, poe2: true },
    };

    const storage: SearchRecordStorage = {
      async load() {
        return { state: structuredClone(rawState), legacy: {} };
      },
      async commit() {},
    };

    const module = createSearchRecordModule(storage);
    expect(await module.initialize()).toEqual({ ok: true, changed: false });

    const historyResult = await module.read({ type: 'list-history', gameVersion: 'poe1' });
    expect(historyResult).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: 'hist-newer',
          searchRecordId: 'poe1:settlers:dup1',
          name: 'Dup 1 (newer)',
          visitedAt: 200,
        }),
      ],
    });
  });

  it('defaults historyEnabled to true for poe1 and poe2 in fresh state and preserves persisted false', async () => {
    // 1. Fresh state defaults
    const freshStorage: SearchRecordStorage = {
      async load() {
        return { state: undefined, legacy: {} };
      },
      async commit() {},
    };
    const freshModule = createSearchRecordModule(freshStorage);
    await freshModule.initialize();
    expect(await freshModule.read({ type: 'get-history-enabled', gameVersion: 'poe1' })).toEqual({
      ok: true,
      value: true,
    });
    expect(await freshModule.read({ type: 'get-history-enabled', gameVersion: 'poe2' })).toEqual({
      ok: true,
      value: true,
    });

    // 2. Persisted false is preserved
    const disabledStorage: SearchRecordStorage = {
      async load() {
        return {
          state: {
            schemaVersion: 1,
            migrationComplete: true,
            searchRecords: {},
            historyEntries: [],
            bookmarkReferences: [],
            historyEnabled: { poe1: false, poe2: false },
          },
          legacy: {},
        };
      },
      async commit() {},
    };
    const disabledModule = createSearchRecordModule(disabledStorage);
    await disabledModule.initialize();
    expect(await disabledModule.read({ type: 'get-history-enabled', gameVersion: 'poe1' })).toEqual(
      {
        ok: true,
        value: false,
      },
    );
    expect(await disabledModule.read({ type: 'get-history-enabled', gameVersion: 'poe2' })).toEqual(
      {
        ok: true,
        value: false,
      },
    );
  });

  describe('SearchRecord Icon Trust Boundary & PoE CDN Contract', () => {
    it('rejects illegal icon in upsert-search-record and record-history commands', async () => {
      const storage = createInMemorySearchRecordStorage();
      const module = createSearchRecordModule(storage);
      await module.initialize();

      // upsert-search-record rejects attacker URL
      const upsertResult = await module.execute({
        type: 'upsert-search-record',
        identity: poe1,
        patch: { icon: 'https://attacker.com/malicious.png' },
      });
      expect(upsertResult.ok).toBe(false);

      // record-history rejects attacker URL
      const historyResult = await module.execute({
        type: 'record-history',
        identity: poe1,
        entry: {
          name: '合法搜尋',
          url: 'https://www.pathofexile.com/trade/search/Standard/abc',
          icon: 'javascript:alert(1)',
        },
      });
      expect(historyResult.ok).toBe(false);

      // Legitimate PoE CDN icon succeeds
      const legitResult = await module.execute({
        type: 'upsert-search-record',
        identity: poe1,
        patch: { icon: 'https://web.poecdn.com/gen/image/legit.png' },
      });
      expect(legitResult.ok).toBe(true);
    });

    it('rejects persisted state containing illegal icon at storage and module boundaries', async () => {
      const validState: SearchRecordState = {
        schemaVersion: 1,
        migrationComplete: true,
        searchRecords: {
          'poe1:standard:rec1': {
            id: 'poe1:standard:rec1',
            gameVersion: 'poe1',
            league: 'standard',
            searchId: 'rec1',
            name: 'Valid',
            icon: 'https://web.poecdn.com/gen/image/icon.png',
            createdAt: 1,
            updatedAt: 1,
            lastUsedAt: 1,
          },
        },
        historyEntries: [
          {
            id: 'history:poe1:standard:rec1',
            searchRecordId: 'poe1:standard:rec1',
            gameVersion: 'poe1',
            name: 'Valid',
            url: 'https://www.pathofexile.com/trade/search/Standard/rec1',
            icon: 'https://webtw.poecdn.com/gen/image/icon.png',
            visitedAt: 1,
          },
        ],
        bookmarkReferences: [],
        historyEnabled: { poe1: true, poe2: true },
      };

      // 1. 合法 state 正常載入
      const validStorage = createInMemorySearchRecordStorage({
        [SEARCH_RECORD_STATE_KEY]: validState,
      });
      const loadedValid = await validStorage.load();
      expect(loadedValid.state).toBeDefined();

      const validModule = createSearchRecordModule(validStorage);
      expect(await validModule.initialize()).toEqual({ ok: true, changed: false });
      const validRead = await validModule.read({ type: 'get-state' });
      expect(validRead.ok && validRead.value.searchRecords['poe1:standard:rec1'].icon).toBe(
        'https://web.poecdn.com/gen/image/icon.png',
      );

      // 2. searchRecords 含非法 icon 被 storage.load 拒絕，module.initialize 不接受為 canonical state
      const badRecordState = {
        ...validState,
        searchRecords: {
          ...validState.searchRecords,
          'poe1:standard:rec1': {
            ...validState.searchRecords['poe1:standard:rec1'],
            icon: 'https://attacker.site/icon.png',
          },
        },
      };
      const badRecordStorage = createInMemorySearchRecordStorage({
        [SEARCH_RECORD_STATE_KEY]: badRecordState,
      });
      const loadedBadRecord = await badRecordStorage.load();
      expect(loadedBadRecord.state).toBeUndefined();

      const badRecordModule = createSearchRecordModule(badRecordStorage);
      expect(await badRecordModule.initialize()).toEqual({ ok: true, changed: true });
      const badRecordRead = await badRecordModule.read({ type: 'get-state' });
      expect(
        badRecordRead.ok && badRecordRead.value.searchRecords['poe1:standard:rec1'],
      ).toBeUndefined();

      // 3. historyEntries 含非法 icon 被 storage.load 拒絕，module.initialize 不接受為 canonical state
      const badHistoryState = {
        ...validState,
        historyEntries: [
          {
            ...validState.historyEntries[0],
            icon: 'data:image/png;base64,bad',
          },
        ],
      };
      const badHistoryStorage = createInMemorySearchRecordStorage({
        [SEARCH_RECORD_STATE_KEY]: badHistoryState,
      });
      const loadedBadHistory = await badHistoryStorage.load();
      expect(loadedBadHistory.state).toBeUndefined();

      const badHistoryModule = createSearchRecordModule(badHistoryStorage);
      expect(await badHistoryModule.initialize()).toEqual({ ok: true, changed: true });
      const badHistoryRead = await badHistoryModule.read({ type: 'get-state' });
      expect(badHistoryRead.ok && badHistoryRead.value.historyEntries).toEqual([]);
    });

    it('isPortableSearchRecord rejects records containing illegal icon', () => {
      const validRecord = {
        id: 'poe1:standard:rec1',
        gameVersion: 'poe1' as const,
        league: 'standard',
        searchId: 'rec1',
        url: 'https://www.pathofexile.com/trade/search/Standard/rec1',
        icon: 'https://web.poecdn.com/gen/image/valid.png',
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
      };
      expect(isPortableSearchRecord(validRecord, 'poe1')).toBe(true);

      const invalidIconRecord = {
        ...validRecord,
        icon: 'https://evil.org/exploit.png',
      };
      expect(isPortableSearchRecord(invalidIconRecord, 'poe1')).toBe(false);

      const maliciousProtocolRecord = {
        ...validRecord,
        icon: 'javascript:alert("pwned")',
      };
      expect(isPortableSearchRecord(maliciousProtocolRecord, 'poe1')).toBe(false);
    });

    it('import-bookmark-references rejects bookmarks containing invalid search record icon', async () => {
      const storage = createInMemorySearchRecordStorage();
      const module = createSearchRecordModule(storage);
      await module.initialize();

      const outcome = await module.execute({
        type: 'import-bookmark-references',
        gameVersion: 'poe1',
        mode: 'merge',
        bookmarks: [
          {
            id: 'bm-import',
            url: 'https://www.pathofexile.com/trade/search/Standard/search-import',
            record: {
              id: 'poe1:standard:search-import',
              gameVersion: 'poe1',
              league: 'standard',
              searchId: 'search-import',
              url: 'https://www.pathofexile.com/trade/search/Standard/search-import',
              icon: 'https://attacker.site/image.png',
              createdAt: 1,
              updatedAt: 1,
              lastUsedAt: 1,
            },
          },
        ],
      });
      expect(outcome.ok).toBe(false);
    });

    it('legacy migration drops illegal icon while preserving legitimate PoE CDN icon', async () => {
      const legacy = {
        history_poe1: [
          {
            name: 'Bad icon entry',
            url: 'https://www.pathofexile.com/trade/search/Standard/bad-icon',
            icon: 'https://attacker.site/bad.png',
            date: '2026-01-01T00:00:00.000Z',
          },
          {
            name: 'Good icon entry',
            url: 'https://www.pathofexile.com/trade/search/Standard/good-icon',
            icon: 'https://web.poecdn.com/gen/image/good.png',
            date: '2026-01-02T00:00:00.000Z',
          },
        ],
      };
      const storage = createInMemorySearchRecordStorage(legacy);
      const module = createSearchRecordModule(storage);
      await module.initialize();

      const state = await module.read({ type: 'get-state' });
      expect(state.ok).toBe(true);
      if (!state.ok) return;

      const badRecord = state.value.searchRecords['poe1:standard:bad-icon'];
      expect(badRecord.icon).toBeUndefined();

      const goodRecord = state.value.searchRecords['poe1:standard:good-icon'];
      expect(goodRecord.icon).toBe('https://web.poecdn.com/gen/image/good.png');

      const badHistory = state.value.historyEntries.find(
        (e) => e.searchRecordId === 'poe1:standard:bad-icon',
      );
      expect(badHistory?.icon).toBeUndefined();

      const goodHistory = state.value.historyEntries.find(
        (e) => e.searchRecordId === 'poe1:standard:good-icon',
      );
      expect(goodHistory?.icon).toBe('https://web.poecdn.com/gen/image/good.png');
    });
  });
});
