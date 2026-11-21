import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import { t } from '@/utils/i18n';
import {
  getTradeSearchCanonicalKey,
  parseTradeSearchUrl,
  stripLiveSuffix,
  type ParsedTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import type {
  AddSubscriptionOutcome,
  LiveSearchPrimaryController,
  LiveSearchSubscription,
} from '@/utils/live-search-contract';
import type {
  LiveSearchResumeIdentity,
  LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import type { ConnectionDedup } from './live-search-connection-dedup';
import {
  buildCanonicalTradeSearchUrl,
  createEmptyBatchCounters,
  evaluateLiveSearchSourceCompatibility,
  extractSectionSourceCanonicalKey,
  formatLiveSearchDisplayLeague,
} from './live-search-source-filters';
import type {
  CriteriaRedirect,
  CustomSourceRecord,
  LiveSearchBatchOutcome,
  LiveSearchPrimaryContext,
  SessionConnectionMeta,
} from './live-search-source-types';

export interface LiveSearchBatchExecutorDeps {
  hasSource: boolean;
  liveController: LiveSearchPrimaryController;
  resumeStore: LiveSearchResumeStore | null;
  connectionDedup: ConnectionDedup;
  customSources: CustomSourceRecord[];
  sessionEntriesByKey: Map<string, SessionConnectionMeta>;
  baselineResumeByKey: Map<string, LiveSearchResumeIdentity>;
  pendingSearchKeys: Set<string>;
  isDisposed: () => boolean;
  isLeagueResolved: () => boolean;
  isSwitchingLeague: () => boolean;
  getTransitionGeneration: () => number;
  getRawSelectedLeague: () => string;
  ensureStartupResolved: () => Promise<void>;
  isReloadPending: () => boolean;
  waitForReconciliationDrain: () => Promise<void>;
  getPrimaryContext: () => LiveSearchPrimaryContext;
  getCurrentCollection: () => BookmarkCollectionView | null;
  getCurrentLiveSubscriptions: () => readonly Readonly<LiveSearchSubscription>[];
  findActiveSubByCanonicalKey: (
    canonicalKey: string,
  ) => Readonly<LiveSearchSubscription> | undefined;
  findResumeEntryByCanonicalKey: (canonicalKey: string) => LiveSearchResumeIdentity | undefined;
  resolveCanonicalKeyBySourceId: (sourceId: string) => string | null;
  resolveSubscriptionId: (sourceOrSubscriptionId: string) => string | undefined;
  resolveCriteriaRedirect: (
    identity: ParsedTradeSearchIdentity,
    canonicalKey: string,
    incomingCover: string | undefined,
  ) => Promise<CriteriaRedirect | null>;
  registerSessionEntry: (meta: SessionConnectionMeta) => void;
  notify: () => void;
}

export interface LiveSearchBatchExecutor {
  enableSource(sourceId: string): Promise<AddSubscriptionOutcome>;
  enableSourceInternal(sourceId: string, allowRedirect: boolean): Promise<AddSubscriptionOutcome>;
  enableManySources(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome>;
  stopManySources(sourceIds: readonly string[]): LiveSearchBatchOutcome;
}

export function createLiveSearchBatchExecutor(
  deps: LiveSearchBatchExecutorDeps,
): LiveSearchBatchExecutor {
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
    if (deps.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    if (!deps.isLeagueResolved()) {
      await deps.ensureStartupResolved();
    }

    if (deps.hasSource && deps.isReloadPending()) {
      await deps.waitForReconciliationDrain();
    }

    if (deps.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    if (deps.isSwitchingLeague()) {
      return { success: false, error: t('liveSearch.error.switchingLeague') };
    }

    const opGeneration = deps.getTransitionGeneration();
    const opLeague = deps.getRawSelectedLeague();

    if (!sourceId || typeof sourceId !== 'string') {
      return { success: false, error: t('liveSearch.error.invalidBookmarkId') };
    }

    const trimmedId = sourceId.trim();

    // 0. 支援從「上次連線」(prev_*) 或「本次連線」(session_*) 直接啟用非書籤來源
    const targetKey = extractSectionSourceCanonicalKey(trimmedId);
    if (targetKey) {
      let existingCustom = deps.customSources.find((c) => c.canonicalKey === targetKey);
      if (!existingCustom) {
        const sessionMeta = deps.sessionEntriesByKey.get(targetKey);
        const resumeEntry = deps.findResumeEntryByCanonicalKey(targetKey);
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
          deps.customSources.push(existingCustom);
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
            name:
              resumeEntry.name ||
              t('liveSearch.defaultSearchNameWithId', { id: resumeEntry.searchId }),
            url: resolvedUrl,
            canonicalIdentity: parsed,
            canonicalKey: targetKey,
            createdAt: Date.now(),
            coverImageUrl: resumeEntry.coverImageUrl,
          };
          deps.customSources.push(existingCustom);
        }
      }
      if (existingCustom) {
        return enableSourceInternal(existingCustom.id, allowRedirect);
      }
    }

    // 1. 先檢查是否為 Custom Source
    const custom = deps.customSources.find((c) => c.id === trimmedId);
    if (custom) {
      const compat = evaluateLiveSearchSourceCompatibility(
        custom.canonicalIdentity,
        deps.getPrimaryContext(),
      );
      if (compat.compatibility !== 'compatible') {
        return {
          success: false,
          error: compat.compatibilityMessage || t('liveSearch.error.incompatible'),
        };
      }

      if (custom.canonicalIdentity.league.trim().toLowerCase() !== opLeague.trim().toLowerCase()) {
        return {
          success: false,
          error: t('liveSearch.error.selectedLeagueMismatch', {
            searchLeague: formatLiveSearchDisplayLeague(custom.canonicalIdentity.league),
            consoleLeague: formatLiveSearchDisplayLeague(opLeague),
          }),
        };
      }

      if (deps.pendingSearchKeys.has(custom.canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyStarting') };
      }
      if (deps.findActiveSubByCanonicalKey(custom.canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyActive') };
      }

      if (allowRedirect) {
        const redirect = await deps.resolveCriteriaRedirect(
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
        if (deps.pendingSearchKeys.has(custom.canonicalKey)) {
          return { success: false, error: t('liveSearch.error.alreadyStarting') };
        }
        if (deps.findActiveSubByCanonicalKey(custom.canonicalKey)) {
          return { success: false, error: t('liveSearch.error.alreadyActive') };
        }
      }

      deps.registerSessionEntry({
        canonicalKey: custom.canonicalKey,
        canonicalIdentity: custom.canonicalIdentity,
        name: custom.name,
        url: custom.url,
        coverImageUrl: custom.coverImageUrl,
      });
      deps.pendingSearchKeys.add(custom.canonicalKey);
      deps.notify();

      try {
        if (
          deps.getTransitionGeneration() !== opGeneration ||
          deps.isSwitchingLeague() ||
          deps.getRawSelectedLeague() !== opLeague
        ) {
          return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
        }
        const outcome = await deps.liveController.addFromUrl(custom.url, {
          name: custom.name,
        });
        if (
          deps.getTransitionGeneration() !== opGeneration ||
          deps.isSwitchingLeague() ||
          deps.getRawSelectedLeague() !== opLeague
        ) {
          if (outcome.success) {
            const sub = deps.findActiveSubByCanonicalKey(custom.canonicalKey);
            if (sub) {
              deps.liveController.remove(sub.id);
            } else {
              void deps.liveController.teardownAll();
            }
          }
          return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
        }
        if (outcome.success && deps.resumeStore) {
          await deps.resumeStore.addIdentities([
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
        deps.pendingSearchKeys.delete(custom.canonicalKey);
        deps.notify();
      }
    }

    // 2. Bookmark Source
    if (deps.isReloadPending()) {
      await deps.waitForReconciliationDrain();
    }

    if (deps.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    if (
      deps.getTransitionGeneration() !== opGeneration ||
      deps.isSwitchingLeague() ||
      deps.getRawSelectedLeague() !== opLeague
    ) {
      return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
    }

    const currentCollection = deps.getCurrentCollection();
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
      return {
        success: false,
        error: t('liveSearch.error.bookmarkInvalidUrl'),
      };
    }

    const compat = evaluateLiveSearchSourceCompatibility(
      parsed,
      deps.getPrimaryContext(),
      bookmarkUrl,
    );
    if (compat.compatibility !== 'compatible') {
      return {
        success: false,
        error: compat.compatibilityMessage || t('liveSearch.error.incompatible'),
      };
    }

    if (parsed.league.trim().toLowerCase() !== opLeague.trim().toLowerCase()) {
      return {
        success: false,
        error: t('liveSearch.error.selectedLeagueMismatch', {
          searchLeague: formatLiveSearchDisplayLeague(parsed.league),
          consoleLeague: formatLiveSearchDisplayLeague(opLeague),
        }),
      };
    }

    const searchKey = getTradeSearchCanonicalKey(parsed);

    if (deps.pendingSearchKeys.has(searchKey)) {
      return { success: false, error: t('liveSearch.error.alreadyStarting') };
    }

    if (deps.findActiveSubByCanonicalKey(searchKey)) {
      return { success: false, error: t('liveSearch.error.alreadyActive') };
    }

    let validCoverUrl =
      bookmark.coverImageUrl && isValidPoeCdnImageUrl(bookmark.coverImageUrl)
        ? bookmark.coverImageUrl
        : undefined;

    deps.pendingSearchKeys.add(searchKey);
    deps.notify();

    if (allowRedirect) {
      const redirect = await deps.resolveCriteriaRedirect(parsed, searchKey, validCoverUrl);
      if (redirect?.kind === 'error' || redirect?.kind === 'source') {
        deps.pendingSearchKeys.delete(searchKey);
        deps.notify();
        return redirect.kind === 'error'
          ? { success: false, error: redirect.error }
          : enableSourceInternal(redirect.sourceId, false);
      }
      // 同一 search ID：書籤名稱維持優先顯示，只沿用上次連線的封面
      if (redirect?.kind === 'adopt-meta') validCoverUrl = redirect.entry.coverImageUrl;
    }

    try {
      if (
        deps.getTransitionGeneration() !== opGeneration ||
        deps.isSwitchingLeague() ||
        deps.getRawSelectedLeague() !== opLeague
      ) {
        return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
      }
      const outcome = await deps.liveController.addFromUrl(bookmark.url, {
        name: bookmark.name,
        sourceBookmarkId: bookmark.id,
      });
      if (
        deps.getTransitionGeneration() !== opGeneration ||
        deps.isSwitchingLeague() ||
        deps.getRawSelectedLeague() !== opLeague
      ) {
        if (outcome.success) {
          const sub = deps.findActiveSubByCanonicalKey(searchKey);
          if (sub) {
            deps.liveController.remove(sub.id);
          } else {
            void deps.liveController.teardownAll();
          }
        }
        return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
      }
      if (outcome.success) {
        deps.registerSessionEntry({
          canonicalKey: searchKey,
          canonicalIdentity: parsed,
          name: bookmark.name,
          url: bookmark.url,
          coverImageUrl: validCoverUrl,
          sourceBookmarkId: bookmark.id,
        });
        if (deps.resumeStore && parsed) {
          await deps.resumeStore.addIdentities([
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
      deps.pendingSearchKeys.delete(searchKey);
      deps.notify();
    }
  }

  async function enableManySources(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome> {
    const { skipReasons, incompatibleBreakdown } = createEmptyBatchCounters();
    const requestedIds = Array.isArray(sourceIds) ? sourceIds : [];
    const requested = requestedIds.length;

    if (deps.isDisposed()) {
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

    if (!deps.isLeagueResolved()) {
      await deps.ensureStartupResolved();
    }

    if (deps.hasSource && deps.isReloadPending()) {
      await deps.waitForReconciliationDrain();
    }

    if (deps.isDisposed()) {
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

    if (deps.isSwitchingLeague()) {
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

    const opGeneration = deps.getTransitionGeneration();
    const opLeague = deps.getRawSelectedLeague();
    const currentCollection = deps.getCurrentCollection();

    if (
      !currentCollection &&
      deps.customSources.length === 0 &&
      deps.sessionEntriesByKey.size === 0 &&
      deps.baselineResumeByKey.size === 0
    ) {
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

    const primaryContext = deps.getPrimaryContext();

    function resolveCandidateInfo(sourceId: string): {
      parsed: ParsedTradeSearchIdentity | null;
      sourceUrl?: string;
      exists: boolean;
    } {
      const key = extractSectionSourceCanonicalKey(sourceId);
      if (key) {
        const sessionMeta = deps.sessionEntriesByKey.get(key);
        if (sessionMeta) {
          return {
            parsed: sessionMeta.canonicalIdentity,
            sourceUrl: stripLiveSuffix(sessionMeta.url),
            exists: true,
          };
        }
        const resumeEntry = deps.findResumeEntryByCanonicalKey(key);
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

      const custom = deps.customSources.find((c) => c.id === sourceId);
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

      if (deps.findActiveSubByCanonicalKey(canonicalKey)) {
        skipped += 1;
        skipReasons.alreadyActive += 1;
        continue;
      }

      if (deps.pendingSearchKeys.has(canonicalKey)) {
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
      const activeIdentities = deps
        .getCurrentLiveSubscriptions()
        .filter((sub) => sub.status !== 'closed')
        .map((sub) => ({
          gameVersion: sub.gameVersion,
          league: sub.league,
          searchId: sub.searchId,
        }));
      await deps.connectionDedup.resolveMany([
        ...eligibleCandidates.map((candidate) => candidate.parsed),
        ...activeIdentities,
      ]);
      const criteriaKeyOf = (identity: ParsedTradeSearchIdentity) =>
        deps.connectionDedup.peekCriteriaKey(identity) ?? getTradeSearchCanonicalKey(identity);
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
      if (deps.isDisposed()) {
        failed += 1;
        continue;
      }
      if (
        deps.getTransitionGeneration() !== opGeneration ||
        deps.isSwitchingLeague() ||
        deps.getRawSelectedLeague() !== opLeague
      ) {
        failed += eligibleCandidates.length - succeeded;
        lastError = t('liveSearch.error.leagueSwitchedBatchAborted');
        break;
      }
      const outcome = await enableSource(candidate.sourceId);
      if (
        deps.getTransitionGeneration() !== opGeneration ||
        deps.isSwitchingLeague() ||
        deps.getRawSelectedLeague() !== opLeague
      ) {
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

    if (deps.isDisposed()) {
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
    const currentCollection = deps.getCurrentCollection();
    let succeeded = 0;
    let skipped = 0;

    for (const rawId of requestedIds) {
      const sourceId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!sourceId) {
        skipped += 1;
        skipReasons.notFound += 1;
        continue;
      }

      const subId = deps.resolveSubscriptionId(sourceId);
      if (!subId) {
        const canonicalKey = deps.resolveCanonicalKeyBySourceId(sourceId);
        const exists =
          (canonicalKey !== null && deps.sessionEntriesByKey.has(canonicalKey)) ||
          deps.customSources.some((c) => c.id === sourceId) ||
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
      deps.liveController.remove(subId);
      succeeded += 1;
    }

    deps.notify();
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
    enableSource,
    enableSourceInternal,
    enableManySources,
    stopManySources,
  };
}
