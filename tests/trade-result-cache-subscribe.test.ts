import { describe, expect, it, vi } from 'vitest';
import { serializePoeFetchResponse } from '@/utils/event-protocol-types';
import { TradeResultCache } from '@/utils/trade-result-cache';

const response = (searchId: string, ids: string[]) =>
  serializePoeFetchResponse({
    url: `https://www.pathofexile.com/api/trade/fetch/${ids.join(',')}?query=${searchId}`,
    data: { result: ids.map((id) => ({ id, item: { typeLine: 'Ring' }, listing: {} })) },
  });

describe('TradeResultCache subscription', () => {
  it('notifies once per fetch response that added results', () => {
    const cache = new TradeResultCache();
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.ingestFetchResponse(response('s1', ['a', 'b']));
    expect(listener).toHaveBeenCalledTimes(1);
    cache.ingestFetchResponse('not json');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies on clear and stops after unsubscribing', () => {
    const cache = new TradeResultCache();
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    cache.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    cache.ingestFetchResponse(response('s1', ['a']));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps notifying other listeners when one throws', () => {
    const cache = new TradeResultCache();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    cache.subscribe(() => {
      throw new Error('boom');
    });
    cache.subscribe(good);
    cache.ingestFetchResponse(response('s1', ['a']));
    expect(good).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('lists the entries of one search in arrival order', () => {
    const cache = new TradeResultCache();
    cache.ingestFetchResponse(response('s1', ['a', 'b']));
    cache.ingestFetchResponse(response('s2', ['c']));
    cache.ingestFetchResponse(response('s1', ['d']));
    expect(cache.entriesForSearch('s1').map((entry) => entry.id)).toEqual(['a', 'b', 'd']);
    expect(cache.entriesForSearch('nope')).toEqual([]);
  });
});
