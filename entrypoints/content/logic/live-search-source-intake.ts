import { t } from '@/utils/i18n';
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
} from '@/utils/live-search-contract';
import type {
  LiveSearchResumeIdentity,
  LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';
import type { LiveSearchEnableSourceOptions } from './live-search-batch-executor';
import { hasValidCover } from './live-search-connection-dedup';
import {
  formatLiveSearchDisplayLeague,
  formatLiveSearchDisplayVersion,
  getBookmarkCanonicalKey,
  sameLeague,
} from './live-search-source-filters';
import type {
  CustomSourceRecord,
  LiveSearchBatchOutcome,
  LiveSearchSourceRuntimePort,
} from './live-search-source-types';

export interface LiveSearchSourceIntakeDeps {
  runtime: LiveSearchSourceRuntimePort;
  resumeStore: LiveSearchResumeStore | null;
  customSources: CustomSourceRecord[];
  switchLeague: (targetLeague: string) => Promise<boolean>;
  enableSource: (
    sourceId: string,
    options?: LiveSearchEnableSourceOptions,
  ) => Promise<AddSubscriptionOutcome>;
  enableManySources: (sourceIds: readonly string[]) => Promise<LiveSearchBatchOutcome>;
}

export interface LiveSearchSourceIntake {
  addCustom(
    url: string,
    options?: { name?: string; coverImageUrl?: string },
  ): Promise<AddSubscriptionOutcome>;
  enqueueIncomingConnections(
    items: readonly LiveSearchEnqueueItem[],
  ): Promise<LiveSearchEnqueueResponse>;
}

export function createLiveSearchSourceIntake(
  deps: LiveSearchSourceIntakeDeps,
): LiveSearchSourceIntake {
  const { runtime } = deps;
  let enqueueIncomingChain: Promise<unknown> = Promise.resolve();

  function runEnqueueIncoming<T>(task: () => Promise<T>): Promise<T> {
    const next = enqueueIncomingChain.then(task, task);
    enqueueIncomingChain = next.catch(() => {});
    return next;
  }

  async function addCustom(
    url: string,
    options?: { name?: string; coverImageUrl?: string },
  ): Promise<AddSubscriptionOutcome> {
    if (runtime.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    if (!runtime.isLeagueResolved()) {
      await runtime.ensureStartupResolved();
    }

    if (runtime.hasSource && runtime.isReloadPending()) {
      await runtime.waitForReconciliationDrain();
    }

    if (runtime.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    if (runtime.isSwitchingLeague()) {
      return { success: false, error: t('liveSearch.error.switchingLeague') };
    }

    if (typeof url !== 'string' || !url.trim()) {
      return { success: false, error: t('liveSearch.error.invalidUrlRequired') };
    }

    const cleanUrl = stripLiveSuffix(url.trim());
    const parsed = parseTradeSearchUrl(cleanUrl);
    if (!parsed) {
      return {
        success: false,
        error: t('liveSearch.error.invalidUrlFormat'),
      };
    }

    const currentGameVersion = runtime.getGameVersion();
    if (parsed.gameVersion !== currentGameVersion) {
      return {
        success: false,
        error: t('liveSearch.error.wrongVersion', {
          searchVersion: formatLiveSearchDisplayVersion(parsed.gameVersion),
          consoleVersion: formatLiveSearchDisplayVersion(currentGameVersion),
        }),
      };
    }

    const selectedLeague = runtime.getRawSelectedLeague();
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
    let trimmedName = options?.name?.trim() ?? '';
    let incomingCover = hasValidCover(options?.coverImageUrl) ? options?.coverImageUrl : undefined;

    // 相同搜尋條件只能有一筆：須在登記本次連線之前決定沿用哪一筆
    const redirect = await runtime.resolveCriteriaRedirect(parsed, canonicalKey, incomingCover);
    if (redirect?.kind === 'error') return { success: false, error: redirect.error };
    if (redirect?.kind === 'source') {
      return deps.enableSource(redirect.sourceId, { skipCriteriaRedirect: true });
    }
    if (redirect?.kind === 'adopt-meta') {
      incomingCover = redirect.entry.coverImageUrl;
      trimmedName = redirect.entry.name?.trim() || trimmedName;
    }
    // 未提供名稱時以搜尋代碼（search ID）命名，確保可辨識、可搜尋、可篩選結果
    const displayName = trimmedName || parsed.searchId;

    const currentCollection = runtime.getCurrentCollection();
    const existingBookmark = currentCollection?.bookmarks.find(
      (b) => getBookmarkCanonicalKey(b) === canonicalKey,
    );

    if (existingBookmark) {
      const existingCustomIdx = deps.customSources.findIndex(
        (c) => c.canonicalKey === canonicalKey,
      );
      if (existingCustomIdx !== -1) {
        deps.customSources.splice(existingCustomIdx, 1);
      }

      if (runtime.findActiveSubByCanonicalKey(canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyActive') };
      }

      return await deps.enableSource(existingBookmark.id);
    }

    let customRecord = deps.customSources.find((c) => c.canonicalKey === canonicalKey);
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
      deps.customSources.push(customRecord);
    }

    runtime.registerSessionEntry({
      canonicalKey,
      canonicalIdentity: parsed,
      name: customRecord.name || t('liveSearch.defaultSearchNameWithId', { id: parsed.searchId }),
      url: cleanUrl,
      coverImageUrl: customRecord.coverImageUrl,
    });

    runtime.notify();
    return await deps.enableSource(customRecord.id, { skipCriteriaRedirect: true });
  }

  function enqueueIncomingConnections(
    items: readonly LiveSearchEnqueueItem[],
  ): Promise<LiveSearchEnqueueResponse> {
    return runEnqueueIncoming(async () => {
      if (runtime.isDisposed()) {
        return { success: false, error: t('liveSearch.console.closed'), rejectReason: 'failed' };
      }

      if (!runtime.isLeagueResolved()) {
        await runtime.ensureStartupResolved();
      }

      if (runtime.hasSource && runtime.isReloadPending()) {
        await runtime.waitForReconciliationDrain();
      }

      if (runtime.isDisposed()) {
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
          error: t('liveSearch.error.invalidUrlShort'),
          rejectReason: 'invalid-url',
        };
      }

      const currentGameVersion = runtime.getGameVersion();
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
      const primaryContext = runtime.getPrimaryContext();

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
        !sameLeague(runtime.getRawSelectedLeague(), incomingLeague)
      ) {
        const switched = await deps.switchLeague(incomingLeague);
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

      const currentCollection = runtime.getCurrentCollection();
      const sourceIdsToEnable: string[] = [];
      const resumeEntriesToPersist: LiveSearchResumeIdentity[] = [];

      for (const candidate of parsedCandidates) {
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
        const redirect = await runtime.resolveCriteriaRedirect(
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
          runtime.registerSessionEntry({
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
          let customRecord = deps.customSources.find(
            (c) => c.canonicalKey === candidate.canonicalKey,
          );
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
            deps.customSources.push(customRecord);
          } else {
            customRecord.url = candidate.cleanUrl;
            if (resolvedName) customRecord.name = resolvedName;
            if (validCover) customRecord.coverImageUrl = validCover;
          }
          runtime.registerSessionEntry({
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

      runtime.notify();
      const batchOutcome = await deps.enableManySources(sourceIdsToEnable);
      if (deps.resumeStore && batchOutcome.succeeded > 0 && resumeEntriesToPersist.length > 0) {
        await deps.resumeStore.addIdentities(resumeEntriesToPersist);
      }

      return {
        success: batchOutcome.failed === 0 && !batchOutcome.rejectReason,
        addedCount: batchOutcome.succeeded,
        skippedCount: batchOutcome.skipped + duplicateIncomingSkipped,
        ...(batchOutcome.error ? { error: batchOutcome.error } : {}),
      };
    });
  }

  return {
    addCustom,
    enqueueIncomingConnections,
  };
}
