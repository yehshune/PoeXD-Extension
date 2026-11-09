import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradeSearchCanonicalKey,
  isSameTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import {
  createLiveSearchResultFilter,
  type LiveSearchResultFilter,
} from './live-search-result-filter';
import {
  validateSubscriptionIdentity,
  type LiveSearchSubscription,
  type AddSubscriptionOutcome,
  type LiveSearchRetryOutcome,
  type LiveSearchPrimaryViewSnapshot,
} from '@/utils/live-search-contract';
import {
  LiveSearchHostClient,
  type HostCommandOutcome,
  type ILiveSearchHostClient,
} from './live-search-host-client';
import {
  LiveSearchOpenScheduler,
  type ILiveSearchOpenScheduler,
} from './live-search-open-scheduler';
import {
  LiveSearchConnectionSession,
  type ILiveSearchConnectionSession,
  type LiveSearchConnectionSessionOptions,
  type LiveSearchConnectionSessionScheduler,
  type LiveSearchReconnectPolicy,
} from './live-search-connection-session';
import {
  LiveSearchFetchRateGate,
  type ILiveSearchFetchRateGate,
} from './live-search-fetch-rate-gate';

export interface LiveSearchPrimaryRuntimeOptions {
  hostClient?: ILiveSearchHostClient;
  webSocketFactory?: (url: string) => WebSocket;
  fetchClient?: (url: string, init?: RequestInit) => Promise<Response>;
  fetchRateGate?: ILiveSearchFetchRateGate;
  origin?: string;
  displayLocalId?: string;
  openScheduler?: ILiveSearchOpenScheduler;
  reconnectPolicy?: Partial<LiveSearchReconnectPolicy>;
  sessionFactory?: (options: LiveSearchConnectionSessionOptions) => ILiveSearchConnectionSession;
  scheduler?: LiveSearchConnectionSessionScheduler;
  random?: () => number;
  /** 結果展示區最多保留筆數（每次渲染時讀取，可隨偏好設定即時變更） */
  getMaxDisplayedResults?: () => number | undefined;
  resultFilter?: LiveSearchResultFilter;
}

/** 開發用假結果：僅經由 Host Adapter 渲染，不建立 WebSocket、不呼叫 /fetch。 */
export interface SyntheticLiveSearchResult {
  itemData: { id: string } & Record<string, unknown>;
  sourceSearchId: string;
  /** 結果所屬連線的 canonical key（供依連線篩選） */
  ownerKey: string;
}

export interface SyntheticRenderOutcome {
  rendered: number;
  failed: number;
  error?: string;
}

interface SubscriptionContext {
  subscription: LiveSearchSubscription;
  session: ILiveSearchConnectionSession;
  pendingTokens: Set<string>;
  processedTokens: Set<string>;
  activeCancelWait?: () => void;
}

interface PipelineTask {
  subCtx: SubscriptionContext;
  token: string;
}

export type { AddSubscriptionOutcome, LiveSearchRetryOutcome };

/**
 * LiveSearch Primary Page 內唯一的 LiveSearch Runtime Owner
 *
 * 核心權責 (依據 LiveSearch Primary Contract)：
 * 1. 唯一擁有並維護 Subscriptions 與 Connection Sessions
 * 2. 唯一擁有並透過 LiveSearchFetchRateGate 發起官方 HTTP /fetch (帶 query 與 X-Requested-With)
 * 3. 獨立 Source-Scoped Pending & Processed Token Dedup (各 subscription 獨立，跨 reconnect 保留，絕不搞全局 Set)
 * 4. 序列化 FIFO Pipeline 呼叫 Main World Host Adapter 進行原子渲染注入
 * 5. Cumulative Total 累計與失敗防護
 * 6. 首個 subscription 鎖定 runtime league 並保留至 page teardown，嚴格禁止不同 league 混入
 * 7. gameVersion 為 Runtime immutable authority
 * 8. 純記憶體生命週期，嚴格遵守 ADR-0004，無持久化儲存
 */
