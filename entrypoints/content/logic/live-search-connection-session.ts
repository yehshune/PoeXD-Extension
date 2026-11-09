import type { LiveSearchSubscriptionStatus } from '@/utils/live-search-contract';
import type { ILiveSearchOpenScheduler } from './live-search-open-scheduler';

export interface LiveSearchReconnectPolicy {
  baseDelayMs: number; // 預設 5000 (5s)
  maxDelayMs: number; // 預設 120000 (120s)
  maxFailedAttempts: number; // 預設 3
  jitterRatio: number; // 預設 0.2 (±20%)
}

export const DEFAULT_RECONNECT_POLICY: Readonly<LiveSearchReconnectPolicy> = {
  baseDelayMs: 5000,
  maxDelayMs: 120000,
  maxFailedAttempts: 3,
  jitterRatio: 0.2,
};

export interface LiveSearchConnectionSessionHandlers {
  onStatusChange: (
    status: LiveSearchSubscriptionStatus,
    metadata?: { errorMessage?: string; reconnectInSeconds?: number },
  ) => void;
  onToken: (token: string) => void;
}

export interface LiveSearchConnectionSessionScheduler {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

export interface LiveSearchConnectionSessionOptions {
  wsUrl: string;
  webSocketFactory: (url: string) => WebSocket;
  openScheduler: ILiveSearchOpenScheduler;
  handlers: LiveSearchConnectionSessionHandlers;
  policy?: Partial<LiveSearchReconnectPolicy>;
  random?: () => number;
  scheduler?: LiveSearchConnectionSessionScheduler;
}

export interface ILiveSearchConnectionSession {
  start(): void;
  retry(): { success: boolean; error?: string };
  stop(): void;
  dispose(): void;
  getStatus(): LiveSearchSubscriptionStatus;
  getFailedAttempts(): number;
}

/**
 * LiveSearch Connection Session (Deep Module)
 *
 * 權責：
 * 1. 唯一擁有並維護單一 Subscription 之 WebSocket Transport Lifecycle
 * 2. Attempt Isolation: 每次連線 attempt 具備嚴格的 generation 與 current socket 雙重保護，杜絕 stale 回調影響
 * 3. Browser Error / Close Event Normalization: 一次 attempt 的 error + close 正規化為單次失敗，不 double count；支援 close-only
 * 4. Auto-Reconnect Policy (依據 PoeXD Desktop reference):
 *    - base delay: 5s, max delay: 120s, max retries: 3, jitter: ±20%
 *    - 達到上限後進入 terminal error，保留 subscription entity 供使用者 Manual Retry
 *    - 成功連線重置 retry budget
 * 5. Pacing: 所有 Initial, Auto-Reconnect 與 Manual Retry 均排入 Primary-wide Open Scheduler
 * 6. 不暴露 raw WebSocket、定時器句柄或 generation 內部細節
 */
export class LiveSearchConnectionSession implements ILiveSearchConnectionSession {
  private readonly wsUrl: string;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly openScheduler: ILiveSearchOpenScheduler;
  private readonly handlers: LiveSearchConnectionSessionHandlers;
  private readonly policy: LiveSearchReconnectPolicy;
  private readonly random: () => number;
  private readonly scheduler: LiveSearchConnectionSessionScheduler;

  private status: LiveSearchSubscriptionStatus = 'idle';
  private generation = 0;
  private failedAttempts = 0;
  private currentWs: WebSocket | null = null;
  private reconnectTimeout: unknown = null;
  private reconnectInterval: unknown = null;
  private stopped = false;
  private disposed = false;

  constructor(options: LiveSearchConnectionSessionOptions) {
    this.wsUrl = options.wsUrl;
    this.webSocketFactory = options.webSocketFactory;
    this.openScheduler = options.openScheduler;
    this.handlers = options.handlers;
    this.policy = { ...DEFAULT_RECONNECT_POLICY, ...options.policy };
    this.random = options.random ?? Math.random;
    this.scheduler = options.scheduler ?? {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (id) => clearTimeout(id as number | undefined),
      setInterval: (handler, ms) => setInterval(handler, ms),
      clearInterval: (id) => clearInterval(id as number | undefined),
    };
  }

