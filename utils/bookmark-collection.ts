import type { PoeVersion } from './trade-context';
import { isValidPoeCdnImageUrl } from './poe-cdn-url';

export const BOOKMARK_COLLECTION_STATE_KEY = 'poexdBookmarkCollectionStateV3';
export const BOOKMARK_COLLECTION_STATE_KEY_V2 = 'poexdBookmarkCollectionStateV2';
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

export interface BookmarkFolder {
  id: string;
  gameVersion: PoeVersion;
  name: string;
  order: number;
  parentId?: string;
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
      groups: Array<{ id: string; name: string; order: number; parentId?: string }>;
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

export function getFolderSubtreeIds<T extends { id: string; parentId?: string }>(
  folders: readonly T[],
  rootFolderId: string,
): Set<string> {
  const result = new Set<string>();
  const queue = [rootFolderId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (result.has(currentId)) continue;
    result.add(currentId);
    for (const folder of folders) {
      if (folder.parentId === currentId && !result.has(folder.id)) {
        queue.push(folder.id);
      }
    }
  }
  return result;
}

export function isDescendantFolder(
  folders: readonly { id: string; parentId?: string }[],
  folderId: string,
  potentialAncestorId: string,
): boolean {
  if (folderId === potentialAncestorId) return false;
  return getFolderSubtreeIds(folders, potentialAncestorId).has(folderId);
}

export interface FolderDeleteImpact {
  readonly rootFolderId: string;
  readonly subtreeFolderIds: Set<string>;
  readonly totalFolderCount: number;
  readonly descendantFolderCount: number;
  readonly affectedBookmarkIds: string[];
  readonly affectedBookmarkCount: number;
}

export function getFolderDeleteImpact<
  F extends { id: string; parentId?: string },
  B extends { id: string; groupId: string },
>(folders: readonly F[], bookmarks: readonly B[], rootFolderId: string): FolderDeleteImpact {
  const subtreeFolderIds = getFolderSubtreeIds(folders, rootFolderId);
  const affectedBookmarkIds: string[] = [];
  for (const bookmark of bookmarks) {
    if (subtreeFolderIds.has(bookmark.groupId)) {
      affectedBookmarkIds.push(bookmark.id);
    }
  }
  return {
    rootFolderId,
    subtreeFolderIds,
    totalFolderCount: subtreeFolderIds.size,
    descendantFolderCount: Math.max(0, subtreeFolderIds.size - 1),
    affectedBookmarkIds,
    affectedBookmarkCount: affectedBookmarkIds.length,
  };
}

export function isDirectlyDeletableEmptyFolder(impact: FolderDeleteImpact): boolean {
  return impact.descendantFolderCount === 0 && impact.affectedBookmarkCount === 0;
}

export const isDirectlyDeletableFolder = isDirectlyDeletableEmptyFolder;

export function getSubtreeBookmarkIds(
  folders: readonly BookmarkFolder[],
  bookmarks: readonly BookmarkCollectionItem[],
  rootFolderId: string,
): string[] {
  return getFolderDeleteImpact(folders, bookmarks, rootFolderId).affectedBookmarkIds;
}

export function canMoveFolder(
  folders: readonly { id: string; parentId?: string; gameVersion?: string }[],
  folderId: string,
  targetParentId?: string,
): { allowed: boolean; reason?: string } {
  if (targetParentId === undefined) {
    return { allowed: true };
  }
  if (folderId === targetParentId) {
    return { allowed: false, reason: 'Folder cannot be its own parent' };
  }
  const folder = folders.find((f) => f.id === folderId);
  const targetParent = folders.find((f) => f.id === targetParentId);
  if (!targetParent) {
    return { allowed: false, reason: 'Target parent folder does not exist' };
  }
  if (
    folder?.gameVersion &&
    targetParent?.gameVersion &&
    folder.gameVersion !== targetParent.gameVersion
  ) {
    return { allowed: false, reason: 'Folder cannot have parent from a different game version' };
  }
  if (isDescendantFolder(folders, targetParentId, folderId)) {
    return { allowed: false, reason: 'Folder cannot be moved into its own descendant' };
  }
  return { allowed: true };
}

export type FolderDropPosition = 'before' | 'inside' | 'after';

export interface FolderDropIntent {
  targetFolderId: string;
  position: FolderDropPosition;
}

export interface FolderDropPlacementResult {
  ok: boolean;
  reason?: string;
  targetParentId?: string;
  placements?: Array<{ id: string; parentId?: string; order: number }>;
}

export function resolveFolderDropPlacement<
  T extends { id: string; parentId?: string; order: number; gameVersion?: string },
>(
  folders: readonly T[],
  draggedFolderId: string,
  intent: FolderDropIntent,
): FolderDropPlacementResult {
  if (!draggedFolderId) {
    return { ok: false, reason: 'Invalid dragged folder ID' };
  }
  const dragged = folders.find((f) => f.id === draggedFolderId);
  if (!dragged) {
    return { ok: false, reason: `Dragged folder ${draggedFolderId} does not exist` };
  }
  const target = folders.find((f) => f.id === intent.targetFolderId);
  if (!target) {
    return { ok: false, reason: `Target folder ${intent.targetFolderId} does not exist` };
  }
  if (draggedFolderId === intent.targetFolderId) {
    return { ok: false, reason: 'Cannot drop folder onto itself' };
  }

  let targetParentId: string | undefined;
  if (intent.position === 'inside') {
    targetParentId = target.id;
  } else if (intent.position === 'before' || intent.position === 'after') {
    targetParentId = target.parentId;
  } else {
    return { ok: false, reason: `Invalid drop position: ${(intent as any).position}` };
  }

  const check = canMoveFolder(
    folders as unknown as BookmarkFolder[],
    draggedFolderId,
    targetParentId,
  );
  if (!check.allowed) {
    return { ok: false, reason: check.reason };
  }

  const sourceParentId = dragged.parentId;
  const isSameParent = sourceParentId === targetParentId;

  // 1. 計算 targetParentId 下的所有 siblings（排除 dragged）
  const targetSiblings = folders
    .filter((f) => f.parentId === targetParentId && f.id !== draggedFolderId)
    .sort((a, b) => a.order - b.order);

  const updatedTargetSiblings: T[] = [...targetSiblings];

  if (intent.position === 'inside') {
    updatedTargetSiblings.push(dragged);
  } else {
    const targetIndex = updatedTargetSiblings.findIndex((f) => f.id === target.id);
    if (targetIndex === -1) {
      return { ok: false, reason: 'Target folder not found in target parent siblings' };
    }
    const insertIndex = intent.position === 'before' ? targetIndex : targetIndex + 1;
    updatedTargetSiblings.splice(insertIndex, 0, dragged);
  }

  const placements: Array<{ id: string; parentId?: string; order: number }> = [];

  updatedTargetSiblings.forEach((sibling, order) => {
    placements.push({
      id: sibling.id,
      parentId: targetParentId,
      order,
    });
  });

  if (!isSameParent) {
    const sourceSiblings = folders
      .filter((f) => f.parentId === sourceParentId && f.id !== draggedFolderId)
      .sort((a, b) => a.order - b.order);

    sourceSiblings.forEach((sibling, order) => {
      placements.push({
        id: sibling.id,
        parentId: sourceParentId,
        order,
      });
    });
  }

  return {
    ok: true,
    targetParentId,
    placements,
  };
}

export function resolveEffectiveFolderParentMap<
  T extends { id: string; parentId?: string; order?: number },
>(folders: readonly T[]): Map<string, string | undefined> {
  const uniqueFolders: T[] = [];
  const folderMap = new Map<string, T>();
  for (const folder of folders) {
    if (!folderMap.has(folder.id)) {
      folderMap.set(folder.id, folder);
      uniqueFolders.push(folder);
    }
  }

  const effectiveParentMap = new Map<string, string | undefined>();
  for (const folder of uniqueFolders) {
    const rawParentId = folder.parentId;
    if (!rawParentId || rawParentId === folder.id || !folderMap.has(rawParentId)) {
      effectiveParentMap.set(folder.id, undefined);
    } else {
      effectiveParentMap.set(folder.id, rawParentId);
    }
  }

  const visitState = new Map<string, 'visiting' | 'visited'>();
  const orderedFolders = [...uniqueFolders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const folder of orderedFolders) {
    if (visitState.get(folder.id) === 'visited') continue;
    const chain: string[] = [];
    let currId: string | undefined = folder.id;

    while (currId !== undefined) {
      const state = visitState.get(currId);
      if (state === 'visited') break;
      if (state === 'visiting') {
        effectiveParentMap.set(currId, undefined);
        break;
      }
      visitState.set(currId, 'visiting');
      chain.push(currId);
      currId = effectiveParentMap.get(currId);
    }

    for (const id of chain) {
      visitState.set(id, 'visited');
    }
  }

  return effectiveParentMap;
}

export function getFolderAncestors<T extends { id: string; parentId?: string; order?: number }>(
  folders: readonly T[],
  folderId: string,
): T[] {
  const ancestors: T[] = [];
  const map = new Map(folders.map((f) => [f.id, f]));
  const effectiveParentMap = resolveEffectiveFolderParentMap(folders);
  let curr = map.get(folderId);
  const visited = new Set<string>();
  while (curr) {
    if (visited.has(curr.id)) break;
    visited.add(curr.id);
    const parentId = effectiveParentMap.get(curr.id);
    if (!parentId) break;
    const parent = map.get(parentId);
    if (!parent || visited.has(parent.id)) break;
    ancestors.push(parent);
    curr = parent;
  }
  return ancestors;
}

export function getFolderDepth<T extends { id: string; parentId?: string; order?: number }>(
  folders: readonly T[],
  folderId: string,
): number {
  return getFolderAncestors(folders, folderId).length;
}

export interface FolderTreeNode<
  T extends { id: string; order: number; parentId?: string } = BookmarkFolder,
> {
  folder: T;
  children: FolderTreeNode<T>[];
  depth: number;
}

export function buildFolderTree<T extends { id: string; order: number; parentId?: string }>(
  folders: readonly T[],
): FolderTreeNode<T>[] {
  const uniqueFolders: T[] = [];
  const seenIds = new Set<string>();
  for (const folder of folders) {
    if (!seenIds.has(folder.id)) {
      seenIds.add(folder.id);
      uniqueFolders.push(folder);
    }
  }

  const effectiveParentMap = resolveEffectiveFolderParentMap(uniqueFolders);
  const childrenMap = new Map<string | undefined, T[]>();

  for (const folder of uniqueFolders) {
    const key = effectiveParentMap.get(folder.id);
    const list = childrenMap.get(key) ?? [];
    list.push(folder);
    childrenMap.set(key, list);
  }

  const visited = new Set<string>();

  function createNodes(parentId: string | undefined, depth: number): FolderTreeNode<T>[] {
    const items = [...(childrenMap.get(parentId) ?? [])];
    items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const nodes: FolderTreeNode<T>[] = [];
    for (const folder of items) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      nodes.push({
        folder,
        depth,
        children: createNodes(folder.id, depth + 1),
      });
    }
    return nodes;
  }

