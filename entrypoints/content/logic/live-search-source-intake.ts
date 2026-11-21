import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
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
  LiveSearchSubscription,
} from '@/utils/live-search-contract';
import type {
  LiveSearchResumeIdentity,
  LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { hasValidCover } from './live-search-connection-dedup';
import {
  formatLiveSearchDisplayLeague,
  formatLiveSearchDisplayVersion,
} from './live-search-source-filters';
import type {
  CriteriaRedirect,
  CustomSourceRecord,
  LiveSearchBatchOutcome,
  LiveSearchPrimaryContext,
  SessionConnectionMeta,
} from './live-search-source-types';

export interface LiveSearchSourceIntakeDeps {
  hasSource: boolean;
  resumeStore: LiveSearchResumeStore | null;
  customSources: CustomSourceRecord[];
  isDisposed: () => boolean;
  isLeagueResolved: () => boolean;
  isSwitchingLeague: () => boolean;
  getGameVersion: () => PoeVersion;
  getRawSelectedLeague: () => string;
  getPrimaryContext: () => LiveSearchPrimaryContext;
  getCurrentCollection: () => BookmarkCollectionView | null;
  ensureStartupResolved: () => Promise<void>;
  isReloadPending: () => boolean;
  waitForReconciliationDrain: () => Promise<void>;
  switchLeague: (targetLeague: string) => Promise<boolean>;
  findActiveSubByCanonicalKey: (
    canonicalKey: string,
  ) => Readonly<LiveSearchSubscription> | undefined;
  resolveCriteriaRedirect: (
    identity: ParsedTradeSearchIdentity,
    canonicalKey: string,
    incomingCover: string | undefined,
  ) => Promise<CriteriaRedirect | null>;
  registerSessionEntry: (meta: SessionConnectionMeta) => void;
  enableSource: (sourceId: string) => Promise<AddSubscriptionOutcome>;
  enableSourceInternal: (
    sourceId: string,
    allowRedirect: boolean,
  ) => Promise<AddSubscriptionOutcome>;
  enableManySources: (sourceIds: readonly string[]) => Promise<LiveSearchBatchOutcome>;
  notify: () => void;
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

    const currentGameVersion = deps.getGameVersion();
    if (parsed.gameVersion !== currentGameVersion) {
      return {
        success: false,
        error: t('liveSearch.error.wrongVersion', {
          searchVersion: formatLiveSearchDisplayVersion(parsed.gameVersion),
          consoleVersion: formatLiveSearchDisplayVersion(currentGameVersion),
        }),
      };
    }

    const selectedLeague = deps.getRawSelectedLeague();
    if (parsed.league.trim().toLowerCase() !== selectedLeague.trim().toLowerCase()) {
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
    const redirect = await deps.resolveCriteriaRedirect(parsed, canonicalKey, incomingCover);
    if (redirect?.kind === 'error') return { success: false, error: redirect.error };
    if (redirect?.kind === 'source') return deps.enableSourceInternal(redirect.sourceId, false);
    if (redirect?.kind === 'adopt-meta') {
      incomingCover = redirect.entry.coverImageUrl;
      trimmedName = redirect.entry.name?.trim() || trimmedName;
    }
    // 未提供名稱時以搜尋代碼（search ID）命名，確保可辨識、可搜尋、可篩選結果
    const displayName = trimmedName || parsed.searchId;

    const currentCollection = deps.getCurrentCollection();
    const existingBookmark = currentCollection?.bookmarks.find((b) => {
      const bCleanUrl = stripLiveSuffix(b.url);
      const bParsed = parseTradeSearchUrl(bCleanUrl);
      return bParsed && getTradeSearchCanonicalKey(bParsed) === canonicalKey;
    });

    if (existingBookmark) {
      const existingCustomIdx = deps.customSources.findIndex(
        (c) => c.canonicalKey === canonicalKey,
      );
      if (existingCustomIdx !== -1) {
        deps.customSources.splice(existingCustomIdx, 1);
      }

      if (deps.findActiveSubByCanonicalKey(canonicalKey)) {
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

    deps.registerSessionEntry({
      canonicalKey,
      canonicalIdentity: parsed,
      name: customRecord.name || t('liveSearch.defaultSearchNameWithId', { id: parsed.searchId }),
      url: cleanUrl,
      coverImageUrl: customRecord.coverImageUrl,
    });

    deps.notify();
    return await deps.enableSourceInternal(customRecord.id, false);
  }

  function enqueueIncomingConnections(
    items: readonly LiveSearchEnqueueItem[],
  ): Promise<LiveSearchEnqueueResponse> {
    return runEnqueueIncoming(async () => {
      if (deps.isDisposed()) {
        return { success: false, error: t('liveSearch.console.closed'), rejectReason: 'failed' };
      }

      if (!deps.isLeagueResolved()) {
        await deps.ensureStartupResolved();
      }

      if (deps.hasSource && deps.isReloadPending()) {
        await deps.waitForReconciliationDrain();
      }

      if (deps.isDisposed()) {
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

      const currentGameVersion = deps.getGameVersion();
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
      const primaryContext = deps.getPrimaryContext();

      if (
        primaryContext.runtimeLeague &&
        primaryContext.runtimeLeague.trim().toLowerCase() !== incomingLeague.toLowerCase()
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
        deps.getRawSelectedLeague().trim().toLowerCase() !== incomingLeague.toLowerCase()
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

      const currentCollection = deps.getCurrentCollection();
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
          t('liveSearch.defaultSearchNameWithId', { id: candidate.parsed.searchId });

        // 相同搜尋條件只能有一筆：已在本次連線者沿用既有項目；與上次連線相同者有圖片優先
        const redirect = await deps.resolveCriteriaRedirect(
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
          deps.registerSessionEntry({
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
          deps.registerSessionEntry({
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

      deps.notify();
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
