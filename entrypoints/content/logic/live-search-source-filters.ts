import { buildFolderTree, type FolderTreeNode } from '@/utils/bookmark-collection';
import { t } from '@/utils/i18n';
import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradeSearchCanonicalKey,
  isLegacySearchId,
  isLegacyTradeSearchUrl,
  parseTradeSearchUrl,
  stripLiveSuffix,
  type ParsedTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import type { LiveSearchSubscriptionStatus } from '@/utils/live-search-contract';
import { DEFAULT_TRADE_ORIGIN, getSupportedTradeOrigin } from '@/utils/trade-realms';
import type {
  LiveSearchBatchIncompatibleBreakdown,
  LiveSearchBatchSkipCounts,
  LiveSearchPrimaryContext,
  LiveSearchSourceCompatibility,
  LiveSearchSourceFilterOptions,
  LiveSearchSourceGroup,
  LiveSearchSourceItem,
  LiveSearchSourceStatusFilter,
} from './live-search-source-types';

export function formatLiveSearchDisplayVersion(version: PoeVersion): string {
  return version === 'poe2' ? 'PoE 2' : 'PoE 1';
}

export function formatLiveSearchDisplayLeague(league: string): string {
  const trimmed = league.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z0-9\s-]+$/.test(trimmed)) {
    return trimmed.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

export function buildCanonicalTradeSearchUrl(
  gameVersion: PoeVersion,
  league: string,
  searchId: string,
): string {
  const currentOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? (getSupportedTradeOrigin(window.location.origin) ?? DEFAULT_TRADE_ORIGIN)
      : DEFAULT_TRADE_ORIGIN;
  const cleanLeague = encodeURIComponent(league.trim());
  const cleanSearchId = encodeURIComponent(searchId.trim());
  if (gameVersion === 'poe2') {
    return `${currentOrigin}/trade2/search/poe2/${cleanLeague}/${cleanSearchId}`;
  }
  return `${currentOrigin}/trade/search/${cleanLeague}/${cleanSearchId}`;
}

/**
 * 依據來源 Canonical Identity 與 PrimaryViewSnapshot 判定來源相容性
 * 屬於 preflight / presentation projection，最終權威仍由 LiveSearchPrimaryRuntime 持有
 */
export function evaluateLiveSearchSourceCompatibility(
  parsed: ParsedTradeSearchIdentity | null | undefined,
  primaryContext: LiveSearchPrimaryContext,
  /** 來源網址（已去除 /live）；提供時只對 `/search/` 路由判定舊式短碼，避免誤判通貨兌換。 */
  sourceUrl?: string,
): {
  compatibility: LiveSearchSourceCompatibility;
  compatibilityMessage?: string;
} {
  if (!parsed) {
    return {
      compatibility: 'invalid-url',
      compatibilityMessage: t('liveSearch.error.bookmarkInvalidUrl'),
    };
  }

  const isLegacy =
    sourceUrl === undefined ? isLegacySearchId(parsed.searchId) : isLegacyTradeSearchUrl(sourceUrl);
  if (isLegacy) {
    return {
      compatibility: 'invalid-url',
      compatibilityMessage: t('liveSearch.error.legacyShortCode'),
    };
  }

  if (parsed.gameVersion !== primaryContext.gameVersion) {
    return {
      compatibility: 'wrong-version',
      compatibilityMessage: t('liveSearch.error.wrongVersion', {
        searchVersion: formatLiveSearchDisplayVersion(parsed.gameVersion),
        consoleVersion: formatLiveSearchDisplayVersion(primaryContext.gameVersion),
      }),
    };
  }

  const lockedLeague = primaryContext.runtimeLeague?.trim();
  if (lockedLeague && parsed.league.trim().toLowerCase() !== lockedLeague.toLowerCase()) {
    return {
      compatibility: 'wrong-league',
      compatibilityMessage: t('liveSearch.error.lockedLeagueMismatch', {
        consoleLeague: formatLiveSearchDisplayLeague(lockedLeague),
        searchLeague: formatLiveSearchDisplayLeague(parsed.league),
      }),
    };
  }

  return {
    compatibility: 'compatible',
  };
}

export function matchesLiveSearchSourceStatusFilter(
  status: LiveSearchSubscriptionStatus | undefined,
  statusFilter: LiveSearchSourceStatusFilter = 'all',
): boolean {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'enabled') {
    return status === 'connecting' || status === 'active' || status === 'reconnecting';
  }
  if (statusFilter === 'error') {
    return status === 'error';
  }
  if (statusFilter === 'disabled') {
    return !status || status === 'idle' || status === 'closed';
  }
  return true;
}

