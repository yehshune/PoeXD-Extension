import type { PoeVersion } from './trade-context';
import {
  isLegacyTradeSearchUrl,
  parseTradeSearchUrl,
  stripLiveSuffix,
} from './trade-search-identity';
import {
  BOOKMARK_NAME_MAX_LENGTH,
  formatFolderPath,
  getFolderSubtreeIds,
  validateFolderHierarchy,
} from './bookmark-collection';
import {
  BookmarkTransferInputError,
  toBookmarkTransferInputError,
} from './bookmark-transfer-errors';
import { parseBetterTradingExport } from './bookmark-transfer-better-trading';
import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import {
  decodeTftBase64,
  encodeTftBase64,
  fromTftBookmarkExport,
  isTftBookmarkExport,
  readPoexdHint,
  toTftBookmarkExport,
} from './bookmark-transfer-tft';

export interface BookmarkTransferItem {
  name: string;
  url: string;
  coverImageUrl?: string;
  /** 固定聯盟；未設定時為「自動」聯盟。 */
  leaguePinned?: true;
}

export interface BookmarkTransferFolder {
  name: string;
  bookmarks: BookmarkTransferItem[];
  folders?: BookmarkTransferFolder[];
}

export interface BookmarkTransferPayloadV2 {
  kind: 'poexd-bookmarks';
  schemaVersion: 2;
  gameVersion: PoeVersion;
  scope: 'collection' | 'folder';
  folders: BookmarkTransferFolder[];
}

/** 內部（記憶體／擴充訊息）使用的書籤匯出入信封；對外分享一律使用 TFT 格式。 */
export type BookmarkTransferPayload = BookmarkTransferPayloadV2;

export interface PreparedBookmarkTransferImport {
  groups: Array<{ id: string; name: string; order: number; parentId?: string }>;
  bookmarks: Array<
    BookmarkTransferItem & {
      id: string;
      groupId: string;
      order: number;
      createdAt?: number;
    }
  >;
}

export function buildBookmarkTransfer(
  gameVersion: PoeVersion,
  scope: 'collection' | 'folder',
  collection: {
    groups: Array<{ id: string; name: string; order: number; parentId?: string }>;
    bookmarks: Array<BookmarkTransferItem & { groupId: string; order: number }>;
  },
  groupId?: string,
): BookmarkTransferPayloadV2 {
  const groupIds = new Set(collection.groups.map((group) => group.id));
  if (
    collection.bookmarks.some((bookmark) => !bookmark.groupId || !groupIds.has(bookmark.groupId))
  ) {
    throw new Error('Bookmark Transfer requires every Bookmark to belong to a folder');
  }

  const hierarchyCheck = validateFolderHierarchy(
    collection.groups.map((g) => ({
      ...g,
      gameVersion,
    })),
  );
  if (!hierarchyCheck.ok) {
    throw new Error(
      `Bookmark Transfer cannot export invalid folder hierarchy: ${hierarchyCheck.error}`,
    );
  }

  function buildExportFolder(folder: { id: string; name: string }): BookmarkTransferFolder {
    const bookmarks = collection.bookmarks
      .filter((bookmark) => bookmark.groupId === folder.id)
      .toSorted((left, right) => left.order - right.order)
      .map(toTransferItem);

    const childFolders = collection.groups
      .filter((child) => child.parentId === folder.id)
      .toSorted((left, right) => left.order - right.order);

    const result: BookmarkTransferFolder = {
      name: folder.name,
      bookmarks,
    };

    if (childFolders.length > 0) {
      result.folders = childFolders.map(buildExportFolder);
    }

    return result;
  }

  if (scope === 'folder') {
    const targetFolder = collection.groups.find((group) => group.id === groupId);
    if (!targetFolder) {
      throw new Error('Bookmark Transfer folder was not found');
    }
    return normalizeBookmarkTransfer({
      kind: 'poexd-bookmarks',
      schemaVersion: 2,
      gameVersion,
      scope,
      folders: [buildExportFolder(targetFolder)],
    }) as BookmarkTransferPayloadV2;
  }

  const rootFolders = collection.groups
    .filter((group) => group.parentId === undefined)
    .toSorted((left, right) => left.order - right.order);

  return normalizeBookmarkTransfer({
    kind: 'poexd-bookmarks',
    schemaVersion: 2,
    gameVersion,
    scope,
    folders: rootFolders.map(buildExportFolder),
  }) as BookmarkTransferPayloadV2;
}

