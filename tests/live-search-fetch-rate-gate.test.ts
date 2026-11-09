// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  computeRateLimitWaitMs,
  LiveSearchFetchRateGate,
  parseRateLimitWindowPair,
  parseRetryAfterMs,
  parseTradeRateLimitHeaders,
  type LiveSearchFetchRateGateTimer,
} from '@/entrypoints/content/logic/live-search-fetch-rate-gate';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import type {
  EnsureContainerOptions,
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
  ResetUnreadOptions,
} from '@/entrypoints/content/logic/live-search-host-client';
import type { LiveSearchSubscription } from '@/utils/live-search-contract';

class ManualTimerClock implements LiveSearchFetchRateGateTimer {
  public currentTimeMs = 1000;
  public scheduled: Array<{
    id: number;
    runAtMs: number;
    delayMs: number;
    handler: () => void;
    cancelled: boolean;
  }> = [];
  private nextId = 1;

  public now = (): number => this.currentTimeMs;

  public setTimeout = (handler: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.scheduled.push({
      id,
      runAtMs: this.currentTimeMs + ms,
      delayMs: ms,
      handler,
      cancelled: false,
    });
    return id;
  };

  public clearTimeout = (id: unknown): void => {
    const entry = this.scheduled.find((item) => item.id === id);
    if (entry) {
      entry.cancelled = true;
    }
  };

  public getActiveCount(): number {
    return this.scheduled.filter((item) => !item.cancelled).length;
  }

  public advanceBy(ms: number): void {
    const targetTime = this.currentTimeMs + ms;
    while (true) {
      const due = this.scheduled
        .filter((item) => !item.cancelled && item.runAtMs <= targetTime)
        .sort((a, b) => a.runAtMs - b.runAtMs || a.id - b.id)[0];
      if (!due) break;
      due.cancelled = true;
      this.currentTimeMs = due.runAtMs;
      due.handler();
    }
    this.currentTimeMs = targetTime;
  }
}

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
    queueMicrotask(() => {
      if (!this.closed && this.onopen) {
        this.readyState = 1;
        this.onopen(new Event('open'));
      }
    });
  }

  public simulateMessage(data: string): void {
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
  public renderOutcome: HostCommandOutcome = { success: true };

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    this.ensureCalls.push(options);
    return { success: true };
  }

  public async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    this.renderCalls.push(options);
    return this.renderOutcome;
  }

  public async resetUnread(options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    this.resetUnreadCalls.push(options);
    return { success: true };
  }

  public dispose(): void {}
}

const flushMicrotasks = async (cycles = 6) => {
  for (let i = 0; i < cycles; i++) {
    await Promise.resolve();
  }
  await new Promise((r) => setTimeout(r, 5));
};