export function filterLiveSearchConnectionItems(
  items: readonly LiveSearchSourceItem[],
  options?: LiveSearchSourceFilterOptions,
): LiveSearchSourceItem[] {
  const query = options?.query?.trim().toLowerCase() ?? '';
  const statusFilter = options?.statusFilter ?? 'all';
  return items.filter((item) => {
    const status = item.status ?? item.liveSearchStatus;
    if (!matchesLiveSearchSourceStatusFilter(status, statusFilter)) {
      return false;
    }
    if (!query) return true;
    const nameMatches = item.name.toLowerCase().includes(query);
    const groupNameMatches = (item.groupName ?? '').toLowerCase().includes(query);
    const urlMatches = item.url.toLowerCase().includes(query);
    const searchIdMatches = item.canonicalIdentity?.searchId.toLowerCase().includes(query) ?? false;
    return nameMatches || groupNameMatches || urlMatches || searchIdMatches;
  });
}

type OrderedSourceGroup = LiveSearchSourceGroup & { order: number };

function buildBookmarkSourceGroupTree(
  bookmarkGroups: readonly LiveSearchSourceGroup[],
): FolderTreeNode<OrderedSourceGroup>[] {
  const ordered: OrderedSourceGroup[] = bookmarkGroups.map((g, index) => ({
    ...g,
    order: typeof g.order === 'number' ? g.order : index,
  }));
  return buildFolderTree(ordered);
}

/**
 * 取得指定資料夾（或自訂群組）完整 subtree 內的所有搜尋來源項目（依 canonical pre-order 排序）
 */