export interface BookmarkTransferPlanSummary {
  createdFoldersCount: number;
  deletedFoldersCount: number;
  retainedFoldersCount: number;
  createdBookmarksCount: number;
  deletedBookmarksCount: number;
  retainedBookmarksCount: number;
  updatedBookmarksCount: number;
  skippedBookmarksCount: number;
  /** 因 Legacy Search ID（官方已不解析的短碼）而略過的書籤數，已包含在 skippedBookmarksCount 中。見 ADR-0008。 */
  skippedLegacyBookmarksCount: number;
}

export type BookmarkTransferItemStatus = 'create' | 'delete' | 'retain' | 'skip' | 'update';

export interface BookmarkTransferPlanBookmarkNode {
  name: string;
  url: string;
  status: BookmarkTransferItemStatus;
}

export interface BookmarkTransferPlanFolderNode {
  id?: string;
  name: string;
  status: 'create' | 'delete' | 'retain';
  folders: BookmarkTransferPlanFolderNode[];
  bookmarks: BookmarkTransferPlanBookmarkNode[];
}

export type BookmarkImportMode = 'create' | 'merge' | 'replace';

export interface BookmarkTransferImportOptions {
  mode: BookmarkImportMode;
  targetGroupId?: string;
}

export interface BookmarkFolderConflictCandidate {
  id: string;
  name: string;
  parentId?: string;
  path: string;
}

export interface BookmarkImportConflictInfo {
  hasConflict: boolean;
  candidates: BookmarkFolderConflictCandidate[];
}

export function resolveUniqueFolderName(baseName: string, existingNames: Iterable<string>): string {
  const existingSet = existingNames instanceof Set ? existingNames : new Set(existingNames);
  if (!existingSet.has(baseName)) {
    return baseName;
  }
  let counter = 2;
  while (true) {
    const suffix = ` (${counter})`;
    let candidateName: string;
    if (baseName.length + suffix.length > BOOKMARK_NAME_MAX_LENGTH) {
      candidateName = baseName.slice(0, BOOKMARK_NAME_MAX_LENGTH - suffix.length) + suffix;
    } else {
      candidateName = `${baseName}${suffix}`;
    }
    if (!existingSet.has(candidateName)) {
      return candidateName;
    }
    counter += 1;
  }
}

export function detectBookmarkImportConflict(
  payload: BookmarkTransferPayload,
  currentGroups: ReadonlyArray<{ id: string; name: string; parentId?: string }>,
): BookmarkImportConflictInfo {
  if (payload.scope === 'folder') {
    const incomingFolder = payload.folders[0];
    if (!incomingFolder) {
      return { hasConflict: false, candidates: [] };
    }
    const candidates: BookmarkFolderConflictCandidate[] = currentGroups
      .filter((g) => g.name === incomingFolder.name)
      .map((g) => ({
        id: g.id,
        name: g.name,
        parentId: g.parentId,
        path: formatFolderPath([...currentGroups], g.id) || g.name,
      }));
    return {
      hasConflict: candidates.length > 0,
      candidates,
    };
  }

  // Collection scope:
  const existingRootNames = new Set(
    currentGroups.filter((g) => g.parentId === undefined).map((g) => g.name),
  );
  const hasConflict = payload.folders.some((f) => existingRootNames.has(f.name));
  return {
    hasConflict,
    candidates: [],
  };
}

export interface BookmarkTransferPlan {
  payload: BookmarkTransferPayload;
  mode: BookmarkImportMode;
  targetGroupId?: string;
  summary: BookmarkTransferPlanSummary;
  tree: BookmarkTransferPlanFolderNode[];
  prepared: PreparedBookmarkTransferImport;
}