  public getStatus(): LiveSearchSubscriptionStatus {
    return this.status;
  }

  public getFailedAttempts(): number {
    return this.failedAttempts;
  }

  public start(): void {
    if (this.disposed || this.stopped) return;
    if (
      this.status === 'connecting' ||
      this.status === 'active' ||
      this.status === 'reconnecting'
    ) {
      return;
    }

    this.setStatus('connecting');
    const attemptGen = ++this.generation;
    this.openScheduler.enqueue(() => this.executeOpen(attemptGen));
  }

  public retry(): { success: boolean; error?: string } {
    if (this.disposed || this.stopped) {
      return { success: false, error: 'Session 已終止，無法重試' };
    }

    if (this.status !== 'error') {
      return { success: false, error: `目前狀態 (${this.status}) 不允許手動重試` };
    }

    this.clearTimers();
    this.failedAttempts = 0;
    this.setStatus('connecting', { errorMessage: undefined, reconnectInSeconds: undefined });

    const attemptGen = ++this.generation;
    this.openScheduler.enqueue(() => this.executeOpen(attemptGen));

    return { success: true };
  }

  public stop(): void {
    if (this.stopped || this.disposed) return;
    this.stopped = true;
    this.internalTeardown('closed');
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopped = true;
    this.internalTeardown('closed');
  }

  private internalTeardown(finalStatus: LiveSearchSubscriptionStatus): void {
    this.generation++;
    this.clearTimers();
    this.closeCurrentWebSocket();
    this.setStatus(finalStatus);
  }

  private isCurrent(attemptGen: number, ws?: WebSocket | null): boolean {
    if (this.disposed || this.stopped) return false;
    if (attemptGen !== this.generation) return false;
    if (ws && ws !== this.currentWs) return false;
    return true;
  }

