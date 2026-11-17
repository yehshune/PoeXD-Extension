import { describe, expect, it } from 'vitest';
import {
  createInitialPageLoadGate,
  type InitialPageLoadGateDeps,
} from '@/entrypoints/content/logic/initial-page-load-gate';
import { expectsInitialSearchResults } from '@/utils/trade-search-identity';

function createHarness(appReady = false) {
  const state = { appReady };
  const domObservers = new Set<() => void>();
  const fetchListeners = new Set<() => void>();
  const searchListeners = new Set<() => void>();
  const timers: { callback: () => void; ms: number; active: boolean }[] = [];
  const idles: { callback: () => void; active: boolean }[] = [];
  const subscribe = (set: Set<() => void>) => (callback: () => void) => {
    set.add(callback);
    return () => set.delete(callback);
  };
  const deps: InitialPageLoadGateDeps = {
    isAppReady: () => state.appReady,
    observeDom: subscribe(domObservers),
    listenFetchResponse: subscribe(fetchListeners),
    listenSearchTriggered: subscribe(searchListeners),
    setTimer: (callback, ms) => {
      const timer = { callback, ms, active: true };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
    whenIdle: (callback) => {
      const idle = { callback, active: true };
      idles.push(idle);
      return () => {
        idle.active = false;
      };
    },
  };
  return {
    deps,
    mountApp() {
      state.appReady = true;
      [...domObservers].forEach((callback) => callback());
    },
    fetchResponse: () => [...fetchListeners].forEach((callback) => callback()),
    searchTriggered: () => [...searchListeners].forEach((callback) => callback()),
    fireTimer(ms: number) {
      timers
        .filter((t) => t.active && t.ms === ms)
        .forEach((t) => {
          t.active = false;
          t.callback();
        });
    },
    runIdle() {
      idles
        .filter((i) => i.active)
        .forEach((i) => {
          i.active = false;
          i.callback();
        });
    },
    pendingIdle: () => idles.filter((i) => i.active).length,
    listenerCount: () => domObservers.size + fetchListeners.size + searchListeners.size,
    activeTimers: () => timers.filter((t) => t.active).length,
  };
}

async function isResolved(promise: Promise<void>): Promise<boolean> {
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return resolved;
}

describe('initial page load gate', () => {
  it('waits for the official app and the first result fetch, then for idle', async () => {
    const h = createHarness();
    const gate = createInitialPageLoadGate({ expectsInitialResults: true }, h.deps);

    h.mountApp();
    expect(h.pendingIdle()).toBe(0);
    h.fetchResponse();
    expect(h.pendingIdle()).toBe(1);
    expect(await isResolved(gate.ready)).toBe(false);

    h.runIdle();
    expect(await isResolved(gate.ready)).toBe(true);
    expect(h.listenerCount()).toBe(0);
    expect(h.activeTimers()).toBe(0);
  });

  it('does not wait for results the page will not fetch', async () => {
    const h = createHarness();
    const gate = createInitialPageLoadGate({ expectsInitialResults: false }, h.deps);

    h.mountApp();
    h.runIdle();
    expect(await isResolved(gate.ready)).toBe(true);
  });

  it('treats a search without a follow-up fetch as an empty result set', async () => {
    const h = createHarness(true);
    const gate = createInitialPageLoadGate(
      { expectsInitialResults: true, searchWithoutFetchMs: 1500 },
      h.deps,
    );

    h.searchTriggered();
    expect(h.pendingIdle()).toBe(0);
    h.fireTimer(1500);
    h.runIdle();
    expect(await isResolved(gate.ready)).toBe(true);
  });

  it('gives up waiting after the max wait so the extension always initializes', async () => {
    const h = createHarness();
    const gate = createInitialPageLoadGate(
      { expectsInitialResults: true, maxWaitMs: 5000 },
      h.deps,
    );

    h.fireTimer(5000);
    h.runIdle();
    expect(await isResolved(gate.ready)).toBe(true);
    expect(h.listenerCount()).toBe(0);
  });

  it('never resolves after cancel and releases every listener', async () => {
    const h = createHarness();
    const gate = createInitialPageLoadGate({ expectsInitialResults: true }, h.deps);

    gate.cancel();
    h.mountApp();
    h.fetchResponse();
    h.fireTimer(5000);
    h.runIdle();
    expect(await isResolved(gate.ready)).toBe(false);
    expect(h.listenerCount()).toBe(0);
    expect(h.activeTimers()).toBe(0);
  });

  it('cancels a pending idle callback', async () => {
    const h = createHarness(true);
    const gate = createInitialPageLoadGate({ expectsInitialResults: false }, h.deps);

    expect(h.pendingIdle()).toBe(1);
    gate.cancel();
    expect(h.pendingIdle()).toBe(0);
  });
});

describe('expectsInitialSearchResults', () => {
  const url = (path: string) => `https://www.pathofexile.com${path}`;

  it('expects results only on search pages that carry a search id', () => {
    expect(expectsInitialSearchResults(url('/trade/search/Standard/abc123'))).toBe(true);
    expect(expectsInitialSearchResults(url('/trade2/search/poe2/Standard/abc123'))).toBe(true);
    expect(expectsInitialSearchResults(url('/trade/search/Standard'))).toBe(false);
    expect(expectsInitialSearchResults(url('/trade/search/Standard/abc123/live'))).toBe(false);
    expect(expectsInitialSearchResults(url('/trade/exchange/Standard'))).toBe(false);
  });
});
