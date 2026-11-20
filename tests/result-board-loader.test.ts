import { describe, expect, it, vi } from 'vitest';
import {
  BATCH_INTERVAL_MS,
  BATCH_TIMEOUT_MS,
  ResultBoardLoader,
  type BatchOutcome,
  type LoaderDeps,
} from '@/utils/result-board/board-loader';

interface FakeOptions {
  /** 每次觸發後收到的結果；用完後一律 loaded */
  outcomes?: BatchOutcome[];
  /** 載入幾批後算完整 */
  completeAfter?: number;
  hasButton?: () => boolean;
}

function fakeDeps(options: FakeOptions = {}) {
  const outcomes = [...(options.outcomes ?? [])];
  let loaded = 0;
  let searchId = 's1';
  const deps: LoaderDeps & { setSearch(id: string): void } = {
    clickLoadMore: vi.fn(() => (options.hasButton ? options.hasButton() : true)),
    waitForBatch: vi.fn(async () => {
      const outcome = outcomes.shift() ?? { kind: 'loaded' };
      if (outcome.kind === 'loaded') loaded += 1;
      return outcome;
    }),
    pause: vi.fn(async () => undefined),
    isComplete: () => loaded >= (options.completeAfter ?? 9),
    currentSearchId: () => searchId,
    setSearch: (id: string) => {
      searchId = id;
    },
  };
  return deps;
}

describe('ResultBoardLoader', () => {
  it('loads one batch on loadNext without pausing', async () => {
    const deps = fakeDeps();
    const loader = new ResultBoardLoader(deps);
    expect(await loader.loadNext()).toBeUndefined();
    expect(deps.clickLoadMore).toHaveBeenCalledTimes(1);
    expect(deps.waitForBatch).toHaveBeenCalledWith(BATCH_TIMEOUT_MS);
    expect(deps.pause).not.toHaveBeenCalled();
    expect(loader.getState()).toEqual({ running: false });
  });

  it('loads all batches with a pause between them until complete', async () => {
    const deps = fakeDeps({ completeAfter: 3 });
    const loader = new ResultBoardLoader(deps);
    expect(await loader.loadAll()).toBe('complete');
    expect(deps.clickLoadMore).toHaveBeenCalledTimes(3);
    expect(deps.pause).toHaveBeenCalledTimes(3);
    expect(deps.pause).toHaveBeenCalledWith(BATCH_INTERVAL_MS);
    expect(loader.getState()).toEqual({ running: false, lastStop: 'complete' });
  });

  it('does nothing when everything is already loaded', async () => {
    const deps = fakeDeps({ completeAfter: 0 });
    expect(await new ResultBoardLoader(deps).loadAll()).toBe('complete');
    expect(deps.clickLoadMore).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'failed', status: 429 } as BatchOutcome, 'rate-limited'],
    [{ kind: 'failed', status: 500 } as BatchOutcome, 'failed'],
    [{ kind: 'timeout' } as BatchOutcome, 'timeout'],
  ])('stops on %o with %s', async (outcome, reason) => {
    const deps = fakeDeps({ outcomes: [{ kind: 'loaded' }, outcome] });
    const loader = new ResultBoardLoader(deps);
    expect(await loader.loadAll()).toBe(reason);
    expect(deps.clickLoadMore).toHaveBeenCalledTimes(2);
  });

  it('stops when the official button is gone', async () => {
    const deps = fakeDeps({ hasButton: () => false });
    expect(await new ResultBoardLoader(deps).loadAll()).toBe('no-button');
  });

  it('stops when the user asks', async () => {
    const deps = fakeDeps();
    const loader = new ResultBoardLoader(deps);
    vi.mocked(deps.waitForBatch).mockImplementationOnce(async () => {
      loader.stop();
      return { kind: 'loaded' };
    });
    expect(await loader.loadAll()).toBe('stopped');
    expect(deps.clickLoadMore).toHaveBeenCalledTimes(1);
  });

  it('stops when the search changes while loading', async () => {
    const deps = fakeDeps();
    const loader = new ResultBoardLoader(deps);
    vi.mocked(deps.waitForBatch).mockImplementationOnce(async () => {
      deps.setSearch('s2');
      return { kind: 'loaded' };
    });
    expect(await loader.loadAll()).toBe('search-changed');
  });

  it('ignores a second run while one is in flight and reports running state', async () => {
    const deps = fakeDeps({ completeAfter: 1 });
    const loader = new ResultBoardLoader(deps);
    const states: boolean[] = [];
    loader.subscribe((state) => states.push(state.running));
    const first = loader.loadAll();
    expect(await loader.loadNext()).toBeUndefined();
    await first;
    expect(deps.clickLoadMore).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true, false]);
  });

  it('reset clears the last stop reason or stops a running load', async () => {
    const deps = fakeDeps({ completeAfter: 0 });
    const loader = new ResultBoardLoader(deps);
    await loader.loadAll();
    loader.reset();
    expect(loader.getState()).toEqual({ running: false });

    const slow = fakeDeps();
    const running = new ResultBoardLoader(slow);
    vi.mocked(slow.waitForBatch).mockImplementationOnce(async () => {
      running.reset();
      return { kind: 'loaded' };
    });
    expect(await running.loadAll()).toBe('stopped');
  });

  it('stop is a no-op when idle', async () => {
    const deps = fakeDeps({ completeAfter: 1 });
    const loader = new ResultBoardLoader(deps);
    loader.stop();
    expect(await loader.loadAll()).toBe('complete');
  });

  it('treats a missing button as complete when the last batch filled the board', async () => {
    let clicks = 0;
    const deps = fakeDeps({ completeAfter: 1, hasButton: () => clicks++ === 0 });
    deps.isComplete = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const loader = new ResultBoardLoader(deps);
    expect(await loader.loadAll()).toBe('complete');
  });

  it('hides the stop reason when reset during a load', async () => {
    let release: (outcome: BatchOutcome) => void = () => undefined;
    const deps = fakeDeps();
    deps.waitForBatch = vi.fn(() => new Promise<BatchOutcome>((resolve) => (release = resolve)));
    const loader = new ResultBoardLoader(deps);
    const pending = loader.loadNext();
    loader.reset();
    release({ kind: 'timeout' });
    expect(await pending).toBe('timeout');
    expect(loader.getState()).toEqual({ running: false });
  });

  it('keeps running state consistent when a dependency or listener throws', async () => {
    const deps = fakeDeps();
    deps.waitForBatch = vi.fn(async () => {
      throw new Error('boom');
    });
    const loader = new ResultBoardLoader(deps);
    const seen: boolean[] = [];
    loader.subscribe(() => {
      throw new Error('listener');
    });
    loader.subscribe((state) => seen.push(state.running));
    expect(await loader.loadNext()).toBe('failed');
    expect(loader.getState()).toEqual({ running: false, lastStop: 'failed' });
    expect(seen).toEqual([true, false]);
  });
});
