import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import { t } from '@/utils/i18n';
import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradeSearchCanonicalKey,
  type ParsedTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import type {
  LiveSearchPrimaryController,
  LiveSearchRetryOutcome,
  LiveSearchSubscription,
} from '@/utils/live-search-contract';
import {
  getResumeCanonicalKey,
  type LiveSearchResumeIdentity,
} from '@/utils/live-search-resume-store';
import { readBookmarkTargetContext, resolveBookmarkUrl } from '@/utils/bookmark-target';
import { createTradeSearchCriteriaKeyResolver } from '@/utils/trade-search-criteria-key';
import {
  createConnectionDedup,
  hasValidCover,
  shouldAdoptExisting,
  type DedupEntry,
} from './live-search-connection-dedup';
import { createLiveSearchBatchExecutor } from './live-search-batch-executor';
import { createLiveSearchLeagueManager } from './live-search-league-manager';
import {
  buildLiveSearchSourceSnapshot,
  reconcileLiveSearchSourceOwnership,
} from './live-search-snapshot-builder';
import {
  extractSectionSourceCanonicalKey,
  getBookmarkCanonicalKey,
  sameLeague,
} from './live-search-source-filters';
import { createLiveSearchSourceIntake } from './live-search-source-intake';
import {
  PREVIOUS_SOURCE_ID_PREFIX,
  SESSION_SOURCE_ID_PREFIX,
  type CriteriaRedirect,
  type CustomSourceRecord,
  type LiveSearchBatchOutcome,
  type LiveSearchBookmarkSourcePort,
  type LiveSearchControllerBasePort,
  type LiveSearchPrimaryContext,
  type LiveSearchSourceController,
  type LiveSearchSourceControllerOptions,
  type LiveSearchSourceRuntimePort,
  type LiveSearchSourceSnapshot,
  type SessionConnectionMeta,
} from './live-search-source-types';

export {
  CUSTOM_SOURCE_GROUP_ID,
  CUSTOM_SOURCE_GROUP_NAME,
  PREVIOUS_CONNECTIONS_GROUP_ID,
  PREVIOUS_CONNECTIONS_GROUP_NAME,
  SESSION_CONNECTIONS_GROUP_ID,
  SESSION_CONNECTIONS_GROUP_NAME,
  TEMPORARY_SOURCE_GROUP_ID,
  TEMPORARY_SOURCE_GROUP_NAME,
  type LiveSearchBatchIncompatibleBreakdown,
  type LiveSearchBatchOutcome,
  type LiveSearchBatchRejectReason,
  type LiveSearchBatchSkipCounts,
  type LiveSearchBookmarkController,
  type LiveSearchBookmarkGroup,
  type LiveSearchBookmarkItem,
  type LiveSearchBookmarkSnapshot,
  type LiveSearchBookmarkSourcePort,
  type LiveSearchSourceCompatibility,
  type LiveSearchSourceController,
  type LiveSearchSourceControllerOptions,
  type LiveSearchSourceFilterOptions,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
  type LiveSearchSourceKind,
  type LiveSearchSourceProvenance,
  type LiveSearchSourceSnapshot,
  type LiveSearchSourceStatusFilter,
} from './live-search-source-types';

