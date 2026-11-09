// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoeVersion } from '@/utils/trade-context';
import { createLiveSearchPrimaryController } from '@/entrypoints/content/logic/live-search-primary-controller';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
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

  public close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

class FakeHostClient implements ILiveSearchHostClient {
  public ensureCalls: EnsureContainerOptions[] = [];
  public renderCalls: RenderResultOptions[] = [];
  public resetUnreadCalls: ResetUnreadOptions[] = [];
  public disposed = false;
  public ensureSuccess = true;
  public renderSuccess = true;

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    this.ensureCalls.push(options);
    return {
      success: this.ensureSuccess,
      error: this.ensureSuccess ? undefined : 'Host ensure error',
    };
  }

  public async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    this.renderCalls.push(options);
    return {
      success: this.renderSuccess,
      error: this.renderSuccess ? undefined : 'Host render error',
    };
  }

  public async resetUnread(options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    this.resetUnreadCalls.push(options);
    return { success: true };
  }

  public dispose(): void {
    this.disposed = true;
  }
}

describe('LiveSearchPrimaryController Tests', () => {
  let hostClient: FakeHostClient;
  let createdSockets: FakeWebSocket[];
  let webSocketFactory: (url: string) => WebSocket;
  let fetchClient: ReturnType<typeof vi.fn>;
  let runtime: LiveSearchPrimaryRuntime;

  beforeEach(() => {
    hostClient = new FakeHostClient();
    createdSockets = [];
    webSocketFactory = (url: string) => {
      const ws = new FakeWebSocket(url);
      createdSockets.push(ws);
      return ws as unknown as WebSocket;
    };
    fetchClient = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ result: [{ id: 'item_1', item: { name: 'Tabula' } }] }),
      } as unknown as Response;
    });

    runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient: fetchClient as unknown as (url: string, init?: RequestInit) => Promise<Response>,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });
  });

  describe('Reactive Publication & Snapshot Seam', () => {
    it('provides initial snapshot on subscribe and read()', () => {
      const controller = createLiveSearchPrimaryController(runtime);

      const initialSnapshot = controller.read();
      expect(initialSnapshot).toEqual({
        gameVersion: 'poe1',
        runtimeLeague: null,
        cumulativeRenderedTotal: 0,
        subscriptions: [],
        rateLimit: {
          policy: null,
          rules: {},
          nextAllowedAtMs: 0,
        },
      });

      const snapshots: any[] = [];
      const unsubscribe = controller.subscribe((s) => {
        snapshots.push(s);
      });

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toEqual(initialSnapshot);
      unsubscribe();
    });

    it('publishes updated snapshot on add, ws status change, and remove', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const snapshots: any[] = [];
      const unsubscribe = controller.subscribe((s) => {
        snapshots.push(s);
      });

      // 1. Initial snapshot
      expect(snapshots).toHaveLength(1);

      // 2. Add valid subscription
      const addOutcome = await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/test-search-1',
        { name: 'Test Search' },
      );
      expect(addOutcome.success).toBe(true);

      // snapshot updated with connecting subscription
      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      const latestAfterAdd = snapshots[snapshots.length - 1];
      expect(latestAfterAdd.subscriptions).toHaveLength(1);
      expect(latestAfterAdd.subscriptions[0].status).toBe('connecting');
      expect(latestAfterAdd.subscriptions[0].name).toBe('Test Search');
      expect(latestAfterAdd.runtimeLeague).toBe('standard');

      // 3. Trigger WebSocket open -> status active
      const ws = createdSockets[0];
      expect(ws).toBeDefined();
      ws.triggerOpen();

      const latestAfterOpen = snapshots[snapshots.length - 1];
      expect(latestAfterOpen.subscriptions[0].status).toBe('active');

      // 4. Trigger WebSocket error -> status reconnecting
      ws.triggerError('Network connection lost');
      const latestAfterError = snapshots[snapshots.length - 1];
      expect(latestAfterError.subscriptions[0].status).toBe('reconnecting');
      expect(latestAfterError.subscriptions[0].errorMessage).toBe('Network connection lost');

      // 5. Remove subscription
      const subId = latestAfterError.subscriptions[0].id;
      controller.remove(subId);

      const latestAfterRemove = snapshots[snapshots.length - 1];
      expect(latestAfterRemove.subscriptions).toHaveLength(0);

      // 6. Unsubscribe -> no more updates received
      const countBeforeUnsub = snapshots.length;
      unsubscribe();

      await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/test-search-2',
      );
      expect(snapshots.length).toBe(countBeforeUnsub);
    });

    it('isolates listener exception and does not break runtime or other listeners', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const goodReceived: any[] = [];

      const badListener = vi.fn(() => {
        throw new Error('Exploding UI listener');
      });
      const goodListener = vi.fn((s) => {
        goodReceived.push(s);
      });

      const unsubBad = controller.subscribe(badListener);
      const unsubGood = controller.subscribe(goodListener);

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();

      // Trigger mutation
      await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/test-search-1',
      );

      expect(goodReceived.length).toBeGreaterThanOrEqual(2);
      expect(runtime.isDisposed()).toBe(false);

      unsubBad();
      unsubGood();
    });
  });

  describe('Canonical addFromUrl Behavior & Edge Cases', () => {
    it('uses canonical domain factory to create subscription with unique ID', async () => {
      const controller = createLiveSearchPrimaryController(runtime);

      const outcome = await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/abc12345/live',
        { name: 'Custom Name', sourceBookmarkId: 'bmk_999' },
      );

      expect(outcome.success).toBe(true);
      const snapshot = controller.read();
      expect(snapshot.subscriptions).toHaveLength(1);
      const sub = snapshot.subscriptions[0];
      expect(sub.searchId).toBe('abc12345');
      expect(sub.league.toLowerCase()).toBe('standard');
      expect(sub.url).toBe('https://www.pathofexile.com/trade/search/Standard/abc12345');
      expect(sub.name).toBe('Custom Name');
      expect(sub.sourceBookmarkId).toBe('bmk_999');
      expect(sub.id).not.toBe('bmk_999');
      expect(sub.id.startsWith('sub_')).toBe(true);
    });

    it('rejects invalid Trade URL with zero Host side effect and zero WebSocket', async () => {
      const controller = createLiveSearchPrimaryController(runtime);

      const outcome1 = await controller.addFromUrl('');
      expect(outcome1.success).toBe(false);
      expect(outcome1.error).toContain('有效');

      const outcome2 = await controller.addFromUrl('https://google.com/search');
      expect(outcome2.success).toBe(false);
      expect(outcome2.error).toContain('無效');

      const outcome3 = await controller.addFromUrl('https://www.pathofexile.com/trade');
      expect(outcome3.success).toBe(false);

      expect(hostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);
      expect(fetchClient).not.toHaveBeenCalled();
      expect(controller.read().subscriptions).toHaveLength(0);
    });

    it('rejects game version mismatch before creating WebSocket', async () => {
      // runtime is poe1
      const controller = createLiveSearchPrimaryController(runtime);

      const outcome = await controller.addFromUrl(
        'https://www.pathofexile.com/trade2/search/poe2/Standard/poe2search1',
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('Game version mismatch');
      expect(createdSockets).toHaveLength(0);
      expect(controller.read().subscriptions).toHaveLength(0);
    });

    it('rejects league mismatch when runtime league is already locked', async () => {
      const controller = createLiveSearchPrimaryController(runtime);

      // Lock league to Standard
      const outcome1 = await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/search-std',
      );
      expect(outcome1.success).toBe(true);
      expect(createdSockets).toHaveLength(1);

      // Try adding Hardcore
      const outcome2 = await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Hardcore/search-hc',
      );
      expect(outcome2.success).toBe(false);
      expect(outcome2.error).toContain('League mismatch');
      expect(createdSockets).toHaveLength(1); // No new WS created
      expect(controller.read().subscriptions).toHaveLength(1);
    });

    it('delegates retry() to runtime and only succeeds on terminal error state', async () => {
      // 設置只有 0 次重試 (即第一次失敗即 terminal error)
      const fastFailRuntime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory,
        fetchClient: fetchClient as unknown as (
          url: string,
          init?: RequestInit,
        ) => Promise<Response>,
        openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
        reconnectPolicy: { maxFailedAttempts: 0 },
      });
      const controller = createLiveSearchPrimaryController(fastFailRuntime);

      await controller.addFromUrl('https://www.pathofexile.com/trade/search/Standard/retry-search');
      const subId = controller.read().subscriptions[0].id;

      // 仍在 connecting/active 時，不允許 retry
      const prematureRetry = controller.retry(subId);
      expect(prematureRetry.success).toBe(false);

      // 觸發連線失敗 -> 進入 terminal error
      const ws = createdSockets[createdSockets.length - 1];
      ws.triggerClose();
      expect(controller.read().subscriptions[0].status).toBe('error');

      // 手動 Retry
      const validRetry = controller.retry(subId);
      expect(validRetry.success).toBe(true);
      expect(controller.read().subscriptions[0].status).toBe('connecting');
      expect(controller.read().subscriptions[0].id).toBe(subId); // 保持同一 id
    });
  });
});
