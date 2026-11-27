import { describe, expect, it, vi } from 'vitest';
import {
  runSimilarSearch,
  type FetchedResult,
  type SimilarRunEvent,
  type SimilarTradeTransport,
  type TransportOutcome,
} from '@/utils/similar-item-search';
import { TradeResultCache } from '@/utils/trade-result-cache';
import { chestDraft, chestResult, englishStatText } from './helpers/similar-search-fixtures';

type Query = {
  stats: { type: string; filters: { id: string }[]; value?: { min?: number } }[];
};

interface ScriptedSearch {
  total: number;
  ids?: string[];
  fail?: 'rate-limited' | 'error';
}

/** 依序回應的假官方 API：每次搜尋取下一個腳本，fetch 從物品表取 */
function scriptedTransport(script: ScriptedSearch[], items: Record<string, FetchedResult> = {}) {
  const searches: Query[] = [];
  const fetches: { ids: string[]; searchId: string }[] = [];
  let index = 0;
  const transport: SimilarTradeTransport = {
    async search(body): Promise<TransportOutcome<{ id: string; result: string[]; total: number }>> {
      searches.push(body.query as Query);
      const step = script[index++];
      if (!step) throw new Error('unexpected search');
      if (step.fail)
        return { ok: false, rateLimited: step.fail === 'rate-limited', error: step.fail };
      const ids =
        step.ids ??
        Array.from({ length: Math.min(step.total, 100) }, (_, n) => `s${index}_${n + 1}`);
      return { ok: true, data: { id: `q${index}`, result: ids, total: step.total } };
    },
    async fetch(ids, searchId) {
      fetches.push({ ids: [...ids], searchId });
      return {
        ok: true,
        data: ids.map((id) => items[id] ?? chestResult(id, { life: 100, fire: 90, evasion: 50 })),
      };
    },
  };
  return { transport, searches, fetches };
}

const weightMinOf = (query: Query) =>
  query.stats.find((group) => group.type === 'weight')?.value?.min;
const andIdsOf = (query: Query) =>
  query.stats.find((group) => group.type === 'and')?.filters.map((filter) => filter.id) ?? [];

const run = (
  transport: SimilarTradeTransport,
  extra: Partial<Parameters<typeof runSimilarSearch>[1]> = {},
) => runSimilarSearch(chestDraft(), { transport, englishStatText, ...extra });

