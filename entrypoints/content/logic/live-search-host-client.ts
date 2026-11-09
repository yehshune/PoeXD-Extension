import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import {
  parsePoeLiveSearchCommandResult,
  serializePoeLiveSearchRenderResult,
  type PoeLiveSearchEnsureContainerPayload,
  type PoeLiveSearchRenderResultPayload,
  type PoeLiveSearchResetUnreadPayload,
  type PoeLiveSearchSyncTotalPayload,
} from '@/utils/event-protocol-types';

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

interface PendingCommand {
  cancel(reason: string): void;
}

/**
 * Content World 端負責與 Main World OfficialLiveSearchAdapter 溝通的客戶端
 * 遵守單一 Nonce Bridge 機制與跨 World Event Protocol
 */
export class LiveSearchHostClient implements ILiveSearchHostClient {
  private pendingCommands = new Set<PendingCommand>();
  private disposed = false;

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    if (this.disposed) {
      return { success: false, error: 'Host client disposed' };
    }

    const requestId = this.generateRequestId();
    const payload: PoeLiveSearchEnsureContainerPayload = {
      requestId,
      localId: options.localId,
      league: options.league,
      realm: options.realm,
      resetResults: options.resetResults,
    };

    return this.executeCommand('ensure-container', requestId, options.timeoutMs, () => {
      dispatchPoeEvent('poexd-livesearch-ensure-container', payload);
    });
  }

  public async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    if (this.disposed) {
      return { success: false, error: 'Host client disposed' };
    }

    const requestId = this.generateRequestId();
    const payload: PoeLiveSearchRenderResultPayload = {
      requestId,
      localId: options.localId,
      batchId: options.batchId,
      sourceSearchId: options.sourceSearchId,
      token: options.token,
      itemData: options.itemData,
      total: options.total,
      ...(options.maxResults !== undefined ? { maxResults: options.maxResults } : {}),
    };

    const wireString = serializePoeLiveSearchRenderResult(payload);

    return this.executeCommand('render-result', requestId, options.timeoutMs, () => {
      dispatchPoeEvent('poexd-livesearch-render-result', wireString);
    });
  }

  public async resetUnread(options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    if (this.disposed) {
      return { success: false, error: 'Host client disposed' };
    }

    const requestId = this.generateRequestId();
    const payload: PoeLiveSearchResetUnreadPayload = {
      requestId,
      localId: options.localId,
    };

    return this.executeCommand('reset-unread', requestId, options.timeoutMs, () => {
      dispatchPoeEvent('poexd-livesearch-reset-unread', payload);
    });
  }

  public async syncTotal(options: SyncTotalOptions): Promise<HostCommandOutcome> {
    if (this.disposed) {
      return { success: false, error: 'Host client disposed' };
    }

    const requestId = this.generateRequestId();
    const payload: PoeLiveSearchSyncTotalPayload = {
      requestId,
      localId: options.localId,
      total: options.total,
    };

    return this.executeCommand('sync-total', requestId, options.timeoutMs, () => {
      dispatchPoeEvent('poexd-livesearch-sync-total', payload);
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cmd of Array.from(this.pendingCommands)) {
      try {
        cmd.cancel('Host client disposed');
      } catch {
        // 安全忽略 cleanup 例外
      }
    }
    this.pendingCommands.clear();
  }

  private executeCommand(
    expectedCommand: 'ensure-container' | 'render-result' | 'reset-unread' | 'sync-total',
    requestId: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    dispatchAction: () => void,
  ): Promise<HostCommandOutcome> {
    return new Promise<HostCommandOutcome>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let cleanupListener: (() => void) | null = null;

      const finish = (outcome: HostCommandOutcome) => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (cleanupListener !== null) {
          cleanupListener();
          cleanupListener = null;
        }
        this.pendingCommands.delete(pendingCmd);
        resolve(outcome);
      };

      const pendingCmd: PendingCommand = {
        cancel: (reason: string) => {
          finish({ success: false, error: reason });
        },
      };
      this.pendingCommands.add(pendingCmd);

      cleanupListener = listenPoeEvent('poexd-livesearch-command-result', (wireString) => {
        const parsed = parsePoeLiveSearchCommandResult(wireString);
        if (!parsed) return;
        if (parsed.requestId === requestId && parsed.command === expectedCommand) {
          finish({
            success: parsed.success,
            error: parsed.error,
          });
        }
      });

      timer = setTimeout(() => {
        finish({
          success: false,
          error: `Host command '${expectedCommand}' timed out after ${timeoutMs}ms (requestId: ${requestId})`,
        });
      }, timeoutMs);

      try {
        dispatchAction();
      } catch (err) {
        finish({
          success: false,
          error: `Failed to dispatch host command '${expectedCommand}': ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
