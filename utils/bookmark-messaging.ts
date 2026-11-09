import type {
  BookmarkCollectionGroup,
  BookmarkReorderPlacement,
  FolderDropIntent,
} from './bookmark-collection';
import type {
  BookmarkChange,
  BookmarkCollectionView,
  BookmarkCommand,
  BookmarkCoordinator,
  BookmarkInput,
  BookmarkRead,
  BookmarkReadOutcome,
} from './bookmark-coordinator';
import type { PoeVersion } from './trade-context';
import type { BookmarkImportMode, BookmarkTransferPayload } from './bookmark-transfer';
import type { SearchRecordError, SearchRecordOutcome } from './search-records';
import {
  subscribeSearchRecordChange,
  type SearchRecordChangeListener,
} from './search-record-messaging';
import { extensionMessaging } from './extension-protocol';

export interface BookmarkClientTransport {
  execute(command: BookmarkCommand): Promise<SearchRecordOutcome | undefined>;
  read(read: BookmarkRead): Promise<BookmarkReadOutcome | undefined>;
  subscribeBookmarkChange(listener: (change: BookmarkChange) => void): () => void;
}

export interface BookmarkBroadcastTransport {
  listTradeTabIds(): Promise<number[]>;
  sendChangeToTab(tabId: number, change: BookmarkChange): Promise<void>;
}

export type BookmarkChangeListener = (change: BookmarkChange) => void;

export interface BookmarkChangeHub {
  subscribe(listener: BookmarkChangeListener): () => void;
  readonly subscriberCount: number;
}

