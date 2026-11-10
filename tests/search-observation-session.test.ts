import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectSearchObservationSession,
  type SearchObservationSessionDependencies,
} from '@/entrypoints/content/logic/search-observation-session';
import { dispatchPoeEvent, initPoeEventNonce, listenPoeEvent } from '@/utils/event-contracts';
import { getTradeVersionProfile } from '@/utils/trade-context';

const sessionCleanups: Array<() => void> = [];

afterEach(() => {
  sessionCleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Search Observation Session interface', () => {
  it('connects listeners before Bookmark hydration and owns their cleanup', async () => {
    const order: string[] = [];
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    const page = installPage('https://www.pathofexile.com/trade/search/Standard');
    const criteria = vi.fn();
    const cleanup = await connect({
      execute,
      consumeCriteria: criteria,
      bookmarks: createBookmarks({
        subscribe: () => {
          order.push('subscribe');
          return () => order.push('unsubscribe');
        },
        readCollection: async () => {
          order.push('read');
          return emptyCollection();
        },
      }),
    });

    expect(order.slice(0, 2)).toEqual(['subscribe', 'read']);
    emitQuery('search-1', { type: 'Ring' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(criteria).toHaveBeenCalledWith('search-1', { type: 'Ring' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'record-history' }));

    cleanup();
    page.setUrl('https://www.pathofexile.com/trade/search/Standard/search-2');
    emitQuery('search-2');
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(order).toContain('unsubscribe');
  });

  it('classifies enrichment in FIFO order and refreshes A after A to B to A reuse', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    await connect({ execute });

    emitQuery('A');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    emitQuery('A');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    emitQuery('B');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    emitQuery('A');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));

    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      'record-history',
      'upsert-search-record',
      'record-history',
      'record-history',
    ]);
  });

  it('classifies query and fetch observations once regardless of arrival order', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    await connect({ execute });

    emitQuery('query-first');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    emitFetch('query-first', ['late.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    emitFetch('fetch-first', ['early.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    emitQuery('fetch-first');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));

    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      'record-history',
      'upsert-search-record',
      'record-history',
      'upsert-search-record',
    ]);
  });

  it('refreshes fetch-only A to B to A uses and carries each first result icon', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    await connect({ execute });

    emitFetch('A', ['a.png', 'ignored-a.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    emitFetch('B', ['b.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    emitFetch('A', ['a-again.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));

    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      'record-history',
      'record-history',
      'record-history',
    ]);
    expect(execute.mock.calls.map(([command]) => command.entry.icon)).toEqual([
      toCdnUrl('a.png'),
      toCdnUrl('b.png'),
      toCdnUrl('a-again.png'),
    ]);
  });

  it('retries a failed Search Record use without marking its identity recorded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'storage-failure', message: 'failed' } })
      .mockResolvedValueOnce({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    await connect({ execute });

    emitQuery('retry-me');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    emitQuery('retry-me');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      'record-history',
      'record-history',
    ]);
  });

  it('ignores live fetches and records one query per live session', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    const page = installPage('https://www.pathofexile.com/trade/search/Standard/search-1/live');
    await connect({ execute });

    emitFetch('search-1', ['live.png']);
    emitQuery('search-1');
    emitQuery('search-1');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    page.setUrl('https://www.pathofexile.com/trade/search/Standard/search-1');
    emitQuery('search-1');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      'record-history',
      'record-history',
    ]);
  });

  it('does not start queued capture work after disposal', async () => {
    let release!: (value: { ok: true; changed: true }) => void;
    const execute = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    const cleanup = await connect({ execute });

    emitQuery('A');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    emitQuery('B');
    cleanup();
    release({ ok: true, changed: true });
    await flush();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not let an old generation completion classify the new generation', async () => {
    let release!: (value: { ok: true; changed: true }) => void;
    const execute = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, changed: true });
    const page = installPage('https://www.pathofexile.com/trade/search/Standard');
    await connect({ execute });

    emitFetch('A', ['a.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    page.setUrl('https://www.pathofexile.com/trade/search/Standard/A/live');
    page.setUrl('https://www.pathofexile.com/trade/search/Standard/A');
    emitQuery('A');
    release({ ok: true, changed: true });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      'record-history',
      'record-history',
    ]);
  });

  it('ignores malformed events, accumulates images, and clears them on live entry', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    const page = installPage('https://www.pathofexile.com/trade/search/Standard/search-1');
    const images: Array<{ url: string; images: string[] }> = [];
    sessionCleanups.push(listenPoeEvent('poexd-result-images', (detail) => images.push(detail)));
    await connect({ execute });

    dispatchPoeEvent('poexd-fetch-response', '{bad-json');
    dispatchPoeEvent('poexd-fetch-response', JSON.stringify({}));
    dispatchPoeEvent('poexd-fetch-response', JSON.stringify({ data: {} }));
    dispatchPoeEvent('poexd-search-query-observed', '{bad-json');
    await flush();
    expect(execute).not.toHaveBeenCalled();
    expect(images).toEqual([]);
    emitFetch('search-1', ['first.png', 'second.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    emitFetch('search-1', ['second.png', 'third.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(images.at(-1)).toEqual(
      expect.objectContaining({
        images: ['first.png', 'second.png', 'third.png'].map(toCdnUrl),
      }),
    );

    page.setUrl('https://www.pathofexile.com/trade/search/Standard/search-1/live');
    expect(images.at(-1)).toEqual(expect.objectContaining({ images: [] }));
  });

  it('clears previous result images when a new search returns no results (no fetch)', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard/search-1');
    const images: Array<{ url: string; images: string[] }> = [];
    sessionCleanups.push(listenPoeEvent('poexd-result-images', (detail) => images.push(detail)));
    await connect({ execute });

    emitQuery('search-1');
    emitFetch('search-1', ['old.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(images.at(-1)?.images).toEqual([toCdnUrl('old.png')]);

    emitQuery('search-2');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(images.at(-1)).toEqual({
      url: expect.stringContaining('search-2'),
      images: [],
    });
  });

  it('keeps capture alive when Bookmark hydration or criteria consumption fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    await connect({
      execute,
      consumeCriteria: () => {
        throw new Error('highlighter unavailable');
      },
      bookmarks: createBookmarks({
        readCollection: () => Promise.reject(new Error('background unavailable')),
      }),
    });

    emitQuery('still-recorded');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'record-history' }));
  });

  it('keeps capture alive when optional setup and result-image publication fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    const page = installPage('https://www.pathofexile.com/trade/search/Standard');
    const preferences = {
      read: () => {
        throw new Error('preference read unavailable');
      },
      update: vi.fn(),
      subscribe: () => {
        throw new Error('preference subscribe unavailable');
      },
    } as any;
    await connect({
      execute,
      preferences,
      bookmarks: createBookmarks({
        subscribe: () => {
          throw new Error('Bookmark subscribe unavailable');
        },
      }),
    });
    page.failEvent('poexd-result-images');

    emitFetch('still-recorded', ['item.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'record-history' }));
  });

  it('removes core listeners even when an optional cleanup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const cleanup = await connect({
      execute,
      bookmarks: createBookmarks({
        subscribe: () => () => {
          throw new Error('Bookmark cleanup unavailable');
        },
      }),
    });

    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith(
      'poexd-search-query-observed',
      expect.any(Function),
    );
    expect(removeEventListener).toHaveBeenCalledWith('poexd-fetch-response', expect.any(Function));
    emitQuery('must-not-run');
    await flush();

    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the newest Bookmark title read and applies auto-title Preference changes', async () => {
    const firstRead = deferred<ReturnType<typeof collectionWithBookmark>>();
    const changedRead = deferred<ReturnType<typeof collectionWithBookmark>>();
    let notifyBookmarkChange: () => void = () => undefined;
    const preferences = createPreferenceHarness();
    const page = installPage('https://www.pathofexile.com/trade/search/Standard/A');
    await connect({
      preferences: preferences.module,
      bookmarks: createBookmarks({
        subscribe(listener: () => void) {
          notifyBookmarkChange = listener;
          return () => undefined;
        },
        readCollection: vi
          .fn()
          .mockReturnValueOnce(firstRead.promise)
          .mockReturnValueOnce(changedRead.promise),
      }),
    });

    notifyBookmarkChange();
    changedRead.resolve(collectionWithBookmark('New title'));
    await vi.waitFor(() => expect(page.title.innerText).toBe('New title'));
    firstRead.resolve(collectionWithBookmark('Stale title'));
    await flush();
    expect(page.title.innerText).toBe('New title');

    preferences.setAutoTitle(false);
    expect(page.title.innerText).toBe(getTradeVersionProfile('poe1').defaultTitle);
  });

  it('does not record a new history use during page reload with same search id, but records next real search', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    const page = installPage('https://www.pathofexile.com/trade/search/Standard/existing-A');
    await connect({ execute });

    // 1. Initial query hydration (sendCurrentQuery)
    emitCurrentQuery({ type: 'Ring' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0][0].type).toBe('upsert-search-record');

    // 2. Initial search response
    emitQuery('existing-A', { type: 'Ring' }, 'search-response');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][0].type).toBe('upsert-search-record');

    // 3. Initial fetch response
    emitFetch('existing-A', ['ring.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls[2][0].type).toBe('upsert-search-record');

    // 驗證整個 reload 流程完全沒有產生 record-history
    const historyCalls = execute.mock.calls.filter(([cmd]) => cmd.type === 'record-history');
    expect(historyCalls.length).toBe(0);

    // 4. 使用者在頁面上真正執行另一個新搜尋
    page.setUrl('https://www.pathofexile.com/trade/search/Standard/new-B');
    emitQuery('new-B', { type: 'Belt' }, 'search-response');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    expect(execute.mock.calls[3][0]).toEqual(
      expect.objectContaining({
        type: 'record-history',
        entry: expect.objectContaining({
          url: 'https://www.pathofexile.com/trade/search/Standard/new-B',
        }),
      }),
    );
  });

  it('does not create duplicate history when official search response re-allocates a new search ID during reload bootstrap', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    const page = installPage('https://www.pathofexile.com/trade/search/Standard/identity-A');
    await connect({ execute });

    // 1. Initial query hydration 帶有 identity-A 的條件
    emitCurrentQuery({ type: 'Headhunter' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0][0].type).toBe('upsert-search-record');

    // 2. 官方在 reload bootstrap 期間生成了新 search ID B
    emitQuery('identity-B', { type: 'Headhunter' }, 'search-response');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][0].type).toBe('upsert-search-record');

    // 3. 官方結果 fetch
    emitFetch('identity-B', ['hh.png']);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls[2][0].type).toBe('upsert-search-record');

    // 驗證 reload 期間產生新 ID B 時，依然完全不會新增或複製任何 record-history
    const historyCalls = execute.mock.calls.filter(([cmd]) => cmd.type === 'record-history');
    expect(historyCalls.length).toBe(0);

    // 4. 使用者隨後真正發起新搜尋 C
    page.setUrl('https://www.pathofexile.com/trade/search/Standard/search-C');
    emitQuery('search-C', { type: 'Mageblood' }, 'search-response');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    expect(execute.mock.calls[3][0]).toEqual(
      expect.objectContaining({
        type: 'record-history',
        entry: expect.objectContaining({
          url: 'https://www.pathofexile.com/trade/search/Standard/search-C',
        }),
      }),
    );
  });

  it('records history when user performs a real search B before any bootstrap search-response arrives', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard/A');
    await connect({ execute });

    // 不送任何 bootstrap search-response
    // 使用者直接真正搜尋 B
    emitQuery('B', { type: 'Belt' }, 'search-response');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'record-history',
        entry: expect.objectContaining({
          url: 'https://www.pathofexile.com/trade/search/Standard/B',
        }),
      }),
    );
  });

  it('rejects arbitrary external icon in forged poexd-fetch-response and retains legitimate PoE CDN icon', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    installPage('https://www.pathofexile.com/trade/search/Standard');
    await connect({ execute });

    // 1. Forged fetch response with arbitrary external image URLs
    dispatchPoeEvent(
      'poexd-fetch-response',
      JSON.stringify({
        url: '/api/trade/fetch/results?query=forged-search',
        data: {
          result: [
            { item: { icon: 'https://attacker.site/exploit.png' } },
            { item: { icon: 'javascript:alert("pwned")' } },
            { item: { icon: 'data:image/svg+xml;utf8,<svg></svg>' } },
          ],
        },
      }),
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0][0].entry.icon).toBeUndefined();

    // 2. Legitimate PoE CDN icon is properly retained
    dispatchPoeEvent(
      'poexd-fetch-response',
      JSON.stringify({
        url: '/api/trade/fetch/results?query=legit-search',
        data: {
          result: [{ item: { icon: 'https://web.poecdn.com/gen/image/legit-chaos.png' } }],
        },
      }),
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        type: 'record-history',
        entry: expect.objectContaining({
          icon: 'https://web.poecdn.com/gen/image/legit-chaos.png',
        }),
      }),
    );
  });
});

