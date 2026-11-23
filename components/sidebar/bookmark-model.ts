import { readonly, ref, type DeepReadonly, type Ref } from 'vue';
import type { BookmarkClient } from '@/utils/bookmark-messaging';
import {
  BOOKMARK_NAME_MAX_LENGTH,
  isValidBookmarkName,
  getFolderSubtreeIds,
  getNextBookmarkOrder,
  resolveFolderDropPlacement,
  type BookmarkReorderPlacement,
  type FolderDropIntent,
} from '@/utils/bookmark-collection';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { applyFolderAppearance } from '@/utils/folder-icons';
import type { BookmarkInput } from '@/utils/bookmark-coordinator';
import type { BookmarkImportMode, BookmarkTransferPayload } from '@/utils/bookmark-transfer';
import type { SearchRecordError, SearchRecordOutcome } from '@/utils/search-records';
import {
  readBookmarkTargetContext,
  resolveBookmarkUrl,
  type BookmarkTargetContext,
} from '@/utils/bookmark-target';
import type { Bookmark, BookmarkGroup } from './bookmark-types';

export interface BookmarkModelState {
  bookmarks: Bookmark[];
  groups: BookmarkGroup[];
}

export type BookmarkMutationIntent =
  | { type: 'add-group'; group: BookmarkGroup }
  | { type: 'rename-group'; groupId: string; name: string }
  | { type: 'set-group-appearance'; groupId: string; icon?: string; color?: string }
  | { type: 'delete-group'; groupId: string }
  | {
      type: 'move-folder';
      folderId: string;
      targetParentId?: string;
      order?: number;
      dropIntent?: FolderDropIntent;
    }
  | { type: 'reorder-groups'; groupIds: string[] }
  /** order 由模型依目標資料夾決定（排在最後），呼叫端不需提供。 */
  | { type: 'add-bookmark'; bookmark: Omit<Bookmark, 'order'> }
  | { type: 'overwrite-bookmark'; bookmarkId: string; url: string; coverImageUrl?: string }
  | { type: 'rename-bookmark'; bookmarkId: string; name: string }
  /** 移到其他資料夾時排在該資料夾最後；同資料夾內維持原位置。 */
  | { type: 'move-bookmark'; bookmarkId: string; groupId: string }
  | { type: 'set-bookmark-cover'; bookmarkId: string; coverImageUrl?: string }
  | { type: 'delete-bookmark'; bookmarkId: string }
  | { type: 'reorder-bookmarks'; placements: BookmarkReorderPlacement[] }
  | {
      type: 'replace-league';
      scope: 'collection' | 'folder';
      league: string;
      groupId?: string;
    }
  | {
      type: 'import-transfer';
      payload: BookmarkTransferPayload;
      mode: BookmarkImportMode;
      targetGroupId?: string;
    }
  | { type: 'clear-collection' };

export type BookmarkModelIntent =
  | BookmarkMutationIntent
  | {
      type: 'export-transfer';
      scope: 'collection' | 'folder';
      groupId?: string;
    };

export type BookmarkModelOutcome<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: SearchRecordError };

export interface BookmarkModel {
  state: DeepReadonly<Ref<BookmarkModelState>>;
  connect(): Promise<BookmarkModelOutcome>;
  execute(
    intent: Extract<BookmarkModelIntent, { type: 'export-transfer' }>,
  ): Promise<BookmarkModelOutcome<BookmarkTransferPayload>>;
  execute(intent: BookmarkMutationIntent): Promise<BookmarkModelOutcome>;
  /** 目前網域或聯盟改變時重新解析書籤網址。 */
  refreshTargetContext(): void;
  dispose(): void;
}

export interface BookmarkModelOptions {
  /** 書籤網址解析情境（網域與聯盟），預設讀取目前頁面。 */
  resolveTargetContext?: () => BookmarkTargetContext;
}

interface Projection {
  bookmarks: Bookmark[];
  groups: BookmarkGroup[];
}