export class LiveSearchPrimaryRuntime {
  private readonly hostClient: ILiveSearchHostClient;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly fetchRateGate: ILiveSearchFetchRateGate;
  private readonly origin: string;
  private readonly displayLocalId: string;
  private readonly gameVersion: PoeVersion;
  private readonly openScheduler: ILiveSearchOpenScheduler;
  private readonly reconnectPolicy?: Partial<LiveSearchReconnectPolicy>;
  private readonly sessionFactory: (
    options: LiveSearchConnectionSessionOptions,
  ) => ILiveSearchConnectionSession;
  private readonly scheduler?: LiveSearchConnectionSessionScheduler;
  private readonly random?: () => number;
  private readonly getMaxDisplayedResults?: () => number | undefined;
  private readonly resultFilter: LiveSearchResultFilter;

  private runtimeLeague: string | null = null;
  private activeTargetLeague: string | null = null;
  private cumulativeRenderedTotal = 0;

  private subscriptions = new Map<string, SubscriptionContext>();
  private queue: PipelineTask[] = [];
  private isProcessingQueue = false;
  private addSubscriptionMutex: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private unsubRateGate: (() => void) | null = null;
  private listeners = new Set<(snapshot: Readonly<LiveSearchPrimaryViewSnapshot>) => void>();

