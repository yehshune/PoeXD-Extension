import { describe, expect, it } from 'vitest';
import {
  deriveHistoryCriteriaHint,
  extractTradeLeagueFromUrl,
  findDisambiguationEntryIds,
  getOtherLeagueLabel,
  groupHistoryEntriesByTime,
  isCurrentHistoryEntry,
  isLiveTradeSearchUrl,
} from '@/components/sidebar/history-presentation';
import { encodeQueryToGzipBase64Url } from '@/utils/trade-url-codec';
import {
  createInMemorySearchRecordStorage,
  createSearchRecordModule,
  type HistoryEntry,
} from '@/utils/search-records';

const makeEntry = (overrides: Partial<HistoryEntry> & { id: string }): HistoryEntry => ({
  searchRecordId: `poe1:standard:${overrides.id}`,
  gameVersion: 'poe1',
  name: 'Test Entry',
  url: `https://www.pathofexile.com/trade/search/Standard/H4sI${overrides.id}`,
  visitedAt: Date.now(),
  ...overrides,
});

describe('history-presentation helpers', () => {
  it('detects live search URLs accurately', () => {
    expect(
      isLiveTradeSearchUrl('https://www.pathofexile.com/trade/search/Standard/H4sIabc/live'),
    ).toBe(true);
    expect(
      isLiveTradeSearchUrl('https://www.pathofexile.com/trade/search/Standard/H4sIabc/live/'),
    ).toBe(true);
    expect(isLiveTradeSearchUrl('https://www.pathofexile.com/trade/search/Standard/H4sIabc')).toBe(
      false,
    );
  });

  it('extracts trade league and only returns label when different from current league', () => {
    const settlersUrl = 'https://www.pathofexile.com/trade/search/Settlers/H4sIabc';
    const standardUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIabc';

    expect(extractTradeLeagueFromUrl(settlersUrl)).toBe('Settlers');
    expect(getOtherLeagueLabel(settlersUrl, 'settlers')).toBeNull();
    expect(getOtherLeagueLabel(standardUrl, 'Settlers')).toBe('Standard');
    expect(getOtherLeagueLabel(standardUrl, null)).toBeNull();
  });

  it('matches current history entry by canonical trade identity regardless of /live suffix', () => {
    const baseUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIabc';
    const liveUrl = `${baseUrl}/live`;
    const otherUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIxyz';

    expect(isCurrentHistoryEntry(baseUrl, baseUrl)).toBe(true);
    expect(isCurrentHistoryEntry(baseUrl, liveUrl)).toBe(true);
    expect(isCurrentHistoryEntry(baseUrl, otherUrl)).toBe(false);
  });

  it('groups history entries into today, yesterday, last7Days, and older buckets', () => {
    const now = new Date(2026, 4, 10, 15, 0, 0).getTime(); // 2026-05-10 15:00 local
    const todayEntry = makeEntry({
      id: 'today',
      visitedAt: new Date(2026, 4, 10, 9, 0, 0).getTime(),
    });
    const yesterdayEntry = makeEntry({
      id: 'yesterday',
      visitedAt: new Date(2026, 4, 9, 20, 0, 0).getTime(),
    });
    const last7Entry = makeEntry({
      id: 'last7',
      visitedAt: new Date(2026, 4, 5, 12, 0, 0).getTime(),
    });
    const olderEntry = makeEntry({
      id: 'older',
      visitedAt: new Date(2026, 4, 1, 12, 0, 0).getTime(),
    });

    const groups = groupHistoryEntriesByTime(
      [todayEntry, yesterdayEntry, last7Entry, olderEntry],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'last7Days', 'older']);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['today']);
    expect(groups[1].entries.map((e) => e.id)).toEqual(['yesterday']);
    expect(groups[2].entries.map((e) => e.id)).toEqual(['last7']);
    expect(groups[3].entries.map((e) => e.id)).toEqual(['older']);
  });

  it('identifies unnamed/generic and duplicate-name entries for disambiguation hints', () => {
    const entries = [
      makeEntry({ id: 'unique', name: '獵首 皮革腰帶' }),
      makeEntry({ id: 'dup-1', name: '潛能之戒' }),
      makeEntry({ id: 'dup-2', name: '潛能之戒' }),
      makeEntry({ id: 'unnamed', name: '未命名搜尋' }),
      makeEntry({
        id: 'legacy',
        name: '未命名搜尋',
        url: 'https://www.pathofexile.com/trade/search/Standard/short123',
      }),
    ];

    const ids = findDisambiguationEntryIds(entries, (e) => e.name, 'poe1');
    expect(ids.has('unique')).toBe(false);
    expect(ids.has('dup-1')).toBe(true);
    expect(ids.has('dup-2')).toBe(true);
    expect(ids.has('unnamed')).toBe(true);
    expect(ids.has('legacy')).toBe(false);
  });

  it('derives concise criteria hint from gzip-encoded trade search URL', async () => {
    const hash = await encodeQueryToGzipBase64Url({
      query: {
        filters: {
          trade_filters: {
            filters: {
              price: { max: 50, option: 'divine' },
            },
          },
        },
        stats: [
          {
            type: 'and',
            filters: [{ id: 'explicit.stat_life', value: { min: 80 } }],
          },
        ],
      },
    });
    const url = `https://www.pathofexile.com/trade/search/Standard/${hash}`;
    const hint = await deriveHistoryCriteriaHint(url, 'poe1');
    expect(hint).toContain('≤ 50 divine');
    expect(hint).toContain('≥ 80');
  });
});

