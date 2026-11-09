import { describe, expect, it, vi } from 'vitest';
import {
  isTradePageReady,
  whenTradePageReady,
} from '../entrypoints/content/logic/trade-page-readiness';

describe('Trade page readiness', () => {
  it('recognizes the real trade site content', () => {
    const root = { querySelector: (selector: string) => (selector === '.content' ? {} : null) };

    expect(isTradePageReady(root as Pick<Document, 'querySelector'>)).toBe(true);
  });

  it('rejects an interstitial page without trade content', () => {
    const root = { querySelector: () => null };

    expect(isTradePageReady(root as Pick<Document, 'querySelector'>)).toBe(false);
  });

  it('triggers immediately when trade content is already present in ready document', () => {
    const onReady = vi.fn();
    const fakeDoc = {
      readyState: 'complete',
      querySelector: (selector: string) => (selector === '.content' ? {} : null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      documentElement: {},
    } as unknown as Document;

    whenTradePageReady(fakeDoc, onReady);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('waits for DOMContentLoaded when document is still loading', () => {
    const onReady = vi.fn();
    let domContentLoadedListener: (() => void) | null = null;
    let hasContent = false;

    const fakeDoc = {
      readyState: 'loading',
      querySelector: (selector: string) => (selector === '.content' && hasContent ? {} : null),
      addEventListener: vi.fn((event: string, listener: any) => {
        if (event === 'DOMContentLoaded') domContentLoadedListener = listener;
      }),
      removeEventListener: vi.fn((event: string, listener: any) => {
        if (event === 'DOMContentLoaded' && domContentLoadedListener === listener) {
          domContentLoadedListener = null;
        }
      }),
      documentElement: {},
    } as unknown as Document;

    whenTradePageReady(fakeDoc, onReady);

    expect(onReady).not.toHaveBeenCalled();
    expect(domContentLoadedListener).not.toBeNull();

    // Now trade page loads and DOMContentLoaded fires
    hasContent = true;
    (fakeDoc as any).readyState = 'interactive';
    domContentLoadedListener!();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('observes DOM mutations when content is not yet present after load', () => {
    const onReady = vi.fn();
    let observerCallback: (() => void) | null = null;
    const disconnectSpy = vi.fn();
    let hasContent = false;

    const originalMutationObserver = globalThis.MutationObserver;
    class MockMutationObserver {
      constructor(callback: any) {
        observerCallback = callback;
      }
      observe = vi.fn();
      disconnect = disconnectSpy;
    }
    globalThis.MutationObserver = MockMutationObserver as any;

    try {
      const fakeDoc = {
        readyState: 'complete',
        querySelector: (selector: string) => (selector === '.content' && hasContent ? {} : null),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        documentElement: {},
      } as unknown as Document;

      whenTradePageReady(fakeDoc, onReady);

      expect(onReady).not.toHaveBeenCalled();
      expect(observerCallback).not.toBeNull();

      // Content appears via mutation
      hasContent = true;
      observerCallback!();

      expect(onReady).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

  it('can be cancelled before trade page becomes ready', () => {
    const onReady = vi.fn();
    let observerCallback: (() => void) | null = null;
    const disconnectSpy = vi.fn();
    let hasContent = false;

    const originalMutationObserver = globalThis.MutationObserver;
    class MockMutationObserver {
      constructor(callback: any) {
        observerCallback = callback;
      }
      observe = vi.fn();
      disconnect = disconnectSpy;
    }
    globalThis.MutationObserver = MockMutationObserver as any;

    try {
      const fakeDoc = {
        readyState: 'complete',
        querySelector: (selector: string) => (selector === '.content' && hasContent ? {} : null),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        documentElement: {},
      } as unknown as Document;

      const cleanup = whenTradePageReady(fakeDoc, onReady);
      cleanup();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);

      hasContent = true;
      if (typeof observerCallback === 'function') {
        (observerCallback as () => void)();
      }
      expect(onReady).not.toHaveBeenCalled();
    } finally {
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

  it('does not trigger if isDisposed returns true', () => {
    const onReady = vi.fn();
    const fakeDoc = {
      readyState: 'complete',
      querySelector: (selector: string) => (selector === '.content' ? {} : null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      documentElement: {},
    } as unknown as Document;

    whenTradePageReady(fakeDoc, onReady, { isDisposed: () => true });

    expect(onReady).not.toHaveBeenCalled();
  });
});
