import { planRejectedStorageBackups } from './rejected-storage-backup';
import {
  BOOKMARK_COLLECTION_STATE_KEY,
  BOOKMARK_COLLECTION_STATE_KEY_V2,
  canonicalizeBookmarkCollectionState,
  createBookmarkCollectionModule,
  createDefaultBookmarkCollectionState,
  isBookmarkCollectionState,
  isBookmarkCollectionStateV3,
  isBookmarkCollectionStateV2,
  isCanonicalBookmarkCollectionStateV3,
  isCompatBookmarkCollectionStateV3,
  migrateBookmarkCollectionStateV2ToV3,
  getSubtreeBookmarkIds,
  type FolderDropIntent,
  type BookmarkCollectionGroup,
  type BookmarkCollectionItem,
  type BookmarkCollectionModule,
  type BookmarkFolder,
  type BookmarkPlacement,
  type BookmarkReorderPlacement,
  type BookmarkCollectionState,
} from './bookmark-collection';
import type { PoeVersion } from './trade-context';
import { BOOKMARK_AUTO_LEAGUE } from './bookmark-target';
import {
  buildBookmarkTransfer,
  prepareBookmarkTransferImport,
  type BookmarkImportMode,
  type BookmarkTransferPayload,
} from './bookmark-transfer';
import {
  SEARCH_RECORD_STATE_KEY,
  type SearchRecord,
  type SearchRecordError,
  type SearchRecordOutcome,
  type SearchRecordRuntime,
  type SearchRecordState,
} from './search-records';

export interface BookmarkInput extends BookmarkPlacement {
  url: string;
  record?: SearchRecord;
}

export interface BookmarkViewItem extends BookmarkCollectionItem {
  searchRecordId: string;
  url: string;
}

export interface BookmarkCollectionView {
  groups: BookmarkCollectionGroup[];
  bookmarks: BookmarkViewItem[];
}

export type BookmarkCommand =
  | {
      type: 'put-group';
      gameVersion: PoeVersion;
      group: Omit<BookmarkCollectionGroup, 'gameVersion'>;
    }
  | { type: 'delete-group'; gameVersion: PoeVersion; groupId: string }
  | {
      type: 'move-folder';
      gameVersion: PoeVersion;
      folderId: string;
      targetParentId?: string;
      order?: number;
      dropIntent?: FolderDropIntent;
    }
  | { type: 'reorder-groups'; gameVersion: PoeVersion; groupIds: string[] }
  | { type: 'put-bookmark'; gameVersion: PoeVersion; bookmark: BookmarkInput }
  | { type: 'delete-bookmark'; gameVersion: PoeVersion; bookmarkId: string }
  | {
      type: 'reorder-bookmarks';
      gameVersion: PoeVersion;
      placements: BookmarkReorderPlacement[];
    }
  | {
      type: 'replace-bookmark-league';
      gameVersion: PoeVersion;
      scope: 'collection' | 'folder';
      groupId?: string;
      league: string;
    }
  | {
      type: 'import-transfer';
      gameVersion: PoeVersion;
      mode: BookmarkImportMode;
      targetGroupId?: string;
      payload: unknown;
    }
  | { type: 'clear-collection'; gameVersion: PoeVersion };

export type BookmarkRead =
  | { type: 'get-collection'; gameVersion: PoeVersion }
  | {
      type: 'get-transfer';
      gameVersion: PoeVersion;
      scope: 'collection' | 'folder';
      groupId?: string;
    };

export type BookmarkReadOutcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: SearchRecordError };

export interface BookmarkChange {
  command: BookmarkCommand;
}

export interface BookmarkCoordinatorStorage {
  load(): Promise<{ state?: BookmarkCollectionState; migrated?: boolean }>;
  commitBookmarks(state: BookmarkCollectionState): Promise<void>;
  commitCoordinated(
    searchState: SearchRecordState,
    bookmarkState: BookmarkCollectionState,
  ): Promise<void>;
}

export function loadBookmarkCollectionFromStorage(values: Record<string, unknown>): {
  state?: BookmarkCollectionState;
  migrated?: boolean;
} {
  const v3Value = values[BOOKMARK_COLLECTION_STATE_KEY];
  if (isObject(v3Value) && v3Value.schemaVersion === 3) {
    if (isCompatBookmarkCollectionStateV3(v3Value)) {
      const isPureCanonical = isCanonicalBookmarkCollectionStateV3(v3Value);
      const state = canonicalizeBookmarkCollectionState(v3Value);
      return {
        state,
        migrated: !isPureCanonical,
      };
    }
    return { state: undefined, migrated: false };
  }
  const v2Value = values[BOOKMARK_COLLECTION_STATE_KEY_V2];
  if (isBookmarkCollectionStateV2(v2Value)) {
    return { state: migrateBookmarkCollectionStateV2ToV3(v2Value), migrated: true };
  }
  return { state: undefined, migrated: false };
}