export function getLiveSearchGroupSubtreeItems(
  groups: readonly LiveSearchSourceGroup[],
  groupId: string,
): LiveSearchSourceItem[] {
  const target = groups.find((g) => g.id === groupId);
  if (!target) return [];
  if (target.kind === 'custom') {
    return [...(target.items ?? target.bookmarks ?? [])];
  }

  const bookmarkGroups = groups.filter((g) => (g.kind ?? 'bookmark') !== 'custom');
  const tree = buildBookmarkSourceGroupTree(bookmarkGroups);

  function findTargetNode(
    nodes: FolderTreeNode<OrderedSourceGroup>[],
  ): FolderTreeNode<OrderedSourceGroup> | null {
    for (const node of nodes) {
      if (node.folder.id === groupId) return node;
      if (node.children.length > 0) {
        const found = findTargetNode(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  const targetNode = findTargetNode(tree);
  if (!targetNode) {
    return [...(target.items ?? target.bookmarks ?? [])];
  }

  const items: LiveSearchSourceItem[] = [];
  function collectSubtree(node: FolderTreeNode<OrderedSourceGroup>) {
    const directItems = node.folder.items ?? node.folder.bookmarks ?? [];
    items.push(...directItems);
    for (const child of node.children) {
      collectSubtree(child);
    }
  }

  collectSubtree(targetNode);
  return items;
}

/**
 * 取得指定資料夾（或自訂群組）完整 subtree 內的所有搜尋來源 ID（依 canonical pre-order 排序）
 */
export function getLiveSearchGroupSubtreeSourceIds(
  groups: readonly LiveSearchSourceGroup[],
  groupId: string,
): string[] {
  return getLiveSearchGroupSubtreeItems(groups, groupId).map((item) => item.id);
}

function filterDirectItemsForGroup(
  items: readonly LiveSearchSourceItem[],
  query: string,
  statusFilter: LiveSearchSourceStatusFilter,
  folderMatched: boolean,
): LiveSearchSourceItem[] {
  return items.filter((item) => {
    const status = item.status ?? item.liveSearchStatus;
    if (!matchesLiveSearchSourceStatusFilter(status, statusFilter)) {
      return false;
    }
    if (!query) {
      return true;
    }
    if (folderMatched) {
      return true;
    }
    const nameMatches = item.name.toLowerCase().includes(query);
    const groupNameMatches = (item.groupName ?? '').toLowerCase().includes(query);
    const urlMatches = item.url.toLowerCase().includes(query);
    const searchIdMatches = item.canonicalIdentity?.searchId.toLowerCase().includes(query) ?? false;

    return nameMatches || groupNameMatches || urlMatches || searchIdMatches;
  });
}

export function filterLiveSearchSourceGroups(
  groups: readonly LiveSearchSourceGroup[],
  options?: LiveSearchSourceFilterOptions,
): LiveSearchSourceGroup[] {
  const query = options?.query?.trim().toLowerCase() ?? '';
  const statusFilter = options?.statusFilter ?? 'all';

  const bookmarkGroups = groups.filter((g) => (g.kind ?? 'bookmark') !== 'custom');
  const customGroups = groups.filter((g) => g.kind === 'custom');

  const tree = buildBookmarkSourceGroupTree(bookmarkGroups);

  function filterFolderNodes(
    nodes: FolderTreeNode<OrderedSourceGroup>[],
    ancestorFolderMatched: boolean,
  ): LiveSearchSourceGroup[] {
    const result: LiveSearchSourceGroup[] = [];

    for (const node of nodes) {
      const selfFolderMatches = query !== '' && node.folder.name.toLowerCase().includes(query);
      const inMatchedFolderSubtree = ancestorFolderMatched || selfFolderMatches;
      const rawItems = node.folder.items ?? node.folder.bookmarks ?? [];
      const matchingDirectItems = filterDirectItemsForGroup(
        rawItems,
        query,
        statusFilter,
        inMatchedFolderSubtree,
      );
      const retainedChildren = filterFolderNodes(node.children, inMatchedFolderSubtree);

      if (matchingDirectItems.length > 0 || retainedChildren.length > 0) {
        result.push({
          ...node.folder,
          parentId: node.depth === 0 ? undefined : node.folder.parentId,
          depth: node.depth,
          items: matchingDirectItems,
          bookmarks: matchingDirectItems,
        });
        result.push(...retainedChildren);
      }
    }

    return result;
  }

  const filteredGroups = filterFolderNodes(tree, false);

  for (const group of customGroups) {
    const folderMatches = query !== '' && group.name.toLowerCase().includes(query);
    const rawItems = group.items ?? group.bookmarks ?? [];
    const matchingItems = filterDirectItemsForGroup(rawItems, query, statusFilter, folderMatches);
    if (matchingItems.length > 0) {
      filteredGroups.push({
        ...group,
        depth: 0,
        items: matchingItems,
        bookmarks: matchingItems,
      });
    }
  }

  return filteredGroups;
}

export function extractSectionSourceCanonicalKey(sourceId: string): string | null {
  const trimmed = sourceId.trim();
  if (trimmed.startsWith('prev_')) {
    return trimmed.slice('prev_'.length);
  }
  if (trimmed.startsWith('session_')) {
    return trimmed.slice('session_'.length);
  }
  return null;
}

export function getBookmarkCanonicalKey(bookmark: { url: string }): string | null {
  const parsed = parseTradeSearchUrl(stripLiveSuffix(bookmark.url));
  return parsed ? getTradeSearchCanonicalKey(parsed) : null;
}

export function createEmptyBatchCounters(): {
  skipReasons: LiveSearchBatchSkipCounts;
  incompatibleBreakdown: LiveSearchBatchIncompatibleBreakdown;
} {
  return {
    skipReasons: {
      alreadyActive: 0,
      pending: 0,
      incompatible: 0,
      duplicateInBatch: 0,
      notFound: 0,
      inactive: 0,
    },
    incompatibleBreakdown: {
      invalidUrl: 0,
      wrongVersion: 0,
      wrongLeague: 0,
    },
  };
}