export {
  buildCanonicalTradeSearchUrl,
  evaluateLiveSearchSourceCompatibility,
  filterLiveSearchConnectionItems,
  filterLiveSearchSourceGroups,
  formatLiveSearchDisplayLeague,
  formatLiveSearchDisplayVersion,
  getLiveSearchGroupSubtreeItems,
  getLiveSearchGroupSubtreeSourceIds,
  matchesLiveSearchSourceStatusFilter,
} from './live-search-source-filters';

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
  let rawCollection: BookmarkCollectionView | null = currentCollection;

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
  let unsubResumeStore: (() => void) | null = null;

  let criteriaResolutionPending = false;
  let lastPreviousConnectionsSignature = '';

  const baseRuntimePort: LiveSearchControllerBasePort = {
    hasSource: Boolean(source),
    isDisposed: () => disposed,
    isReloadPending: () => isReloading || hasPendingReload,
    waitForReconciliationDrain,
    getGameVersion: () => currentGameVersion,
    getCurrentCollection: () => currentCollection,
    notify,
  };

  const leagueManager = createLiveSearchLeagueManager({
    runtime: baseRuntimePort,
    initialLeague: options?.initialLeague,
    preferences,
    resumeStore,
    liveController,
    fetchLeagues: options?.fetchLeagues,
    isLoading: () => loading,
    getCustomSources: () => customSources,
    getLatestResumeIdentities: () => latestResumeIdentities,
    onSelectedLeagueChanged: () => {
      syncResolvedCollection();
    },
  });

  const connectionDedup = createConnectionDedup({
    resolver: options?.criteriaKeyResolver ?? createTradeSearchCriteriaKeyResolver(),
    listSessionEntries: listSessionDedupEntries,
    listPreviousEntries: listPreviousDedupEntries,
  });

  function syncResolvedCollection(): void {
    if (!rawCollection) {
      currentCollection = rawCollection;
      return;
    }
    const context = {
      ...readBookmarkTargetContext(),
      league: leagueManager.getRawSelectedLeague() || undefined,
    };
    currentCollection = {
      groups: rawCollection.groups,
      bookmarks: rawCollection.bookmarks.map((bookmark) => ({
        ...bookmark,
        url: resolveBookmarkUrl(bookmark.url, { leaguePinned: bookmark.leaguePinned }, context),
      })),
    };
  }

  function registerSessionEntry(meta: SessionConnectionMeta): void {
    const existing = sessionEntriesByKey.get(meta.canonicalKey);
    sessionEntriesByKey.set(meta.canonicalKey, {
      canonicalKey: meta.canonicalKey,
      canonicalIdentity: { ...meta.canonicalIdentity },
      name: meta.name || existing?.name || t('liveSearch.defaultSearchName'),
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
      const matchingBookmark = currentCollection?.bookmarks.find(
        (b) => getBookmarkCanonicalKey(b) === canonicalKey,
      );
      const validCover = hasValidCover(matchingBookmark?.coverImageUrl)
        ? matchingBookmark.coverImageUrl
        : undefined;
      registerSessionEntry({
        canonicalKey,
        canonicalIdentity,
        name: matchingBookmark?.name || sub.name || t('liveSearch.defaultSearchName'),
        url: matchingBookmark?.url || sub.url,
        coverImageUrl: validCover,
        // 書籤集合已載入卻找不到同 canonicalKey 的書籤時，不得沿用過期的 sub.sourceBookmarkId
        sourceBookmarkId: currentCollection ? matchingBookmark?.id : sub.sourceBookmarkId,
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

  leagueManager.startStartupTasks();

  function getPrimaryContext(): LiveSearchPrimaryContext {
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
    return currentCollection?.bookmarks.find((b) => getBookmarkCanonicalKey(b) === canonicalKey);
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
      currentCollection?.bookmarks.some(
        (b) => b.id === entry.sourceBookmarkId && getBookmarkCanonicalKey(b) === entry.key,
      )
    ) {
      return entry.sourceBookmarkId;
    }
    const custom = customSources.find((c) => c.canonicalKey === entry.key);
    if (custom) return custom.id;
    return section === 'session'
      ? `${SESSION_SOURCE_ID_PREFIX}${entry.key}`
      : `${PREVIOUS_SOURCE_ID_PREFIX}${entry.key}`;
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
        return { kind: 'error', error: t('liveSearch.error.sameCriteriaActive') };
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
    const result = buildLiveSearchSourceSnapshot({
      loading,
      errorMessage,
      isLeagueResolved: leagueManager.isResolved(),
      isSwitchingLeague: leagueManager.isSwitching(),
      selectedLeague: leagueManager.getRawSelectedLeague(),
      availableLeagues: leagueManager.getAvailableLeagues(),
      primaryContext: getPrimaryContext(),
      hasSource: Boolean(source),
      currentCollection,
      currentLiveSubscriptions,
      customSources,
      sessionEntriesByKey,
      pendingSearchKeys,
      combinedResumeMap: buildCombinedResumeMap(),
      peekCriteriaKey: (identity) => connectionDedup.peekCriteriaKey(identity),
    });
    if (result.previousConnectionsSignature !== undefined) {
      lastPreviousConnectionsSignature = result.previousConnectionsSignature;
    }
    if (result.unresolvedCriteriaIdentities.length > 0) {
      scheduleCriteriaResolution(result.unresolvedCriteriaIdentities);
    }
    return result.snapshot;
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

    const promotedResumeIdentities = reconcileLiveSearchSourceOwnership({
      currentCollection,
      currentLiveSubscriptions,
      customSources,
      sessionEntriesByKey,
      findActiveSubByCanonicalKey,
    });
    if (resumeStore && promotedResumeIdentities.length > 0) {
      for (const identity of promotedResumeIdentities) {
        void resumeStore.addIdentities([identity]);
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
          errorMessage =
            err instanceof Error ? err.message : t('liveSearch.error.readBookmarksFailed');
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
          // 書籤網址會依主控台選定聯盟改寫（未釘選聯盟者），Resume Plan 也以改寫後的身分保存；
          // 必須用改寫後的網址比對，否則跨聯盟啟用的書籤連線會在下次載入時被當成已刪除。
          // 聯盟尚未決定前無法改寫，也無法限定聯盟範圍，交給 Resume 控制器在聯盟決定後清理。
          const currentSelectedLeague = leagueManager.getRawSelectedLeague();
          if (resumeStore && currentSelectedLeague && currentCollection) {
            const validKeys = new Set<string>();
            for (const b of currentCollection.bookmarks) {
              const key = getBookmarkCanonicalKey(b);
              if (key) validKeys.add(key);
            }
            for (const [k, v] of baselineResumeByKey.entries()) {
              if (
                !v.url &&
                !v.name &&
                !validKeys.has(k) &&
                sameLeague(v.league, currentSelectedLeague)
              ) {
                baselineResumeByKey.delete(k);
              }
            }
            void resumeStore.pruneToAuthoritative(validKeys, { league: currentSelectedLeague });
          }
        }

        loading = false;

        if (!leagueManager.isResolved()) {
          await leagueManager.resolveInitialLeague();
        }

        notify();
        // A bookmark change may arrive while resolveInitialLeague() is awaited; honour it
        // instead of exiting with hasPendingReload stranded.
        if (hasPendingReload) continue;
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
      if (!reloadDrainPromise) {
        // Never spin on resolved microtasks here: that starves the event loop and freezes
        // the console tab. Restart the reload loop so the pending reload actually drains.
        if (!source) {
          isReloading = false;
          hasPendingReload = false;
          return;
        }
        isReloading = true;
        reloadDrainPromise = runReloadLoop();
      }
      await reloadDrainPromise;
    }
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
      return getBookmarkCanonicalKey(bookmark);
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

  function findResumeEntryByCanonicalKey(
    canonicalKey: string,
  ): LiveSearchResumeIdentity | undefined {
    return (
      latestResumeIdentities.find((id) => getResumeCanonicalKey(id) === canonicalKey) ??
      baselineResumeByKey.get(canonicalKey)
    );
  }

  const sourceRuntimePort: LiveSearchSourceRuntimePort = {
    ...baseRuntimePort,
    isLeagueResolved: () => leagueManager.isResolved(),
    isSwitchingLeague: () => leagueManager.isSwitching(),
    getRawSelectedLeague: () => leagueManager.getRawSelectedLeague(),
    ensureStartupResolved: () => leagueManager.ensureStartupResolved(),
    getPrimaryContext,
    findActiveSubByCanonicalKey,
    resolveCriteriaRedirect,
    registerSessionEntry,
  };

  const batchExecutor = createLiveSearchBatchExecutor({
    runtime: sourceRuntimePort,
    liveController,
    resumeStore,
    connectionDedup,
    customSources,
    sessionEntriesByKey,
    baselineResumeByKey,
    pendingSearchKeys,
    getTransitionGeneration: () => leagueManager.getTransitionGeneration(),
    getCurrentLiveSubscriptions: () => currentLiveSubscriptions,
    findResumeEntryByCanonicalKey,
    resolveCanonicalKeyBySourceId,
    resolveSubscriptionId,
  });

  const sourceIntake = createLiveSearchSourceIntake({
    runtime: sourceRuntimePort,
    resumeStore,
    customSources,
    switchLeague: (targetLeague) => leagueManager.switchLeague(targetLeague),
    enableSource: batchExecutor.enableSource,
    enableManySources: batchExecutor.enableManySources,
  });

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

    enable: (sourceId: string) => batchExecutor.enableSource(sourceId),
    add: (sourceId: string) => batchExecutor.enableSource(sourceId),
    enableMany: batchExecutor.enableManySources,
    stopMany: batchExecutor.stopManySources,
    addCustom: sourceIntake.addCustom,
    enqueueIncomingConnections: sourceIntake.enqueueIncomingConnections,

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
        return { success: false, error: t('liveSearch.error.controllerDisposed') };
      }
      if (typeof sourceOrSubscriptionId !== 'string' || !sourceOrSubscriptionId.trim()) {
        return { success: false, error: t('liveSearch.error.invalidSourceOrSubId') };
      }
      const subId = resolveSubscriptionId(sourceOrSubscriptionId);
      if (!subId) {
        return { success: false, error: t('liveSearch.error.matchingSubNotFound') };
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
      return batchExecutor.enableManySources(ids);
    },

    async clearPreviousConnections(): Promise<boolean> {
      if (disposed) return false;
      const rawSelectedLeague = leagueManager.getRawSelectedLeague();
      const isMatchingSelectedLeague = (league: string | undefined) => {
        if (!rawSelectedLeague.trim()) return true;
        return sameLeague(league, rawSelectedLeague);
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
      return leagueManager.switchLeague(targetLeague);
    },

    getSelectedLeague(): string {
      return leagueManager.getSelectedLeague();
    },

    getAvailableLeagues(): readonly string[] {
      return leagueManager.getAvailableLeagues();
    },

    resumeStore,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      leagueManager.dispose();
      activeGeneration++;
      unsubSource?.();
      unsubSource = null;
      unsubLive?.();
      unsubLive = null;
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