export function planBookmarkTransferImport(
  value: unknown,
  current: {
    groups: ReadonlyArray<{ id: string; name: string; order: number; parentId?: string }>;
    bookmarks: ReadonlyArray<
      BookmarkTransferItem & {
        id: string;
        groupId: string;
        order: number;
        createdAt?: number;
      }
    >;
  },
  gameVersion: PoeVersion,
  modeOrOptions: BookmarkImportMode | BookmarkTransferImportOptions,
  createId: () => string = () => crypto.randomUUID(),
): BookmarkTransferPlan {
  const payload = normalizeBookmarkTransfer(value);
  if (payload.gameVersion !== gameVersion) {
    throw new Error('Bookmark Transfer belongs to another game version');
  }

  const options: BookmarkTransferImportOptions =
    typeof modeOrOptions === 'string'
      ? { mode: modeOrOptions }
      : {
          mode: modeOrOptions.mode,
          targetGroupId: modeOrOptions.targetGroupId,
        };
  const mode = options.mode;
  const targetGroupId = options.targetGroupId;

  const replaceCollection = mode === 'replace' && payload.scope === 'collection';
  const groups: Array<{ id: string; name: string; order: number; parentId?: string }> =
    replaceCollection ? [] : current.groups.map((group) => ({ ...group }));
  const bookmarks = replaceCollection ? [] : current.bookmarks.map((bookmark) => ({ ...bookmark }));
  const claimedGroupIds = new Set<string>();

  const deletedGroupIds = new Set<string>();
  const deletedBookmarkIds = new Set<string>();

  if (replaceCollection) {
    current.groups.forEach((g) => deletedGroupIds.add(g.id));
    current.bookmarks.forEach((b) => deletedBookmarkIds.add(b.id));
  }

  let folderTargetGroup: { id: string; name: string; order: number; parentId?: string } | undefined;
  if (payload.scope === 'folder' && (mode === 'merge' || mode === 'replace')) {
    const incomingFolder = payload.folders[0];
    if (targetGroupId) {
      folderTargetGroup = groups.find((candidate) => candidate.id === targetGroupId);
      if (!folderTargetGroup) {
        throw new Error('Target folder was not found or has been deleted');
      }
      if (folderTargetGroup.name !== incomingFolder.name) {
        throw new Error('Target folder does not match incoming folder name');
      }
    } else {
      const candidates = groups.filter((candidate) => candidate.name === incomingFolder.name);
      if (candidates.length === 0) {
        throw new Error('No matching existing folder found for import');
      }
      if (candidates.length > 1) {
        throw new Error(
          'Multiple target folders found with the same name. Please specify targetGroupId.',
        );
      }
      folderTargetGroup = candidates[0];
    }

    if (mode === 'replace') {
      const oldSubtreeIds = getFolderSubtreeIds(groups, folderTargetGroup.id);
      for (let i = groups.length - 1; i >= 0; i--) {
        if (groups[i].id !== folderTargetGroup.id && oldSubtreeIds.has(groups[i].id)) {
          deletedGroupIds.add(groups[i].id);
          groups.splice(i, 1);
        }
      }
      for (let i = bookmarks.length - 1; i >= 0; i--) {
        if (oldSubtreeIds.has(bookmarks[i].groupId)) {
          deletedBookmarkIds.add(bookmarks[i].id);
          bookmarks.splice(i, 1);
        }
      }
    }
  }

  const createdGroupIds = new Set<string>();
  const createdBookmarkIds = new Set<string>();
  const updatedBookmarkIds = new Set<string>();
  const skippedBookmarksByFolder = new Map<string, BookmarkTransferPlanBookmarkNode[]>();
  let skippedBookmarksCount = 0;
  let skippedLegacyBookmarksCount = 0;
  let updatedBookmarksCount = 0;

  function recordSkippedBookmark(item: BookmarkTransferItem, groupId: string) {
    skippedBookmarksCount += 1;
    const skippedList = skippedBookmarksByFolder.get(groupId) ?? [];
    skippedList.push({ name: item.name, url: item.url, status: 'skip' });
    skippedBookmarksByFolder.set(groupId, skippedList);
  }

  function getNextSiblingOrder(parentId: string | undefined): number {
    const siblings = groups.filter((g) => g.parentId === parentId);
    return siblings.length > 0 ? Math.max(...siblings.map((g) => g.order)) + 1 : 0;
  }

  function importBookmarksIntoGroup(
    items: BookmarkTransferItem[],
    targetGroup: { id: string },
    isMerge: boolean,
  ) {
    items.forEach((item, order) => {
      const identity = transferIdentity(item, gameVersion);
      if (isLegacyTradeSearchUrl(item.url)) {
        skippedLegacyBookmarksCount += 1;
        recordSkippedBookmark(item, targetGroup.id);
        return;
      }
      const duplicate = isMerge
        ? bookmarks.find(
            (b) =>
              b.groupId === targetGroup.id &&
              b.name.trim() === item.name &&
              transferIdentity(b, gameVersion) === identity,
          )
        : undefined;

      if (duplicate) {
        if (!duplicate.coverImageUrl && item.coverImageUrl) {
          duplicate.coverImageUrl = item.coverImageUrl;
          updatedBookmarkIds.add(duplicate.id);
          updatedBookmarksCount += 1;
        } else {
          recordSkippedBookmark(item, targetGroup.id);
        }
        return;
      }

      const newBookmarkId = `bookmark:${createId()}`;
      createdBookmarkIds.add(newBookmarkId);
      bookmarks.push({
        id: newBookmarkId,
        name: item.name,
        url: item.url,
        groupId: targetGroup.id,
        order: isMerge ? bookmarks.filter((b) => b.groupId === targetGroup.id).length : order,
        ...(item.coverImageUrl ? { coverImageUrl: item.coverImageUrl } : {}),
        ...(item.leaguePinned ? { leaguePinned: true as const } : {}),
      });
    });
  }

  function createSubtree(
    folder: BookmarkTransferFolder,
    parentId: string | undefined,
    forcedName?: string,
    siblingIndex?: number,
  ): { id: string; name: string; order: number; parentId?: string } {
    const group = {
      id: `group:${createId()}`,
      name: forcedName ?? folder.name,
      order: siblingIndex !== undefined ? siblingIndex : getNextSiblingOrder(parentId),
      ...(parentId !== undefined ? { parentId } : {}),
    };
    groups.push(group);
    createdGroupIds.add(group.id);
    claimedGroupIds.add(group.id);

    importBookmarksIntoGroup(folder.bookmarks, group, false);

    if (Array.isArray(folder.folders)) {
      folder.folders.forEach((child, idx) => {
        createSubtree(child, group.id, undefined, idx);
      });
    }

    return group;
  }

  function mergeSubtree(
    folder: BookmarkTransferFolder,
    targetGroup: { id: string; name: string; order: number; parentId?: string },
  ) {
    claimedGroupIds.add(targetGroup.id);
    importBookmarksIntoGroup(folder.bookmarks, targetGroup, true);

    if (Array.isArray(folder.folders)) {
      folder.folders.forEach((childFolder) => {
        const matchingChild = groups.find(
          (candidate) =>
            candidate.parentId === targetGroup.id &&
            candidate.name === childFolder.name &&
            !claimedGroupIds.has(candidate.id),
        );
        if (matchingChild) {
          mergeSubtree(childFolder, matchingChild);
        } else {
          createSubtree(childFolder, targetGroup.id);
        }
      });
    }
  }

  if (payload.scope === 'folder') {
    const incomingFolder = payload.folders[0];
    if (mode === 'create') {
      const existingRootNames = new Set(
        groups.filter((g) => g.parentId === undefined).map((g) => g.name),
      );
      const uniqueName = resolveUniqueFolderName(incomingFolder.name, existingRootNames);
      createSubtree(incomingFolder, undefined, uniqueName);
    } else if (mode === 'merge') {
      mergeSubtree(incomingFolder, folderTargetGroup!);
    } else if (mode === 'replace') {
      claimedGroupIds.add(folderTargetGroup!.id);
      importBookmarksIntoGroup(incomingFolder.bookmarks, folderTargetGroup!, false);
      if ('folders' in incomingFolder && Array.isArray(incomingFolder.folders)) {
        incomingFolder.folders.forEach((child: BookmarkTransferFolder, idx: number) => {
          createSubtree(child, folderTargetGroup!.id, undefined, idx);
        });
      }
    }
  } else {
    // collection scope
    if (mode === 'replace') {
      payload.folders.forEach((folder, folderIndex) => {
        createSubtree(folder, undefined, undefined, folderIndex);
      });
    } else if (mode === 'create') {
      payload.folders.forEach((folder) => {
        const currentRootNames = new Set(
          groups.filter((g) => g.parentId === undefined).map((g) => g.name),
        );
        const uniqueName = resolveUniqueFolderName(folder.name, currentRootNames);
        createSubtree(folder, undefined, uniqueName);
      });
    } else {
      // mode === 'merge'
      payload.folders.forEach((folder) => {
        const matchingRoot = groups.find(
          (candidate) =>
            candidate.parentId === undefined &&
            candidate.name === folder.name &&
            !claimedGroupIds.has(candidate.id),
        );
        if (matchingRoot) {
          mergeSubtree(folder, matchingRoot);
        } else {
          createSubtree(folder, undefined);
        }
      });
    }
  }

  const deletedFoldersCount = deletedGroupIds.size;
  const deletedBookmarksCount = deletedBookmarkIds.size;
  const retainedFoldersCount = current.groups.length - deletedFoldersCount;
  const retainedBookmarksCount =
    current.bookmarks.length - deletedBookmarksCount - updatedBookmarkIds.size;
  const createdFoldersCount = createdGroupIds.size;
  const createdBookmarksCount = createdBookmarkIds.size;

  const summary: BookmarkTransferPlanSummary = {
    createdFoldersCount,
    deletedFoldersCount,
    retainedFoldersCount,
    createdBookmarksCount,
    deletedBookmarksCount,
    retainedBookmarksCount,
    updatedBookmarksCount,
    skippedBookmarksCount,
    skippedLegacyBookmarksCount,
  };

  const tree = buildPlanTree({
    current,
    groups,
    bookmarks,
    deletedGroupIds,
    deletedBookmarkIds,
    createdGroupIds,
    createdBookmarkIds,
    updatedBookmarkIds,
    skippedBookmarksByFolder,
  });

  return {
    payload,
    mode,
    targetGroupId:
      payload.scope === 'folder' && (mode === 'merge' || mode === 'replace')
        ? (folderTargetGroup?.id ?? targetGroupId)
        : undefined,
    summary,
    tree,
    prepared: { groups, bookmarks },
  };
}

