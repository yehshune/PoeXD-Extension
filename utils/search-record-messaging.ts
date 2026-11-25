import {
  broadcastToTradeTabs,
  callBackgroundWithUnavailable,
  createRefCountedChangeHub,
  registerReadyGatedHandler,
  unavailableOutcome,
  type ChangeListener,
  type RefCountedChangeHub,
  type TradeTabBroadcastTransport,
} from './background-messaging';
import { extensionMessaging } from './extension-protocol';
import type {
  SearchRecordChange,
  SearchRecordCommand,
  SearchRecordError,
  SearchRecordModule,
  SearchRecordOutcome,
  SearchRecordRead,
  SearchRecordReadOutcome,
  SearchRecordRuntime,
} from './search-records';

export interface SearchRecordClientTransport {
  execute(command: SearchRecordCommand): Promise<SearchRecordOutcome>;
  read(read: SearchRecordRead): Promise<SearchRecordReadOutcome>;
  subscribe(listener: (change: SearchRecordChange) => void): () => void;
}

export type SearchRecordBroadcastTransport = TradeTabBroadcastTransport<SearchRecordChange>;

export type SearchRecordClient = Pick<SearchRecordModule, 'execute' | 'read' | 'subscribe'>;

export function createSearchRecordClient(
  transport: SearchRecordClientTransport,
): SearchRecordClient {
  return {
    execute: (command) =>
      callBackgroundWithUnavailable(
        () => transport.execute(command),
        'Search Record background did not respond',
      ),
    read: (read: SearchRecordRead) =>
      callBackgroundWithUnavailable(
        () => transport.read(read),
        'Search Record background did not respond',
      ),
    subscribe(listener) {
      return transport.subscribe(listener);
    },
  } as SearchRecordClient;
}

export type SearchRecordChangeListener = ChangeListener<SearchRecordChange>;

export type SearchRecordChangeHub = RefCountedChangeHub<SearchRecordChange>;

export function createSearchRecordChangeHub(messenger = extensionMessaging): SearchRecordChangeHub {
  return createRefCountedChangeHub('searchRecord:change', messenger);
}

export const sharedSearchRecordChangeHub = createSearchRecordChangeHub();

export function subscribeSearchRecordChange(
  listener: SearchRecordChangeListener,
  hub: SearchRecordChangeHub = sharedSearchRecordChangeHub,
): () => void {
  return hub.subscribe(listener);
}

export function createChromeSearchRecordClient(
  messenger = extensionMessaging,
  changeHub: SearchRecordChangeHub = messenger === extensionMessaging
    ? sharedSearchRecordChangeHub
    : createSearchRecordChangeHub(messenger),
): SearchRecordClient {
  return createSearchRecordClient({
    execute: (command) => messenger.sendMessage('searchRecord:execute', command),
    read: (read) => messenger.sendMessage('searchRecord:read', read),
    subscribe: (listener) => changeHub.subscribe(listener),
  });
}

export async function broadcastSearchRecordChange(
  change: SearchRecordChange,
  transport: SearchRecordBroadcastTransport,
) {
  await broadcastToTradeTabs(change, transport);
}

export function registerSearchRecordBackgroundHandlers(options: {
  messenger?: typeof extensionMessaging;
  getModule: () => SearchRecordRuntime;
  getReady: () => Promise<SearchRecordOutcome>;
}): () => void {
  const offExecute = registerReadyGatedHandler('searchRecord:execute', {
    messenger: options.messenger,
    getReady: options.getReady,
    handle: (command) => options.getModule().execute(command),
  });

  const offRead = registerReadyGatedHandler('searchRecord:read', {
    messenger: options.messenger,
    getReady: options.getReady,
    handle: (read) => options.getModule().read(read),
  });

  return () => {
    offExecute();
    offRead();
  };
}

export function unavailable(message: string): { ok: false; error: SearchRecordError } {
  return unavailableOutcome(message);
}
