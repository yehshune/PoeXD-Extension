import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import type { BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import { buildFolderTree, type FolderTreeNode } from '@/utils/bookmark-collection';
import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradeSearchCanonicalKey,
  isLegacySearchId,
  isLegacyTradeSearchUrl,
  parseTradeSearchUrl,
  stripLiveSuffix,
  type ParsedTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import type {
  AddSubscriptionOutcome,
  LiveSearchEnqueueItem,
  LiveSearchEnqueueResponse,
  LiveSearchPrimaryController,
  LiveSearchRetryOutcome,
  LiveSearchSubscription,
  LiveSearchSubscriptionStatus,
} from '@/utils/live-search-contract';
import {
  getResumeCanonicalKey,
  type LiveSearchResumeIdentity,
  type LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';
import { fetchTradeLeagues, type TradeLeague } from '@/utils/trade-leagues';
import { readBookmarkTargetContext, resolveBookmarkUrl } from '@/utils/bookmark-target';
import { DEFAULT_TRADE_ORIGIN, getSupportedTradeOrigin } from '@/utils/trade-realms';
import type { PreferencesModule } from '@/utils/preferences';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import {
  createTradeSearchCriteriaKeyResolver,
  type TradeSearchCriteriaKeyResolver,
} from '@/utils/trade-search-criteria-key';
import {
  createConnectionDedup,
  dedupePreviousConnectionItems,
  hasValidCover,
  shouldAdoptExisting,
  type DedupEntry,
} from './live-search-connection-dedup';

export interface LiveSearchSourceControllerOptions {
  resumeStore?: LiveSearchResumeStore | null;
  preferences?: PreferencesModule | null;
  fetchLeagues?: (version: PoeVersion) => Promise<TradeLeague[]>;
  initialLeague?: string;
  /** 搜尋條件鍵解析器（相同搜尋條件去重用），預設以解碼 search ID 取得 */
  criteriaKeyResolver?: TradeSearchCriteriaKeyResolver;
}

/**
 * 最小唯讀 Bookmark Port 介面
 * 避免依賴肥大的 BookmarkModel，由 createChromeBookmarkClient 結構性滿足
 */
export interface LiveSearchBookmarkSourcePort {
  readCollection(): Promise<BookmarkReadOutcome<BookmarkCollectionView>>;
  subscribe(listener: () => void): () => void;
}

export type LiveSearchSourceKind = 'bookmark' | 'custom';

export type LiveSearchSourceStatusFilter = 'all' | 'enabled' | 'disabled' | 'error';

export type LiveSearchSourceCompatibility =
  | 'compatible'
  | 'invalid-url'
  | 'wrong-version'
  | 'wrong-league';

export type LiveSearchBatchRejectReason = 'disposed' | 'not-ready' | 'mixed-league';

export interface LiveSearchBatchSkipCounts {
  alreadyActive: number;
  pending: number;
  incompatible: number;
  duplicateInBatch: number;
  notFound: number;
  inactive: number;
}

export interface LiveSearchBatchIncompatibleBreakdown {
  invalidUrl: number;
  wrongVersion: number;
  wrongLeague: number;
}

export interface LiveSearchBatchOutcome {
  success: boolean;
  requested: number;
  succeeded: number;
  skipped: number;
  failed: number;
  rejectReason?: LiveSearchBatchRejectReason;
  involvedLeagues?: string[];
  error?: string;
  skipReasons: LiveSearchBatchSkipCounts;
  incompatibleBreakdown: LiveSearchBatchIncompatibleBreakdown;
  runtimeFailureCount: number;
}

export const TEMPORARY_SOURCE_GROUP_ID = 'custom_sources';
export const TEMPORARY_SOURCE_GROUP_NAME = '暫時搜尋';
export const CUSTOM_SOURCE_GROUP_ID = TEMPORARY_SOURCE_GROUP_ID;
export const CUSTOM_SOURCE_GROUP_NAME = TEMPORARY_SOURCE_GROUP_NAME;
export const SESSION_CONNECTIONS_GROUP_ID = 'session_connections';
export const SESSION_CONNECTIONS_GROUP_NAME = '本次連線';
export const PREVIOUS_CONNECTIONS_GROUP_ID = 'previous_connections';
export const PREVIOUS_CONNECTIONS_GROUP_NAME = '上次連線';

export type LiveSearchSourceProvenance = 'origin-bookmark-removed';

export interface LiveSearchSourceItem {
  kind: LiveSearchSourceKind;
  id: string;
  name: string;
  url: string;
  canonicalIdentity: ParsedTradeSearchIdentity | null;
  canonicalKey: string | null;
  compatibility: LiveSearchSourceCompatibility;
  compatibilityMessage?: string;
  groupId: string;
  groupName: string;
  status?: LiveSearchSubscriptionStatus;
  /** 相容既有存取欄位名稱 */
  liveSearchStatus?: LiveSearchSubscriptionStatus;
  pending: boolean;
  subscriptionId?: string;
  errorMessage?: string;
  reconnectInSeconds?: number;
  removable: boolean;
  provenance?: LiveSearchSourceProvenance;
  provenanceMessage?: string;
  coverImageUrl?: string;
}

export interface LiveSearchSourceGroup {
  id: string;
  name: string;
  kind: LiveSearchSourceKind;
  parentId?: string;
  order?: number;
  depth?: number;
  items: LiveSearchSourceItem[];
  /** 相容既有存取欄位名稱 */
  bookmarks: LiveSearchSourceItem[];
}

export interface LiveSearchSourceSnapshot {
  loading: boolean;
  error?: string;
  groups: LiveSearchSourceGroup[];
  sessionConnections?: LiveSearchSourceItem[];
  previousConnections?: LiveSearchSourceItem[];
  selectedLeague: string;
  availableLeagues: readonly string[];
  isSwitchingLeague: boolean;
  leagueResolved: boolean;
}

export interface LiveSearchSourceController {
  read(): Readonly<LiveSearchSourceSnapshot>;
  subscribe(listener: (snapshot: Readonly<LiveSearchSourceSnapshot>) => void): () => void;
  /**
   * 啟用指定搜尋來源 (Bookmark、本次連線、上次連線或 Custom Source)
   */
  enable(sourceId: string): Promise<AddSubscriptionOutcome>;
  /**
   * enable(sourceId) 之相容別名
   */
  add(sourceId: string): Promise<AddSubscriptionOutcome>;
  /**
   * 批次啟用多筆搜尋來源（含相容性 preflight、canonical dedup 與未鎖聯盟 mixed-league 原子拒絕）
   */
  enableMany(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome>;
  /**
   * 批次停止多筆搜尋來源之 Runtime 連線（保留於本次連線為已暫停，並維持已鎖定聯盟）
   */
  stopMany(sourceIds: readonly string[]): LiveSearchBatchOutcome;
  /**
   * 建立自訂 URL 搜尋來源並立即加入本次連線與啟用
   */
  addCustom(
    url: string,
    options?: { name?: string; coverImageUrl?: string },
  ): Promise<AddSubscriptionOutcome>;
  /**
   * 接收由一般頁面背景派送的搜尋連線清單，加入本次連線並啟動監聽
   */
  enqueueIncomingConnections?(
    items: readonly LiveSearchEnqueueItem[],
  ): Promise<LiveSearchEnqueueResponse>;
  /**
   * 停止指定來源或訂閱之 Runtime 連線（保留於本次連線中顯示為已暫停）
   */
  stop(sourceOrSubscriptionId: string): void;
  /**
   * 重試處於 error 狀態的來源連線
   */
  retry(sourceOrSubscriptionId: string): LiveSearchRetryOutcome;
  /**
   * 移除自訂 URL 來源；若移除時仍 active，先安全停止其 Runtime subscription 再移除來源
   */
  removeCustom(sourceId: string): boolean;
  /**
   * 從「本次連線」移除項目；若仍在監聽中則先安全停止 WebSocket
   */
  removeSessionConnection?(sourceOrSubscriptionId: string): boolean;
  /**
   * 從「上次連線」移除單筆紀錄
   */
  removePreviousConnection?(sourceIdOrCanonicalKey: string): Promise<boolean>;
  /**
   * 一鍵恢復目前聯盟所有「上次連線」至「本次連線」
   */
  restoreAllPreviousConnections?(): Promise<LiveSearchBatchOutcome>;
  /**
   * 清空「上次連線」紀錄
   */
  clearPreviousConnections?(): Promise<boolean>;
  /**
   * 系統性切換工作區聯盟（teardown 目前連線、解鎖 runtimeLeague、保留 Resume Intent 並切換 context）
   */
  switchLeague(targetLeague: string): Promise<boolean>;
  getSelectedLeague(): string;
  getAvailableLeagues(): readonly string[];
  readonly resumeStore?: LiveSearchResumeStore | null;
  dispose(): void;
}

export type LiveSearchBookmarkItem = LiveSearchSourceItem;
export type LiveSearchBookmarkGroup = LiveSearchSourceGroup;
export type LiveSearchBookmarkSnapshot = LiveSearchSourceSnapshot;
export type LiveSearchBookmarkController = LiveSearchSourceController;

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
  primaryContext: {
    gameVersion: PoeVersion;
    runtimeLeague: string | null;
  },
  /** 來源網址（已去除 /live）；提供時只對 `/search/` 路由判定舊式短碼，避免誤判通貨兌換。 */
  sourceUrl?: string,
): {
  compatibility: LiveSearchSourceCompatibility;
  compatibilityMessage?: string;
} {
  if (!parsed) {
    return {
      compatibility: 'invalid-url',
      compatibilityMessage: '此書籤的網址無法解析為合法的 Trade 搜尋',
    };
  }

  const isLegacy =
    sourceUrl === undefined ? isLegacySearchId(parsed.searchId) : isLegacyTradeSearchUrl(sourceUrl);
  if (isLegacy) {
    return {
      compatibility: 'invalid-url',
      compatibilityMessage: '此書籤使用官方已停用的舊式搜尋短碼，請重新搜尋後再加入書籤',
    };
  }

  if (parsed.gameVersion !== primaryContext.gameVersion) {
    return {
      compatibility: 'wrong-version',
      compatibilityMessage: `此搜尋屬於 ${formatLiveSearchDisplayVersion(parsed.gameVersion)}，目前主控台為 ${formatLiveSearchDisplayVersion(primaryContext.gameVersion)}`,
    };
  }

  const lockedLeague = primaryContext.runtimeLeague?.trim();
  if (lockedLeague && parsed.league.trim().toLowerCase() !== lockedLeague.toLowerCase()) {
    return {
      compatibility: 'wrong-league',
      compatibilityMessage: `主控台已鎖定 ${formatLiveSearchDisplayLeague(lockedLeague)}，此搜尋屬於 ${formatLiveSearchDisplayLeague(parsed.league)}`,
    };
  }

  return {
    compatibility: 'compatible',
  };
}

export interface LiveSearchSourceFilterOptions {
  query?: string;
  statusFilter?: LiveSearchSourceStatusFilter;
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

interface CustomSourceRecord {
  id: string;
  name: string;
  url: string;
  canonicalIdentity: ParsedTradeSearchIdentity;
  canonicalKey: string;
  createdAt: number;
  provenance?: LiveSearchSourceProvenance;
  coverImageUrl?: string;
}

interface SessionConnectionMeta {
  canonicalKey: string;
  canonicalIdentity: ParsedTradeSearchIdentity;
  name: string;
  url: string;
  coverImageUrl?: string;
  sourceBookmarkId?: string;
}

/**
 * Unified LiveSearch Source / Connection Integration Controller
 */
export function createLiveSearchSourceController(
  source: LiveSearchBookmarkSourcePort | null | undefined,
  liveController: LiveSearchPrimaryController,
  options?: LiveSearchSourceControllerOptions,
): LiveSearchSourceController {
  const resumeStore = options?.resumeStore ?? null;
  const preferences = options?.preferences ?? null;
  const listeners = new Set<(snapshot: Readonly<LiveSearchSourceSnapshot>) => void>();
  const pendingSearchKeys = new Set<string>();
  const customSources: CustomSourceRecord[] = [];
  const sessionEntriesByKey = new Map<string, SessionConnectionMeta>();
  const baselineResumeByKey = new Map<string, LiveSearchResumeIdentity>();
  let latestResumeIdentities: LiveSearchResumeIdentity[] = [];

  let currentCollection: BookmarkCollectionView | null = source
    ? null
    : { groups: [], bookmarks: [] };
  const initialLiveSnapshot = liveController.read?.();
  let currentGameVersion: PoeVersion = initialLiveSnapshot?.gameVersion ?? 'poe1';
  let currentRuntimeLeague: string | null = initialLiveSnapshot?.runtimeLeague ?? null;
  let currentLiveSubscriptions: Readonly<LiveSearchSubscription>[] =
    initialLiveSnapshot?.subscriptions ?? [];
  let loading = Boolean(source);
  let errorMessage: string | undefined;
  let disposed = false;
  let isReloading = false;
  let hasPendingReload = false;
  let activeGeneration = 0;
  let reloadDrainPromise: Promise<void> | null = null;

  let unsubSource: (() => void) | null = null;
  let unsubLive: (() => void) | null = null;
  let unsubPreferences: (() => void) | null = null;
  let unsubResumeStore: (() => void) | null = null;

  let selectedLeague: string =
    options?.initialLeague?.trim() || preferences?.read().liveSearchSelectedLeague?.trim() || '';
  let hasExplicitLeague = Boolean(selectedLeague);

  let rawCollection: BookmarkCollectionView | null = currentCollection;

  const connectionDedup = createConnectionDedup({
    resolver: options?.criteriaKeyResolver ?? createTradeSearchCriteriaKeyResolver(),
    listSessionEntries: listSessionDedupEntries,
    listPreviousEntries: listPreviousDedupEntries,
  });

  let criteriaResolutionPending = false;
  let lastPreviousConnectionsSignature = '';

  function syncResolvedCollection(): void {
    if (!rawCollection) {
      currentCollection = rawCollection;
      return;
    }
    const context = { ...readBookmarkTargetContext(), league: selectedLeague || undefined };
    currentCollection = {
      groups: rawCollection.groups,
      bookmarks: rawCollection.bookmarks.map((bookmark) => ({
        ...bookmark,
        url: resolveBookmarkUrl(bookmark.url, { leaguePinned: bookmark.leaguePinned }, context),
      })),
    };
  }

  function setSelectedLeague(league: string): void {
    selectedLeague = league;
    syncResolvedCollection();
  }

  let isLeagueResolved = hasExplicitLeague;
  let isFetchingOfficialLeagues = false;
  let officialLeagues: string[] = [];
  let officialLeaguesPromise: Promise<void> | null = null;
  let initialResolutionPromise: Promise<void> | null = null;
  let isSwitchingLeague = false;
  let transitionGeneration = 0;
  let currentSwitchId = 0;
  let switchChain: Promise<boolean> = Promise.resolve(true);
  let pendingTargetLeague: string | null = null;

  function registerSessionEntry(meta: SessionConnectionMeta): void {
    const existing = sessionEntriesByKey.get(meta.canonicalKey);
    sessionEntriesByKey.set(meta.canonicalKey, {
      canonicalKey: meta.canonicalKey,
      canonicalIdentity: { ...meta.canonicalIdentity },
      name: meta.name || existing?.name || '搜尋',
      url: meta.url || existing?.url || '',
      coverImageUrl: meta.coverImageUrl ?? existing?.coverImageUrl,
      sourceBookmarkId: meta.sourceBookmarkId ?? existing?.sourceBookmarkId,
    });
  }

  function syncActiveSubscriptionsIntoSessionEntries(): void {
    for (const sub of currentLiveSubscriptions) {
      if (sub.status === 'closed') continue;
      const canonicalIdentity: ParsedTradeSearchIdentity = {
        gameVersion: sub.gameVersion,
        league: sub.league,
        searchId: sub.searchId,
      };
      const canonicalKey = getTradeSearchCanonicalKey(canonicalIdentity);
      const matchingBookmark = currentCollection?.bookmarks.find((b) => {
        const parsed = parseTradeSearchUrl(stripLiveSuffix(b.url));
        return parsed && getTradeSearchCanonicalKey(parsed) === canonicalKey;
      });
      const validCover =
        matchingBookmark?.coverImageUrl && isValidPoeCdnImageUrl(matchingBookmark.coverImageUrl)
          ? matchingBookmark.coverImageUrl
          : undefined;
      registerSessionEntry({
        canonicalKey,
        canonicalIdentity,
        name: matchingBookmark?.name || sub.name || '搜尋',
        url: matchingBookmark?.url || sub.url,
        coverImageUrl: validCover,
        sourceBookmarkId: matchingBookmark?.id ?? sub.sourceBookmarkId,
      });
    }
  }

  syncActiveSubscriptionsIntoSessionEntries();

  if (resumeStore) {
    unsubResumeStore = resumeStore.subscribe((plan) => {
      latestResumeIdentities = [...plan.identities];
      const currentPlanKeys = new Set(plan.identities.map((id) => getResumeCanonicalKey(id)));
      for (const existingKey of Array.from(baselineResumeByKey.keys())) {
        if (!currentPlanKeys.has(existingKey)) {
          baselineResumeByKey.delete(existingKey);
        }
      }
      for (const id of plan.identities) {
        const key = getResumeCanonicalKey(id);
        if (!sessionEntriesByKey.has(key) && !baselineResumeByKey.has(key)) {
          baselineResumeByKey.set(key, { ...id });
        } else if (baselineResumeByKey.has(key)) {
          const prev = baselineResumeByKey.get(key)!;
          baselineResumeByKey.set(key, {
            ...prev,
            ...(id.name ? { name: id.name } : {}),
            ...(id.url ? { url: id.url } : {}),
            ...(id.coverImageUrl ? { coverImageUrl: id.coverImageUrl } : {}),
          });
        }
      }
      if (!disposed) {
        notify();
      }
    });
    void resumeStore.read().then((res) => {
      if (res.ok && !disposed) {
        latestResumeIdentities = [...res.value.identities];
        for (const id of res.value.identities) {
          const key = getResumeCanonicalKey(id);
          if (!baselineResumeByKey.has(key)) {
            baselineResumeByKey.set(key, { ...id });
          }
        }
        notify();
      }
    });
  }

  function getAvailableLeagues(): readonly string[] {
    const set = new Set<string>();
    const result: string[] = [];

    function addLeague(l: string | null | undefined) {
      if (!l) return;
      const trimmed = l.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (!set.has(lower)) {
        set.add(lower);
        result.push(trimmed);
      }
    }

    for (const ol of officialLeagues) {
      addLeague(ol);
    }

    if (currentCollection) {
      for (const b of currentCollection.bookmarks) {
        const cleanUrl = stripLiveSuffix(b.url);
        const parsed = parseTradeSearchUrl(cleanUrl);
        if (parsed && parsed.gameVersion === currentGameVersion) {
          addLeague(parsed.league);
        }
      }
    }

    for (const c of customSources) {
      if (c.canonicalIdentity.gameVersion === currentGameVersion) {
        addLeague(c.canonicalIdentity.league);
      }
    }

    for (const r of latestResumeIdentities) {
      if (r.gameVersion === currentGameVersion) {
        addLeague(r.league);
      }
    }

    if (selectedLeague) {
      addLeague(selectedLeague);
    }
    addLeague('Standard');

    return Object.freeze(result);
  }

  async function resolveInitialLeague(): Promise<void> {
    if (isLeagueResolved) return;

    // 1. persisted recent selected league
    const prefLeague = preferences?.read().liveSearchSelectedLeague?.trim();
    if (prefLeague) {
      setSelectedLeague(prefLeague);
      hasExplicitLeague = true;
      isLeagueResolved = true;
      return;
    }

    // 2. Resume Store league
    if (resumeStore) {
      try {
        const res = await resumeStore.read();
        if (res.ok && res.value.identities.length > 0) {
          const match = res.value.identities.find((id) => id.gameVersion === currentGameVersion);
          if (match && match.league.trim()) {
            setSelectedLeague(match.league.trim());
            hasExplicitLeague = true;
            isLeagueResolved = true;
            return;
          }
        }
      } catch {}
    }

    // 3. authoritative Bookmark league (由 currentCollection 提供)
    if (currentCollection && currentCollection.bookmarks.length > 0) {
      for (const b of currentCollection.bookmarks) {
        const cleanUrl = stripLiveSuffix(b.url);
        const parsed = parseTradeSearchUrl(cleanUrl);
        if (parsed && parsed.gameVersion === currentGameVersion && parsed.league.trim()) {
          setSelectedLeague(parsed.league.trim());
          hasExplicitLeague = true;
          isLeagueResolved = true;
          return;
        }
      }
    }

    // 4. official league
    if (officialLeagues.length > 0 && officialLeagues[0].trim()) {
      setSelectedLeague(officialLeagues[0].trim());
      hasExplicitLeague = true;
      isLeagueResolved = true;
      return;
    }

    if (source && loading) {
      return;
    }

    if (isFetchingOfficialLeagues) {
      return;
    }

    // 5. 最終 fallback Standard
    setSelectedLeague('Standard');
    isLeagueResolved = true;
  }

  if (!isLeagueResolved) {
    initialResolutionPromise = resolveInitialLeague().then(() => {
      if (!disposed && isLeagueResolved) notify();
    });
  }

  isFetchingOfficialLeagues = true;
  officialLeaguesPromise = (async () => {
    try {
      if (options?.fetchLeagues) {
        const list = await options.fetchLeagues(currentGameVersion);
        if (!disposed && Array.isArray(list)) {
          officialLeagues = list.map((l) => l.id).filter(Boolean);
        }
      } else if (
        typeof window !== 'undefined' &&
        window.location &&
        window.location.protocol.startsWith('http') &&
        !window.location.host.includes('localhost')
      ) {
        const list = await fetchTradeLeagues(currentGameVersion);
        if (!disposed && Array.isArray(list)) {
          officialLeagues = list.map((l) => l.id).filter(Boolean);
        }
      }
    } catch {
    } finally {
      isFetchingOfficialLeagues = false;
      if (!isLeagueResolved && !disposed) {
        await resolveInitialLeague();
      }
      if (!disposed) {
        notify();
      }
    }
  })();

  async function ensureStartupResolved(): Promise<void> {
    if (isLeagueResolved) return;
    if (initialResolutionPromise) {
      await initialResolutionPromise;
    }
    if (source && (isReloading || hasPendingReload || loading)) {
      await waitForReconciliationDrain();
    }
    if (officialLeaguesPromise) {
      await officialLeaguesPromise;
    }
    if (!isLeagueResolved) {
      await resolveInitialLeague();
      if (!isLeagueResolved) {
        setSelectedLeague('Standard');
        isLeagueResolved = true;
      }
    }
  }

  async function switchLeague(targetLeague: string): Promise<boolean> {
    if (disposed) return false;
    const trimmed = targetLeague.trim();
    if (!trimmed) return false;

    if (!isSwitchingLeague && trimmed.toLowerCase() === selectedLeague.toLowerCase()) {
      return true;
    }
    if (
      isSwitchingLeague &&
      pendingTargetLeague &&
      trimmed.toLowerCase() === pendingTargetLeague.toLowerCase()
    ) {
      return switchChain;
    }

    pendingTargetLeague = trimmed;
    const switchId = ++currentSwitchId;
    transitionGeneration++;
    isSwitchingLeague = true;
    notify();

    const runSwitch = async (): Promise<boolean> => {
      try {
        if (switchId !== currentSwitchId || disposed) {
          return false;
        }
        await liveController.teardownAll();
        if (switchId !== currentSwitchId || disposed) {
          return false;
        }
        await liveController.teardownAll({ targetLeague: trimmed });
        setSelectedLeague(trimmed);
        hasExplicitLeague = true;
        isLeagueResolved = true;
        if (preferences) {
          try {
            await preferences.update({ liveSearchSelectedLeague: trimmed });
          } catch {}
        }
        if (switchId !== currentSwitchId || disposed) {
          return false;
        }
        return true;
      } catch (err) {
        if (switchId === currentSwitchId) {
          console.error('[PoeXD LiveSearch] Failed to switch league:', err);
        }
        return false;
      } finally {
        if (switchId === currentSwitchId) {
          isSwitchingLeague = false;
          pendingTargetLeague = null;
          try {
            await liveController.teardownAll();
          } catch {}
          notify();
        }
      }
    };

    const nextChain = switchChain.then(runSwitch, runSwitch);
    switchChain = nextChain.catch(() => false);
    return nextChain;
  }

  function getPrimaryContext(): {
    gameVersion: PoeVersion;
    runtimeLeague: string | null;
  } {
    const latest = liveController.read?.();
    return {
      gameVersion: latest?.gameVersion ?? currentGameVersion,
      runtimeLeague:
        latest && 'runtimeLeague' in latest ? latest.runtimeLeague : currentRuntimeLeague,
    };
  }

  function findActiveSubByCanonicalKey(
    canonicalKey: string,
  ): Readonly<LiveSearchSubscription> | undefined {
    for (const sub of currentLiveSubscriptions) {
      if (sub.status === 'closed') continue;
      const key = getTradeSearchCanonicalKey({
        gameVersion: sub.gameVersion,
        league: sub.league,
        searchId: sub.searchId,
      });
      if (key === canonicalKey) {
        return sub;
      }
    }
    return undefined;
  }

  function buildCombinedResumeMap(): Map<string, LiveSearchResumeIdentity> {
    const combined = new Map<string, LiveSearchResumeIdentity>();
    for (const [k, v] of baselineResumeByKey.entries()) {
      combined.set(k, v);
    }
    for (const id of latestResumeIdentities) {
      const k = getResumeCanonicalKey(id);
      const existing = combined.get(k);
      combined.set(k, {
        ...existing,
        ...id,
        name: id.name ?? existing?.name,
        url: id.url ?? existing?.url,
        coverImageUrl: id.coverImageUrl ?? existing?.coverImageUrl,
      });
    }
    return combined;
  }

  function findBookmarkByCanonicalKey(canonicalKey: string) {
    return currentCollection?.bookmarks.find((b) => {
      const parsed = parseTradeSearchUrl(stripLiveSuffix(b.url));
      return parsed && getTradeSearchCanonicalKey(parsed) === canonicalKey;
    });
  }

  function listSessionDedupEntries(): DedupEntry[] {
    const entries: DedupEntry[] = [];
    for (const [key, meta] of sessionEntriesByKey.entries()) {
      entries.push({
        key,
        identity: meta.canonicalIdentity,
        name: meta.name,
        url: meta.url,
        coverImageUrl: meta.coverImageUrl,
        sourceBookmarkId: meta.sourceBookmarkId,
      });
    }
    for (const sub of currentLiveSubscriptions) {
      if (sub.status === 'closed') continue;
      const identity = { gameVersion: sub.gameVersion, league: sub.league, searchId: sub.searchId };
      const key = getTradeSearchCanonicalKey(identity);
      if (sessionEntriesByKey.has(key)) continue;
      entries.push({
        key,
        identity,
        name: sub.name,
        url: sub.url,
        sourceBookmarkId: sub.sourceBookmarkId,
      });
    }
    return entries;
  }

  function listPreviousDedupEntries(): DedupEntry[] {
    const entries: DedupEntry[] = [];
    for (const [key, resumeId] of buildCombinedResumeMap().entries()) {
      if (resumeId.gameVersion !== currentGameVersion) continue;
      if (sessionEntriesByKey.has(key) || findActiveSubByCanonicalKey(key)) continue;
      const bookmark = findBookmarkByCanonicalKey(key);
      entries.push({
        key,
        identity: {
          gameVersion: resumeId.gameVersion,
          league: resumeId.league,
          searchId: resumeId.searchId,
        },
        name: bookmark?.name ?? resumeId.name,
        url: bookmark?.url ?? resumeId.url,
        coverImageUrl: hasValidCover(bookmark?.coverImageUrl)
          ? bookmark?.coverImageUrl
          : resumeId.coverImageUrl,
        sourceBookmarkId: bookmark?.id,
      });
    }
    return entries;
  }

  function scheduleCriteriaResolution(identities: readonly ParsedTradeSearchIdentity[]): void {
    if (criteriaResolutionPending || disposed) return;
    criteriaResolutionPending = true;
    void connectionDedup.resolveMany(identities).finally(() => {
      criteriaResolutionPending = false;
      if (disposed) return;
      // 只有解析結果真的改變「上次連線」顯示時才重新發布，避免多餘的快照
      const before = lastPreviousConnectionsSignature;
      buildSnapshot();
      if (lastPreviousConnectionsSignature !== before) notify();
    });
  }

  function sourceIdForDedupEntry(entry: DedupEntry, section: 'session' | 'previous'): string {
    if (
      entry.sourceBookmarkId &&
      currentCollection?.bookmarks.some((b) => b.id === entry.sourceBookmarkId)
    ) {
      return entry.sourceBookmarkId;
    }
    const custom = customSources.find((c) => c.canonicalKey === entry.key);
    if (custom) return custom.id;
    return section === 'session' ? `session_${entry.key}` : `prev_${entry.key}`;
  }

  async function forgetPreviousConnection(canonicalKey: string): Promise<void> {
    baselineResumeByKey.delete(canonicalKey);
    const wasPersisted = latestResumeIdentities.some(
      (id) => getResumeCanonicalKey(id) === canonicalKey,
    );
    latestResumeIdentities = latestResumeIdentities.filter(
      (id) => getResumeCanonicalKey(id) !== canonicalKey,
    );
    if (resumeStore && wasPersisted) {
      await resumeStore.removeIdentities([canonicalKey]);
    }
  }

  type CriteriaRedirect =
    | { kind: 'error'; error: string }
    | { kind: 'source'; sourceId: string }
    | { kind: 'adopt-meta'; entry: DedupEntry };

  /**
   * 依「相同搜尋條件只能有一筆」規則決定新加入連線的去向：
   * - 本次連線已有相同條件：沿用既有項目（補上缺少的封面）；監聽中則回報錯誤。
   * - 上次連線已有相同條件：有圖片的一方優先（同 search ID 時只沿用其顯示資料）；否則移除舊紀錄。
   */
  async function resolveCriteriaRedirect(
    identity: ParsedTradeSearchIdentity,
    canonicalKey: string,
    incomingCover: string | undefined,
  ): Promise<CriteriaRedirect | null> {
    const match = await connectionDedup.findEquivalent(identity, canonicalKey);
    if (!match) return null;
    if (match.section === 'session') {
      if (match.sameKey) return null;
      const meta = sessionEntriesByKey.get(match.entry.key);
      if (meta && !hasValidCover(meta.coverImageUrl) && hasValidCover(incomingCover)) {
        meta.coverImageUrl = incomingCover;
      }
      if (findActiveSubByCanonicalKey(match.entry.key)) {
        notify();
        return { kind: 'error', error: '相同搜尋條件已在即時監聽中' };
      }
      return { kind: 'source', sourceId: sourceIdForDedupEntry(match.entry, 'session') };
    }
    if (shouldAdoptExisting(incomingCover, match.entry.coverImageUrl)) {
      return match.sameKey
        ? { kind: 'adopt-meta', entry: match.entry }
        : { kind: 'source', sourceId: sourceIdForDedupEntry(match.entry, 'previous') };
    }
    if (!match.sameKey) {
      await forgetPreviousConnection(match.entry.key);
    }
    return null;
  }

  function buildSnapshot(): Readonly<LiveSearchSourceSnapshot> {
    const currentSelectedLeague = selectedLeague || 'Standard';
    const available = getAvailableLeagues();

    if (
      (loading && customSources.length === 0 && sessionEntriesByKey.size === 0) ||
      !isLeagueResolved
    ) {
      return {
        loading: true,
        groups: [],
        sessionConnections: [],
        previousConnections: [],
        selectedLeague: currentSelectedLeague,
        availableLeagues: available,
        isSwitchingLeague,
        leagueResolved: isLeagueResolved,
      };
    }

    if (
      errorMessage &&
      !currentCollection &&
      customSources.length === 0 &&
      sessionEntriesByKey.size === 0
    ) {
      return {
        loading: false,
        error: errorMessage,
        groups: [],
        sessionConnections: [],
        previousConnections: [],
        selectedLeague: currentSelectedLeague,
        availableLeagues: available,
        isSwitchingLeague,
        leagueResolved: isLeagueResolved,
      };
    }

    const primaryContext = getPrimaryContext();

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
          parsed.league.trim().toLowerCase() !== currentSelectedLeague.trim().toLowerCase()
        ) {
          continue;
        }

        const searchKey = parsed ? getTradeSearchCanonicalKey(parsed) : null;
        const activeSub = searchKey ? activeIdentityMap.get(searchKey) : undefined;
        const isPending = searchKey ? pendingSearchKeys.has(searchKey) : false;
        const compat = evaluateLiveSearchSourceCompatibility(parsed, primaryContext, cleanUrl);
        const knownFolder = folderMap.get(b.groupId);
        const resolvedGroupId = knownFolder ? knownFolder.id : 'default_ungrouped';
        const resolvedGroupName = knownFolder ? knownFolder.name : '未分類';
        const validCoverUrl =
          b.coverImageUrl && isValidPoeCdnImageUrl(b.coverImageUrl) ? b.coverImageUrl : undefined;

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
          liveSearchStatus: activeSub?.status,
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
            bookmarks: directItems,
          });
          projected.push(...childGroups);
        }
        return projected;
      }

      groups.push(...collectProjectedFolderGroups(folderTree));

      if (defaultGroupItems.length > 0) {
        groups.push({
          id: 'default_ungrouped',
          name: '未分類',
          kind: 'bookmark',
          order: Number.MAX_SAFE_INTEGER,
          depth: 0,
          items: defaultGroupItems,
          bookmarks: defaultGroupItems,
        });
      }
    }

    const filteredCustomSources = customSources.filter((c) => {
      if (
        c.canonicalIdentity.gameVersion === primaryContext.gameVersion &&
        c.canonicalIdentity.league.trim().toLowerCase() !==
          currentSelectedLeague.trim().toLowerCase()
      ) {
        return false;
      }
      return true;
    });

    const customItemByCanonicalKey = new Map<string, LiveSearchSourceItem>();

    if (filteredCustomSources.length > 0) {
      const customItems: LiveSearchSourceItem[] = filteredCustomSources.map((c) => {
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
          groupId: CUSTOM_SOURCE_GROUP_ID,
          groupName: CUSTOM_SOURCE_GROUP_NAME,
          status: activeSub?.status,
          liveSearchStatus: activeSub?.status,
          pending: isPending,
          subscriptionId: activeSub?.id,
          errorMessage: activeSub?.errorMessage,
          reconnectInSeconds: activeSub?.reconnectInSeconds,
          removable: true,
          provenance: c.provenance,
          provenanceMessage:
            c.provenance === 'origin-bookmark-removed' ? '來源書籤已移除' : undefined,
        };
        customItemByCanonicalKey.set(c.canonicalKey, item);
        return item;
      });

      groups.push({
        id: CUSTOM_SOURCE_GROUP_ID,
        name: CUSTOM_SOURCE_GROUP_NAME,
        kind: 'custom',
        depth: 0,
        items: customItems,
        bookmarks: customItems,
      });
    }

    // 建構「本次連線」(sessionConnections)：僅包含本次工作階段加入或曾啟用的連線（含監聽中、連線中、異常、已暫停）
    const sessionConnections: LiveSearchSourceItem[] = [];
    const sessionKeysInSelectedLeague = new Set<string>();

    for (const [canonicalKey, meta] of sessionEntriesByKey.entries()) {
      if (
        meta.canonicalIdentity.gameVersion === primaryContext.gameVersion &&
        meta.canonicalIdentity.league.trim().toLowerCase() !==
          currentSelectedLeague.trim().toLowerCase()
      ) {
        continue;
      }
      sessionKeysInSelectedLeague.add(canonicalKey);

      const bmkItem =
        (meta.sourceBookmarkId ? bookmarkItemById.get(meta.sourceBookmarkId) : undefined) ??
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
          liveSearchStatus: activeSub?.status ?? 'idle',
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
          liveSearchStatus: activeSub?.status ?? 'idle',
          pending: isPending,
          subscriptionId: activeSub?.id,
          errorMessage: activeSub?.errorMessage,
          reconnectInSeconds: activeSub?.reconnectInSeconds,
          removable: true,
          coverImageUrl:
            meta.coverImageUrl && isValidPoeCdnImageUrl(meta.coverImageUrl)
              ? meta.coverImageUrl
              : undefined,
        });
      } else {
        sessionConnections.push({
          kind: meta.sourceBookmarkId ? 'bookmark' : 'custom',
          id: meta.sourceBookmarkId || `session_${canonicalKey}`,
          name: meta.name || activeSub?.name || `搜尋 (${meta.canonicalIdentity.searchId})`,
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
          liveSearchStatus: activeSub?.status ?? 'idle',
          pending: isPending,
          subscriptionId: activeSub?.id,
          errorMessage: activeSub?.errorMessage,
          reconnectInSeconds: activeSub?.reconnectInSeconds,
          removable: true,
          coverImageUrl:
            meta.coverImageUrl && isValidPoeCdnImageUrl(meta.coverImageUrl)
              ? meta.coverImageUrl
              : undefined,
        });
      }
    }

    // 建構「上次連線」(previousConnections)：來自 Resume Plan 且尚未進入「本次連線」的項目
    const previousConnections: LiveSearchSourceItem[] = [];
    const combinedResumeMap = buildCombinedResumeMap();

    for (const [canonicalKey, resumeId] of combinedResumeMap.entries()) {
      if (resumeId.gameVersion !== primaryContext.gameVersion) continue;
      if (resumeId.league.trim().toLowerCase() !== currentSelectedLeague.trim().toLowerCase()) {
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
          liveSearchStatus: 'idle',
          removable: true,
        });
        continue;
      }

      // 若來源無書籤且亦無獨立保存之 name/url（例如舊版書籤已被刪除且 prune 進行中），略過不顯示孤兒 ID
      if (!resumeId.name && !resumeId.url && source && currentCollection) {
        continue;
      }

      const parsedIdentity: ParsedTradeSearchIdentity = {
        gameVersion: resumeId.gameVersion,
        league: currentSelectedLeague,
        searchId: resumeId.searchId,
      };
      const resolvedUrl =
        resumeId.url ||
        buildCanonicalTradeSearchUrl(
          resumeId.gameVersion,
          currentSelectedLeague,
          resumeId.searchId,
        );
      const compat = evaluateLiveSearchSourceCompatibility(
        parsedIdentity,
        primaryContext,
        resolvedUrl,
      );
      const validCover =
        resumeId.coverImageUrl && isValidPoeCdnImageUrl(resumeId.coverImageUrl)
          ? resumeId.coverImageUrl
          : undefined;

      previousConnections.push({
        kind: 'custom',
        id: `prev_${canonicalKey}`,
        name: resumeId.name || `搜尋 (${resumeId.searchId})`,
        url: resolvedUrl,
        canonicalIdentity: parsedIdentity,
        canonicalKey,
        compatibility: compat.compatibility,
        compatibilityMessage: compat.compatibilityMessage,
        groupId: PREVIOUS_CONNECTIONS_GROUP_ID,
        groupName: PREVIOUS_CONNECTIONS_GROUP_NAME,
        status: 'idle',
        liveSearchStatus: 'idle',
        pending: pendingSearchKeys.has(canonicalKey),
        removable: true,
        coverImageUrl: validCover,
      });
    }

    // 相同搜尋條件只顯示一筆（有圖片優先），且不與本次連線重複
    const dedupedPrevious = dedupePreviousConnectionItems(
      previousConnections,
      sessionConnections,
      (identity) => connectionDedup.peekCriteriaKey(identity),
    );
    lastPreviousConnectionsSignature = dedupedPrevious.items.map((item) => item.id).join('|');
    if (dedupedPrevious.unresolved.length > 0) {
      scheduleCriteriaResolution(dedupedPrevious.unresolved);
    }

    return {
      loading,
      ...(errorMessage ? { error: errorMessage } : {}),
      groups,
      sessionConnections,
      previousConnections: dedupedPrevious.items,
      selectedLeague: currentSelectedLeague,
      availableLeagues: available,
      isSwitchingLeague,
      leagueResolved: isLeagueResolved,
    };
  }

  function notify(): void {
    if (disposed) return;
    const snapshot = buildSnapshot();
    for (const listener of Array.from(listeners)) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[PoeXD LiveSearch] Error in source integration listener:', err);
      }
    }
  }

  function reconcileSourceOwnership(): void {
    if (disposed) return;
    syncActiveSubscriptionsIntoSessionEntries();
    if (source && !currentCollection) return;

    const bookmarkCanonicalKeys = new Set<string>();
    if (currentCollection) {
      const bookmarksByKey = new Map<string, typeof currentCollection.bookmarks>();
      for (const b of currentCollection.bookmarks) {
        const cleanUrl = stripLiveSuffix(b.url);
        const parsed = parseTradeSearchUrl(cleanUrl);
        if (parsed) {
          const key = getTradeSearchCanonicalKey(parsed);
          bookmarkCanonicalKeys.add(key);
          const list = bookmarksByKey.get(key);
          if (list) {
            list.push(b);
          } else {
            bookmarksByKey.set(key, [b]);
          }
        }
      }

      for (const [key, candidates] of bookmarksByKey.entries()) {
        const sessionMeta = sessionEntriesByKey.get(key);
        if (sessionMeta) {
          const preferred =
            (sessionMeta.sourceBookmarkId
              ? candidates.find((c) => c.id === sessionMeta.sourceBookmarkId)
              : undefined) ?? candidates[0];
          if (preferred) {
            sessionMeta.name = preferred.name;
            sessionMeta.url = preferred.url;
            sessionMeta.sourceBookmarkId = preferred.id;
            if (preferred.coverImageUrl && isValidPoeCdnImageUrl(preferred.coverImageUrl)) {
              sessionMeta.coverImageUrl = preferred.coverImageUrl;
            }
          }
        }
      }
    }

    // 1. Temporary -> Bookmark Promotion
    for (let i = customSources.length - 1; i >= 0; i--) {
      if (bookmarkCanonicalKeys.has(customSources[i].canonicalKey)) {
        const promoted = customSources[i];
        const activeSub = findActiveSubByCanonicalKey(promoted.canonicalKey);
        if (activeSub && activeSub.status !== 'closed' && resumeStore) {
          void resumeStore.addIdentities([
            {
              gameVersion: promoted.canonicalIdentity.gameVersion,
              league: promoted.canonicalIdentity.league,
              searchId: promoted.canonicalIdentity.searchId,
            },
          ]);
        }
        customSources.splice(i, 1);
      }
    }

    // 2. Active Bookmark Deletion / Canonical Split Fallback
    for (const sub of currentLiveSubscriptions) {
      if (sub.status === 'closed') continue;

      const subKey = getTradeSearchCanonicalKey({
        gameVersion: sub.gameVersion,
        league: sub.league,
        searchId: sub.searchId,
      });

      if (bookmarkCanonicalKeys.has(subKey)) {
        continue;
      }

      const existingCustom = customSources.find((c) => c.canonicalKey === subKey);
      if (!existingCustom) {
        customSources.push({
          id: `custom_fallback_${sub.id}`,
          name: sub.name || '搜尋',
          url: sub.url,
          canonicalIdentity: {
            gameVersion: sub.gameVersion,
            league: sub.league,
            searchId: sub.searchId,
          },
          canonicalKey: subKey,
          createdAt: Date.now(),
          provenance: 'origin-bookmark-removed',
        });
      }
    }
  }

  async function runReloadLoop(): Promise<void> {
    if (!source) return;
    try {
      while (!disposed) {
        hasPendingReload = false;
        const generation = ++activeGeneration;

        let outcome: BookmarkReadOutcome<BookmarkCollectionView>;
        try {
          outcome = await source.readCollection();
        } catch (err) {
          if (disposed || generation !== activeGeneration) return;
          if (hasPendingReload) {
            continue;
          }
          errorMessage = err instanceof Error ? err.message : '讀取書籤失敗';
          loading = false;
          notify();
          break;
        }

        if (disposed || generation !== activeGeneration) return;

        if (hasPendingReload) {
          continue;
        }

        if (!outcome.ok) {
          errorMessage = outcome.error.message;
        } else {
          errorMessage = undefined;
          rawCollection = outcome.value;
          syncResolvedCollection();
          reconcileSourceOwnership();
          if (resumeStore) {
            const validKeys = new Set<string>();
            for (const b of outcome.value.bookmarks) {
              const cleanUrl = stripLiveSuffix(b.url);
              const parsed = parseTradeSearchUrl(cleanUrl);
              if (parsed) {
                validKeys.add(getTradeSearchCanonicalKey(parsed));
              }
            }
            for (const [k, v] of baselineResumeByKey.entries()) {
              if (!v.url && !v.name && !validKeys.has(k)) {
                if (
                  !selectedLeague ||
                  v.league.trim().toLowerCase() === selectedLeague.trim().toLowerCase()
                ) {
                  baselineResumeByKey.delete(k);
                }
              }
            }
            void resumeStore.pruneToAuthoritative(validKeys, { league: selectedLeague });
          }
        }

        loading = false;

        if (!isLeagueResolved) {
          await resolveInitialLeague();
        }

        notify();
        break;
      }
    } finally {
      isReloading = false;
      reloadDrainPromise = null;
    }
  }

  function scheduleReload(): void {
    if (disposed || !source) return;
    if (isReloading) {
      hasPendingReload = true;
      return;
    }
    isReloading = true;
    reloadDrainPromise = runReloadLoop();
  }

  async function waitForReconciliationDrain(): Promise<void> {
    while (!disposed && (isReloading || hasPendingReload)) {
      if (reloadDrainPromise) {
        await reloadDrainPromise;
      } else {
        await Promise.resolve();
      }
    }
  }

  function extractSectionSourceCanonicalKey(sourceId: string): string | null {
    const trimmed = sourceId.trim();
    if (trimmed.startsWith('prev_')) {
      return trimmed.slice('prev_'.length);
    }
    if (trimmed.startsWith('session_')) {
      return trimmed.slice('session_'.length);
    }
    return null;
  }

  function resolveCanonicalKeyBySourceId(sourceId: string): string | null {
    const trimmed = sourceId.trim();
    const sectionKey = extractSectionSourceCanonicalKey(trimmed);
    if (sectionKey) {
      return sectionKey;
    }
    if (sessionEntriesByKey.has(trimmed)) {
      return trimmed;
    }
    const custom = customSources.find((c) => c.id === trimmed);
    if (custom) {
      return custom.canonicalKey;
    }
    const bookmark = currentCollection?.bookmarks.find((b) => b.id === trimmed);
    if (bookmark) {
      const parsed = parseTradeSearchUrl(stripLiveSuffix(bookmark.url));
      return parsed ? getTradeSearchCanonicalKey(parsed) : null;
    }
    return null;
  }

  function resolveSubscriptionId(sourceOrSubscriptionId: string): string | undefined {
    const trimmed = sourceOrSubscriptionId.trim();
    if (!trimmed) return undefined;

    const directSub = currentLiveSubscriptions.find(
      (s) => s.id === trimmed && s.status !== 'closed',
    );
    if (directSub) {
      return directSub.id;
    }

    const canonicalKey = resolveCanonicalKeyBySourceId(trimmed);
    if (!canonicalKey) return undefined;

    return findActiveSubByCanonicalKey(canonicalKey)?.id;
  }

  function createEmptyBatchCounters(): {
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

  function findResumeEntryByCanonicalKey(
    canonicalKey: string,
  ): LiveSearchResumeIdentity | undefined {
    return (
      latestResumeIdentities.find((id) => getResumeCanonicalKey(id) === canonicalKey) ??
      baselineResumeByKey.get(canonicalKey)
    );
  }

  function enableSource(sourceId: string): Promise<AddSubscriptionOutcome> {
    return enableSourceInternal(sourceId, true);
  }

  /**
   * @param allowRedirect 是否套用「相同搜尋條件」轉向；轉向後的再次呼叫不再轉向，避免循環。
   */
  async function enableSourceInternal(
    sourceId: string,
    allowRedirect: boolean,
  ): Promise<AddSubscriptionOutcome> {
    if (disposed) {
      return { success: false, error: '控制器已釋放' };
    }

    if (!isLeagueResolved) {
      await ensureStartupResolved();
    }

    if (source && (isReloading || hasPendingReload)) {
      await waitForReconciliationDrain();
    }

    if (disposed) {
      return { success: false, error: '控制器已釋放' };
    }

    if (isSwitchingLeague) {
      return { success: false, error: '正在切換聯盟中，請稍候' };
    }

    const opGeneration = transitionGeneration;
    const opLeague = selectedLeague;

    if (!sourceId || typeof sourceId !== 'string') {
      return { success: false, error: '無效的書籤 ID' };
    }

    const trimmedId = sourceId.trim();

    // 0. 支援從「上次連線」(prev_*) 或「本次連線」(session_*) 直接啟用非書籤來源
    const targetKey = extractSectionSourceCanonicalKey(trimmedId);
    if (targetKey) {
      let existingCustom = customSources.find((c) => c.canonicalKey === targetKey);
      if (!existingCustom) {
        const sessionMeta = sessionEntriesByKey.get(targetKey);
        const resumeEntry = findResumeEntryByCanonicalKey(targetKey);
        if (sessionMeta) {
          existingCustom = {
            id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: sessionMeta.name,
            url: sessionMeta.url,
            canonicalIdentity: { ...sessionMeta.canonicalIdentity },
            canonicalKey: targetKey,
            createdAt: Date.now(),
            coverImageUrl: sessionMeta.coverImageUrl,
          };
          customSources.push(existingCustom);
        } else if (resumeEntry) {
          const resolvedUrl =
            resumeEntry.url ||
            buildCanonicalTradeSearchUrl(
              resumeEntry.gameVersion,
              opLeague || resumeEntry.league,
              resumeEntry.searchId,
            );
          const parsed = parseTradeSearchUrl(stripLiveSuffix(resolvedUrl)) ?? {
            gameVersion: resumeEntry.gameVersion,
            league: opLeague || resumeEntry.league,
            searchId: resumeEntry.searchId,
          };
          existingCustom = {
            id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: resumeEntry.name || `搜尋 (${resumeEntry.searchId})`,
            url: resolvedUrl,
            canonicalIdentity: parsed,
            canonicalKey: targetKey,
            createdAt: Date.now(),
            coverImageUrl: resumeEntry.coverImageUrl,
          };
          customSources.push(existingCustom);
        }
      }
      if (existingCustom) {
        return enableSourceInternal(existingCustom.id, allowRedirect);
      }
    }

    // 1. 先檢查是否為 Custom Source
    const custom = customSources.find((c) => c.id === trimmedId);
    if (custom) {
      const compat = evaluateLiveSearchSourceCompatibility(
        custom.canonicalIdentity,
        getPrimaryContext(),
      );
      if (compat.compatibility !== 'compatible') {
        return {
          success: false,
          error: compat.compatibilityMessage || '此搜尋與目前主控台不相容',
        };
      }

      if (custom.canonicalIdentity.league.trim().toLowerCase() !== opLeague.trim().toLowerCase()) {
        return {
          success: false,
          error: `此搜尋屬於 ${formatLiveSearchDisplayLeague(custom.canonicalIdentity.league)}，目前主控台選定聯盟為 ${formatLiveSearchDisplayLeague(opLeague)}`,
        };
      }

      if (pendingSearchKeys.has(custom.canonicalKey)) {
        return { success: false, error: '此搜尋正在啟動中，請稍候' };
      }
      if (findActiveSubByCanonicalKey(custom.canonicalKey)) {
        return { success: false, error: '此搜尋已在即時監聽中' };
      }

      if (allowRedirect) {
        const redirect = await resolveCriteriaRedirect(
          custom.canonicalIdentity,
          custom.canonicalKey,
          custom.coverImageUrl,
        );
        if (redirect?.kind === 'error') return { success: false, error: redirect.error };
        if (redirect?.kind === 'source') return enableSourceInternal(redirect.sourceId, false);
        if (redirect?.kind === 'adopt-meta') {
          custom.coverImageUrl = redirect.entry.coverImageUrl;
          if (redirect.entry.name) custom.name = redirect.entry.name;
        }
        if (pendingSearchKeys.has(custom.canonicalKey)) {
          return { success: false, error: '此搜尋正在啟動中，請稍候' };
        }
        if (findActiveSubByCanonicalKey(custom.canonicalKey)) {
          return { success: false, error: '此搜尋已在即時監聽中' };
        }
      }

      registerSessionEntry({
        canonicalKey: custom.canonicalKey,
        canonicalIdentity: custom.canonicalIdentity,
        name: custom.name,
        url: custom.url,
        coverImageUrl: custom.coverImageUrl,
      });
      pendingSearchKeys.add(custom.canonicalKey);
      notify();

      try {
        if (
          transitionGeneration !== opGeneration ||
          isSwitchingLeague ||
          selectedLeague !== opLeague
        ) {
          return { success: false, error: '主控台聯盟已切換，操作已取消' };
        }
        const outcome = await liveController.addFromUrl(custom.url, {
          name: custom.name,
        });
        if (
          transitionGeneration !== opGeneration ||
          isSwitchingLeague ||
          selectedLeague !== opLeague
        ) {
          if (outcome.success) {
            const sub = findActiveSubByCanonicalKey(custom.canonicalKey);
            if (sub) {
              liveController.remove(sub.id);
            } else {
              void liveController.teardownAll();
            }
          }
          return { success: false, error: '主控台聯盟已切換，操作已取消' };
        }
        if (outcome.success && resumeStore) {
          await resumeStore.addIdentities([
            {
              gameVersion: custom.canonicalIdentity.gameVersion,
              league: custom.canonicalIdentity.league,
              searchId: custom.canonicalIdentity.searchId,
              name: custom.name || `搜尋 (${custom.canonicalIdentity.searchId})`,
              url: custom.url,
              ...(custom.coverImageUrl ? { coverImageUrl: custom.coverImageUrl } : {}),
            },
          ]);
        }
        return outcome;
      } finally {
        pendingSearchKeys.delete(custom.canonicalKey);
        notify();
      }
    }

    // 2. Bookmark Source
    if (isReloading || hasPendingReload) {
      await waitForReconciliationDrain();
    }

    if (disposed) {
      return { success: false, error: '控制器已釋放' };
    }

    if (transitionGeneration !== opGeneration || isSwitchingLeague || selectedLeague !== opLeague) {
      return { success: false, error: '主控台聯盟已切換，操作已取消' };
    }

    if (!currentCollection) {
      return { success: false, error: '書籤資料尚未就緒' };
    }

    const bookmark = currentCollection.bookmarks.find((b) => b.id === trimmedId);
    if (!bookmark) {
      return { success: false, error: '找不到指定書籤' };
    }

    const bookmarkUrl = stripLiveSuffix(bookmark.url);
    const parsed = parseTradeSearchUrl(bookmarkUrl);
    if (!parsed) {
      return {
        success: false,
        error: '此書籤的網址無法解析為合法的 Trade 搜尋',
      };
    }

    const compat = evaluateLiveSearchSourceCompatibility(parsed, getPrimaryContext(), bookmarkUrl);
    if (compat.compatibility !== 'compatible') {
      return {
        success: false,
        error: compat.compatibilityMessage || '此搜尋與目前主控台不相容',
      };
    }

    if (parsed.league.trim().toLowerCase() !== opLeague.trim().toLowerCase()) {
      return {
        success: false,
        error: `此搜尋屬於 ${formatLiveSearchDisplayLeague(parsed.league)}，目前主控台選定聯盟為 ${formatLiveSearchDisplayLeague(opLeague)}`,
      };
    }

    const searchKey = getTradeSearchCanonicalKey(parsed);

    if (pendingSearchKeys.has(searchKey)) {
      return { success: false, error: '此搜尋正在啟動中，請稍候' };
    }

    if (findActiveSubByCanonicalKey(searchKey)) {
      return { success: false, error: '此搜尋已在即時監聽中' };
    }

    let validCoverUrl =
      bookmark.coverImageUrl && isValidPoeCdnImageUrl(bookmark.coverImageUrl)
        ? bookmark.coverImageUrl
        : undefined;

    pendingSearchKeys.add(searchKey);
    notify();

    if (allowRedirect) {
      const redirect = await resolveCriteriaRedirect(parsed, searchKey, validCoverUrl);
      if (redirect?.kind === 'error' || redirect?.kind === 'source') {
        pendingSearchKeys.delete(searchKey);
        notify();
        return redirect.kind === 'error'
          ? { success: false, error: redirect.error }
          : enableSourceInternal(redirect.sourceId, false);
      }
      // 同一 search ID：書籤名稱維持優先顯示，只沿用上次連線的封面
      if (redirect?.kind === 'adopt-meta') validCoverUrl = redirect.entry.coverImageUrl;
    }

    try {
      if (
        transitionGeneration !== opGeneration ||
        isSwitchingLeague ||
        selectedLeague !== opLeague
      ) {
        return { success: false, error: '主控台聯盟已切換，操作已取消' };
      }
      const outcome = await liveController.addFromUrl(bookmark.url, {
        name: bookmark.name,
        sourceBookmarkId: bookmark.id,
      });
      if (
        transitionGeneration !== opGeneration ||
        isSwitchingLeague ||
        selectedLeague !== opLeague
      ) {
        if (outcome.success) {
          const sub = findActiveSubByCanonicalKey(searchKey);
          if (sub) {
            liveController.remove(sub.id);
          } else {
            void liveController.teardownAll();
          }
        }
        return { success: false, error: '主控台聯盟已切換，操作已取消' };
      }
      if (outcome.success) {
        registerSessionEntry({
          canonicalKey: searchKey,
          canonicalIdentity: parsed,
          name: bookmark.name,
          url: bookmark.url,
          coverImageUrl: validCoverUrl,
          sourceBookmarkId: bookmark.id,
        });
        if (resumeStore && parsed) {
          await resumeStore.addIdentities([
            {
              gameVersion: parsed.gameVersion,
              league: parsed.league,
              searchId: parsed.searchId,
            },
          ]);
        }
      }
      return outcome;
    } finally {
      pendingSearchKeys.delete(searchKey);
      notify();
    }
  }

  async function enableManySources(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome> {
    const { skipReasons, incompatibleBreakdown } = createEmptyBatchCounters();
    const requestedIds = Array.isArray(sourceIds) ? sourceIds : [];
    const requested = requestedIds.length;

    if (disposed) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'disposed',
        error: '控制器已釋放',
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    if (requested === 0) {
      return {
        success: true,
        requested: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    if (!isLeagueResolved) {
      await ensureStartupResolved();
    }

    if (source && (isReloading || hasPendingReload)) {
      await waitForReconciliationDrain();
    }

    if (disposed) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'disposed',
        error: '控制器已釋放',
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    if (isSwitchingLeague) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'not-ready',
        error: '正在切換聯盟中，請稍候',
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    const opGeneration = transitionGeneration;
    const opLeague = selectedLeague;

    if (
      !currentCollection &&
      customSources.length === 0 &&
      sessionEntriesByKey.size === 0 &&
      baselineResumeByKey.size === 0
    ) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'not-ready',
        error: '書籤資料尚未就緒',
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    const primaryContext = getPrimaryContext();

    function resolveCandidateInfo(sourceId: string): {
      parsed: ParsedTradeSearchIdentity | null;
      sourceUrl?: string;
      exists: boolean;
    } {
      const key = extractSectionSourceCanonicalKey(sourceId);
      if (key) {
        const sessionMeta = sessionEntriesByKey.get(key);
        if (sessionMeta) {
          return {
            parsed: sessionMeta.canonicalIdentity,
            sourceUrl: stripLiveSuffix(sessionMeta.url),
            exists: true,
          };
        }
        const resumeEntry = findResumeEntryByCanonicalKey(key);
        if (resumeEntry) {
          return {
            parsed: {
              gameVersion: resumeEntry.gameVersion,
              league: resumeEntry.league,
              searchId: resumeEntry.searchId,
            },
            sourceUrl: resumeEntry.url ? stripLiveSuffix(resumeEntry.url) : undefined,
            exists: true,
          };
        }
      }

      const custom = customSources.find((c) => c.id === sourceId);
      if (custom) {
        return {
          parsed: custom.canonicalIdentity,
          sourceUrl: undefined,
          exists: true,
        };
      }

      const bookmark = currentCollection?.bookmarks.find((b) => b.id === sourceId);
      if (bookmark) {
        const cleanUrl = stripLiveSuffix(bookmark.url);
        return {
          parsed: parseTradeSearchUrl(cleanUrl) ?? null,
          sourceUrl: cleanUrl,
          exists: true,
        };
      }

      return { parsed: null, exists: false };
    }

    // 尚未鎖定聯盟時之 Mixed-League Atomic Preflight across requested items
    if (!primaryContext.runtimeLeague) {
      const distinctBatchLeagues: string[] = [];
      for (const rawId of requestedIds) {
        const sourceId = typeof rawId === 'string' ? rawId.trim() : '';
        if (!sourceId) continue;
        const info = resolveCandidateInfo(sourceId);
        if (!info.exists) continue;
        if (info.parsed && info.parsed.gameVersion === primaryContext.gameVersion) {
          const norm = info.parsed.league.trim().toLowerCase();
          if (!distinctBatchLeagues.includes(norm)) {
            distinctBatchLeagues.push(norm);
          }
        }
      }

      if (distinctBatchLeagues.length > 1) {
        const formattedLeagues = distinctBatchLeagues
          .map(formatLiveSearchDisplayLeague)
          .join(' 與 ');
        return {
          success: false,
          requested,
          succeeded: 0,
          skipped: 0,
          failed: requested,
          rejectReason: 'mixed-league',
          involvedLeagues: distinctBatchLeagues,
          error: `選取項目包含多個聯盟（${formattedLeagues}），請分開啟用`,
          skipReasons,
          incompatibleBreakdown,
          runtimeFailureCount: 0,
        };
      }
    }

    const seenCanonicalKeysInBatch = new Set<string>();
    const eligibleCandidates: Array<{
      sourceId: string;
      parsed: ParsedTradeSearchIdentity;
      canonicalKey: string;
    }> = [];
    let skipped = 0;

    for (const rawId of requestedIds) {
      const sourceId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!sourceId) {
        skipped += 1;
        skipReasons.notFound += 1;
        continue;
      }

      const info = resolveCandidateInfo(sourceId);
      if (!info.exists) {
        skipped += 1;
        skipReasons.notFound += 1;
        continue;
      }

      const parsed = info.parsed;

      if (parsed && parsed.league.trim().toLowerCase() !== opLeague.trim().toLowerCase()) {
        skipped += 1;
        skipReasons.incompatible += 1;
        incompatibleBreakdown.wrongLeague += 1;
        continue;
      }

      const compat = evaluateLiveSearchSourceCompatibility(parsed, primaryContext, info.sourceUrl);

      if (!parsed || compat.compatibility !== 'compatible') {
        skipped += 1;
        skipReasons.incompatible += 1;
        if (compat.compatibility === 'invalid-url') {
          incompatibleBreakdown.invalidUrl += 1;
        } else if (compat.compatibility === 'wrong-version') {
          incompatibleBreakdown.wrongVersion += 1;
        } else if (compat.compatibility === 'wrong-league') {
          incompatibleBreakdown.wrongLeague += 1;
        }
        continue;
      }

      const canonicalKey = getTradeSearchCanonicalKey(parsed);

      if (findActiveSubByCanonicalKey(canonicalKey)) {
        skipped += 1;
        skipReasons.alreadyActive += 1;
        continue;
      }

      if (pendingSearchKeys.has(canonicalKey)) {
        skipped += 1;
        skipReasons.pending += 1;
        continue;
      }

      if (seenCanonicalKeysInBatch.has(canonicalKey)) {
        skipped += 1;
        skipReasons.duplicateInBatch += 1;
        continue;
      }

      seenCanonicalKeysInBatch.add(canonicalKey);
      eligibleCandidates.push({
        sourceId,
        parsed,
        canonicalKey,
      });
    }

    // 相同搜尋條件（不同 search ID）在同一批次或已在監聽中者只保留一筆
    if (eligibleCandidates.length > 0) {
      const activeIdentities = currentLiveSubscriptions
        .filter((sub) => sub.status !== 'closed')
        .map((sub) => ({
          gameVersion: sub.gameVersion,
          league: sub.league,
          searchId: sub.searchId,
        }));
      await connectionDedup.resolveMany([
        ...eligibleCandidates.map((candidate) => candidate.parsed),
        ...activeIdentities,
      ]);
      const criteriaKeyOf = (identity: ParsedTradeSearchIdentity) =>
        connectionDedup.peekCriteriaKey(identity) ?? getTradeSearchCanonicalKey(identity);
      const activeCriteriaKeys = new Set(activeIdentities.map(criteriaKeyOf));
      const seenCriteriaKeys = new Set<string>();
      for (let i = 0; i < eligibleCandidates.length; i++) {
        const criteriaKey = criteriaKeyOf(eligibleCandidates[i].parsed);
        if (activeCriteriaKeys.has(criteriaKey)) {
          skipped += 1;
          skipReasons.alreadyActive += 1;
        } else if (seenCriteriaKeys.has(criteriaKey)) {
          skipped += 1;
          skipReasons.duplicateInBatch += 1;
        } else {
          seenCriteriaKeys.add(criteriaKey);
          continue;
        }
        eligibleCandidates.splice(i, 1);
        i -= 1;
      }
    }

    if (!primaryContext.runtimeLeague && eligibleCandidates.length > 1) {
      const distinctLeagues: string[] = [];
      for (const candidate of eligibleCandidates) {
        const normLeague = candidate.parsed.league.trim().toLowerCase();
        if (!distinctLeagues.includes(normLeague)) {
          distinctLeagues.push(normLeague);
        }
      }

      if (distinctLeagues.length > 1) {
        const formattedLeagues = distinctLeagues.map(formatLiveSearchDisplayLeague).join(' 與 ');
        return {
          success: false,
          requested,
          succeeded: 0,
          skipped,
          failed: eligibleCandidates.length,
          rejectReason: 'mixed-league',
          involvedLeagues: distinctLeagues,
          error: `選取項目包含多個聯盟（${formattedLeagues}），請分開啟用`,
          skipReasons,
          incompatibleBreakdown,
          runtimeFailureCount: 0,
        };
      }
    }

    let succeeded = 0;
    let failed = 0;
    let runtimeFailureCount = 0;
    let lastError: string | undefined;

    for (const candidate of eligibleCandidates) {
      if (disposed) {
        failed += 1;
        continue;
      }
      if (
        transitionGeneration !== opGeneration ||
        isSwitchingLeague ||
        selectedLeague !== opLeague
      ) {
        failed += eligibleCandidates.length - succeeded;
        lastError = '主控台聯盟已切換，中止舊聯盟批次啟用';
        break;
      }
      const outcome = await enableSource(candidate.sourceId);
      if (
        transitionGeneration !== opGeneration ||
        isSwitchingLeague ||
        selectedLeague !== opLeague
      ) {
        failed += eligibleCandidates.length - succeeded;
        lastError = '主控台聯盟已切換，中止舊聯盟批次啟用';
        break;
      }
      if (outcome.success) {
        succeeded += 1;
      } else {
        failed += 1;
        runtimeFailureCount += 1;
        lastError = outcome.error;
      }
    }

    return {
      success: failed === 0,
      requested,
      succeeded,
      skipped,
      failed,
      ...(lastError ? { error: lastError } : {}),
      skipReasons,
      incompatibleBreakdown,
      runtimeFailureCount,
    };
  }

  function stopManySources(sourceIds: readonly string[]): LiveSearchBatchOutcome {
    const { skipReasons, incompatibleBreakdown } = createEmptyBatchCounters();
    const requestedIds = Array.isArray(sourceIds) ? sourceIds : [];
    const requested = requestedIds.length;

    if (disposed) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'disposed',
        error: '控制器已釋放',
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    if (requested === 0) {
      return {
        success: true,
        requested: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    const stoppedSubIds = new Set<string>();
    let succeeded = 0;
    let skipped = 0;

    for (const rawId of requestedIds) {
      const sourceId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!sourceId) {
        skipped += 1;
        skipReasons.notFound += 1;
        continue;
      }

      const subId = resolveSubscriptionId(sourceId);
      if (!subId) {
        const canonicalKey = resolveCanonicalKeyBySourceId(sourceId);
        const exists =
          (canonicalKey !== null && sessionEntriesByKey.has(canonicalKey)) ||
          customSources.some((c) => c.id === sourceId) ||
          Boolean(currentCollection?.bookmarks.some((b) => b.id === sourceId));
        skipped += 1;
        if (exists) {
          skipReasons.inactive += 1;
        } else {
          skipReasons.notFound += 1;
        }
        continue;
      }

      if (stoppedSubIds.has(subId)) {
        skipped += 1;
        skipReasons.duplicateInBatch += 1;
        continue;
      }

      stoppedSubIds.add(subId);
      liveController.remove(subId);
      succeeded += 1;
    }

    notify();
    return {
      success: true,
      requested,
      succeeded,
      skipped,
      failed: 0,
      skipReasons,
      incompatibleBreakdown,
      runtimeFailureCount: 0,
    };
  }

  if (source) {
    unsubSource = source.subscribe(() => {
      scheduleReload();
    });
  }

  unsubLive = liveController.subscribe((liveSnapshot) => {
    if (liveSnapshot.gameVersion) {
      currentGameVersion = liveSnapshot.gameVersion;
    }
    if ('runtimeLeague' in liveSnapshot) {
      currentRuntimeLeague = liveSnapshot.runtimeLeague;
    }
    currentLiveSubscriptions = liveSnapshot.subscriptions;
    reconcileSourceOwnership();
    notify();
  });

  if (source) {
    scheduleReload();
  }

  function removeSessionConnectionInternal(sourceOrSubscriptionId: string): boolean {
    if (disposed || typeof sourceOrSubscriptionId !== 'string') return false;
    const trimmed = sourceOrSubscriptionId.trim();
    if (!trimmed) return false;

    const canonicalKey = resolveCanonicalKeyBySourceId(trimmed);
    const customIdx = customSources.findIndex(
      (c) => c.id === trimmed || (canonicalKey !== null && c.canonicalKey === canonicalKey),
    );
    const hadSessionEntry = canonicalKey !== null && sessionEntriesByKey.has(canonicalKey);
    const activeSubId = resolveSubscriptionId(trimmed);

    if (customIdx === -1 && !hadSessionEntry && !activeSubId) {
      return false;
    }

    if (customIdx !== -1) {
      customSources.splice(customIdx, 1);
    }
    if (canonicalKey) {
      sessionEntriesByKey.delete(canonicalKey);
      if (
        resumeStore &&
        latestResumeIdentities.some((id) => getResumeCanonicalKey(id) === canonicalKey)
      ) {
        void resumeStore.removeIdentities([canonicalKey]);
      }
    }
    if (activeSubId) {
      liveController.remove(activeSubId);
    }
    notify();
    return true;
  }

  return {
    read(): Readonly<LiveSearchSourceSnapshot> {
      return buildSnapshot();
    },

    subscribe(listener: (snapshot: Readonly<LiveSearchSourceSnapshot>) => void): () => void {
      if (disposed) {
        try {
          listener(buildSnapshot());
        } catch {}
        return () => {};
      }

      listeners.add(listener);
      try {
        listener(buildSnapshot());
      } catch (err) {
        console.error('[PoeXD LiveSearch] Error in initial source integration listener:', err);
      }

      return () => {
        listeners.delete(listener);
      };
    },

    enable: enableSource,
    add: enableSource,
    enableMany: enableManySources,
    stopMany: stopManySources,

    async addCustom(
      url: string,
      options?: { name?: string; coverImageUrl?: string },
    ): Promise<AddSubscriptionOutcome> {
      if (disposed) {
        return { success: false, error: '控制器已釋放' };
      }

      if (!isLeagueResolved) {
        await ensureStartupResolved();
      }

      if (source && (isReloading || hasPendingReload)) {
        await waitForReconciliationDrain();
      }

      if (disposed) {
        return { success: false, error: '控制器已釋放' };
      }

      if (isSwitchingLeague) {
        return { success: false, error: '正在切換聯盟中，請稍候' };
      }

      if (typeof url !== 'string' || !url.trim()) {
        return { success: false, error: '請提供有效的 Trade 搜尋網址' };
      }

      const cleanUrl = stripLiveSuffix(url.trim());
      const parsed = parseTradeSearchUrl(cleanUrl);
      if (!parsed) {
        return {
          success: false,
          error: '無效的 Trade 搜尋網址，請確認網址格式正確且包含版本、聯盟與搜尋代碼',
        };
      }

      if (parsed.gameVersion !== currentGameVersion) {
        return {
          success: false,
          error: `此搜尋屬於 ${formatLiveSearchDisplayVersion(parsed.gameVersion)}，目前主控台為 ${formatLiveSearchDisplayVersion(currentGameVersion)}`,
        };
      }

      if (parsed.league.trim().toLowerCase() !== selectedLeague.trim().toLowerCase()) {
        return {
          success: false,
          error: `此搜尋屬於 ${formatLiveSearchDisplayLeague(parsed.league)}，目前主控台聯盟為 ${formatLiveSearchDisplayLeague(selectedLeague)}，請先切換主控台聯盟後再新增`,
        };
      }

      const canonicalKey = getTradeSearchCanonicalKey(parsed);
      let trimmedName = options?.name?.trim() ?? '';
      let incomingCover = hasValidCover(options?.coverImageUrl)
        ? options?.coverImageUrl
        : undefined;

      // 相同搜尋條件只能有一筆：須在登記本次連線之前決定沿用哪一筆
      const redirect = await resolveCriteriaRedirect(parsed, canonicalKey, incomingCover);
      if (redirect?.kind === 'error') return { success: false, error: redirect.error };
      if (redirect?.kind === 'source') return enableSourceInternal(redirect.sourceId, false);
      if (redirect?.kind === 'adopt-meta') {
        incomingCover = redirect.entry.coverImageUrl;
        trimmedName = redirect.entry.name?.trim() || trimmedName;
      }
      // 未提供名稱時以搜尋代碼（search ID）命名，確保可辨識、可搜尋、可篩選結果
      const displayName = trimmedName || parsed.searchId;

      const existingBookmark = currentCollection?.bookmarks.find((b) => {
        const bCleanUrl = stripLiveSuffix(b.url);
        const bParsed = parseTradeSearchUrl(bCleanUrl);
        return bParsed && getTradeSearchCanonicalKey(bParsed) === canonicalKey;
      });

      if (existingBookmark) {
        const existingCustomIdx = customSources.findIndex((c) => c.canonicalKey === canonicalKey);
        if (existingCustomIdx !== -1) {
          customSources.splice(existingCustomIdx, 1);
        }

        if (findActiveSubByCanonicalKey(canonicalKey)) {
          return { success: false, error: '此搜尋已在即時監聽中' };
        }

        return await enableSource(existingBookmark.id);
      }

      let customRecord = customSources.find((c) => c.canonicalKey === canonicalKey);
      const validCover = incomingCover;

      if (customRecord) {
        customRecord.url = cleanUrl;
        if (trimmedName || !customRecord.name) {
          customRecord.name = displayName;
        }
        if (validCover) {
          customRecord.coverImageUrl = validCover;
        }
        customRecord.provenance = undefined;
      } else {
        customRecord = {
          id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: displayName,
          url: cleanUrl,
          canonicalIdentity: { ...parsed },
          canonicalKey,
          createdAt: Date.now(),
          coverImageUrl: validCover,
        };
        customSources.push(customRecord);
      }

      registerSessionEntry({
        canonicalKey,
        canonicalIdentity: parsed,
        name: customRecord.name || `搜尋 (${parsed.searchId})`,
        url: cleanUrl,
        coverImageUrl: customRecord.coverImageUrl,
      });

      notify();
      return await enableSourceInternal(customRecord.id, false);
    },

    async enqueueIncomingConnections(
      items: readonly LiveSearchEnqueueItem[],
    ): Promise<LiveSearchEnqueueResponse> {
      if (disposed) {
        return { success: false, error: '主控台已關閉', rejectReason: 'failed' };
      }

      if (!isLeagueResolved) {
        await ensureStartupResolved();
      }

      if (source && (isReloading || hasPendingReload)) {
        await waitForReconciliationDrain();
      }

      if (disposed) {
        return { success: false, error: '主控台已關閉', rejectReason: 'failed' };
      }

      const rawItems = Array.isArray(items) ? items : [];
      const parsedCandidates: Array<{
        item: LiveSearchEnqueueItem;
        cleanUrl: string;
        parsed: ParsedTradeSearchIdentity;
        canonicalKey: string;
      }> = [];
      const seenIncomingKeys = new Set<string>();
      let duplicateIncomingSkipped = 0;

      for (const item of rawItems) {
        if (!item || typeof item.url !== 'string' || !item.url.trim()) continue;
        const cleanUrl = stripLiveSuffix(item.url.trim());
        const parsed = parseTradeSearchUrl(cleanUrl);
        if (!parsed || isLegacyTradeSearchUrl(cleanUrl)) {
          continue;
        }
        const canonicalKey = getTradeSearchCanonicalKey(parsed);
        if (seenIncomingKeys.has(canonicalKey)) {
          duplicateIncomingSkipped++;
          continue;
        }
        seenIncomingKeys.add(canonicalKey);
        parsedCandidates.push({
          item,
          cleanUrl,
          parsed,
          canonicalKey,
        });
      }

      if (parsedCandidates.length === 0) {
        return {
          success: false,
          error: '無效的 Trade 搜尋網址',
          rejectReason: 'invalid-url',
        };
      }

      const wrongVersionItem = parsedCandidates.find(
        (c) => c.parsed.gameVersion !== currentGameVersion,
      );
      if (wrongVersionItem) {
        return {
          success: false,
          error: `此搜尋屬於 ${formatLiveSearchDisplayVersion(wrongVersionItem.parsed.gameVersion)}，目前主控台為 ${formatLiveSearchDisplayVersion(currentGameVersion)}`,
          rejectReason: 'wrong-version',
        };
      }

      const distinctLeagues: string[] = [];
      for (const c of parsedCandidates) {
        const normLeague = c.parsed.league.trim().toLowerCase();
        if (!distinctLeagues.includes(normLeague)) {
          distinctLeagues.push(normLeague);
        }
      }

      if (distinctLeagues.length > 1) {
        const formatted = distinctLeagues.map(formatLiveSearchDisplayLeague).join(' 與 ');
        return {
          success: false,
          error: `選取項目包含多個聯盟（${formatted}），請分開送入主控台`,
          rejectReason: 'mixed-league',
        };
      }

      const incomingLeague = parsedCandidates[0].parsed.league.trim();
      const primaryContext = getPrimaryContext();

      if (
        primaryContext.runtimeLeague &&
        primaryContext.runtimeLeague.trim().toLowerCase() !== incomingLeague.toLowerCase()
      ) {
        return {
          success: false,
          error: `主控台目前正在監聽 ${formatLiveSearchDisplayLeague(primaryContext.runtimeLeague)}，無法直接加入 ${formatLiveSearchDisplayLeague(incomingLeague)} 連線`,
          rejectReason: 'wrong-league',
        };
      }

      if (
        !primaryContext.runtimeLeague &&
        selectedLeague.trim().toLowerCase() !== incomingLeague.toLowerCase()
      ) {
        const switched = await switchLeague(incomingLeague);
        if (!switched) {
          return {
            success: false,
            error: `切換主控台聯盟至 ${formatLiveSearchDisplayLeague(incomingLeague)} 失敗`,
            rejectReason: 'failed',
          };
        }
      }

      const sourceIdsToEnable: string[] = [];
      const resumeEntriesToPersist: LiveSearchResumeIdentity[] = [];

      for (const candidate of parsedCandidates) {
        const existingBookmark =
          (candidate.item.sourceBookmarkId
            ? currentCollection?.bookmarks.find((b) => {
                if (b.id !== candidate.item.sourceBookmarkId) return false;
                const bCleanUrl = stripLiveSuffix(b.url);
                const bParsed = parseTradeSearchUrl(bCleanUrl);
                return bParsed && getTradeSearchCanonicalKey(bParsed) === candidate.canonicalKey;
              })
            : undefined) ??
          currentCollection?.bookmarks.find((b) => {
            const bCleanUrl = stripLiveSuffix(b.url);
            const bParsed = parseTradeSearchUrl(bCleanUrl);
            return bParsed && getTradeSearchCanonicalKey(bParsed) === candidate.canonicalKey;
          });

        let validCover =
          candidate.item.coverImageUrl && isValidPoeCdnImageUrl(candidate.item.coverImageUrl)
            ? candidate.item.coverImageUrl
            : existingBookmark?.coverImageUrl &&
                isValidPoeCdnImageUrl(existingBookmark.coverImageUrl)
              ? existingBookmark.coverImageUrl
              : undefined;
        let resolvedName =
          candidate.item.name?.trim() ||
          existingBookmark?.name ||
          `搜尋 (${candidate.parsed.searchId})`;

        // 相同搜尋條件只能有一筆：已在本次連線者沿用既有項目；與上次連線相同者有圖片優先
        const redirect = await resolveCriteriaRedirect(
          candidate.parsed,
          candidate.canonicalKey,
          validCover,
        );
        if (redirect?.kind === 'error') {
          duplicateIncomingSkipped++;
          continue;
        }
        if (redirect?.kind === 'source') {
          if (sourceIdsToEnable.includes(redirect.sourceId)) {
            duplicateIncomingSkipped++;
          } else {
            sourceIdsToEnable.push(redirect.sourceId);
          }
          continue;
        }
        if (redirect?.kind === 'adopt-meta') {
          validCover = redirect.entry.coverImageUrl;
          if (!existingBookmark && redirect.entry.name) resolvedName = redirect.entry.name;
        }

        if (existingBookmark) {
          registerSessionEntry({
            canonicalKey: candidate.canonicalKey,
            canonicalIdentity: candidate.parsed,
            name: existingBookmark.name,
            url: existingBookmark.url,
            coverImageUrl: validCover,
            sourceBookmarkId: existingBookmark.id,
          });
          sourceIdsToEnable.push(existingBookmark.id);
          resumeEntriesToPersist.push({
            gameVersion: candidate.parsed.gameVersion,
            league: candidate.parsed.league,
            searchId: candidate.parsed.searchId,
          });
        } else {
          let customRecord = customSources.find((c) => c.canonicalKey === candidate.canonicalKey);
          if (!customRecord) {
            customRecord = {
              id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              name: resolvedName,
              url: candidate.cleanUrl,
              canonicalIdentity: { ...candidate.parsed },
              canonicalKey: candidate.canonicalKey,
              createdAt: Date.now(),
              coverImageUrl: validCover,
            };
            customSources.push(customRecord);
          } else {
            customRecord.url = candidate.cleanUrl;
            if (resolvedName) customRecord.name = resolvedName;
            if (validCover) customRecord.coverImageUrl = validCover;
          }
          registerSessionEntry({
            canonicalKey: candidate.canonicalKey,
            canonicalIdentity: candidate.parsed,
            name: resolvedName,
            url: candidate.cleanUrl,
            coverImageUrl: validCover,
          });
          sourceIdsToEnable.push(customRecord.id);
          resumeEntriesToPersist.push({
            gameVersion: candidate.parsed.gameVersion,
            league: candidate.parsed.league,
            searchId: candidate.parsed.searchId,
            name: resolvedName,
            url: candidate.cleanUrl,
            ...(validCover ? { coverImageUrl: validCover } : {}),
          });
        }
      }

      notify();
      const batchOutcome = await enableManySources(sourceIdsToEnable);
      if (resumeStore && batchOutcome.succeeded > 0 && resumeEntriesToPersist.length > 0) {
        await resumeStore.addIdentities(resumeEntriesToPersist);
      }

      return {
        success: batchOutcome.failed === 0 && !batchOutcome.rejectReason,
        addedCount: batchOutcome.succeeded,
        skippedCount: batchOutcome.skipped + duplicateIncomingSkipped,
        ...(batchOutcome.error ? { error: batchOutcome.error } : {}),
      };
    },

    stop(sourceOrSubscriptionId: string): void {
      if (disposed || typeof sourceOrSubscriptionId !== 'string') return;
      const subId = resolveSubscriptionId(sourceOrSubscriptionId);
      if (subId) {
        liveController.remove(subId);
        notify();
      }
    },

    retry(sourceOrSubscriptionId: string): LiveSearchRetryOutcome {
      if (disposed) {
        return { success: false, error: '控制器已釋放' };
      }
      if (typeof sourceOrSubscriptionId !== 'string' || !sourceOrSubscriptionId.trim()) {
        return { success: false, error: '請提供有效的搜尋來源或訂閱 ID' };
      }
      const subId = resolveSubscriptionId(sourceOrSubscriptionId);
      if (!subId) {
        return { success: false, error: '找不到對應的連線訂閱' };
      }
      return liveController.retry(subId);
    },

    removeCustom(sourceId: string): boolean {
      if (disposed || typeof sourceId !== 'string') return false;
      const trimmed = sourceId.trim();
      const idx = customSources.findIndex((c) => c.id === trimmed);
      if (idx === -1) return false;
      const removed = customSources[idx];
      const activeSub = findActiveSubByCanonicalKey(removed.canonicalKey);
      if (activeSub) {
        liveController.remove(activeSub.id);
      }
      customSources.splice(idx, 1);
      sessionEntriesByKey.delete(removed.canonicalKey);
      if (
        resumeStore &&
        latestResumeIdentities.some((id) => getResumeCanonicalKey(id) === removed.canonicalKey)
      ) {
        void resumeStore.removeIdentities([removed.canonicalKey]);
      }
      notify();
      return true;
    },

    removeSessionConnection(sourceOrSubscriptionId: string): boolean {
      return removeSessionConnectionInternal(sourceOrSubscriptionId);
    },

    async removePreviousConnection(sourceIdOrCanonicalKey: string): Promise<boolean> {
      if (disposed || typeof sourceIdOrCanonicalKey !== 'string') return false;
      const trimmed = sourceIdOrCanonicalKey.trim();
      if (!trimmed) return false;
      const canonicalKey = resolveCanonicalKeyBySourceId(trimmed) ?? trimmed;
      baselineResumeByKey.delete(canonicalKey);
      latestResumeIdentities = latestResumeIdentities.filter(
        (id) => getResumeCanonicalKey(id) !== canonicalKey,
      );
      let storeRemoved = true;
      if (resumeStore) {
        storeRemoved = await resumeStore.removeIdentities([canonicalKey]);
      }
      notify();
      return storeRemoved;
    },

    async restoreAllPreviousConnections(): Promise<LiveSearchBatchOutcome> {
      const snap = buildSnapshot();
      const ids = (snap.previousConnections ?? []).map((item) => item.id);
      return enableManySources(ids);
    },

    async clearPreviousConnections(): Promise<boolean> {
      if (disposed) return false;
      const currentLeagueNorm = (selectedLeague || '').trim().toLowerCase();
      const isMatchingSelectedLeague = (league: string | undefined) => {
        if (!currentLeagueNorm) return true;
        return (league || '').trim().toLowerCase() === currentLeagueNorm;
      };

      const keysToRemove: string[] = [];
      for (const [key, entry] of Array.from(baselineResumeByKey.entries())) {
        if (!sessionEntriesByKey.has(key) && isMatchingSelectedLeague(entry.league)) {
          baselineResumeByKey.delete(key);
          keysToRemove.push(key);
        }
      }
      for (const id of latestResumeIdentities) {
        const key = getResumeCanonicalKey(id);
        if (
          !sessionEntriesByKey.has(key) &&
          isMatchingSelectedLeague(id.league) &&
          !keysToRemove.includes(key)
        ) {
          keysToRemove.push(key);
        }
      }
      const removeKeySet = new Set(keysToRemove);
      latestResumeIdentities = latestResumeIdentities.filter(
        (id) => !removeKeySet.has(getResumeCanonicalKey(id)),
      );
      let cleared = true;
      if (resumeStore && keysToRemove.length > 0) {
        cleared = await resumeStore.removeIdentities(keysToRemove);
      }
      notify();
      return cleared;
    },

    switchLeague(targetLeague: string): Promise<boolean> {
      return switchLeague(targetLeague);
    },

    getSelectedLeague(): string {
      return selectedLeague || 'Standard';
    },

    getAvailableLeagues(): readonly string[] {
      return getAvailableLeagues();
    },

    resumeStore,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      isSwitchingLeague = false;
      pendingTargetLeague = null;
      activeGeneration++;
      unsubSource?.();
      unsubSource = null;
      unsubLive?.();
      unsubLive = null;
      unsubPreferences?.();
      unsubPreferences = null;
      unsubResumeStore?.();
      unsubResumeStore = null;
      listeners.clear();
      pendingSearchKeys.clear();
      customSources.length = 0;
      sessionEntriesByKey.clear();
      baselineResumeByKey.clear();
      reloadDrainPromise = null;
    },
  };
}

export const createLiveSearchBookmarkController = createLiveSearchSourceController;
