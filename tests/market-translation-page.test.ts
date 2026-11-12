// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUiDictionary,
  createPayloadGate,
  forceRerenderVueApps,
  isTradeDataRequest,
  startMarketTranslationPage,
  wrapFetchWithGate,
} from '@/utils/market-translation-page';
import {
  MARKET_MESSAGE_SOURCE,
  isMarketTranslationMessage,
  type MarketTranslationPayload,
} from '@/utils/market-translation-protocol';

const payload: MarketTranslationPayload = {
  locale: 'zh-TW',
  ui: { 'Search Listed Items': '搜尋道具', 'Bulk Item Exchange': '以物易物' },
};

afterEach(() => {
  vi.useRealTimers();
  delete (window as any).__;
});

describe('isMarketTranslationMessage', () => {
  it('只接受帶有來源標記且形狀正確的訊息', () => {
    expect(isMarketTranslationMessage({ source: MARKET_MESSAGE_SOURCE, type: 'request' })).toBe(
      true,
    );
    expect(isMarketTranslationMessage({ source: MARKET_MESSAGE_SOURCE, type: 'disabled' })).toBe(
      true,
    );
    expect(
      isMarketTranslationMessage({ source: MARKET_MESSAGE_SOURCE, type: 'payload', payload }),
    ).toBe(true);
  });

  it('拒絕缺來源、未知類型或 payload 形狀錯誤的訊息', () => {
    expect(isMarketTranslationMessage({ type: 'request' })).toBe(false);
    expect(isMarketTranslationMessage({ source: MARKET_MESSAGE_SOURCE, type: 'other' })).toBe(
      false,
    );
    expect(
      isMarketTranslationMessage({
        source: MARKET_MESSAGE_SOURCE,
        type: 'payload',
        payload: { locale: 'ja', ui: {} },
      }),
    ).toBe(false);
    expect(
      isMarketTranslationMessage({
        source: MARKET_MESSAGE_SOURCE,
        type: 'payload',
        payload: { locale: 'zh-TW', ui: { a: 1 } },
      }),
    ).toBe(false);
    expect(isMarketTranslationMessage(null)).toBe(false);
  });
});

describe('isTradeDataRequest', () => {
  const base = 'https://www.pathofexile.com/trade2/search/poe2';

  it('辨識四份 data API（字串、URL 與 Request）', () => {
    expect(isTradeDataRequest('/api/trade2/data/items', base)).toBe(true);
    expect(isTradeDataRequest('https://www.pathofexile.com/api/trade/data/stats', base)).toBe(true);
    expect(isTradeDataRequest(new URL('/api/trade/data/static', base), base)).toBe(true);
    expect(isTradeDataRequest(new Request(new URL('/api/trade2/data/filters', base)), base)).toBe(
      true,
    );
  });

  it('其他請求放行', () => {
    expect(isTradeDataRequest('/api/trade2/search/poe2', base)).toBe(false);
    expect(isTradeDataRequest('/api/trade2/fetch/abc', base)).toBe(false);
    expect(isTradeDataRequest('/api/trade/data/leagues', base)).toBe(false);
    expect(isTradeDataRequest('https://evil.example/api/trade/data/items', base)).toBe(false);
  });
});

describe('createPayloadGate', () => {
  it('收到 payload 後 wait 立即回傳', async () => {
    const gate = createPayloadGate(1500);
    gate.settle(payload);
    await expect(gate.wait()).resolves.toEqual(payload);
  });

  it('收到停用訊息時回傳 null', async () => {
    const gate = createPayloadGate(1500);
    gate.settle(null);
    await expect(gate.wait()).resolves.toBeNull();
  });

  it('逾時後回傳 null，之後才到的 payload 不影響已放行的等待', async () => {
    vi.useFakeTimers();
    const gate = createPayloadGate(1500);
    const waiting = gate.wait();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(waiting).resolves.toBeNull();
    gate.settle(payload);
    await expect(gate.wait()).resolves.toEqual(payload);
  });

  it('只採用第一次 settle', async () => {
    const gate = createPayloadGate(1500);
    gate.settle(null);
    gate.settle(payload);
    await expect(gate.wait()).resolves.toBeNull();
  });
});

