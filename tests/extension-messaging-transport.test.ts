import { describe, expect, it, vi } from 'vitest';
import {
  broadcastSearchRecordChange,
  createChromeSearchRecordClient,
  createSearchRecordChangeHub,
  registerSearchRecordBackgroundHandlers,
} from '@/utils/search-record-messaging';
import {
  broadcastBookmarkChange,
  createBookmarkChangeHub,
  createBookmarkClient,
  createChromeBookmarkClient,
  registerBookmarkBackgroundHandlers,
} from '@/utils/bookmark-messaging';
import type {
  BookmarkChange,
  BookmarkCommand,
  BookmarkRead,
  BookmarkReadOutcome,
} from '@/utils/bookmark-coordinator';
import { createBookmarkModel } from '@/components/sidebar/bookmark-model';
import type {
  SearchRecordChange,
  SearchRecordCommand,
  SearchRecordOutcome,
  SearchRecordRead,
  SearchRecordReadOutcome,
} from '@/utils/search-records';
import { registerEconomyBackgroundHandlers, type EconomyRateService } from '@/utils/economy';
import { fetchCurrencyRates } from '@/entrypoints/content/logic/result-price-presenter';
import fs from 'node:fs';
import path from 'node:path';

function createFakeMessenger() {
  const handlers = new Map<string, (message: { data: any; sender?: any }) => any>();
  const tabDeliveries: Array<{ tabId: number; type: string; data: any }> = [];

  return {
    handlers,
    tabDeliveries,
    onMessage: vi.fn((type: string, handler: (message: { data: any; sender?: any }) => any) => {
      if (handlers.has(type)) {
        throw new Error(`Duplicate listener registered for ${type} in same JS context`);
      }
      handlers.set(type, handler);
      return () => {
        handlers.delete(type);
      };
    }),
    sendMessage: vi.fn(async (type: string, data: any, tabId?: number) => {
      if (tabId !== undefined) {
        tabDeliveries.push({ tabId, type, data });
        const handler = handlers.get(type);
        if (handler) return handler({ data });
        return;
      }
      const handler = handlers.get(type);
      if (!handler) {
        throw new Error(`No handler registered for ${type}`);
      }
      return handler({ data });
    }),
    sendWithSender: async (type: string, data: any, sender: any) => {
      const handler = handlers.get(type);
      if (!handler) {
        throw new Error(`No handler registered for ${type}`);
      }
      return handler({ data, sender });
    },
  };
}

