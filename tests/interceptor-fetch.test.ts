// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import { installFetchInterceptor } from '@/entrypoints/main-world/network-observer';
import { resetTradeRequestIdleForTests } from '@/entrypoints/main-world/trade-request-idle';
import { resetLiveTradeDataSentForTests } from '@/entrypoints/main-world/poe-runtime-reader';

describe('installFetchInterceptor runtime regression', () => {
  let dispatchedEvents: Array<{ type: string; payload?: string }> = [];
  let bridge: MainWorldBridge;
  let mockStore: any;
  let tradeEl: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    // 送資料前會等主執行緒閒置；讓 idle callback 也走 fake timers
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 0));
    resetTradeRequestIdleForTests();
    dispatchedEvents = [];
    bridge = {
      dispatchEvent: (type: string, payload?: string) => {
        dispatchedEvents.push({ type, payload });
      },
      addListener: vi.fn(),
    } as unknown as MainWorldBridge;

    document.body.innerHTML = '';
    mockStore = {
      state: {
        query: {
          status: { option: 'online' },
          stats: [{ type: 'and', filters: [] }],
        },
      },
      _withCommit: vi.fn((fn: () => void) => fn()),
      commit: vi.fn(),
    };

    tradeEl = document.createElement('div');
    tradeEl.id = 'trade';
    (tradeEl as any).__vue__ = {
      $store: mockStore,
      static_: {
        knownStatsFlat: {
          'stat.test': { id: 'stat.test', text: 'Test Stat', type: 'explicit' },
        },
        knownStats: [
          {
            id: 'explicit',
            label: 'Explicit',
            entries: [{ id: 'stat.test', text: 'Test Stat', type: 'explicit' }],
          },
        ],
      },
    };
    document.body.appendChild(tradeEl);
    resetLiveTradeDataSentForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('dispatches poexd-fetch-response on /api/trade/fetch responses with wire payload', async () => {
    const fakeData = { result: [{ id: 'item1', listing: { price: { amount: 10 } } }] };
    const fakeResponse = {
      clone: () => ({
        json: async () => fakeData,
      }),
    };
    const originalFetch = vi.fn().mockResolvedValue(fakeResponse);
    const win = { fetch: originalFetch } as unknown as Window;

    installFetchInterceptor(bridge, win);

    const fetchUrl = 'https://www.pathofexile.com/api/trade/fetch/item1?query=abc';
    const result = await win.fetch(fetchUrl);
    expect(result).toBe(fakeResponse);

    const fetchEvent = dispatchedEvents.find((e) => e.type === 'poexd-fetch-response');
    expect(fetchEvent).toBeDefined();

    const parsed = JSON.parse(fetchEvent!.payload!);
    expect(parsed).toEqual({
      url: fetchUrl,
      data: fakeData,
    });
  });

  it('dispatches poexd-search-query-observed and poexd-search-triggered on /api/trade/search', async () => {
    const fakeSearchResponse = {
      clone: () => ({
        json: async () => ({ id: 'search-token-xyz', total: 42 }),
      }),
    };
    const originalFetch = vi.fn().mockResolvedValue(fakeSearchResponse);
    const win = { fetch: originalFetch } as unknown as Window;

    installFetchInterceptor(bridge, win);

    const searchUrl = 'https://www.pathofexile.com/api/trade/search/Standard';
    await win.fetch(searchUrl);

    const queryEvent = dispatchedEvents.find((e) => e.type === 'poexd-search-query-observed');
    expect(queryEvent).toBeDefined();

    const queryPayload = JSON.parse(queryEvent!.payload!);
    expect(queryPayload.searchId).toBe('search-token-xyz');
    expect(queryPayload.source).toBe('search-response');

    const innerQuery = JSON.parse(queryPayload.queryJson);
    expect(innerQuery.query.status.option).toBe('online');

    const triggerEvent = dispatchedEvents.find((e) => e.type === 'poexd-search-triggered');
    expect(triggerEvent).toBeDefined();
  });

  it('官網 4 支 data API 都回應時，同一份即時市集資料只送一次；內容變了才再送', async () => {
    const fakeDataResponse = { clone: () => ({ json: async () => ({ result: [] }) }) };
    const win = { fetch: vi.fn().mockResolvedValue(fakeDataResponse) } as unknown as Window;
    installFetchInterceptor(bridge, win);

    for (const kind of ['stats', 'static', 'filters', 'items']) {
      await win.fetch(`https://www.pathofexile.com/api/trade/data/${kind}`);
    }
    vi.advanceTimersByTime(501); // 500ms 延遲後再等主執行緒閒置
    const count = () => dispatchedEvents.filter((e) => e.type === 'poexd-live-trade-data').length;
    expect(count()).toBe(1);
    // known stats 由即時市集資料推導，不再另外序列化 knownStatsFlat
    expect(dispatchedEvents.some((e) => e.type === 'poexd-known-stats')).toBe(false);

    (tradeEl as any).__vue__.static_.knownStats = [
      ...(tradeEl as any).__vue__.static_.knownStats,
      { id: 'pseudo', label: 'Pseudo', entries: [] },
    ];
    await win.fetch('https://www.pathofexile.com/api/trade/data/stats');
    vi.advanceTimersByTime(501);
    expect(count()).toBe(2);
  });

  it('triggers live trade data and currentQuery dispatch after 500ms when /api/trade/data completes', async () => {
    const fakeDataResponse = {
      clone: () => ({
        json: async () => ({ result: [] }),
      }),
    };
    const originalFetch = vi.fn().mockResolvedValue(fakeDataResponse);
    const win = { fetch: originalFetch } as unknown as Window;

    installFetchInterceptor(bridge, win);

    await win.fetch('https://www.pathofexile.com/api/trade/data/stats');

    // Before timer fires
    expect(dispatchedEvents.some((e) => e.type === 'poexd-live-trade-data')).toBe(false);

    // Fast-forward past 500ms
    vi.advanceTimersByTime(501);

    const liveEvent = dispatchedEvents.find((e) => e.type === 'poexd-live-trade-data');
    expect(liveEvent).toBeDefined();
    const wire = JSON.parse(liveEvent!.payload!);
    expect(wire.knownStats[0].entries[0]).toEqual({
      id: 'stat.test',
      text: 'Test Stat',
      type: 'explicit',
    });

    const currentQueryEvent = dispatchedEvents.find(
      (e) =>
        e.type === 'poexd-search-query-observed' &&
        JSON.parse(e.payload!).source === 'current-query',
    );
    expect(currentQueryEvent).toBeDefined();
  });
});
