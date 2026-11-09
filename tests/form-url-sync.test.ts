import { describe, expect, it, vi } from 'vitest';
import { isTradeSearchFormUrl, syncFormToUrl } from '@/entrypoints/content/logic/form-url-sync';

const SEARCH_URL = 'https://www.pathofexile.com/trade/search/Standard/old';

function setup(options: { commitError?: Error; urlAfterTicks?: number } = {}) {
  let url = SEARCH_URL;
  let ticks = 0;
  const commit = vi.fn(async (ops: readonly unknown[]) => {
    if (options.commitError) throw options.commitError;
    expect(ops).toEqual([]);
  });
  const wait = vi.fn(async () => {
    ticks += 1;
    if (options.urlAfterTicks !== undefined && ticks >= options.urlAfterTicks) {
      url = 'https://www.pathofexile.com/trade/search/Standard/new';
    }
  });
  return {
    commit,
    wait,
    deps: { commit, readUrl: () => url, wait, settleMs: 100, pollMs: 25 },
  };
}

describe('isTradeSearchFormUrl', () => {
  it('only treats official search routes as having a writable form', () => {
    expect(isTradeSearchFormUrl(SEARCH_URL)).toBe(true);
    expect(isTradeSearchFormUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/x')).toBe(
      true,
    );
    expect(isTradeSearchFormUrl('https://www.pathofexile.com/trade/exchange/Standard/x')).toBe(
      false,
    );
  });
});

describe('syncFormToUrl', () => {
  it('writes the form through and returns the URL once it changes', async () => {
    const { deps, commit } = setup({ urlAfterTicks: 2 });
    await expect(syncFormToUrl(deps)).resolves.toBe(
      'https://www.pathofexile.com/trade/search/Standard/new',
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('returns the unchanged URL after the settle window when the form was already in sync', async () => {
    const { deps, wait } = setup();
    await expect(syncFormToUrl(deps)).resolves.toBe(SEARCH_URL);
    expect(wait).toHaveBeenCalledTimes(4);
  });

  it('rejects when the write-through fails so no stale URL is stored', async () => {
    const { deps } = setup({ commitError: new Error('timeout') });
    await expect(syncFormToUrl(deps)).rejects.toThrow('無法同步目前搜尋表單');
  });

  it('skips the write-through on non-search routes', async () => {
    const { deps, commit } = setup();
    const url = 'https://www.pathofexile.com/trade/exchange/Standard/x';
    await expect(syncFormToUrl({ ...deps, readUrl: () => url })).resolves.toBe(url);
    expect(commit).not.toHaveBeenCalled();
  });
});
