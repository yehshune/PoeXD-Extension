import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import { normalizeFolderColor, normalizeFolderIcon } from './folder-icons';
import type { PoeVersion } from './trade-context';
import type {
  BookmarkCollectionItem,
  BookmarkCollectionState,
  BookmarkCollectionStateV2,
  BookmarkFolder,
} from './bookmark-collection';

export const BOOKMARK_NAME_MAX_LENGTH = 200;

export function isValidBookmarkName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.trim().length <= BOOKMARK_NAME_MAX_LENGTH
  );
}

export function assertValidBookmarkName(name: unknown, label = 'Bookmark'): string {
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    name.trim().length > BOOKMARK_NAME_MAX_LENGTH
  ) {
    throw new Error(
      `Bookmark operation requires a valid ${label} name (1-${BOOKMARK_NAME_MAX_LENGTH} characters)`,
    );
  }
  return name.trim();
}

export function sanitizeBookmarkName(name: unknown, fallback = '未命名書籤'): string {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, BOOKMARK_NAME_MAX_LENGTH);
}

export function validateFolderHierarchy(folders: BookmarkFolder[]):
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    } {
  const folderKeys = new Set<string>();
  const foldersByVersion: Record<string, BookmarkFolder[]> = { poe1: [], poe2: [] };

  for (const folder of folders) {
    if (
      !isObject(folder) ||
      typeof folder.id !== 'string' ||
      folder.id === '' ||
      (folder.gameVersion !== 'poe1' && folder.gameVersion !== 'poe2') ||
      typeof folder.name !== 'string' ||
      folder.name.trim() === '' ||
      folder.name.trim().length > BOOKMARK_NAME_MAX_LENGTH ||
      typeof folder.order !== 'number' ||
      !Number.isFinite(folder.order)
    ) {
      return { ok: false, error: 'Invalid folder properties' };
    }
    if (folder.parentId !== undefined) {
      if (
        typeof folder.parentId !== 'string' ||
        folder.parentId === '' ||
        folder.parentId === folder.id
      ) {
        return { ok: false, error: 'Folder parent cannot be self or invalid' };
      }
    }
    const key = `${folder.gameVersion}:${folder.id}`;
    if (folderKeys.has(key)) return { ok: false, error: `Duplicate folder ID: ${folder.id}` };
    folderKeys.add(key);
    foldersByVersion[folder.gameVersion].push(folder);
  }

  for (const version of ['poe1', 'poe2'] as const) {
    const list = foldersByVersion[version];
    const map = new Map(list.map((f) => [f.id, f]));
    for (const folder of list) {
      if (folder.parentId !== undefined) {
        const parent = map.get(folder.parentId);
        if (!parent) {
          return {
            ok: false,
            error: `Folder ${folder.id} has nonexistent or cross-version parent ${folder.parentId}`,
          };
        }
      }
      const visited = new Set<string>();
      let curr: BookmarkFolder | undefined = folder;
      while (curr && curr.parentId !== undefined) {
        if (visited.has(curr.id)) {
          return {
            ok: false,
            error: `Folder hierarchy contains a cycle involving folder ${curr.id}`,
          };
        }
        visited.add(curr.id);
        curr = map.get(curr.parentId);
      }
    }
  }

  return { ok: true };
}

export function isBookmarkCollectionStateV3(value: unknown): value is BookmarkCollectionState {
  if (
    !isObject(value) ||
    value.schemaVersion !== 3 ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.bookmarks)
  ) {
    return false;
  }
  const folderValidation = validateFolderHierarchy(value.folders as BookmarkFolder[]);
  if (!folderValidation.ok) return false;

  const folderKeys = new Set(
    (value.folders as BookmarkFolder[]).map((f) => `${f.gameVersion}:${f.id}`),
  );
  const bookmarkKeys = new Set<string>();
  for (const bookmark of value.bookmarks) {
    if (
      !isObject(bookmark) ||
      typeof bookmark.id !== 'string' ||
      bookmark.id === '' ||
      (bookmark.gameVersion !== 'poe1' && bookmark.gameVersion !== 'poe2') ||
      typeof bookmark.name !== 'string' ||
      bookmark.name.trim() === '' ||
      bookmark.name.trim().length > BOOKMARK_NAME_MAX_LENGTH ||
      typeof bookmark.order !== 'number' ||
      !Number.isFinite(bookmark.order) ||
      (bookmark.coverImageUrl !== undefined && !isValidPoeCdnImageUrl(bookmark.coverImageUrl)) ||
      (bookmark.leaguePinned !== undefined && bookmark.leaguePinned !== true)
    ) {
      return false;
    }
    // Canonical V3 bookmarks MUST have groupId
    if (typeof bookmark.groupId !== 'string' || bookmark.groupId === '') {
      return false;
    }
    // If folderId is present, it must match groupId (no contradiction)
    if (bookmark.folderId !== undefined && bookmark.folderId !== bookmark.groupId) {
      return false;
    }
    if (!folderKeys.has(`${bookmark.gameVersion}:${bookmark.groupId}`)) {
      return false;
    }
    const key = `${bookmark.gameVersion}:${bookmark.id}`;
    if (bookmarkKeys.has(key)) return false;
    bookmarkKeys.add(key);
  }
  return true;
}

