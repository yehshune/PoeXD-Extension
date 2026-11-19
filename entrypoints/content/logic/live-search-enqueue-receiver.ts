import type { extensionMessaging } from '@/utils/extension-protocol';
import type {
  LiveSearchEnqueueItem,
  LiveSearchEnqueueResponse,
} from '@/utils/live-search-contract';
import type { PoeVersion } from '@/utils/trade-context';
import { t } from '@/utils/i18n';

export interface LiveSearchPrimaryEnqueueBridgeOptions {
  version: PoeVersion;
  messenger: Pick<typeof extensionMessaging, 'onMessage' | 'sendMessage'>;
  enqueueIncoming: (items: readonly LiveSearchEnqueueItem[]) => Promise<LiveSearchEnqueueResponse>;
  isDisposed: () => boolean;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

/**
 * Coordinates direct liveSearch:receiveEnqueuedConnections pushes and pending-queue
 * draining for a primary console tab, deduplicating by coordinator batchId so a
 * fallback buffered batch never replays connections already accepted directly.
 */
export function registerLiveSearchPrimaryEnqueueBridge(
  options: LiveSearchPrimaryEnqueueBridgeOptions,
): () => void {
  const { version, messenger, enqueueIncoming, isDisposed } = options;
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const handledBatchIds = new Set<string>();

  const drainPendingEnqueue = () => {
    if (isDisposed()) return;
    void messenger
      .sendMessage('liveSearch:consumePendingEnqueue', {
        gameVersion: version,
      })
      .then(async (res) => {
        if (isDisposed() || !res) return;

        let itemsToEnqueue: LiveSearchEnqueueItem[] = [];
        if (Array.isArray(res.batches) && res.batches.length > 0) {
          for (const batch of res.batches) {
            if (!batch?.batchId || handledBatchIds.has(batch.batchId)) continue;
            handledBatchIds.add(batch.batchId);
            itemsToEnqueue.push(...batch.items);
          }
        } else if (res.items && res.items.length > 0) {
          itemsToEnqueue = res.items;
        }

        if (itemsToEnqueue.length > 0) {
          await enqueueIncoming(itemsToEnqueue);
        }
      })
      .catch((err) => {
        console.warn('[PoeXD] 消費待處理連線佇列失敗:', err);
      });
  };

  const cleanupReceiveEnqueue = messenger.onMessage(
    'liveSearch:receiveEnqueuedConnections',
    async ({ data }) => {
      if (isDisposed() || (data.gameVersion && data.gameVersion !== version)) {
        return {
          success: false,
          addedCount: 0,
          skippedCount: 0,
          error: t('liveSearch.console.notReady'),
          rejectReason: 'failed',
        };
      }
      if (data.batchId) {
        if (handledBatchIds.has(data.batchId)) {
          return {
            success: true,
            addedCount: 0,
            skippedCount: data.items.length,
          };
        }
        handledBatchIds.add(data.batchId);
      }
      return await enqueueIncoming(data.items);
    },
  );

  const handleVisibilityChange = () => {
    if (doc?.visibilityState === 'visible') {
      drainPendingEnqueue();
    }
  };
  doc?.addEventListener('visibilitychange', handleVisibilityChange);

  drainPendingEnqueue();

  return () => {
    doc?.removeEventListener('visibilitychange', handleVisibilityChange);
    cleanupReceiveEnqueue();
  };
}
