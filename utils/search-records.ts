import { decodeRepeatedly, type PoeVersion } from './trade-context';
import { parseTradeSearchUrl, withTradeLeague } from './trade-search-identity';
import { isValidPoeCdnImageUrl } from './poe-cdn-url';

export const SEARCH_RECORD_STATE_KEY = 'poexdSearchRecordStateV1';

export interface SearchRecordIdentityInput {
  gameVersion: PoeVersion;
  league?: string;
  searchId?: string;
  url?: string;
}

export interface SearchRecord {
  id: string;
  gameVersion: PoeVersion;
  league: string;
  searchId: string;
  name?: string;
  icon?: string;
  url?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

export interface HistoryEntry {
  id: string;
  searchRecordId: string;
  gameVersion: PoeVersion;
  name: string;
  url: string;
  icon?: string;
  visitedAt: number;
}

export interface BookmarkReference {
  id: string;
  searchRecordId: string;
  gameVersion: PoeVersion;
}

export interface BookmarkRecordView {
  reference: BookmarkReference;
  record: SearchRecord;
}

export interface SearchRecordState {
  schemaVersion: 1;
  migrationComplete: true;
  searchRecords: Record<string, SearchRecord>;
  historyEntries: HistoryEntry[];
  bookmarkReferences: BookmarkReference[];
  historyEnabled: Record<PoeVersion, boolean>;
}

export type SearchRecordCommand =
  | {
      type: 'upsert-search-record';
      identity: SearchRecordIdentityInput;
      patch: Partial<Pick<SearchRecord, 'name' | 'icon' | 'url'>>;
      usedAt?: number;
    }
  | {
      type: 'record-history';
      identity: SearchRecordIdentityInput;
      entry: Pick<HistoryEntry, 'name' | 'url'> & Partial<Pick<HistoryEntry, 'icon'>>;
    }
  | { type: 'set-history-enabled'; gameVersion: PoeVersion; enabled: boolean }
  | { type: 'delete-history-entry'; entryId: string }
  | { type: 'clear-history'; gameVersion: PoeVersion }
  | {
      type: 'put-bookmark-reference';
      bookmark: {
        id: string;
        identity: SearchRecordIdentityInput;
        url: string;
      };
    }
  | { type: 'delete-bookmark-reference'; gameVersion: PoeVersion; bookmarkId: string }
  | {
      type: 'delete-bookmark-references';
      gameVersion: PoeVersion;
      bookmarkIds: string[];
    }
  | {
      type: 'replace-bookmark-league';
      gameVersion: PoeVersion;
      bookmarkIds: string[];
      league: string;
    }
  | {
      type: 'import-bookmark-references';
      gameVersion: PoeVersion;
      mode: 'merge' | 'overwrite';
      bookmarks: Array<{
        id: string;
        url: string;
        record?: SearchRecord;
      }>;
    };

export type SearchRecordRead =
  | { type: 'get-search-record'; identity: SearchRecordIdentityInput }
  | { type: 'list-history'; gameVersion: PoeVersion }
  | { type: 'get-history-view'; gameVersion: PoeVersion }
  | { type: 'get-history-enabled'; gameVersion: PoeVersion }
  | { type: 'get-bookmark-records'; gameVersion: PoeVersion }
  | { type: 'get-state' };

export type SearchRecordOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; error: SearchRecordError };

export type SearchRecordReadOutcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: SearchRecordError };

export interface SearchRecordError {
  code: 'not-initialized' | 'invalid-identity' | 'storage-failure' | 'unavailable';
  message: string;
}

export interface SearchRecordChange {
  command: SearchRecordCommand;
}

export interface SearchRecordStorage {
  load(): Promise<{ state?: SearchRecordState; legacy: Record<string, unknown> }>;
  commit(state: SearchRecordState): Promise<void>;
}