function buildPlanTree(options: {
  current: {
    groups: ReadonlyArray<{ id: string; name: string; order: number; parentId?: string }>;
    bookmarks: ReadonlyArray<BookmarkTransferItem & { id: string; groupId: string }>;
  };
  groups: Array<{ id: string; name: string; order: number; parentId?: string }>;
  bookmarks: Array<BookmarkTransferItem & { id: string; groupId: string }>;
  deletedGroupIds: Set<string>;
  deletedBookmarkIds: Set<string>;
  createdGroupIds: Set<string>;
  createdBookmarkIds: Set<string>;
  updatedBookmarkIds: Set<string>;
  skippedBookmarksByFolder: Map<string, BookmarkTransferPlanBookmarkNode[]>;
}): BookmarkTransferPlanFolderNode[] {
  const {
    current,
    groups,
    bookmarks,
    deletedGroupIds,
    deletedBookmarkIds,
    createdGroupIds,
    createdBookmarkIds,
    updatedBookmarkIds,
    skippedBookmarksByFolder,
  } = options;

  function buildFolderNode(
    folder: { id: string; name: string; parentId?: string },
    status: 'create' | 'delete' | 'retain',
  ): BookmarkTransferPlanFolderNode {
    const childFolderNodes: BookmarkTransferPlanFolderNode[] = [];
    const bookmarkNodes: BookmarkTransferPlanBookmarkNode[] = [];

    if (status === 'delete') {
      const currentFolderBookmarks = current.bookmarks.filter((b) => b.groupId === folder.id);
      currentFolderBookmarks.forEach((b) => {
        bookmarkNodes.push({ name: b.name, url: b.url, status: 'delete' });
      });
      const childGroups = current.groups.filter((g) => g.parentId === folder.id);
      childGroups.forEach((cg) => {
        childFolderNodes.push(buildFolderNode(cg, 'delete'));
      });
    } else if (status === 'create') {
      const folderBookmarks = bookmarks.filter((b) => b.groupId === folder.id);
      folderBookmarks.forEach((b) => {
        bookmarkNodes.push({ name: b.name, url: b.url, status: 'create' });
      });
      bookmarkNodes.push(...(skippedBookmarksByFolder.get(folder.id) ?? []));
      const childGroups = groups.filter((g) => g.parentId === folder.id);
      childGroups.forEach((cg) => {
        childFolderNodes.push(buildFolderNode(cg, 'create'));
      });
    } else {
      const currentDeletedBookmarks = current.bookmarks.filter(
        (b) => b.groupId === folder.id && deletedBookmarkIds.has(b.id),
      );
      currentDeletedBookmarks.forEach((b) => {
        bookmarkNodes.push({ name: b.name, url: b.url, status: 'delete' });
      });

      const folderBookmarks = bookmarks.filter((b) => b.groupId === folder.id);
      folderBookmarks.forEach((b) => {
        const isCreated = createdBookmarkIds.has(b.id);
        const isUpdated = updatedBookmarkIds.has(b.id);
        bookmarkNodes.push({
          name: b.name,
          url: b.url,
          status: isCreated ? 'create' : isUpdated ? 'update' : 'retain',
        });
      });

      const skipped = skippedBookmarksByFolder.get(folder.id) ?? [];
      skipped.forEach((sb) => {
        bookmarkNodes.push(sb);
      });

      const deletedChildren = current.groups.filter(
        (g) => g.parentId === folder.id && deletedGroupIds.has(g.id),
      );
      deletedChildren.forEach((dc) => {
        childFolderNodes.push(buildFolderNode(dc, 'delete'));
      });

      const activeChildren = groups.filter((g) => g.parentId === folder.id);
      activeChildren.forEach((ac) => {
        const isCreated = createdGroupIds.has(ac.id);
        childFolderNodes.push(buildFolderNode(ac, isCreated ? 'create' : 'retain'));
      });
    }

    return {
      id: folder.id,
      name: folder.name,
      status,
      folders: childFolderNodes,
      bookmarks: bookmarkNodes,
    };
  }

  const rootNodes: BookmarkTransferPlanFolderNode[] = [];

  const deletedRoots = current.groups.filter(
    (g) => g.parentId === undefined && deletedGroupIds.has(g.id),
  );
  deletedRoots.forEach((dr) => {
    rootNodes.push(buildFolderNode(dr, 'delete'));
  });

  const activeRoots = groups.filter((g) => g.parentId === undefined);
  activeRoots.forEach((ar) => {
    const isCreated = createdGroupIds.has(ar.id);
    rootNodes.push(buildFolderNode(ar, isCreated ? 'create' : 'retain'));
  });

  return rootNodes;
}

