import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import { buildFolderTree, type FolderTreeNode } from '@/utils/bookmark-folder-tree';
import { t } from '@/utils/i18n';
import {
  getTradeSearchCanonicalKey,
  parseTradeSearchUrl,
  stripLiveSuffix,
  type ParsedTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import type { LiveSearchSubscription } from '@/utils/live-search-contract';
import type { LiveSearchResumeIdentity } from '@/utils/live-search-resume-store';
import { dedupePreviousConnectionItems, hasValidCover } from './connection-dedup';
import {
  buildCanonicalTradeSearchUrl,
  evaluateLiveSearchSourceCompatibility,
  sameLeague,
} from './source-filters';
import {
  TEMPORARY_SOURCE_GROUP_ID,
  TEMPORARY_SOURCE_GROUP_NAME,
  PREVIOUS_CONNECTIONS_GROUP_ID,
  PREVIOUS_CONNECTIONS_GROUP_NAME,
  PREVIOUS_SOURCE_ID_PREFIX,
  SESSION_CONNECTIONS_GROUP_ID,
  SESSION_CONNECTIONS_GROUP_NAME,
  SESSION_SOURCE_ID_PREFIX,
  type TemporarySearchRecord,
  type LiveSearchPrimaryContext,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
  type LiveSearchSourceSnapshot,
  type SessionConnectionMeta,
} from './types';

export interface BuildLiveSearchSnapshotInput {
  loading: boolean;
  errorMessage?: string;
  isLeagueResolved: boolean;
  isSwitchingLeague: boolean;
  selectedLeague: string;
  availableLeagues: readonly string[];
  primaryContext: LiveSearchPrimaryContext;
  hasSource: boolean;
  currentCollection: BookmarkCollectionView | null;
  currentLiveSubscriptions: readonly Readonly<LiveSearchSubscription>[];
  temporarySearches: readonly TemporarySearchRecord[];
  sessionEntriesByKey: ReadonlyMap<string, SessionConnectionMeta>;
  pendingSearchKeys: ReadonlySet<string>;
  combinedResumeMap: ReadonlyMap<string, LiveSearchResumeIdentity>;
  peekCriteriaKey: (identity: ParsedTradeSearchIdentity) => string | undefined;
}

export interface BuildLiveSearchSnapshotResult {
  snapshot: Readonly<LiveSearchSourceSnapshot>;
  previousConnectionsSignature?: string;
  unresolvedCriteriaIdentities: ParsedTradeSearchIdentity[];
}

export function buildLiveSearchSourceSnapshot(
  input: BuildLiveSearchSnapshotInput,
): BuildLiveSearchSnapshotResult {
  const {
    loading,
    errorMessage,
    isLeagueResolved,
    isSwitchingLeague,
    selectedLeague,
    availableLeagues,
    primaryContext,
    hasSource,
    currentCollection,
    currentLiveSubscriptions,
    temporarySearches,
    sessionEntriesByKey,
    pendingSearchKeys,
    combinedResumeMap,
    peekCriteriaKey,
  } = input;

  const currentSelectedLeague = selectedLeague || 'Standard';

  if (
    (loading && temporarySearches.length === 0 && sessionEntriesByKey.size === 0) ||
    !isLeagueResolved
  ) {
    return {
      snapshot: {
        loading: true,
        groups: [],
        sessionConnections: [],
        previousConnections: [],
        selectedLeague: currentSelectedLeague,
        availableLeagues,
        isSwitchingLeague,
        leagueResolved: isLeagueResolved,
      },
      unresolvedCriteriaIdentities: [],
    };
  }

  if (
    errorMessage &&
    !currentCollection &&
    temporarySearches.length === 0 &&
    sessionEntriesByKey.size === 0
  ) {
    return {
      snapshot: {
        loading: false,
        error: errorMessage,
        groups: [],
        sessionConnections: [],
        previousConnections: [],
        selectedLeague: currentSelectedLeague,
        availableLeagues,
        isSwitchingLeague,
        leagueResolved: isLeagueResolved,
      },
      unresolvedCriteriaIdentities: [],
    };
  }

  // 建立 Canonical Search Identity -> LiveSearchSubscription 快速查表
  const activeIdentityMap = new Map<string, Readonly<LiveSearchSubscription>>();
  for (const sub of currentLiveSubscriptions) {
    if (sub.status === 'closed') continue;
    const key = getTradeSearchCanonicalKey({
      gameVersion: sub.gameVersion,
      league: sub.league,
      searchId: sub.searchId,
    });
    activeIdentityMap.set(key, sub);
  }

  const groups: LiveSearchSourceGroup[] = [];
  const bookmarkItemByCanonicalKey = new Map<string, LiveSearchSourceItem>();
  const bookmarkItemById = new Map<string, LiveSearchSourceItem>();

  if (currentCollection) {
    const folderMap = new Map<
      string,
      { id: string; name: string; order: number; parentId?: string }
    >();
    const groupMap = new Map<string, LiveSearchSourceItem[]>();

    currentCollection.groups.forEach((group, index) => {
      if (!folderMap.has(group.id)) {
        folderMap.set(group.id, {
          id: group.id,
          name: group.name,
          order: typeof group.order === 'number' ? group.order : index,
          parentId: group.parentId,
        });
        groupMap.set(group.id, []);
      }
    });

    const defaultGroupItems: LiveSearchSourceItem[] = [];
    const orderedBookmarks = [...currentCollection.bookmarks].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    for (const b of orderedBookmarks) {
      const cleanUrl = stripLiveSuffix(b.url);
      const parsed = parseTradeSearchUrl(cleanUrl);

      if (
        parsed &&
        parsed.gameVersion === primaryContext.gameVersion &&
        !sameLeague(parsed.league, currentSelectedLeague)
      ) {
        continue;
      }

      const searchKey = parsed ? getTradeSearchCanonicalKey(parsed) : null;
      const activeSub = searchKey ? activeIdentityMap.get(searchKey) : undefined;
      const isPending = searchKey ? pendingSearchKeys.has(searchKey) : false;
      const compat = evaluateLiveSearchSourceCompatibility(parsed, primaryContext, cleanUrl);
      const knownFolder = folderMap.get(b.groupId);
      const resolvedGroupId = knownFolder ? knownFolder.id : 'default_ungrouped';
      const resolvedGroupName = knownFolder ? knownFolder.name : t('liveSearch.uncategorized');
      const validCoverUrl = hasValidCover(b.coverImageUrl) ? b.coverImageUrl : undefined;

      const item: LiveSearchSourceItem = {
        kind: 'bookmark',
        id: b.id,
        name: b.name,
        url: b.url,
        canonicalIdentity: parsed ? { ...parsed } : null,
        canonicalKey: searchKey,
        compatibility: compat.compatibility,
        compatibilityMessage: compat.compatibilityMessage,
        groupId: resolvedGroupId,
        groupName: resolvedGroupName,
        status: activeSub?.status,
        pending: isPending,
        subscriptionId: activeSub?.id,
        errorMessage: activeSub?.errorMessage,
        reconnectInSeconds: activeSub?.reconnectInSeconds,
        removable: false,
        coverImageUrl: validCoverUrl,
      };

      bookmarkItemById.set(b.id, item);
      if (searchKey && !bookmarkItemByCanonicalKey.has(searchKey)) {
        bookmarkItemByCanonicalKey.set(searchKey, item);
      }

      const groupList = groupMap.get(b.groupId);
      if (groupList) {
        groupList.push(item);
      } else {
        defaultGroupItems.push(item);
      }
    }

    const folderTree = buildFolderTree(Array.from(folderMap.values()));

    function collectProjectedFolderGroups(
      nodes: FolderTreeNode<{ id: string; name: string; order: number; parentId?: string }>[],
    ): LiveSearchSourceGroup[] {
      const projected: LiveSearchSourceGroup[] = [];
      for (const node of nodes) {
        const directItems = groupMap.get(node.folder.id) ?? [];
        const childGroups = collectProjectedFolderGroups(node.children);
        if (directItems.length === 0 && childGroups.length === 0) {
          continue;
        }
        projected.push({
          id: node.folder.id,
          name: node.folder.name,
          kind: 'bookmark',
          parentId: node.depth === 0 ? undefined : node.folder.parentId,
          order: node.folder.order,
          depth: node.depth,
          items: directItems,
        });
        projected.push(...childGroups);
      }
      return projected;
    }

    groups.push(...collectProjectedFolderGroups(folderTree));

    if (defaultGroupItems.length > 0) {
      groups.push({
        id: 'default_ungrouped',
        name: t('liveSearch.uncategorized'),
        kind: 'bookmark',
        order: Number.MAX_SAFE_INTEGER,
        depth: 0,
        items: defaultGroupItems,
      });
    }
  }

  const filteredTemporarySearches = temporarySearches.filter((c) => {
    if (
      c.canonicalIdentity.gameVersion === primaryContext.gameVersion &&
      !sameLeague(c.canonicalIdentity.league, currentSelectedLeague)
    ) {
      return false;
    }
    return true;
  });

  const customItemByCanonicalKey = new Map<string, LiveSearchSourceItem>();

  if (filteredTemporarySearches.length > 0) {
    const customItems: LiveSearchSourceItem[] = filteredTemporarySearches.map((c) => {
      const activeSub = activeIdentityMap.get(c.canonicalKey);
      const isPending = pendingSearchKeys.has(c.canonicalKey);
      const compat = evaluateLiveSearchSourceCompatibility(c.canonicalIdentity, primaryContext);
      const item: LiveSearchSourceItem = {
        kind: 'custom',
        id: c.id,
        name: c.name,
        url: c.url,
        canonicalIdentity: { ...c.canonicalIdentity },
        canonicalKey: c.canonicalKey,
        compatibility: compat.compatibility,
        compatibilityMessage: compat.compatibilityMessage,
        groupId: TEMPORARY_SOURCE_GROUP_ID,
        groupName: TEMPORARY_SOURCE_GROUP_NAME,
        status: activeSub?.status,
        pending: isPending,
        subscriptionId: activeSub?.id,
        errorMessage: activeSub?.errorMessage,
        reconnectInSeconds: activeSub?.reconnectInSeconds,
        removable: true,
        provenance: c.provenance,
        provenanceMessage:
          c.provenance === 'origin-bookmark-removed'
            ? t('liveSearch.originBookmarkRemoved')
            : undefined,
      };
      customItemByCanonicalKey.set(c.canonicalKey, item);
      return item;
    });

    groups.push({
      id: TEMPORARY_SOURCE_GROUP_ID,
      name: TEMPORARY_SOURCE_GROUP_NAME,
      kind: 'custom',
      depth: 0,
      items: customItems,
    });
  }

  // 建構「本次連線」(sessionConnections)：僅包含本次工作階段加入或曾啟用的連線（含監聽中、連線中、異常、已暫停）
  const sessionConnections: LiveSearchSourceItem[] = [];

  for (const [canonicalKey, meta] of sessionEntriesByKey.entries()) {
    if (
      meta.canonicalIdentity.gameVersion === primaryContext.gameVersion &&
      !sameLeague(meta.canonicalIdentity.league, currentSelectedLeague)
    ) {
      continue;
    }

    const candidateById = meta.sourceBookmarkId
      ? bookmarkItemById.get(meta.sourceBookmarkId)
      : undefined;
    const bmkItem =
      (candidateById?.canonicalKey === canonicalKey ? candidateById : undefined) ??
      bookmarkItemByCanonicalKey.get(canonicalKey);
    const customItem = customItemByCanonicalKey.get(canonicalKey);
    const activeSub = activeIdentityMap.get(canonicalKey);
    const isPending = pendingSearchKeys.has(canonicalKey);
    const compat = evaluateLiveSearchSourceCompatibility(
      meta.canonicalIdentity,
      primaryContext,
      meta.url,
    );

    if (bmkItem) {
      sessionConnections.push({
        ...bmkItem,
        status: activeSub?.status ?? 'idle',
        pending: isPending,
        subscriptionId: activeSub?.id,
        errorMessage: activeSub?.errorMessage,
        reconnectInSeconds: activeSub?.reconnectInSeconds,
        removable: true,
      });
    } else if (customItem) {
      sessionConnections.push({
        ...customItem,
        status: activeSub?.status ?? 'idle',
        pending: isPending,
        subscriptionId: activeSub?.id,
        errorMessage: activeSub?.errorMessage,
        reconnectInSeconds: activeSub?.reconnectInSeconds,
        removable: true,
        coverImageUrl: hasValidCover(meta.coverImageUrl) ? meta.coverImageUrl : undefined,
      });
    } else {
      sessionConnections.push({
        kind: meta.sourceBookmarkId ? 'bookmark' : 'custom',
        id: meta.sourceBookmarkId || `${SESSION_SOURCE_ID_PREFIX}${canonicalKey}`,
        name:
          meta.name ||
          activeSub?.name ||
          t('liveSearch.defaultSearchNameWithId', { id: meta.canonicalIdentity.searchId }),
        url:
          meta.url ||
          activeSub?.url ||
          buildCanonicalTradeSearchUrl(
            meta.canonicalIdentity.gameVersion,
            currentSelectedLeague,
            meta.canonicalIdentity.searchId,
          ),
        canonicalIdentity: { ...meta.canonicalIdentity },
        canonicalKey,
        compatibility: compat.compatibility,
        compatibilityMessage: compat.compatibilityMessage,
        groupId: SESSION_CONNECTIONS_GROUP_ID,
        groupName: SESSION_CONNECTIONS_GROUP_NAME,
        status: activeSub?.status ?? 'idle',
        pending: isPending,
        subscriptionId: activeSub?.id,
        errorMessage: activeSub?.errorMessage,
        reconnectInSeconds: activeSub?.reconnectInSeconds,
        removable: true,
        coverImageUrl: hasValidCover(meta.coverImageUrl) ? meta.coverImageUrl : undefined,
      });
    }
  }

  // 建構「上次連線」(previousConnections)：來自 Resume Plan 且尚未進入「本次連線」的項目
  const previousConnections: LiveSearchSourceItem[] = [];

  for (const [canonicalKey, resumeId] of combinedResumeMap.entries()) {
    if (resumeId.gameVersion !== primaryContext.gameVersion) continue;
    if (!sameLeague(resumeId.league, currentSelectedLeague)) {
      continue;
    }
    if (sessionEntriesByKey.has(canonicalKey) || activeIdentityMap.has(canonicalKey)) {
      continue;
    }

    const bmkItem = bookmarkItemByCanonicalKey.get(canonicalKey);
    if (bmkItem) {
      previousConnections.push({
        ...bmkItem,
        groupId: PREVIOUS_CONNECTIONS_GROUP_ID,
        groupName: bmkItem.groupName,
        status: 'idle',
        removable: true,
      });
      continue;
    }

    // 若來源無書籤且亦無獨立保存之 name/url（例如舊版書籤已被刪除且 prune 進行中），略過不顯示孤兒 ID
    if (!resumeId.name && !resumeId.url && hasSource && currentCollection) {
      continue;
    }

    const parsedIdentity: ParsedTradeSearchIdentity = {
      gameVersion: resumeId.gameVersion,
      league: currentSelectedLeague,
      searchId: resumeId.searchId,
    };
    const resolvedUrl =
      resumeId.url ||
      buildCanonicalTradeSearchUrl(resumeId.gameVersion, currentSelectedLeague, resumeId.searchId);
    const compat = evaluateLiveSearchSourceCompatibility(
      parsedIdentity,
      primaryContext,
      resolvedUrl,
    );
    const validCover = hasValidCover(resumeId.coverImageUrl) ? resumeId.coverImageUrl : undefined;

    previousConnections.push({
      kind: 'custom',
      id: `${PREVIOUS_SOURCE_ID_PREFIX}${canonicalKey}`,
      name: resumeId.name || t('liveSearch.defaultSearchNameWithId', { id: resumeId.searchId }),
      url: resolvedUrl,
      canonicalIdentity: parsedIdentity,
      canonicalKey,
      compatibility: compat.compatibility,
      compatibilityMessage: compat.compatibilityMessage,
      groupId: PREVIOUS_CONNECTIONS_GROUP_ID,
      groupName: PREVIOUS_CONNECTIONS_GROUP_NAME,
      status: 'idle',
      pending: pendingSearchKeys.has(canonicalKey),
      removable: true,
      coverImageUrl: validCover,
    });
  }

  // 相同搜尋條件只顯示一筆（有圖片優先），且不與本次連線重複
  const dedupedPrevious = dedupePreviousConnectionItems(
    previousConnections,
    sessionConnections,
    peekCriteriaKey,
  );

  return {
    snapshot: {
      loading,
      ...(errorMessage ? { error: errorMessage } : {}),
      groups,
      sessionConnections,
      previousConnections: dedupedPrevious.items,
      selectedLeague: currentSelectedLeague,
      availableLeagues,
      isSwitchingLeague,
      leagueResolved: isLeagueResolved,
    },
    previousConnectionsSignature: dedupedPrevious.items.map((item) => item.id).join('|'),
    unresolvedCriteriaIdentities: dedupedPrevious.unresolved,
  };
}