describe('Pure Rate Header Parser', () => {
  it('parses single rule / single window', () => {
    const headers = new Headers({
      'X-Rate-Limit-Policy': 'trade-fetch-request-limit',
      'X-Rate-Limit-Rules': 'Account',
      'X-Rate-Limit-Account': '12:4:60',
      'X-Rate-Limit-Account-State': '3:4:0',
    });

    const parsed = parseTradeRateLimitHeaders(headers);
    expect(parsed.policy).toBe('trade-fetch-request-limit');
    expect(parsed.ruleNames).toEqual(['account']);
    expect(parsed.rules).toEqual([
      {
        rule: 'account',
        windows: [{ limit: 12, window: 4, cooldown: 60, used: 3, windowLeft: 4, cooldownLeft: 0 }],
      },
    ]);
    expect(parsed.retryAfterMs).toBeNull();
  });

  it('parses single rule / multiple comma-separated windows', () => {
    const headers = new Headers({
      'X-Rate-Limit-Rules': 'Ip',
      'X-Rate-Limit-Ip': '12:4:60,16:12:300,30:60:900',
      'X-Rate-Limit-Ip-State': '2:4:0,5:12:0,10:60:0',
    });

    const parsed = parseTradeRateLimitHeaders(headers);
    expect(parsed.ruleNames).toEqual(['ip']);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]!.windows).toEqual([
      { limit: 12, window: 4, cooldown: 60, used: 2, windowLeft: 4, cooldownLeft: 0 },
      { limit: 16, window: 12, cooldown: 300, used: 5, windowLeft: 12, cooldownLeft: 0 },
      { limit: 30, window: 60, cooldown: 900, used: 10, windowLeft: 60, cooldownLeft: 0 },
    ]);
  });

  it('supports multiple dynamic rule names including unknown future rules', () => {
    const headers = new Headers({
      'X-Rate-Limit-Rules': 'Account, Ip, LeagueSession',
      'X-Rate-Limit-Account': '10:5:60',
      'X-Rate-Limit-Account-State': '1:5:0',
      'X-Rate-Limit-Ip': '12:4:60',
      'X-Rate-Limit-Ip-State': '2:4:0',
      'X-Rate-Limit-LeagueSession': '20:10:120',
      'X-Rate-Limit-LeagueSession-State': '19:10:0',
    });

    const parsed = parseTradeRateLimitHeaders(headers);
    expect(parsed.ruleNames).toEqual(['account', 'ip', 'leaguesession']);
    expect(parsed.rules.map((r) => r.rule)).toEqual(['account', 'ip', 'leaguesession']);
    expect(parsed.rules[2]!.windows[0]).toEqual({
      limit: 20,
      window: 10,
      cooldown: 120,
      used: 19,
      windowLeft: 10,
      cooldownLeft: 0,
    });
  });

  it('safely ignores missing rule state, mismatched window counts, and malformed numbers without throwing', () => {
    // 1. Missing rule state
    const missingStateHeaders = new Headers({
      'X-Rate-Limit-Rules': 'Account,Ip',
      'X-Rate-Limit-Account': '12:4:60',
      // X-Rate-Limit-Account-State missing
      'X-Rate-Limit-Ip': '16:12:300',
      'X-Rate-Limit-Ip-State': '4:12:0',
    });
    const parsedMissingState = parseTradeRateLimitHeaders(missingStateHeaders);
    expect(parsedMissingState.rules).toEqual([
      {
        rule: 'ip',
        windows: [
          { limit: 16, window: 12, cooldown: 300, used: 4, windowLeft: 12, cooldownLeft: 0 },
        ],
      },
    ]);

    // 2. Mismatched window counts + malformed window entry
    const windows = parseRateLimitWindowPair(
      '12:abc:60,16:12:300,0:60:60,40:60:120',
      '1:4:0,6:12:0,2:60:0',
    );
    expect(windows).toEqual([
      { limit: 16, window: 12, cooldown: 300, used: 6, windowLeft: 12, cooldownLeft: 0 },
    ]);
  });

  it('parses Retry-After and missing headers safely', () => {
    expect(parseRetryAfterMs('15', 1000)).toBe(15000);
    expect(parseRetryAfterMs('invalid-value', 1000)).toBeNull();
    expect(parseRetryAfterMs(null, 1000)).toBeNull();

    const emptyParsed = parseTradeRateLimitHeaders(undefined);
    expect(emptyParsed).toEqual({
      policy: null,
      ruleNames: [],
      rules: [],
      retryAfterMs: null,
    });
    expect(computeRateLimitWaitMs(emptyParsed, 200)).toBe(0);
  });
});