export function prepareBookmarkTransferImport(
  value: unknown,
  current: {
    groups: ReadonlyArray<{ id: string; name: string; order: number; parentId?: string }>;
    bookmarks: ReadonlyArray<
      BookmarkTransferItem & {
        id: string;
        groupId: string;
        order: number;
        createdAt?: number;
      }
    >;
  },
  gameVersion: PoeVersion,
  modeOrOptions: BookmarkImportMode | BookmarkTransferImportOptions,
  createId: () => string = () => crypto.randomUUID(),
): PreparedBookmarkTransferImport {
  return planBookmarkTransferImport(value, current, gameVersion, modeOrOptions, createId).prepared;
}

const MAX_CODE_LENGTH = 1024 * 1024;
const MAX_JSON_LENGTH = 8 * 1024 * 1024;
const MAX_FOLDERS = 500;
const MAX_BOOKMARKS = 5000;

export function normalizeBookmarkTransfer(value: unknown): BookmarkTransferPayload {
  if (
    !isObject(value) ||
    value.kind !== 'poexd-bookmarks' ||
    value.schemaVersion !== 2 ||
    (value.gameVersion !== 'poe1' && value.gameVersion !== 'poe2') ||
    (value.scope !== 'collection' && value.scope !== 'folder') ||
    !Array.isArray(value.folders) ||
    Object.prototype.hasOwnProperty.call(value, 'ungrouped') ||
    Object.prototype.hasOwnProperty.call(value, 'groups') ||
    Object.prototype.hasOwnProperty.call(value, 'searchRecords')
  ) {
    throw new Error('Bookmark Transfer payload is malformed');
  }

  const gameVersion = value.gameVersion as PoeVersion;
  const scope = value.scope as 'collection' | 'folder';

  if (scope === 'folder' && value.folders.length !== 1) {
    throw new Error('Folder transfer requires exactly one folder');
  }

  let totalFolderCount = 0;
  let totalBookmarkCount = 0;
  const visited = new Set<object>();

  function normalizeFolderRecursive(folder: unknown): BookmarkTransferFolder {
    if (!isObject(folder) || !Array.isArray(folder.bookmarks)) {
      throw new Error('Bookmark Transfer contains an invalid folder');
    }
    if (visited.has(folder)) {
      throw new Error('Bookmark Transfer contains a folder cycle');
    }
    visited.add(folder);

    totalFolderCount += 1;
    if (totalFolderCount > MAX_FOLDERS) {
      throw new Error(`Bookmark Transfer supports at most ${MAX_FOLDERS} folders`);
    }

    const name = normalizeName(folder.name, 'folder');
    const bookmarks = folder.bookmarks.map((bookmark) => {
      totalBookmarkCount += 1;
      if (totalBookmarkCount > MAX_BOOKMARKS) {
        throw new Error(`Bookmark Transfer supports at most ${MAX_BOOKMARKS} Bookmarks`);
      }
      return normalizeItem(bookmark, gameVersion);
    });

    const result: BookmarkTransferFolder = {
      name,
      bookmarks,
    };

    if (Object.prototype.hasOwnProperty.call(folder, 'folders')) {
      if (!Array.isArray(folder.folders)) {
        throw new Error('Bookmark Transfer subfolders must be an array');
      }
      if (folder.folders.length > 0) {
        result.folders = folder.folders.map((child) => normalizeFolderRecursive(child));
      }
    }

    return result;
  }

  const folders = value.folders.map((f) => normalizeFolderRecursive(f));

  return {
    kind: 'poexd-bookmarks',
    schemaVersion: 2,
    gameVersion,
    scope,
    folders,
  };
}

