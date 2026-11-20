/**
 * 看板的「載入更多／載入全部」：代替使用者觸發官方自己的「載入更多」（ADR-0018），
 * 看板從不自己呼叫 `/fetch`。
 *
 * 一次只觸發一批，等官方那次 fetch 回應完（或失敗、逾時）才繼續；載入全部時每批之間再停一下。
 * 頁面操作由呼叫端注入，這裡只負責流程與停止條件。
 */

export type BatchOutcome =
  | { kind: 'loaded' }
  | { kind: 'failed'; status: number }
  | { kind: 'timeout' };

export type LoadStopReason =
  | 'complete'
  | 'no-button'
  | 'rate-limited'
  | 'failed'
  | 'timeout'
  | 'stopped'
  | 'search-changed';

export interface LoaderState {
  running: boolean;
  /** 最近一次停止的原因；沒有停止過或正在載入時為 undefined */
  lastStop?: LoadStopReason;
}

export interface LoaderDeps {
  /** 觸發官方「載入更多」；找不到按鈕時回傳 false */
  clickLoadMore(): boolean;
  /** 等待剛觸發的那一批：官方 fetch 回應、失敗或逾時 */
  waitForBatch(timeoutMs: number): Promise<BatchOutcome>;
  pause(ms: number): Promise<void>;
  /** 已取得全部可取得的結果（官方 search 回傳的 id 數，最多 100） */
  isComplete(): boolean;
  currentSearchId(): string;
}

export const BATCH_TIMEOUT_MS = 15_000;
export const BATCH_INTERVAL_MS = 1_000;

const RATE_LIMIT_STATUS = 429;

export class ResultBoardLoader {
  private state: LoaderState = { running: false };
  private stopRequested = false;
  private resetRequested = false;
  private readonly listeners = new Set<(state: LoaderState) => void>();

  constructor(private readonly deps: LoaderDeps) {}

  getState(): LoaderState {
    return this.state;
  }

  subscribe(listener: (state: LoaderState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 載入下一批 */
  loadNext(): Promise<LoadStopReason | undefined> {
    return this.run(1);
  }

  /** 依序載入到全部取得或停止為止 */
  loadAll(): Promise<LoadStopReason | undefined> {
    return this.run(Infinity);
  }

  stop(): void {
    if (this.state.running) this.stopRequested = true;
  }

  /** 換搜尋或頁面離開：停下正在進行的載入，並清掉上一次的停止原因 */
  reset(): void {
    if (this.state.running) {
      this.stopRequested = true;
      this.resetRequested = true;
      return;
    }
    if (this.state.lastStop !== undefined) this.setState({ running: false });
  }

  private async run(maxBatches: number): Promise<LoadStopReason | undefined> {
    if (this.state.running) return undefined;
    this.stopRequested = false;
    this.resetRequested = false;
    this.setState({ running: true });
    let reason: LoadStopReason | undefined;
    try {
      reason = await this.loop(maxBatches);
    } catch {
      reason = 'failed';
    } finally {
      const shown = this.resetRequested ? undefined : reason;
      this.resetRequested = false;
      this.setState({ running: false, ...(shown ? { lastStop: shown } : {}) });
    }
    return reason;
  }

  private async loop(maxBatches: number): Promise<LoadStopReason | undefined> {
    const searchId = this.deps.currentSearchId();
    for (let batch = 0; batch < maxBatches; batch += 1) {
      if (batch > 0) await this.deps.pause(BATCH_INTERVAL_MS);
      const blocked = this.checkStop(searchId);
      if (blocked) return blocked;
      // 官方按鈕消失時，可能是剛好取完（帳本比按鈕晚更新）
      if (!this.deps.clickLoadMore()) return this.deps.isComplete() ? 'complete' : 'no-button';
      const outcome = await this.deps.waitForBatch(BATCH_TIMEOUT_MS);
      if (outcome.kind === 'timeout') return 'timeout';
      if (outcome.kind === 'failed') {
        return outcome.status === RATE_LIMIT_STATUS ? 'rate-limited' : 'failed';
      }
    }
    return this.checkStop(searchId);
  }

  private checkStop(searchId: string): LoadStopReason | undefined {
    if (this.stopRequested) return 'stopped';
    if (this.deps.currentSearchId() !== searchId) return 'search-changed';
    if (this.deps.isComplete()) return 'complete';
    return undefined;
  }

  private setState(next: LoaderState): void {
    this.state = next;
    this.listeners.forEach((listener) => {
      try {
        listener(next);
      } catch {
        // 一個訂閱者出錯不影響其他訂閱者與載入流程
      }
    });
  }
}