describe('LiveSearchFetchRateGate Behavioral Contract', () => {
  it('sends first request immediately, ingests headers, and does NOT pause when quota remains (even at >=90% usage)', async () => {
    const clock = new ManualTimerClock();
    const calls: string[] = [];

    const gate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ result: [{ id: url }] }), {
          status: 200,
          headers: {
            'X-Rate-Limit-Rules': 'Account',
            // 9/10 used (90%): under server-authority policy, used < limit and cooldownLeft === 0 -> 0 wait
            'X-Rate-Limit-Account': '10:10:60',
            'X-Rate-Limit-Account-State': '9:10:0',
          },
        });
      },
    });

    const res1 = await gate.fetch('https://www.pathofexile.com/api/trade/fetch/tk1');
    expect(res1?.status).toBe(200);
    expect(calls).toEqual(['https://www.pathofexile.com/api/trade/fetch/tk1']);
    expect(gate.getStateSnapshot().rules.account?.[0]?.used).toBe(9);
    expect(clock.getActiveCount()).toBe(0);

    // Next request proceeds immediately without timer wait
    const res2 = await gate.fetch('https://www.pathofexile.com/api/trade/fetch/tk2');
    expect(res2?.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(clock.getActiveCount()).toBe(0);
  });

  it('waits before next request when window is exhausted (used >= limit) or cooldownLeft > 0, taking the more conservative wait with Retry-After', async () => {
    const clock = new ManualTimerClock();
    const callTimestamps: Array<{ url: string; at: number }> = [];
    let step = 0;

    const gate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async (url) => {
        callTimestamps.push({ url, at: clock.now() });
        step++;
        if (step === 1) {
          // Exhausted window: used = 12, limit = 12, windowLeft = 4s
          return new Response('{}', {
            status: 200,
            headers: {
              'X-Rate-Limit-Rules': 'Ip',
              'X-Rate-Limit-Ip': '12:4:60',
              'X-Rate-Limit-Ip-State': '12:4:0',
            },
          });
        }
        if (step === 2) {
          // Active cooldownLeft = 10s AND Retry-After = 15s -> conservative wait = 15s
          return new Response('{}', {
            status: 200,
            headers: {
              'X-Rate-Limit-Rules': 'Ip',
              'X-Rate-Limit-Ip': '12:4:60',
              'X-Rate-Limit-Ip-State': '13:4:10',
              'Retry-After': '15',
            },
          });
        }
        return new Response('{}', { status: 200 });
      },
    });

    // 1. First request at t = 1000ms
    await gate.fetch('req-1');
    expect(callTimestamps).toEqual([{ url: 'req-1', at: 1000 }]);

    // 2. Second request must wait 4000ms (until t = 5000ms) because used (12) >= limit (12)
    let req2Done = false;
    const p2 = gate.fetch('req-2').then(() => {
      req2Done = true;
    });
    await flushMicrotasks();
    expect(req2Done).toBe(false);
    expect(callTimestamps).toHaveLength(1);

    clock.advanceBy(3999);
    await flushMicrotasks();
    expect(req2Done).toBe(false);

    clock.advanceBy(1);
    await p2;
    expect(req2Done).toBe(true);
    expect(callTimestamps[1]).toEqual({ url: 'req-2', at: 5000 });

    // 3. Third request must wait 15000ms (until t = 20000ms) due to conservative max(10s, 15s)
    let req3Done = false;
    const p3 = gate.fetch('req-3').then(() => {
      req3Done = true;
    });
    await flushMicrotasks();
    expect(req3Done).toBe(false);

    clock.advanceBy(10000);
    await flushMicrotasks();
    expect(req3Done).toBe(false);

    clock.advanceBy(5000);
    await p3;
    expect(req3Done).toBe(true);
    expect(callTimestamps[2]).toEqual({ url: 'req-3', at: 20000 });
  });

  it('handles 429 + Retry-After by waiting for cooldown and performing bounded single retry', async () => {
    const clock = new ManualTimerClock();
    const attempts: Array<{ url: string; at: number }> = [];

    const gate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async (url) => {
        attempts.push({ url, at: clock.now() });
        if (attempts.length === 1) {
          return new Response('Too Many Requests', {
            status: 429,
            headers: {
              'X-Rate-Limit-Rules': 'Ip',
              'X-Rate-Limit-Ip': '12:4:60',
              'X-Rate-Limit-Ip-State': '13:4:25',
              'Retry-After': '30',
            },
          });
        }
        return new Response(JSON.stringify({ result: [{ id: 'ok-after-429' }] }), {
          status: 200,
          headers: {
            'X-Rate-Limit-Rules': 'Ip',
            'X-Rate-Limit-Ip': '12:4:60',
            'X-Rate-Limit-Ip-State': '1:4:0',
          },
        });
      },
    });

    let settled = false;
    const fetchPromise = gate
      .fetch('https://www.pathofexile.com/api/trade/fetch/tk_429')
      .then((r) => {
        settled = true;
        return r;
      });

    await flushMicrotasks();
    // Initial attempt sent at t = 1000ms, got 429; must NOT immediately retry
    expect(attempts).toEqual([
      { url: 'https://www.pathofexile.com/api/trade/fetch/tk_429', at: 1000 },
    ]);
    expect(settled).toBe(false);

    // Advance 29999ms -> still waiting for 30s Retry-After
    clock.advanceBy(29999);
    await flushMicrotasks();
    expect(attempts).toHaveLength(1);

    // Advance 1ms -> reaches 30000ms cooldown, performs single retry at t = 31000ms
    clock.advanceBy(1);
    const resolvedResponse = await fetchPromise;
    expect(attempts).toEqual([
      { url: 'https://www.pathofexile.com/api/trade/fetch/tk_429', at: 1000 },
      { url: 'https://www.pathofexile.com/api/trade/fetch/tk_429', at: 31000 },
    ]);
    expect(resolvedResponse?.status).toBe(200);
  });

  it('cancels pending wait immediately on dispose() with zero subsequent fetch', async () => {
    const clock = new ManualTimerClock();
    const calls: string[] = [];

    const gate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async (url) => {
        calls.push(url);
        return new Response('Rate Limited', {
          status: 429,
          headers: {
            'Retry-After': '60',
          },
        });
      },
    });

    let fetchFinished = false;
    let fetchResult: Response | null | undefined;
    const p = gate.fetch('req-dispose').then((res) => {
      fetchFinished = true;
      fetchResult = res;
    });

    await flushMicrotasks();
    expect(calls).toEqual(['req-dispose']);
    expect(fetchFinished).toBe(false);
    expect(clock.getActiveCount()).toBe(1);

    // Dispose during 60s cooldown wait -> must resolve immediately without advancing clock
    gate.dispose();
    await p;
    expect(fetchFinished).toBe(true);
    expect(fetchResult).toBeNull();
    expect(clock.getActiveCount()).toBe(0);

    // Advancing clock by 120s must trigger zero additional fetch
    clock.advanceBy(120000);
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
  });
});

