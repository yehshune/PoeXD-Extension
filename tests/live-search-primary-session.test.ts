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
});
