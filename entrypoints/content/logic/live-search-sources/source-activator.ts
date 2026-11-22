import { t } from '@/utils/i18n';
import {
  getTradeSearchCanonicalKey,
  parseTradeSearchUrl,
  stripLiveSuffix,
} from '@/utils/trade-search-identity';
import type {
  AddSubscriptionOutcome,
  LiveSearchPrimaryController,
} from '@/utils/live-search-contract';
import type { LiveSearchResumeStore } from '@/utils/live-search-resume-store';
import { hasValidCover } from './connection-dedup';
import type { LiveSearchConnectionRegistry } from './connection-registry';
import {
  evaluateLiveSearchSourceCompatibility,
  extractSectionSourceCanonicalKey,
  formatLiveSearchDisplayLeague,
  sameLeague,
} from './source-filters';
import type { LiveSearchOperationContext } from './types';

export interface LiveSearchEnableSourceOptions {
  /** 跳過「相同搜尋條件」轉向（由轉向後或已完成去重之入口使用，避免循環）。 */
  skipCriteriaRedirect?: boolean;
}

export interface LiveSearchSourceActivatorDeps {
  ops: LiveSearchOperationContext;
  registry: LiveSearchConnectionRegistry;
  liveController: LiveSearchPrimaryController;
  resumeStore: LiveSearchResumeStore | null;
}

export interface LiveSearchSourceActivator {
  enableSource(
    sourceId: string,
    options?: LiveSearchEnableSourceOptions,
  ): Promise<AddSubscriptionOutcome>;
}

export function createLiveSearchSourceActivator(
  deps: LiveSearchSourceActivatorDeps,
): LiveSearchSourceActivator {
  const { ops, registry, liveController, resumeStore } = deps;

  function isLeagueTransitionStale(opGeneration: number, opLeague: string): boolean {
    return (
      ops.getTransitionGeneration() !== opGeneration ||
      ops.isSwitchingLeague() ||
      ops.getSelectedLeague() !== opLeague
    );
  }

  function rollbackStaleSubscription(canonicalKey: string): void {
    const sub = ops.findActiveSubByCanonicalKey(canonicalKey);
    if (sub) {
      liveController.remove(sub.id);
    } else {
      void liveController.teardownAll();
    }
  }

  async function enableSource(
    sourceId: string,
    options?: LiveSearchEnableSourceOptions,
  ): Promise<AddSubscriptionOutcome> {
    const allowRedirect = !options?.skipCriteriaRedirect;
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

    const opGeneration = ops.getTransitionGeneration();
    const opLeague = ops.getSelectedLeague();

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
        return enableSource(existingTemporarySearch.id, options);
      }
    }

    // 1. Temporary Search Source
    const custom = registry.findTemporarySearchById(trimmedId);
    if (custom) {
      const compat = evaluateLiveSearchSourceCompatibility(
        custom.canonicalIdentity,
        ops.getPrimaryContext(),
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
      if (ops.findActiveSubByCanonicalKey(custom.canonicalKey)) {
        return { success: false, error: t('liveSearch.error.alreadyActive') };
      }

      if (allowRedirect) {
        const redirect = await ops.resolveCriteriaRedirect(
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
        if (ops.findActiveSubByCanonicalKey(custom.canonicalKey)) {
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
      ops.notify();

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
        ops.notify();
      }
    }

    // 2. Bookmark Source
    const drain = ops.waitForReloadDrain();
    if (drain) await drain;

    if (ops.isDisposed()) {
      return { success: false, error: t('liveSearch.error.controllerDisposed') };
    }
    if (isLeagueTransitionStale(opGeneration, opLeague)) {
      return { success: false, error: t('liveSearch.error.leagueSwitchedCancelled') };
    }

    const currentCollection = ops.getCurrentCollection();
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

    const compat = evaluateLiveSearchSourceCompatibility(
      parsed,
      ops.getPrimaryContext(),
      bookmarkUrl,
    );
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
    if (ops.findActiveSubByCanonicalKey(searchKey)) {
      return { success: false, error: t('liveSearch.error.alreadyActive') };
    }

    let validCoverUrl = hasValidCover(bookmark.coverImageUrl) ? bookmark.coverImageUrl : undefined;

    registry.markPending(searchKey);
    ops.notify();

    if (allowRedirect) {
      const redirect = await ops.resolveCriteriaRedirect(parsed, searchKey, validCoverUrl);
      if (redirect?.kind === 'error' || redirect?.kind === 'source') {
        registry.clearPending(searchKey);
        ops.notify();
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
      ops.notify();
    }
  }

  return { enableSource };
}
