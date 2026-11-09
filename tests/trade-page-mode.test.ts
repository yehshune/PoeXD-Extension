import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTradePageMode, watchTradePageMode } from '@/utils/trade-page-mode';
import { initPoeEventNonce } from '@/utils/event-contracts';

afterEach(() => vi.unstubAllGlobals());

describe('Trade page mode', () => {
  it('detects only a trailing live path segment', () => {
    expect(getTradePageMode('/trade/search/Standard/search-1')).toBe('search');
    expect(getTradePageMode('/trade/search/Standard/search-1/live')).toBe('live');
    expect(getTradePageMode('/trade/search/Standard/live-item')).toBe('search');
  });

  it('observes same-page history transitions into and out of live mode', () => {
    let pathname = '/trade/search/Standard/search-1';
    const listeners = new Map<string, Set<() => void>>();
    const windowStub = {
      location: {
        get pathname() {
          return pathname;
        },
      },
      addEventListener: (type: string, listener: () => void) => {
        const group = listeners.get(type) ?? new Set();
        group.add(listener);
        listeners.set(type, group);
      },
      removeEventListener: (type: string, listener: () => void) =>
        listeners.get(type)?.delete(listener),
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((listener) => (listener as any)(event));
        return true;
      },
    };
    vi.stubGlobal('window', windowStub);
    initPoeEventNonce('mode-test');
    const modes: string[] = [];

    const cleanup = watchTradePageMode((mode) => modes.push(mode));
    const dispatchHistory = () =>
      windowStub.dispatchEvent({
        type: 'poexd-history-changed',
        detail: { source: 'poexd', nonce: 'mode-test' },
      } as any);
    pathname = '/trade/search/Standard/search-1/live';
    dispatchHistory();
    pathname = '/trade/search/Standard/search-1';
    dispatchHistory();

    expect(modes).toEqual(['search', 'live', 'search']);
    cleanup();
  });
});
