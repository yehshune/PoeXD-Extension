import type { BookmarkCollectionGroup, BookmarkReorderPlacement } from './bookmark-collection';
import type { FolderDropIntent } from './bookmark-folder-tree';
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
import type { SearchRecordOutcome } from './search-records';
import {
  subscribeSearchRecordChange,
  type SearchRecordChangeListener,
} from './search-record-messaging';
import {
  broadcastToTradeTabs,
  callBackgroundWithUnavailable,
  createRefCountedChangeHub,
  registerReadyGatedHandler,
  type ChangeListener,
  type RefCountedChangeHub,
  type TradeTabBroadcastTransport,
} from './background-messaging';
import { extensionMessaging } from './extension-protocol';

export interface BookmarkClientTransport {
  execute(command: BookmarkCommand): Promise<SearchRecordOutcome | undefined>;
  read(read: BookmarkRead): Promise<BookmarkReadOutcome | undefined>;
  subscribeBookmarkChange(listener: (change: BookmarkChange) => void): () => void;
}

export type BookmarkBroadcastTransport = TradeTabBroadcastTransport<BookmarkChange>;

export type BookmarkChangeListener = ChangeListener<BookmarkChange>;

export type BookmarkChangeHub = RefCountedChangeHub<BookmarkChange>;

export function createBookmarkChangeHub(messenger = extensionMessaging): BookmarkChangeHub {
  return createRefCountedChangeHub('bookmark:change', messenger);
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
  const execute = (command: BookmarkCommand): Promise<SearchRecordOutcome> =>
    callBackgroundWithUnavailable(
      () => transport.execute(command),
      'Bookmark background did not respond',
    );

  const read = (request: BookmarkRead): Promise<BookmarkReadOutcome> =>
    callBackgroundWithUnavailable(
      () => transport.read(request),
      'Bookmark background did not respond',
    );

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
  await broadcastToTradeTabs(change, transport);
}

export function registerBookmarkBackgroundHandlers(options: {
  messenger?: typeof extensionMessaging;
  getCoordinator: () => BookmarkCoordinator;
  getReady: () => Promise<SearchRecordOutcome>;
}): () => void {
  const offExecute = registerReadyGatedHandler('bookmark:execute', {
    messenger: options.messenger,
    getReady: options.getReady,
    handle: (command) => options.getCoordinator().execute(command),
  });

  const offRead = registerReadyGatedHandler('bookmark:read', {
    messenger: options.messenger,
    getReady: options.getReady,
    handle: (read) => options.getCoordinator().read(read),
  });

  return () => {
    offExecute();
    offRead();
  };
}