export interface SearchRecordModule {
  initialize(): Promise<SearchRecordOutcome>;
  execute(command: SearchRecordCommand): Promise<SearchRecordOutcome>;
  read(read: {
    type: 'get-search-record';
    identity: SearchRecordIdentityInput;
  }): Promise<SearchRecordReadOutcome<SearchRecord | undefined>>;
  read(read: {
    type: 'list-history';
    gameVersion: PoeVersion;
  }): Promise<SearchRecordReadOutcome<HistoryEntry[]>>;
  read(read: {
    type: 'get-history-view';
    gameVersion: PoeVersion;
  }): Promise<SearchRecordReadOutcome<HistoryEntry[]>>;
  read(read: {
    type: 'get-history-enabled';
    gameVersion: PoeVersion;
  }): Promise<SearchRecordReadOutcome<boolean>>;
  read(read: {
    type: 'get-bookmark-records';
    gameVersion: PoeVersion;
  }): Promise<SearchRecordReadOutcome<BookmarkRecordView[]>>;
  read(read: { type: 'get-state' }): Promise<SearchRecordReadOutcome<SearchRecordState>>;
  read(read: SearchRecordRead): Promise<SearchRecordReadOutcome>;
  subscribe(listener: (change: SearchRecordChange) => void): () => void;
}

export interface SearchRecordRuntime extends SearchRecordModule {
  initializeCoordinated(
    commit: (candidate: SearchRecordState) => Promise<void>,
  ): Promise<SearchRecordOutcome>;
  coordinate(
    command: SearchRecordCommand,
    commit: (candidate: SearchRecordState) => Promise<void>,
  ): Promise<SearchRecordOutcome>;
}