describe('runSimilarSearch', () => {
  it('嚴格搜尋找到 10 筆以上就結束：取前 10 筆，另給一批依 Similarity 排序', async () => {
    const { transport, searches, fetches } = scriptedTransport([{ total: 25 }]);
    const result = await run(transport);

    expect(result.reason).toBe('enough');
    expect(searches).toHaveLength(1);
    expect(andIdsOf(searches[0])).toHaveLength(3);
    expect(fetches).toEqual([
      { ids: Array.from({ length: 10 }, (_, n) => `s1_${n + 1}`), searchId: 'q1' },
    ]);
    expect(result.batches.map((batch) => [batch.kind, batch.results.length])).toEqual([
      ['strict', 10],
      ['similarity', 10],
    ]);
    expect(result.batches[0]).toMatchObject({ searchId: 'q1', total: 25 });
    expect(result.batches[0].results[0]).toMatchObject({ id: 's1_1', similarity: 1 });
  });

  it('嚴格搜尋不足 10 筆時放寬：去掉參考 stat 的門檻，加權總和下限從參考數 × 容忍度開始', async () => {
    const { transport, searches } = scriptedTransport([{ total: 3 }, { total: 40 }]);
    const result = await run(transport);

    expect(result.reason).toBe('enough');
    expect(andIdsOf(searches[1])).toEqual([]);
    expect(weightMinOf(searches[1])).toBe(2.4);
    expect(result.batches.map((batch) => [batch.kind, batch.results.length])).toEqual([
      ['strict', 3],
      ['relaxed', 10],
      ['similarity', 13],
    ]);
  });

  it('放寬搜尋被截在 10000 筆時提高下限，太少時降低下限', async () => {
    const raising = scriptedTransport([{ total: 2 }, { total: 10000 }, { total: 50 }]);
    const raised = await run(raising.transport);
    expect(raising.searches.map(weightMinOf)).toEqual([undefined, 2.4, 3.6]);
    expect(raised.reason).toBe('enough');

    const lowering = scriptedTransport([{ total: 0 }, { total: 4 }, { total: 30 }]);
    const lowered = await run(lowering.transport);
    expect(lowering.searches.map(weightMinOf)).toEqual([undefined, 2.4, 1.2]);
    expect(lowered.batches.map((batch) => batch.kind)).toEqual([
      'relaxed',
      'relaxed',
      'similarity',
    ]);
  });

  it('嚴格搜尋被截在 10000 筆時先提高加權下限再取結果', async () => {
    const { transport, searches, fetches } = scriptedTransport([{ total: 10000 }, { total: 120 }]);
    const result = await run(transport);
    expect(searches.map(weightMinOf)).toEqual([undefined, 3.75]);
    expect(andIdsOf(searches[1])).toHaveLength(3);
    expect(fetches.map((call) => call.searchId)).toEqual(['q2']);
    expect(result.batches[0]).toMatchObject({ kind: 'strict', searchId: 'q2', total: 120 });
  });

  it('最多 4 次搜尋、取 20 筆物品，重複的 id 不再取', async () => {
    const shared = ['a', 'b', 'c', 'd', 'e'];
    const ids = (prefix: string) => [
      ...shared,
      ...Array.from({ length: 20 }, (_, n) => `${prefix}${n}`),
    ];
    const { transport, searches, fetches } = scriptedTransport([
      { total: 0 },
      { total: 10000, ids: ids('x') },
      { total: 10000, ids: ids('y') },
      { total: 10000, ids: ids('z') },
    ]);
    const result = await run(transport);

    expect(result.reason).toBe('search-limit');
    expect(searches).toHaveLength(4);
    expect(fetches.map((call) => call.ids.length)).toEqual([10, 10]);
    expect(fetches[1].ids).not.toContain('a');
    expect(result.fetched).toBe(20);
    expect(result.batches.find((batch) => batch.kind === 'similarity')?.results).toHaveLength(20);
    const second = result.batches.filter((batch) => batch.kind === 'relaxed')[1];
    expect(second.results.slice(0, 5).map((entry) => entry.id)).toEqual(shared);
  });

  it('429 結束這次執行並保留已找到的結果', async () => {
    const { transport, searches } = scriptedTransport([
      { total: 4 },
      { total: 0, fail: 'rate-limited' },
    ]);
    const events: SimilarRunEvent[] = [];
    const result = await run(transport, { onEvent: (event) => events.push(event) });

    expect(result.reason).toBe('rate-limited');
    expect(searches).toHaveLength(2);
    expect(result.batches.map((batch) => batch.kind)).toEqual(['strict', 'similarity']);
    expect(events.at(-1)).toMatchObject({ type: 'stopped', reason: 'rate-limited' });
  });

  it('使用者開始官方搜尋（中止訊號）時立刻停下', async () => {
    const controller = new AbortController();
    const { transport, searches } = scriptedTransport([{ total: 4 }, { total: 40 }]);
    const result = await run(transport, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'batch') controller.abort();
      },
    });
    expect(result.reason).toBe('aborted');
    expect(searches).toHaveLength(1);
  });

  it('依序回報搜尋進度與每一批，時間取自注入的時鐘', async () => {
    const { transport } = scriptedTransport([{ total: 3 }, { total: 40 }]);
    const events: SimilarRunEvent[] = [];
    let clock = 1000;
    await run(transport, {
      now: () => (clock += 10),
      onEvent: (event) => events.push(event),
    });
    expect(events.map((event) => event.type)).toEqual([
      'searching',
      'batch',
      'searching',
      'batch',
      'batch',
      'stopped',
    ]);
    expect(events[0]).toMatchObject({ phase: 'strict', search: 1 });
    expect(events[2]).toMatchObject({ phase: 'relaxed', search: 2, weightMin: 2.4 });
    expect(events.every((event) => event.at > 1000)).toBe(true);
  });

  it('取得的物品寫進結果快取，來源搜尋 id 是這次的搜尋', async () => {
    const cache = new TradeResultCache();
    const { transport } = scriptedTransport([{ total: 12 }]);
    await run(transport, {
      remember: (results, searchId) => cache.ingestBatch(results, { sourceSearchId: searchId }),
    });
    expect(cache.get('s1_1')).toMatchObject({
      sourceSearchId: 'q1',
      listing: { hideout_token: 'token-s1_1' },
    });
    expect(cache.entriesForSearch('q1')).toHaveLength(10);
  });

  it('搜尋失敗時以 error 結束；中途 fetch 失敗也保留之前的批次', async () => {
    const failed = scriptedTransport([{ total: 0, fail: 'error' }]);
    expect(await run(failed.transport)).toMatchObject({ reason: 'error', batches: [] });

    const { transport } = scriptedTransport([{ total: 3 }, { total: 40 }]);
    const fetchSpy = vi
      .spyOn(transport, 'fetch')
      .mockResolvedValueOnce({ ok: true, data: [chestResult('s1_1', { life: 100 })] })
      .mockResolvedValueOnce({ ok: false, rateLimited: false, error: 'boom' });
    const result = await run(transport);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.reason).toBe('error');
    expect(result.batches.map((batch) => batch.kind)).toEqual(['strict', 'similarity']);
  });
});