export function isCanonicalBookmarkCollectionStateV3(
  value: unknown,
): value is BookmarkCollectionState {
  if (!isBookmarkCollectionStateV3(value)) return false;
  return value.bookmarks.every((b) => !('folderId' in b));
}

export function isCompatBookmarkCollectionStateV3(value: unknown): boolean {
  if (
    !isObject(value) ||
    value.schemaVersion !== 3 ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.bookmarks)
  ) {
    return false;
  }
  const folderValidation = validateFolderHierarchy(value.folders as BookmarkFolder[]);
  if (!folderValidation.ok) return false;

  const folderKeys = new Set(
    (value.folders as BookmarkFolder[]).map((f) => `${f.gameVersion}:${f.id}`),
  );
  const bookmarkKeys = new Set<string>();
  for (const rawBookmark of value.bookmarks) {
    if (!isObject(rawBookmark)) return false;
    const bookmark = rawBookmark as Record<string, unknown>;
    if (
      typeof bookmark.id !== 'string' ||
      bookmark.id === '' ||
      (bookmark.gameVersion !== 'poe1' && bookmark.gameVersion !== 'poe2') ||
      typeof bookmark.name !== 'string' ||
      bookmark.name.trim() === '' ||
      bookmark.name.trim().length > BOOKMARK_NAME_MAX_LENGTH ||
      typeof bookmark.order !== 'number' ||
      !Number.isFinite(bookmark.order) ||
      (bookmark.coverImageUrl !== undefined &&
        (typeof bookmark.coverImageUrl !== 'string' ||
          !isValidPoeCdnImageUrl(bookmark.coverImageUrl))) ||
      (bookmark.leaguePinned !== undefined && bookmark.leaguePinned !== true)
    ) {
      return false;
    }
    if (
      bookmark.folderId !== undefined &&
      bookmark.groupId !== undefined &&
      bookmark.folderId !== bookmark.groupId
    ) {
      return false;
    }
    const targetGroupId =
      typeof bookmark.groupId === 'string' && bookmark.groupId !== ''
        ? bookmark.groupId
        : typeof bookmark.folderId === 'string' && bookmark.folderId !== ''
          ? bookmark.folderId
          : undefined;
    if (!targetGroupId || !folderKeys.has(`${bookmark.gameVersion}:${targetGroupId}`)) {
      return false;
    }
    const key = `${bookmark.gameVersion}:${bookmark.id}`;
    if (bookmarkKeys.has(key)) return false;
    bookmarkKeys.add(key);
  }
  return true;
}

export function canonicalizeBookmarkCollectionState(value: unknown): BookmarkCollectionState {
  if (isBookmarkCollectionStateV2(value)) {
    return migrateBookmarkCollectionStateV2ToV3(value);
  }
  if (
    !isObject(value) ||
    value.schemaVersion !== 3 ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.bookmarks)
  ) {
    throw new Error('Invalid bookmark collection state: expected schemaVersion 3');
  }
  const folderValidation = validateFolderHierarchy(value.folders as BookmarkFolder[]);
  if (!folderValidation.ok) {
    throw new Error(`Invalid folder hierarchy: ${folderValidation.error}`);
  }

  const folderKeys = new Set(
    (value.folders as BookmarkFolder[]).map((f) => `${f.gameVersion}:${f.id}`),
  );
  const bookmarkKeys = new Set<string>();
  const canonicalBookmarks: BookmarkCollectionItem[] = [];

  for (const rawBookmark of value.bookmarks) {
    if (!isObject(rawBookmark)) {
      throw new Error('Invalid bookmark item: not an object');
    }
    const bookmark = rawBookmark as Record<string, unknown>;
    if (
      typeof bookmark.id !== 'string' ||
      bookmark.id === '' ||
      (bookmark.gameVersion !== 'poe1' && bookmark.gameVersion !== 'poe2') ||
      typeof bookmark.name !== 'string' ||
      bookmark.name.trim() === '' ||
      bookmark.name.trim().length > BOOKMARK_NAME_MAX_LENGTH ||
      typeof bookmark.order !== 'number' ||
      !Number.isFinite(bookmark.order) ||
      (bookmark.coverImageUrl !== undefined &&
        (typeof bookmark.coverImageUrl !== 'string' ||
          !isValidPoeCdnImageUrl(bookmark.coverImageUrl))) ||
      (bookmark.leaguePinned !== undefined && bookmark.leaguePinned !== true)
    ) {
      throw new Error(`Invalid bookmark item: ${bookmark.id ?? 'unknown'}`);
    }

    if (
      bookmark.folderId !== undefined &&
      bookmark.groupId !== undefined &&
      bookmark.folderId !== bookmark.groupId
    ) {
      throw new Error('Ambiguous bookmark ownership: folderId and groupId must not contradict');
    }

    const targetGroupId =
      typeof bookmark.groupId === 'string' && bookmark.groupId !== ''
        ? bookmark.groupId
        : typeof bookmark.folderId === 'string' && bookmark.folderId !== ''
          ? bookmark.folderId
          : undefined;

    if (!targetGroupId) {
      throw new Error(`Bookmark ${bookmark.id} requires a valid folder/group ID`);
    }

    if (!folderKeys.has(`${bookmark.gameVersion}:${targetGroupId}`)) {
      throw new Error(`Bookmark ${bookmark.id} references non-existent folder ${targetGroupId}`);
    }

    const key = `${bookmark.gameVersion}:${bookmark.id}`;
    if (bookmarkKeys.has(key)) {
      throw new Error(`Duplicate bookmark key: ${key}`);
    }
    bookmarkKeys.add(key);

    const canonicalItem: BookmarkCollectionItem = {
      id: bookmark.id,
      gameVersion: bookmark.gameVersion as PoeVersion,
      name: bookmark.name,
      groupId: targetGroupId,
      order: bookmark.order,
      ...(typeof bookmark.createdAt === 'number' ? { createdAt: bookmark.createdAt } : {}),
      ...(typeof bookmark.coverImageUrl === 'string'
        ? { coverImageUrl: bookmark.coverImageUrl }
        : {}),
      ...(bookmark.leaguePinned === true ? { leaguePinned: true as const } : {}),
    };
    canonicalBookmarks.push(canonicalItem);
  }

  return {
    schemaVersion: 3,
    folders: (value.folders as BookmarkFolder[]).map((f) => normalizeStoredFolder(f)),
    bookmarks: canonicalBookmarks,
  };
}

