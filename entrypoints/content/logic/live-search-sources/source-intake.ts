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
import { hasValidCover } from './connection-dedup';
import type { LiveSearchConnectionRegistry } from './connection-registry';
import type { LiveSearchEnableSourceOptions } from './source-activator';
import {
  formatLiveSearchDisplayLeague,
  formatLiveSearchDisplayVersion,
  getBookmarkCanonicalKey,
  sameLeague,
} from './source-filters';
import type { LiveSearchBatchOutcome, LiveSearchOperationContext } from './types';

export interface LiveSearchSourceIntakeDeps {
  ops: LiveSearchOperationContext;
  registry: LiveSearchConnectionRegistry;
  resumeStore: LiveSearchResumeStore | null;
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
  const { ops, registry, resumeStore } = deps;
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
    if (ops.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }

    const ready = ops.ensureReady();
    if (ready) await ready;

    if (ops.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }
    if (ops.isSwitchingLeague()) {
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

    const currentGameVersion = ops.getGameVersion();
    if (parsed.gameVersion !== currentGameVersion) {
      return {
        success: false,
        error: t('liveSearch.error.wrongVersion', {
          searchVersion: formatLiveSearchDisplayVersion(parsed.gameVersion),
          consoleVersion: formatLiveSearchDisplayVersion(currentGameVersion),
        }),
      };
    }

    const selectedLeague = ops.getSelectedLeague();
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
    const redirect = await ops.resolveCriteriaRedirect(parsed, canonicalKey, incomingCover);
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

    const currentCollection = ops.getCurrentCollection();
    const existingBookmark = currentCollection?.bookmarks.find(
      (b) => getBookmarkCanonicalKey(b) === canonicalKey,
    );

    if (existingBookmark) {
      registry.removeCustomByCanonicalKey(canonicalKey);
      if (ops.findActiveSubByCanonicalKey(canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyActive') };
      }
      return await deps.enableSource(existingBookmark.id);
    }

    const customRecord = registry.upsertCustomSource({
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
      name: customRecord.name || t('liveSearch.defaultSearchNameWithId', { id: parsed.searchId }),
      url: cleanUrl,
      coverImageUrl: customRecord.coverImageUrl,
    });

    ops.notify();
    return await deps.enableSource(customRecord.id, { skipCriteriaRedirect: true });
  }

  function enqueueIncomingConnections(
    items: readonly LiveSearchEnqueueItem[],
  ): Promise<LiveSearchEnqueueResponse> {
    return runEnqueueIncoming(async () => {
      if (ops.isDisposed()) {
        return { success: false, error: t('liveSearch.console.closed'), rejectReason: 'failed' };
      }

      const ready = ops.ensureReady();
      if (ready) await ready;

      if (ops.isDisposed()) {
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

      const currentGameVersion = ops.getGameVersion();
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
      const primaryContext = ops.getPrimaryContext();

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

      if (!primaryContext.runtimeLeague && !sameLeague(ops.getSelectedLeague(), incomingLeague)) {
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

      const sourceIdsToEnable: string[] = [];
      const resumeEntriesToPersist: LiveSearchResumeIdentity[] = [];

      for (const candidate of parsedCandidates) {
        // 迴圈內會 await 條件解析，書籤集合可能在期間重新載入，每輪都要讀最新集合
        const currentCollection = ops.getCurrentCollection();
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
        const redirect = await ops.resolveCriteriaRedirect(
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
          const customRecord = registry.upsertCustomSource({
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

      ops.notify();
      const batchOutcome = await deps.enableManySources(sourceIdsToEnable);
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

  return {
    addCustom,
    enqueueIncomingConnections,
  };
}
