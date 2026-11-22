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
import { createTradeSearchCriteriaKeyResolver } from '@/utils/trade-search-criteria-key';
import { createLiveSearchBatchExecutor } from './batch-executor';
import { createConnectionDedup, shouldAdoptExisting } from './connection-dedup';
import { createLiveSearchConnectionRegistry } from './connection-registry';
import { createLiveSearchLeagueManager } from './league-manager';
import { createBookmarkReloadCoordinator } from './reload-coordinator';
import { buildLiveSearchSourceSnapshot } from './snapshot-builder';
import { createLiveSearchSourceActivator } from './source-activator';
import { getBookmarkCanonicalKey } from './source-filters';
import { createLiveSearchSourceIntake } from './source-intake';
import type {
  CriteriaRedirect,
  LiveSearchBatchOutcome,
  LiveSearchBookmarkSourcePort,
  LiveSearchControllerBasePort,
  LiveSearchOperationContext,
  LiveSearchPrimaryContext,
  LiveSearchSourceController,
  LiveSearchSourceControllerOptions,
  LiveSearchSourceSnapshot,
} from './types';

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
  const registry = createLiveSearchConnectionRegistry();

  const initialLiveSnapshot = liveController.read?.();
  let currentGameVersion: PoeVersion = initialLiveSnapshot?.gameVersion ?? 'poe1';
  let currentRuntimeLeague: string | null = initialLiveSnapshot?.runtimeLeague ?? null;
  let currentLiveSubscriptions: Readonly<LiveSearchSubscription>[] =
    initialLiveSnapshot?.subscriptions ?? [];
  let disposed = false;

  let unsubSource: (() => void) | null = null;
  let unsubLive: (() => void) | null = null;
  let unsubResumeStore: (() => void) | null = null;

  let criteriaResolutionPending = false;
  let lastPreviousConnectionsSignature = '';

  const reloadCoordinator = createBookmarkReloadCoordinator({
    source,
    isDisposed: () => disposed,
    getSelectedLeague: () => leagueManager.getRawSelectedLeague(),
    isLeagueResolved: () => leagueManager.isResolved(),
    resolveInitialLeague: () => leagueManager.resolveInitialLeague(),
    onCollectionResolved(collection) {
      reconcileSourceOwnership();
      const currentSelectedLeague = leagueManager.getRawSelectedLeague();
      if (resumeStore && currentSelectedLeague) {
        const validKeys = new Set<string>();
        for (const b of collection.bookmarks) {
          const key = getBookmarkCanonicalKey(b);
          if (key) validKeys.add(key);
        }
        registry.pruneBaselineForLeague(validKeys, currentSelectedLeague);
        void resumeStore.pruneToAuthoritative(validKeys, { league: currentSelectedLeague });
      }
    },
    onStateChanged: notify,
  });

  const baseRuntimePort: LiveSearchControllerBasePort = {
    hasSource: Boolean(source),
    isDisposed: () => disposed,
    isReloadPending: () => reloadCoordinator.isReloadPending(),
    waitForReconciliationDrain: () => reloadCoordinator.waitForDrain(),
    getGameVersion: () => currentGameVersion,
    getCurrentCollection: () => reloadCoordinator.getCurrentCollection(),
    notify,
  };

  const leagueManager = createLiveSearchLeagueManager({
    runtime: baseRuntimePort,
    initialLeague: options?.initialLeague,
    preferences,
    resumeStore,
    liveController,
    fetchLeagues: options?.fetchLeagues,
    isLoading: () => reloadCoordinator.isLoading(),
    getCustomSources: () => registry.getCustomSources(),
    getLatestResumeIdentities: () => registry.getLatestResumeIdentities(),
    onSelectedLeagueChanged: () => {
      reloadCoordinator.syncResolvedCollection();
    },
  });

  const connectionDedup = createConnectionDedup({
    resolver: options?.criteriaKeyResolver ?? createTradeSearchCriteriaKeyResolver(),
    listSessionEntries: () => registry.listSessionDedupEntries(currentLiveSubscriptions),
    listPreviousEntries: () =>
      registry.listPreviousDedupEntries(
        currentGameVersion,
        reloadCoordinator.getCurrentCollection(),
        findActiveSubByCanonicalKey,
      ),
  });

  registry.syncActiveSubscriptions(
    currentLiveSubscriptions,
    reloadCoordinator.getCurrentCollection(),
  );

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

    const canonicalKey = registry.resolveCanonicalKeyBySourceId(
      trimmed,
      reloadCoordinator.getCurrentCollection(),
    );
    if (!canonicalKey) return undefined;
    return findActiveSubByCanonicalKey(canonicalKey)?.id;
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
    const collection = reloadCoordinator.getCurrentCollection();
    if (match.section === 'session') {
      if (match.sameKey) return null;
      registry.patchSessionCover(match.entry.key, incomingCover);
      if (findActiveSubByCanonicalKey(match.entry.key)) {
        notify();
        return { kind: 'error', error: t('liveSearch.error.sameCriteriaActive') };
      }
      return {
        kind: 'source',
        sourceId: registry.sourceIdForDedupEntry(match.entry, 'session', collection),
      };
    }
    if (shouldAdoptExisting(incomingCover, match.entry.coverImageUrl)) {
      return match.sameKey
        ? { kind: 'adopt-meta', entry: match.entry }
        : {
            kind: 'source',
            sourceId: registry.sourceIdForDedupEntry(match.entry, 'previous', collection),
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
      loading: reloadCoordinator.isLoading(),
      errorMessage: reloadCoordinator.getErrorMessage(),
      isLeagueResolved: leagueManager.isResolved(),
      isSwitchingLeague: leagueManager.isSwitching(),
      selectedLeague: leagueManager.getRawSelectedLeague(),
      availableLeagues: leagueManager.getAvailableLeagues(),
      primaryContext: getPrimaryContext(),
      hasSource: Boolean(source),
      currentCollection: reloadCoordinator.getCurrentCollection(),
      currentLiveSubscriptions,
      customSources: registry.getCustomSources(),
      sessionEntriesByKey: registry.getSessionEntries(),
      pendingSearchKeys: registry.getPendingSearchKeys(),
      combinedResumeMap: registry.buildCombinedResumeMap(),
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
    const collection = reloadCoordinator.getCurrentCollection();
    registry.syncActiveSubscriptions(currentLiveSubscriptions, collection);
    if (source && !collection) return;

    const promotedResumeIdentities = registry.reconcileOwnership(
      collection,
      currentLiveSubscriptions,
      findActiveSubByCanonicalKey,
    );
    if (resumeStore && promotedResumeIdentities.length > 0) {
      for (const identity of promotedResumeIdentities) {
        void resumeStore.addIdentities([identity]);
      }
    }
  }

  const ops: LiveSearchOperationContext = {
    isDisposed: () => disposed,
    isSwitchingLeague: () => leagueManager.isSwitching(),
    ensureReady() {
      if (!leagueManager.isResolved() || (source && reloadCoordinator.isReloadPending())) {
        return (async () => {
          if (!leagueManager.isResolved()) {
            await leagueManager.ensureStartupResolved();
          }
          if (source && reloadCoordinator.isReloadPending()) {
            await reloadCoordinator.waitForDrain();
          }
        })();
      }
      return undefined;
    },
    waitForReloadDrain() {
      return reloadCoordinator.isReloadPending() ? reloadCoordinator.waitForDrain() : undefined;
    },
    getGameVersion: () => currentGameVersion,
    getSelectedLeague: () => leagueManager.getRawSelectedLeague(),
    getTransitionGeneration: () => leagueManager.getTransitionGeneration(),
    getPrimaryContext,
    getCurrentCollection: () => reloadCoordinator.getCurrentCollection(),
    getCurrentLiveSubscriptions: () => currentLiveSubscriptions,
    findActiveSubByCanonicalKey,
    resolveSubscriptionId,
    resolveCriteriaRedirect,
    notify,
  };

  const sourceActivator = createLiveSearchSourceActivator({
    ops,
    registry,
    liveController,
    resumeStore,
  });

  const batchExecutor = createLiveSearchBatchExecutor({
    ops,
    registry,
    liveController,
    connectionDedup,
    enableSource: sourceActivator.enableSource,
  });

  const sourceIntake = createLiveSearchSourceIntake({
    ops,
    registry,
    resumeStore,
    switchLeague: (targetLeague) => leagueManager.switchLeague(targetLeague),
    enableSource: sourceActivator.enableSource,
    enableManySources: batchExecutor.enableManySources,
  });

  if (source) {
    unsubSource = source.subscribe(() => {
      reloadCoordinator.scheduleReload();
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
    reloadCoordinator.scheduleReload();
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

    enable: (sourceId) => sourceActivator.enableSource(sourceId),
    add: (sourceId) => sourceActivator.enableSource(sourceId),
    enableMany: batchExecutor.enableManySources,
    stopMany: batchExecutor.stopManySources,
    addCustom: sourceIntake.addCustom,
    enqueueIncomingConnections: sourceIntake.enqueueIncomingConnections,

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

    removeCustom(sourceId) {
      if (disposed || typeof sourceId !== 'string') return false;
      const outcome = registry.removeCustomById(sourceId.trim());
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

      const canonicalKey = registry.resolveCanonicalKeyBySourceId(
        trimmed,
        reloadCoordinator.getCurrentCollection(),
      );
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
        registry.resolveCanonicalKeyBySourceId(trimmed, reloadCoordinator.getCurrentCollection()) ??
        trimmed;
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
      return batchExecutor.enableManySources(ids);
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
      leagueManager.dispose();
      reloadCoordinator.dispose();
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

export const createLiveSearchBookmarkController = createLiveSearchSourceController;