/** 已決定排序值的意圖：樂觀投影與背景寫入共用同一個 order。 */
type ResolvedMutationIntent =
  | Exclude<BookmarkMutationIntent, { type: 'add-bookmark' } | { type: 'move-bookmark' }>
  | { type: 'add-bookmark'; bookmark: Bookmark }
  | { type: 'move-bookmark'; bookmarkId: string; groupId: string; order: number };

interface PendingMutation {
  intent: ResolvedMutationIntent;
}

export function createBookmarkModel(
  client: BookmarkClient,
  options: BookmarkModelOptions = {},
): BookmarkModel {
  const resolveTargetContext = options.resolveTargetContext ?? (() => readBookmarkTargetContext());
  const initialState: BookmarkModelState = { bookmarks: [], groups: [] };
  const liveState = ref<BookmarkModelState>(initialState);
  const state = readonly(liveState);
  const pending: PendingMutation[] = [];
  let canonical: Projection = { bookmarks: [], groups: [] };
  let connected = false;
  let dirty = false;
  let stopSubscription: (() => void) | undefined;
  let operationQueue = Promise.resolve();
  let reconcilePromise: Promise<BookmarkModelOutcome> | undefined;

  let published: BookmarkModelState = initialState;

  // 結構共享：內容未變的書籤／資料夾沿用上一版物件與陣列，讓 Vue 只重繪真正變動的部分。
  const currentProjection = () =>
    pending.reduce(
      (current, mutation) => applyIntent(current, mutation.intent),
      cloneProjection(canonical),
    );

  const publish = () => {
    const projection = currentProjection();
    const next = resolveProjectionTargets(projection, resolveTargetContext());
    const groups = reuseUnchangedItems(published.groups, next.groups);
    const bookmarks = reuseUnchangedItems(published.bookmarks, next.bookmarks);
    if (groups === published.groups && bookmarks === published.bookmarks) return;
    published = { groups, bookmarks };
    liveState.value = published;
  };

  const reconcile = () => {
    if (reconcilePromise) return reconcilePromise;
    dirty = false;
    reconcilePromise = client
      .readCollection()
      .then((result) => {
        if (!result.ok) return result;
        canonical = {
          groups: result.value.groups.map((group) => ({
            id: group.id,
            name: group.name,
            order: group.order,
            ...(group.parentId !== undefined ? { parentId: group.parentId } : {}),
            ...(group.icon !== undefined ? { icon: group.icon } : {}),
            ...(group.color !== undefined ? { color: group.color } : {}),
          })),
          bookmarks: result.value.bookmarks.map((bookmark) => ({
            id: bookmark.id,
            searchRecordId: bookmark.searchRecordId,
            name: bookmark.name,
            url: bookmark.url,
            groupId: bookmark.groupId,
            order: bookmark.order,
            createdAt: bookmark.createdAt,
            coverImageUrl: bookmark.coverImageUrl,
            ...(bookmark.leaguePinned === true ? { leaguePinned: true as const } : {}),
          })),
        };
        publish();
        return { ok: true as const, value: undefined };
      })
      .finally(() => {
        reconcilePromise = undefined;
        if (dirty && pending.length === 0 && connected) void reconcile();
      });
    return reconcilePromise;
  };

  const reconcileFresh = async () => {
    if (reconcilePromise) await reconcilePromise;
    return reconcile();
  };

  const schedule = <T>(operation: () => Promise<T>) => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const executeMutation = (intent: BookmarkMutationIntent) => {
    const nameToCheck =
      intent.type === 'rename-group' || intent.type === 'rename-bookmark'
        ? intent.name
        : intent.type === 'add-group'
          ? intent.group.name
          : intent.type === 'add-bookmark'
            ? intent.bookmark.name
            : undefined;
    if (nameToCheck !== undefined && !isValidBookmarkName(nameToCheck)) {
      return Promise.resolve(
        invalid(
          `Bookmark name must be between 1 and ${BOOKMARK_NAME_MAX_LENGTH} characters`,
        ) as BookmarkModelOutcome,
      );
    }

    const mutation = { intent: resolveIntent(currentProjection(), intent) };
    pending.push(mutation);
    publish();
    return schedule(async (): Promise<BookmarkModelOutcome> => {
      const outcome = await commitIntent(client, canonical, mutation.intent);
      const index = pending.indexOf(mutation);
      if (index >= 0) pending.splice(index, 1);
      if (outcome.ok && intent.type !== 'import-transfer') {
        canonical = applyIntent(canonical, mutation.intent);
      }
      const reconcileOutcome = await reconcileFresh();
      publish();
      if (outcome.ok && intent.type === 'import-transfer' && !reconcileOutcome.ok) {
        dirty = true;
        return reconcileOutcome;
      }
      return outcome.ok ? { ok: true, value: undefined } : outcome;
    });
  };

  return {
    state,
    async connect() {
      if (connected) return { ok: true, value: undefined };
      connected = true;
      stopSubscription = client.subscribe(() => {
        dirty = true;
        if (pending.length === 0) void reconcile();
      });
      const outcome = await reconcile();
      if (!outcome.ok) {
        connected = false;
        stopSubscription?.();
        stopSubscription = undefined;
      }
      return outcome;
    },
    execute(intent: BookmarkModelIntent) {
      if (!connected) return Promise.resolve(unavailable('Bookmark model is not connected'));
      if (intent.type === 'export-transfer') {
        return schedule(async () => client.exportTransfer(intent.scope, intent.groupId));
      }
      return executeMutation(intent);
    },
    refreshTargetContext() {
      publish();
    },
    dispose() {
      connected = false;
      stopSubscription?.();
      stopSubscription = undefined;
    },
  } as BookmarkModel;
}

