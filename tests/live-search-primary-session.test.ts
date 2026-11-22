import { describe, expect, it, vi } from 'vitest';
import {
  createLiveSearchPrimarySession,
  type LiveSearchPrimarySessionFactories,
} from '@/entrypoints/content/logic/live-search-primary-session';
import type { PreferencesModule } from '@/utils/preferences';

function createStubPreferences(overrides?: {
  liveSearchSoundEnabled?: boolean;
  liveSearchMaxDisplayedResults?: number;
}): PreferencesModule {
  const state = {
    liveSearchSoundEnabled: overrides?.liveSearchSoundEnabled ?? true,
    liveSearchMaxDisplayedResults: overrides?.liveSearchMaxDisplayedResults ?? 80,
  };
  return {
    read: () => state as ReturnType<PreferencesModule['read']>,
    subscribe: () => () => {},
  } as unknown as PreferencesModule;
}

describe('createLiveSearchPrimarySession', () => {
  it('組裝所有子模組、設定 data-poexd-page-role，並正確接線音效／結果快取／退出守衛與 enqueue bridge', async () => {
    const events: string[] = [];
    let runtimeOpts: any;
    let exitGuardOpts: any;
    let enqueueBridgeOpts: any;
    let soundOpts: any;
    let activeSubscriptions: any[] = [];

    const attrs = new Map<string, string>();
    const doc = {
      body: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
      },
    } as unknown as Document;
    const ingestResult = vi.fn();
    const soundNotify = vi.fn();
    const enqueueIncomingConnections = vi.fn(async () => ({
      success: true,
      addedCount: 1,
      skippedCount: 0,
    }));

    const factories: Partial<LiveSearchPrimarySessionFactories> = {
      createTitleGuard: () => ({
        start: () => events.push('title:start'),
        dispose: () => events.push('title:dispose'),
      }),
      createHostGuard: () => ({
        start: () => events.push('host:start'),
        dispose: () => events.push('host:dispose'),
      }),
      createSoundNotifier: (opts) => {
        soundOpts = opts;
        return {
          notify: soundNotify,
          dispose: () => events.push('sound:dispose'),
        } as any;
      },
      createRuntime: (_version, opts) => {
        runtimeOpts = opts;
        return {
          dispose: () => events.push('runtime:dispose'),
        } as any;
      },
      createPrimaryController: () =>
        ({
          read: () => ({ subscriptions: activeSubscriptions }),
        }) as any,
      createResumeStore: () => ({}) as any,
      createBookmarkClient: () => ({}) as any,
      createSourceController: () =>
        ({
          enqueueIncomingConnections,
          dispose: () => events.push('source:dispose'),
        }) as any,
      createResumeController: () =>
        ({
          dispose: () => events.push('resume:dispose'),
        }) as any,
      createExitGuard: (opts) => {
        exitGuardOpts = opts;
        return {
          dispose: () => events.push('exit:dispose'),
        };
      },
      registerEnqueueBridge: (opts) => {
        enqueueBridgeOpts = opts;
        return () => events.push('enqueue:cleanup');
      },
    };

    const session = createLiveSearchPrimarySession({
      version: 'poe1',
      preferences: createStubPreferences({
        liveSearchSoundEnabled: true,
        liveSearchMaxDisplayedResults: 120,
      }),
      resultCache: { ingestResult },
      initialArrivalSignal: true,
      doc,
      factories,
    });

    expect(doc.body.getAttribute('data-poexd-page-role')).toBe('live-search-primary');
    expect(events).toEqual(['title:start', 'host:start']);
    expect(session.console.initialArrivalSignal).toBe(true);
    expect(soundOpts.isEnabled()).toBe(true);
    expect(runtimeOpts.getMaxDisplayedResults()).toBe(120);

    // 驗證 onResultTokenAccepted -> Console Sound Notification
    runtimeOpts.onResultTokenAccepted();
    expect(soundNotify).toHaveBeenCalledTimes(1);

    // 驗證 onResultFetched -> TradeResultCache
    const itemData = { id: 'item_1' } as any;
    runtimeOpts.onResultFetched({ itemData, searchId: 'AbCd1234Ef', league: 'Standard' });
    expect(ingestResult).toHaveBeenCalledWith(itemData, {
      sourceSearchId: 'AbCd1234Ef',
      league: 'Standard',
    });

    // 驗證 exitGuard shouldWarn 隨 active subscriptions 變化
    expect(exitGuardOpts.shouldWarn()).toBe(false);
    activeSubscriptions = [{ id: 'sub_1' }];
    expect(exitGuardOpts.shouldWarn()).toBe(true);

    // 驗證 enqueue bridge 正常轉發
    expect(enqueueBridgeOpts.isDisposed()).toBe(false);
    const res = await enqueueBridgeOpts.enqueueIncoming([
      { url: 'https://www.pathofexile.com/trade/search/Standard/AbCd1234Ef' },
    ]);
    expect(res).toEqual({ success: true, addedCount: 1, skippedCount: 0 });
    expect(enqueueIncomingConnections).toHaveBeenCalledTimes(1);

    // 驗證 dispose() 嚴格依既有順序釋放，且具冪等性
    events.length = 0;
    session.dispose();
    session.dispose();
    expect(events).toEqual([
      'enqueue:cleanup',
      'title:dispose',
      'host:dispose',
      'exit:dispose',
      'source:dispose',
      'resume:dispose',
      'runtime:dispose',
      'sound:dispose',
    ]);

    // 釋放後 enqueueIncoming 不再呼叫已釋放的 controller
    expect(enqueueBridgeOpts.isDisposed()).toBe(true);
    const afterDispose = await enqueueBridgeOpts.enqueueIncoming([]);
    expect(afterDispose.success).toBe(false);
    expect(enqueueIncomingConnections).toHaveBeenCalledTimes(1);
  });
  function createRecordingFactories(events: string[]) {
    const captured: { enqueueBridgeOpts?: any } = {};
    const enqueueIncomingConnections = vi.fn(async () => ({
      success: true,
      addedCount: 1,
      skippedCount: 0,
    }));
    const factories: Partial<LiveSearchPrimarySessionFactories> = {
      createTitleGuard: () => ({
        start: () => events.push('title:start'),
        dispose: () => events.push('title:dispose'),
      }),
      createHostGuard: () => ({
        start: () => events.push('host:start'),
        dispose: () => events.push('host:dispose'),
      }),
      createSoundNotifier: () =>
        ({ notify: vi.fn(), dispose: () => events.push('sound:dispose') }) as any,
      createRuntime: () => ({ dispose: () => events.push('runtime:dispose') }) as any,
      createPrimaryController: () => ({ read: () => ({ subscriptions: [] }) }) as any,
      createResumeStore: () => ({}) as any,
      createBookmarkClient: () => ({}) as any,
      createSourceController: () =>
        ({
          enqueueIncomingConnections,
          dispose: () => events.push('source:dispose'),
        }) as any,
      createResumeController: () => ({ dispose: () => events.push('resume:dispose') }) as any,
      createExitGuard: () => ({ dispose: () => events.push('exit:dispose') }),
      registerEnqueueBridge: (opts) => {
        captured.enqueueBridgeOpts = opts;
        return () => events.push('enqueue:cleanup');
      },
    };
    return { factories, captured, enqueueIncomingConnections };
  }

  const stubDoc = { body: { setAttribute: () => {} } } as unknown as Document;

  it('宿主 runtime 開始釋放（isHostDisposed 為 true）時，enqueue bridge 立即視為已釋放', () => {
    const events: string[] = [];
    const { factories, captured } = createRecordingFactories(events);
    let hostDisposed = false;

    const session = createLiveSearchPrimarySession({
      version: 'poe1',
      preferences: createStubPreferences(),
      resultCache: { ingestResult: vi.fn() },
      isHostDisposed: () => hostDisposed,
      doc: stubDoc,
      factories,
    });

    expect(captured.enqueueBridgeOpts.isDisposed()).toBe(false);
    // runtime.ts 的 cleanupAll 會先設 disposed = true，再於最後呼叫 session.dispose()
    hostDisposed = true;
    expect(captured.enqueueBridgeOpts.isDisposed()).toBe(true);
    expect(events).not.toContain('enqueue:cleanup');

    session.dispose();
    expect(events).toContain('enqueue:cleanup');
  });

  it('建構中途失敗時依序釋放已建立的子模組並重新拋出錯誤', () => {
    const events: string[] = [];
    const { factories } = createRecordingFactories(events);
    const boom = new Error('resume store unavailable');

    expect(() =>
      createLiveSearchPrimarySession({
        version: 'poe1',
        preferences: createStubPreferences(),
        resultCache: { ingestResult: vi.fn() },
        doc: stubDoc,
        factories: {
          ...factories,
          createResumeStore: () => {
            throw boom;
          },
        },
      }),
    ).toThrow(boom);

    expect(events).toEqual([
      'title:start',
      'host:start',
      'title:dispose',
      'host:dispose',
      'runtime:dispose',
      'sound:dispose',
    ]);
  });

  it('將結果卡片來源標籤接至 runtime 與 sourceController（含更名同步與釋放）', () => {
    const events: string[] = [];
    const { factories } = createRecordingFactories(events);
    let capturedRuntimeOpts: any;
    const sourceListener: { fn: (() => void) | null } = { fn: null };
    const badge = {
      record: vi.fn(),
      syncAll: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    };

    const session = createLiveSearchPrimarySession({
      version: 'poe1',
      preferences: createStubPreferences(),
      resultCache: { ingestResult: vi.fn() },
      doc: stubDoc,
      factories: {
        ...factories,
        createResultSourceBadge: () => badge,
        createRuntime: (_v, opts) => {
          capturedRuntimeOpts = opts;
          return {
            subscribe: () => () => {},
            dispose: vi.fn(),
          } as any;
        },
        createSourceController: () =>
          ({
            read: () => ({ sessionConnections: [], groups: [] }),
            subscribe: (fn: () => void) => {
              sourceListener.fn = fn;
              return () => {
                sourceListener.fn = null;
              };
            },
            enqueueIncomingConnections: vi.fn(),
            dispose: vi.fn(),
          }) as any,
      },
    });

    capturedRuntimeOpts.onResultRendered({ itemId: 'item-1', ownerKey: 'poe1:std:abc' });
    expect(badge.record).toHaveBeenCalledWith('item-1', 'poe1:std:abc');

    capturedRuntimeOpts.onResultsCleared();
    expect(badge.clear).toHaveBeenCalledTimes(1);

    // 來源（如書籤更名）變動時應同步重刷卡片來源標籤
    sourceListener.fn?.();
    expect(badge.syncAll).toHaveBeenCalledTimes(1);

    session.dispose();
    expect(badge.dispose).toHaveBeenCalledTimes(1);
    expect(sourceListener.fn).toBeNull();
  });

  it('點擊桌面通知時透過 liveSearch:focusPrimary 聚焦主控台，而非呼叫會開新分頁的 liveSearch:openPrimary', () => {
    const events: string[] = [];
    const { factories } = createRecordingFactories(events);
    let capturedDesktopOpts: any;
    const sendMessage = vi.fn(async () => ({ success: true }));

    const session = createLiveSearchPrimarySession({
      version: 'poe2',
      preferences: createStubPreferences(),
      resultCache: { ingestResult: vi.fn() },
      doc: stubDoc,
      factories: {
        ...factories,
        createDesktopNotifier: (opts) => {
          capturedDesktopOpts = opts;
          return {
            notify: vi.fn(),
            test: vi.fn(() => ({ ok: true as const })),
            getPermission: vi.fn(() => 'granted' as const),
            requestPermission: vi.fn(async () => 'granted' as const),
            dispose: vi.fn(),
          };
        },
        messenger: { sendMessage } as any,
      },
    });

    capturedDesktopOpts.onFocusConsole();
    expect(sendMessage).toHaveBeenCalledWith('liveSearch:focusPrimary', { gameVersion: 'poe2' });
    expect(sendMessage).not.toHaveBeenCalledWith('liveSearch:openPrimary', expect.anything());

    session.dispose();
  });
});