export function createBookmarkChangeHub(messenger = extensionMessaging): BookmarkChangeHub {
  const subscribers = new Set<BookmarkChangeListener>();
  let unhookMessenger: (() => void) | undefined;

  return {
    subscribe(listener: BookmarkChangeListener): () => void {
      subscribers.add(listener);
      if (subscribers.size === 1) {
        unhookMessenger = messenger.onMessage('bookmark:change', (message) => {
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

export const sharedBookmarkChangeHub = createBookmarkChangeHub();

export function subscribeBookmarkChange(
  listener: BookmarkChangeListener,
  hub: BookmarkChangeHub = sharedBookmarkChangeHub,
): () => void {
  return hub.subscribe(listener);
}

export function createBookmarkClient(
  transport: BookmarkClientTransport,
  gameVersion: PoeVersion,
  subscribeSearchRecord: (listener: SearchRecordChangeListener) => () => void = () => () => {},
) {
  const execute = async (command: BookmarkCommand): Promise<SearchRecordOutcome> => {
    try {
      const response = await transport.execute(command);
      return response ?? unavailable('Bookmark background did not respond');
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  };

  const read = async (request: BookmarkRead): Promise<BookmarkReadOutcome> => {
    try {
      const response = await transport.read(request);
      return response ?? unavailable('Bookmark background did not respond');
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    readCollection: () =>
      read({ type: 'get-collection', gameVersion }) as Promise<
        BookmarkReadOutcome<BookmarkCollectionView>
      >,
    moveFolder: (
      folderId: string,
      targetParentId?: string,
      order?: number,
      dropIntent?: FolderDropIntent,
    ) => execute({ type: 'move-folder', gameVersion, folderId, targetParentId, order, dropIntent }),
    putGroup: (group: Omit<BookmarkCollectionGroup, 'gameVersion'>) =>
      execute({ type: 'put-group', gameVersion, group }),
    deleteGroup: (groupId: string) => execute({ type: 'delete-group', gameVersion, groupId }),
    reorderGroups: (groupIds: string[]) =>
      execute({ type: 'reorder-groups', gameVersion, groupIds }),
    putBookmark: (bookmark: BookmarkInput) =>
      execute({ type: 'put-bookmark', gameVersion, bookmark }),
    deleteBookmark: (bookmarkId: string) =>
      execute({ type: 'delete-bookmark', gameVersion, bookmarkId }),
    reorderBookmarks: (placements: BookmarkReorderPlacement[]) =>
      execute({ type: 'reorder-bookmarks', gameVersion, placements }),
    replaceLeague: (scope: 'collection' | 'folder', league: string, groupId?: string) =>
      execute({ type: 'replace-bookmark-league', gameVersion, scope, groupId, league }),
    exportTransfer: (scope: 'collection' | 'folder', groupId?: string) =>
      read({ type: 'get-transfer', gameVersion, scope, groupId }) as Promise<
        BookmarkReadOutcome<BookmarkTransferPayload>
      >,
    importTransfer: (
      payload: BookmarkTransferPayload,
      mode: BookmarkImportMode,
      targetGroupId?: string,
    ) => execute({ type: 'import-transfer', gameVersion, mode, targetGroupId, payload }),
    clearCollection: () => execute({ type: 'clear-collection', gameVersion }),
    subscribe(listener: () => void) {
      const unsubBookmark = transport.subscribeBookmarkChange(() => {
        listener();
      });
      const unsubSearchRecord = subscribeSearchRecord(() => {
        listener();
      });
      return () => {
        unsubBookmark();
        unsubSearchRecord();
      };
    },
  };
}

export type BookmarkClient = ReturnType<typeof createBookmarkClient>;

export interface ChromeBookmarkClientOptions {
  messenger?: typeof extensionMessaging;
  bookmarkChangeHub?: BookmarkChangeHub;
  subscribeSearchRecord?: (listener: SearchRecordChangeListener) => () => void;
}

export function createChromeBookmarkClient(
  gameVersion: PoeVersion,
  optionsOrSubscribeSearchRecord:
    | ChromeBookmarkClientOptions
    | ((listener: SearchRecordChangeListener) => () => void) = {},
): BookmarkClient {
  const options =
    typeof optionsOrSubscribeSearchRecord === 'function'
      ? { subscribeSearchRecord: optionsOrSubscribeSearchRecord }
      : optionsOrSubscribeSearchRecord;

  const messenger = options.messenger ?? extensionMessaging;
  const bookmarkChangeHub =
    options.bookmarkChangeHub ??
    (messenger === extensionMessaging
      ? sharedBookmarkChangeHub
      : createBookmarkChangeHub(messenger));
  const subscribeSearchRecord = options.subscribeSearchRecord ?? subscribeSearchRecordChange;

  return createBookmarkClient(
    {
      async execute(command) {
        return await messenger.sendMessage('bookmark:execute', command);
      },
      async read(readRequest) {
        let response: BookmarkReadOutcome | undefined;
        try {
          response = await messenger.sendMessage('bookmark:read', readRequest);
        } catch {
          // first read threw, catch and retry after 100ms
        }
        if (response !== undefined) return response;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return await messenger.sendMessage('bookmark:read', readRequest);
      },
      subscribeBookmarkChange(listener) {
        return bookmarkChangeHub.subscribe(listener);
      },
    },
    gameVersion,
    subscribeSearchRecord,
  );
}

export async function broadcastBookmarkChange(
  change: BookmarkChange,
  transport: BookmarkBroadcastTransport,
) {
  const tabIds = await transport.listTradeTabIds();
  await Promise.allSettled(tabIds.map((tabId) => transport.sendChangeToTab(tabId, change)));
}

export function registerBookmarkBackgroundHandlers(options: {
  messenger?: typeof extensionMessaging;
  getCoordinator: () => BookmarkCoordinator;
  getReady: () => Promise<SearchRecordOutcome>;
}): () => void {
  const messenger = options.messenger ?? extensionMessaging;
  const offExecute = messenger.onMessage('bookmark:execute', async (message) => {
    try {
      const outcome = await options.getReady();
      if (!outcome.ok) return outcome;
      return await options.getCoordinator().execute(message.data);
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  });

  const offRead = messenger.onMessage('bookmark:read', async (message) => {
    try {
      const outcome = await options.getReady();
      if (!outcome.ok) return outcome;
      return await options.getCoordinator().read(message.data);
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  });

  return () => {
    offExecute();
    offRead();
  };
}

function unavailable(message: string): { ok: false; error: SearchRecordError } {
  return {
    ok: false,
    error: { code: 'unavailable', message },
  };
}
