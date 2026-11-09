// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSearchQueryObservation } from '@/entrypoints/content/logic/search-query-observation';
import { bootstrapBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import { extractLeagueAndModeFromUrl } from '@/entrypoints/main-world/category-binding-manager';
import { installXhrInterceptor } from '@/entrypoints/main-world/network-observer';
import * as poeReader from '@/entrypoints/main-world/poe-runtime-reader';

interface SearchQueryEvent {
  searchId?: string;
  queryJson: string;
  source?: string;
}

function resolveEvents(events: SearchQueryEvent[], url: string) {
  return events
    .map((event) => resolveSearchQueryObservation(JSON.stringify(event), url))
    .filter((event): event is NonNullable<typeof event> => event !== undefined);
}

function runCurrentQueryCapture(query: Record<string, unknown>) {
  document.body.innerHTML = '';
  const tradeEl = document.createElement('div');
  tradeEl.id = 'trade';
  (tradeEl as any).__vue__ = {
    $store: {
      state: { query },
      _withCommit: vi.fn(),
      commit: vi.fn(),
    },
  };
  document.body.appendChild(tradeEl);

  const events: SearchQueryEvent[] = [];
  const bridge: any = {
    dispatchEvent: (type: string, payload: string) => {
      if (type === 'poexd-search-query-observed') {
        events.push(JSON.parse(payload));
      }
    },
  };

  poeReader.sendCurrentQuery(bridge);
  return events;
}

function runXhrSearchCapture(url: string, payload: Record<string, unknown>, searchId: string) {
  const events: SearchQueryEvent[] = [];
  const bridge: any = {
    dispatchEvent: (type: string, payload: string) => {
      if (type === 'poexd-search-query-observed') {
        events.push(JSON.parse(payload));
      }
    },
  };

  class FakeXMLHttpRequest {
    responseType = '';
    responseText = JSON.stringify({ id: searchId });
    private listeners: Record<string, Array<() => void>> = {};

    open(_method?: string, _url?: string) {}

    send(_body?: unknown) {
      this.listeners.load?.forEach((listener) => listener.call(this));
    }

    addEventListener(type: string, listener: () => void) {
      (this.listeners[type] ||= []).push(listener);
    }
  }

  const fakeWindow = { XMLHttpRequest: FakeXMLHttpRequest } as any;
  installXhrInterceptor(bridge, fakeWindow);

  const xhr = new fakeWindow.XMLHttpRequest();
  xhr.open('POST', url);
  xhr.send(JSON.stringify(payload));
  return events;
}

function runInterceptorBootstrap(
  alreadyInstalled: boolean,
  nonce = 'next-nonce',
  existingWindow?: any,
) {
  const events: any[] = [];
  const history = existingWindow?.history || {
    __poexdHistoryPatched: false,
    pushState: vi.fn(),
    replaceState: vi.fn(),
  };

  const windowStub: any = existingWindow || {
    history,
    __poexdInterceptorInstalled: alreadyInstalled,
    __poexdUpdateNonce: vi.fn(),
    addEventListener: vi.fn(),
    dispatchEvent: (event: any) => events.push(event),
  };
  windowStub.dispatchEvent = (event: any) => events.push(event);
  const installedUpdateNonce = windowStub.__poexdUpdateNonce;

  const documentStub = {
    currentScript: {
      getAttribute: () => nonce,
      removeAttribute: vi.fn(),
    },
  } as any;

  bootstrapBridge({
    windowObj: windowStub,
    documentObj: documentStub,
  });

  return { events, history, windowStub, installedUpdateNonce };
}

describe('interceptor search history capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('does not resolve a league-only observation before the real search id arrives', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const baseUrl = 'https://www.pathofexile.com/trade/search/Allflame';
    const events = runCurrentQueryCapture({
      stats: [{ filters: [{ id: 'explicit.stat_1' }] }],
    });
    expect(resolveEvents(events, baseUrl)).toEqual([]);
    events.push({
      searchId: '8r8lLXoGFV',
      queryJson: JSON.stringify({
        query: {
          stats: [{ filters: [{ id: 'explicit.stat_1' }] }],
          filters: { type_filters: { filters: { category: { option: 'ring' } } } },
        },
      }),
    });

    expect(resolveEvents(events, baseUrl)).toEqual([
      expect.objectContaining({ searchId: '8r8lLXoGFV' }),
    ]);
  });

  it('captures an XMLHttpRequest query observation with price filters', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const payload = {
      query: {
        filters: {
          trade_filters: {
            filters: { price: { option: 'chaos', max: 10 } },
          },
        },
      },
    };
    const events = runXhrSearchCapture(
      'https://www.pathofexile.com/api/trade/search/Allflame',
      payload,
      'price-only',
    );

    expect(resolveEvents(events, 'https://www.pathofexile.com/trade/search/Allflame')).toEqual([
      expect.objectContaining({
        searchId: 'price-only',
        criteria: payload.query,
        source: 'search-response',
      }),
    ]);
  });

  it('does not publish a PoE2 league-only URL', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const url = 'https://www.pathofexile.com/trade2/search/poe2/Standard';
    const events = runCurrentQueryCapture({ type: 'Quarterstaff' });

    expect(resolveEvents(events, url)).toEqual([]);
  });

  it.each([
    ['https://www.pathofexile.com/trade/search/Allflame/8r8lLXoGFV', '8r8lLXoGFV'],
    ['https://www.pathofexile.com/trade2/search/poe2/Standard/real-id', 'real-id'],
  ])('publishes the current query when %s has a real search id', (url, searchId) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const events = runCurrentQueryCapture({ type: 'Ring' });

    expect(resolveEvents(events, url)).toEqual([
      expect.objectContaining({ searchId, criteria: { type: 'Ring' }, source: 'current-query' }),
    ]);
  });

  it('uses query observation terminology at the page boundary', () => {
    document.body.innerHTML = '';
    const tradeEl = document.createElement('div');
    tradeEl.id = 'trade';
    (tradeEl as any).__vue__ = {
      $store: {
        state: { query: { type: 'Bow' } },
        _withCommit: vi.fn(),
        commit: vi.fn(),
      },
    };
    document.body.appendChild(tradeEl);

    const events: Array<{ type: string; payload: string }> = [];
    const bridge: any = {
      dispatchEvent: (type: string, payload: string) => {
        events.push({ type, payload });
      },
    };

    poeReader.sendCurrentQuery(bridge);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'poexd-search-query-observed',
        payload: expect.stringContaining('"source":"current-query"'),
      }),
    );
  });

  it('updates nonce and synchronizes the current URL on reinjection without reinstalling history interceptor', () => {
    const first = runInterceptorBootstrap(false, 'first-nonce');
    expect(first.history.__poexdHistoryPatched).toBe(true);

    const updateNonceSpy = vi.spyOn(first.windowStub, '__poexdUpdateNonce');
    const second = runInterceptorBootstrap(true, 'second-nonce', first.windowStub);

    expect(updateNonceSpy).toHaveBeenCalledWith('second-nonce');
    expect(second.events).toContainEqual(
      expect.objectContaining({
        type: 'poexd-history-changed',
        detail: expect.objectContaining({ nonce: 'second-nonce' }),
      }),
    );
  });

  it('keeps history events on the current nonce after a second reinjection', () => {
    const first = runInterceptorBootstrap(true, 'first-nonce');
    const second = runInterceptorBootstrap(true, 'second-nonce', first.windowStub);

    second.history.pushState({}, '', '/trade/search/Allflame/example/live');

    expect(second.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'poexd-history-changed',
        detail: expect.objectContaining({ nonce: 'second-nonce' }),
      }),
    );
  });

  it('correctly extracts searchSlug ignoring /live and league-only URLs', () => {
    expect(
      extractLeagueAndModeFromUrl('https://www.pathofexile.com/trade/search/Standard/one')
        .searchSlug,
    ).toBe('one');
    expect(
      extractLeagueAndModeFromUrl('https://www.pathofexile.com/trade/search/Standard/one/live')
        .searchSlug,
    ).toBe('one');
    expect(
      extractLeagueAndModeFromUrl(
        'https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/H4sIA_long/live',
      ).searchSlug,
    ).toBe('H4sIA_long');
    expect(
      extractLeagueAndModeFromUrl('https://www.pathofexile.com/trade2/search/poe2/Standard')
        .searchSlug,
    ).toBeNull();
    expect(
      extractLeagueAndModeFromUrl('https://www.pathofexile.com/trade/search/Standard').searchSlug,
    ).toBeNull();
  });
});