async function connect(
  options: {
    execute?: ReturnType<typeof vi.fn>;
    consumeCriteria?: SearchObservationSessionDependencies['consumeCriteria'];
    bookmarks?: SearchObservationSessionDependencies['bookmarks'];
    preferences?: SearchObservationSessionDependencies['preferences'];
  } = {},
) {
  const cleanup = await connectSearchObservationSession({
    version: 'poe1',
    preferences: options.preferences ?? createPreferences(),
    consumeCriteria: options.consumeCriteria ?? (() => undefined),
    searchRecords: {
      execute: (options.execute ?? vi.fn().mockResolvedValue({ ok: true, changed: true })) as any,
      read: vi.fn(),
      subscribe: vi.fn(),
    },
    bookmarks: options.bookmarks ?? createBookmarks(),
  });
  sessionCleanups.push(cleanup);
  return cleanup;
}

function installPage(initialUrl: string) {
  const eventTarget = new EventTarget() as EventTarget & { location: Record<string, string> };
  const title = { innerText: '' };
  let failedEventType = '';
  const setLocation = (url: string) => {
    const parsed = new URL(url);
    eventTarget.location = {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
    };
  };
  setLocation(initialUrl);
  vi.stubGlobal('window', eventTarget);
  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => (selector === 'title' ? title : null)),
  });
  vi.stubGlobal(
    'CustomEvent',
    class<T> extends Event {
      readonly detail: T;
      constructor(type: string, init: CustomEventInit<T>) {
        super(type);
        if (type === failedEventType) throw new Error(`${type} unavailable`);
        this.detail = init.detail as T;
      }
    },
  );
  initPoeEventNonce('search-observation-session-test');
  return {
    title,
    setUrl(url: string) {
      setLocation(url);
      eventTarget.dispatchEvent(new Event('popstate'));
    },
    failEvent(type: string) {
      failedEventType = type;
    },
  };
}