function resolveIntent(
  projection: Projection,
  intent: BookmarkMutationIntent,
): ResolvedMutationIntent {
  if (intent.type === 'add-bookmark') {
    return {
      type: 'add-bookmark',
      bookmark: {
        ...intent.bookmark,
        order: getNextBookmarkOrder(projection.bookmarks, intent.bookmark.groupId),
      },
    };
  }
  if (intent.type === 'move-bookmark') {
    const bookmark = projection.bookmarks.find((item) => item.id === intent.bookmarkId);
    const order =
      bookmark && bookmark.groupId === intent.groupId
        ? bookmark.order
        : getNextBookmarkOrder(projection.bookmarks, intent.groupId);
    return { ...intent, order };
  }
  return intent;
}

async function commitIntent(
  client: BookmarkClient,
  canonical: Projection,
  intent: ResolvedMutationIntent,
): Promise<SearchRecordOutcome> {
  switch (intent.type) {
    case 'add-group':
      return client.putGroup(intent.group);
    case 'rename-group': {
      const group = canonical.groups.find((item) => item.id === intent.groupId);
      return group
        ? client.putGroup({ ...group, name: intent.name })
        : invalid(`Bookmark group ${intent.groupId} does not exist`);
    }
    case 'set-group-appearance': {
      const group = canonical.groups.find((item) => item.id === intent.groupId);
      if (!group) return invalid(`Bookmark group ${intent.groupId} does not exist`);
      return client.putGroup(applyFolderAppearance({ ...group }, intent));
    }
    case 'delete-group':
      return client.deleteGroup(intent.groupId);
    case 'move-folder':
      return client.moveFolder(
        intent.folderId,
        intent.targetParentId,
        intent.order,
        intent.dropIntent,
      );
    case 'reorder-groups':
      return client.reorderGroups(intent.groupIds);
    case 'add-bookmark':
      return client.putBookmark(toBookmarkInput(intent.bookmark));
    case 'overwrite-bookmark': {
      const bookmark = canonical.bookmarks.find((item) => item.id === intent.bookmarkId);
      if (!bookmark) return invalid(`Bookmark ${intent.bookmarkId} does not exist`);
      if (intent.coverImageUrl !== undefined && !isValidPoeCdnImageUrl(intent.coverImageUrl)) {
        return invalid(`Invalid bookmark cover URL`);
      }
      return client.putBookmark(
        toBookmarkInput(mergeOverwrittenBookmark(bookmark, intent.url, intent.coverImageUrl)),
      );
    }
    case 'rename-bookmark':
    case 'move-bookmark':
    case 'set-bookmark-cover': {
      const bookmark = canonical.bookmarks.find((item) => item.id === intent.bookmarkId);
      if (!bookmark) return invalid(`Bookmark ${intent.bookmarkId} does not exist`);
      if (intent.type === 'rename-bookmark') {
        return client.putBookmark(toBookmarkInput({ ...bookmark, name: intent.name }));
      }
      if (intent.type === 'move-bookmark') {
        return client.reorderBookmarks([
          {
            id: bookmark.id,
            groupId: intent.groupId,
            order: intent.order,
          },
        ]);
      }
      if (intent.coverImageUrl !== undefined && !isValidPoeCdnImageUrl(intent.coverImageUrl)) {
        return invalid(`Invalid bookmark cover URL`);
      }
      const updated = { ...bookmark, coverImageUrl: intent.coverImageUrl };
      if (intent.coverImageUrl === undefined) delete updated.coverImageUrl;
      return client.putBookmark(toBookmarkInput(updated));
    }
    case 'delete-bookmark':
      return client.deleteBookmark(intent.bookmarkId);
    case 'reorder-bookmarks':
      return client.reorderBookmarks(intent.placements);
    case 'replace-league':
      return client.replaceLeague(intent.scope, intent.league, intent.groupId);
    case 'import-transfer':
      return client.importTransfer(intent.payload, intent.mode, intent.targetGroupId);
    case 'clear-collection':
      return client.clearCollection();
  }
}

