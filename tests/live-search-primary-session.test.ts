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
    let sourceOpts: any;
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
          read: () => ({ subscriptions: activeSubscriptions }),
          dispose: () => events.push('runtime:dispose'),
        } as any;
      },
      createResumeStore: () => ({}) as any,
      createBookmarkClient: () => ({}) as any,
      createSourceController: (_bm, _live, opts) => {
        sourceOpts = opts;
        return {
          enqueueIncomingConnections,
          dispose: () => events.push('source:dispose'),
        } as any;
      },
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
      environment: {
        origin: 'https://pathofexile.tw',
        canFetchOfficialLeagues: true,
        getCurrentPageLeague: () => 'Keepers',
      },
      factories,
    });

    expect(doc.body.getAttribute('data-poexd-page-role')).toBe('live-search-primary');
    expect(events).toEqual(['title:start', 'host:start']);
    expect(session.console.initialArrivalSignal).toBe(true);
    expect('resumeController' in session.console).toBe(false);
    expect(soundOpts.isEnabled()).toBe(true);
    expect(runtimeOpts.getMaxDisplayedResults()).toBe(120);
    expect(runtimeOpts.origin).toBe('https://pathofexile.tw');
    expect(runtimeOpts.getCurrentPageLeague()).toBe('Keepers');
    expect(sourceOpts.origin).toBe('https://pathofexile.tw');
    expect(sourceOpts.canFetchOfficialLeagues).toBe(true);

    // 驗證 onResultDelivered -> Console Sound Notification（實際抓取渲染後才響）
    runtimeOpts.onResultDelivered({ ownerKey: 'poe1|standard|abcd1234ef' });
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
      createRuntime: () =>
        ({
          read: () => ({ subscriptions: [] }),
          dispose: () => events.push('runtime:dispose'),
        }) as any,
      createResumeStore: () => ({}) as any,
      createBookmarkClient: () => ({}) as any,
      createSourceController: () =>
        ({
          enqueueIncomingConnections,
          dispose: () => events.push('source:dispose'),
        }) as any,
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
    const sourceListener: { fn: ((snapshot: unknown) => void) | null } = { fn: null };
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
            read: () => ({ subscriptions: [] }),
            subscribe: () => () => {},
            dispose: vi.fn(),
          } as any;
        },
        createSourceController: () =>
          ({
            read: () => ({ sessionConnections: [], groups: [] }),
            subscribe: (fn: (snapshot: unknown) => void) => {
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
    sourceListener.fn?.({ sessionConnections: [], groups: [] });
    expect(badge.syncAll).toHaveBeenCalledTimes(1);

    session.dispose();
    expect(badge.dispose).toHaveBeenCalledTimes(1);
    expect(sourceListener.fn).toBeNull();
  });

  it('來源標籤查名稱使用快照通知建立的查表，不會每列重建整份 source 快照', () => {
    const events: string[] = [];
    const { factories } = createRecordingFactories(events);
    let badgeOpts: any;
    let sourceListener: ((snapshot: unknown) => void) | null = null;
    const read = vi.fn(() => ({
      sessionConnections: [],
      groups: [{ items: [{ canonicalKey: 'k1', name: '舊名稱' }] }],
    }));

    const session = createLiveSearchPrimarySession({
      version: 'poe1',
      preferences: createStubPreferences(),
      resultCache: { ingestResult: vi.fn() },
      doc: stubDoc,
      factories: {
        ...factories,
        createResultSourceBadge: (opts) => {
          badgeOpts = opts;
          return { record: vi.fn(), syncAll: vi.fn(), clear: vi.fn(), dispose: vi.fn() };
        },
        createRuntime: () =>
          ({
            read: () => ({ subscriptions: [] }),
            subscribe: () => () => {},
            dispose: vi.fn(),
          }) as any,
        createSourceController: () =>
          ({
            read,
            subscribe: (fn: (snapshot: unknown) => void) => {
              sourceListener = fn;
              fn(read());
              return () => {};
            },
            enqueueIncomingConnections: vi.fn(),
            dispose: vi.fn(),
          }) as any,
      },
    });

    read.mockClear();
    for (let i = 0; i < 100; i++) expect(badgeOpts.resolveSourceName('k1')).toBe('舊名稱');
    expect(read).not.toHaveBeenCalled();

    // 快照通知（如更名）後查表隨之更新；工作階段連線名稱優先
    sourceListener!({
      sessionConnections: [{ canonicalKey: 'k1', name: '本次連線' }],
      groups: [
        {
          items: [
            { canonicalKey: 'k1', name: '新名稱' },
            { canonicalKey: 'k2', name: 'B' },
          ],
        },
      ],
    });
    expect(badgeOpts.resolveSourceName('k1')).toBe('本次連線');
    expect(badgeOpts.resolveSourceName('k2')).toBe('B');
    expect(badgeOpts.resolveSourceName('missing')).toBeUndefined();

    session.dispose();
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

  it('單組靜音的連線交付結果時，同時抑制通知音效與桌面通知，未靜音連線照常通知', () => {
    const events: string[] = [];
    const { factories } = createRecordingFactories(events);
    let capturedRuntimeOpts: any;
    const soundNotify = vi.fn();
    const desktopNotify = vi.fn();
    const mutedKeys = new Set<string>(['poe1:standard:muted_search']);

    const session = createLiveSearchPrimarySession({
      version: 'poe1',
      preferences: createStubPreferences(),
      resultCache: { ingestResult: vi.fn() },
      doc: stubDoc,
      factories: {
        ...factories,
        createSoundNotifier: () =>
          ({
            notify: soundNotify,
            dispose: vi.fn(),
          }) as any,
        createDesktopNotifier: () =>
          ({
            notify: desktopNotify,
            test: vi.fn(() => ({ ok: true as const })),
            getPermission: vi.fn(() => 'granted' as const),
            requestPermission: vi.fn(async () => 'granted' as const),
            dispose: vi.fn(),
          }) as any,
        createRuntime: (_v, opts) => {
          capturedRuntimeOpts = opts;
          return {
            read: () => ({ subscriptions: [] }),
            subscribe: () => () => {},
            dispose: vi.fn(),
          } as any;
        },
        createSourceController: () =>
          ({
            read: () => ({ sessionConnections: [], groups: [] }),
            subscribe: () => () => {},
            isMuted: (key: string) => mutedKeys.has(key),
            enqueueIncomingConnections: vi.fn(),
            dispose: vi.fn(),
          }) as any,
      },
    });

    // 已靜音連線：音效與桌面通知皆不觸發
    capturedRuntimeOpts.onResultDelivered({ ownerKey: 'poe1:standard:muted_search' });
    expect(soundNotify).not.toHaveBeenCalled();
    expect(desktopNotify).not.toHaveBeenCalled();

    // 未靜音連線：音效與桌面通知皆正常觸發
    capturedRuntimeOpts.onResultDelivered({ ownerKey: 'poe1:standard:loud_search' });
    expect(soundNotify).toHaveBeenCalledTimes(1);
    expect(desktopNotify).toHaveBeenCalledTimes(1);
    expect(desktopNotify).toHaveBeenCalledWith(
      expect.objectContaining({ ownerKey: 'poe1:standard:loud_search' }),
    );

    session.dispose();
  });
});