describe('Extension messaging transport wiring', () => {
  it('searchRecord:execute routes through typed messenger to background handler after readiness OK', async () => {
    const messenger = createFakeMessenger();
    const fakeModule = {
      execute: vi.fn(async (_cmd: SearchRecordCommand): Promise<SearchRecordOutcome> => ({
        ok: true,
        changed: true,
      })),
      read: vi.fn(),
    };
    const readyOutcome: SearchRecordOutcome = { ok: true, changed: false };

    registerSearchRecordBackgroundHandlers({
      messenger: messenger as any,
      getModule: () => fakeModule as any,
      getReady: () => Promise.resolve(readyOutcome),
    });

    const client = createChromeSearchRecordClient(messenger as any);
    const result = await client.execute({
      type: 'clear-history',
      gameVersion: 'poe1',
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(fakeModule.execute).toHaveBeenCalledWith({
      type: 'clear-history',
      gameVersion: 'poe1',
    });
    expect(messenger.sendMessage).toHaveBeenCalledWith('searchRecord:execute', {
      type: 'clear-history',
      gameVersion: 'poe1',
    });
  });

  it('searchRecord:read routes through typed messenger and respects readiness gate', async () => {
    const messenger = createFakeMessenger();
    let readyResolved = false;
    const readyPromise = new Promise<SearchRecordOutcome>((resolve) => {
      setTimeout(() => {
        readyResolved = true;
        resolve({ ok: true, changed: false });
      }, 10);
    });

    const fakeModule = {
      execute: vi.fn(),
      read: vi.fn(async (_read: SearchRecordRead): Promise<SearchRecordReadOutcome> => {
        expect(readyResolved).toBe(true);
        return { ok: true, value: [] };
      }),
    };

    registerSearchRecordBackgroundHandlers({
      messenger: messenger as any,
      getModule: () => fakeModule as any,
      getReady: () => readyPromise,
    });

    const client = createChromeSearchRecordClient(messenger as any);
    const result = await client.read({ type: 'get-history-view', gameVersion: 'poe1' });

    expect(result).toEqual({ ok: true, value: [] });
    expect(fakeModule.read).toHaveBeenCalledWith({ type: 'get-history-view', gameVersion: 'poe1' });
  });

  it('does not execute domain operations on readiness failure and returns unavailable outcome', async () => {
    const messenger = createFakeMessenger();
    const fakeModule = {
      execute: vi.fn(),
      read: vi.fn(),
    };
    const failureOutcome: SearchRecordOutcome = {
      ok: false,
      error: { code: 'unavailable', message: 'Storage initialization failed' },
    };

    registerSearchRecordBackgroundHandlers({
      messenger: messenger as any,
      getModule: () => fakeModule as any,
      getReady: () => Promise.resolve(failureOutcome),
    });

    const client = createChromeSearchRecordClient(messenger as any);

    const execResult = await client.execute({ type: 'clear-history', gameVersion: 'poe1' });
    expect(execResult).toEqual(failureOutcome);
    expect(fakeModule.execute).not.toHaveBeenCalled();

    const readResult = await client.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(readResult).toEqual(failureOutcome);
    expect(fakeModule.read).not.toHaveBeenCalled();
  });

  it('searchRecord:change delivers to subscriber and unsubscribe unhooks listener', async () => {
    const messenger = createFakeMessenger();
    const client = createChromeSearchRecordClient(messenger as any);
    const received: SearchRecordChange[] = [];

    const unsubscribe = client.subscribe((change) => {
      received.push(change);
    });

    const changeMessage = {
      command: { type: 'clear-history', gameVersion: 'poe1' } as const,
    };

    await messenger.sendMessage('searchRecord:change', changeMessage, 42);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(changeMessage);

    unsubscribe();

    await messenger.sendMessage('searchRecord:change', changeMessage, 42);
    expect(received).toHaveLength(1);
  });

  it('fan-out delivers change across all trade tabs and single tab failure does not abort others', async () => {
    const attemptedTabs: number[] = [];
    const broadcastTransport = {
      async listTradeTabIds() {
        return [101, 202, 303];
      },
      async sendChangeToTab(tabId: number, _change: SearchRecordChange) {
        attemptedTabs.push(tabId);
        if (tabId === 202) {
          throw new Error('Tab connection lost');
        }
      },
    };

    const change: SearchRecordChange = {
      command: { type: 'clear-history', gameVersion: 'poe1' },
    };

    await expect(broadcastSearchRecordChange(change, broadcastTransport)).resolves.toBeUndefined();

    expect(attemptedTabs).toEqual([101, 202, 303]);
  });

  it('same JS context multiple consumers: ref-counted change hub registers once and fans out to all local subscribers', async () => {
    const messenger = createFakeMessenger();
    const hub = createSearchRecordChangeHub(messenger as any);
    const clientA = createChromeSearchRecordClient(messenger as any, hub);
    const clientB = createChromeSearchRecordClient(messenger as any, hub);

    const receivedA: SearchRecordChange[] = [];
    const receivedB: SearchRecordChange[] = [];

    expect(hub.subscriberCount).toBe(0);
    expect(messenger.onMessage).not.toHaveBeenCalled();

    // subscriber A 故意拋錯，驗證不中斷其他 subscriber 且不造成 transport delivery failure
    const unsubA = clientA.subscribe((c) => {
      receivedA.push(c);
      throw new Error('Consumer UI render error');
    });
    expect(hub.subscriberCount).toBe(1);
    expect(messenger.onMessage).toHaveBeenCalledTimes(1);

    // 第二個 subscriber 加入，絕不重複向底層 messenger 呼叫 onMessage
    const unsubB = clientB.subscribe((c) => receivedB.push(c));
    expect(hub.subscriberCount).toBe(2);
    expect(messenger.onMessage).toHaveBeenCalledTimes(1);

    const change1: SearchRecordChange = {
      command: { type: 'clear-history', gameVersion: 'poe1' },
    };
    // 即使 subscriber A throw，sendMessage 依然 resolve 且 subscriber B 依然收到
    await expect(messenger.sendMessage('searchRecord:change', change1, 1)).resolves.toBeUndefined();

    expect(receivedA).toEqual([change1]);
    expect(receivedB).toEqual([change1]);

    // unsubscribe A，B 仍繼續接收
    unsubA();
    expect(hub.subscriberCount).toBe(1);

    const change2: SearchRecordChange = {
      command: { type: 'set-history-enabled', gameVersion: 'poe1', enabled: false },
    };
    await messenger.sendMessage('searchRecord:change', change2, 1);

    expect(receivedA).toEqual([change1]); // A 不再收到
    expect(receivedB).toEqual([change1, change2]); // B 仍收到

    // unsubscribe B，最後一個移除後底層 listener 正確卸載
    unsubB();
    expect(hub.subscriberCount).toBe(0);
    expect(messenger.handlers.has('searchRecord:change')).toBe(false);
  });

  it('bookmark:execute routes through typed messenger to background handler after readiness OK', async () => {
    const messenger = createFakeMessenger();
    const fakeCoordinator = {
      execute: vi.fn(async (_cmd: BookmarkCommand): Promise<SearchRecordOutcome> => ({
        ok: true,
        changed: true,
      })),
      read: vi.fn(),
    };
    const readyOutcome: SearchRecordOutcome = { ok: true, changed: false };

    registerBookmarkBackgroundHandlers({
      messenger: messenger as any,
      getCoordinator: () => fakeCoordinator as any,
      getReady: () => Promise.resolve(readyOutcome),
    });

    const client = createChromeBookmarkClient('poe1', { messenger: messenger as any });
    const result = await client.deleteBookmark('bm-1');

    expect(result).toEqual({ ok: true, changed: true });
    expect(fakeCoordinator.execute).toHaveBeenCalledWith({
      type: 'delete-bookmark',
      gameVersion: 'poe1',
      bookmarkId: 'bm-1',
    });
    expect(messenger.sendMessage).toHaveBeenCalledWith('bookmark:execute', {
      type: 'delete-bookmark',
      gameVersion: 'poe1',
      bookmarkId: 'bm-1',
    });
  });

  it('bookmark:read routes through typed messenger and respects readiness gate', async () => {
    const messenger = createFakeMessenger();
    let readyResolved = false;
    const readyPromise = new Promise<SearchRecordOutcome>((resolve) => {
      setTimeout(() => {
        readyResolved = true;
        resolve({ ok: true, changed: false });
      }, 10);
    });

    const fakeCoordinator = {
      execute: vi.fn(),
      read: vi.fn(async (_read: BookmarkRead): Promise<BookmarkReadOutcome> => {
        expect(readyResolved).toBe(true);
        return { ok: true, value: { groups: [], bookmarks: [] } };
      }),
    };

    registerBookmarkBackgroundHandlers({
      messenger: messenger as any,
      getCoordinator: () => fakeCoordinator as any,
      getReady: () => readyPromise,
    });

    const client = createChromeBookmarkClient('poe1', { messenger: messenger as any });
    const result = await client.readCollection();

    expect(result).toEqual({ ok: true, value: { groups: [], bookmarks: [] } });
    expect(fakeCoordinator.read).toHaveBeenCalledWith({
      type: 'get-collection',
      gameVersion: 'poe1',
    });
  });

  it('does not execute bookmark coordinator on readiness failure and returns unavailable outcome', async () => {
    const messenger = createFakeMessenger();
    const fakeCoordinator = {
      execute: vi.fn(),
      read: vi.fn(),
    };
    const readyOutcome: SearchRecordOutcome = {
      ok: false,
      error: { code: 'unavailable', message: 'Storage initialization error' },
    };

    registerBookmarkBackgroundHandlers({
      messenger: messenger as any,
      getCoordinator: () => fakeCoordinator as any,
      getReady: () => Promise.resolve(readyOutcome),
    });

    const client = createChromeBookmarkClient('poe1', { messenger: messenger as any });
    const result = await client.readCollection();

    expect(result).toEqual(readyOutcome);
    expect(fakeCoordinator.read).not.toHaveBeenCalled();
    expect(fakeCoordinator.execute).not.toHaveBeenCalled();
  });

  it('retains 100ms retry for bookmark:read on throw and retries once', async () => {
    vi.useFakeTimers();
    try {
      const messenger = createFakeMessenger();
      let callCount = 0;
      messenger.sendMessage.mockImplementation(async (type: string, _data: any) => {
        if (type === 'bookmark:read') {
          callCount++;
          if (callCount === 1) {
            throw new Error('Transient transport disconnect');
          }
          return { ok: true, value: { groups: [], bookmarks: [] } };
        }
      });

      const client = createChromeBookmarkClient('poe1', { messenger: messenger as any });
      const readPromise = client.readCollection();

      expect(callCount).toBe(1);

      await vi.advanceTimersByTimeAsync(50);
      expect(callCount).toBe(1);

      await vi.advanceTimersByTimeAsync(50);
      const result = await readPromise;

      expect(callCount).toBe(2);
      expect(result).toEqual({ ok: true, value: { groups: [], bookmarks: [] } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains 100ms retry for bookmark:read on undefined and retries once', async () => {
    vi.useFakeTimers();
    try {
      const messenger = createFakeMessenger();
      let callCount = 0;
      messenger.sendMessage.mockImplementation(async (type: string, _data: any) => {
        if (type === 'bookmark:read') {
          callCount++;
          if (callCount === 1) {
            return undefined;
          }
          return { ok: true, value: { groups: [], bookmarks: [] } };
        }
      });

      const client = createChromeBookmarkClient('poe1', { messenger: messenger as any });
      const readPromise = client.readCollection();

      expect(callCount).toBe(1);
      await vi.advanceTimersByTimeAsync(100);
      const result = await readPromise;

      expect(callCount).toBe(2);
      expect(result).toEqual({ ok: true, value: { groups: [], bookmarks: [] } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bookmark:read maps second failure to unavailable outcome after single retry', async () => {
    vi.useFakeTimers();
    try {
      const messenger = createFakeMessenger();
      let callCount = 0;
      messenger.sendMessage.mockImplementation(async (type: string, _data: any) => {
        if (type === 'bookmark:read') {
          callCount++;
          throw new Error('Persistent failure');
        }
      });

      const client = createChromeBookmarkClient('poe1', { messenger: messenger as any });
      const readPromise = client.readCollection();

      await vi.advanceTimersByTimeAsync(100);
      const result = await readPromise;

      expect(callCount).toBe(2);
      expect(result).toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'Persistent failure' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT retry bookmark:execute on failure', async () => {
    const messenger = createFakeMessenger();
    let callCount = 0;
    messenger.sendMessage.mockImplementation(async (type: string, _data: any) => {
      if (type === 'bookmark:execute') {
        callCount++;
        throw new Error('Execute failure');
      }
    });

    const client = createChromeBookmarkClient('poe1', { messenger: messenger as any });
    const result = await client.deleteBookmark('bm-1');

    expect(callCount).toBe(1);
    expect(result).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'Execute failure' },
    });
  });

  it('deduplicates bookmark:change listeners across multiple consumers in same JS context and isolates subscriber errors', async () => {
    const messenger = createFakeMessenger();
    const hub = createBookmarkChangeHub(messenger as any);

    const receivedA: BookmarkChange[] = [];
    const receivedB: BookmarkChange[] = [];

    expect(hub.subscriberCount).toBe(0);
    expect(messenger.onMessage).not.toHaveBeenCalled();

    // subscriber A 故意拋錯，驗證不中斷其他 subscriber 且不造成 transport failure
    const unsubA = hub.subscribe((c) => {
      receivedA.push(c);
      throw new Error('Consumer UI render error');
    });
    expect(hub.subscriberCount).toBe(1);
    expect(messenger.onMessage).toHaveBeenCalledTimes(1);

    // 第二個 subscriber 註冊，複用同一個底層 listener
    const unsubB = hub.subscribe((c) => receivedB.push(c));
    expect(hub.subscriberCount).toBe(2);
    expect(messenger.onMessage).toHaveBeenCalledTimes(1);

    const change1: BookmarkChange = {
      command: { type: 'delete-bookmark', gameVersion: 'poe1', bookmarkId: 'bm-1' },
    };
    await expect(messenger.sendMessage('bookmark:change', change1, 1)).resolves.toBeUndefined();

    expect(receivedA).toEqual([change1]);
    expect(receivedB).toEqual([change1]);

    // unsubscribe A，不影響 B
    unsubA();
    expect(hub.subscriberCount).toBe(1);
    expect(messenger.handlers.has('bookmark:change')).toBe(true);

    const change2: BookmarkChange = {
      command: { type: 'delete-bookmark', gameVersion: 'poe1', bookmarkId: 'bm-2' },
    };
    await messenger.sendMessage('bookmark:change', change2, 1);
    expect(receivedA).toEqual([change1]);
    expect(receivedB).toEqual([change1, change2]);

    // unsubscribe B，最後一個移除後底層 listener 正確卸載
    unsubB();
    expect(hub.subscriberCount).toBe(0);
    expect(messenger.handlers.has('bookmark:change')).toBe(false);
  });

  it('BookmarkClient invalidation listens to both typed bookmark:change and typed searchRecord:change, triggering BookmarkModel reconcile', async () => {
    const messenger = createFakeMessenger();
    const searchHub = createSearchRecordChangeHub(messenger as any);
    const bookmarkHub = createBookmarkChangeHub(messenger as any);

    const readCollectionMock = vi.fn(async () => ({
      ok: true as const,
      value: { bookmarks: [], groups: [] },
    }));

    const bookmarkClient = createChromeBookmarkClient('poe1', {
      messenger: messenger as any,
      bookmarkChangeHub: bookmarkHub,
      subscribeSearchRecord: searchHub.subscribe,
    });

    // 替換 readCollection 為可追蹤呼叫次數的 mock
    (bookmarkClient as any).readCollection = readCollectionMock;

    let invalidationCount = 0;
    const unsubInvalidation = bookmarkClient.subscribe(() => {
      invalidationCount++;
    });

    const model = createBookmarkModel(bookmarkClient);
    await model.connect();
    expect(readCollectionMock).toHaveBeenCalledTimes(1);

    // 1. 透過 messenger 派發 typed searchRecord:change
    const searchChange: SearchRecordChange = {
      command: { type: 'clear-history', gameVersion: 'poe1' },
    };
    await messenger.sendMessage('searchRecord:change', searchChange, 1);

    expect(invalidationCount).toBe(1);
    expect(readCollectionMock).toHaveBeenCalledTimes(2);

    // 2. 透過 messenger 派發 typed bookmark:change
    const bookmarkChange: BookmarkChange = {
      command: { type: 'delete-bookmark', gameVersion: 'poe1', bookmarkId: 'bm-1' },
    };
    await messenger.sendMessage('bookmark:change', bookmarkChange, 1);

    expect(invalidationCount).toBe(2);
    expect(readCollectionMock).toHaveBeenCalledTimes(3);

    // 3. dispose 清理，底層 listener 均被移除
    unsubInvalidation();
    model.dispose();
    expect(searchHub.subscriberCount).toBe(0);
    expect(bookmarkHub.subscriberCount).toBe(0);
    expect(messenger.handlers.has('searchRecord:change')).toBe(false);
    expect(messenger.handlers.has('bookmark:change')).toBe(false);
  });

  it('broadcastBookmarkChange delivers to all trade tabs with Promise.allSettled isolation', async () => {
    const sentTabs: number[] = [];
    const broadcastTransport = {
      listTradeTabIds: vi.fn(async () => [101, 102, 103]),
      sendChangeToTab: vi.fn(async (tabId: number, _change: BookmarkChange) => {
        sentTabs.push(tabId);
        if (tabId === 102) {
          throw new Error('Tab 102 closed or unresponsive');
        }
      }),
    };

    const change: BookmarkChange = {
      command: { type: 'delete-bookmark', gameVersion: 'poe1', bookmarkId: 'bm-1' },
    };

    await expect(broadcastBookmarkChange(change, broadcastTransport)).resolves.toBeUndefined();
    expect(broadcastTransport.listTradeTabIds).toHaveBeenCalledTimes(1);
    expect(broadcastTransport.sendChangeToTab).toHaveBeenCalledTimes(3);
    expect(sentTabs).toEqual([101, 102, 103]);
  });

  it('economy:fetchCurrencyRates routes client request to background EconomyRateService', async () => {
    const messenger = createFakeMessenger();
    const service: EconomyRateService = {
      fetch: vi.fn(async ({ version, league }) => ({
        success: true as const,
        data: { primary: 'chaos' as const, rates: { chaos: 1, divine: 210 } },
      })),
      getMetadata: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };

    registerEconomyBackgroundHandlers({
      messenger: messenger as any,
      service,
    });

    const result = await messenger.sendMessage('economy:fetchCurrencyRates', {
      version: 'poe1',
      league: 'Standard',
    });

    expect(result).toEqual({
      success: true,
      data: { primary: 'chaos', rates: { chaos: 1, divine: 210 } },
    });
    expect(service.fetch).toHaveBeenCalledWith({
      version: 'poe1',
      league: 'Standard',
    });
  });

  it('economy:fetchCurrencyRates handles service failure cleanly', async () => {
    const messenger = createFakeMessenger();
    const service: EconomyRateService = {
      fetch: vi.fn(async () => ({
        success: false as const,
        error: 'Network failure',
      })),
      getMetadata: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };

    registerEconomyBackgroundHandlers({
      messenger: messenger as any,
      service,
    });

    const failureResult = await messenger.sendMessage('economy:fetchCurrencyRates', {
      version: 'poe1',
      league: 'Standard',
    });
    expect(failureResult).toEqual({ success: false, error: 'Network failure' });
  });

  it('economy:fetchCurrencyRates rejects invalid runtime version at transport boundary without calling service', async () => {
    const messenger = createFakeMessenger();
    const service: EconomyRateService = {
      fetch: vi.fn(),
      getMetadata: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };

    registerEconomyBackgroundHandlers({
      messenger: messenger as any,
      service,
    });

    const result = await messenger.sendMessage('economy:fetchCurrencyRates', {
      version: 'invalid-version' as any,
      league: 'Standard',
    });

    expect(result).toEqual({ success: false, error: '不支援的遊戲版本' });
    expect(service.fetch).not.toHaveBeenCalled();
  });

  it('economy:getRateMetadata routes client request to background EconomyRateService', async () => {
    const messenger = createFakeMessenger();
    const service: EconomyRateService = {
      fetch: vi.fn(),
      getMetadata: vi.fn(async () => ({
        updatedAt: 1700000000000,
        source: 'cache' as const,
        ttl: 3600000,
        hasData: true,
        isExpired: false,
      })),
      subscribe: vi.fn(() => vi.fn()),
    };

    registerEconomyBackgroundHandlers({
      messenger: messenger as any,
      service,
    });

    const result = await messenger.sendMessage('economy:getRateMetadata', {
      version: 'poe1',
      league: 'Standard',
    });

    expect(result).toEqual({
      updatedAt: 1700000000000,
      source: 'cache',
      ttl: 3600000,
      hasData: true,
      isExpired: false,
    });
    expect(service.getMetadata).toHaveBeenCalledWith({
      version: 'poe1',
      league: 'Standard',
    });
  });

  it('registerEconomyBackgroundHandlers wires broadcastTransport and propagates service changes', async () => {
    let changeListener: ((change: any) => void) | undefined;
    const service: EconomyRateService = {
      fetch: vi.fn(),
      getMetadata: vi.fn(),
      subscribe: vi.fn((listener) => {
        changeListener = listener;
        return () => {
          changeListener = undefined;
        };
      }),
    };

    const broadcastTransport = {
      listTradeTabIds: vi.fn(async () => [101, 102]),
      sendChangeToTab: vi.fn(async () => {}),
    };

    const messenger = createFakeMessenger();
    const unregister = registerEconomyBackgroundHandlers({
      messenger: messenger as any,
      service,
      broadcastTransport,
    });

    expect(service.subscribe).toHaveBeenCalledTimes(1);

    const change = {
      version: 'poe1' as const,
      league: 'Standard',
      metadata: {
        updatedAt: 12345678,
        source: 'cache' as const,
        ttl: 3600000,
        hasData: true,
        isExpired: false,
      },
    };

    changeListener!(change);
    await new Promise((r) => setTimeout(r, 0));

    expect(broadcastTransport.listTradeTabIds).toHaveBeenCalledTimes(1);
    expect(broadcastTransport.sendChangeToTab).toHaveBeenCalledWith(101, change);
    expect(broadcastTransport.sendChangeToTab).toHaveBeenCalledWith(102, change);

    unregister();
    expect(changeListener).toBeUndefined();
  });

  it('ResultPricePresenter fetchCurrencyRates uses typed economy:fetchCurrencyRates messenger instead of raw chrome.runtime.sendMessage', async () => {
    const messenger = createFakeMessenger();
    messenger.sendMessage.mockResolvedValueOnce({
      success: true,
      data: { primary: 'chaos', rates: { chaos: 1, divine: 200 } },
    });

    const rates = await fetchCurrencyRates('poe1', 'Standard', messenger as any);

    expect(rates).toEqual({ primary: 'chaos', rates: { chaos: 1, divine: 200 } });
    expect(messenger.sendMessage).toHaveBeenCalledWith('economy:fetchCurrencyRates', {
      version: 'poe1',
      league: 'Standard',
    });
  });

  it('prohibits legacy raw actions (fetchCurrencyRates, checkAutoUpdate, triggerUpdate, clearCache) from background onMessage', () => {
    const bgContent = fs.readFileSync(
      path.resolve(__dirname, '../entrypoints/background/index.ts'),
      'utf-8',
    );

    expect(bgContent).not.toContain("action === 'fetchCurrencyRates'");
    expect(bgContent).not.toContain("action === 'checkAutoUpdate'");
    expect(bgContent).not.toContain("action === 'triggerUpdate'");
    expect(bgContent).not.toContain("action === 'clearCache'");
  });

  it('background registers handlers only through the typed messenger', () => {
    const bgContent = fs.readFileSync(
      path.resolve(__dirname, '../entrypoints/background/index.ts'),
      'utf-8',
    );
    expect(bgContent).not.toContain('chrome.runtime.onMessage.addListener');
  });
});
