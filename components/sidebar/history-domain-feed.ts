import type { PoeVersion } from '@/utils/trade-context';
import type { HistoryEntry, SearchRecordError } from '@/utils/search-records';
import type { SearchRecordClient } from '@/utils/search-record-messaging';

export interface HistoryDomainSnapshot {
  history: HistoryEntry[];
  enabled: boolean;
}

export function createHistoryDomainFeed(
  client: SearchRecordClient,
  gameVersion: PoeVersion,
  onSnapshot: (snapshot: HistoryDomainSnapshot) => void,
  onError: (error: SearchRecordError) => void,
) {
  let refreshQueue = Promise.resolve();
  let unsubscribe: (() => void) | undefined;

  const load = async () => {
    const [historyResult, enabledResult] = await Promise.all([
      client.read({ type: 'get-history-view', gameVersion }),
      client.read({ type: 'get-history-enabled', gameVersion }),
    ]);
    if (!historyResult.ok) return onError(historyResult.error);
    if (!enabledResult.ok) return onError(enabledResult.error);
    onSnapshot({
      history: historyResult.value,
      enabled: enabledResult.value,
    });
  };
  const refresh = () => {
    refreshQueue = refreshQueue.then(load, load);
    return refreshQueue;
  };

  return {
    start() {
      unsubscribe = client.subscribe(() => {
        void refresh();
      });
      return refresh();
    },
    refresh,
    whenIdle() {
      return refreshQueue;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