  constructor(gameVersion: PoeVersion, options?: LiveSearchPrimaryRuntimeOptions) {
    this.gameVersion = gameVersion;
    this.hostClient = options?.hostClient ?? new LiveSearchHostClient();
    this.webSocketFactory =
      options?.webSocketFactory ??
      ((url: string) => {
        if (typeof WebSocket === 'undefined') {
          throw new Error('WebSocket is not supported in this environment');
        }
        return new WebSocket(url);
      });
    const fetchClient =
      options?.fetchClient ??
      ((url: string, init?: RequestInit) => {
        if (typeof fetch === 'undefined') {
          throw new Error('fetch is not supported in this environment');
        }
        return fetch(url, init);
      });
    this.fetchRateGate =
      options?.fetchRateGate ??
      new LiveSearchFetchRateGate({
        fetchClient,
      });
    this.unsubRateGate =
      this.fetchRateGate.subscribe?.(() => {
        if (!this.disposed) {
          this.notifyListeners();
        }
      }) ?? null;
    this.origin =
      options?.origin ??
      (typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://www.pathofexile.com');
    this.displayLocalId = options?.displayLocalId?.trim() || 'poexd_live_display';
    this.openScheduler = options?.openScheduler ?? new LiveSearchOpenScheduler();
    this.reconnectPolicy = options?.reconnectPolicy;
    this.sessionFactory =
      options?.sessionFactory ??
      ((sessionOptions) => new LiveSearchConnectionSession(sessionOptions));
    this.scheduler = options?.scheduler;
    this.random = options?.random;
    this.getMaxDisplayedResults = options?.getMaxDisplayedResults;
    this.resultFilter = options?.resultFilter ?? createLiveSearchResultFilter();
  }

  private readMaxDisplayedResults(): number | undefined {
    try {
      const value = this.getMaxDisplayedResults?.();
      return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private static readItemId(itemData: unknown): string | null {
    const id =
      itemData && typeof itemData === 'object' ? (itemData as { id?: unknown }).id : undefined;
    return typeof id === 'string' && id.trim() ? id : null;
  }

  /**
   * 單筆結果渲染交易：計算官方上方應顯示的筆數（實際保留數；篩選中為該連線筆數），
   * 交由 Host Adapter 渲染並淘汰超出上限的最舊結果，成功後登記結果歸屬。
   */
  private async renderIntoHost(input: {
    batchId: string;
    sourceSearchId: string;
    token: string;
    itemData: unknown;
    ownerKey: string;
  }): Promise<boolean> {
    const maxResults = this.readMaxDisplayedResults();
    const itemId = LiveSearchPrimaryRuntime.readItemId(input.itemData);
    const displayTotal = itemId
      ? this.resultFilter.projectDisplayTotal(input.token, input.ownerKey, maxResults)
      : this.resultFilter.displayTotal();
    const outcome = await this.hostClient.renderResult({
      localId: this.displayLocalId,
      batchId: input.batchId,
      sourceSearchId: input.sourceSearchId,
      token: input.token,
      itemData: input.itemData,
      total: displayTotal,
      maxResults,
    });
    if (!outcome.success) return false;
    this.cumulativeRenderedTotal += 1;
    if (itemId) this.resultFilter.record(itemId, input.ownerKey, maxResults, input.token);
    return true;
  }

  /** 將官方上方顯示的筆數同步為目前實際應顯示的數量。 */
  private syncHostDisplayTotal(): void {
    if (this.disposed || typeof this.hostClient.syncTotal !== 'function') return;
    void this.hostClient
      .syncTotal({ localId: this.displayLocalId, total: this.resultFilter.displayTotal() })
      .catch(() => {});
  }

  /** 僅顯示指定連線（canonical key）的結果；null 表示顯示全部。 */
  public setResultFilter(ownerKey: string | null): void {
    if (this.disposed) return;
    const next = typeof ownerKey === 'string' && ownerKey.trim() ? ownerKey.trim() : null;
    if (next === this.resultFilter.getFilter()) return;
    this.resultFilter.setFilter(next);
    this.syncHostDisplayTotal();
    this.notifyListeners();
  }

  public getResultFilter(): string | null {
    return this.resultFilter.getFilter();
  }

  public getRuntimeLeague(): string | null {
    return this.runtimeLeague;
  }

  public getRuntimeGameVersion(): PoeVersion {
    return this.gameVersion;
  }

  public getDisplayLocalId(): string {
    return this.displayLocalId;
  }

  public getCumulativeRenderedTotal(): number {
    return this.cumulativeRenderedTotal;
  }

  public getSubscriptions(): Readonly<LiveSearchSubscription>[] {
    return Array.from(this.subscriptions.values()).map((ctx) => ({ ...ctx.subscription }));
  }

  public getSubscription(id: string): Readonly<LiveSearchSubscription> | undefined {
    const ctx = this.subscriptions.get(id);
    return ctx ? { ...ctx.subscription } : undefined;
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  public getSnapshot(): Readonly<LiveSearchPrimaryViewSnapshot> {
    const resultFilterKey = this.resultFilter.getFilter();
    return {
      gameVersion: this.gameVersion,
      runtimeLeague: this.runtimeLeague,
      cumulativeRenderedTotal: this.cumulativeRenderedTotal,
      subscriptions: this.getSubscriptions(),
      rateLimit: this.fetchRateGate.getStateSnapshot(),
      ...(resultFilterKey ? { resultFilterKey } : {}),
    };
  }

  public subscribe(
    listener: (snapshot: Readonly<LiveSearchPrimaryViewSnapshot>) => void,
  ): () => void {
    if (this.disposed) {
      try {
        listener(this.getSnapshot());
      } catch (err) {
        console.error(
          '[PoeXD LiveSearch] Error in primary view listener on disposed subscribe:',
          err,
        );
      }
      return () => {};
    }

    this.listeners.add(listener);
    try {
      listener(this.getSnapshot());
    } catch (err) {
      console.error('[PoeXD LiveSearch] Error in primary view listener on initial subscribe:', err);
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[PoeXD LiveSearch] Error in primary view listener notification:', err);
      }
    }
  }

  /**
   * 新增並啟動 LiveSearch 訂閱
   * 包含前置權威版本檢查與並發安全序列化 (Mutex)
   */
  public async addSubscription(
    subscription: LiveSearchSubscription,
  ): Promise<AddSubscriptionOutcome> {
    if (this.disposed) {
      return { success: false, error: 'Runtime already disposed' };
    }

    if (!subscription || typeof subscription !== 'object') {
      return { success: false, error: 'Invalid subscription: id and searchId are required' };
    }

    // Boundary snapshot: 防止 caller 在 validation 或 async 執行期間 mutate 原始物件
    const candidate: LiveSearchSubscription = { ...subscription };

    if (!candidate.id?.trim() || !candidate.searchId?.trim()) {
      return { success: false, error: 'Invalid subscription: id and searchId are required' };
    }

    if (!candidate.league?.trim()) {
      return { success: false, error: 'Invalid subscription: league is required' };
    }

    // 1. Subscription canonical identity 完整性驗證 (URL vs fields, id vs sourceBookmarkId)
    const validation = validateSubscriptionIdentity(candidate);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Invalid subscription identity',
      };
    }

    // 2. 嚴格在 Host side effect 前拒絕版本不符
    if (candidate.gameVersion !== this.gameVersion) {
      return {
        success: false,
        error: `Game version mismatch: primary page runtime is locked to '${this.gameVersion}', but subscription requested '${candidate.gameVersion}'`,
      };
    }

    const next = this.addSubscriptionMutex.then(() => this.internalAddSubscription(candidate));
    this.addSubscriptionMutex = next.catch(() => {});
    return next;
  }

  private async internalAddSubscription(
    subscription: LiveSearchSubscription,
  ): Promise<AddSubscriptionOutcome> {
    if (this.disposed) {
      return { success: false, error: 'Runtime already disposed' };
    }

    const subLeague = subscription.league.trim().toLowerCase();

    if (this.subscriptions.has(subscription.id)) {
      return { success: false, error: `Subscription with id '${subscription.id}' already exists` };
    }

    // 0. Canonical Search Identity Duplicate 權威驗證：同一 Search Identity 在同一 Runtime 內最多只能存在一個 subscription
    for (const ctx of this.subscriptions.values()) {
      if (
        isSameTradeSearchIdentity(
          {
            gameVersion: ctx.subscription.gameVersion,
            league: ctx.subscription.league,
            searchId: ctx.subscription.searchId,
          },
          {
            gameVersion: subscription.gameVersion,
            league: subscription.league,
            searchId: subscription.searchId,
          },
        )
      ) {
        return {
          success: false,
          error: `Duplicate subscription: search '${subscription.searchId}' in league '${subscription.league}' is already active`,
        };
      }
    }

    // 1. Session Scope & League 鎖定檢查
    if (this.activeTargetLeague !== null && this.activeTargetLeague !== subLeague) {
      return {
        success: false,
        error: `League mismatch: runtime target league is '${this.activeTargetLeague}', but subscription requested '${subLeague}'`,
      };
    }

    if (this.runtimeLeague === null) {
      // 第一個 subscription 鎖定 runtime league
      const realm = this.gameVersion === 'poe2' ? 'poe2' : 'pc';
      const ensureResult = await this.hostClient.ensureContainer({
        localId: this.displayLocalId,
        league: subscription.league.trim(),
        realm,
      });

      if (!ensureResult.success) {
        return {
          success: false,
          error: `Failed to ensure display container on host: ${ensureResult.error || 'Unknown error'}`,
        };
      }

      this.runtimeLeague = subLeague;
    } else {
      // 驗證後續 subscription 必須 league 完全一致
      if (this.runtimeLeague !== subLeague) {
        return {
          success: false,
          error: `League mismatch: runtime locked to '${this.runtimeLeague}', but subscription requested '${subLeague}'`,
        };
      }
    }

    // 2. 建立專屬 Connection Session 與 SubscriptionContext
    const wsUrl = this.buildWebSocketUrl(
      subscription.gameVersion,
      subscription.league.trim(),
      subscription.searchId.trim(),
    );

    const subCtx: SubscriptionContext = {
      subscription: {
        ...subscription,
        league: subscription.league.trim(),
        status: 'connecting',
      },
      session: null as unknown as ILiveSearchConnectionSession,
      pendingTokens: new Set<string>(),
      processedTokens: new Set<string>(),
    };

    const session = this.sessionFactory({
      wsUrl,
      webSocketFactory: this.webSocketFactory,
      openScheduler: this.openScheduler,
      policy: this.reconnectPolicy,
      scheduler: this.scheduler,
      random: this.random,
      handlers: {
        onStatusChange: (status, metadata) => {
          subCtx.subscription.status = status;
          subCtx.subscription.errorMessage = metadata?.errorMessage;
          subCtx.subscription.reconnectInSeconds = metadata?.reconnectInSeconds;
          this.notifyListeners();
        },
        onToken: (token) => {
          this.handleReceivedToken(subCtx, token);
        },
      },
    });

    subCtx.session = session;
    this.subscriptions.set(subscription.id, subCtx);
    this.notifyListeners();

    // 3. 啟動 Connection Session (非同步進入 shared openScheduler)
    session.start();

    return { success: true };
  }

  /**
   * 手動重試已處於 terminal error 的訂閱項目
   * 嚴格保持同一 subscription entity, 同一 id, 同一 canonical identity 與同一 processedTokens
   */
  public retrySubscription(subscriptionId: string): LiveSearchRetryOutcome {
    if (this.disposed) {
      return { success: false, error: 'Runtime already disposed' };
    }

    const subCtx = this.subscriptions.get(subscriptionId);
    if (!subCtx) {
      return { success: false, error: `找不到訂閱項目: ${subscriptionId}` };
    }

    return subCtx.session.retry();
  }

  /**
   * 移除特定 subscription 並終止其連線 session
   * 注意：依據契約，即使 subscriptions 降為 0，已鎖定之 league scope 仍保留至 teardown
   */
  public removeSubscription(subscriptionId: string): void {
    const subCtx = this.subscriptions.get(subscriptionId);
    if (!subCtx) return;

    subCtx.subscription.status = 'closed';
    subCtx.activeCancelWait?.();
    subCtx.activeCancelWait = undefined;
    subCtx.pendingTokens.clear();
    subCtx.session.stop();
    this.subscriptions.delete(subscriptionId);
    this.notifyListeners();
  }

  /**
   * 系統性終止並清空目前 Runtime 的所有訂閱連線，並正式解除 runtimeLeague 鎖定
   * 用於 League Switch 領域操作，回到可由新聯盟首筆訂閱重新鎖定的純淨狀態
   */
  public async teardownAllSubscriptions(options?: { targetLeague?: string }): Promise<void> {
    if (this.disposed) return;

    const next = this.addSubscriptionMutex.then(async () => {
      if (this.disposed) return;

      for (const subCtx of this.subscriptions.values()) {
        subCtx.subscription.status = 'closed';
        subCtx.activeCancelWait?.();
        subCtx.activeCancelWait = undefined;
        subCtx.pendingTokens.clear();
        subCtx.session.stop();
      }
      this.subscriptions.clear();
      this.queue = [];
      this.runtimeLeague = null;
      this.cumulativeRenderedTotal = 0;
      this.resultFilter.setFilter(null);
      this.resultFilter.clear();
      this.notifyListeners();

      const targetLeague = options?.targetLeague?.trim();
      if (targetLeague) {
        const realm = this.gameVersion === 'poe2' ? 'poe2' : 'pc';
        const ensureResult = await this.hostClient.ensureContainer({
          localId: this.displayLocalId,
          league: targetLeague,
          realm,
          resetResults: true,
        });
        if (!ensureResult.success) {
          throw new Error(
            `Failed to reset display container on host: ${ensureResult.error || 'Unknown error'}`,
          );
        }
        this.activeTargetLeague = targetLeague.toLowerCase();
      }
    });
    this.addSubscriptionMutex = next.catch(() => {});
    return next;
  }

  /**
   * 開發測試用：直接以假資料呼叫 Host Adapter 渲染，驗證官方展示區在大量結果下的表現。
   * 絕不建立 WebSocket、不呼叫 /fetch；與真實結果共用同一條 render 序列語意（逐筆提交）。
   */
  public async renderSyntheticResults(
    league: string,
    items: readonly SyntheticLiveSearchResult[],
  ): Promise<SyntheticRenderOutcome> {
    if (this.disposed) return { rendered: 0, failed: items.length, error: 'Runtime disposed' };
    const targetLeague = league.trim();
    if (!targetLeague) return { rendered: 0, failed: items.length, error: 'League required' };
    if (this.runtimeLeague === null && this.activeTargetLeague === null) {
      const ensureResult = await this.hostClient.ensureContainer({
        localId: this.displayLocalId,
        league: targetLeague,
        realm: this.gameVersion === 'poe2' ? 'poe2' : 'pc',
      });
      if (!ensureResult.success) {
        return { rendered: 0, failed: items.length, error: ensureResult.error };
      }
    }
    let rendered = 0;
    let failed = 0;
    for (const item of items) {
      if (this.disposed) break;
      try {
        const ok = await this.renderIntoHost({
          batchId: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          sourceSearchId: item.sourceSearchId,
          token: `dev_${item.itemData.id}`,
          itemData: item.itemData,
          ownerKey: item.ownerKey,
        });
        if (!ok) {
          failed++;
          continue;
        }
        rendered++;
      } catch {
        failed++;
      }
    }
    this.notifyListeners();
    return { rendered, failed };
  }

  /**
   * 重置未讀計數提示
   */
  public async resetUnread(): Promise<HostCommandOutcome> {
    if (this.disposed) {
      return { success: false, error: 'Runtime already disposed' };
    }
    return this.hostClient.resetUnread({ localId: this.displayLocalId });
  }

  /**
   * 釋放 Runtime 所有資源 (WebSockets, Queue, RateGate, Subscriptions)
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubRateGate?.();
    this.unsubRateGate = null;
    this.openScheduler.dispose();
    this.fetchRateGate.dispose();

    for (const subCtx of this.subscriptions.values()) {
      subCtx.subscription.status = 'closed';
      subCtx.activeCancelWait?.();
      subCtx.activeCancelWait = undefined;
      subCtx.pendingTokens.clear();
      subCtx.session.dispose();
    }
    this.subscriptions.clear();
    this.queue = [];
    this.resultFilter.dispose();
    this.hostClient.dispose();
    this.notifyListeners();
    this.listeners.clear();
  }

  /**
   * 處理 Connection Session 交付之 Token
   * 執行 Source-Scoped Dedup (pendingTokens, processedTokens)
   */
  private handleReceivedToken(subCtx: SubscriptionContext, token: string): void {
    if (this.disposed || subCtx.subscription.status === 'closed') return;

    // Source-scoped dedup: 同一 subscription 內若仍在 pending 或已 processed 直接略過
    // 注意：processedTokens 屬於 SubscriptionContext，跨 WebSocket reconnect 始終保留！
    if (subCtx.pendingTokens.has(token) || subCtx.processedTokens.has(token)) {
      return;
    }

    // 標記為 pending，避免在 in-flight 期間被重複推入佇列
    subCtx.pendingTokens.add(token);

    // 推入序列化 Pipeline Queue
    this.enqueueTask({
      subCtx,
      token,
    });
  }

  private enqueueTask(task: PipelineTask): void {
    this.queue.push(task);
    void this.processQueue();
  }

  /**
   * 序列化處理佇列 (FIFO)，避免多 WebSocket 同時收到 token 時破壞順序與 cumulative total
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.disposed) return;
    this.isProcessingQueue = true;

    try {
      while (this.queue.length > 0 && !this.disposed) {
        const task = this.queue.shift();
        if (!task) break;

        // 若該 subscription 已被移除或關閉，跳過此任務並清理 pending 狀態
        if (task.subCtx.subscription.status === 'closed') {
          task.subCtx.pendingTokens.delete(task.token);
          continue;
        }

        await this.executePipelineTask(task);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * 執行單一 Pipeline 任務:
   * 1. 透過 LiveSearchFetchRateGate 發送官方 HTTP /fetch (帶 query 與 X-Requested-With)
   * 2. 成功則計算 cumulative total，呼叫 Host Client 注入
   * 3. Host Client 回報成功後才遞增 total、移除 pending 並標記 processed
   * 4. 任何失敗均移除 pending 但不標記 processed，允許未來重試
   */
  private async executePipelineTask(task: PipelineTask): Promise<void> {
    const { subCtx, token } = task;

    // 1. PoeXD 經由 FetchRateGate 發起 HTTP /fetch
    const fetchUrl = this.buildFetchUrl(
      subCtx.subscription.gameVersion,
      token,
      subCtx.subscription.searchId,
    );

    let itemData: unknown = null;
    try {
      const response = await this.fetchRateGate.fetch(
        fetchUrl,
        {
          method: 'GET',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json',
          },
        },
        {
          shouldAbort: () => this.disposed || subCtx.subscription.status === 'closed',
          onRegisterCancel: (cancelWait) => {
            subCtx.activeCancelWait = cancelWait;
          },
        },
      );
      subCtx.activeCancelWait = undefined;

      if (!response || !response.ok) {
        // Fetch 被取消或失敗：移除 pending，不累積 total，不標記 processed (允許重試)
        subCtx.pendingTokens.delete(token);
        return;
      }

      const json = await response.json();
      if (
        !json ||
        typeof json !== 'object' ||
        !Array.isArray(json.result) ||
        json.result.length === 0
      ) {
        subCtx.pendingTokens.delete(token);
        return;
      }

      itemData = json.result[0];
    } catch {
      // 網路例外：移除 pending，不累積 total，不標記 processed
      subCtx.activeCancelWait = undefined;
      subCtx.pendingTokens.delete(token);
      return;
    }

    if (this.disposed || subCtx.subscription.status === 'closed') {
      subCtx.pendingTokens.delete(token);
      return;
    }

    // 2. 準備 Render Transaction 參數
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    try {
      const rendered = await this.renderIntoHost({
        batchId,
        sourceSearchId: subCtx.subscription.searchId,
        token,
        itemData,
        ownerKey: getTradeSearchCanonicalKey({
          gameVersion: this.gameVersion,
          league: subCtx.subscription.league,
          searchId: subCtx.subscription.searchId,
        }),
      });

      if (rendered) {
        // 唯有在 Host 回報成功後，才遞增 cumulative total 並轉入 processedTokens
        subCtx.pendingTokens.delete(token);
        subCtx.processedTokens.add(token);
        this.notifyListeners();
      } else {
        // Host 回報失敗：移除 pending，total 不變，允許重試
        subCtx.pendingTokens.delete(token);
      }
    } catch {
      // 例外發生：移除 pending，total 不變，允許重試
      subCtx.pendingTokens.delete(token);
    }
  }

