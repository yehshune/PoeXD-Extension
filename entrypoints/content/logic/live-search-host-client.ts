import { createCrossWorldRpcClient, type RpcOutcome } from '@/utils/cross-world-rpc';

export interface EnsureContainerOptions {
  localId: string;
  league: string;
  realm: 'pc' | 'poe2';
  resetResults?: boolean;
  timeoutMs?: number;
}

export interface RenderResultOptions {
  localId: string;
  batchId: string;
  sourceSearchId: string;
  token: string;
  itemData: unknown;
  total: number;
  maxResults?: number;
  timeoutMs?: number;
}

export interface ResetUnreadOptions {
  localId: string;
  timeoutMs?: number;
}

export interface SyncTotalOptions {
  localId: string;
  total: number;
  timeoutMs?: number;
}

export interface HostCommandOutcome {
  success: boolean;
  error?: string;
}

export interface ILiveSearchHostClient {
  ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome>;
  renderResult(options: RenderResultOptions): Promise<HostCommandOutcome>;
  resetUnread(options: ResetUnreadOptions): Promise<HostCommandOutcome>;
  /** 同步官方展示容器的結果總數；未實作時視為不支援 */
  syncTotal?(options: SyncTotalOptions): Promise<HostCommandOutcome>;
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 5000;

function toHostOutcome(outcome: RpcOutcome<unknown>): HostCommandOutcome {
  if (outcome.ok) return { success: true };
  if (outcome.code === 'DISPOSED') {
    return { success: false, error: 'Host client disposed' };
  }
  return { success: false, error: outcome.error };
}

/**
 * Content World 端負責與 Main World OfficialLiveSearchAdapter 溝通的客戶端
 * 透過 Cross-World RPC 通道與 Main World 溝通並管理生命週期取消
 */
export class LiveSearchHostClient implements ILiveSearchHostClient {
  private readonly rpc = createCrossWorldRpcClient({ defaultTimeoutMs: DEFAULT_TIMEOUT_MS });

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    const outcome = await this.rpc.request(
      'livesearch.ensure-container',
      {
        localId: options.localId,
        league: options.league,
        realm: options.realm,
        ...(options.resetResults !== undefined ? { resetResults: options.resetResults } : {}),
      },
      { timeoutMs: options.timeoutMs },
    );
    return toHostOutcome(outcome);
  }

  public async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    const outcome = await this.rpc.request(
      'livesearch.render-result',
      {
        localId: options.localId,
        batchId: options.batchId,
        sourceSearchId: options.sourceSearchId,
        token: options.token,
        itemData: options.itemData,
        total: options.total,
        ...(options.maxResults !== undefined ? { maxResults: options.maxResults } : {}),
      },
      { timeoutMs: options.timeoutMs },
    );
    return toHostOutcome(outcome);
  }

  public async resetUnread(options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    const outcome = await this.rpc.request(
      'livesearch.reset-unread',
      { localId: options.localId },
      { timeoutMs: options.timeoutMs },
    );
    return toHostOutcome(outcome);
  }

  public async syncTotal(options: SyncTotalOptions): Promise<HostCommandOutcome> {
    const outcome = await this.rpc.request(
      'livesearch.sync-total',
      { localId: options.localId, total: options.total },
      { timeoutMs: options.timeoutMs },
    );
    return toHostOutcome(outcome);
  }

  public dispose(): void {
    this.rpc.dispose();
  }
}