  return createNodes(undefined, 0);
}

export interface FlattenedFolderTarget<
  T extends { id: string; order: number; parentId?: string } = BookmarkFolder,
> {
  folder: T;
  depth: number;
}

export function getFlattenedFolderTree<T extends { id: string; order: number; parentId?: string }>(
  folders: readonly T[],
  excludeSubtreeOfId?: string,
): FlattenedFolderTarget<T>[] {
  const excludedIds = excludeSubtreeOfId
    ? getFolderSubtreeIds(folders, excludeSubtreeOfId)
    : new Set<string>();

  const tree = buildFolderTree(folders);
  const result: FlattenedFolderTarget<T>[] = [];

  function traverse(nodes: FolderTreeNode<T>[]) {
    for (const node of nodes) {
      if (excludedIds.has(node.folder.id)) {
        continue;
      }
      result.push({
        folder: node.folder,
        depth: node.depth,
      });
      if (node.children.length > 0) {
        traverse(node.children);
      }
    }
  }

  traverse(tree);
  return result;
}

export interface VisibleFolderItem {
  id: string;
  parentId?: string;
  depth: number;
  order: number;
}

export function getVisibleFlattenedFolders<
  T extends { id: string; order: number; parentId?: string },
>(
  folders: readonly T[],
  collapsedFolderIds: ReadonlySet<string>,
  excludeSubtreeOfId?: string,
): VisibleFolderItem[] {
  const excludedIds = excludeSubtreeOfId
    ? getFolderSubtreeIds(folders, excludeSubtreeOfId)
    : new Set<string>();

  const tree = buildFolderTree(folders);
  const result: VisibleFolderItem[] = [];

  function traverse(nodes: FolderTreeNode<T>[]) {
    for (const node of nodes) {
      if (excludedIds.has(node.folder.id)) {
        continue;
      }
      result.push({
        id: node.folder.id,
        parentId: node.depth === 0 ? undefined : node.folder.parentId,
        depth: node.depth,
        order: node.folder.order,
      });
      if (!collapsedFolderIds.has(node.folder.id) && node.children.length > 0) {
        traverse(node.children);
      }
    }
  }

  traverse(tree);
  return result;
}