interface ChromeStorageArea {
  get(keys?: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function createChromeSearchRecordStorage(area: ChromeStorageArea): SearchRecordStorage {
  return {
    async load() {
      const values = await area.get(null);
      return {
        state: isSearchRecordState(values[SEARCH_RECORD_STATE_KEY])
          ? clone(values[SEARCH_RECORD_STATE_KEY])
          : undefined,
        legacy: values,
      };
    },
    async commit(state) {
      await area.set({ [SEARCH_RECORD_STATE_KEY]: clone(state) });
    },
  };
}

export function createInMemorySearchRecordStorage(initial: Record<string, unknown> = {}) {
  const values = clone(initial);
  const storage: SearchRecordStorage & { inspect(): Record<string, unknown> } = {
    async load() {
      return {
        state: isSearchRecordState(values[SEARCH_RECORD_STATE_KEY])
          ? clone(values[SEARCH_RECORD_STATE_KEY])
          : undefined,
        legacy: clone(values),
      };
    },
    async commit(state) {
      values[SEARCH_RECORD_STATE_KEY] = clone(state);
    },
    inspect() {
      return clone(values);
    },
  };
  return storage;
}

export function createSearchRecordModule(
  storage: SearchRecordStorage,
  now: () => number = Date.now,
): SearchRecordRuntime {
  let liveState: SearchRecordState | undefined;
  let mutationQueue = Promise.resolve();
  const listeners = new Set<(change: SearchRecordChange) => void>();

  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const initializeOperation = async (
    commit: (candidate: SearchRecordState) => Promise<void>,
  ): Promise<SearchRecordOutcome> => {
    if (liveState) return { ok: true, changed: false };
    try {
      const loaded = await storage.load();
      if (loaded.state) {
        liveState = normalizeSearchRecordState(loaded.state);
        return { ok: true, changed: false };
      }
      const migrated = migrateLegacyState(loaded.legacy);
      await commit(clone(migrated));
      liveState = migrated;
      return { ok: true, changed: true };
    } catch (error) {
      return storageFailure(error);
    }
  };

  const initialize = () =>
    enqueue(() => initializeOperation((candidate) => storage.commit(candidate)));
  const initializeCoordinated = (commit: (candidate: SearchRecordState) => Promise<void>) =>
    enqueue(() => initializeOperation(commit));

  const mutate = async (
    command: SearchRecordCommand,
    commit: (candidate: SearchRecordState) => Promise<void>,
    commitUnchanged = false,
  ): Promise<SearchRecordOutcome> => {
    if (!liveState) return notInitialized();
    const candidate = clone(liveState);
    let changed: boolean;
    try {
      changed = applyCommand(candidate, command, now);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'invalid-identity',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (!changed) {
      if (commitUnchanged) {
        try {
          await commit(clone(liveState));
        } catch (error) {
          return storageFailure(error);
        }
      }
      return { ok: true, changed: false };
    }
    evictSearchRecords(candidate);
    if (JSON.stringify(candidate) === JSON.stringify(liveState)) {
      if (commitUnchanged) {
        try {
          await commit(clone(liveState));
        } catch (error) {
          return storageFailure(error);
        }
      }
      return { ok: true, changed: false };
    }
    try {
      await commit(clone(candidate));
    } catch (error) {
      return storageFailure(error);
    }
    liveState = candidate;
    const change = { command };
    listeners.forEach((listener) => {
      try {
        listener(change);
      } catch {
        // Subscribers cannot turn a committed mutation into an apparent failure.
      }
    });
    return { ok: true, changed: true };
  };

  const execute = (command: SearchRecordCommand) =>
    enqueue(() => mutate(command, (candidate) => storage.commit(candidate)));

  const coordinate = (
    command: SearchRecordCommand,
    commit: (candidate: SearchRecordState) => Promise<void>,
  ) => enqueue(() => mutate(command, commit, true));

  const read = async (request: SearchRecordRead): Promise<SearchRecordReadOutcome> => {
    if (!liveState) return notInitialized();
    try {
      switch (request.type) {
        case 'get-search-record': {
          const identity = canonicalizeIdentity(request.identity);
          return { ok: true, value: clone(liveState.searchRecords[identity.id]) };
        }
        case 'list-history':
          return {
            ok: true,
            value: clone(
              liveState.historyEntries.filter((entry) => entry.gameVersion === request.gameVersion),
            ),
          };
        case 'get-history-view':
          return {
            ok: true,
            value: clone(
              liveState.historyEntries
                .filter((entry) => entry.gameVersion === request.gameVersion)
                .map((entry) => {
                  const record = liveState!.searchRecords[entry.searchRecordId];
                  return {
                    ...entry,
                    name: record?.name ?? entry.name,
                    url: record?.url ?? entry.url,
                    ...(record?.icon ? { icon: record.icon } : {}),
                  };
                }),
            ),
          };
        case 'get-history-enabled':
          return { ok: true, value: liveState.historyEnabled[request.gameVersion] };
        case 'get-bookmark-records':
          return {
            ok: true,
            value: liveState.bookmarkReferences
              .filter((reference) => reference.gameVersion === request.gameVersion)
              .map((reference) => ({
                reference: clone(reference),
                record: clone(liveState!.searchRecords[reference.searchRecordId]),
              })),
          };
        case 'get-state':
          return { ok: true, value: clone(liveState) };
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'invalid-identity',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };

  return {
    initialize,
    initializeCoordinated,
    execute,
    coordinate,
    read,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as SearchRecordRuntime;
}

function applyCommand(
  state: SearchRecordState,
  command: SearchRecordCommand,
  now: () => number,
): boolean {
  switch (command.type) {
    case 'upsert-search-record': {
      const identity = canonicalizeIdentity(command.identity);
      assertValidSearchRecordIcon(command.patch.icon);
      upsertRecord(state, identity, command.patch, command.usedAt);
      return true;
    }
    case 'record-history': {
      const identity = canonicalizeIdentity(command.identity);
      assertValidSearchRecordIcon(command.entry.icon);
      const visitedAt = now();
      upsertRecord(
        state,
        identity,
        {
          name: command.entry.name,
          icon: command.entry.icon,
          url: command.entry.url,
        },
        visitedAt,
      );
      if (!state.historyEnabled[identity.gameVersion]) return true;
      putHistoryEntry(state, identity, {
        ...command.entry,
        visitedAt,
      });
      return true;
    }
    case 'set-history-enabled':
      if (state.historyEnabled[command.gameVersion] === command.enabled) return false;
      state.historyEnabled[command.gameVersion] = command.enabled;
      return true;
    case 'delete-history-entry': {
      const next = state.historyEntries.filter((entry) => entry.id !== command.entryId);
      if (next.length === state.historyEntries.length) return false;
      state.historyEntries = next;
      return true;
    }
    case 'clear-history': {
      const next = state.historyEntries.filter(
        (entry) => entry.gameVersion !== command.gameVersion,
      );
      if (next.length === state.historyEntries.length) return false;
      state.historyEntries = next;
      return true;
    }
    case 'put-bookmark-reference': {
      const identity = canonicalizeIdentity(command.bookmark.identity);
      upsertRecord(
        state,
        identity,
        {
          url: command.bookmark.url,
        },
        now(),
      );
      const reference: BookmarkReference = {
        id: command.bookmark.id,
        searchRecordId: identity.id,
        gameVersion: identity.gameVersion,
      };
      const index = state.bookmarkReferences.findIndex(
        (item) => item.id === reference.id && item.gameVersion === reference.gameVersion,
      );
      if (index === -1) state.bookmarkReferences.push(reference);
      else state.bookmarkReferences[index] = reference;
      return true;
    }
    case 'delete-bookmark-reference': {
      assertGameVersion(command.gameVersion);
      const next = state.bookmarkReferences.filter(
        (reference) =>
          reference.gameVersion !== command.gameVersion || reference.id !== command.bookmarkId,
      );
      if (next.length === state.bookmarkReferences.length) return false;
      state.bookmarkReferences = next;
      return true;
    }
    case 'delete-bookmark-references': {
      assertGameVersion(command.gameVersion);
      const bookmarkIds = new Set(command.bookmarkIds);
      const next = state.bookmarkReferences.filter(
        (reference) =>
          reference.gameVersion !== command.gameVersion || !bookmarkIds.has(reference.id),
      );
      if (next.length === state.bookmarkReferences.length) return false;
      state.bookmarkReferences = next;
      return true;
    }
    case 'replace-bookmark-league': {
      assertGameVersion(command.gameVersion);
      const bookmarkIds = new Set(command.bookmarkIds);
      let changed = false;
      state.bookmarkReferences = state.bookmarkReferences.map((reference) => {
        if (reference.gameVersion !== command.gameVersion || !bookmarkIds.has(reference.id)) {
          return reference;
        }
        const source = state.searchRecords[reference.searchRecordId];
        const url = withTradeLeague(source?.url ?? '', command.league);
        if (!source || !url) throw new Error(`Bookmark ${reference.id} has no valid Trade URL`);
        const identity = canonicalizeIdentity({ gameVersion: command.gameVersion, url });
        if (identity.id === reference.searchRecordId) return reference;
        const existing = state.searchRecords[identity.id];
        state.searchRecords[identity.id] = {
          ...source,
          ...existing,
          id: identity.id,
          gameVersion: identity.gameVersion,
          league: identity.league,
          searchId: identity.searchId,
          url,
          createdAt: Math.min(source.createdAt, existing?.createdAt ?? source.createdAt),
          updatedAt: Math.max(source.updatedAt, existing?.updatedAt ?? source.updatedAt),
          lastUsedAt: Math.max(source.lastUsedAt, existing?.lastUsedAt ?? source.lastUsedAt),
        };
        changed = true;
        return { ...reference, searchRecordId: identity.id };
      });
      return changed;
    }
    case 'import-bookmark-references': {
      assertGameVersion(command.gameVersion);
      const imported = command.bookmarks.map((bookmark) => {
        const identity = canonicalizeIdentity({
          gameVersion: command.gameVersion,
          url: bookmark.url,
        });
        if (bookmark.record) {
          if (!isPortableSearchRecord(bookmark.record, command.gameVersion)) {
            throw new Error('Bookmark import contains an invalid Search Record');
          }
          const recordIdentity = canonicalizeIdentity({
            gameVersion: bookmark.record.gameVersion,
            league: bookmark.record.league,
            searchId: bookmark.record.searchId,
          });
          if (recordIdentity.id !== identity.id) {
            throw new Error('Bookmark import Search Record identity does not match its URL');
          }
        }
        if (bookmark.record || !state.searchRecords[identity.id]) {
          upsertRecord(
            state,
            identity,
            {
              name: bookmark.record?.name,
              icon: bookmark.record?.icon,
              url: bookmark.record?.url ?? bookmark.url,
            },
            bookmark.record?.lastUsedAt ?? now(),
          );
        } else if (!state.searchRecords[identity.id].url) {
          state.searchRecords[identity.id].url = bookmark.url;
        }
        if (bookmark.record) {
          const merged = state.searchRecords[identity.id];
          merged.createdAt = Math.min(merged.createdAt, bookmark.record.createdAt);
          merged.updatedAt = Math.max(merged.updatedAt, bookmark.record.updatedAt);
          merged.lastUsedAt = Math.max(merged.lastUsedAt, bookmark.record.lastUsedAt);
        }
        return {
          id: bookmark.id,
          searchRecordId: identity.id,
          gameVersion: command.gameVersion,
        };
      });
      if (command.mode === 'overwrite') {
        state.bookmarkReferences = state.bookmarkReferences.filter(
          (reference) => reference.gameVersion !== command.gameVersion,
        );
      }
      imported.forEach((reference) => {
        if (
          command.mode === 'merge' &&
          state.bookmarkReferences.some(
            (existing) =>
              existing.gameVersion === command.gameVersion && existing.id === reference.id,
          )
        )
          return;
        state.bookmarkReferences.push(reference);
      });
      return true;
    }
  }
}

export function isPortableSearchRecord(
  value: unknown,
  gameVersion: PoeVersion,
): value is SearchRecord & { url: string } {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    value.id === '' ||
    value.gameVersion !== gameVersion ||
    typeof value.league !== 'string' ||
    value.league === '' ||
    typeof value.searchId !== 'string' ||
    value.searchId === '' ||
    typeof value.url !== 'string' ||
    value.url === '' ||
    'query' in value ||
    !isFiniteTimestamp(value.createdAt) ||
    !isFiniteTimestamp(value.updatedAt) ||
    !isFiniteTimestamp(value.lastUsedAt)
  ) {
    return false;
  }
  return (
    (value.name === undefined || (typeof value.name === 'string' && value.name !== '')) &&
    (value.icon === undefined || isValidPoeCdnImageUrl(value.icon))
  );
}

function assertValidSearchRecordIcon(icon: unknown) {
  if (icon !== undefined && !isValidPoeCdnImageUrl(icon)) {
    throw new Error('Search Record icon must be a valid PoE CDN image URL');
  }
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertGameVersion(gameVersion: PoeVersion) {
  if (gameVersion !== 'poe1' && gameVersion !== 'poe2') {
    throw new Error('Bookmark operation requires a valid game version');
  }
}

interface CanonicalIdentity {
  id: string;
  gameVersion: PoeVersion;
  league: string;
  searchId: string;
}

function canonicalizeIdentity(input: SearchRecordIdentityInput): CanonicalIdentity {
  if (input.gameVersion !== 'poe1' && input.gameVersion !== 'poe2') {
    throw new Error('Search Record identity requires a valid game version');
  }
  let league = input.league;
  let searchId = input.searchId;
  if (input.url) {
    const parsed = parseTradeSearchUrl(input.url);
    if (!parsed && (!league || !searchId)) {
      throw new Error('Search Record URL does not contain a search identity');
    }
    if (parsed && parsed.gameVersion !== input.gameVersion) {
      throw new Error('Search Record URL game version does not match its identity');
    }
    league ??= parsed?.league;
    searchId ??= parsed?.searchId;
  }
  const canonicalLeague = decodeRepeatedly(league ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const canonicalSearchId = decodeRepeatedly(searchId ?? '').trim();
  if (!canonicalLeague || !canonicalSearchId) {
    throw new Error('Search Record identity requires a league and search ID');
  }
  return {
    id: `${input.gameVersion}:${encodeURIComponent(canonicalLeague)}:${encodeURIComponent(canonicalSearchId)}`,
    gameVersion: input.gameVersion,
    league: canonicalLeague,
    searchId: canonicalSearchId,
  };
}

function upsertRecord(
  state: SearchRecordState,
  identity: CanonicalIdentity,
  patch: Partial<Pick<SearchRecord, 'name' | 'icon' | 'url'>>,
  usedAt = Date.now(),
) {
  const existing = state.searchRecords[identity.id];
  const enriched = mergeKnown(existing ?? {}, patch) as Partial<SearchRecord>;
  state.searchRecords[identity.id] = {
    ...enriched,
    id: identity.id,
    gameVersion: identity.gameVersion,
    league: identity.league,
    searchId: identity.searchId,
    createdAt: existing?.createdAt ?? usedAt,
    updatedAt: Math.max(existing?.updatedAt ?? 0, usedAt),
    lastUsedAt: Math.max(existing?.lastUsedAt ?? 0, usedAt),
  };
}

function putHistoryEntry(
  state: SearchRecordState,
  identity: CanonicalIdentity,
  entry: Pick<HistoryEntry, 'name' | 'url' | 'visitedAt'> & Partial<Pick<HistoryEntry, 'icon'>>,
) {
  const existing = state.historyEntries.find((item) => item.searchRecordId === identity.id);
  const next: HistoryEntry = {
    id: existing?.id ?? `history:${identity.id}`,
    searchRecordId: identity.id,
    gameVersion: identity.gameVersion,
    name: entry.name,
    url: entry.url,
    ...((entry.icon ?? existing?.icon) ? { icon: entry.icon ?? existing?.icon } : {}),
    visitedAt: entry.visitedAt,
  };
  state.historyEntries = [
    next,
    ...state.historyEntries.filter((item) => item.searchRecordId !== identity.id),
  ];
  const sameVersion = state.historyEntries
    .filter((item) => item.gameVersion === identity.gameVersion)
    .sort((left, right) => right.visitedAt - left.visitedAt)
    .slice(0, 50);
  const otherVersion = state.historyEntries.filter(
    (item) => item.gameVersion !== identity.gameVersion,
  );
  state.historyEntries = [...sameVersion, ...otherVersion];
}

export const MAX_UNREFERENCED_SEARCH_RECORDS = 50;
export const SEARCH_RECORD_EVICTION_BATCH = 25;

function evictSearchRecords(state: SearchRecordState) {
  const records = Object.values(state.searchRecords);
  const referenced = new Set([
    ...state.historyEntries.map((entry) => entry.searchRecordId),
    ...state.bookmarkReferences.map((reference) => reference.searchRecordId),
  ]);
  const candidates = records
    .filter((record) => !referenced.has(record.id))
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  while (candidates.length > MAX_UNREFERENCED_SEARCH_RECORDS) {
    candidates
      .splice(0, SEARCH_RECORD_EVICTION_BATCH)
      .forEach((record) => delete state.searchRecords[record.id]);
  }
}

function migrateLegacyState(legacy: Record<string, unknown>): SearchRecordState {
  const state = emptyState();
  for (const version of ['poe1', 'poe2'] as const) {
    state.historyEnabled[version] = readLegacyEnabled(legacy, version);
    migrateHistory(state, legacy, version);
    migrateBookmarks(state, legacy, version);
  }
  evictSearchRecords(state);
  return state;
}

function migrateHistory(
  state: SearchRecordState,
  legacy: Record<string, unknown>,
  version: PoeVersion,
) {
  const entries = legacyArray(legacy, `history_${version}`, 'history');
  entries.forEach((value, order) => {
    if (!isObject(value) || typeof value.url !== 'string') return;
    if (!urlMatchesVersion(value.url, version)) return;
    try {
      const identity = canonicalizeIdentity({ gameVersion: version, url: value.url });
      const visitedAt = toTimestamp(value.date, entries.length - order);
      const name = typeof value.name === 'string' ? value.name : '未命名搜尋';
      const rawIcon = typeof value.icon === 'string' ? value.icon : undefined;
      const icon = isValidPoeCdnImageUrl(rawIcon) ? rawIcon : undefined;
      const retainedEntry = state.historyEntries.find(
        (entry) => entry.searchRecordId === identity.id,
      );
      const alreadyReferenced = retainedEntry !== undefined;
      const existing = state.searchRecords[identity.id];
      upsertRecord(
        state,
        identity,
        alreadyReferenced
          ? {
              name: existing?.name ?? name,
              icon: existing?.icon ?? icon,
              url: existing?.url ?? value.url,
            }
          : {
              name,
              icon,
              url: value.url,
            },
        visitedAt,
      );
      if (retainedEntry && !retainedEntry.icon && icon) retainedEntry.icon = icon;
      if (!alreadyReferenced) {
        state.historyEntries.push({
          id: `history:${identity.id}`,
          searchRecordId: identity.id,
          gameVersion: identity.gameVersion,
          name,
          url: value.url,
          icon,
          visitedAt,
        });
      }
    } catch {
      // A malformed legacy item remains in its legacy key for recovery.
    }
  });
  const retained = state.historyEntries
    .filter((entry) => entry.gameVersion === version)
    .slice(0, 50);
  state.historyEntries = [
    ...state.historyEntries.filter((entry) => entry.gameVersion !== version),
    ...retained,
  ];
}

function migrateBookmarks(
  state: SearchRecordState,
  legacy: Record<string, unknown>,
  version: PoeVersion,
) {
  const bookmarks = legacyArray(legacy, `bookmarks_${version}`, 'bookmarks');
  bookmarks.forEach((value, order) => {
    if (!isObject(value) || typeof value.url !== 'string') return;
    if (!urlMatchesVersion(value.url, version)) return;
    try {
      const identity = canonicalizeIdentity({ gameVersion: version, url: value.url });
      const existing = state.searchRecords[identity.id];
      const createdAt = toOptionalTimestamp(value.createdAt);
      upsertRecord(
        state,
        identity,
        {
          name: existing?.name ?? (typeof value.name === 'string' ? value.name : undefined),
          url: value.url,
        },
        createdAt ?? existing?.lastUsedAt,
      );
      state.bookmarkReferences.push({
        id: typeof value.id === 'string' ? value.id : `bookmark:${version}:${order}`,
        searchRecordId: identity.id,
        gameVersion: version,
      });
    } catch {
      // A malformed legacy item remains in its legacy key for recovery.
    }
  });
}

function emptyState(): SearchRecordState {
  return {
    schemaVersion: 1,
    migrationComplete: true,
    searchRecords: {},
    historyEntries: [],
    bookmarkReferences: [],
    historyEnabled: { poe1: true, poe2: true },
  };
}

function normalizeSearchRecordState(state: SearchRecordState): SearchRecordState {
  const bestEntries = new Map<string, HistoryEntry>();
  const entries = Array.isArray(state.historyEntries) ? state.historyEntries : [];
  for (const entry of entries) {
    if (!entry || typeof entry.searchRecordId !== 'string') continue;
    const existing = bestEntries.get(entry.searchRecordId);
    if (!existing || (entry.visitedAt ?? 0) > (existing.visitedAt ?? 0)) {
      bestEntries.set(entry.searchRecordId, clone(entry));
    }
  }

  const normalizedHistory = Array.from(bestEntries.values()).sort(
    (left, right) => (right.visitedAt ?? 0) - (left.visitedAt ?? 0),
  );

  return {
    ...clone(state),
    historyEntries: normalizedHistory,
    bookmarkReferences: state.bookmarkReferences.map((reference) => ({
      id: reference.id,
      searchRecordId: reference.searchRecordId,
      gameVersion: reference.gameVersion,
    })),
  };
}

function readLegacyEnabled(legacy: Record<string, unknown>, version: PoeVersion) {
  const versioned = legacy[`enableHistory_${version}`];
  if (typeof versioned === 'boolean') return versioned;
  return legacy.enableHistory !== false;
}

function legacyArray(legacy: Record<string, unknown>, versionedKey: string, fallbackKey: string) {
  const value = legacy[versionedKey] ?? legacy[fallbackKey];
  return Array.isArray(value) ? value : [];
}

function urlMatchesVersion(url: string, version: PoeVersion) {
  const isPoe2 = url.includes('/trade2/') || url.includes('/poe2/');
  return version === 'poe2' ? isPoe2 : !isPoe2;
}

function mergeKnown(existing: unknown, incoming: unknown): unknown {
  if (!isObject(existing) || !isObject(incoming)) {
    return incoming === undefined || incoming === null ? clone(existing) : clone(incoming);
  }
  const result: Record<string, unknown> = clone(existing);
  Object.entries(incoming).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    result[key] = mergeKnown(result[key], value);
  });
  return result;
}

function toTimestamp(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toOptionalTimestamp(value: unknown) {
  const timestamp = toTimestamp(value, Number.NaN);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isSearchRecordState(value: unknown): value is SearchRecordState {
  return (
    isObject(value) &&
    value.schemaVersion === 1 &&
    value.migrationComplete === true &&
    isObject(value.searchRecords) &&
    Object.values(value.searchRecords).every(
      (record) =>
        isObject(record) &&
        !('query' in record) &&
        (record.icon === undefined || isValidPoeCdnImageUrl(record.icon)),
    ) &&
    Array.isArray(value.historyEntries) &&
    value.historyEntries.every(
      (entry) => isObject(entry) && (entry.icon === undefined || isValidPoeCdnImageUrl(entry.icon)),
    ) &&
    Array.isArray(value.bookmarkReferences)
  );
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

function notInitialized(): SearchRecordOutcome & SearchRecordReadOutcome {
  return {
    ok: false,
    error: { code: 'not-initialized', message: 'Search Record module is not initialized' },
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