  private setStatus(
    status: LiveSearchSubscriptionStatus,
    metadata?: { errorMessage?: string; reconnectInSeconds?: number },
  ): void {
    this.status = status;
    try {
      this.handlers.onStatusChange(status, metadata);
    } catch (err) {
      console.error('[PoeXD LiveSearch] Error in connection session onStatusChange handler:', err);
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimeout !== null) {
      this.scheduler.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.reconnectInterval !== null) {
      this.scheduler.clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  private closeCurrentWebSocket(): void {
    if (this.currentWs) {
      const ws = this.currentWs;
      this.currentWs = null;
      try {
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
      } catch {
        // 安全忽略
      }
    }
  }

  private executeOpen(attemptGen: number): void {
    // 若在排隊等待 open pacing 時已被取消或已進入新 generation，直接終止，不建立任何 WebSocket
    if (!this.isCurrent(attemptGen)) return;

    this.closeCurrentWebSocket();

    let ws: WebSocket;
    try {
      ws = this.webSocketFactory(this.wsUrl);
      this.currentWs = ws;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to instantiate WebSocket';
      this.handleAttemptFailure(attemptGen, errorMsg);
      return;
    }

    let hasHandledFailureInThisAttempt = false;

    ws.onopen = () => {
      if (!this.isCurrent(attemptGen, ws)) {
        try {
          ws.close();
        } catch {}
        return;
      }

      this.clearTimers();
      this.failedAttempts = 0;
      this.setStatus('active', { errorMessage: undefined, reconnectInSeconds: undefined });
    };

    ws.onerror = (event: Event | unknown) => {
      if (!this.isCurrent(attemptGen, ws)) return;
      if (hasHandledFailureInThisAttempt) return;
      hasHandledFailureInThisAttempt = true;

      const errorMsg = event instanceof Error ? event.message : 'WebSocket error encountered';
      this.handleAttemptFailure(attemptGen, errorMsg);
    };

    ws.onclose = () => {
      if (!this.isCurrent(attemptGen, ws)) return;
      if (this.currentWs === ws) {
        this.currentWs = null;
      }

      // 若 onerror 已處理過本次 failure，則 close 不再重複計算 failure
      if (hasHandledFailureInThisAttempt) {
        return;
      }

      // Close-only (沒有前置 error 事件)：正規化為一次連線失敗
      hasHandledFailureInThisAttempt = true;
      this.handleAttemptFailure(attemptGen, 'WebSocket closed unexpectedly');
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!this.isCurrent(attemptGen, ws)) return;
      this.handleMessage(event.data);
    };
  }

  private handleAttemptFailure(attemptGen: number, errorMsg: string): void {
    if (!this.isCurrent(attemptGen)) return;

    this.clearTimers();
    this.closeCurrentWebSocket();
    this.failedAttempts++;

    // 達到最大重試次數，進入 terminal/error 狀態，停止自動重連
    if (this.failedAttempts > this.policy.maxFailedAttempts) {
      this.setStatus('error', {
        errorMessage: `連線失敗: ${errorMsg} (已嘗試重連 ${this.policy.maxFailedAttempts} 次)`,
        reconnectInSeconds: undefined,
      });
      return;
    }

    // 進入 reconnecting 狀態
    const delayMs = this.calculateBackoffDelay(this.failedAttempts);
    let countdownSeconds = Math.ceil(delayMs / 1000);

    this.setStatus('reconnecting', {
      errorMessage: errorMsg,
      reconnectInSeconds: countdownSeconds,
    });

    // 每秒倒數計時 interval
    this.reconnectInterval = this.scheduler.setInterval(() => {
      if (!this.isCurrent(attemptGen)) return;
      countdownSeconds -= 1;
      if (countdownSeconds <= 0) {
        if (this.reconnectInterval !== null) {
          this.scheduler.clearInterval(this.reconnectInterval);
          this.reconnectInterval = null;
        }
        return;
      }
      this.setStatus('reconnecting', {
        errorMessage: errorMsg,
        reconnectInSeconds: countdownSeconds,
      });
    }, 1000);

    // 重連 timeout 到期後，切換 connecting 並透過 openScheduler 排隊建立新 attempt
    this.reconnectTimeout = this.scheduler.setTimeout(() => {
      if (!this.isCurrent(attemptGen)) return;
      this.clearTimers();
      this.setStatus('connecting', {
        errorMessage: undefined,
        reconnectInSeconds: undefined,
      });

      const nextGen = ++this.generation;
      this.openScheduler.enqueue(() => this.executeOpen(nextGen));
    }, delayMs);
  }

  private calculateBackoffDelay(attempts: number): number {
    // attempts 從 1 開始: baseDelay * 4^(attempts - 1)
    const base = this.policy.baseDelayMs * 4 ** Math.max(0, attempts - 1);
    const jitter = base * this.policy.jitterRatio * (this.random() * 2 - 1);
    const candidate = Math.max(0, base + jitter);
    return Math.min(candidate, this.policy.maxDelayMs);
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;

    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    if (!payload || typeof payload !== 'object') return;

    // 官方認證成功廣播 {"auth": true} 略過
    if (payload.auth === true) {
      return;
    }

    // 提取 token
    let rawToken: unknown = payload.result;
    if (typeof rawToken !== 'string' || !rawToken.trim()) {
      rawToken = payload.new;
    }

    if (typeof rawToken !== 'string' || !rawToken.trim()) return;
    const cleanToken = rawToken.trim();

    try {
      this.handlers.onToken(cleanToken);
    } catch (err) {
      console.error('[PoeXD LiveSearch] Error in connection session onToken handler:', err);
    }
  }
}