describe('LiveSearchPrimaryRuntime + FetchRateGate Integration', () => {
  const createSub = (id: string, searchId: string): LiveSearchSubscription => ({
    id,
    gameVersion: 'poe1',
    league: 'Settlers',
    searchId,
    url: `https://www.pathofexile.com/trade/search/Settlers/${searchId}`,
    status: 'idle',
    createdAt: 1000,
  });

  it('preserves FIFO ordering across multiple subscriptions and maintains source-scoped dedup during rate wait', async () => {
    const clock = new ManualTimerClock();
    const hostClient = new FakeHostClient();
    const sockets: FakeWebSocket[] = [];
    const fetchOrder: string[] = [];

    const baseRateGate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async (url) => {
        fetchOrder.push(url);
        if (fetchOrder.length === 1) {
          // First response exhausts window for 5 seconds
          return new Response(JSON.stringify({ result: [{ id: 'item_1' }] }), {
            status: 200,
            headers: {
              'X-Rate-Limit-Rules': 'Account',
              'X-Rate-Limit-Account': '5:5:60',
              'X-Rate-Limit-Account-State': '5:5:0',
            },
          });
        }
        return new Response(JSON.stringify({ result: [{ id: `item_${fetchOrder.length}` }] }), {
          status: 200,
          headers: {
            'X-Rate-Limit-Rules': 'Account',
            'X-Rate-Limit-Account': '5:5:60',
            'X-Rate-Limit-Account-State': '1:5:0',
          },
        });
      },
    });

    let activeGateCalls = 0;
    let maxConcurrentGateCalls = 0;
    const rateGateCalls: string[] = [];
    const rateGate = {
      fetch: async (
        url: string,
        init?: RequestInit,
        options?: Parameters<LiveSearchFetchRateGate['fetch']>[2],
      ) => {
        activeGateCalls++;
        maxConcurrentGateCalls = Math.max(maxConcurrentGateCalls, activeGateCalls);
        rateGateCalls.push(url);
        try {
          return await baseRateGate.fetch(url, init, options);
        } finally {
          activeGateCalls--;
        }
      },
      getStateSnapshot: () => baseRateGate.getStateSnapshot(),
      dispose: () => baseRateGate.dispose(),
    };

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
      fetchRateGate: rateGate,
      origin: 'https://www.pathofexile.com',
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });

    await runtime.addSubscription(createSub('sub_A', 'search_A'));
    await runtime.addSubscription(createSub('sub_B', 'search_B'));
    await flushMicrotasks();

    const wsA = sockets[0]!;
    const wsB = sockets[1]!;

    // 1. Sub A receives tk_A1, Sub B receives tk_B1, Sub A receives tk_A2
    wsA.simulateMessage(JSON.stringify({ result: 'tk_A1', count: 1 }));
    wsB.simulateMessage(JSON.stringify({ result: 'tk_B1', count: 1 }));
    wsA.simulateMessage(JSON.stringify({ result: 'tk_A2', count: 1 }));
    await flushMicrotasks();

    // tk_A1 fetched and rendered immediately; tk_B1 is now waiting on 5s rate cooldown;
    // tk_A2 remains queued in Runtime (not yet dispatched to RateGate)
    expect(fetchOrder).toHaveLength(1);
    expect(rateGateCalls).toEqual([
      'https://www.pathofexile.com/api/trade/fetch/tk_A1?query=search_A',
      'https://www.pathofexile.com/api/trade/fetch/tk_B1?query=search_B',
    ]);
    expect(hostClient.renderCalls.map((c) => c.token)).toEqual(['tk_A1']);

    // While waiting on rate cooldown, duplicate tk_B1 and tk_A2 arrive on Sub B and Sub A -> must be deduplicated!
    wsB.simulateMessage(JSON.stringify({ result: 'tk_B1', count: 1 }));
    wsA.simulateMessage(JSON.stringify({ result: 'tk_A2', count: 1 }));
    await flushMicrotasks();

    // Advance 5000ms -> tk_B1 and then tk_A2 complete in strict FIFO order owned by Runtime
    clock.advanceBy(5000);
    await flushMicrotasks(12);

    expect(maxConcurrentGateCalls).toBe(1);
    expect(fetchOrder).toEqual([
      'https://www.pathofexile.com/api/trade/fetch/tk_A1?query=search_A',
      'https://www.pathofexile.com/api/trade/fetch/tk_B1?query=search_B',
      'https://www.pathofexile.com/api/trade/fetch/tk_A2?query=search_A',
    ]);
    expect(hostClient.renderCalls.map((c) => c.token)).toEqual(['tk_A1', 'tk_B1', 'tk_A2']);
    expect(runtime.getCumulativeRenderedTotal()).toBe(3);
  });

  it('429 retry success: produces exactly one render, one cumulative increment, and marks token processed once', async () => {
    const clock = new ManualTimerClock();
    const hostClient = new FakeHostClient();
    const sockets: FakeWebSocket[] = [];
    let fetchCount = 0;

    const rateGate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return new Response('Rate limited', {
            status: 429,
            headers: {
              'Retry-After': '10',
            },
          });
        }
        return new Response(JSON.stringify({ result: [{ id: 'item_recovered' }] }), {
          status: 200,
        });
      },
    });

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
      fetchRateGate: rateGate,
      origin: 'https://www.pathofexile.com',
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });

    await runtime.addSubscription(createSub('sub_1', 'search_1'));
    await flushMicrotasks();

    const ws = sockets[0]!;
    ws.simulateMessage(JSON.stringify({ result: 'tk_429_recover', count: 1 }));
    await flushMicrotasks();

    // First attempt returned 429: zero render, zero cumulative total
    expect(fetchCount).toBe(1);
    expect(hostClient.renderCalls).toHaveLength(0);
    expect(runtime.getCumulativeRenderedTotal()).toBe(0);

    // Advance 10s for Retry-After cooldown -> retry succeeds
    clock.advanceBy(10000);
    await flushMicrotasks(10);

    expect(fetchCount).toBe(2);
    expect(hostClient.renderCalls).toHaveLength(1);
    expect(hostClient.renderCalls[0]!.token).toBe('tk_429_recover');
    expect(hostClient.renderCalls[0]!.total).toBe(1);
    expect(runtime.getCumulativeRenderedTotal()).toBe(1);

    // Re-receiving the same token later must be ignored because it is in processedTokens
    ws.simulateMessage(JSON.stringify({ result: 'tk_429_recover', count: 1 }));
    await flushMicrotasks();
    expect(fetchCount).toBe(2);
    expect(hostClient.renderCalls).toHaveLength(1);
  });

  it('429 retry exhaustion and non-429 errors: bounds 429 retry to 1 attempt, keeps failed token unprocessed for future delivery, and does not retry ordinary 500', async () => {
    const clock = new ManualTimerClock();
    const hostClient = new FakeHostClient();
    const sockets: FakeWebSocket[] = [];
    let mode: 'double-429' | '500' | 'ok' = 'double-429';
    let fetchCount = 0;

    const rateGate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async () => {
        fetchCount++;
        if (mode === 'double-429') {
          return new Response('Rate limited', {
            status: 429,
            headers: { 'Retry-After': '5' },
          });
        }
        if (mode === '500') {
          return new Response('Server error', {
            status: 500,
          });
        }
        return new Response(JSON.stringify({ result: [{ id: 'item_ok' }] }), {
          status: 200,
        });
      },
    });

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
      fetchRateGate: rateGate,
      origin: 'https://www.pathofexile.com',
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });

    await runtime.addSubscription(createSub('sub_bound', 'search_bound'));
    await flushMicrotasks();
    const ws = sockets[0]!;

    // 1. Token hits 429 on initial attempt and 429 on the 1 allowed retry -> stops after 2 fetches
    ws.simulateMessage(JSON.stringify({ result: 'tk_exhaust', count: 1 }));
    await flushMicrotasks();
    expect(fetchCount).toBe(1);

    clock.advanceBy(5000);
    await flushMicrotasks();
    expect(fetchCount).toBe(2);
    expect(hostClient.renderCalls).toHaveLength(0);
    expect(runtime.getCumulativeRenderedTotal()).toBe(0);

    // Clear post-retry 5s cooldown; verify no infinite 3rd retry happened
    clock.advanceBy(5000);
    await flushMicrotasks();
    expect(fetchCount).toBe(2);

    // 2. Ordinary 500 error does NOT retry in RateGate (1 fetch only)
    mode = '500';
    ws.simulateMessage(JSON.stringify({ result: 'tk_500', count: 1 }));
    await flushMicrotasks();
    expect(fetchCount).toBe(3);
    expect(hostClient.renderCalls).toHaveLength(0);

    // 3. Because tk_exhaust was NOT marked processed, when server re-delivers it later under 'ok', it succeeds
    mode = 'ok';
    ws.simulateMessage(JSON.stringify({ result: 'tk_exhaust', count: 1 }));
    await flushMicrotasks();
    expect(fetchCount).toBe(4);
    expect(hostClient.renderCalls).toHaveLength(1);
    expect(hostClient.renderCalls[0]!.token).toBe('tk_exhaust');
    expect(runtime.getCumulativeRenderedTotal()).toBe(1);
  });

  it('subscription removed or runtime disposed while waiting on cooldown: cancels wait with zero subsequent fetch and zero render', async () => {
    const clock = new ManualTimerClock();
    const hostClient = new FakeHostClient();
    const sockets: FakeWebSocket[] = [];
    const fetchedUrls: string[] = [];

    const rateGate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async (url) => {
        fetchedUrls.push(url);
        if (fetchedUrls.length === 1) {
          return new Response(JSON.stringify({ result: [{ id: 'item_1' }] }), {
            status: 200,
            headers: {
              'X-Rate-Limit-Rules': 'Ip',
              'X-Rate-Limit-Ip': '10:10:60',
              'X-Rate-Limit-Ip-State': '10:10:20',
            },
          });
        }
        return new Response(JSON.stringify({ result: [{ id: 'item_later' }] }), {
          status: 200,
        });
      },
    });

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
      fetchRateGate: rateGate,
      origin: 'https://www.pathofexile.com',
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });

    await runtime.addSubscription(createSub('sub_1', 'search_1'));
    await runtime.addSubscription(createSub('sub_2', 'search_2'));
    await flushMicrotasks();

    const ws1 = sockets[0]!;
    const ws2 = sockets[1]!;

    // 1. tk_1 triggers 20s cooldown; tk_2 (on sub_1) and tk_3 (on sub_2) are queued
    ws1.simulateMessage(JSON.stringify({ result: 'tk_1', count: 1 }));
    ws1.simulateMessage(JSON.stringify({ result: 'tk_2', count: 1 }));
    ws2.simulateMessage(JSON.stringify({ result: 'tk_3', count: 1 }));
    await flushMicrotasks();

    expect(fetchedUrls).toEqual([
      'https://www.pathofexile.com/api/trade/fetch/tk_1?query=search_1',
    ]);
    expect(hostClient.renderCalls).toHaveLength(1);

    // 2. Remove sub_1 while tk_2 is waiting in RateGate cooldown
    runtime.removeSubscription('sub_1');
    await flushMicrotasks();

    // 3. Dispose runtime while tk_3 is waiting in RateGate cooldown
    runtime.dispose();
    await flushMicrotasks();

    expect(clock.getActiveCount()).toBe(0);

    // Advancing clock by 60s must produce zero fetch and zero render for tk_2 and tk_3
    clock.advanceBy(60000);
    await flushMicrotasks();
    expect(fetchedUrls).toHaveLength(1);
    expect(hostClient.renderCalls).toHaveLength(1);
  });

  it('projects rate state to View snapshot immediately on 200 and during 429 cooldown wait before retry completes, and stops publishing after dispose', async () => {
    const clock = new ManualTimerClock();
    const hostClient = new FakeHostClient();
    const sockets: FakeWebSocket[] = [];
    let attemptNum = 0;
    let resolveLateResponse = null as ((res: Response) => void) | null;

    const rateGate = new LiveSearchFetchRateGate({
      timer: clock,
      fetchClient: async () => {
        attemptNum++;
        if (attemptNum === 1) {
          // 1. 200 without rate headers
          return new Response(JSON.stringify({ result: [{ id: 'item_no_hdr' }] }), {
            status: 200,
          });
        }
        if (attemptNum === 2) {
          // 2. 200 with rate headers
          return new Response(JSON.stringify({ result: [{ id: 'item_200_hdr' }] }), {
            status: 200,
            headers: {
              'X-Rate-Limit-Policy': 'trade-fetch-request-limit',
              'X-Rate-Limit-Rules': 'Account',
              'X-Rate-Limit-Account': '12:4:60',
              'X-Rate-Limit-Account-State': '3:4:0',
            },
          });
        }
        if (attemptNum === 3) {
          // 3. 429 with Retry-After and cooldown state
          return new Response('Too Many Requests', {
            status: 429,
            headers: {
              'X-Rate-Limit-Policy': 'trade-fetch-request-limit',
              'X-Rate-Limit-Rules': 'Account,CustomQuota',
              'X-Rate-Limit-Account': '12:4:60',
              'X-Rate-Limit-Account-State': '13:4:45',
              'X-Rate-Limit-CustomQuota': '20:10:120',
              'X-Rate-Limit-CustomQuota-State': '20:10:60',
              'Retry-After': '60',
            },
          });
        }
        if (attemptNum === 4) {
          // Retry after 429 cooldown
          return new Response(JSON.stringify({ result: [{ id: 'item_after_429' }] }), {
            status: 200,
            headers: {
              'X-Rate-Limit-Policy': 'trade-fetch-request-limit',
              'X-Rate-Limit-Rules': 'Account',
              'X-Rate-Limit-Account': '12:4:60',
              'X-Rate-Limit-Account-State': '1:4:0',
            },
          });
        }
        return new Promise<Response>((resolve) => {
          resolveLateResponse = resolve;
        });
      },
    });

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
      fetchRateGate: rateGate,
      origin: 'https://www.pathofexile.com',
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });

    const observedSnapshots: ReturnType<typeof runtime.getSnapshot>[] = [];
    runtime.subscribe((snap) => {
      observedSnapshots.push(snap);
    });

    await runtime.addSubscription(createSub('sub_rate_ui', 'search_rate_ui'));
    await flushMicrotasks();
    const ws = sockets[0]!;

    // Case 1: 無 headers -> no rate data
    ws.simulateMessage(JSON.stringify({ result: 'tk_no_hdr', count: 1 }));
    await flushMicrotasks();
    expect(runtime.getSnapshot().rateLimit).toEqual({
      policy: null,
      rules: {},
      nextAllowedAtMs: 0,
    });

    // Case 2: 200 response headers -> snapshot 更新
    ws.simulateMessage(JSON.stringify({ result: 'tk_200_hdr', count: 1 }));
    await flushMicrotasks();
    expect(runtime.getSnapshot().rateLimit).toEqual({
      policy: 'trade-fetch-request-limit',
      rules: {
        account: [{ limit: 12, window: 4, cooldown: 60, used: 3, windowLeft: 4, cooldownLeft: 0 }],
      },
      nextAllowedAtMs: 0,
      observedAtMs: 1000,
    });

    // Case 3: 429 + Retry-After -> cooldown wait 尚未結束時，View snapshot 已可立即觀察 rate state
    ws.simulateMessage(JSON.stringify({ result: 'tk_429_wait', count: 1 }));
    await flushMicrotasks();

    // Verify retry has NOT happened yet (attemptNum is still 3, waiting for 60s cooldown)
    expect(attemptNum).toBe(3);
    const snapDuringCooldown = observedSnapshots[observedSnapshots.length - 1]!;
    expect(snapDuringCooldown.rateLimit.policy).toBe('trade-fetch-request-limit');
    expect(snapDuringCooldown.rateLimit.nextAllowedAtMs).toBe(1000 + 60000);
    expect(snapDuringCooldown.rateLimit.observedAtMs).toBe(1000);
    expect(snapDuringCooldown.rateLimit.rules.account?.[0]).toEqual({
      limit: 12,
      window: 4,
      cooldown: 60,
      used: 13,
      windowLeft: 4,
      cooldownLeft: 45,
    });
    expect(snapDuringCooldown.rateLimit.rules.customquota?.[0]).toEqual({
      limit: 20,
      window: 10,
      cooldown: 120,
      used: 20,
      windowLeft: 10,
      cooldownLeft: 60,
    });

    // Advance 60s so bounded retry completes
    clock.advanceBy(60000);
    await flushMicrotasks(10);
    expect(attemptNum).toBe(4);
    expect(runtime.getSnapshot().rateLimit.rules.account?.[0]?.used).toBe(1);

    // Case 4: dispose 後不得繼續發布 rate state
    ws.simulateMessage(JSON.stringify({ result: 'tk_in_flight_dispose', count: 1 }));
    await flushMicrotasks();
    expect(attemptNum).toBe(5);

    const rateGateEventsAfterDispose: any[] = [];
    rateGate.subscribe((s) => rateGateEventsAfterDispose.push(s));

    runtime.dispose();
    const countAtDispose = observedSnapshots.length;

    resolveLateResponse?.(
      new Response(JSON.stringify({ result: [{ id: 'late' }] }), {
        status: 200,
        headers: {
          'X-Rate-Limit-Policy': 'should-never-publish',
          'X-Rate-Limit-Rules': 'Account',
          'X-Rate-Limit-Account': '12:4:60',
          'X-Rate-Limit-Account-State': '9:4:30',
        },
      }),
    );
    await flushMicrotasks();

    expect(observedSnapshots.length).toBe(countAtDispose);
    expect(rateGateEventsAfterDispose).toHaveLength(0);
    expect(rateGate.read().policy).toBe('trade-fetch-request-limit');
  });
});
