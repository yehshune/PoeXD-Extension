// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapBridge } from '../entrypoints/main-world/bridge-bootstrap';
import {
  ensureActiveBindingSession,
  extractLeagueAndModeFromUrl,
  getActiveSessionId,
  isDocumentReload,
  isSameSessionHistoryEntry,
  resetActiveBindingSessionForTest,
  rolloverBindingSession,
  stampSessionIdToHistoryState,
} from '../entrypoints/main-world/category-binding-manager';
import { syncDomTaggerRoute } from '../entrypoints/main-world/dom-tagger';
import {
  classifyTradeDocumentSync,
  isCloudflareChallenge,
  waitForDocumentBoundary,
} from '../utils/trade-interstitial-classifier';
import { runInterceptorBootstrap } from '../entrypoints/interceptor';

describe('Cloudflare challenge & Main World History recursion regression', () => {
  const originalLocation = window.location.href;
  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;

  beforeEach(() => {
    resetActiveBindingSessionForTest();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
    delete (window.history as any).__poexdHistoryPatched;
    delete (window as any).__poexdInterceptorInstalled;
    delete (window as any).__poexdUpdateNonce;
    window.history.replaceState(null, '', originalLocation);
    resetActiveBindingSessionForTest();
    document.querySelectorAll('script').forEach((s) => s.remove());
  });

  function setupScriptNonce(nonce = 'test-nonce') {
    const script = document.createElement('script');
    script.setAttribute('data-nonce', nonce);
    document.body.appendChild(script);
    Object.defineProperty(document, 'currentScript', {
      value: script,
      configurable: true,
      writable: true,
    });
    return script;
  }

  describe('1. Production-equivalent bootstrapBridge(syncDomTaggerRoute) on non-search routes', () => {
    it('does not cause recursion or infinite replaceState loops on /trade2 root', () => {
      window.history.replaceState(null, '', '/trade2');
      setupScriptNonce();

      let replaceStateCallCount = 0;
      const originalReplaceInWindow = window.history.replaceState.bind(window.history);
      vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => {
        replaceStateCallCount++;
        if (replaceStateCallCount > 10) {
          throw new RangeError('Maximum call stack size exceeded (recursion detected)');
        }
        return originalReplaceInWindow(...args);
      });

      const bridge = bootstrapBridge({
        onRouteSync: syncDomTaggerRoute,
      });

      expect(bridge).not.toBeNull();

      // Trigger initial route synchronization on non-search route
      expect(() => {
        syncDomTaggerRoute('replaceState');
      }).not.toThrow();

      // Ensure replaceState call count is strictly bounded and no infinite loop occurred
      expect(replaceStateCallCount).toBeLessThanOrEqual(2);
      expect(extractLeagueAndModeFromUrl().mode).toBe('other');
    });

    it('does not cause recursion or infinite replaceState loops on /trade/exchange', () => {
      window.history.replaceState(null, '', '/trade/exchange/Standard');
      setupScriptNonce();

      let replaceStateCallCount = 0;
      const originalReplaceInWindow = window.history.replaceState.bind(window.history);
      vi.spyOn(window.history, 'replaceState').mockImplementation((...args) => {
        replaceStateCallCount++;
        if (replaceStateCallCount > 10) {
          throw new RangeError('Maximum call stack size exceeded (recursion detected)');
        }
        return originalReplaceInWindow(...args);
      });

      const bridge = bootstrapBridge({
        onRouteSync: syncDomTaggerRoute,
      });

      expect(bridge).not.toBeNull();

      expect(() => {
        syncDomTaggerRoute('replaceState');
      }).not.toThrow();

      expect(replaceStateCallCount).toBeLessThanOrEqual(2);
      expect(extractLeagueAndModeFromUrl().mode).toBe('exchange');
    });
  });

  describe('2. PoeXD state-only history updates vs Route transitions', () => {
    it('does not treat state-only history updates (empty url) as route transitions', () => {
      window.history.replaceState(null, '', '/trade/search/Standard/slug1');
      setupScriptNonce();

      const routeSyncSpy = vi.fn();
      bootstrapBridge({
        onRouteSync: routeSyncSpy,
      });

      // PoeXD state persistence: window.history.replaceState(nextState, '')
      stampSessionIdToHistoryState('test_session_id_123');

      // The state must be stamped to window.history.state
      expect(window.history.state?.__poexdSessionId).toBe('test_session_id_123');

      // But routeSyncSpy must NOT be triggered because URL did not change
      expect(routeSyncSpy).not.toHaveBeenCalled();
    });

    it('triggers route sync when replaceState actually changes the URL', () => {
      window.history.replaceState(null, '', '/trade/search/Standard/slug1');
      setupScriptNonce();

      const routeSyncSpy = vi.fn();
      bootstrapBridge({
        onRouteSync: routeSyncSpy,
      });

      window.history.replaceState(null, '', '/trade/search/Standard/slug2');

      expect(routeSyncSpy).toHaveBeenCalledWith('replaceState');
      expect(window.location.pathname).toBe('/trade/search/Standard/slug2');
    });

    it('triggers route sync when pushState actually changes the URL', () => {
      window.history.replaceState(null, '', '/trade/search/Standard/slug1');
      setupScriptNonce();

      const routeSyncSpy = vi.fn();
      bootstrapBridge({
        onRouteSync: routeSyncSpy,
      });

      window.history.pushState(null, '', '/trade/search/Standard/slug3');

      expect(routeSyncSpy).toHaveBeenCalledWith('pushState');
      expect(window.location.pathname).toBe('/trade/search/Standard/slug3');
    });
  });

  describe('3. Cloudflare challenge detection and pass-through', () => {
    it('detects Cloudflare challenge URLs with __cf_chl_ query parameters', () => {
      expect(
        isCloudflareChallenge({
          search: '?__cf_chl_rt_tk=1234567890',
          href: '/trade2?__cf_chl_rt_tk=1234567890',
        }),
      ).toBe(true);

      expect(
        isCloudflareChallenge({
          search: '?__cf_chl_f_tk=abcdef',
          href: '/trade/search/Standard?__cf_chl_f_tk=abcdef',
        }),
      ).toBe(true);

      expect(
        isCloudflareChallenge({
          search: '?__cf_chl_tk=token999',
          href: '/trade2?__cf_chl_tk=token999',
        }),
      ).toBe(true);
    });

    it('detects Cloudflare challenge DOM indicators', () => {
      const mockDocWithChallengeElement = {
        querySelector: (sel: string) => (sel.includes('.cf-turnstile') ? {} : null),
        title: 'Checking your browser',
      } as any;

      expect(isCloudflareChallenge({ search: '', href: '' }, mockDocWithChallengeElement)).toBe(
        true,
      );

      const mockDocWithJustAMomentTitle = {
        querySelector: () => null,
        title: 'Just a moment...',
      } as any;

      expect(isCloudflareChallenge({ search: '', href: '' }, mockDocWithJustAMomentTitle)).toBe(
        true,
      );
    });

    it('does not falsely classify normal trade pages as challenge', () => {
      expect(
        isCloudflareChallenge({
          search: '',
          href: '/trade2',
        }),
      ).toBe(false);

      expect(
        isCloudflareChallenge({
          search: '',
          href: '/trade/search/Standard/slug1',
        }),
      ).toBe(false);

      expect(
        isCloudflareChallenge({
          search: '?q={"query":{"status":{"option":"online"}}}',
          href: '/trade/search/Standard?q=test',
        }),
      ).toBe(false);
    });

    it('aborts Main World interceptor bootstrap synchronously on Cloudflare challenge URL', () => {
      window.history.replaceState(null, '', '/trade2?__cf_chl_rt_tk=cf_sample_tk');
      setupScriptNonce();

      const bridge = runInterceptorBootstrap();

      // Main world runtime must not start on Cloudflare challenge
      expect(bridge).toBeNull();
      expect((window.history as any).__poexdHistoryPatched).toBeUndefined();
    });

    it('successfully initializes Main World interceptor bootstrap on normal trade URL with trade container present', () => {
      window.history.replaceState(null, '', '/trade2');
      setupScriptNonce();
      const tradeRoot = document.createElement('div');
      tradeRoot.id = 'trade';
      document.body.appendChild(tradeRoot);

      const bridge = runInterceptorBootstrap();

      expect(bridge).not.toBeNull();
      expect((window.history as any).__poexdHistoryPatched).toBe(true);
    });

    it('supports document_start stage when documentElement is not yet present', async () => {
      const fakeDoc = {
        readyState: 'loading',
        documentElement: null,
        querySelector: () => null,
        title: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as Document;

      let observerCb: MutationCallback | null = null;
      const mockObserver = {
        observe: vi.fn(),
        disconnect: vi.fn(),
      };
      const originalMO = globalThis.MutationObserver;
      class MockMutationObserver {
        constructor(cb: MutationCallback) {
          observerCb = cb;
        }
        observe = mockObserver.observe;
        disconnect = mockObserver.disconnect;
      }
      globalThis.MutationObserver = MockMutationObserver as any;

      try {
        const boundaryPromise = waitForDocumentBoundary(fakeDoc, { search: '', href: '/trade2' });

        // Even with documentElement null, observer must observe fakeDoc directly
        expect(mockObserver.observe).toHaveBeenCalledWith(fakeDoc, {
          childList: true,
          subtree: true,
        });

        // Parser creates #trade skeleton
        (fakeDoc as any).querySelector = (sel: string) => (sel.includes('#trade') ? {} : null);
        observerCb!([], {} as any);

        const result = await boundaryPromise;
        expect(result).toBe('trade');
        expect(mockObserver.disconnect).toHaveBeenCalled();
      } finally {
        globalThis.MutationObserver = originalMO;
      }
    });

    it('resolves immediately to trade when trade marker appears before DOMContentLoaded', async () => {
      document.body.innerHTML = '';
      document.title = '';
      const originalReadyState = document.readyState;
      Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

      try {
        const boundaryPromise = waitForDocumentBoundary(document, { search: '', href: '/trade2' });

        // Before DOMContentLoaded, parser inserts #trade container
        const tradeEl = document.createElement('div');
        tradeEl.id = 'trade';
        document.body.appendChild(tradeEl);

        const result = await boundaryPromise;
        expect(result).toBe('trade');
      } finally {
        Object.defineProperty(document, 'readyState', {
          value: originalReadyState,
          configurable: true,
        });
      }
    });

    it('resolves immediately to challenge when challenge marker appears before DOMContentLoaded', async () => {
      document.body.innerHTML = '';
      document.title = '';
      const originalReadyState = document.readyState;
      Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

      try {
        const boundaryPromise = waitForDocumentBoundary(document, { search: '', href: '/trade2' });

        // Before DOMContentLoaded, parser inserts Cloudflare challenge DOM
        const challengeEl = document.createElement('div');
        challengeEl.id = 'challenge-stage';
        document.body.appendChild(challengeEl);

        const result = await boundaryPromise;
        expect(result).toBe('challenge');
      } finally {
        Object.defineProperty(document, 'readyState', {
          value: originalReadyState,
          configurable: true,
        });
      }
    });

    it('does not hang indefinitely when called after DOM is already interactive/complete', async () => {
      document.body.innerHTML = '';
      document.title = '';
      const originalReadyState = document.readyState;
      Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

      try {
        const result = await waitForDocumentBoundary(document, { search: '', href: '/trade2' });
        expect(result).toBe('challenge');
      } finally {
        Object.defineProperty(document, 'readyState', {
          value: originalReadyState,
          configurable: true,
        });
      }
    });

    it('bootstraps Main World synchronously during initial script execution when currentScript is transiently valid', () => {
      window.history.replaceState(null, '', '/trade2');
      const script = document.createElement('script');
      script.setAttribute('data-nonce', 'transient-nonce-123');
      document.body.appendChild(script);

      let current: HTMLScriptElement | null = script;
      Object.defineProperty(document, 'currentScript', {
        get: () => current,
        configurable: true,
      });

      // Synchronous execution during initial script evaluation
      const bridge = runInterceptorBootstrap();
      expect(bridge).not.toBeNull();
      expect((window.history as any).__poexdHistoryPatched).toBe(true);

      // In real browser, after initial script synchronous execution finishes, currentScript becomes null
      current = null;
      expect(document.currentScript).toBeNull();
    });
  });

  describe('4. Regression check for 9a8a979a contract preservation', () => {
    it('preserves session identity on document reload (F5)', () => {
      window.history.replaceState(null, '', '/trade/search/Standard/slug1');
      const session = ensureActiveBindingSession({
        league: 'Standard',
        mode: 'search',
        searchSlug: 'slug1',
      });
      const firstSessionId = session.sessionId;

      // Simulate F5 reload where window.performance navigation is 'reload'
      vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([
        { type: 'reload' } as PerformanceNavigationTiming,
      ]);

      resetActiveBindingSessionForTest(true); // reset in-memory, keep sessionStorage

      const reloadedSession = ensureActiveBindingSession({
        league: 'Standard',
        mode: 'search',
        searchSlug: 'slug1',
      });

      expect(reloadedSession.sessionId).toBe(firstSessionId);
    });

    it('creates new session when navigating to different search in same league on new document', () => {
      window.history.replaceState(null, '', '/trade/search/Standard/slug1');
      const sessionA = ensureActiveBindingSession({
        league: 'Standard',
        mode: 'search',
        searchSlug: 'slug1',
      });
      const sessionAId = sessionA.sessionId;

      // Now user pastes a completely different search URL in address bar (new document, different slug, not reload, history state does not match)
      resetActiveBindingSessionForTest(true); // reset in-memory, keep sessionStorage
      window.history.replaceState(null, '', '/trade/search/Standard/slug2');

      const sessionB = ensureActiveBindingSession({
        league: 'Standard',
        mode: 'search',
        searchSlug: 'slug2',
      });

      expect(sessionB.sessionId).not.toBe(sessionAId);
    });

    it('preserves session when editing query in same search page via replaceState', () => {
      window.history.replaceState(null, '', '/trade/search/Standard/slug1');
      const session1 = ensureActiveBindingSession({
        league: 'Standard',
        mode: 'search',
        searchSlug: 'slug1',
      });
      const initialId = session1.sessionId;

      // PoE official replaces slug after user edits min/max
      window.history.replaceState(null, '', '/trade/search/Standard/slug1_edited');
      const session2 = ensureActiveBindingSession({
        league: 'Standard',
        mode: 'search',
        searchSlug: 'slug1_edited',
        navigationType: 'replaceState',
      });

      expect(session2.sessionId).toBe(initialId);
      expect(session2.searchSlug).toBe('slug1_edited');
    });
  });
});
