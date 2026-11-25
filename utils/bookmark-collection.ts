import type { PoeVersion } from './trade-context';
import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import {
  canMoveFolder,
  getFolderSubtreeIds,
  resolveFolderDropPlacement,
  type FolderDropIntent,
} from './bookmark-folder-tree';
import {
  assertValidBookmarkName,
  canonicalizeBookmarkCollectionState,
  normalizeStoredFolder,
  validateFolderHierarchy,
} from './bookmark-collection-schema';

export const BOOKMARK_COLLECTION_STATE_KEY = 'poexdBookmarkCollectionStateV3';
export const BOOKMARK_COLLECTION_STATE_KEY_V2 = 'poexdBookmarkCollectionStateV2';
export interface BookmarkFolder {
  id: string;
  gameVersion: PoeVersion;
  name: string;
  order: number;
  parentId?: string;
  icon?: string;
  color?: string;
}

export type BookmarkCollectionGroup = BookmarkFolder;

export interface BookmarkPlacement {
  id: string;
  name: string;
  groupId: string;
  order: number;
  createdAt?: number;
  coverImageUrl?: string;
  /** 固定聯盟；未設定時為「自動」，開啟時跟隨目前頁面的聯盟。 */
  leaguePinned?: true;
}

export interface BookmarkCollectionItem extends BookmarkPlacement {
  gameVersion: PoeVersion;
}

export type BookmarkReorderPlacement = {
  id: string;
  groupId?: string;
  order: number;
};

export interface BookmarkCollectionState {
  schemaVersion: 3;
  folders: BookmarkFolder[];
  bookmarks: BookmarkCollectionItem[];
}

export interface BookmarkCollectionGroupV2 {
  id: string;
  gameVersion: PoeVersion;
  name: string;
  order: number;
}

export interface BookmarkCollectionItemV2 {
  id: string;
  gameVersion: PoeVersion;
  name: string;
  groupId: string;
  order: number;
  createdAt?: number;
  coverImageUrl?: string;
}

export interface BookmarkCollectionStateV2 {
  schemaVersion: 2;
  groups: BookmarkCollectionGroupV2[];
  bookmarks: BookmarkCollectionItemV2[];
}

export type BookmarkCollectionCommand =
  | { type: 'put-group'; group: BookmarkFolder }
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
  | { type: 'put-bookmark'; bookmark: BookmarkCollectionItem }
  | { type: 'delete-bookmark'; gameVersion: PoeVersion; bookmarkId: string }
  | {
      type: 'set-league-pinned';
      gameVersion: PoeVersion;
      bookmarkIds: string[];
      pinned: boolean;
    }
  | {
      type: 'reorder-bookmarks';
      gameVersion: PoeVersion;
      placements: BookmarkReorderPlacement[];
    }
  | {
      type: 'import-collection';
      gameVersion: PoeVersion;
      mode: 'merge' | 'overwrite';
      groups: Array<{
        id: string;
        name: string;
        order: number;
        parentId?: string;
        icon?: string;
        color?: string;
      }>;
      bookmarks: BookmarkPlacement[];
    }
  | { type: 'clear-collection'; gameVersion: PoeVersion };

export interface PreparedBookmarkCollection {
  changed: boolean;
  state: BookmarkCollectionState;
  removedBookmarkIds: string[];
}

export interface BookmarkCollectionModule {
  read(gameVersion: PoeVersion): {
    groups: BookmarkFolder[];
    bookmarks: BookmarkCollectionItem[];
  };
  prepare(command: BookmarkCollectionCommand): PreparedBookmarkCollection;
  accept(state: BookmarkCollectionState): void;
  snapshot(): BookmarkCollectionState;
}

export function createDefaultBookmarkCollectionState(): BookmarkCollectionState {
  return {
    schemaVersion: 3,
    folders: [],
    bookmarks: [],
  };
}

/**
 * 資料夾內下一個書籤排序值：取該資料夾最大 order + 1。
 * 刪除書籤不會重新編號，order 可能有缺口，因此不能用書籤數量代替。
 */
export function getNextBookmarkOrder(
  bookmarks: ReadonlyArray<{ readonly groupId: string; readonly order: number }>,
  groupId: string,
): number {
  let max = -1;
  for (const bookmark of bookmarks) {
    if (bookmark.groupId === groupId && bookmark.order > max) max = bookmark.order;
  }
  return max + 1;
}

