// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoeVersion } from '@/utils/trade-context';
import {
  createLiveSearchSubscriptionFromUrl,
  type LiveSearchSubscription,
} from '@/utils/live-search-contract';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import {
  LiveSearchHostClient,
  type EnsureContainerOptions,
  type HostCommandOutcome,
  type ILiveSearchHostClient,
  type RenderResultOptions,
  type ResetUnreadOptions,
} from '@/entrypoints/content/logic/live-search-host-client';
import { dispatchPoeEvent, initPoeEventNonce, listenPoeEvent } from '@/utils/event-contracts';
import {
  parsePoeLiveSearchRenderResult,
  serializePoeLiveSearchCommandResult,
} from '@/utils/event-protocol-types';

// -------------------------------------------------------------
// Mock / Fake 基礎設施
// -------------------------------------------------------------

class FakeWebSocket {
  public url: string;
  public onopen: ((ev: Event) => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;
  public onclose: ((ev: CloseEvent) => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public readyState = 0; // CONNECTING
  public closed = false;

  constructor(url: string) {
    this.url = url;
    // 預設下一個 microtask 自動觸發 open
    queueMicrotask(() => {
      if (!this.closed && this.onopen) {
        this.readyState = 1; // OPEN
        this.onopen(new Event('open'));
      }
    });
  }

  public simulateMessage(data: string) {
    if (this.onmessage && !this.closed) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  public simulateError(err: Error = new Error('Socket error')) {
    if (this.onerror && !this.closed) {
      this.onerror(new Event('error'));
    }
  }

  public close() {
    this.closed = true;
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }
}

class FakeHostClient implements ILiveSearchHostClient {
  public ensureCalls: EnsureContainerOptions[] = [];
  public renderCalls: RenderResultOptions[] = [];
  public resetUnreadCalls: ResetUnreadOptions[] = [];
  public ensureOutcome: HostCommandOutcome = { success: true };
  public renderOutcome: HostCommandOutcome = { success: true };
  public ensureDelayMs = 0;
  public disposed = false;
  public ensureHandler: ((options: EnsureContainerOptions) => Promise<HostCommandOutcome>) | null =
    null;

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    this.ensureCalls.push(options);
    if (this.ensureHandler) {
      return this.ensureHandler(options);
    }
    if (this.ensureDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.ensureDelayMs));
    }
    return this.ensureOutcome;
  }

  public async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    this.renderCalls.push(options);
    return this.renderOutcome;
  }

  public async resetUnread(options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    this.resetUnreadCalls.push(options);
    return { success: true };
  }

  public dispose(): void {
    this.disposed = true;
  }
}

// -------------------------------------------------------------
// 測試主體
// -------------------------------------------------------------

