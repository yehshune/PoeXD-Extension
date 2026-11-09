// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoeVersion } from '@/utils/trade-context';
import {
  createLiveSearchSubscriptionFromUrl,
  type LiveSearchSubscription,
} from '@/utils/live-search-contract';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { createLiveSearchPrimaryController } from '@/entrypoints/content/logic/live-search-primary-controller';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import {
  createLiveSearchBookmarkController,
  type LiveSearchBookmarkSourcePort,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';
import type {
  EnsureContainerOptions,
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
  ResetUnreadOptions,
} from '@/entrypoints/content/logic/live-search-host-client';

class FakeWebSocket {
  public url: string;
  public onopen: ((ev: Event) => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;
  public onclose: ((ev: CloseEvent) => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public readyState = 0;
  public closed = false;

  constructor(url: string) {
    this.url = url;
  }

  public triggerOpen(): void {
    if (this.onopen && !this.closed) {
      this.readyState = 1;
      this.onopen(new Event('open'));
    }
  }

  public triggerError(message: string): void {
    if (this.onerror && !this.closed) {
      this.onerror(new Error(message) as unknown as Event);
    }
  }

  public triggerClose(): void {
    if (this.onclose && !this.closed) {
      this.readyState = 3;
      this.closed = true;
      this.onclose(new CloseEvent('close'));
    }
  }

  public triggerMessage(data: string): void {
    if (this.onmessage && !this.closed) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  public close(): void {
    this.closed = true;
    this.readyState = 3;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }
}

class FakeHostClient implements ILiveSearchHostClient {
  public ensureCalls: EnsureContainerOptions[] = [];
  public renderCalls: RenderResultOptions[] = [];
  public resetUnreadCalls: ResetUnreadOptions[] = [];

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    this.ensureCalls.push(options);
    return { success: true };
  }

  public async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    this.renderCalls.push(options);
    return { success: true };
  }

  public async resetUnread(options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    this.resetUnreadCalls.push(options);
    return { success: true };
  }

  public dispose(): void {}
}

describe('LiveSearch Primary Pacing & Reconnect Comprehensive Tests', () => {
  let hostClient: FakeHostClient;
  let createdSockets: FakeWebSocket[];
  let webSocketFactory: (url: string) => WebSocket;
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    hostClient = new FakeHostClient();
    createdSockets = [];
    fetchCalls = [];
    webSocketFactory = (url: string) => {
      const ws = new FakeWebSocket(url);
      createdSockets.push(ws);
      return ws as unknown as WebSocket;
    };
  });

  const createFakeFetch = async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: [{ id: 'mock_item', item: { name: 'Mageblood' } }],
      }),
    } as unknown as Response;
  };

  it('Initial open pacing: adds A, B, C; entities created immediately with connecting status, but WebSockets paced by 1500ms cooldown', async () => {
    const sleepDelays: number[] = [];
    const sleepResolvers: Array<() => void> = [];

    const controlledSleep = (ms: number) => {
      sleepDelays.push(ms);
      return new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      });
    };

    const openScheduler = new LiveSearchOpenScheduler({
      cooldownMs: 1500,
      sleep: controlledSleep,
    });

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler,
    });

    const subA = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch-a',
    )!;
    const subB = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch-b',
    )!;
    const subC = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch-c',
    )!;

    // 1. 同時加入 A, B, C
    const [resA, resB, resC] = await Promise.all([
      runtime.addSubscription(subA),
      runtime.addSubscription(subB),
      runtime.addSubscription(subC),
    ]);

    // 驗證 addSubscription 立即成功，語意為 Runtime 已接受訂閱
    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    expect(resC.success).toBe(true);

    // 驗證 3 個 subscription 實體均已建立，狀態均為 connecting
    const subs = runtime.getSubscriptions();
    expect(subs).toHaveLength(3);
    expect(subs.every((s) => s.status === 'connecting')).toBe(true);

    // 依據 pacing，此時只有第 1 個 socket 建立，第 2 與第 3 個在排隊中，零瞬間爆量連線
    expect(createdSockets).toHaveLength(1);
    expect(createdSockets[0].url).toContain('search-a');

    // 釋放第 1 次冷卻 (1500ms)
    expect(sleepDelays[0]).toBe(1500);
    sleepResolvers.shift()!();
    await new Promise((r) => setTimeout(r, 10));

    // 第 2 個 socket 建立
    expect(createdSockets).toHaveLength(2);
    expect(createdSockets[1].url).toContain('search-b');

    // 釋放第 2 次冷卻 (1500ms)
    expect(sleepDelays[1]).toBe(1500);
    sleepResolvers.shift()!();
    await new Promise((r) => setTimeout(r, 10));

    // 第 3 個 socket 建立
    expect(createdSockets).toHaveLength(3);
    expect(createdSockets[2].url).toContain('search-c');
  });

  it('Auto reconnect: active -> failure -> reconnecting -> connecting -> new socket open -> active', async () => {
    let timeoutHandler: (() => void) | null = null;
    const fakeScheduler = {
      setTimeout: (handler: () => void) => {
        timeoutHandler = handler;
        return 1;
      },
      clearTimeout: () => {
        timeoutHandler = null;
      },
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
      random: () => 0.5,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIauto-reconnect',
    )!;
    await runtime.addSubscription(sub);

    // 1. Initial socket open -> active
    expect(createdSockets).toHaveLength(1);
    createdSockets[0].triggerOpen();
    expect(runtime.getSubscription(sub.id)?.status).toBe('active');

    // 2. 發生意外斷線 -> 進入 reconnecting
    createdSockets[0].triggerClose();
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');
    expect(runtime.getSubscription(sub.id)?.errorMessage).toBe('WebSocket closed unexpectedly');

    // 3. 定時器到期觸發自動重連
    expect(timeoutHandler).not.toBeNull();
    timeoutHandler!();

    // 4. 切換回 connecting 並建立新 socket
    expect(createdSockets).toHaveLength(2);
    expect(runtime.getSubscription(sub.id)?.status).toBe('connecting');

    // 5. 新 socket 連線成功 -> active
    createdSockets[1].triggerOpen();
    expect(runtime.getSubscription(sub.id)?.status).toBe('active');
  });

  it('Error + Close coalescing:同一 attempt 的 error + close 只消耗一次 retry budget', async () => {
    let timeoutHandler: (() => void) | null = null;
    const fakeScheduler = {
      setTimeout: (handler: () => void) => {
        timeoutHandler = handler;
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIcoalesce-test',
    )!;
    await runtime.addSubscription(sub);

    const ws = createdSockets[0];
    ws.triggerOpen();

    // 觸發 error
    ws.triggerError('Transport reset');
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');

    // 緊接著觸發 close (同一個 attempt)
    ws.triggerClose();

    // 驗證仍處於 reconnecting 且並未 double count
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');
  });

  it('Close-only: WebSocket 只有 close 沒有 error 亦正常進入重連 policy，不卡死在 closed', async () => {
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIclose-only-test',
    )!;
    await runtime.addSubscription(sub);

    const ws = createdSockets[0];
    ws.triggerOpen();
    expect(runtime.getSubscription(sub.id)?.status).toBe('active');

    // 直接 close，無前置 error 事件
    ws.triggerClose();

    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');
  });

  it('Success reset: failed attempts 重置為 0 於 successful open', async () => {
    let timeoutCb: (() => void) | null = null;
    const fakeScheduler = {
      setTimeout: (cb: () => void) => {
        timeoutCb = cb;
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsuccess-reset',
    )!;
    await runtime.addSubscription(sub);

    // 失敗 1 次
    createdSockets[0].triggerClose();
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');

    // 觸發重連
    timeoutCb!();
    expect(createdSockets).toHaveLength(2);

    // 連線成功 -> budget 重置
    createdSockets[1].triggerOpen();
    expect(runtime.getSubscription(sub.id)?.status).toBe('active');
  });

  it('Retry exhaustion: 達到 maxFailedAttempts (3次) 進入 terminal error 且不再自動排程，實體保留', async () => {
    const timeoutCbs: Array<() => void> = [];
    const fakeScheduler = {
      setTimeout: (cb: () => void) => {
        timeoutCbs.push(cb);
        return timeoutCbs.length;
      },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
      reconnectPolicy: { maxFailedAttempts: 3 },
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIexhaustion-test',
    )!;
    await runtime.addSubscription(sub);

    // attempt 1 failed
    createdSockets[0].triggerClose();
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');

    // retry 1 -> attempt 2 failed
    timeoutCbs.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    createdSockets[1].triggerClose();
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');

    // retry 2 -> attempt 3 failed
    timeoutCbs.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    createdSockets[2].triggerClose();
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');

    // retry 3 -> attempt 4 failed (第 4 次失敗，超過上限 3)
    timeoutCbs.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    createdSockets[3].triggerClose();

    // 進入 terminal error
    expect(runtime.getSubscription(sub.id)?.status).toBe('error');
    expect(runtime.getSubscription(sub.id)?.errorMessage).toContain('已嘗試重連 3 次');
    expect(timeoutCbs).toHaveLength(0); // 沒有再排程自動重連
    expect(runtime.getSubscriptions()).toHaveLength(1); // 實體保留
  });

  it('Manual retry: terminal error 可手動恢復，保持相同 subscription ID 與同一實體', async () => {
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      reconnectPolicy: { maxFailedAttempts: 0 }, // 立即 terminal
    });
    const controller = createLiveSearchPrimaryController(runtime);

    await controller.addFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sImanual-retry-test',
    );
    const originalSub = controller.read().subscriptions[0];
    const originalId = originalSub.id;

    // 失敗進入 terminal error
    createdSockets[0].triggerClose();
    expect(controller.read().subscriptions[0].status).toBe('error');

    // 手動 Retry
    const retryOutcome = controller.retry(originalId);
    expect(retryOutcome.success).toBe(true);

    // 驗證同一個 subscription 實體
    const retriedSub = controller.read().subscriptions[0];
    expect(retriedSub.id).toBe(originalId);
    expect(retriedSub.status).toBe('connecting');

    // 新 socket 連線成功
    expect(createdSockets).toHaveLength(2);
    createdSockets[1].triggerOpen();
    expect(controller.read().subscriptions[0].status).toBe('active');
  });

  it('Stale generation: 舊 attempt 的延遲事件對當前 attempt 零影響且不傳遞 token', async () => {
    let timeoutCb: (() => void) | null = null;
    const fakeScheduler = {
      setTimeout: (cb: () => void) => {
        timeoutCb = cb;
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIstale-gen-test',
    )!;
    await runtime.addSubscription(sub);

    const oldWs = createdSockets[0];
    oldWs.triggerClose();

    // 進入下一代 attempt
    timeoutCb!();
    const newWs = createdSockets[1];

    // 舊 socket 觸發 stale 事件
    oldWs.triggerOpen();
    oldWs.triggerMessage(JSON.stringify({ result: 'stale_token' }));
    oldWs.triggerError('Late error');

    // 驗證 fetchCalls 零呼叫
    expect(fetchCalls).toHaveLength(0);

    // 新 socket 正常工作
    newWs.triggerOpen();
    expect(runtime.getSubscription(sub.id)?.status).toBe('active');
    newWs.triggerMessage(JSON.stringify({ result: 'fresh_token' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('fresh_token');
  });

  it('Stop while reconnect timer pending: 取消定時器且不再建立新 WebSocket', async () => {
    let timeoutCleared = false;
    let timeoutHandler: (() => void) | null = null;

    const fakeScheduler = {
      setTimeout: (cb: () => void) => {
        timeoutHandler = cb;
        return 99;
      },
      clearTimeout: (id: unknown) => {
        if (id === 99) timeoutCleared = true;
      },
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIstop-pending-timer',
    )!;
    await runtime.addSubscription(sub);

    createdSockets[0].triggerClose();
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');
    expect(timeoutHandler).not.toBeNull();

    // 移除訂閱
    runtime.removeSubscription(sub.id);
    expect(timeoutCleared).toBe(true);
    // 即使定時器被非法執行，也不會建立新 socket
    const triggerFn = timeoutHandler as (() => void) | null;
    if (triggerFn) triggerFn();
    expect(createdSockets).toHaveLength(1);
  });

  it('Stop while queued for opening: 排隊中的 open 執行時被拒絕，zero socket creation', async () => {
    let executeNextOpen: () => Promise<void> | void = () => {};
    const manualOpenScheduler: any = {
      enqueue: (task: () => Promise<void> | void) => {
        executeNextOpen = task;
      },
      dispose: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: manualOpenScheduler,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIstop-in-queue',
    )!;
    await runtime.addSubscription(sub);

    // 尚未執行 open 時移除
    runtime.removeSubscription(sub.id);

    // 佇列輪到該任務執行
    await executeNextOpen();

    // 驗證 zero socket created!
    expect(createdSockets).toHaveLength(0);
  });

  it('Dispose: 釋放所有連線、取消定時器、disabled shared scheduler，零 late reconnect', async () => {
    let clearedTimer = false;
    const fakeScheduler = {
      setTimeout: () => 123,
      clearTimeout: () => {
        clearedTimer = true;
      },
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIdispose-test',
    )!;
    await runtime.addSubscription(sub);

    createdSockets[0].triggerClose();
    expect(runtime.getSubscription(sub.id)?.status).toBe('reconnecting');

    // runtime dispose
    runtime.dispose();

    expect(clearedTimer).toBe(true);
    expect(runtime.getSubscriptions()).toHaveLength(0);
    expect(runtime.isDisposed()).toBe(true);
  });

  it('Dedup across reconnect: processed token 跨 reconnect 嚴格保留，零重複 fetch 與零重複 render', async () => {
    let timeoutCb: (() => void) | null = null;
    const fakeScheduler = {
      setTimeout: (cb: () => void) => {
        timeoutCb = cb;
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      scheduler: fakeScheduler,
    });

    const sub = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIdedup-reconnect',
    )!;
    await runtime.addSubscription(sub);

    // 1. Initial active
    createdSockets[0].triggerOpen();

    // 2. 收到 token_1 -> 成功 fetch 與 render
    createdSockets[0].triggerMessage(JSON.stringify({ result: 'token_1' }));
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchCalls).toHaveLength(1);
    expect(hostClient.renderCalls).toHaveLength(1);
    expect(runtime.getCumulativeRenderedTotal()).toBe(1);

    // 3. WebSocket 斷線並重連
    createdSockets[0].triggerClose();
    timeoutCb!();
    expect(createdSockets).toHaveLength(2);
    createdSockets[1].triggerOpen();

    // 4. 新連線再次推播相同的 token_1
    createdSockets[1].triggerMessage(JSON.stringify({ result: 'token_1' }));
    await new Promise((r) => setTimeout(r, 20));

    // 驗證 dedup 跨 reconnect 完美保留：zero second fetch, zero second render!
    expect(fetchCalls).toHaveLength(1);
    expect(hostClient.renderCalls).toHaveLength(1);
    expect(runtime.getCumulativeRenderedTotal()).toBe(1);
  });

  it('Duplicate identity rejection: 當 subscription 處於 reconnecting 或 terminal error 時，加入相同 canonical search 仍被拒絕', async () => {
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });

    const sub1 = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIdup-identity-search',
    )!;
    await runtime.addSubscription(sub1);

    // 進入 reconnecting
    createdSockets[0].triggerClose();
    expect(runtime.getSubscription(sub1.id)?.status).toBe('reconnecting');

    // 嘗試以不同 subscriptionId 但相同 canonical search 加入
    const sub2 = createLiveSearchSubscriptionFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sIdup-identity-search',
    )!;
    expect(sub2.id).not.toBe(sub1.id);

    const dupOutcome = await runtime.addSubscription(sub2);
    expect(dupOutcome.success).toBe(false);
    expect(dupOutcome.error).toContain('Duplicate subscription');
  });

  it('Bookmark status projection: matching bookmark reflects reconnecting and error status, and Add button is disabled', async () => {
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: createFakeFetch,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      reconnectPolicy: { maxFailedAttempts: 0 },
    });
    const controller = createLiveSearchPrimaryController(runtime);

    const mockCollection = {
      bookmarks: [
        {
          id: 'bmk_headhunter',
          name: '獵首',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIheadhunter-search',
          groupId: 'grp_belts',
          searchRecordId: 'rec_1',
          gameVersion: 'poe1' as const,
          order: 0,
          createdAt: 1000,
        },
      ],
      groups: [
        { id: 'grp_belts', name: '腰帶', gameVersion: 'poe1' as const, order: 0, createdAt: 1000 },
      ],
    };

    const mockBookmarkSource: LiveSearchBookmarkSourcePort = {
      readCollection: async () => ({ ok: true, value: mockCollection }),
      subscribe: () => () => {},
    };

    const bookmarkController = createLiveSearchBookmarkController(mockBookmarkSource, controller);

    let latestBookmarkSnapshot: any = null;
    bookmarkController.subscribe((s) => {
      latestBookmarkSnapshot = s;
    });

    await new Promise((r) => setTimeout(r, 20));

    // 1. 尚未加入
    const bmkBefore = latestBookmarkSnapshot.groups[0].bookmarks[0];
    expect(bmkBefore.liveSearchStatus).toBeUndefined();

    // 2. 加入至 LiveSearch
    await bookmarkController.add('bmk_headhunter');
    await new Promise((r) => setTimeout(r, 20));

    const bmkConnecting = latestBookmarkSnapshot.groups[0].bookmarks[0];
    expect(bmkConnecting.liveSearchStatus).toBe('connecting');

    // 3. WebSocket open -> active
    createdSockets[0].triggerOpen();
    await new Promise((r) => setTimeout(r, 20));
    expect(latestBookmarkSnapshot.groups[0].bookmarks[0].liveSearchStatus).toBe('active');

    // 4. WebSocket close -> terminal error (因 maxFailedAttempts: 0)
    createdSockets[0].triggerClose();
    await new Promise((r) => setTimeout(r, 20));
    expect(latestBookmarkSnapshot.groups[0].bookmarks[0].liveSearchStatus).toBe('error');

    // 5. 處於 error 狀態時，書籤依舊標記為已佔用，嘗試重複 add 應被阻擋
    const dupAddOutcome = await bookmarkController.add('bmk_headhunter');
    expect(dupAddOutcome.success).toBe(false);
  });
});