/**
 * 產生分享碼：與 TFT Trade Extension 相同的 `Base64(JSON.stringify({ folders }))`，無前綴。
 */
export async function encodeBookmarkTransfer(payload: unknown): Promise<string> {
  const normalized = normalizeBookmarkTransfer(payload);
  const code = encodeTftBase64(JSON.stringify(toTftBookmarkExport(normalized)));
  if (code.length > MAX_CODE_LENGTH) throw new Error('Bookmark Transfer code is too large');
  return code;
}

/** 書籤備份檔內容：TFT 相容的 `{ folders }` JSON。 */
export function stringifyBookmarkTransfer(payload: unknown, space?: number): string {
  const json = JSON.stringify(toTftBookmarkExport(normalizeBookmarkTransfer(payload)), null, space);
  if (new TextEncoder().encode(json).byteLength > MAX_JSON_LENGTH) {
    throw new Error('Bookmark Transfer payload is too large');
  }
  return json;
}

export interface DecodeBookmarkTransferOptions {
  /** 匯入目標遊戲版本：TFT 分享碼同時包含 PoE 1／PoE 2 書籤，只取此版本。 */
  gameVersion?: PoeVersion;
  /** 自動聯盟書籤在內部記錄所使用的聯盟（通常為目前頁面聯盟）。 */
  fallbackLeague?: string;
}