export function getFolderPathNames(
  folders: readonly { id: string; name: string; parentId?: string; order?: number }[],
  folderId: string,
): string[] {
  const map = new Map(folders.map((f) => [f.id, f]));
  const target = map.get(folderId);
  if (!target) return [];
  const ancestors = getFolderAncestors(folders, folderId);
  return [...ancestors.map((f) => f.name).reverse(), target.name];
}

export function formatFolderPath(
  folders: readonly { id: string; name: string; parentId?: string; order?: number }[],
  folderId: string,
  separator: string = ' / ',
): string {
  const names = getFolderPathNames(folders, folderId);
  return names.join(separator);
}

export function getSiblingFolders(
  folders: BookmarkFolder[],
  gameVersion: PoeVersion,
  parentId?: string,
): BookmarkFolder[] {
  return folders
    .filter((f) => f.gameVersion === gameVersion && f.parentId === parentId)
    .sort((a, b) => a.order - b.order);
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
    folders: (value.folders as BookmarkFolder[]).map((f) => clone(f)),
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
      const index = state.folders.findIndex(
        (item) => item.gameVersion === folder.gameVersion && item.id === folder.id,
      );
      if (index === -1) state.folders.push(clone(folder));
      else state.folders[index] = clone(folder);
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
        state.folders.push(clone(folder));
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

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