export interface BookmarkCoordinator {
  initialize(): Promise<SearchRecordOutcome>;
  execute(command: BookmarkCommand): Promise<SearchRecordOutcome>;
  read(read: {
    type: 'get-collection';
    gameVersion: PoeVersion;
  }): Promise<BookmarkReadOutcome<BookmarkCollectionView>>;
  read(read: {
    type: 'get-transfer';
    gameVersion: PoeVersion;
    scope: 'collection' | 'folder';
    groupId?: string;
  }): Promise<BookmarkReadOutcome<BookmarkTransferPayload>>;
  read(read: BookmarkRead): Promise<BookmarkReadOutcome>;
  subscribe(listener: (change: BookmarkChange) => void): () => void;
}

/**
 * 載入結果沒有可用狀態，但儲存中確實有 V3 或 V2 資料時（驗證失敗），
 * 初始化會以預設狀態覆寫 V3 並刪除 V2；覆寫前先規劃備份。
 */
function planBookmarkRejectedBackups(
  values: Record<string, unknown>,
  loaded: { state?: BookmarkCollectionState },
  now: number,
) {
  if (loaded.state) return {};
  return planRejectedStorageBackups(
    values,
    [BOOKMARK_COLLECTION_STATE_KEY, BOOKMARK_COLLECTION_STATE_KEY_V2],
    now,
  );
}