export function isBookmarkCollectionState(
  value: unknown,
): value is BookmarkCollectionState | BookmarkCollectionStateV2 {
  if (!isObject(value)) return false;
  if (value.schemaVersion === 3) return isBookmarkCollectionStateV3(value);
  if (value.schemaVersion === 2) return isBookmarkCollectionStateV2(value);
  return false;
}

export function isBookmarkCollectionStateV2(value: unknown): value is BookmarkCollectionStateV2 {
  if (
    !isObject(value) ||
    value.schemaVersion !== 2 ||
    !Array.isArray(value.bookmarks) ||
    !Array.isArray(value.groups)
  )
    return false;
  const groupKeys = new Set<string>();
  for (const group of value.groups) {
    if (
      !isObject(group) ||
      typeof group.id !== 'string' ||
      group.id === '' ||
      (group.gameVersion !== 'poe1' && group.gameVersion !== 'poe2') ||
      typeof group.name !== 'string' ||
      group.name.trim() === '' ||
      group.name.trim().length > BOOKMARK_NAME_MAX_LENGTH ||
      typeof group.order !== 'number' ||
      !Number.isFinite(group.order)
    )
      return false;
    const key = `${group.gameVersion}:${group.id}`;
    if (groupKeys.has(key)) return false;
    groupKeys.add(key);
  }
  const bookmarkKeys = new Set<string>();
  for (const bookmark of value.bookmarks) {
    if (
      !isObject(bookmark) ||
      typeof bookmark.id !== 'string' ||
      bookmark.id === '' ||
      (bookmark.gameVersion !== 'poe1' && bookmark.gameVersion !== 'poe2') ||
      typeof bookmark.name !== 'string' ||
      bookmark.name.trim() === '' ||
      bookmark.name.trim().length > BOOKMARK_NAME_MAX_LENGTH ||
      typeof bookmark.groupId !== 'string' ||
      !groupKeys.has(`${bookmark.gameVersion}:${bookmark.groupId}`) ||
      typeof bookmark.order !== 'number' ||
      !Number.isFinite(bookmark.order) ||
      (bookmark.coverImageUrl !== undefined && !isValidPoeCdnImageUrl(bookmark.coverImageUrl)) ||
      (bookmark.leaguePinned !== undefined && bookmark.leaguePinned !== true)
    )
      return false;
    const key = `${bookmark.gameVersion}:${bookmark.id}`;
    if (bookmarkKeys.has(key)) return false;
    bookmarkKeys.add(key);
  }
  return true;
}

export function migrateBookmarkCollectionStateV2ToV3(
  state: BookmarkCollectionStateV2,
): BookmarkCollectionState {
  return {
    schemaVersion: 3,
    folders: state.groups.map((group) => ({
      id: group.id,
      gameVersion: group.gameVersion,
      name: group.name,
      order: group.order,
    })),
    bookmarks: state.bookmarks.map((bookmark) => ({
      id: bookmark.id,
      gameVersion: bookmark.gameVersion,
      name: bookmark.name,
      groupId: bookmark.groupId,
      order: bookmark.order,
      createdAt: bookmark.createdAt,
      coverImageUrl: bookmark.coverImageUrl,
    })),
  };
}

export function normalizeStoredFolder(folder: BookmarkFolder): BookmarkFolder {
  const icon = normalizeFolderIcon(folder.icon);
  const color = normalizeFolderColor(folder.color);
  return {
    id: folder.id,
    gameVersion: folder.gameVersion,
    name: folder.name,
    order: folder.order,
    ...(folder.parentId !== undefined ? { parentId: folder.parentId } : {}),
    ...(icon ? { icon } : {}),
    ...(color ? { color } : {}),
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
