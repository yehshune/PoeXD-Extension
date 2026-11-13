import { describe, expect, it, vi } from 'vitest';
import {
  getRejectedBackupKeyPrefix,
  planRejectedStorageBackups,
} from '@/utils/rejected-storage-backup';
import {
  SEARCH_RECORD_STATE_KEY,
  createChromeSearchRecordStorage,
  createInMemorySearchRecordStorage,
  createSearchRecordModule,
} from '@/utils/search-records';
import {
  createBackgroundBookmarkCoordinator,
  createChromeBookmarkCoordinatorStorage,
} from '@/utils/bookmark-coordinator';
import {
  BOOKMARK_COLLECTION_STATE_KEY,
  BOOKMARK_COLLECTION_STATE_KEY_V2,
} from '@/utils/bookmark-collection';

const NOW = 1_700_000_000_000;

function createArea(initial: Record<string, unknown> = {}, options: { failSet?: boolean } = {}) {
  const values: Record<string, unknown> = structuredClone(initial);
  return {
    values,
    async get() {
      return structuredClone(values);
    },
    async set(items: Record<string, unknown>) {
      if (options.failSet) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(values, structuredClone(items));
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

function backupKeys(values: Record<string, unknown>, key: string) {
  const prefix = getRejectedBackupKeyPrefix(key);
  return Object.keys(values).filter((k) => k.startsWith(prefix));
}

// 未通過整份驗證的狀態：schemaVersion 正確但結構損壞，模擬單筆資料毀損
const corruptSearchState = {
  schemaVersion: 1,
  migrationComplete: true,
  searchRecords: { broken: { icon: 'https://evil.example.com/x.png' } },
  historyEntries: [],
  bookmarkReferences: [],
};
const corruptBookmarkState = { schemaVersion: 3, groups: 'not-an-array', userData: 'keep-me' };

describe('planRejectedStorageBackups', () => {
  it('plans a timestamped backup for each present key and skips missing keys', () => {
    const planned = planRejectedStorageBackups({ a: { x: 1 } }, ['a', 'missing'], NOW);
    expect(planned).toEqual({
      [`${getRejectedBackupKeyPrefix('a')}${NOW}`]: { savedAt: NOW, value: { x: 1 } },
    });
  });

  it('does not duplicate a backup that already holds identical content', () => {
    const first = planRejectedStorageBackups({ a: { x: 1 } }, ['a'], NOW);
    const second = planRejectedStorageBackups({ a: { x: 1 }, ...first }, ['a'], NOW + 1);
    expect(second).toEqual({});
  });

  it('adds a new backup when the rejected content differs from earlier backups', () => {
    const first = planRejectedStorageBackups({ a: { x: 1 } }, ['a'], NOW);
    const second = planRejectedStorageBackups({ a: { x: 2 }, ...first }, ['a'], NOW + 1);
    expect(Object.keys(second)).toEqual([`${getRejectedBackupKeyPrefix('a')}${NOW + 1}`]);
  });

  it('copies the value so later mutation of storage does not alter the backup', () => {
    const source = { a: { x: 1 } };
    const planned = planRejectedStorageBackups(source, ['a'], NOW);
    source.a.x = 99;
    expect(Object.values(planned)[0].value).toEqual({ x: 1 });
  });
});

describe('Search record storage keeps rejected state recoverable', () => {
  it('backs up an invalid stored state before initialization overwrites it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const area = createArea({ [SEARCH_RECORD_STATE_KEY]: corruptSearchState });
    const module = createSearchRecordModule(createChromeSearchRecordStorage(area, () => NOW));

    await expect(module.initialize()).resolves.toMatchObject({ ok: true, changed: true });

    const keys = backupKeys(area.values, SEARCH_RECORD_STATE_KEY);
    expect(keys).toHaveLength(1);
    expect(area.values[keys[0]]).toEqual({ savedAt: NOW, value: corruptSearchState });
    expect(area.values[SEARCH_RECORD_STATE_KEY]).not.toEqual(corruptSearchState);
  });

  it('does not overwrite the stored state when the backup cannot be written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const area = createArea({ [SEARCH_RECORD_STATE_KEY]: corruptSearchState }, { failSet: true });
    const module = createSearchRecordModule(createChromeSearchRecordStorage(area, () => NOW));

    await expect(module.initialize()).resolves.toMatchObject({
      ok: false,
      error: { code: 'storage-failure' },
    });
    expect(area.values[SEARCH_RECORD_STATE_KEY]).toEqual(corruptSearchState);
  });

  it('writes no backup on a fresh install or a valid state', async () => {
    const fresh = createArea();
    await createSearchRecordModule(createChromeSearchRecordStorage(fresh, () => NOW)).initialize();
    expect(backupKeys(fresh.values, SEARCH_RECORD_STATE_KEY)).toEqual([]);

    const valid = createArea(structuredClone(fresh.values));
    await createSearchRecordModule(createChromeSearchRecordStorage(valid, () => NOW)).initialize();
    expect(backupKeys(valid.values, SEARCH_RECORD_STATE_KEY)).toEqual([]);
  });

  it('in-memory storage mirrors the backup behavior', async () => {
    const storage = createInMemorySearchRecordStorage(
      { [SEARCH_RECORD_STATE_KEY]: corruptSearchState },
      () => NOW,
    );
    await createSearchRecordModule(storage).initialize();
    const values = storage.inspect();
    expect(backupKeys(values, SEARCH_RECORD_STATE_KEY)).toHaveLength(1);
  });
});

describe('Bookmark coordinator storage keeps rejected state recoverable', () => {
  async function initialize(area: ReturnType<typeof createArea>) {
    const searchRecords = createSearchRecordModule(
      createChromeSearchRecordStorage(area, () => NOW),
    );
    const coordinator = createBackgroundBookmarkCoordinator(
      searchRecords,
      createChromeBookmarkCoordinatorStorage(area, () => NOW),
    );
    return coordinator.initialize();
  }

  it('backs up an invalid V3 collection before replacing it with the default state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const area = createArea({ [BOOKMARK_COLLECTION_STATE_KEY]: corruptBookmarkState });

    await expect(initialize(area)).resolves.toMatchObject({ ok: true });

    const keys = backupKeys(area.values, BOOKMARK_COLLECTION_STATE_KEY);
    expect(keys).toHaveLength(1);
    expect(area.values[keys[0]]).toEqual({ savedAt: NOW, value: corruptBookmarkState });
    expect(area.values[BOOKMARK_COLLECTION_STATE_KEY]).toMatchObject({ schemaVersion: 3 });
    expect(area.values[BOOKMARK_COLLECTION_STATE_KEY]).not.toEqual(corruptBookmarkState);
  });

  it('backs up an invalid V2 collection that initialization would otherwise delete', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const corruptV2 = { schemaVersion: 2, groups: null };
    const area = createArea({ [BOOKMARK_COLLECTION_STATE_KEY_V2]: corruptV2 });

    await expect(initialize(area)).resolves.toMatchObject({ ok: true });

    expect(area.values[BOOKMARK_COLLECTION_STATE_KEY_V2]).toBeUndefined();
    const keys = backupKeys(area.values, BOOKMARK_COLLECTION_STATE_KEY_V2);
    expect(keys).toHaveLength(1);
    expect(area.values[keys[0]]).toEqual({ savedAt: NOW, value: corruptV2 });
  });

  it('keeps the original collection when the backup cannot be written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const area = createArea(
      { [BOOKMARK_COLLECTION_STATE_KEY]: corruptBookmarkState },
      { failSet: true },
    );

    await expect(initialize(area)).resolves.toMatchObject({
      ok: false,
      error: { code: 'storage-failure' },
    });
    expect(area.values[BOOKMARK_COLLECTION_STATE_KEY]).toEqual(corruptBookmarkState);
  });

  it('writes no backup on a fresh install', async () => {
    const area = createArea();
    await expect(initialize(area)).resolves.toMatchObject({ ok: true });
    expect(backupKeys(area.values, BOOKMARK_COLLECTION_STATE_KEY)).toEqual([]);
    expect(backupKeys(area.values, BOOKMARK_COLLECTION_STATE_KEY_V2)).toEqual([]);
  });
});