export function createChromeBookmarkCoordinatorStorage(
  area: {
    get(keys?: null | string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove?(keys: string | string[]): Promise<void>;
  },
  now: () => number = Date.now,
): BookmarkCoordinatorStorage {
  return {
    async load() {
      const values = await area.get(null);
      const loaded = loadBookmarkCollectionFromStorage(values);
      const backups = planBookmarkRejectedBackups(values, loaded, now());
      if (Object.keys(backups).length > 0) {
        // 備份寫入失敗時直接拋出，讓初始化失敗而不是以預設狀態覆寫原資料
        await area.set(backups);
        console.warn('[PoeXD] 書籤狀態未通過驗證，已備份原始資料後重建');
      }
      return loaded;
    },
    async commitBookmarks(state) {
      await area.set({ [BOOKMARK_COLLECTION_STATE_KEY]: clone(state) });
      if (area.remove) {
        await area.remove(BOOKMARK_COLLECTION_STATE_KEY_V2);
      }
    },
    async commitCoordinated(searchState, bookmarkState) {
      await area.set({
        [SEARCH_RECORD_STATE_KEY]: clone(searchState),
        [BOOKMARK_COLLECTION_STATE_KEY]: clone(bookmarkState),
      });
      if (area.remove) {
        await area.remove(BOOKMARK_COLLECTION_STATE_KEY_V2);
      }
    },
  };
}

export function createInMemoryBookmarkCoordinatorStorage(
  initial: Record<string, unknown> = {},
  now: () => number = Date.now,
) {
  const values = clone(initial);
  const storage: BookmarkCoordinatorStorage & { inspect(): Record<string, unknown> } = {
    async load() {
      const loaded = loadBookmarkCollectionFromStorage(values);
      Object.assign(values, planBookmarkRejectedBackups(values, loaded, now()));
      return loaded;
    },
    async commitBookmarks(state) {
      delete values[BOOKMARK_COLLECTION_STATE_KEY_V2];
      values[BOOKMARK_COLLECTION_STATE_KEY] = clone(state);
    },
    async commitCoordinated(searchState, bookmarkState) {
      delete values[BOOKMARK_COLLECTION_STATE_KEY_V2];
      values[SEARCH_RECORD_STATE_KEY] = clone(searchState);
      values[BOOKMARK_COLLECTION_STATE_KEY] = clone(bookmarkState);
    },
    inspect() {
      return clone(values);
    },
  };
  return storage;
}

export function createBackgroundBookmarkCoordinator(
  searchRecords: SearchRecordRuntime,
  storage: BookmarkCoordinatorStorage,
): BookmarkCoordinator {
  let collection: BookmarkCollectionModule | undefined;
  let queue = Promise.resolve();
  const listeners = new Set<(change: BookmarkChange) => void>();

  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const initialize = () =>
    enqueue<SearchRecordOutcome>(async () => {
      if (collection) return { ok: true, changed: false };
      try {
        const loaded = await storage.load();
        const state = loaded.state ?? createDefaultBookmarkCollectionState();
        const searchOutcome = await searchRecords.initializeCoordinated((searchState) =>
          storage.commitCoordinated(searchState, state),
        );
        if (!searchOutcome.ok) return searchOutcome;
        if (!loaded.state && !searchOutcome.changed) {
          const searchState = await searchRecords.read({ type: 'get-state' });
          if (!searchState.ok) return searchState;
          await storage.commitCoordinated(searchState.value, state);
        } else if (loaded.migrated) {
          await storage.commitBookmarks(state);
        }
        collection = createBookmarkCollectionModule(state);
        return { ok: true, changed: searchOutcome.changed || !loaded.state || !!loaded.migrated };
      } catch (error) {
        return storageFailure(error);
      }
    });

  const execute = (command: BookmarkCommand) =>
    enqueue<SearchRecordOutcome>(async () => {
      if (!collection) return notInitialized();
      try {
        let preparedCommand: PreparedBookmarkCommand;
        if (command.type === 'import-transfer') {
          const view = await buildView(collection, searchRecords, command.gameVersion);
          if (!view.ok) return view;
          const transfer = prepareBookmarkTransferImport(
            command.payload,
            view.value,
            command.gameVersion,
            {
              mode: command.mode,
              targetGroupId: command.targetGroupId,
            },
          );
          preparedCommand = {
            type: 'import-collection',
            gameVersion: command.gameVersion,
            mode: 'overwrite',
            groups: transfer.groups,
            bookmarks: transfer.bookmarks,
          };
        } else {
          preparedCommand = command;
        }
        const prepared = prepareCollection(collection, preparedCommand);
        const searchCommand = toSearchRecordCommand(
          collection,
          preparedCommand,
          prepared.removedBookmarkIds,
        );
        if (!prepared.changed && !searchCommand) return { ok: true, changed: false };
        let outcome: SearchRecordOutcome;
        if (searchCommand) {
          outcome = await searchRecords.coordinate(searchCommand, (searchState) =>
            storage.commitCoordinated(searchState, prepared.state),
          );
        } else {
          try {
            await storage.commitBookmarks(prepared.state);
            outcome = { ok: true, changed: true };
          } catch (error) {
            outcome = storageFailure(error);
          }
        }
        if (!outcome.ok) return outcome;
        const changed = prepared.changed || outcome.changed;
        if (!changed) return { ok: true, changed: false };
        collection.accept(prepared.state);
        const change = { command };
        listeners.forEach((listener) => {
          try {
            listener(change);
          } catch {
            // Subscribers cannot change a committed outcome.
          }
        });
        return { ok: true, changed };
      } catch (error) {
        return invalid(error);
      }
    });

  const read = async (request: BookmarkRead): Promise<BookmarkReadOutcome> => {
    if (!collection) return notInitialized();
    try {
      const view = await buildView(collection, searchRecords, request.gameVersion);
      if (!view.ok) return view;
      if (request.type === 'get-collection') return view;
      return {
        ok: true,
        value: buildBookmarkTransfer(
          request.gameVersion,
          request.scope,
          view.value,
          request.groupId,
        ),
      };
    } catch (error) {
      return invalid(error);
    }
  };

  return {
    initialize,
    execute,
    read,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as BookmarkCoordinator;
}

type PreparedBookmarkCommand =
  | Exclude<BookmarkCommand, { type: 'import-transfer' }>
  | {
      type: 'import-collection';
      gameVersion: PoeVersion;
      mode: 'merge' | 'overwrite';
      groups: Array<{ id: string; name: string; order: number; parentId?: string }>;
      bookmarks: BookmarkInput[];
    };

function prepareCollection(collection: BookmarkCollectionModule, command: PreparedBookmarkCommand) {
  switch (command.type) {
    case 'put-group':
      return collection.prepare({
        type: 'put-group',
        group: { ...command.group, gameVersion: command.gameVersion },
      });
    case 'delete-group':
      return collection.prepare({
        type: 'delete-group',
        gameVersion: command.gameVersion,
        groupId: command.groupId,
      });
    case 'move-folder':
    case 'reorder-groups':
      return collection.prepare(command);
    case 'put-bookmark': {
      const { url: _url, record: _record, ...bookmark } = command.bookmark;
      return collection.prepare({
        type: 'put-bookmark',
        bookmark: {
          ...bookmark,
          gameVersion: command.gameVersion,
        },
      });
    }
    case 'import-collection':
      return collection.prepare({
        type: 'import-collection',
        gameVersion: command.gameVersion,
        mode: command.mode,
        groups: command.groups,
        bookmarks: command.bookmarks.map(({ url: _url, record: _record, ...bookmark }) => bookmark),
      });
    case 'replace-bookmark-league':
      return collection.prepare({
        type: 'set-league-pinned',
        gameVersion: command.gameVersion,
        bookmarkIds: resolveReplaceLeagueBookmarkIds(collection, command),
        pinned: !isAutoLeague(command.league),
      });
    default:
      return collection.prepare(command);
  }
}

function toSearchRecordCommand(
  collection: BookmarkCollectionModule,
  command: PreparedBookmarkCommand,
  removedBookmarkIds: string[],
) {
  switch (command.type) {
    case 'put-bookmark':
      return {
        type: 'put-bookmark-reference' as const,
        bookmark: {
          id: command.bookmark.id,
          identity: { gameVersion: command.gameVersion, url: command.bookmark.url },
          url: command.bookmark.url,
        },
      };
    case 'delete-bookmark':
      return {
        type: 'delete-bookmark-reference' as const,
        gameVersion: command.gameVersion,
        bookmarkId: command.bookmarkId,
      };
    case 'delete-group':
    case 'clear-collection':
      return removedBookmarkIds.length === 0
        ? undefined
        : {
            type: 'delete-bookmark-references' as const,
            gameVersion: command.gameVersion,
            bookmarkIds: removedBookmarkIds,
          };
    case 'import-collection':
      return {
        type: 'import-bookmark-references' as const,
        gameVersion: command.gameVersion,
        mode: command.mode,
        bookmarks: command.bookmarks.map((bookmark) => ({
          id: bookmark.id,
          url: bookmark.url,
          record: bookmark.record,
        })),
      };
    case 'replace-bookmark-league': {
      // 「自動」只切換書籤的聯盟模式，不改寫 Search Record。
      if (isAutoLeague(command.league)) return undefined;
      const bookmarkIds = resolveReplaceLeagueBookmarkIds(collection, command);
      return bookmarkIds.length === 0
        ? undefined
        : {
            type: 'replace-bookmark-league' as const,
            gameVersion: command.gameVersion,
            league: command.league,
            bookmarkIds,
          };
    }
    default:
      return undefined;
  }
}

function isAutoLeague(league: string) {
  return league.trim().toLowerCase() === BOOKMARK_AUTO_LEAGUE.toLowerCase();
}

function resolveReplaceLeagueBookmarkIds(
  collection: BookmarkCollectionModule,
  command: Extract<BookmarkCommand, { type: 'replace-bookmark-league' }>,
): string[] {
  const read = collection.read(command.gameVersion);
  if (command.scope === 'collection') return read.bookmarks.map((bookmark) => bookmark.id);
  if (command.scope !== 'folder') return [];
  if (!command.groupId || !read.groups.some((folder) => folder.id === command.groupId)) return [];
  return getSubtreeBookmarkIds(read.groups, read.bookmarks, command.groupId);
}

async function buildView(
  collection: BookmarkCollectionModule,
  searchRecords: SearchRecordRuntime,
  gameVersion: PoeVersion,
): Promise<BookmarkReadOutcome<BookmarkCollectionView>> {
  const collectionView = collection.read(gameVersion);
  const records = await searchRecords.read({ type: 'get-bookmark-records', gameVersion });
  if (!records.ok) return records;
  const recordsByBookmarkId = new Map(records.value.map((item) => [item.reference.id, item]));
  const bookmarks = collectionView.bookmarks.map((bookmark) => {
    const linked = recordsByBookmarkId.get(bookmark.id);
    if (!linked) throw new Error(`Bookmark ${bookmark.id} has no Search Record reference`);
    return {
      ...bookmark,
      searchRecordId: linked.reference.searchRecordId,
      url: linked.record.url ?? '',
    };
  });
  return {
    ok: true,
    value: {
      groups: collectionView.groups,
      bookmarks,
    },
  };
}

function notInitialized(): SearchRecordOutcome & BookmarkReadOutcome {
  return {
    ok: false,
    error: { code: 'not-initialized', message: 'Bookmark coordinator is not initialized' },
  };
}

function invalid(error: unknown): SearchRecordOutcome & BookmarkReadOutcome {
  return {
    ok: false,
    error: {
      code: 'invalid-identity',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function storageFailure(error: unknown): SearchRecordOutcome {
  return {
    ok: false,
    error: {
      code: 'storage-failure',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