function applyIntent(state: Projection, intent: ResolvedMutationIntent): Projection {
  const next = cloneProjection(state);
  switch (intent.type) {
    case 'add-group':
      next.groups.push({ ...intent.group });
      break;
    case 'rename-group':
      next.groups = next.groups.map((group) =>
        group.id === intent.groupId ? { ...group, name: intent.name } : group,
      );
      break;
    case 'set-group-appearance': {
      next.groups = next.groups.map((group) =>
        group.id === intent.groupId ? applyFolderAppearance({ ...group }, intent) : group,
      );
      break;
    }
    case 'delete-group': {
      const subtreeIds = getFolderSubtreeIds(next.groups, intent.groupId);
      next.groups = next.groups.filter((group) => !subtreeIds.has(group.id));
      next.bookmarks = next.bookmarks.filter((bookmark) => !subtreeIds.has(bookmark.groupId));
      break;
    }
    case 'move-folder': {
      if (intent.dropIntent) {
        const result = resolveFolderDropPlacement(next.groups, intent.folderId, intent.dropIntent);
        if (result.ok && result.placements) {
          const placementMap = new Map(result.placements.map((p) => [p.id, p]));
          next.groups = next.groups
            .map((group) => {
              const p = placementMap.get(group.id);
              if (!p) return group;
              return {
                ...group,
                parentId: p.parentId,
                order: p.order,
              };
            })
            .sort((a, b) => a.order - b.order);
        }
      } else {
        next.groups = next.groups
          .map((group) => {
            if (group.id !== intent.folderId) return group;
            return {
              ...group,
              parentId: intent.targetParentId,
              ...(typeof intent.order === 'number' ? { order: intent.order } : {}),
            };
          })
          .sort((a, b) => a.order - b.order);
      }
      break;
    }
    case 'reorder-groups': {
      const orders = new Map(intent.groupIds.map((id, order) => [id, order]));
      next.groups = next.groups
        .map((group) => ({ ...group, order: orders.get(group.id) ?? group.order }))
        .sort((left, right) => left.order - right.order);
      break;
    }
    case 'add-bookmark':
      next.bookmarks.push({ ...intent.bookmark });
      break;
    case 'overwrite-bookmark': {
      if (intent.coverImageUrl !== undefined && !isValidPoeCdnImageUrl(intent.coverImageUrl)) {
        break;
      }
      next.bookmarks = next.bookmarks.map((bookmark) =>
        bookmark.id === intent.bookmarkId
          ? mergeOverwrittenBookmark(bookmark, intent.url, intent.coverImageUrl)
          : bookmark,
      );
      break;
    }
    case 'rename-bookmark':
      next.bookmarks = next.bookmarks.map((bookmark) =>
        bookmark.id === intent.bookmarkId ? { ...bookmark, name: intent.name } : bookmark,
      );
      break;
    case 'move-bookmark':
      next.bookmarks = next.bookmarks.map((bookmark) =>
        bookmark.id === intent.bookmarkId
          ? { ...bookmark, groupId: intent.groupId, order: intent.order }
          : bookmark,
      );
      break;
    case 'set-bookmark-cover':
      if (intent.coverImageUrl !== undefined && !isValidPoeCdnImageUrl(intent.coverImageUrl)) {
        break;
      }
      next.bookmarks = next.bookmarks.map((bookmark) =>
        bookmark.id === intent.bookmarkId
          ? { ...bookmark, coverImageUrl: intent.coverImageUrl }
          : bookmark,
      );
      break;
    case 'delete-bookmark':
      next.bookmarks = next.bookmarks.filter((bookmark) => bookmark.id !== intent.bookmarkId);
      break;
    case 'reorder-bookmarks': {
      const placements = new Map(intent.placements.map((placement) => [placement.id, placement]));
      next.bookmarks = next.bookmarks
        .map((bookmark) => ({ ...bookmark, ...placements.get(bookmark.id) }))
        .sort((left, right) => left.order - right.order);
      break;
    }
    case 'replace-league':
    case 'import-transfer':
      break;
    case 'clear-collection':
      next.groups = [];
      next.bookmarks = [];
      break;
  }
  return next;
}