describe('LiveSearch Primary Runtime & Subscription Pipeline', () => {
  let fakeHostClient: FakeHostClient;
  let createdSockets: FakeWebSocket[];
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;
  let fetchResponses: Map<string, { ok: boolean; status: number; body: unknown }>;
  let customFetchHandler: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

  beforeEach(() => {
    fakeHostClient = new FakeHostClient();
    createdSockets = [];
    fetchCalls = [];
    fetchResponses = new Map();
    customFetchHandler = null;
  });

  const createFakeWebSocket = (url: string) => {
    const ws = new FakeWebSocket(url);
    createdSockets.push(ws);
    return ws as unknown as WebSocket;
  };

  const createFakeFetch = async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    if (customFetchHandler) {
      return customFetchHandler(url, init);
    }
    const configured = fetchResponses.get(url);
    if (configured) {
      return {
        ok: configured.ok,
        status: configured.status,
        json: async () => configured.body,
      } as Response;
    }
    // 預設成功回傳 mock item
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: [{ id: 'item_data_123', item: { name: 'Mageblood' } }],
      }),
    } as Response;
  };

  const createRuntime = (
    gameVersion: PoeVersion = 'poe1',
    options?: { displayLocalId?: string; origin?: string },
  ) => {
    return new LiveSearchPrimaryRuntime(gameVersion, {
      hostClient: fakeHostClient,
      webSocketFactory: createFakeWebSocket,
      fetchClient: createFakeFetch,
      origin: options?.origin || 'https://www.pathofexile.com',
      displayLocalId: options?.displayLocalId || 'poexd_live_display',
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });
  };

  const createSubFixture = (
    overrides?: Partial<LiveSearchSubscription>,
  ): LiveSearchSubscription => {
    const version = overrides?.gameVersion || 'poe1';
    const league = overrides?.league || 'Settlers';
    const searchId = overrides?.searchId || 'search_default';
    const url =
      overrides?.url ||
      (version === 'poe2'
        ? `https://www.pathofexile.com/trade2/search/poe2/${league}/${searchId}`
        : `https://www.pathofexile.com/trade/search/${league}/${searchId}`);

    return {
      id: overrides?.id || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      gameVersion: version,
      league,
      searchId,
      url,
      name: overrides?.name,
      sourceBookmarkId: overrides?.sourceBookmarkId,
      status: 'idle',
      createdAt: Date.now(),
      ...overrides,
    };
  };

  // -----------------------------------------------------------
  // 1. Subscription Canonical Identity 與 Factory 測試
  // -----------------------------------------------------------
  describe('Subscription Canonical Identity & createLiveSearchSubscriptionFromUrl', () => {
    it('能正確解析 PoE 1 搜尋網址，保留 canonical url 與 name，且 subscription id 絕不等於 sourceBookmarkId', () => {
      const url = 'https://www.pathofexile.com/trade/search/Settlers/abc1234';
      const bookmarkId = 'bm_001';
      const sub = createLiveSearchSubscriptionFromUrl(url, {
        sourceBookmarkId: bookmarkId,
        name: 'Settlers Boots',
      });

      expect(sub).toBeDefined();
      expect(sub!.gameVersion).toBe('poe1');
      expect(sub!.league).toBe('settlers');
      expect(sub!.searchId).toBe('abc1234');
      expect(sub!.url).toBe('https://www.pathofexile.com/trade/search/Settlers/abc1234');
      expect(sub!.name).toBe('Settlers Boots');
      expect(sub!.sourceBookmarkId).toBe(bookmarkId);
      // 驗證無 escape hatch，id 絕不等於 bookmarkId
      expect(sub!.id).not.toBe(bookmarkId);
      expect(sub!.id.startsWith('sub_')).toBe(true);
      expect(sub!.status).toBe('idle');
    });

    it('能正確解析 PoE 2 搜尋網址並生成 canonical url', () => {
      const url = 'https://www.pathofexile.com/trade2/search/poe2/Standard/xyz987';
      const sub = createLiveSearchSubscriptionFromUrl(url);

      expect(sub).toBeDefined();
      expect(sub!.gameVersion).toBe('poe2');
      expect(sub!.league).toBe('standard');
      expect(sub!.searchId).toBe('xyz987');
      expect(sub!.url).toBe('https://www.pathofexile.com/trade2/search/poe2/Standard/xyz987');
      expect(sub!.sourceBookmarkId).toBeUndefined();
    });

    it('若 URL 包含可解析的 /live suffix，依既有 trade URL helper 規則正規化解析', () => {
      const urlWithLive = 'https://www.pathofexile.com/trade/search/Settlers/live123/live';
      const sub = createLiveSearchSubscriptionFromUrl(urlWithLive);

      expect(sub).toBeDefined();
      expect(sub!.gameVersion).toBe('poe1');
      expect(sub!.league).toBe('settlers');
      expect(sub!.searchId).toBe('live123');
      // canonical url 應為移除 /live 後的乾淨網址
      expect(sub!.url).toBe('https://www.pathofexile.com/trade/search/Settlers/live123');
    });

    it('遇非 Trade 網址或無 searchId（例如純 /live 結尾無 searchId）應安全回傳 undefined', () => {
      expect(createLiveSearchSubscriptionFromUrl('https://example.com/test')).toBeUndefined();
      expect(
        createLiveSearchSubscriptionFromUrl(
          'https://www.pathofexile.com/trade/search/Settlers/live',
        ),
      ).toBeUndefined();
      expect(
        createLiveSearchSubscriptionFromUrl('https://www.pathofexile.com/trade/search/Settlers'),
      ).toBeUndefined();
    });

    it('regression: sourceBookmarkId = "bookmark-1" 時，subscription.id !== "bookmark-1"，零 customId escape hatch', () => {
      const url = 'https://www.pathofexile.com/trade/search/Settlers/test_search';
      const sub = createLiveSearchSubscriptionFromUrl(url, {
        sourceBookmarkId: 'bookmark-1',
      });
      expect(sub).toBeDefined();
      expect(sub!.sourceBookmarkId).toBe('bookmark-1');
      expect(sub!.id).not.toBe('bookmark-1');
    });
  });

  // -----------------------------------------------------------
  // 2. Runtime Subscription Identity Boundary & Integrity Enforcement
  // -----------------------------------------------------------
  describe('Runtime Subscription Identity Boundary & Integrity Enforcement', () => {
    it('url 與 subscription.searchId 不符時拒絕加入且 zero Host/network side effect', async () => {
      const runtime = createRuntime('poe1');
      const sub = createSubFixture({
        url: 'https://www.pathofexile.com/trade/search/Settlers/search_A',
        searchId: 'search_B',
        league: 'Settlers',
        gameVersion: 'poe1',
      });
      const res = await runtime.addSubscription(sub);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Canonical identity mismatch');
      expect(fakeHostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);
      expect(runtime.getRuntimeLeague()).toBeNull();
    });

    it('url 與 subscription.league 不符時拒絕加入且 zero Host/network side effect', async () => {
      const runtime = createRuntime('poe1');
      const sub = createSubFixture({
        url: 'https://www.pathofexile.com/trade/search/Settlers/search_1',
        searchId: 'search_1',
        league: 'Standard',
        gameVersion: 'poe1',
      });
      const res = await runtime.addSubscription(sub);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Canonical identity mismatch');
      expect(fakeHostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);
      expect(runtime.getRuntimeLeague()).toBeNull();
    });

    it('url (PoE1) 與 subscription.gameVersion (PoE2) 不符時拒絕加入', async () => {
      const runtime = createRuntime('poe2');
      const sub = createSubFixture({
        url: 'https://www.pathofexile.com/trade/search/Settlers/search_1', // PoE 1 url
        searchId: 'search_1',
        league: 'Settlers',
        gameVersion: 'poe2', // subscription declares PoE 2
      });
      const res = await runtime.addSubscription(sub);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Canonical identity mismatch');
      expect(fakeHostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);
    });

    it('subscription.id 等於 sourceBookmarkId 時拒絕加入', async () => {
      const runtime = createRuntime('poe1');
      const bookmarkId = 'bm_exact_same';
      const sub = createSubFixture({
        id: bookmarkId,
        sourceBookmarkId: bookmarkId,
        url: 'https://www.pathofexile.com/trade/search/Settlers/search_1',
        searchId: 'search_1',
        league: 'Settlers',
        gameVersion: 'poe1',
      });
      const res = await runtime.addSubscription(sub);
      expect(res.success).toBe(false);
      expect(res.error).toContain('cannot equal sourceBookmarkId');
      expect(fakeHostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);
    });

    it('由 createLiveSearchSubscriptionFromUrl 建立的 canonical subscription 能順利加入 runtime', async () => {
      const runtime = createRuntime('poe1');
      const sub = createLiveSearchSubscriptionFromUrl(
        'https://www.pathofexile.com/trade/search/Settlers/search_factory',
        { sourceBookmarkId: 'bm_different', name: 'My Boots' },
      )!;
      expect(sub).toBeDefined();
      const res = await runtime.addSubscription(sub);
      expect(res.success).toBe(true);
      expect(fakeHostClient.ensureCalls).toHaveLength(1);
      expect(createdSockets).toHaveLength(1);
      expect(runtime.getSubscriptions()).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------
  // 2. Primary Page gameVersion Authority & Immutable Scope
  // -----------------------------------------------------------
  describe('Primary Page gameVersion Authority & Immutable Scope', () => {
    it('PoE 2 Primary Runtime 加入 PoE 1 subscription 應直接拒絕且 zero ensure / zero WebSocket', async () => {
      const runtime = createRuntime('poe2');
      expect(runtime.getRuntimeGameVersion()).toBe('poe2');

      const poe1Sub = createSubFixture({
        id: 'sub_poe1',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_1',
      });

      const res = await runtime.addSubscription(poe1Sub);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Game version mismatch');
      expect(fakeHostClient.ensureCalls).toHaveLength(0); // 嚴格 zero ensure
      expect(createdSockets).toHaveLength(0); // 嚴格 zero WebSocket
      expect(runtime.getRuntimeLeague()).toBeNull(); // 零副作用
    });

    it('PoE 1 Primary Runtime 加入 PoE 2 subscription 應直接拒絕且 zero ensure / zero WebSocket', async () => {
      const runtime = createRuntime('poe1');
      expect(runtime.getRuntimeGameVersion()).toBe('poe1');

      const poe2Sub = createSubFixture({
        id: 'sub_poe2',
        gameVersion: 'poe2',
        league: 'Standard',
        searchId: 'search_poe2',
      });

      const res = await runtime.addSubscription(poe2Sub);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Game version mismatch');
      expect(fakeHostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);
      expect(runtime.getRuntimeLeague()).toBeNull();
    });
  });

  // -----------------------------------------------------------
  // 3. League Scope Retention across Subscription Lifecycle
  // -----------------------------------------------------------
  describe('League Scope Retention across Subscription Lifecycle', () => {
    it('第一個 subscription 鎖定 league，且即使移除最後 subscription，league scope 仍保留到 teardown', async () => {
      const runtime = createRuntime('poe1');
      const sub1 = createSubFixture({
        id: 'sub_1',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_1',
      });

      // 1. 成功鎖定 Settlers
      const res1 = await runtime.addSubscription(sub1);
      expect(res1.success).toBe(true);
      expect(runtime.getRuntimeLeague()).toBe('settlers');
      expect(fakeHostClient.ensureCalls).toHaveLength(1);

      // 2. 移除最後一個 subscription
      runtime.removeSubscription('sub_1');
      expect(runtime.getSubscriptions()).toHaveLength(0);
      // 依據契約：Host container 仍保留，runtimeLeague 不得被 reset
      expect(runtime.getRuntimeLeague()).toBe('settlers');

      // 3. 嘗試加入不同 league (Standard) -> 被拒絕
      const subStandard = createSubFixture({
        id: 'sub_std',
        gameVersion: 'poe1',
        league: 'Standard',
        searchId: 'search_std',
      });
      const resStd = await runtime.addSubscription(subStandard);
      expect(resStd.success).toBe(false);
      expect(resStd.error).toContain("League mismatch: runtime locked to 'settlers'");

      // 4. 重新加入同 league (Settlers) -> 成功加入且不再重複 ensure
      const subSettlersAgain = createSubFixture({
        id: 'sub_settlers_2',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_2',
      });
      const resSettlersAgain = await runtime.addSubscription(subSettlersAgain);
      expect(resSettlersAgain.success).toBe(true);
      expect(fakeHostClient.ensureCalls).toHaveLength(1); // 零重複 ensure
      expect(createdSockets).toHaveLength(2); // 成功建立新 WebSocket
    });

    it('teardownAllSubscriptions 終止所有連線、清空 subscriptions 並解除 runtimeLeague 鎖定，允許新聯盟重新鎖定', async () => {
      const runtime = createRuntime('poe1');
      const sub1 = createSubFixture({
        id: 'sub_settlers_1',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_1',
      });
      await runtime.addSubscription(sub1);
      expect(runtime.getRuntimeLeague()).toBe('settlers');
      expect(createdSockets[0].closed).toBe(false);

      // 執行 teardownAllSubscriptions
      await runtime.teardownAllSubscriptions();

      expect(createdSockets[0].closed).toBe(true);
      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(runtime.getRuntimeLeague()).toBeNull();

      // 現在能成功加入 Hardcore 並鎖定為 hardcore
      const subHc = createSubFixture({
        id: 'sub_hc_1',
        gameVersion: 'poe1',
        league: 'Hardcore',
        searchId: 'search_hc',
      });
      const resHc = await runtime.addSubscription(subHc);
      expect(resHc.success).toBe(true);
      expect(runtime.getRuntimeLeague()).toBe('hardcore');
      expect(runtime.getSubscriptions()).toHaveLength(1);

      // 驗證 Hardcore 第一筆訂閱正確通知 Host Client 建立/重新綁定 Hardcore 容器
      const lastEnsure = fakeHostClient.ensureCalls[fakeHostClient.ensureCalls.length - 1];
      expect(lastEnsure.league).toBe('Hardcore');
    });
  });

  // -----------------------------------------------------------
  // 4. Concurrency-safe First Subscription Initialization
  // -----------------------------------------------------------
  describe('Concurrency-safe First Subscription Initialization', () => {
    it('同 league concurrent add：ensureContainer 僅執行一次，兩個 subscription 均成功加入', async () => {
      fakeHostClient.ensureDelayMs = 20; // 模擬真實非同步延遲
      const runtime = createRuntime('poe1');

      const sub1 = createSubFixture({
        id: 'sub_concurrent_1',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_c1',
      });
      const sub2 = createSubFixture({
        id: 'sub_concurrent_2',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_c2',
      });

      const [res1, res2] = await Promise.all([
        runtime.addSubscription(sub1),
        runtime.addSubscription(sub2),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(fakeHostClient.ensureCalls).toHaveLength(1); // 確保原子初始化
      expect(runtime.getSubscriptions()).toHaveLength(2);
      expect(createdSockets).toHaveLength(2);
    });

    it('不同 league concurrent add：只有 canonical scope 成功，另一個明確 failure 且不可混入', async () => {
      fakeHostClient.ensureDelayMs = 20;
      const runtime = createRuntime('poe1');

      const subSettlers = createSubFixture({
        id: 'sub_settlers',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_settlers',
      });
      const subStandard = createSubFixture({
        id: 'sub_standard',
        gameVersion: 'poe1',
        league: 'Standard',
        searchId: 'search_standard',
      });

      const [res1, res2] = await Promise.all([
        runtime.addSubscription(subSettlers),
        runtime.addSubscription(subStandard),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('League mismatch');
      expect(runtime.getSubscriptions()).toHaveLength(1);
      expect(runtime.getSubscriptions()[0].id).toBe('sub_settlers');
    });
  });

  // -----------------------------------------------------------
  // 5. Runtime Readonly Snapshot 防護測試
  // -----------------------------------------------------------
  describe('Runtime Readonly Snapshot Protection', () => {
    it('getSubscription 與 getSubscriptions 回傳 readonly snapshot，外部修改不影響內部實體與 pipeline', async () => {
      const runtime = createRuntime('poe1');
      const originalSub = createSubFixture({
        id: 'sub_orig',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_immutable',
      });

      await runtime.addSubscription(originalSub);

      const view = runtime.getSubscription('sub_orig');
      expect(view).toBeDefined();

      // 模擬外部惡意直接修改取得之 snapshot 屬性
      (view as any).searchId = 'tampered_search_id';
      (view as any).league = 'tampered_league';
      (view as any).gameVersion = 'poe2';
      (view as any).url = 'https://hacked.com';

      // 再次取得，內部狀態依然原封不動
      const freshView = runtime.getSubscription('sub_orig')!;
      expect(freshView.searchId).toBe('search_immutable');
      expect(freshView.league).toBe('Settlers');
      expect(freshView.gameVersion).toBe('poe1');
      expect(freshView.url).toContain('/search/Settlers/search_immutable');

      // 收到 WebSocket 訊息後，PoeXD /fetch 仍必須使用原本未被污染的 searchId
      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ result: 'token_snap_test', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toContain('/fetch/token_snap_test?query=search_immutable');
      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(fakeHostClient.renderCalls[0].sourceSearchId).toBe('search_immutable');
    });
  });

  // -----------------------------------------------------------
  // 5B. Boundary Snapshot 與 Mutable-Input Race 防護測試
  // -----------------------------------------------------------
  describe('Mutable-Input Race & Boundary Snapshot Protection', () => {
    it('Mutex 前 caller mutation 不影響加入的 subscription identity、WebSocket URL 與 /fetch query', async () => {
      const runtime = createRuntime('poe1');
      const sub = createSubFixture({
        id: 'sub_race_1',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_race_1',
        url: 'https://www.pathofexile.com/trade/search/Settlers/search_race_1',
      });

      // 啟動 addSubscription
      const promise = runtime.addSubscription(sub);

      // Caller 立即在同一個 microtask / mutex 前篡改原始物件
      sub.searchId = 'tampered_search';
      sub.league = 'Standard';
      sub.url = 'https://www.pathofexile.com/trade/search/Standard/tampered_search';
      sub.id = 'tampered_id';

      const result = await promise;
      expect(result.success).toBe(true);

      // 驗證真正加入 runtime 的 identity 依然是原始 snapshot
      const active = runtime.getSubscription('sub_race_1');
      expect(active).toBeDefined();
      expect(active?.searchId).toBe('search_race_1');
      expect(active?.league).toBe('Settlers');
      expect(active?.url).toBe('https://www.pathofexile.com/trade/search/Settlers/search_race_1');

      // 驗證篡改的 id 不存在
      expect(runtime.getSubscription('tampered_id')).toBeUndefined();

      // 驗證 WebSocket URL 使用原本的 searchId 與 league
      expect(createdSockets).toHaveLength(1);
      expect(createdSockets[0].url).toBe(
        'wss://www.pathofexile.com/api/trade/live/Settlers/search_race_1',
      );

      // 模擬收訊，驗證 /fetch query 與 render 均使用原 searchId
      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ result: 'token_race_1', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toContain('/fetch/token_race_1?query=search_race_1');
      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(fakeHostClient.renderCalls[0].sourceSearchId).toBe('search_race_1');
    });

    it('ensureContainer deferred 期間 caller mutation 不影響 SubscriptionContext 與 WebSocket URL', async () => {
      let resolveEnsure!: (outcome: HostCommandOutcome) => void;
      fakeHostClient.ensureHandler = () =>
        new Promise((resolve) => {
          resolveEnsure = resolve;
        });

      const runtime = createRuntime('poe1');
      const sub = createSubFixture({
        id: 'sub_deferred',
        gameVersion: 'poe1',
        league: 'Settlers',
        searchId: 'search_deferred',
        url: 'https://www.pathofexile.com/trade/search/Settlers/search_deferred',
      });

      const promise = runtime.addSubscription(sub);
      await Promise.resolve();

      // 驗證 ensureContainer 正在 pending
      expect(fakeHostClient.ensureCalls).toHaveLength(1);
      expect(createdSockets).toHaveLength(0); // WS 尚未建立

      // 在 pending 期間篡改原始物件
      sub.searchId = 'deferred_tampered';
      sub.league = 'Standard';
      sub.url = 'https://www.pathofexile.com/trade/search/Standard/deferred_tampered';
      sub.id = 'tampered_deferred_id';

      // 放行 ensureContainer
      resolveEnsure({ success: true });

      const result = await promise;
      expect(result.success).toBe(true);

      // 驗證 runtime 儲存與 WebSocket 使用 validation 時的 snapshot
      const active = runtime.getSubscription('sub_deferred');
      expect(active).toBeDefined();
      expect(active?.searchId).toBe('search_deferred');
      expect(active?.league).toBe('Settlers');

      expect(createdSockets).toHaveLength(1);
      expect(createdSockets[0].url).toBe(
        'wss://www.pathofexile.com/api/trade/live/Settlers/search_deferred',
      );

      // 模擬收訊驗證 pipeline
      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ result: 'token_def_1', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toContain('/fetch/token_def_1?query=search_deferred');
      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(fakeHostClient.renderCalls[0].sourceSearchId).toBe('search_deferred');
    });
  });

  // -----------------------------------------------------------
  // 6. 真實 WebSocket 協定 (Phase 2A SSOT) 與 WebSocket 連線
  // -----------------------------------------------------------
  describe('Phase 2A WebSocket Message Protocol & URL Assembly', () => {
    it('PoE 1 與 PoE 2 正確組裝官方 live WebSocket URL', async () => {
      const runtimePoE1 = createRuntime('poe1', { origin: 'https://www.pathofexile.com' });
      await runtimePoE1.addSubscription(
        createSubFixture({
          id: 'sub_p1',
          gameVersion: 'poe1',
          league: 'Settlers of Kalguur',
          searchId: 'search_abc',
        }),
      );

      const runtimePoE2 = createRuntime('poe2', { origin: 'https://www.pathofexile.com' });
      await runtimePoE2.addSubscription(
        createSubFixture({
          id: 'sub_p2',
          gameVersion: 'poe2',
          league: 'Standard',
          searchId: 'search_xyz',
        }),
      );

      expect(createdSockets[0].url).toBe(
        'wss://www.pathofexile.com/api/trade/live/Settlers%20of%20Kalguur/search_abc',
      );
      expect(createdSockets[1].url).toBe(
        'wss://www.pathofexile.com/api/trade2/live/poe2/Standard/search_xyz',
      );
    });

    it('官方認證訊息 {"auth": true} 必須忽略，zero fetch 與 zero render', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_auth_test',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_auth',
        }),
      );

      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ auth: true }));
      await new Promise((r) => setTimeout(r, 10));

      expect(fetchCalls).toHaveLength(0);
      expect(fakeHostClient.renderCalls).toHaveLength(0);
      expect(runtime.getCumulativeRenderedTotal()).toBe(0);
    });

    it('Phase 2A canonical 訊息 {"result": "<token>", "count": 1} 正確觸發 fetch 與 render', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_canonical',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_canon',
        }),
      );

      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ result: 'token_canonical_1', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toContain('/fetch/token_canonical_1?query=search_canon');
      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(fakeHostClient.renderCalls[0].token).toBe('token_canonical_1');
      expect(runtime.getCumulativeRenderedTotal()).toBe(1);
    });

    it('舊格式相容: {"new": "<token>"} 仍可正常處理', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_legacy',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_leg',
        }),
      );

      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ new: 'token_legacy_1' }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(fakeHostClient.renderCalls[0].token).toBe('token_legacy_1');
    });
  });

  // -----------------------------------------------------------
  // 7. Source-scoped Pending Token Dedup & In-Flight Protection
  // -----------------------------------------------------------
  describe('Source-scoped Pending Token Dedup & In-Flight Protection', () => {
    it('In-flight pending token 防護：同一 subscription 在 fetch 未返回前重複收到相同 token 只 fetch 一次', async () => {
      let resolveDeferredFetch!: (res: Response) => void;
      const deferredFetchPromise = new Promise<Response>((resolve) => {
        resolveDeferredFetch = resolve;
      });

      customFetchHandler = async () => deferredFetchPromise;

      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_inflight',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_inflight',
        }),
      );

      const ws = createdSockets[0];

      // 第一筆 token 到達，進入 fetch in-flight
      ws.simulateMessage(JSON.stringify({ result: 'token_dup', count: 1 }));
      await new Promise((r) => setTimeout(r, 5));

      expect(fetchCalls).toHaveLength(1);

      // 第一筆仍 in-flight 時，第二筆相同 token 到達
      ws.simulateMessage(JSON.stringify({ result: 'token_dup', count: 1 }));
      await new Promise((r) => setTimeout(r, 5));

      // 驗證第二筆被 pendingTokens 擋下，未重複 enqueue/fetch
      expect(fetchCalls).toHaveLength(1);

      // 放行第一筆 fetch
      resolveDeferredFetch({
        ok: true,
        status: 200,
        json: async () => ({ result: [{ name: 'Item' }] }),
      } as Response);

      await new Promise((r) => setTimeout(r, 15));

      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(runtime.getCumulativeRenderedTotal()).toBe(1);
    });

    it('Fetch 失敗時 pending 移除且不進 processed，允許未來再次重試', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_retry',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_retry',
        }),
      );

      const ws = createdSockets[0];

      // 1. 第一次 fetch 失敗 (500)
      fetchResponses.set(
        'https://www.pathofexile.com/api/trade/fetch/token_retry?query=search_retry',
        { ok: false, status: 500, body: {} },
      );

      ws.simulateMessage(JSON.stringify({ result: 'token_retry', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fakeHostClient.renderCalls).toHaveLength(0);
      expect(runtime.getCumulativeRenderedTotal()).toBe(0);

      // 2. 恢復網路正常，再次收到同一個 token
      fetchResponses.delete(
        'https://www.pathofexile.com/api/trade/fetch/token_retry?query=search_retry',
      );

      ws.simulateMessage(JSON.stringify({ result: 'token_retry', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      // 驗證重試成功發起第二筆 fetch 與 render
      expect(fetchCalls).toHaveLength(2);
      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(runtime.getCumulativeRenderedTotal()).toBe(1);
    });

    it('Source-scoped 獨立性：Sub A 與 Sub B 收到相同 token 各自獨立 fetch 與 render', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_A',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_A',
        }),
      );
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_B',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_B',
        }),
      );

      const wsA = createdSockets[0];
      const wsB = createdSockets[1];

      wsA.simulateMessage(JSON.stringify({ result: 'token_shared', count: 1 }));
      wsB.simulateMessage(JSON.stringify({ result: 'token_shared', count: 1 }));

      await new Promise((r) => setTimeout(r, 20));

      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0].url).toContain('/fetch/token_shared?query=search_A');
      expect(fetchCalls[1].url).toContain('/fetch/token_shared?query=search_B');
      expect(fakeHostClient.renderCalls).toHaveLength(2);
      expect(fakeHostClient.renderCalls[0].sourceSearchId).toBe('search_A');
      expect(fakeHostClient.renderCalls[1].sourceSearchId).toBe('search_B');
    });
  });

  // -----------------------------------------------------------
  // 8. Cumulative Total 與 失敗防護
  // -----------------------------------------------------------
  describe('Cumulative Rendered Total & Failure Safety', () => {
    it('成功時 total 遞增 (1, 2)，batchId 每次獨立', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_1',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_1',
        }),
      );

      const ws = createdSockets[0];

      ws.simulateMessage(JSON.stringify({ result: 'tk_1', count: 1 }));
      await new Promise((r) => setTimeout(r, 10));
      expect(runtime.getCumulativeRenderedTotal()).toBe(1);
      expect(fakeHostClient.renderCalls[0].total).toBe(1);

      ws.simulateMessage(JSON.stringify({ result: 'tk_2', count: 1 }));
      await new Promise((r) => setTimeout(r, 10));
      expect(runtime.getCumulativeRenderedTotal()).toBe(2);
      expect(fakeHostClient.renderCalls[1].total).toBe(2);

      expect(fakeHostClient.renderCalls[0].batchId).not.toBe(fakeHostClient.renderCalls[1].batchId);
    });

    it('Host Adapter render 失敗時：total 不累加且允許未來重試', async () => {
      fakeHostClient.renderOutcome = { success: false, error: 'Mutation failed' };
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_1',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_1',
        }),
      );

      const ws = createdSockets[0];

      ws.simulateMessage(JSON.stringify({ result: 'tk_render_fail', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fakeHostClient.renderCalls).toHaveLength(1);
      expect(runtime.getCumulativeRenderedTotal()).toBe(0);

      // 修復 host client，重發同一個 token，應能再次嘗試
      fakeHostClient.renderOutcome = { success: true };
      ws.simulateMessage(JSON.stringify({ result: 'tk_render_fail', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));

      expect(fakeHostClient.renderCalls).toHaveLength(2);
      expect(runtime.getCumulativeRenderedTotal()).toBe(1);
    });
  });

  // -----------------------------------------------------------
  // 9. Subscription 移除與 Runtime Dispose 生命週期
  // -----------------------------------------------------------
  describe('Subscription Removal & Runtime Lifecycle', () => {
    it('removeSubscription 能關閉對應 WebSocket 並從清單移除', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_1',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_1',
        }),
      );

      const ws = createdSockets[0];
      expect(ws.closed).toBe(false);

      runtime.removeSubscription('sub_1');
      expect(ws.closed).toBe(true);
      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(runtime.getRuntimeLeague()).toBe('settlers'); // 依契約：league scope 仍保留
    });

    it('[Regression] teardownAllSubscriptions 傳入 targetLeague 時，呼叫 hostClient.ensureContainer 並重置 cumulativeRenderedTotal 與 runtimeLeague', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_std',
          gameVersion: 'poe1',
          league: 'Standard',
          searchId: 'search_std',
        }),
      );

      // 模擬收到結果並成功 render
      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ result: 'token_rebind', count: 1 }));
      await new Promise((r) => setTimeout(r, 15));
      expect(runtime.getSnapshot().cumulativeRenderedTotal).toBe(1);

      // 執行 teardownAllSubscriptions 帶入 Hardcore
      await runtime.teardownAllSubscriptions({ targetLeague: 'Hardcore' });

      expect(runtime.getRuntimeLeague()).toBeNull();
      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(runtime.getSnapshot().cumulativeRenderedTotal).toBe(0);

      // 檢查 hostClient.ensureContainer 是否以 targetLeague='Hardcore' 與 resetResults=true 呼叫
      const lastEnsure = fakeHostClient.ensureCalls[fakeHostClient.ensureCalls.length - 1];
      expect(lastEnsure).toBeDefined();
      expect(lastEnsure.league).toBe('Hardcore');
      expect(lastEnsure.realm).toBe('pc');
      expect(lastEnsure.resetResults).toBe(true);
    });

    it('[Regression] teardownAllSubscriptions 當 hostClient.ensureContainer 失敗時拋出錯誤，不 silent ignore', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_std',
          gameVersion: 'poe1',
          league: 'Standard',
          searchId: 'search_std',
        }),
      );

      fakeHostClient.ensureOutcome = { success: false, error: 'Host bridge disconnected' };

      await expect(runtime.teardownAllSubscriptions({ targetLeague: 'Hardcore' })).rejects.toThrow(
        'Host bridge disconnected',
      );
    });

    it('[Regression] teardownAllSubscriptions 未傳入 targetLeague 時僅清空 Runtime 訂閱，不觸發 Host ensureContainer 亦不因 Host 失敗而拋錯', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_std',
          gameVersion: 'poe1',
          league: 'Standard',
          searchId: 'search_std',
        }),
      );
      expect(fakeHostClient.ensureCalls).toHaveLength(1);

      fakeHostClient.ensureOutcome = { success: false, error: 'Host bridge disconnected' };

      await expect(runtime.teardownAllSubscriptions()).resolves.toBeUndefined();
      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(runtime.getRuntimeLeague()).toBeNull();
      expect(fakeHostClient.ensureCalls).toHaveLength(1);
    });

    it('dispose() 會關閉所有連線、清空狀態並釋放 host client', async () => {
      const runtime = createRuntime('poe1');
      await runtime.addSubscription(
        createSubFixture({
          id: 'sub_1',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_1',
        }),
      );

      expect(createdSockets[0].closed).toBe(false);

      runtime.dispose();

      expect(runtime.isDisposed()).toBe(true);
      expect(createdSockets[0].closed).toBe(true);
      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(fakeHostClient.disposed).toBe(true);

      const res = await runtime.addSubscription(
        createSubFixture({
          id: 'sub_3',
          gameVersion: 'poe1',
          league: 'Settlers',
          searchId: 'search_3',
        }),
      );
      expect(res.success).toBe(false);
    });
  });

  // -----------------------------------------------------------
  // 10. LiveSearchHostClient Bridge 通訊協議與 Dispose 取消防護
  // -----------------------------------------------------------
  describe('LiveSearchHostClient Bridge Protocol & Dispose Cleanup', () => {
    const testNonce = 'nonce_host_client_test';

    beforeEach(() => {
      initPoeEventNonce(testNonce);
    });

    it('ensureContainer 發送正確事件並於收到配對 requestId 時 resolve', async () => {
      const client = new LiveSearchHostClient();
      let capturedPayload: any = null;

      const unsub = listenPoeEvent('poexd-livesearch-ensure-container', (payload) => {
        capturedPayload = payload;
        dispatchPoeEvent(
          'poexd-livesearch-command-result',
          serializePoeLiveSearchCommandResult({
            requestId: payload.requestId,
            command: 'ensure-container',
            success: true,
          }),
        );
      });

      const outcome = await client.ensureContainer({
        localId: 'display_123',
        league: 'Settlers',
        realm: 'pc',
      });

      unsub();
      client.dispose();

      expect(outcome.success).toBe(true);
      expect(capturedPayload.localId).toBe('display_123');
      expect(capturedPayload.league).toBe('Settlers');
      expect(capturedPayload.realm).toBe('pc');
    });

    it('renderResult 序列化 wireString 並於收到配對 requestId 時 resolve', async () => {
      const client = new LiveSearchHostClient();
      let capturedWireString: string | null = null;

      const unsub = listenPoeEvent('poexd-livesearch-render-result', (wireString) => {
        capturedWireString = wireString;
        const parsed = parsePoeLiveSearchRenderResult(wireString);
        dispatchPoeEvent(
          'poexd-livesearch-command-result',
          serializePoeLiveSearchCommandResult({
            requestId: parsed?.requestId,
            command: 'render-result',
            success: true,
          }),
        );
      });

      const outcome = await client.renderResult({
        localId: 'display_123',
        batchId: 'batch_abc',
        sourceSearchId: 'search_xyz',
        token: 'token_999',
        itemData: { name: 'Headhunter' },
        total: 5,
      });

      unsub();
      client.dispose();

      expect(outcome.success).toBe(true);
      const parsed = parsePoeLiveSearchRenderResult(capturedWireString);
      expect(parsed?.token).toBe('token_999');
      expect(parsed?.total).toBe(5);
    });

    it('dispose() 能立即取消 pending command，清除計時器且 Promise 立即結束不懸掛', async () => {
      const client = new LiveSearchHostClient();

      const pendingPromise = client.ensureContainer({
        localId: 'display_pending',
        league: 'Settlers',
        realm: 'pc',
        timeoutMs: 5000,
      });

      client.dispose();

      const outcome = await pendingPromise;
      expect(outcome.success).toBe(false);
      expect(outcome.error).toBe('Host client disposed');
    });

    it('逾時未收到回應時安全回傳 success: false 與逾時訊息', async () => {
      const client = new LiveSearchHostClient();

      const outcome = await client.ensureContainer({
        localId: 'display_timeout',
        league: 'Settlers',
        realm: 'pc',
        timeoutMs: 50,
      });

      client.dispose();

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('timed out');
    });
  });
});
