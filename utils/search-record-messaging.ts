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

export interface SearchRecordBroadcastTransport {
  listTradeTabIds(): Promise<number[]>;
  sendChangeToTab(tabId: number, change: SearchRecordChange): Promise<void>;
}

export type SearchRecordClient = Pick<SearchRecordModule, 'execute' | 'read' | 'subscribe'>;

export function createSearchRecordClient(
  transport: SearchRecordClientTransport,
): SearchRecordClient {
  return {
    async execute(command) {
      try {
        const response = await transport.execute(command);
        if (response) return response;
        return unavailable('Search Record background did not respond');
      } catch (error) {
        return unavailable(error instanceof Error ? error.message : String(error));
      }
    },
    async read(read: SearchRecordRead) {
      try {
        const response = await transport.read(read);
        if (response) return response;
        return unavailable('Search Record background did not respond');
      } catch (error) {
        return unavailable(error instanceof Error ? error.message : String(error));
      }
    },
    subscribe(listener) {
      return transport.subscribe(listener);
    },
  } as SearchRecordClient;
}

export type SearchRecordChangeListener = (change: SearchRecordChange) => void;

export interface SearchRecordChangeHub {
  subscribe(listener: SearchRecordChangeListener): () => void;
  readonly subscriberCount: number;
}

export function createSearchRecordChangeHub(messenger = extensionMessaging): SearchRecordChangeHub {
  const subscribers = new Set<SearchRecordChangeListener>();
  let unhookMessenger: (() => void) | undefined;

  return {
    subscribe(listener: SearchRecordChangeListener): () => void {
      subscribers.add(listener);
      if (subscribers.size === 1) {
        unhookMessenger = messenger.onMessage('searchRecord:change', (message) => {
          for (const subscriber of subscribers) {
            try {
              subscriber(message.data);
            } catch {
              // Individual subscriber failure does not abort other subscribers or transport
            }
          }
        });
      }
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0 && unhookMessenger) {
          unhookMessenger();
          unhookMessenger = undefined;
        }
      };
    },
    get subscriberCount() {
      return subscribers.size;
    },
  };
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
  const tabIds = await transport.listTradeTabIds();
  await Promise.allSettled(tabIds.map((tabId) => transport.sendChangeToTab(tabId, change)));
}

export function registerSearchRecordBackgroundHandlers(options: {
  messenger?: typeof extensionMessaging;
  getModule: () => SearchRecordRuntime;
  getReady: () => Promise<SearchRecordOutcome>;
}): () => void {
  const messenger = options.messenger ?? extensionMessaging;
  const offExecute = messenger.onMessage('searchRecord:execute', async (message) => {
    try {
      const outcome = await options.getReady();
      if (!outcome.ok) return outcome;
      return await options.getModule().execute(message.data);
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  });

  const offRead = messenger.onMessage('searchRecord:read', async (message) => {
    try {
      const outcome = await options.getReady();
      if (!outcome.ok) return outcome;
      return await options.getModule().read(message.data);
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  });

  return () => {
    offExecute();
    offRead();
  };
}

export function unavailable(message: string): { ok: false; error: SearchRecordError } {
  return {
    ok: false,
    error: { code: 'unavailable', message },
  };
}
