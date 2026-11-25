import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import { resolveBookmarkUrl } from '@/utils/bookmark-target';
import { t } from '@/utils/i18n';
import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradeSearchCanonicalKey,
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
} from '@/utils/live-search-contract';
import type { LiveSearchResumeIdentity } from '@/utils/live-search-resume-store';
import { createTradeSearchCriteriaKeyResolver } from '@/utils/trade-search-criteria-key';
import { createConnectionDedup, hasValidCover, shouldAdoptExisting } from './connection-dedup';
import { createLiveSearchConnectionRegistry } from './connection-registry';
import { createLiveSearchLeagueManager } from './league-manager';
import { buildLiveSearchSourceSnapshot } from './snapshot-builder';
import {
  evaluateLiveSearchSourceCompatibility,
  extractSectionSourceCanonicalKey,
  formatLiveSearchDisplayLeague,
  formatLiveSearchDisplayVersion,
  getBookmarkCanonicalKey,
  sameLeague,
} from './source-filters';
import type {
  CriteriaRedirect,
  LiveSearchBatchIncompatibleBreakdown,
  LiveSearchBatchOutcome,
  LiveSearchBatchSkipCounts,
  LiveSearchBookmarkSourcePort,
  LiveSearchPrimaryContext,
  LiveSearchSourceController,
  LiveSearchSourceControllerOptions,
  LiveSearchSourceSnapshot,
} from './types';