  /**
   * 依據遊戲版本與 Origin 組裝 WebSocket 網址
   */
  private buildWebSocketUrl(gameVersion: PoeVersion, league: string, searchId: string): string {
    const isHttps = this.origin.startsWith('https:');
    const wsProto = isHttps ? 'wss:' : 'ws:';
    const host = this.origin.replace(/^https?:\/\//, '');

    const encodedLeague = encodeURIComponent(league);
    const encodedSearchId = encodeURIComponent(searchId);

    if (gameVersion === 'poe2') {
      return `${wsProto}//${host}/api/trade2/live/poe2/${encodedLeague}/${encodedSearchId}`;
    }
    return `${wsProto}//${host}/api/trade/live/${encodedLeague}/${encodedSearchId}`;
  }

  /**
   * 依據遊戲版本組裝 HTTP /fetch 網址 (遵循官方契約)
   */
  private buildFetchUrl(gameVersion: PoeVersion, token: string, searchId: string): string {
    const encodedToken = encodeURIComponent(token);
    const encodedSearchId = encodeURIComponent(searchId);

    if (gameVersion === 'poe2') {
      return `${this.origin}/api/trade2/fetch/${encodedToken}?query=${encodedSearchId}&realm=poe2`;
    }
    return `${this.origin}/api/trade/fetch/${encodedToken}?query=${encodedSearchId}`;
  }
}