function createPreferences(enableAutoTitle = true) {
  return createPreferenceHarness(enableAutoTitle).module;
}

function createPreferenceHarness(enableAutoTitle = true) {
  const listeners = new Set<(snapshot: any) => void>();
  let snapshot = { enableAutoTitle };
  return {
    module: {
      read: () => snapshot,
      update: vi.fn(),
      subscribe(listener: (value: any) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as any,
    setAutoTitle(enabled: boolean) {
      snapshot = { enableAutoTitle: enabled };
      listeners.forEach((listener) => listener(snapshot));
    },
  };
}

function createBookmarks(overrides: Partial<any> = {}) {
  return {
    readCollection: vi.fn(async () => emptyCollection()),
    subscribe: vi.fn(() => () => undefined),
    ...overrides,
  } as any;
}

function emptyCollection() {
  return { ok: true as const, value: { groups: [], bookmarks: [] } };
}

function collectionWithBookmark(name: string) {
  return {
    ok: true as const,
    value: {
      groups: [],
      bookmarks: [
        {
          id: 'bookmark-1',
          searchRecordId: 'record-1',
          name,
          url: 'https://www.pathofexile.com/trade/search/Standard/A',
          groupId: 'group-1',
          order: 0,
          createdAt: 1,
        },
      ],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function emitQuery(searchId: string, criteria: unknown = {}, source?: string) {
  dispatchPoeEvent(
    'poexd-search-query-observed',
    JSON.stringify({
      searchId,
      queryJson: JSON.stringify({ query: criteria }),
      ...(source ? { source } : {}),
    }),
  );
}

function emitCurrentQuery(criteria: unknown = {}) {
  dispatchPoeEvent(
    'poexd-search-query-observed',
    JSON.stringify({
      queryJson: JSON.stringify({ query: criteria }),
      source: 'current-query',
    }),
  );
}

const cdnPrefix = 'https://web.poecdn.com/image/';
function toCdnUrl(icon: string) {
  return /^(?:https?|javascript|data|vbscript):/i.test(icon) ? icon : `${cdnPrefix}${icon}`;
}

function emitFetch(searchId: string, images: string[]) {
  dispatchPoeEvent(
    'poexd-fetch-response',
    JSON.stringify({
      url: `/api/trade/fetch/results?query=${searchId}`,
      data: { result: images.map((icon) => ({ item: { icon: toCdnUrl(icon) } })) },
    }),
  );
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