/**
 * 解析分享碼或備份檔，自動判斷格式：
 * - TFT Trade Extension：無前綴 Base64 JSON 分享碼，或相同內容的 `{ folders }` JSON 備份檔
 * - Better Trading：`3:`／`2:`／無前綴 v1 資料夾分享碼，或多行備份檔（一律匯入為自動聯盟）
 */
export async function decodeBookmarkTransfer(
  input: string,
  options: DecodeBookmarkTransferOptions = {},
): Promise<BookmarkTransferPayload> {
  try {
    return decodeBookmarkTransferInput(input, options);
  } catch (error) {
    // 解析器與內部驗證的原始錯誤不外漏給使用者，統一轉為可讀訊息（原始錯誤保留於 cause）
    throw toBookmarkTransferInputError(error);
  }
}

function decodeBookmarkTransferInput(
  input: string,
  options: DecodeBookmarkTransferOptions,
): BookmarkTransferPayload {
  const trimmed = input.trim();
  if (trimmed.length > MAX_CODE_LENGTH && !trimmed.startsWith('{')) {
    throw new Error('Bookmark Transfer input is too large');
  }
  const betterTrading = trimmed.startsWith('{')
    ? undefined
    : parseBetterTradingExport(trimmed, { gameVersion: options.gameVersion });
  if (betterTrading) {
    return normalizeBookmarkTransfer(
      fromTftBookmarkExport(betterTrading.value, {
        gameVersion: betterTrading.gameVersion,
        fallbackLeague: options.fallbackLeague,
      }),
    );
  }
  const json = trimmed.startsWith('{') ? trimmed : decodeTftBase64(trimmed);
  if (new TextEncoder().encode(json).byteLength > MAX_JSON_LENGTH) {
    throw new Error('Bookmark Transfer payload is too large');
  }
  const parsed = JSON.parse(json) as unknown;
  if (!isTftBookmarkExport(parsed)) {
    throw new BookmarkTransferInputError('bookmarkTransfer.error.unrecognizedFormat');
  }
  const gameVersion =
    options.gameVersion ?? readPoexdHint(parsed)?.gameVersion ?? inferTftGameVersion(parsed);
  return normalizeBookmarkTransfer(
    fromTftBookmarkExport(parsed, { gameVersion, fallbackLeague: options.fallbackLeague }),
  );
}

