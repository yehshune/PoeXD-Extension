import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initTradeRequestIdle,
  resetTradeRequestIdleForTests,
  runWhenTradeRequestsIdle,
  trackTradeRequest,
} from '@/entrypoints/main-world/trade-request-idle';

const SEARCH_URL = 'https://www.pathofexile.com/trade/search/Standard/abc123';
const EMPTY_SEARCH_URL = 'https://www.pathofexile.com/trade/search/Standard';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 0));
  resetTradeRequestIdleForTests();
});

afterEach(() => {
  resetTradeRequestIdleForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('trade request idle gate', () => {
  it('runs on idle when the page loads no initial results', () => {
    initTradeRequestIdle(EMPTY_SEARCH_URL);
    const task = vi.fn();

    runWhenTradeRequestsIdle(task);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('waits for the first result fetch on pages with an automatic search', () => {
    initTradeRequestIdle(SEARCH_URL);
    const task = vi.fn();
    runWhenTradeRequestsIdle(task);

    const endSearch = trackTradeRequest('search');
    vi.advanceTimersByTime(100);
    const endFetch = trackTradeRequest('fetch');
    endSearch();
    vi.advanceTimersByTime(2000);
    expect(task).not.toHaveBeenCalled();

    endFetch();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('treats a search without a follow-up fetch as zero results', () => {
    initTradeRequestIdle(SEARCH_URL);
    const task = vi.fn();
    runWhenTradeRequestsIdle(task);

    trackTradeRequest('search')();
    vi.advanceTimersByTime(1499);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting for initial results after the max wait', () => {
    initTradeRequestIdle(SEARCH_URL);
    const task = vi.fn();
    runWhenTradeRequestsIdle(task);

    vi.advanceTimersByTime(5001);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('defers while any search or fetch is in flight, even after initial results', () => {
    initTradeRequestIdle(EMPTY_SEARCH_URL);
    const endFetch = trackTradeRequest('fetch');
    const task = vi.fn();
    runWhenTradeRequestsIdle(task);

    vi.advanceTimersByTime(1000);
    expect(task).not.toHaveBeenCalled();
    endFetch();
    endFetch(); // 重複結束不影響計數
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('rechecks at idle time when a request started after scheduling', () => {
    initTradeRequestIdle(EMPTY_SEARCH_URL);
    const task = vi.fn();
    runWhenTradeRequestsIdle(task);
    const endFetch = trackTradeRequest('fetch');

    vi.advanceTimersByTime(10);
    expect(task).not.toHaveBeenCalled();
    endFetch();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs the same queued task once and keeps going when one task throws', () => {
    initTradeRequestIdle(EMPTY_SEARCH_URL);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const task = vi.fn();
    runWhenTradeRequestsIdle(() => {
      throw new Error('boom');
    });
    runWhenTradeRequestsIdle(task);
    runWhenTradeRequestsIdle(task);

    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('settles initial results immediately when the search fails', () => {
    initTradeRequestIdle(SEARCH_URL);
    const task = vi.fn();
    runWhenTradeRequestsIdle(task);

    trackTradeRequest('search')('failed');
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