/** 淺比較兩個扁平紀錄；值為 undefined 的欄位視同不存在。 */
function isShallowEqualRecord(left: object, right: object): boolean {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * 以 id 對照上一版項目：內容相同者沿用舊物件；若整體順序與項目皆未變，直接回傳舊陣列。
 */
export function reuseUnchangedItems<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  let identical = previous.length === next.length;
  const merged = next.map((item, index) => {
    const prior = previousById.get(item.id);
    const resolved = prior && isShallowEqualRecord(prior, item) ? prior : item;
    if (identical && previous[index] !== resolved) identical = false;
    return resolved;
  });
  return identical ? (previous as T[]) : merged;
}

function cloneProjection(state: Projection): Projection {
  return {
    groups: state.groups.map((group) => ({ ...group })),
    bookmarks: state.bookmarks.map((bookmark) => ({ ...bookmark })),
  };
}

function mergeOverwrittenBookmark(
  bookmark: Bookmark,
  url: string,
  fallbackCoverImageUrl?: string,
): Bookmark {
  const nextCover = bookmark.coverImageUrl ?? fallbackCoverImageUrl;
  return {
    ...bookmark,
    canonicalUrl: url,
    url,
    ...(nextCover !== undefined ? { coverImageUrl: nextCover } : {}),
  };
}

function toBookmarkInput(bookmark: Bookmark): BookmarkInput {
  const { searchRecordId: _searchRecordId, canonicalUrl, ...input } = bookmark;
  return { ...input, url: canonicalUrl ?? input.url };
}

/** 將 canonical 書籤網址投影為目前網域／聯盟可開啟的網址，保留原始網址於 `canonicalUrl`。 */
function resolveProjectionTargets(
  projection: Projection,
  context: BookmarkTargetContext,
): Projection {
  return {
    groups: projection.groups,
    bookmarks: projection.bookmarks.map((bookmark) => {
      const canonicalUrl = bookmark.canonicalUrl ?? bookmark.url;
      return {
        ...bookmark,
        canonicalUrl,
        url: resolveBookmarkUrl(canonicalUrl, { leaguePinned: bookmark.leaguePinned }, context),
      };
    }),
  };
}

function invalid(message: string): SearchRecordOutcome {
  return { ok: false, error: { code: 'invalid-identity', message } };
}

function unavailable(message: string): BookmarkModelOutcome {
  return { ok: false, error: { code: 'unavailable', message } };
}
