// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapBridge } from '../entrypoints/main-world/bridge-bootstrap';

/**
 * 官方 `save(true)` 會 await 被外掛包裝過的 history.pushState；外掛副作用拋錯時
 * 不可讓官方導航失敗，否則同步搜尋表單（書籤、送入主控台）會立即失敗。
 */
describe('history interceptor side-effect guard', () => {
  const originalLocation = window.location.href;
  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;

  afterEach(() => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
    delete (window.history as any).__poexdHistoryPatched;
    delete (window as any).__poexdInterceptorInstalled;
    delete (window as any).__poexdUpdateNonce;
    window.history.replaceState(null, '', originalLocation);
    document.querySelectorAll('script').forEach((s) => s.remove());
    vi.restoreAllMocks();
  });

  function bootstrapWithThrowingRouteSync() {
    window.history.replaceState(null, '', '/trade/search/Standard/before');
    const script = document.createElement('script');
    script.setAttribute('data-nonce', 'guard-nonce');
    document.body.appendChild(script);
    Object.defineProperty(document, 'currentScript', {
      value: script,
      configurable: true,
      writable: true,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const routeSync = vi.fn(() => {
      throw new Error('tagger exploded');
    });
    const historyChanged = vi.fn();
    window.addEventListener('poexd-history-changed', historyChanged);
    bootstrapBridge({ onRouteSync: routeSync });
    historyChanged.mockClear();
    return { consoleError, routeSync, historyChanged };
  }

  it('keeps pushState working when the route sync side effect throws', () => {
    const { consoleError, routeSync, historyChanged } = bootstrapWithThrowingRouteSync();

    expect(() =>
      window.history.pushState({ tab: 'search' }, '', '/trade/search/Standard/after'),
    ).not.toThrow();

    expect(window.location.pathname).toBe('/trade/search/Standard/after');
    expect(window.history.state).toEqual({ tab: 'search' });
    expect(routeSync).toHaveBeenCalledWith('pushState');
    expect(historyChanged).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it('keeps replaceState working when the route sync side effect throws', () => {
    const { consoleError, routeSync } = bootstrapWithThrowingRouteSync();

    expect(() =>
      window.history.replaceState(null, '', '/trade/search/Standard/replaced'),
    ).not.toThrow();

    expect(window.location.pathname).toBe('/trade/search/Standard/replaced');
    expect(routeSync).toHaveBeenCalledWith('replaceState');
    expect(consoleError).toHaveBeenCalled();
  });
});