describe('restore-history-entry command', () => {
  it('restores a deleted history entry with original timestamp even when historyEnabled is false', async () => {
    const storage = createInMemorySearchRecordStorage();
    const mod = createSearchRecordModule(storage);
    await mod.initialize();

    await mod.execute({
      type: 'record-history',
      identity: {
        gameVersion: 'poe1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
      },
      entry: {
        name: '獵首 皮革腰帶',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
      },
    });

    const before = await mod.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(before.ok && before.value).toHaveLength(1);
    const saved = before.ok ? before.value[0] : null;
    expect(saved).not.toBeNull();

    await mod.execute({ type: 'set-history-enabled', gameVersion: 'poe1', enabled: false });
    await mod.execute({ type: 'delete-history-entry', entryId: saved!.id });

    const afterDelete = await mod.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(afterDelete.ok && afterDelete.value).toHaveLength(0);

    await mod.execute({ type: 'restore-history-entry', entry: saved! });

    const afterRestore = await mod.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(afterRestore.ok && afterRestore.value).toHaveLength(1);
    expect(afterRestore.ok && afterRestore.value[0].visitedAt).toBe(saved!.visitedAt);
    expect(afterRestore.ok && afterRestore.value[0].name).toBe('獵首 皮革腰帶');
  });

  it('deletes multiple history entries atomically via delete-history-entries', async () => {
    const storage = createInMemorySearchRecordStorage();
    const mod = createSearchRecordModule(storage);
    await mod.initialize();

    for (const suffix of ['one', 'two', 'three']) {
      await mod.execute({
        type: 'record-history',
        identity: {
          gameVersion: 'poe1',
          url: `https://www.pathofexile.com/trade/search/Standard/H4sI${suffix}`,
        },
        entry: {
          name: `Entry ${suffix}`,
          url: `https://www.pathofexile.com/trade/search/Standard/H4sI${suffix}`,
        },
      });
    }

    const before = await mod.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(before.ok && before.value).toHaveLength(3);
    const idsToDelete = before.ok ? before.value.slice(0, 2).map((e) => e.id) : [];

    const outcome = await mod.execute({
      type: 'delete-history-entries',
      entryIds: idsToDelete,
    });
    expect(outcome.ok && outcome.changed).toBe(true);

    const after = await mod.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(after.ok && after.value).toHaveLength(1);
    expect(after.ok && after.value[0].name).toBe('Entry one');
  });

  it('clears only unbookmarked history entries atomically using state.bookmarkReferences', async () => {
    const storage = createInMemorySearchRecordStorage();
    const mod = createSearchRecordModule(storage);
    await mod.initialize();

    const bookmarkedUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIkeep';
    const unbookmarkedUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIdrop';

    await mod.execute({
      type: 'record-history',
      identity: { gameVersion: 'poe1', url: bookmarkedUrl },
      entry: { name: 'Bookmarked Entry', url: bookmarkedUrl },
    });
    await mod.execute({
      type: 'record-history',
      identity: { gameVersion: 'poe1', url: unbookmarkedUrl },
      entry: { name: 'Unbookmarked Entry', url: unbookmarkedUrl },
    });
    await mod.execute({
      type: 'put-bookmark-reference',
      bookmark: {
        id: 'bm-1',
        identity: { gameVersion: 'poe1', url: bookmarkedUrl },
        url: bookmarkedUrl,
      },
    });

    const outcome = await mod.execute({
      type: 'clear-unbookmarked-history',
      gameVersion: 'poe1',
    });
    expect(outcome.ok && outcome.changed).toBe(true);

    const after = await mod.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(after.ok && after.value).toHaveLength(1);
    expect(after.ok && after.value[0].name).toBe('Bookmarked Entry');
  });
});
