// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  LiveSearchConnectionSession,
  DEFAULT_RECONNECT_POLICY,
} from '@/entrypoints/content/logic/live-search-connection-session';
import type { ILiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import type { LiveSearchSubscriptionStatus } from '@/utils/live-search-contract';

class FakeTestWebSocket {
  public url: string;
  public onopen: ((ev: Event) => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;
  public onclose: ((ev: CloseEvent) => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public closed = false;

  constructor(url: string) {
    this.url = url;
  }

  public triggerOpen() {
    if (this.onopen) this.onopen(new Event('open'));
  }

  public triggerError(err: Error = new Error('Socket failed')) {
    if (this.onerror) this.onerror(err as unknown as Event);
  }

  public triggerClose() {
    this.closed = true;
    if (this.onclose) this.onclose(new CloseEvent('close'));
  }

  public triggerMessage(data: string) {
    if (this.onmessage) this.onmessage(new MessageEvent('message', { data }));
  }

  public close() {
    this.closed = true;
  }
}

describe('LiveSearchConnectionSession Tests', () => {
  function createTestHarness(options?: {
    random?: () => number;
    policy?: Partial<typeof DEFAULT_RECONNECT_POLICY>;
  }) {
    const socketsCreated: FakeTestWebSocket[] = [];
    const statusChanges: Array<{
      status: LiveSearchSubscriptionStatus;
      metadata?: { errorMessage?: string; reconnectInSeconds?: number };
    }> = [];
    const tokensReceived: string[] = [];

    const mockWebSocketFactory = (url: string) => {
      const ws = new FakeTestWebSocket(url);
      socketsCreated.push(ws);
      return ws as unknown as WebSocket;
    };

    const scheduledOpenTasks: Array<() => Promise<void> | void> = [];
    const mockScheduler: ILiveSearchOpenScheduler = {
      enqueue: (task) => {
        scheduledOpenTasks.push(task);
      },
      dispose: () => {
        scheduledOpenTasks.length = 0;
      },
    };

    // 模擬計時器
    type TimerCallback = () => void;
    let timerIdSeq = 0;
    const timeouts = new Map<number, { cb: TimerCallback; ms: number }>();
    const intervals = new Map<number, { cb: TimerCallback; ms: number }>();

    const fakeTimerScheduler = {
      setTimeout: (cb: TimerCallback, ms: number) => {
        const id = ++timerIdSeq;
        timeouts.set(id, { cb, ms });
        return id;
      },
      clearTimeout: (id: unknown) => {
        timeouts.delete(id as number);
      },
      setInterval: (cb: TimerCallback, ms: number) => {
        const id = ++timerIdSeq;
        intervals.set(id, { cb, ms });
        return id;
      },
      clearInterval: (id: unknown) => {
        intervals.delete(id as number);
      },
    };

    const flushOpenQueue = async () => {
      while (scheduledOpenTasks.length > 0) {
        const task = scheduledOpenTasks.shift();
        if (task) await task();
      }
    };

    const triggerAllTimeouts = () => {
      const entries = Array.from(timeouts.entries());
      timeouts.clear();
      for (const [, { cb }] of entries) {
        cb();
      }
    };

    const triggerIntervals = (times = 1) => {
      for (let i = 0; i < times; i++) {
        const current = Array.from(intervals.values());
        for (const { cb } of current) {
          cb();
        }
      }
    };

    const session = new LiveSearchConnectionSession({
      wsUrl: 'wss://fake.pathofexile.com/trade',
      webSocketFactory: mockWebSocketFactory,
      openScheduler: mockScheduler,
      handlers: {
        onStatusChange: (status, metadata) => {
          statusChanges.push({ status, metadata });
        },
        onToken: (token) => {
          tokensReceived.push(token);
        },
      },
      policy: options?.policy,
      random: options?.random ?? (() => 0.5), // 0.5 代表 jitter = 0 (因為 0.5 * 2 - 1 = 0)
      scheduler: fakeTimerScheduler,
    });

    return {
      session,
      socketsCreated,
      statusChanges,
      tokensReceived,
      scheduledOpenTasks,
      timeouts,
      intervals,
      flushOpenQueue,
      triggerAllTimeouts,
      triggerIntervals,
    };
  }

  it('starts connection through openScheduler and transitions to active on open', async () => {
    const harness = createTestHarness();

    sessionStart: {
      harness.session.start();
      expect(harness.statusChanges.at(-1)?.status).toBe('connecting');
      expect(harness.scheduledOpenTasks.length).toBe(1);

      await harness.flushOpenQueue();
      expect(harness.socketsCreated.length).toBe(1);

      const ws = harness.socketsCreated[0];
      ws.triggerOpen();

      expect(harness.statusChanges.at(-1)?.status).toBe('active');
      expect(harness.session.getStatus()).toBe('active');
      expect(harness.session.getFailedAttempts()).toBe(0);
    }
  });

  it('normalizes error + close into a single connection failure without double counting', async () => {
    const harness = createTestHarness();
    harness.session.start();
    await harness.flushOpenQueue();

    const ws = harness.socketsCreated[0];
    ws.triggerOpen();
    expect(harness.session.getStatus()).toBe('active');

    // 瀏覽器典型事件鏈：先 error，緊接著 close
    ws.triggerError(new Error('Network disconnect'));
    expect(harness.session.getStatus()).toBe('reconnecting');
    expect(harness.session.getFailedAttempts()).toBe(1);

    const reconnectingChangesCount = harness.statusChanges.filter(
      (c) => c.status === 'reconnecting',
    ).length;
    expect(reconnectingChangesCount).toBe(1);

    // 緊接著 close
    ws.triggerClose();

    // 驗證 close 沒有重複計算 failure，也沒有重複觸發 reconnecting 狀態變更
    expect(harness.session.getFailedAttempts()).toBe(1);
    expect(harness.statusChanges.filter((c) => c.status === 'reconnecting').length).toBe(1);
  });

  it('normalizes close-only event into a failure and triggers reconnect', async () => {
    const harness = createTestHarness();
    harness.session.start();
    await harness.flushOpenQueue();

    const ws = harness.socketsCreated[0];
    ws.triggerOpen();

    // 沒有 error，直接 close
    ws.triggerClose();

    expect(harness.session.getStatus()).toBe('reconnecting');
    expect(harness.session.getFailedAttempts()).toBe(1);
    expect(harness.statusChanges.at(-1)?.metadata?.errorMessage).toBe(
      'WebSocket closed unexpectedly',
    );
  });

  it('resets failed attempts budget upon successful socket open', async () => {
    const harness = createTestHarness();
    harness.session.start();
    await harness.flushOpenQueue();

    // 第一次失敗
    harness.socketsCreated[0].triggerClose();
    expect(harness.session.getFailedAttempts()).toBe(1);

    // 等待重連 timeout
    harness.triggerAllTimeouts();
    expect(harness.session.getStatus()).toBe('connecting');

    await harness.flushOpenQueue();
    expect(harness.socketsCreated.length).toBe(2);

    // 第二次連線成功
    harness.socketsCreated[1].triggerOpen();
    expect(harness.session.getStatus()).toBe('active');
    expect(harness.session.getFailedAttempts()).toBe(0);
  });

  it('enters terminal error state when retry budget is exhausted and retains session', async () => {
    const harness = createTestHarness({ policy: { maxFailedAttempts: 3 } });
    harness.session.start();
    await harness.flushOpenQueue();

    // 嘗試 1 失敗
    harness.socketsCreated[0].triggerClose();
    expect(harness.session.getStatus()).toBe('reconnecting');
    expect(harness.session.getFailedAttempts()).toBe(1);

    // 重連 1 -> attempt 2
    harness.triggerAllTimeouts();
    await harness.flushOpenQueue();
    expect(harness.socketsCreated.length).toBe(2);
    harness.socketsCreated[1].triggerClose();
    expect(harness.session.getFailedAttempts()).toBe(2);

    // 重連 2 -> attempt 3
    harness.triggerAllTimeouts();
    await harness.flushOpenQueue();
    expect(harness.socketsCreated.length).toBe(3);
    harness.socketsCreated[2].triggerClose();
    expect(harness.session.getFailedAttempts()).toBe(3);

    // 重連 3 -> attempt 4 (第 4 次失敗，超過上限 3)
    harness.triggerAllTimeouts();
    await harness.flushOpenQueue();
    expect(harness.socketsCreated.length).toBe(4);
    harness.socketsCreated[3].triggerClose();

    // 超過最大 3 次重連，進入 terminal error
    expect(harness.session.getStatus()).toBe('error');
    expect(harness.session.getFailedAttempts()).toBe(4);
    expect(harness.timeouts.size).toBe(0); // 沒有再排程自動重連
  });

  it('allows manual retry in terminal error state and rejects retry when active/connecting', async () => {
    const harness = createTestHarness({ policy: { maxFailedAttempts: 1 } });
    harness.session.start();
    await harness.flushOpenQueue();

    // 運行中嘗試 retry -> 拒絕
    const rejectedOutcome = harness.session.retry();
    expect(rejectedOutcome.success).toBe(false);

    // 耗盡 retry budget
    harness.socketsCreated[0].triggerClose(); // attempt 1 (failed = 1)
    harness.triggerAllTimeouts();
    await harness.flushOpenQueue();
    harness.socketsCreated[1].triggerClose(); // attempt 2 (failed = 2 > max 1) -> terminal error

    expect(harness.session.getStatus()).toBe('error');

    // 手動 Retry
    const successOutcome = harness.session.retry();
    expect(successOutcome.success).toBe(true);
    expect(harness.session.getStatus()).toBe('connecting');
    expect(harness.session.getFailedAttempts()).toBe(0);

    // 透過 openScheduler 重新排隊連線
    expect(harness.scheduledOpenTasks.length).toBe(1);
    await harness.flushOpenQueue();
    expect(harness.socketsCreated.length).toBe(3);

    harness.socketsCreated[2].triggerOpen();
    expect(harness.session.getStatus()).toBe('active');
  });

  it('ignores stale socket events when a newer attempt generation has started', async () => {
    const harness = createTestHarness();
    harness.session.start();
    await harness.flushOpenQueue();

    const staleWs = harness.socketsCreated[0];

    // 發生斷線進入 reconnecting
    staleWs.triggerClose();
    expect(harness.session.getStatus()).toBe('reconnecting');

    // 下一輪 attempt 開始
    harness.triggerAllTimeouts();
    await harness.flushOpenQueue();
    const currentWs = harness.socketsCreated[1];

    // 此時舊的 staleWs 延遲觸發了 open / error / close / message
    staleWs.triggerOpen();
    expect(harness.session.getStatus()).toBe('connecting'); // 不受影響

    staleWs.triggerMessage(JSON.stringify({ result: 'stale_token' }));
    expect(harness.tokensReceived.length).toBe(0); // token 被擋下

    staleWs.triggerError(new Error('Late error'));
    expect(harness.session.getFailedAttempts()).toBe(1); // 不被 double count

    // currentWs 正常 open
    currentWs.triggerOpen();
    expect(harness.session.getStatus()).toBe('active');

    // currentWs 收到 message
    currentWs.triggerMessage(JSON.stringify({ result: 'valid_token' }));
    expect(harness.tokensReceived).toEqual(['valid_token']);
  });

  it('cancels pending reconnect timer and closes socket on stop', async () => {
    const harness = createTestHarness();
    harness.session.start();
    await harness.flushOpenQueue();

    harness.socketsCreated[0].triggerClose();
    expect(harness.session.getStatus()).toBe('reconnecting');
    expect(harness.timeouts.size).toBe(1);

    // 呼叫 stop
    harness.session.stop();
    expect(harness.session.getStatus()).toBe('closed');
    expect(harness.timeouts.size).toBe(0);
    expect(harness.intervals.size).toBe(0);

    // 之後即使 triggerAllTimeouts 也不會建立任何新 socket
    harness.triggerAllTimeouts();
    await harness.flushOpenQueue();
    expect(harness.socketsCreated.length).toBe(1);
  });

  it('cancels queued open task when stopped while in openScheduler queue', async () => {
    const harness = createTestHarness();
    harness.session.start();
    expect(harness.scheduledOpenTasks.length).toBe(1);

    // 在 queue 還沒 flush 前先呼叫 stop
    harness.session.stop();
    expect(harness.session.getStatus()).toBe('closed');

    // queue 被排到並執行
    await harness.flushOpenQueue();

    // 驗證 generation 檢查生效，zero socket creation!
    expect(harness.socketsCreated.length).toBe(0);
  });

  it('calculates capped backoff and applies jitter', async () => {
    // 驗證 backoff 指數增長與 capped
    const randomZero = () => 0; // jitter = -20%
    const randomOne = () => 1; // jitter = +20%

    // base 5000, 4^0 = 5000
    // attempt 1: base 5000, +20% = 6000
    const harnessMaxJitter = createTestHarness({
      random: randomOne,
      policy: { baseDelayMs: 5000, maxDelayMs: 20000, maxFailedAttempts: 5 },
    });
    harnessMaxJitter.session.start();
    await harnessMaxJitter.flushOpenQueue();
    harnessMaxJitter.socketsCreated[0].triggerClose(); // attempt 1 failed

    const attempt1Timeout = Array.from(harnessMaxJitter.timeouts.values())[0];
    expect(attempt1Timeout.ms).toBe(6000);

    // attempt 2: base 5000 * 4^1 = 20000, capped at maxDelayMs 20000
    harnessMaxJitter.triggerAllTimeouts();
    await harnessMaxJitter.flushOpenQueue();
    harnessMaxJitter.socketsCreated[1].triggerClose();

    const attempt2Timeout = Array.from(harnessMaxJitter.timeouts.values())[0];
    expect(attempt2Timeout.ms).toBe(20000);
  });

  it('extracts token from result or legacy new, and ignores auth true', async () => {
    const harness = createTestHarness();
    harness.session.start();
    await harness.flushOpenQueue();
    const ws = harness.socketsCreated[0];
    ws.triggerOpen();

    // 1. auth 訊息 -> 忽略
    ws.triggerMessage(JSON.stringify({ auth: true }));
    expect(harness.tokensReceived.length).toBe(0);

    // 2. canonical result 訊息 -> 提取 token
    ws.triggerMessage(JSON.stringify({ result: 'token_abc', count: 1 }));
    expect(harness.tokensReceived).toEqual(['token_abc']);

    // 3. legacy new 訊息 -> 提取 token
    ws.triggerMessage(JSON.stringify({ new: 'token_legacy' }));
    expect(harness.tokensReceived).toEqual(['token_abc', 'token_legacy']);
  });
});
