import type { BookmarkCollectionItem, BookmarkFolder } from './bookmark-collection';
import type { PoeVersion } from './trade-context';

export function getFolderSubtreeIds<T extends { id: string; parentId?: string }>(
  folders: readonly T[],
  rootFolderId: string,
): Set<string> {
  // 先建 parentId → children 索引，讓整體為 O(n)；大量資料夾拖曳時每個 frame 都會呼叫
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === undefined) continue;
    const siblings = childrenByParent.get(folder.parentId);
    if (siblings) {
      siblings.push(folder.id);
    } else {
      childrenByParent.set(folder.parentId, [folder.id]);
    }
  }

  const result = new Set<string>();
  const stack = [rootFolderId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (result.has(currentId)) continue;
    result.add(currentId);
    const children = childrenByParent.get(currentId);
    if (!children) continue;
    for (const childId of children) {
      if (!result.has(childId)) stack.push(childId);
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