export function createBookmarkCollectionModule(
  initialState: BookmarkCollectionState | BookmarkCollectionStateV2 | unknown,
): BookmarkCollectionModule {
  let liveState = canonicalizeBookmarkCollectionState(initialState);

  return {
    read(gameVersion) {
      const groups = liveState.folders
        .filter((folder) => folder.gameVersion === gameVersion)
        .sort((left, right) => left.order - right.order)
        .map(clone);
      const bookmarks = liveState.bookmarks
        .filter((bookmark) => bookmark.gameVersion === gameVersion)
        .sort((left, right) => left.order - right.order)
        .map(clone);
      return {
        groups,
        bookmarks,
      };
    },
    prepare(command) {
      const candidate = clone(liveState);
      const removedBookmarkIds = applyCollectionCommand(candidate, command);
      return {
        changed: JSON.stringify(candidate) !== JSON.stringify(liveState),
        state: candidate,
        removedBookmarkIds,
      };
    },
    accept(state) {
      liveState = canonicalizeBookmarkCollectionState(state);
    },
    snapshot() {
      return clone(liveState);
    },
  };
}

function applyCollectionCommand(
  state: BookmarkCollectionState,
  command: BookmarkCollectionCommand,
): string[] {
  switch (command.type) {
    case 'put-group': {
      const folder = command.group;
      assertGameVersion(folder.gameVersion);
      assertValidBookmarkName(folder.name, 'folder');
      const versionFolders = state.folders.filter((f) => f.gameVersion === folder.gameVersion);
      if (folder.parentId !== undefined) {
        if (folder.parentId === folder.id) {
          throw new Error('Folder parent cannot be itself');
        }
        const parent = versionFolders.find((f) => f.id === folder.parentId);
        if (!parent) {
          throw new Error(`Parent folder ${folder.parentId} does not exist`);
        }
        const check = canMoveFolder(versionFolders, folder.id, folder.parentId);
        if (!check.allowed) {
          throw new Error(check.reason ?? 'Invalid folder hierarchy');
        }
      }
      const normalizedFolder = normalizeStoredFolder(folder);
      const index = state.folders.findIndex(
        (item) =>
          item.gameVersion === normalizedFolder.gameVersion && item.id === normalizedFolder.id,
      );
      if (index === -1) state.folders.push(normalizedFolder);
      else state.folders[index] = normalizedFolder;
      return [];
    }
    case 'delete-group': {
      assertGameVersion(command.gameVersion);
      const targetId = command.groupId;
      const versionFolders = state.folders.filter((f) => f.gameVersion === command.gameVersion);
      const subtreeIds = getFolderSubtreeIds(versionFolders, targetId);
      const removed = state.bookmarks
        .filter(
          (bookmark) =>
            bookmark.gameVersion === command.gameVersion && subtreeIds.has(bookmark.groupId),
        )
        .map((bookmark) => bookmark.id);
      state.folders = state.folders.filter(
        (folder) => folder.gameVersion !== command.gameVersion || !subtreeIds.has(folder.id),
      );
      state.bookmarks = state.bookmarks.filter(
        (bookmark) =>
          bookmark.gameVersion !== command.gameVersion || !subtreeIds.has(bookmark.groupId),
      );
      return removed;
    }
    case 'move-folder': {
      assertGameVersion(command.gameVersion);
      const versionFolders = state.folders.filter((f) => f.gameVersion === command.gameVersion);
      const folder = versionFolders.find((f) => f.id === command.folderId);
      if (!folder) {
        throw new Error(`Folder ${command.folderId} does not exist`);
      }
      if (command.dropIntent) {
        const result = resolveFolderDropPlacement(
          versionFolders,
          command.folderId,
          command.dropIntent,
        );
        if (!result.ok || !result.placements) {
          throw new Error(result.reason ?? 'Cannot move folder');
        }
        const placementMap = new Map(result.placements.map((p) => [p.id, p]));
        state.folders.forEach((f) => {
          if (f.gameVersion === command.gameVersion) {
            const p = placementMap.get(f.id);
            if (p) {
              f.parentId = p.parentId;
              f.order = p.order;
            }
          }
        });
        return [];
      }
      const check = canMoveFolder(versionFolders, command.folderId, command.targetParentId);
      if (!check.allowed) {
        throw new Error(check.reason ?? 'Cannot move folder');
      }
      folder.parentId = command.targetParentId;
      if (typeof command.order === 'number' && Number.isFinite(command.order)) {
        folder.order = command.order;
      } else {
        const siblings = versionFolders.filter(
          (f) => f.id !== folder.id && f.parentId === command.targetParentId,
        );
        folder.order = siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
      }
      return [];
    }
    case 'reorder-groups': {
      assertGameVersion(command.gameVersion);
      const orders = new Map(command.groupIds.map((id, order) => [id, order]));
      state.folders.forEach((folder) => {
        const order = orders.get(folder.id);
        if (folder.gameVersion === command.gameVersion && order !== undefined) folder.order = order;
      });
      return [];
    }
    case 'put-bookmark': {
      assertGameVersion(command.bookmark.gameVersion);
      assertValidBookmarkName(command.bookmark.name, 'Bookmark');
      if ('folderId' in command.bookmark || (command.bookmark as any).folderId !== undefined) {
        throw new Error(
          'Legacy folderId is prohibited in runtime bookmark mutation: use groupId instead',
        );
      }
      const targetGroupId = command.bookmark.groupId;
      if (!targetGroupId || typeof targetGroupId !== 'string') {
        throw new Error('Bookmark requires a valid folder/group ID');
      }
      assertValidFolder(state, command.bookmark.gameVersion, targetGroupId);
      assertValidCoverImageUrl(command.bookmark.coverImageUrl);
      const normalized: BookmarkCollectionItem = {
        id: command.bookmark.id,
        gameVersion: command.bookmark.gameVersion,
        name: command.bookmark.name,
        groupId: targetGroupId,
        order: command.bookmark.order,
        createdAt: command.bookmark.createdAt,
        coverImageUrl: command.bookmark.coverImageUrl,
        ...(command.bookmark.leaguePinned === true ? { leaguePinned: true as const } : {}),
      };
      const index = state.bookmarks.findIndex(
        (b) => b.gameVersion === normalized.gameVersion && b.id === normalized.id,
      );
      if (index === -1) state.bookmarks.push(normalized);
      else state.bookmarks[index] = normalized;
      return [];
    }
    case 'delete-bookmark':
      assertGameVersion(command.gameVersion);
      state.bookmarks = state.bookmarks.filter(
        (bookmark) =>
          bookmark.gameVersion !== command.gameVersion || bookmark.id !== command.bookmarkId,
      );
      return [command.bookmarkId];
    case 'set-league-pinned': {
      assertGameVersion(command.gameVersion);
      const targetIds = new Set(command.bookmarkIds);
      state.bookmarks = state.bookmarks.map((bookmark) => {
        if (bookmark.gameVersion !== command.gameVersion || !targetIds.has(bookmark.id)) {
          return bookmark;
        }
        const { leaguePinned: _leaguePinned, ...rest } = bookmark;
        return command.pinned ? { ...rest, leaguePinned: true as const } : rest;
      });
      return [];
    }
    case 'reorder-bookmarks': {
      assertGameVersion(command.gameVersion);
      const seen = new Set<string>();
      for (const placement of command.placements) {
        if (seen.has(placement.id)) {
          throw new Error(`Duplicate bookmark ID in reorder placements: ${placement.id}`);
        }
        seen.add(placement.id);
        if ('folderId' in placement || (placement as any).folderId !== undefined) {
          throw new Error(
            'Legacy folderId is prohibited in runtime reorder placement: use groupId instead',
          );
        }
      }
      const placements = new Map(command.placements.map((placement) => [placement.id, placement]));
      state.bookmarks.forEach((bookmark) => {
        const placement = placements.get(bookmark.id);
        if (bookmark.gameVersion !== command.gameVersion || !placement) return;
        const targetGroupId = placement.groupId;
        if (targetGroupId) {
          assertValidFolder(state, command.gameVersion, targetGroupId);
          bookmark.groupId = targetGroupId;
        }
        bookmark.order = placement.order;
      });
      return [];
    }
    case 'import-collection': {
      assertGameVersion(command.gameVersion);
      const importedFolders: BookmarkFolder[] = command.groups.map((group) => ({
        ...group,
        gameVersion: command.gameVersion,
      }));
      importedFolders.forEach((folder) => assertValidBookmarkName(folder.name, 'folder'));
      command.bookmarks.forEach((bookmark) => {
        if ('folderId' in bookmark || (bookmark as any).folderId !== undefined) {
          throw new Error(
            'Legacy folderId is prohibited in runtime bookmark import: use groupId instead',
          );
        }
        if (!bookmark.groupId || typeof bookmark.groupId !== 'string') {
          throw new Error('Bookmark import requires a valid folder/group ID');
        }
        assertValidBookmarkName(bookmark.name, 'Bookmark');
        assertValidCoverImageUrl(bookmark.coverImageUrl);
      });
      const hierarchyCheck = validateFolderHierarchy(importedFolders);
      if (!hierarchyCheck.ok) {
        throw new Error(
          `Bookmark import contains an invalid folder hierarchy: ${hierarchyCheck.error}`,
        );
      }
      const availableFolderIds = new Set([
        ...importedFolders.map((folder) => folder.id),
        ...(command.mode === 'merge'
          ? state.folders
              .filter((folder) => folder.gameVersion === command.gameVersion)
              .map((folder) => folder.id)
          : []),
      ]);
      if (
        command.bookmarks.some((bookmark) => {
          const targetGroupId = bookmark.groupId;
          return !bookmark.id || !targetGroupId || !availableFolderIds.has(targetGroupId);
        })
      ) {
        throw new Error('Bookmark import contains a dangling folder');
      }
      const removed =
        command.mode === 'overwrite'
          ? state.bookmarks
              .filter((bookmark) => bookmark.gameVersion === command.gameVersion)
              .map((bookmark) => bookmark.id)
          : [];
      if (command.mode === 'overwrite') {
        state.folders = state.folders.filter(
          (folder) => folder.gameVersion !== command.gameVersion,
        );
        state.bookmarks = state.bookmarks.filter(
          (bookmark) => bookmark.gameVersion !== command.gameVersion,
        );
      }
      importedFolders.forEach((folder) => {
        if (
          command.mode === 'merge' &&
          state.folders.some(
            (existing) => existing.gameVersion === command.gameVersion && existing.id === folder.id,
          )
        )
          return;
        state.folders.push(normalizeStoredFolder(folder));
      });
      command.bookmarks.forEach((bookmark) => {
        if (
          command.mode === 'merge' &&
          state.bookmarks.some(
            (existing) =>
              existing.gameVersion === command.gameVersion && existing.id === bookmark.id,
          )
        )
          return;
        const targetGroupId = bookmark.groupId;
        state.bookmarks.push({
          id: bookmark.id,
          gameVersion: command.gameVersion,
          name: bookmark.name,
          groupId: targetGroupId,
          order: bookmark.order,
          createdAt: bookmark.createdAt,
          coverImageUrl: bookmark.coverImageUrl,
          ...(bookmark.leaguePinned === true ? { leaguePinned: true as const } : {}),
        });
      });
      return removed;
    }
    case 'clear-collection': {
      assertGameVersion(command.gameVersion);
      const removed = state.bookmarks
        .filter((bookmark) => bookmark.gameVersion === command.gameVersion)
        .map((bookmark) => bookmark.id);
      state.folders = state.folders.filter((folder) => folder.gameVersion !== command.gameVersion);
      state.bookmarks = state.bookmarks.filter(
        (bookmark) => bookmark.gameVersion !== command.gameVersion,
      );
      return removed;
    }
  }
}

function assertValidCoverImageUrl(coverImageUrl: unknown) {
  if (coverImageUrl !== undefined && !isValidPoeCdnImageUrl(coverImageUrl)) {
    throw new Error('Invalid bookmark cover URL: must be an HTTPS URL on allowed PoE CDN hosts');
  }
}

function assertValidFolder(
  state: BookmarkCollectionState,
  gameVersion: PoeVersion,
  folderId: string,
) {
  if (
    !state.folders.some((folder) => folder.gameVersion === gameVersion && folder.id === folderId)
  ) {
    throw new Error('Bookmark requires an existing folder');
  }
}

function assertGameVersion(gameVersion: PoeVersion) {
  if (gameVersion !== 'poe1' && gameVersion !== 'poe2') {
    throw new Error('Bookmark operation requires a valid game version');
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
