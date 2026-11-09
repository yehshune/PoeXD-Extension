import { extensionMessaging } from './extension-protocol';
import type { LiveSearchCoordinator } from './live-search-coordinator';
import type {
  LiveSearchConsumePendingEnqueueResponse,
  LiveSearchEnqueueResponse,
  LiveSearchGetPageRoleResponse,
  LiveSearchOpenPrimaryResponse,
} from './live-search-contract';

export interface LiveSearchBackgroundHandlersOptions {
  coordinator: LiveSearchCoordinator;
  messenger?: typeof extensionMessaging;
}

export function registerLiveSearchBackgroundHandlers(
  options: LiveSearchBackgroundHandlersOptions,
): () => void {
  const messenger = options.messenger ?? extensionMessaging;
  const coordinator = options.coordinator;

  const unregOpen = messenger.onMessage(
    'liveSearch:openPrimary',
    async ({ data, sender }): Promise<LiveSearchOpenPrimaryResponse> => {
      return coordinator.openPrimary(data, sender);
    },
  );

  const unregGetRole = messenger.onMessage(
    'liveSearch:getPageRole',
    async ({ data, sender }): Promise<LiveSearchGetPageRoleResponse> => {
      return coordinator.getPageRole(sender?.tab?.id, data?.gameVersion, sender);
    },
  );

  const unregEnqueue = messenger.onMessage(
    'liveSearch:enqueueConnections',
    async ({ data, sender }): Promise<LiveSearchEnqueueResponse> => {
      return coordinator.enqueueConnections(data, sender);
    },
  );

  const unregConsumePending = messenger.onMessage(
    'liveSearch:consumePendingEnqueue',
    async ({ data, sender }): Promise<LiveSearchConsumePendingEnqueueResponse> => {
      return coordinator.consumePendingEnqueue(sender?.tab?.id, data?.gameVersion, sender);
    },
  );

  coordinator.setArrivalNotifier(async (tabId, signal) => {
    try {
      await messenger.sendMessage('liveSearch:notifyArrival', signal, tabId);
    } catch {
      // Presentation arrival feedback failure is non-fatal
    }
  });

  coordinator.setEnqueueForwarder(async (tabId, items) => {
    return messenger.sendMessage('liveSearch:receiveEnqueuedConnections', { items }, tabId);
  });

  return () => {
    coordinator.setArrivalNotifier(undefined);
    coordinator.setEnqueueForwarder(undefined);
    unregOpen();
    unregGetRole();
    unregEnqueue();
    unregConsumePending();
  };
}