describe('wrapFetchWithGate', () => {
  it('data API 等到 gate 結束才送出，其他請求立即送出', async () => {
    const calls: string[] = [];
    const fakeWindow = {
      location: { href: 'https://www.pathofexile.com/trade/search/Standard' },
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response('{}');
      }),
    } as unknown as Window;
    const gate = createPayloadGate(1500);
    wrapFetchWithGate(fakeWindow, gate);

    const data = fakeWindow.fetch('/api/trade/data/items');
    const search = fakeWindow.fetch('/api/trade/search/Standard');
    await search;
    expect(calls).toEqual(['/api/trade/search/Standard']);

    gate.settle(null);
    await data;
    expect(calls).toEqual(['/api/trade/search/Standard', '/api/trade/data/items']);
  });

  it('保留原 fetch 的 this 與參數', async () => {
    const original = vi.fn(async function (this: unknown) {
      return new Response(String(this === fakeWindow));
    });
    const fakeWindow = {
      location: { href: 'https://www.pathofexile.com/trade' },
      fetch: original,
    } as unknown as Window;
    wrapFetchWithGate(fakeWindow, createPayloadGate(10));
    const init = { cache: 'reload' as RequestCache };
    await fakeWindow.fetch('/api/trade/search/x', init);
    expect(original).toHaveBeenCalledWith('/api/trade/search/x', init);
  });
});

describe('applyUiDictionary', () => {
  it('沒有 __ 時建立全域字典', () => {
    expect(applyUiDictionary(window, payload.ui)).toBe(2);
    expect((window as any).__['Search Listed Items']).toBe('搜尋道具');
  });

  it('已有 __ 時只補入缺的鍵，不覆寫既有翻譯', () => {
    (window as any).__ = { 'Search Listed Items': '別人的翻譯' };
    expect(applyUiDictionary(window, payload.ui)).toBe(1);
    expect((window as any).__).toEqual({
      'Search Listed Items': '別人的翻譯',
      'Bulk Item Exchange': '以物易物',
    });
  });
});

describe('forceRerenderVueApps', () => {
  it('對已掛載的 Vue 3 app 逐一呼叫 $forceUpdate', () => {
    const childUpdate = vi.fn();
    const rootUpdate = vi.fn();
    const child = { proxy: { $forceUpdate: childUpdate }, subTree: { children: null } };
    const root = {
      proxy: { $forceUpdate: rootUpdate },
      subTree: { children: [{ component: child }, 'text', { children: [{ component: child }] }] },
    };
    const host = document.createElement('div');
    host.setAttribute('data-v-app', '');
    (host as any).__vue_app__ = { _instance: root };
    document.body.appendChild(host);

    expect(forceRerenderVueApps(document)).toBe(true);
    expect(rootUpdate).toHaveBeenCalledTimes(1);
    expect(childUpdate).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('尚未掛載時回傳 false', () => {
    expect(forceRerenderVueApps(document)).toBe(false);
  });
});

describe('startMarketTranslationPage', () => {
  const post = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: window }));

  it('啟動時請求 payload，收到後套用 __ 並放行 data API', async () => {
    const original = vi.fn(async () => new Response('{}'));
    (window as any).fetch = original;
    const posted: unknown[] = [];
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data);
    });

    const stop = startMarketTranslationPage(window, { timeoutMs: 1500 });
    expect(posted).toContainEqual({ source: MARKET_MESSAGE_SOURCE, type: 'request' });

    const pending = window.fetch('/api/trade/data/stats');
    expect(original).not.toHaveBeenCalled();
    post({ source: MARKET_MESSAGE_SOURCE, type: 'payload', payload });
    await pending;
    expect(original).toHaveBeenCalledTimes(1);
    expect((window as any).__['Bulk Item Exchange']).toBe('以物易物');

    stop();
    postSpy.mockRestore();
  });

  it('忽略不是來自本視窗的訊息', async () => {
    (window as any).fetch = vi.fn(async () => new Response('{}'));
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const stop = startMarketTranslationPage(window, { timeoutMs: 1500 });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: MARKET_MESSAGE_SOURCE, type: 'payload', payload },
        source: null,
      }),
    );
    expect((window as any).__).toBeUndefined();
    stop();
    postSpy.mockRestore();
  });
});
