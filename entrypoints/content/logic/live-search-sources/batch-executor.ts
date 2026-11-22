import { t } from '@/utils/i18n';
import {
  getTradeSearchCanonicalKey,
  type ParsedTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import type {
  AddSubscriptionOutcome,
  LiveSearchPrimaryController,
} from '@/utils/live-search-contract';
import type { ConnectionDedup } from './connection-dedup';
import type { LiveSearchConnectionRegistry } from './connection-registry';
import type { LiveSearchEnableSourceOptions } from './source-activator';
import {
  evaluateLiveSearchSourceCompatibility,
  formatLiveSearchDisplayLeague,
  sameLeague,
} from './source-filters';
import type {
  LiveSearchBatchIncompatibleBreakdown,
  LiveSearchBatchOutcome,
  LiveSearchBatchSkipCounts,
  LiveSearchOperationContext,
} from './types';

export interface LiveSearchBatchExecutorDeps {
  ops: LiveSearchOperationContext;
  registry: LiveSearchConnectionRegistry;
  liveController: LiveSearchPrimaryController;
  connectionDedup: ConnectionDedup;
  enableSource: (
    sourceId: string,
    options?: LiveSearchEnableSourceOptions,
  ) => Promise<AddSubscriptionOutcome>;
}

export interface LiveSearchBatchExecutor {
  enableManySources(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome>;
  stopManySources(sourceIds: readonly string[]): LiveSearchBatchOutcome;
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

export function createLiveSearchBatchExecutor(
  deps: LiveSearchBatchExecutorDeps,
): LiveSearchBatchExecutor {
  const { ops, registry, liveController, connectionDedup, enableSource } = deps;

  function isLeagueTransitionStale(opGeneration: number, opLeague: string): boolean {
    return (
      ops.getTransitionGeneration() !== opGeneration ||
      ops.isSwitchingLeague() ||
      ops.getSelectedLeague() !== opLeague
    );
  }

  async function enableManySources(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome> {
    const { skipReasons, incompatibleBreakdown } = createEmptyBatchCounters();
    const requestedIds = Array.isArray(sourceIds) ? sourceIds : [];
    const requested = requestedIds.length;

    if (ops.isDisposed()) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'disposed',
        error: t('liveSearch.error.controllerDisposed'),
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

    const ready = ops.ensureReady();
    if (ready) await ready;

    if (ops.isDisposed()) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'disposed',
        error: t('liveSearch.error.controllerDisposed'),
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    if (ops.isSwitchingLeague()) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'not-ready',
        error: t('liveSearch.error.switchingLeague'),
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    const opGeneration = ops.getTransitionGeneration();
    const opLeague = ops.getSelectedLeague();
    const currentCollection = ops.getCurrentCollection();

    if (!currentCollection && !registry.hasAnyState()) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'not-ready',
        error: t('liveSearch.error.bookmarksNotReady'),
        skipReasons,
        incompatibleBreakdown,
        runtimeFailureCount: 0,
      };
    }

    const primaryContext = ops.getPrimaryContext();

    // 尚未鎖定聯盟時之 Mixed-League Atomic Preflight across requested items
    if (!primaryContext.runtimeLeague) {
      const distinctBatchLeagues: string[] = [];
      for (const rawId of requestedIds) {
        const sourceId = typeof rawId === 'string' ? rawId.trim() : '';
        if (!sourceId) continue;
        const info = registry.resolveCandidateInfo(sourceId, currentCollection);
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

      const info = registry.resolveCandidateInfo(sourceId, currentCollection);
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
      if (ops.findActiveSubByCanonicalKey(canonicalKey)) {
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
      const activeIdentities = ops
        .getCurrentLiveSubscriptions()
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
      if (ops.isDisposed()) {
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

    if (ops.isDisposed()) {
      return {
        success: false,
        requested,
        succeeded: 0,
        skipped: 0,
        failed: requested,
        rejectReason: 'disposed',
        error: t('liveSearch.error.controllerDisposed'),
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
    const currentCollection = ops.getCurrentCollection();
    let succeeded = 0;
    let skipped = 0;

    for (const rawId of requestedIds) {
      const sourceId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!sourceId) {
        skipped += 1;
        skipReasons.notFound += 1;
        continue;
      }

      const subId = ops.resolveSubscriptionId(sourceId);
      if (!subId) {
        const canonicalKey = registry.resolveCanonicalKeyBySourceId(sourceId, currentCollection);
        const exists =
          (canonicalKey !== null && registry.hasSessionEntry(canonicalKey)) ||
          Boolean(registry.findCustomById(sourceId)) ||
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

    ops.notify();
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

  return {
    enableManySources,
    stopManySources,
  };
}