interface EnableSourceOptions {
  /** 跳過「相同搜尋條件」轉向（由轉向後或已完成去重之入口使用，避免循環）。 */
  skipCriteriaRedirect?: boolean;
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

function createBatchOutcome(
  overrides: Partial<LiveSearchBatchOutcome> & {
    success: boolean;
    requested: number;
  },
): LiveSearchBatchOutcome {
  const defaults = createEmptyBatchCounters();
  return {
    succeeded: 0,
    skipped: 0,
    failed: 0,
    runtimeFailureCount: 0,
    skipReasons: defaults.skipReasons,
    incompatibleBreakdown: defaults.incompatibleBreakdown,
    ...overrides,
  };
}

/**
 * Unified LiveSearch Source Engine（深模組）
 *
 * 統一封裝書籤集合重載（reload drain）、單筆與批次來源啟用／停止、
 * 暫時搜尋建立、一般頁背景派送接收（嚴格序列鏈）與過期聯盟切換守衛。
 */
export function createLiveSearchSourceController(
  source: LiveSearchBookmarkSourcePort | null | undefined,
  liveController: LiveSearchPrimaryController,
  options?: LiveSearchSourceControllerOptions,
): LiveSearchSourceController {
  const resumeStore = options?.resumeStore ?? null;
  const preferences = options?.preferences ?? null;
  const origin = options?.origin;
  const listeners = new Set<(snapshot: Readonly<LiveSearchSourceSnapshot>) => void>();
  const registry = createLiveSearchConnectionRegistry({ origin });

  const initialLiveSnapshot = liveController.read?.();
  let currentGameVersion: PoeVersion = initialLiveSnapshot?.gameVersion ?? 'poe1';
  let currentRuntimeLeague: string | null = initialLiveSnapshot?.runtimeLeague ?? null;
  let currentLiveSubscriptions: Readonly<LiveSearchSubscription>[] =
    initialLiveSnapshot?.subscriptions ?? [];
  let disposed = false;

  // 書籤集合重載與 reload drain 狀態
  let currentCollection: BookmarkCollectionView | null = source
    ? null
    : { groups: [], bookmarks: [] };
  let rawCollection: BookmarkCollectionView | null = currentCollection;
  let loading = Boolean(source);
  let errorMessage: string | undefined;
  let isReloading = false;
  let hasPendingReload = false;
  let activeReloadGeneration = 0;
  let reloadDrainPromise: Promise<void> | null = null;

  let unsubSource: (() => void) | null = null;
  let unsubLive: (() => void) | null = null;
  let unsubResumeStore: (() => void) | null = null;

  let criteriaResolutionPending = false;
  let lastPreviousConnectionsSignature = '';
  let enqueueIncomingChain: Promise<unknown> = Promise.resolve();

  function isReloadPending(): boolean {
    return isReloading || hasPendingReload;
  }

  function syncResolvedCollection(): void {
    if (!rawCollection) {
      currentCollection = rawCollection;
      return;
    }
    const context = {
      origin,
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

  async function runReloadLoop(): Promise<void> {
    if (!source) return;
    try {
      while (!disposed) {
        hasPendingReload = false;
        const generation = ++activeReloadGeneration;

        let outcome: BookmarkReadOutcome<BookmarkCollectionView>;
        try {
          outcome = await source.readCollection();
        } catch (err) {
          if (disposed || generation !== activeReloadGeneration) return;
          if (hasPendingReload) continue;
          errorMessage =
            err instanceof Error ? err.message : t('liveSearch.error.readBookmarksFailed');
          loading = false;
          notify();
          break;
        }

        if (disposed || generation !== activeReloadGeneration) return;
        if (hasPendingReload) continue;

        if (!outcome.ok) {
          errorMessage = outcome.error.message;
        } else {
          errorMessage = undefined;
          rawCollection = outcome.value;
          syncResolvedCollection();
          if (currentCollection) {
            reconcileSourceOwnership();
            const currentSelectedLeague = leagueManager.getRawSelectedLeague();
            if (resumeStore && currentSelectedLeague) {
              const validKeys = new Set<string>();
              for (const b of currentCollection.bookmarks) {
                const key = getBookmarkCanonicalKey(b);
                if (key) validKeys.add(key);
              }
              registry.pruneBaselineForLeague(validKeys, currentSelectedLeague);
              void resumeStore.pruneToAuthoritative(validKeys, { league: currentSelectedLeague });
            }
          }
        }

        loading = false;

        if (!leagueManager.isResolved()) {
          await leagueManager.resolveInitialLeague();
        }

        notify();
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

  async function waitForReloadDrain(): Promise<void> {
    while (!disposed && (isReloading || hasPendingReload)) {
      if (!reloadDrainPromise) {
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

  const leagueManager = createLiveSearchLeagueManager({
    hasSource: Boolean(source),
    isDisposed: () => disposed,
    isLoading: () => loading,
    isReloadPending,
    waitForReloadDrain,
    getGameVersion: () => currentGameVersion,
    getCurrentCollection: () => currentCollection,
    getTemporarySearches: () => registry.getTemporarySearches(),
    getLatestResumeIdentities: () => registry.getLatestResumeIdentities(),
    onSelectedLeagueChanged: () => {
      syncResolvedCollection();
    },
    notify,
    liveController,
    preferences,
    resumeStore,
    initialLeague: options?.initialLeague,
    fetchLeagues: options?.fetchLeagues,
    canFetchOfficialLeagues: options?.canFetchOfficialLeagues,
  });

  const connectionDedup = createConnectionDedup({
    resolver: options?.criteriaKeyResolver ?? createTradeSearchCriteriaKeyResolver(),
    listSessionEntries: () => registry.listSessionDedupEntries(currentLiveSubscriptions),
    listPreviousEntries: () =>
      registry.listPreviousDedupEntries(
        currentGameVersion,
        currentCollection,
        findActiveSubByCanonicalKey,
      ),
  });

  registry.syncActiveSubscriptions(currentLiveSubscriptions, currentCollection);

  if (resumeStore) {
    unsubResumeStore = resumeStore.subscribe((plan) => {
      registry.applyResumePlanSnapshot(plan.identities);
      if (!disposed) notify();
    });
    void resumeStore.read().then((res) => {
      if (res.ok && !disposed) {
        registry.applyInitialResumeRead(res.value.identities);
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
      if (key === canonicalKey) return sub;
    }
    return undefined;
  }

  function resolveSubscriptionId(sourceOrSubscriptionId: string): string | undefined {
    const trimmed = sourceOrSubscriptionId.trim();
    if (!trimmed) return undefined;

    const directSub = currentLiveSubscriptions.find(
      (s) => s.id === trimmed && s.status !== 'closed',
    );
    if (directSub) return directSub.id;

    const canonicalKey = registry.resolveCanonicalKeyBySourceId(trimmed, currentCollection);
    if (!canonicalKey) return undefined;
    return findActiveSubByCanonicalKey(canonicalKey)?.id;
  }

  function ensureReady(): Promise<void> | undefined {
    if (!leagueManager.isResolved() || (source && isReloadPending())) {
      return (async () => {
        if (!leagueManager.isResolved()) {
          await leagueManager.ensureStartupResolved();
        }
        if (source && isReloadPending()) {
          await waitForReloadDrain();
        }
      })();
    }
    return undefined;
  }

  /** 共用過期聯盟切換守衛（單筆啟用與批次執行共用唯一權威判斷） */
  function isLeagueTransitionStale(opGeneration: number, opLeague: string): boolean {
    return (
      leagueManager.getTransitionGeneration() !== opGeneration ||
      leagueManager.isSwitching() ||
      leagueManager.getRawSelectedLeague() !== opLeague
    );
  }

  /** 若並發聯盟切換已發生，回滾剛建立的過期訂閱，避免殘留孤兒連線 */
  function rollbackStaleSubscription(canonicalKey: string): void {
    const sub = findActiveSubByCanonicalKey(canonicalKey);
    if (sub) {
      liveController.remove(sub.id);
    } else {
      void liveController.teardownAll();
    }
  }

  function scheduleCriteriaResolution(identities: readonly ParsedTradeSearchIdentity[]): void {
    if (criteriaResolutionPending || disposed) return;
    criteriaResolutionPending = true;
    void connectionDedup.resolveMany(identities).finally(() => {
      criteriaResolutionPending = false;
      if (disposed) return;
      const before = lastPreviousConnectionsSignature;
      buildSnapshot();
      if (lastPreviousConnectionsSignature !== before) notify();
    });
  }

  async function resolveCriteriaRedirect(
    identity: ParsedTradeSearchIdentity,
    canonicalKey: string,
    incomingCover: string | undefined,
  ): Promise<CriteriaRedirect | null> {
    const match = await connectionDedup.findEquivalent(identity, canonicalKey);
    if (!match) return null;
    if (match.section === 'session') {
      if (match.sameKey) return null;
      registry.patchSessionCover(match.entry.key, incomingCover);
      if (findActiveSubByCanonicalKey(match.entry.key)) {
        notify();
        return { kind: 'error', error: t('liveSearch.error.sameCriteriaActive') };
      }
      return {
        kind: 'source',
        sourceId: registry.sourceIdForDedupEntry(match.entry, 'session', currentCollection),
      };
    }
    if (shouldAdoptExisting(incomingCover, match.entry.coverImageUrl)) {
      return match.sameKey
        ? { kind: 'adopt-meta', entry: match.entry }
        : {
            kind: 'source',
            sourceId: registry.sourceIdForDedupEntry(match.entry, 'previous', currentCollection),
          };
    }
    if (!match.sameKey) {
      const wasPersisted = registry.forgetPrevious(match.entry.key);
      if (resumeStore && wasPersisted) {
        await resumeStore.removeIdentities([match.entry.key]);
      }
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
      temporarySearches: registry.getTemporarySearches(),
      sessionEntriesByKey: registry.getSessionEntries(),
      pendingSearchKeys: registry.getPendingSearchKeys(),
      combinedResumeMap: registry.buildCombinedResumeMap(),
      peekCriteriaKey: (identity) => connectionDedup.peekCriteriaKey(identity),
      origin,
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
    registry.syncActiveSubscriptions(currentLiveSubscriptions, currentCollection);
    if (source && !currentCollection) return;

    const promotedResumeIdentities = registry.reconcileOwnership(
      currentCollection,
      currentLiveSubscriptions,
      findActiveSubByCanonicalKey,
    );
    if (resumeStore && promotedResumeIdentities.length > 0) {
      for (const identity of promotedResumeIdentities) {
        void resumeStore.addIdentities([identity]);
      }
    }
  }

  async function enableSource(
    sourceId: string,
    enableOptions?: EnableSourceOptions,
  ): Promise<AddSubscriptionOutcome> {
    const allowRedirect = !enableOptions?.skipCriteriaRedirect;
    if (disposed) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    const ready = ensureReady();
    if (ready) await ready;

    if (disposed) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }
    if (leagueManager.isSwitching()) {
      return { success: false, error: t('liveSearch.error.switchingLeague') };
    }

    const opGeneration = leagueManager.getTransitionGeneration();
    const opLeague = leagueManager.getRawSelectedLeague();

    if (!sourceId || typeof sourceId !== 'string') {
      return { success: false, error: t('liveSearch.error.invalidBookmarkId') };
    }

    const trimmedId = sourceId.trim();

    // 0. 支援從「上次連線」(prev_*) 或「本次連線」(session_*) 直接啟用非書籤來源
    const targetKey = extractSectionSourceCanonicalKey(trimmedId);
    if (targetKey) {
      const existingTemporarySearch = registry.ensureTemporarySearchForSectionKey(
        targetKey,
        opLeague,
      );
      if (existingTemporarySearch) {
        return enableSource(existingTemporarySearch.id, enableOptions);
      }
    }

    // 1. Temporary Search Source
    const custom = registry.findTemporarySearchById(trimmedId);
    if (custom) {
      const compat = evaluateLiveSearchSourceCompatibility(
        custom.canonicalIdentity,
        getPrimaryContext(),
      );
      if (compat.compatibility !== 'compatible') {
        return {
          success: false,
          error: compat.compatibilityMessage || t('liveSearch.error.incompatible'),
        };
      }

      if (!sameLeague(custom.canonicalIdentity.league, opLeague)) {
        return {
          success: false,
          error: t('liveSearch.error.selectedLeagueMismatch', {
            searchLeague: formatLiveSearchDisplayLeague(custom.canonicalIdentity.league),
            consoleLeague: formatLiveSearchDisplayLeague(opLeague),
          }),
        };
      }

      if (registry.isPending(custom.canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyStarting') };
      }
      if (findActiveSubByCanonicalKey(custom.canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyActive') };
      }

      if (allowRedirect) {
        const redirect = await resolveCriteriaRedirect(
          custom.canonicalIdentity,
          custom.canonicalKey,
          custom.coverImageUrl,
        );
        if (redirect?.kind === 'error') return { success: false, error: redirect.error };
        if (redirect?.kind === 'source') {
          return enableSource(redirect.sourceId, { skipCriteriaRedirect: true });
        }
        if (redirect?.kind === 'adopt-meta') {
          registry.patchTemporarySearch(custom.id, {
            coverImageUrl: redirect.entry.coverImageUrl,
            name: redirect.entry.name,
          });
        }
        if (registry.isPending(custom.canonicalKey)) {
          return { success: false, error: t('liveSearch.error.alreadyStarting') };
        }
        if (findActiveSubByCanonicalKey(custom.canonicalKey)) {
          return { success: false, error: t('liveSearch.error.alreadyActive') };
        }
      }

      registry.registerSessionEntry({
        canonicalKey: custom.canonicalKey,
        canonicalIdentity: custom.canonicalIdentity,
        name: custom.name,
        url: custom.url,
        coverImageUrl: custom.coverImageUrl,
      });
      registry.markPending(custom.canonicalKey);
      notify();

      try {
        if (isLeagueTransitionStale(opGeneration, opLeague)) {
          return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
        }
        const outcome = await liveController.addFromUrl(custom.url, { name: custom.name });
        if (isLeagueTransitionStale(opGeneration, opLeague)) {
          if (outcome.success) rollbackStaleSubscription(custom.canonicalKey);
          return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
        }
        if (outcome.success && resumeStore) {
          await resumeStore.addIdentities([
            {
              gameVersion: custom.canonicalIdentity.gameVersion,
              league: custom.canonicalIdentity.league,
              searchId: custom.canonicalIdentity.searchId,
              name:
                custom.name ||
                t('liveSearch.defaultSearchNameWithId', { id: custom.canonicalIdentity.searchId }),
              url: custom.url,
              ...(custom.coverImageUrl ? { coverImageUrl: custom.coverImageUrl } : {}),
            },
          ]);
        }
        return outcome;
      } finally {
        registry.clearPending(custom.canonicalKey);
        notify();
      }
    }

    // 2. Bookmark Source
    if (isReloadPending()) {
      await waitForReloadDrain();
    }

    if (disposed) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }
    if (isLeagueTransitionStale(opGeneration, opLeague)) {
      return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
    }

    if (!currentCollection) {
      return { success: false, error: t('liveSearch.error.bookmarksNotReady') };
    }

    const bookmark = currentCollection.bookmarks.find((b) => b.id === trimmedId);
    if (!bookmark) {
      return { success: false, error: t('liveSearch.error.bookmarkNotFound') };
    }

    const bookmarkUrl = stripLiveSuffix(bookmark.url);
    const parsed = parseTradeSearchUrl(bookmarkUrl);
    if (!parsed) {
      return { success: false, error: t('liveSearch.error.bookmarkInvalidUrl') };
    }

    const compat = evaluateLiveSearchSourceCompatibility(parsed, getPrimaryContext(), bookmarkUrl);
    if (compat.compatibility !== 'compatible') {
      return {
        success: false,
        error: compat.compatibilityMessage || t('liveSearch.error.incompatible'),
      };
    }

    if (!sameLeague(parsed.league, opLeague)) {
      return {
        success: false,
        error: t('liveSearch.error.selectedLeagueMismatch', {
          searchLeague: formatLiveSearchDisplayLeague(parsed.league),
          consoleLeague: formatLiveSearchDisplayLeague(opLeague),
        }),
      };
    }

    const searchKey = getTradeSearchCanonicalKey(parsed);
    if (registry.isPending(searchKey)) {
      return { success: false, error: t('liveSearch.error.alreadyStarting') };
    }
    if (findActiveSubByCanonicalKey(searchKey)) {
      return { success: false, error: t('liveSearch.error.alreadyActive') };
    }

    let validCoverUrl = hasValidCover(bookmark.coverImageUrl) ? bookmark.coverImageUrl : undefined;

    registry.markPending(searchKey);
    notify();

    if (allowRedirect) {
      const redirect = await resolveCriteriaRedirect(parsed, searchKey, validCoverUrl);
      if (redirect?.kind === 'error' || redirect?.kind === 'source') {
        registry.clearPending(searchKey);
        notify();
        return redirect.kind === 'error'
          ? { success: false, error: redirect.error }
          : enableSource(redirect.sourceId, { skipCriteriaRedirect: true });
      }
      // 同一 search ID：書籤名稱維持優先顯示，只沿用上次連線的封面
      if (redirect?.kind === 'adopt-meta') validCoverUrl = redirect.entry.coverImageUrl;
    }

    try {
      if (isLeagueTransitionStale(opGeneration, opLeague)) {
        return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
      }
      const outcome = await liveController.addFromUrl(bookmark.url, {
        name: bookmark.name,
        sourceBookmarkId: bookmark.id,
      });
      if (isLeagueTransitionStale(opGeneration, opLeague)) {
        if (outcome.success) rollbackStaleSubscription(searchKey);
        return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
      }
      if (outcome.success) {
        registry.registerSessionEntry({
          canonicalKey: searchKey,
          canonicalIdentity: parsed,
          name: bookmark.name,
          url: bookmark.url,
          coverImageUrl: validCoverUrl,
          sourceBookmarkId: bookmark.id,
        });
        if (resumeStore) {
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
      registry.clearPending(searchKey);
      notify();
    }
  }

  async function enableManySources(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome> {
    const { skipReasons, incompatibleBreakdown } = createEmptyBatchCounters();
    const requestedIds = Array.isArray(sourceIds) ? sourceIds : [];
    const requested = requestedIds.length;

    if (disposed) {
      return createBatchOutcome({
        success: false,
        requested,
        failed: requested,
        rejectReason: 'disposed',
        error: t('liveSearch.error.controllerDisposed'),
      });
    }

    if (requested === 0) {
      return createBatchOutcome({ success: true, requested: 0 });
    }

    const ready = ensureReady();
    if (ready) await ready;

    if (disposed) {
      return createBatchOutcome({
        success: false,
        requested,
        failed: requested,
        rejectReason: 'disposed',
        error: t('liveSearch.error.controllerDisposed'),
      });
    }

    if (leagueManager.isSwitching()) {
      return createBatchOutcome({
        success: false,
        requested,
        failed: requested,
        rejectReason: 'not-ready',
        error: t('liveSearch.error.switchingLeague'),
      });
    }

    const opGeneration = leagueManager.getTransitionGeneration();
    const opLeague = leagueManager.getRawSelectedLeague();
    const collectionSnapshot = currentCollection;

    if (!collectionSnapshot && !registry.hasAnyState()) {
      return createBatchOutcome({
        success: false,
        requested,
        failed: requested,
        rejectReason: 'not-ready',
        error: t('liveSearch.error.bookmarksNotReady'),
      });
    }

    const primaryContext = getPrimaryContext();

    // 尚未鎖定聯盟時之 Mixed-League Atomic Preflight across requested items
    if (!primaryContext.runtimeLeague) {
      const distinctBatchLeagues: string[] = [];
      for (const rawId of requestedIds) {
        const sourceId = typeof rawId === 'string' ? rawId.trim() : '';
        if (!sourceId) continue;
        const info = registry.resolveCandidateInfo(sourceId, collectionSnapshot);
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
          .join(t('liveSearch.listJoinAnd'));
        return {
          success: false,
          requested,
          succeeded: 0,
          skipped: 0,
          failed: requested,
          rejectReason: 'mixed-league',
          involvedLeagues: distinctBatchLeagues,
          error: t('liveSearch.error.mixedLeaguesEnable', { leagues: formattedLeagues }),
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

      const info = registry.resolveCandidateInfo(sourceId, collectionSnapshot);
      if (!info.exists) {
        skipped += 1;
        skipReasons.notFound += 1;
        continue;
      }

      const parsed = info.parsed;
      if (parsed && !sameLeague(parsed.league, opLeague)) {
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

      if (registry.isPending(canonicalKey)) {
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
      eligibleCandidates.push({ sourceId, parsed, canonicalKey });
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
        const formattedLeagues = distinctLeagues
          .map(formatLiveSearchDisplayLeague)
          .join(t('liveSearch.listJoinAnd'));
        return {
          success: false,
          requested,
          succeeded: 0,
          skipped,
          failed: eligibleCandidates.length,
          rejectReason: 'mixed-league',
          involvedLeagues: distinctLeagues,
          error: t('liveSearch.error.mixedLeaguesEnable', { leagues: formattedLeagues }),
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
      if (isLeagueTransitionStale(opGeneration, opLeague)) {
        failed += eligibleCandidates.length - succeeded;
        lastError = t('liveSearch.error.leagueSwitchedBatchAborted');
        break;
      }
      const outcome = await enableSource(candidate.sourceId);
      if (isLeagueTransitionStale(opGeneration, opLeague)) {
        failed += eligibleCandidates.length - succeeded;
        lastError = t('liveSearch.error.leagueSwitchedBatchAborted');
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
      return createBatchOutcome({
        success: false,
        requested,
        failed: requested,
        rejectReason: 'disposed',
        error: t('liveSearch.error.controllerDisposed'),
      });
    }

    if (requested === 0) {
      return createBatchOutcome({ success: true, requested: 0 });
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
        const canonicalKey = registry.resolveCanonicalKeyBySourceId(sourceId, currentCollection);
        const exists =
          (canonicalKey !== null && registry.hasSessionEntry(canonicalKey)) ||
          Boolean(registry.findTemporarySearchById(sourceId)) ||
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

  function runEnqueueIncoming<T>(task: () => Promise<T>): Promise<T> {
    const next = enqueueIncomingChain.then(task, task);
    enqueueIncomingChain = next.catch(() => {});
    return next;
  }

  async function addTemporarySearch(
    url: string,
    addOptions?: { name?: string; coverImageUrl?: string },
  ): Promise<AddSubscriptionOutcome> {
    if (disposed) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    const ready = ensureReady();
    if (ready) await ready;

    if (disposed) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }
    if (leagueManager.isSwitching()) {
      return { success: false, error: t('liveSearch.error.switchingLeague') };
    }

    if (typeof url !== 'string' || !url.trim()) {
      return { success: false, error: t('liveSearch.error.invalidUrlRequired') };
    }

    const cleanUrl = stripLiveSuffix(url.trim());
    const parsed = parseTradeSearchUrl(cleanUrl);
    if (!parsed) {
      return { success: false, error: t('liveSearch.error.invalidUrlFormat') };
    }

    if (parsed.gameVersion !== currentGameVersion) {
      return {
        success: false,
        error: t('liveSearch.error.wrongVersion', {
          searchVersion: formatLiveSearchDisplayVersion(parsed.gameVersion),
          consoleVersion: formatLiveSearchDisplayVersion(currentGameVersion),
        }),
      };
    }

    const selectedLeague = leagueManager.getRawSelectedLeague();
    if (!sameLeague(parsed.league, selectedLeague)) {
      return {
        success: false,
        error: t('liveSearch.error.selectedLeagueMismatchSwitchFirst', {
          searchLeague: formatLiveSearchDisplayLeague(parsed.league),
          consoleLeague: formatLiveSearchDisplayLeague(selectedLeague),
        }),
      };
    }

    const canonicalKey = getTradeSearchCanonicalKey(parsed);
    let trimmedName = addOptions?.name?.trim() ?? '';
    let incomingCover = hasValidCover(addOptions?.coverImageUrl)
      ? addOptions?.coverImageUrl
      : undefined;

    // 相同搜尋條件只能有一筆：須在登記本次連線之前決定沿用哪一筆
    const redirect = await resolveCriteriaRedirect(parsed, canonicalKey, incomingCover);
    if (redirect?.kind === 'error') return { success: false, error: redirect.error };
    if (redirect?.kind === 'source') {
      return enableSource(redirect.sourceId, { skipCriteriaRedirect: true });
    }
    if (redirect?.kind === 'adopt-meta') {
      incomingCover = redirect.entry.coverImageUrl;
      trimmedName = redirect.entry.name?.trim() || trimmedName;
    }
    // 未提供名稱時以搜尋代碼（search ID）命名，確保可辨識、可搜尋、可篩選結果
    const displayName = trimmedName || parsed.searchId;

    const existingBookmark = currentCollection?.bookmarks.find(
      (b) => getBookmarkCanonicalKey(b) === canonicalKey,
    );

    if (existingBookmark) {
      registry.removeTemporarySearchByCanonicalKey(canonicalKey);
      if (findActiveSubByCanonicalKey(canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyActive') };
      }
      return await enableSource(existingBookmark.id);
    }

    const temporarySearch = registry.upsertTemporarySearch({
      canonicalKey,
      canonicalIdentity: parsed,
      name: displayName,
      url: cleanUrl,
      coverImageUrl: incomingCover,
      preserveExistingName: !trimmedName,
      clearProvenance: true,
    });

    registry.registerSessionEntry({
      canonicalKey,
      canonicalIdentity: parsed,
      name:
        temporarySearch.name || t('liveSearch.defaultSearchNameWithId', { id: parsed.searchId }),
      url: cleanUrl,
      coverImageUrl: temporarySearch.coverImageUrl,
    });

    notify();
    return await enableSource(temporarySearch.id, { skipCriteriaRedirect: true });
  }

  function enqueueIncomingConnections(
    items: readonly LiveSearchEnqueueItem[],
  ): Promise<LiveSearchEnqueueResponse> {
    return runEnqueueIncoming(async () => {
      if (disposed) {
        return { success: false, error: t('liveSearch.console.closed'), rejectReason: 'failed' };
      }

      const ready = ensureReady();
      if (ready) await ready;

      if (disposed) {
        return { success: false, error: t('liveSearch.console.closed'), rejectReason: 'failed' };
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
        if (!parsed || isLegacyTradeSearchUrl(cleanUrl)) continue;
        const canonicalKey = getTradeSearchCanonicalKey(parsed);
        if (seenIncomingKeys.has(canonicalKey)) {
          duplicateIncomingSkipped++;
          continue;
        }
        seenIncomingKeys.add(canonicalKey);
        parsedCandidates.push({ item, cleanUrl, parsed, canonicalKey });
      }

      if (parsedCandidates.length === 0) {
        return {
          success: false,
          error: t('liveSearch.error.invalidUrlShort'),
          rejectReason: 'invalid-url',
        };
      }

      const wrongVersionItem = parsedCandidates.find(
        (c) => c.parsed.gameVersion !== currentGameVersion,
      );
      if (wrongVersionItem) {
        return {
          success: false,
          error: t('liveSearch.error.wrongVersion', {
            searchVersion: formatLiveSearchDisplayVersion(wrongVersionItem.parsed.gameVersion),
            consoleVersion: formatLiveSearchDisplayVersion(currentGameVersion),
          }),
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
        const formatted = distinctLeagues
          .map(formatLiveSearchDisplayLeague)
          .join(t('liveSearch.listJoinAnd'));
        return {
          success: false,
          error: t('liveSearch.error.mixedLeaguesEnqueue', { leagues: formatted }),
          rejectReason: 'mixed-league',
        };
      }

      const incomingLeague = parsedCandidates[0].parsed.league.trim();
      const primaryContext = getPrimaryContext();

      if (
        primaryContext.runtimeLeague &&
        !sameLeague(primaryContext.runtimeLeague, incomingLeague)
      ) {
        return {
          success: false,
          error: t('liveSearch.error.activeLeagueConflict', {
            consoleLeague: formatLiveSearchDisplayLeague(primaryContext.runtimeLeague),
            incomingLeague: formatLiveSearchDisplayLeague(incomingLeague),
          }),
          rejectReason: 'wrong-league',
        };
      }

      if (
        !primaryContext.runtimeLeague &&
        !sameLeague(leagueManager.getRawSelectedLeague(), incomingLeague)
      ) {
        const switched = await leagueManager.switchLeague(incomingLeague);
        if (!switched) {
          return {
            success: false,
            error: t('liveSearch.error.switchLeagueFailed', {
              league: formatLiveSearchDisplayLeague(incomingLeague),
            }),
            rejectReason: 'failed',
          };
        }
      }

      const sourceIdsToEnable: string[] = [];
      const resumeEntriesToPersist: LiveSearchResumeIdentity[] = [];

      for (const candidate of parsedCandidates) {
        // 迴圈內會 await 條件解析，書籤集合可能在期間重新載入，每輪都要讀最新集合
        const existingBookmark =
          (candidate.item.sourceBookmarkId
            ? currentCollection?.bookmarks.find(
                (b) =>
                  b.id === candidate.item.sourceBookmarkId &&
                  getBookmarkCanonicalKey(b) === candidate.canonicalKey,
              )
            : undefined) ??
          currentCollection?.bookmarks.find(
            (b) => getBookmarkCanonicalKey(b) === candidate.canonicalKey,
          );

        let validCover = hasValidCover(candidate.item.coverImageUrl)
          ? candidate.item.coverImageUrl
          : hasValidCover(existingBookmark?.coverImageUrl)
            ? existingBookmark.coverImageUrl
            : undefined;
        let resolvedName =
          candidate.item.name?.trim() ||
          existingBookmark?.name ||
          t('liveSearch.defaultSearchNameWithId', { id: candidate.parsed.searchId });

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
          registry.registerSessionEntry({
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
          const temporarySearch = registry.upsertTemporarySearch({
            canonicalKey: candidate.canonicalKey,
            canonicalIdentity: candidate.parsed,
            name: resolvedName,
            url: candidate.cleanUrl,
            coverImageUrl: validCover,
          });
          registry.registerSessionEntry({
            canonicalKey: candidate.canonicalKey,
            canonicalIdentity: candidate.parsed,
            name: resolvedName,
            url: candidate.cleanUrl,
            coverImageUrl: validCover,
          });
          sourceIdsToEnable.push(temporarySearch.id);
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
    });
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

  return {
    read: () => buildSnapshot(),

    subscribe(listener) {
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

    enable: (sourceId) => enableSource(sourceId),
    enableMany: enableManySources,
    stopMany: stopManySources,
    addTemporarySearch,
    enqueueIncomingConnections,

    stop(sourceOrSubscriptionId) {
      if (disposed || typeof sourceOrSubscriptionId !== 'string') return;
      const subId = resolveSubscriptionId(sourceOrSubscriptionId);
      if (subId) {
        liveController.remove(subId);
        notify();
      }
    },

    retry(sourceOrSubscriptionId): LiveSearchRetryOutcome {
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

    removeTemporarySearch(sourceId) {
      if (disposed || typeof sourceId !== 'string') return false;
      const outcome = registry.removeTemporarySearchById(sourceId.trim());
      if (!outcome) return false;
      const activeSub = findActiveSubByCanonicalKey(outcome.removed.canonicalKey);
      if (activeSub) liveController.remove(activeSub.id);
      if (resumeStore && outcome.wasPersistedInResume) {
        void resumeStore.removeIdentities([outcome.removed.canonicalKey]);
      }
      notify();
      return true;
    },

    removeSessionConnection(sourceOrSubscriptionId) {
      if (disposed || typeof sourceOrSubscriptionId !== 'string') return false;
      const trimmed = sourceOrSubscriptionId.trim();
      if (!trimmed) return false;

      const canonicalKey = registry.resolveCanonicalKeyBySourceId(trimmed, currentCollection);
      const activeSubId = resolveSubscriptionId(trimmed);
      const result = registry.removeSessionConnection(trimmed, canonicalKey);
      if (!result.hadLocalState && !activeSubId) return false;

      if (canonicalKey && resumeStore && result.wasPersistedInResume) {
        void resumeStore.removeIdentities([canonicalKey]);
      }
      if (activeSubId) liveController.remove(activeSubId);
      notify();
      return true;
    },

    async removePreviousConnection(sourceIdOrCanonicalKey) {
      if (disposed || typeof sourceIdOrCanonicalKey !== 'string') return false;
      const trimmed = sourceIdOrCanonicalKey.trim();
      if (!trimmed) return false;
      const canonicalKey =
        registry.resolveCanonicalKeyBySourceId(trimmed, currentCollection) ?? trimmed;
      registry.forgetPrevious(canonicalKey);
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

    async clearPreviousConnections() {
      if (disposed) return false;
      const keysToRemove = registry.clearPreviousForLeague(leagueManager.getRawSelectedLeague());
      let cleared = true;
      if (resumeStore && keysToRemove.length > 0) {
        cleared = await resumeStore.removeIdentities(keysToRemove);
      }
      notify();
      return cleared;
    },

    switchLeague: (targetLeague) => leagueManager.switchLeague(targetLeague),
    getSelectedLeague: () => leagueManager.getSelectedLeague(),
    getAvailableLeagues: () => leagueManager.getAvailableLeagues(),
    resumeStore,

    dispose() {
      if (disposed) return;
      disposed = true;
      activeReloadGeneration++;
      reloadDrainPromise = null;
      leagueManager.dispose();
      unsubSource?.();
      unsubSource = null;
      unsubLive?.();
      unsubLive = null;
      unsubResumeStore?.();
      unsubResumeStore = null;
      listeners.clear();
      registry.clear();
    },
  };
}