function inferTftGameVersion(value: { folders: Array<{ bookmarks: unknown[] }> }): PoeVersion {
  const first = value.folders
    .flatMap((folder) => folder.bookmarks)
    .find((bookmark) => isObject(bookmark) && typeof bookmark.poeVersion === 'string');
  return isObject(first) && first.poeVersion === 'Poe2' ? 'poe2' : 'poe1';
}

function normalizeItem(value: unknown, gameVersion: PoeVersion): BookmarkTransferItem {
  if (!isObject(value)) throw new Error('Bookmark Transfer contains an invalid Bookmark');
  const name = normalizeName(value.name, 'Bookmark');
  const parsed =
    typeof value.url === 'string' && value.url.length <= 8192
      ? parseTradeSearchUrl(value.url)
      : undefined;
  if (!parsed) {
    throw new Error('Bookmark Transfer requires a valid Path of Exile Trade URL');
  }
  if (parsed.gameVersion !== gameVersion) {
    throw new Error('Bookmark Transfer contains a Bookmark for another game version');
  }
  const coverImageUrl = normalizeCover(value.coverImageUrl);
  return {
    name,
    url: stripLiveSuffix(value.url),
    ...(coverImageUrl ? { coverImageUrl } : {}),
    ...(value.leaguePinned === true ? { leaguePinned: true as const } : {}),
  };
}

function toTransferItem(value: BookmarkTransferItem): BookmarkTransferItem {
  return {
    name: value.name,
    url: value.url,
    ...(value.coverImageUrl ? { coverImageUrl: value.coverImageUrl } : {}),
    ...(value.leaguePinned ? { leaguePinned: true as const } : {}),
  };
}

function transferIdentity(
  item: Pick<BookmarkTransferItem, 'url' | 'leaguePinned'>,
  gameVersion: PoeVersion,
) {
  const identity = parseTradeSearchUrl(item.url);
  if (!identity || identity.gameVersion !== gameVersion) {
    throw new Error(`Bookmark Transfer contains a Bookmark for a different game version`);
  }
  // 自動聯盟書籤不綁聯盟：只以搜尋代碼判斷是否重複
  const league = item.leaguePinned ? identity.league.toLowerCase() : '*';
  return `${identity.gameVersion}:${league}:${identity.searchId}`;
}

function normalizeName(value: unknown, label: string) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.trim().length > BOOKMARK_NAME_MAX_LENGTH
  ) {
    throw new Error(`Bookmark Transfer contains an invalid ${label} name`);
  }
  return value.trim();
}

function normalizeCover(value: unknown) {
  return isValidPoeCdnImageUrl(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
