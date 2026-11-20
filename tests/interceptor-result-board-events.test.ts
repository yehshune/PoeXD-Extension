// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import {
  installFetchInterceptor,
  installXhrInterceptor,
} from '@/entrypoints/main-world/network-observer';
import { resetTradeRequestIdleForTests } from '@/entrypoints/main-world/trade-request-idle';

function fakeResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    clone: () => ({ json: async () => body }),
  };
}

describe('fetch interceptor result board events', () => {
  let events: Array<{ type: string; payload?: string }> = [];
  let bridge: MainWorldBridge;

  const install = (response: unknown) => {
    const win = { fetch: vi.fn().mockResolvedValue(response) } as unknown as Window;
    installFetchInterceptor(bridge, win);
    return win;
  };
  const payloadOf = (type: string) => {
    const event = events.find((entry) => entry.type === type);
    return event?.payload ? JSON.parse(event.payload) : undefined;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 0));
    resetTradeRequestIdleForTests();
    events = [];
    bridge = {
      dispatchEvent: (type: string, payload?: string) => events.push({ type, payload }),
      addListener: vi.fn(),
    } as unknown as MainWorldBridge;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dispatches the search result summary', async () => {
    const win = install(
      fakeResponse({ id: 'abc', result: ['1', '2', '3'], total: 10000, inexact: true }),
    );
    await win.fetch('https://www.pathofexile.com/api/trade/search/Standard', {
      method: 'POST',
      body: JSON.stringify({ query: {} }),
    });
    expect(payloadOf('poexd-search-result-summary')).toEqual({
      searchId: 'abc',
      total: 10000,
      resultCount: 3,
      inexact: true,
    });
  });

  it('dispatches a fetch failure instead of a fetch response', async () => {
    const url = 'https://www.pathofexile.com/api/trade/fetch/a,b?query=abc';
    const win = install(fakeResponse({ error: { code: 3 } }, { ok: false, status: 429 }));
    await win.fetch(url);
    expect(payloadOf('poexd-fetch-failed')).toEqual({ url, status: 429 });
    expect(events.some((event) => event.type === 'poexd-fetch-response')).toBe(false);
  });

  it('dispatches the whisper outcome with the official error code', async () => {
    const win = install(
      fakeResponse({ error: { code: 1, message: 'gone' } }, { ok: false, status: 404 }),
    );
    await win.fetch('https://www.pathofexile.com/api/trade/whisper', {
      method: 'POST',
      body: '{}',
    });
    expect(payloadOf('poexd-whisper-outcome')).toEqual({ status: 404, code: 1 });
  });

  it('dispatches a successful whisper outcome without a code', async () => {
    const win = install(fakeResponse({ success: true }));
    await win.fetch('https://www.pathofexile.com/api/trade2/whisper', {
      method: 'POST',
      body: '{}',
    });
    expect(payloadOf('poexd-whisper-outcome')).toEqual({ status: 200 });
  });

  it('still reports the whisper status when the body is not JSON', async () => {
    const response = {
      ok: false,
      status: 500,
      clone: () => ({
        json: async () => {
          throw new Error('not json');
        },
      }),
    };
    const win = install(response);
    await win.fetch('https://www.pathofexile.com/api/trade/whisper', {
      method: 'POST',
      body: '{}',
    });
    expect(payloadOf('poexd-whisper-outcome')).toEqual({ status: 500 });
  });
});

describe('XHR interceptor result board events', () => {
  function runXhr(url: string, response: { status: number; body: string }) {
    const events: Array<{ type: string; payload?: string }> = [];
    const bridge = {
      dispatchEvent: (type: string, payload?: string) => events.push({ type, payload }),
      addListener: vi.fn(),
    } as unknown as MainWorldBridge;

    class FakeXMLHttpRequest {
      responseType = '';
      responseText = response.body;
      status = response.status;
      readyState = 4;
      private listeners: Record<string, Array<() => void>> = {};
      open(_method?: string, _url?: string) {}
      send(_body?: unknown) {
        this.listeners.load?.forEach((listener) => listener.call(this));
      }
      addEventListener(type: string, listener: () => void) {
        (this.listeners[type] ||= []).push(listener);
      }
      dispatchEvent() {
        return true;
      }
    }

    const fakeWindow = { XMLHttpRequest: FakeXMLHttpRequest } as unknown as Window;
    installXhrInterceptor(bridge, fakeWindow);
    const xhr = new (
      fakeWindow as unknown as { XMLHttpRequest: typeof FakeXMLHttpRequest }
    ).XMLHttpRequest();
    xhr.open('POST', url);
    xhr.send('{}');
    const event = (type: string) => events.find((entry) => entry.type === type);
    return (type: string) => {
      const found = event(type);
      return found?.payload ? JSON.parse(found.payload) : undefined;
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 0));
    resetTradeRequestIdleForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dispatches the search result summary from an XHR search', () => {
    const payloadOf = runXhr('https://www.pathofexile.com/api/trade/search/Standard', {
      status: 200,
      body: JSON.stringify({ id: 'abc', result: ['1', '2'], total: 500 }),
    });
    expect(payloadOf('poexd-search-result-summary')).toEqual({
      searchId: 'abc',
      total: 500,
      resultCount: 2,
      inexact: false,
    });
  });

  it('skips the summary when the XHR search failed', () => {
    const payloadOf = runXhr('https://www.pathofexile.com/api/trade/search/Standard', {
      status: 400,
      body: JSON.stringify({ error: { code: 2 } }),
    });
    expect(payloadOf('poexd-search-result-summary')).toBeUndefined();
  });

  it('dispatches the whisper outcome from an XHR whisper', () => {
    const payloadOf = runXhr('https://www.pathofexile.com/api/trade/whisper', {
      status: 404,
      body: JSON.stringify({ error: { code: 1, message: 'gone' } }),
    });
    expect(payloadOf('poexd-whisper-outcome')).toEqual({ status: 404, code: 1 });
  });

  it('reports the XHR whisper status when the body is not JSON', () => {
    const payloadOf = runXhr('https://www.pathofexile.com/api/trade/whisper', {
      status: 200,
      body: 'ok',
    });
    expect(payloadOf('poexd-whisper-outcome')).toEqual({ status: 200 });
  });
});
