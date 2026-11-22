// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUiDictionary,
  createPayloadGate,
  forceRerenderVueApps,
  isTradeDataRequest,
  localizeResultsAppDom,
  localizeTradeStoreUi,
  startMarketTranslationPage,
  translateResultsHeadingText,
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
  bilingual: true,
};

const STATS_BODY = {
  result: [
    {
      id: 'explicit',
      label: 'Explicit',
      entries: [{ id: 'explicit.stat_1', text: '#% increased Spirit', type: 'explicit' }],
    },
  ],
};

const dataPayload: MarketTranslationPayload = {
  ...payload,
  data: {
    stats: {
      labels: { explicit: '隨機屬性' },
      stats: { 'explicit.stat_1': '#% 增加精魂' },
      options: {},
    },
  },
};

function windowWithResponse(response: () => Response) {
  return {
    location: { href: 'https://www.pathofexile.com/trade2/search/poe2/Standard' },
    fetch: vi.fn(async () => response()),
  } as unknown as Window;
}

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
      isMarketTranslationMessage({ source: MARKET_MESSAGE_SOURCE, type: 'ui', ui: payload.ui }),
    ).toBe(true);
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
      isMarketTranslationMessage({ source: MARKET_MESSAGE_SOURCE, type: 'ui', ui: { a: 1 } }),
    ).toBe(false);
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
        payload: { locale: 'zh-TW', ui: { a: 1 }, bilingual: true },
      }),
    ).toBe(false);
    expect(
      isMarketTranslationMessage({
        source: MARKET_MESSAGE_SOURCE,
        type: 'payload',
        payload: { locale: 'zh-TW', ui: {} },
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

describe('wrapFetchWithGate：data API 改寫', () => {
  it('payload 帶字典時把回應改寫成中文，保留狀態碼與網址', async () => {
    const win = windowWithResponse(
      () => new Response(JSON.stringify(STATS_BODY), { status: 200, statusText: 'OK' }),
    );
    const gate = createPayloadGate(1500);
    wrapFetchWithGate(win, gate);
    gate.settle(dataPayload);
    const response = await win.fetch('/api/trade2/data/stats');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result[0].label).toBe('隨機屬性');
    expect(body.result[0].entries[0]).toEqual({
      id: 'explicit.stat_1',
      text: '#% 增加精魂 (#% increased Spirit)',
      type: 'explicit',
    });
  });

  it('停用、沒有字典、錯誤狀態或不是 JSON 時回傳原本的回應', async () => {
    const cases: Array<[MarketTranslationPayload | null, () => Response]> = [
      [null, () => new Response(JSON.stringify(STATS_BODY))],
      [payload, () => new Response(JSON.stringify(STATS_BODY))],
      [dataPayload, () => new Response(JSON.stringify(STATS_BODY), { status: 500 })],
      [dataPayload, () => new Response('<html>challenge</html>')],
    ];
    for (const [settled, make] of cases) {
      const original = make();
      const win = windowWithResponse(() => original);
      const gate = createPayloadGate(1500);
      wrapFetchWithGate(win, gate);
      gate.settle(settled);
      await expect(win.fetch('/api/trade2/data/stats')).resolves.toBe(original);
    }
  });

  it('filters 的 knownItem 欄位以 items 展開；items 只送一次請求並與官網共用', async () => {
    const filters = {
      result: [
        {
          id: 'ultimatum_filters',
          filters: [{ id: 'ultimatum_output', option: { knownItem: { uniques: true } } }],
        },
      ],
    };
    const items = {
      result: [
        {
          id: 'weapon',
          entries: [{ name: 'Actum', type: 'Butcher Axe', flags: { unique: true } }],
        },
      ],
    };
    const calls: string[] = [];
    const win = {
      location: { href: 'https://www.pathofexile.com/trade/search/Standard' },
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(JSON.stringify(String(input).endsWith('/items') ? items : filters));
      }),
    } as unknown as Window;
    const gate = createPayloadGate(1500);
    wrapFetchWithGate(win, gate);
    gate.settle({ ...payload, bilingual: false, data: { items: { actum: '阿克頓' } } });

    const [filtersBody, itemsBody] = await Promise.all([
      win.fetch('/api/trade/data/filters').then((response) => response.json()),
      win.fetch('/api/trade/data/items').then((response) => response.json()),
    ]);
    expect(filtersBody.result[0].filters[0].option.options).toEqual([
      { id: null, text: 'Any' },
      { id: 'Actum', text: '阿克頓' },
    ]);
    expect(itemsBody.result[0].entries[0].name).toBe('Actum');
    expect(calls.filter((call) => call.endsWith('/items'))).toHaveLength(1);
  });

  it('其他請求不改寫', async () => {
    const original = new Response(JSON.stringify(STATS_BODY));
    const win = windowWithResponse(() => original);
    const gate = createPayloadGate(1500);
    wrapFetchWithGate(win, gate);
    gate.settle(dataPayload);
    await expect(win.fetch('/api/trade2/search/poe2/Standard')).resolves.toBe(original);
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

  it('Vue 3 正式版 __vue_app__._instance 為 null 時改從 _vnode.component 取得根元件', () => {
    const rootUpdate = vi.fn();
    const root = { proxy: { $forceUpdate: rootUpdate }, subTree: { children: null } };
    const host = document.createElement('div');
    host.setAttribute('data-v-app', '');
    (host as any)._vnode = { component: root };
    (host as any).__vue_app__ = { _instance: null, _container: host };
    document.body.appendChild(host);

    expect(forceRerenderVueApps(document)).toBe(true);
    expect(rootUpdate).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('尚未掛載時回傳 false', () => {
    expect(forceRerenderVueApps(document)).toBe(false);
  });
});

describe('localizeTradeStoreUi', () => {
  it('原地回填 Trade 根元件 proxy.static_ 中已求值的英文靜態選項，保留物件參考且冪等', () => {
    const defaultLayout = { text: 'Controls at Bottom (Default)', value: null };
    const state = {
      account: {
        status: [{ id: 'league', text: 'Show my Status (Default)' }],
        languages: [{ id: '', text: 'Last Client Language (Default)' }],
        statusRetrieving: 'Fetching...',
      },
      exchangeStatus: [{ id: 'online', text: 'Online Only' }],
      searchBarLayouts: [defaultLayout],
      socketVariants: [{ text: 'Default', value: 1 }],
      notifications: [{ file: 'audio/trade/pulse.mp3', name: 'Pulse' }],
      notificationVolumes: [
        { text: 'Muted', value: 0 },
        { text: '10%', value: 10 },
      ],
      statGroups: [{ type: 'and', title: 'And', tip: 'Match all' }],
    };
    const host = document.createElement('div');
    host.setAttribute('data-v-app', '');
    (host as any)._vnode = { component: { proxy: { static_: state } } };
    document.body.appendChild(host);

    const strings = {
      'Show my Status (Default)': '顯示我的上線狀態（預設）',
      'Last Client Language (Default)': '上次登入語言（預設）',
      'Fetching...': '讀取中...',
      'Online Only': '只顯示線上',
      'Controls at Bottom (Default)': '底部控制 (預設)',
      Default: '預設',
      Pulse: '脈搏',
      Muted: '靜音',
      And: '且',
      'Match all': '符合全部',
    };

    expect(localizeTradeStoreUi(document, strings)).toBe(10);
    expect(state.searchBarLayouts[0]).toBe(defaultLayout);
    expect(defaultLayout.text).toBe('底部控制 (預設)');
    expect(state.socketVariants[0].text).toBe('預設');
    expect(state.notifications[0].name).toBe('脈搏');
    expect(state.notificationVolumes[0].text).toBe('靜音');
    expect(state.notificationVolumes[1].text).toBe('10%');
    expect(state.account.status[0].text).toBe('顯示我的上線狀態（預設）');
    expect(state.account.languages[0].text).toBe('上次登入語言（預設）');
    expect(state.account.statusRetrieving).toBe('讀取中...');
    expect(state.exchangeStatus[0].text).toBe('只顯示線上');
    expect(state.statGroups[0]).toEqual({ type: 'and', title: '且', tip: '符合全部' });

    // 第二次執行為冪等，不再重複修改
    expect(localizeTradeStoreUi(document, strings)).toBe(0);
    host.remove();
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

  it('payload 經 MessageChannel 送達時套用 __ 並放行 data API', async () => {
    const original = vi.fn(async () => new Response('{}'));
    (window as any).fetch = original;
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const stop = startMarketTranslationPage(window, { timeoutMs: 1500 });

    const pending = window.fetch('/api/trade/data/stats');
    const port = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
    const notice = new MessageEvent('message', {
      data: { source: MARKET_MESSAGE_SOURCE, type: 'payload-port' },
      source: window,
    });
    Object.defineProperty(notice, 'ports', { value: [port] });
    window.dispatchEvent(notice);
    expect(port.onmessage).toBeTypeOf('function');
    port.onmessage!({ data: { source: MARKET_MESSAGE_SOURCE, type: 'payload', payload } });

    await pending;
    expect(original).toHaveBeenCalledTimes(1);
    expect((window as any).__['Bulk Item Exchange']).toBe('以物易物');
    expect(port.close).toHaveBeenCalled();
    stop();
    postSpy.mockRestore();
  });

  it('收到輕量 ui 訊息時立刻寫入 __ 與回填 store，但不提前放行 data API', async () => {
    const original = vi.fn(async () => new Response('{}'));
    (window as any).fetch = original;
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const state = { searchBarLayouts: [{ text: 'Controls at Bottom (Default)', value: null }] };
    const host = document.createElement('div');
    host.setAttribute('data-v-app', '');
    (host as any)._vnode = { component: { proxy: { static_: state } } };
    document.body.appendChild(host);

    const stop = startMarketTranslationPage(window, { timeoutMs: 1500 });
    const pending = window.fetch('/api/trade/data/stats');

    post({
      source: MARKET_MESSAGE_SOURCE,
      type: 'ui',
      ui: {
        ...payload.ui,
        'Controls at Bottom (Default)': '底部控制 (預設)',
      },
    });
    expect((window as any).__['Search Listed Items']).toBe('搜尋道具');
    expect(state.searchBarLayouts[0].text).toBe('底部控制 (預設)');
    expect(original).not.toHaveBeenCalled();

    post({ source: MARKET_MESSAGE_SOURCE, type: 'payload', payload });
    await pending;
    expect(original).toHaveBeenCalledTimes(1);

    host.remove();
    stop();
    postSpy.mockRestore();
  });

  it('官網 #trade 在 payload 送達後才非同步掛載時，於 data API 回應返回前補齊 proxy.static_', async () => {
    const state = { searchBarLayouts: [{ text: 'Controls at Bottom (Default)', value: null }] };
    const host = document.createElement('div');
    host.setAttribute('data-v-app', '');
    const original = vi.fn(async () => {
      // 模擬官網非同步掛載：在 data API 請求期間 #trade 才掛上 _vnode.component.proxy.static_
      (host as any)._vnode = { component: { proxy: { static_: state } } };
      document.body.appendChild(host);
      return new Response('{}');
    });
    (window as any).fetch = original;
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    const stop = startMarketTranslationPage(window, { timeoutMs: 1500 });
    post({
      source: MARKET_MESSAGE_SOURCE,
      type: 'payload',
      payload: {
        ...payload,
        ui: { ...payload.ui, 'Controls at Bottom (Default)': '底部控制 (預設)' },
      },
    });
    // 此時 #trade 尚未掛載，仍為英文
    expect(state.searchBarLayouts[0].text).toBe('Controls at Bottom (Default)');

    await window.fetch('/api/trade/data/stats');
    expect(state.searchBarLayouts[0].text).toBe('底部控制 (預設)');

    host.remove();
    stop();
    postSpy.mockRestore();
  });

  it('ui、payload 與 data API 都早於 #trade 掛載時，掛上 data-v-app 後才回填並重繪', async () => {
    (window as any).fetch = vi.fn(async () => new Response('{}'));
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const state = { searchBarLayouts: [{ text: 'Controls at Bottom (Default)', value: null }] };
    const rootUpdate = vi.fn();
    const host = document.createElement('div');
    host.id = 'trade';
    document.body.appendChild(host);

    const stop = startMarketTranslationPage(window, { timeoutMs: 1500 });
    const ui = { ...payload.ui, 'Controls at Bottom (Default)': '底部控制 (預設)' };
    post({ source: MARKET_MESSAGE_SOURCE, type: 'ui', ui });
    post({ source: MARKET_MESSAGE_SOURCE, type: 'payload', payload: { ...payload, ui } });
    await window.fetch('/api/trade/data/static');
    expect(state.searchBarLayouts[0].text).toBe('Controls at Bottom (Default)');

    // 模擬 Vue 3 掛載完成：先接上根元件，再於容器設 data-v-app
    (host as any)._vnode = {
      component: { proxy: { static_: state, $forceUpdate: rootUpdate }, subTree: null },
    };
    host.setAttribute('data-v-app', '');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.searchBarLayouts[0].text).toBe('底部控制 (預設)');
    expect(rootUpdate).toHaveBeenCalled();

    host.remove();
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

describe('translateResultsHeadingText & localizeResultsAppDom', () => {
  const twStrings: Record<string, string> = {
    'No results found': '查無結果',
    'Showing 1 result': '顯示 1 筆結果',
    'Showing {i} results': '顯示 {i} 筆結果',
    '{i} matched': '{i} 筆符合',
    max: '最大',
    Default: '預設',
    'Load More': '讀取更多',
    'Item not found': '無發現道具',
  };

  it('將官網 #app 結果區所有筆數標題格式依 trade-ui.json 轉換', () => {
    expect(translateResultsHeadingText('No results found', twStrings)).toBe('查無結果');
    expect(translateResultsHeadingText('Showing 1 result', twStrings)).toBe('顯示 1 筆結果');
    expect(translateResultsHeadingText('Showing 13 results', twStrings)).toBe('顯示 13 筆結果');
    expect(translateResultsHeadingText('Showing 10 results (250 matched)', twStrings)).toBe(
      '顯示 10 筆結果 (250 筆符合)',
    );
    expect(translateResultsHeadingText('Showing 100 results (10000+ matched)', twStrings)).toBe(
      '顯示 100 筆結果 (10000+ 筆符合)',
    );
    expect(translateResultsHeadingText('Showing 50 results (max)', twStrings)).toBe(
      '顯示 50 筆結果 (最大)',
    );
    // 已經中文化或未知文字保持不變
    expect(translateResultsHeadingText('顯示 13 筆結果', twStrings)).toBe('顯示 13 筆結果');
    expect(translateResultsHeadingText('Showing 13 results', {})).toBe('Showing 13 results');
  });

  it('localizeResultsAppDom 會原地轉換標題、版型按鈕 title、讀取更多與找不到物品', () => {
    const results = document.createElement('div');
    results.className = 'results';
    const rowTotal = document.createElement('div');
    rowTotal.className = 'row row-total';
    const h3 = document.createElement('h3');
    h3.textContent = 'Showing 13 results';
    const btnDefault = document.createElement('button');
    btnDefault.setAttribute('title', 'Default');
    const btnCompact = document.createElement('button');
    btnCompact.setAttribute('title', 'Compact');
    rowTotal.append(h3, btnDefault, btnCompact);

    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'btn load-more-btn';
    const loadMoreSpan = document.createElement('span');
    loadMoreSpan.textContent = 'Load More';
    loadMoreBtn.appendChild(loadMoreSpan);

    const errRow = document.createElement('div');
    errRow.className = 'row error';
    const errH3 = document.createElement('h3');
    errH3.textContent = 'Item not found';
    errRow.appendChild(errH3);

    results.append(rowTotal, loadMoreBtn, errRow);
    document.body.appendChild(results);

    expect(localizeResultsAppDom(document, twStrings)).toBe(4);
    expect(h3.textContent).toBe('顯示 13 筆結果');
    expect(btnDefault.getAttribute('title')).toBe('預設');
    // 字典缺鍵時保留原文（ADR-0012）
    expect(btnCompact.getAttribute('title')).toBe('Compact');
    expect(loadMoreSpan.textContent).toBe('讀取更多');
    expect(errH3.textContent).toBe('無發現道具');
    // 再次呼叫為 no-op
    expect(localizeResultsAppDom(document, twStrings)).toBe(0);

    results.remove();
  });

  it('startMarketTranslationPage 在 #app 結果標題動態更新後會自動重新中文化', async () => {
    (window as any).fetch = vi.fn(async () => new Response('{}'));
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const results = document.createElement('div');
    results.className = 'results';
    const rowTotal = document.createElement('div');
    rowTotal.className = 'row row-total';
    const h3 = document.createElement('h3');
    h3.textContent = 'Showing 1 result';
    rowTotal.appendChild(h3);
    results.appendChild(rowTotal);
    document.body.appendChild(results);

    const stop = startMarketTranslationPage(window, { timeoutMs: 1500 });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: MARKET_MESSAGE_SOURCE, type: 'ui', ui: twStrings },
        source: window,
      }),
    );
    expect(h3.textContent).toBe('顯示 1 筆結果');

    // 模擬 Vue 3 更新文字節點
    h3.textContent = 'Showing 2 results';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h3.textContent).toBe('顯示 2 筆結果');

    results.remove();
    stop();
    postSpy.mockRestore();
  });
});
