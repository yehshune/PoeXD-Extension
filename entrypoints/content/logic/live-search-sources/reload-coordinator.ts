import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import { readBookmarkTargetContext, resolveBookmarkUrl } from '@/utils/bookmark-target';
import { t } from '@/utils/i18n';
import type { LiveSearchBookmarkSourcePort } from './types';

export interface BookmarkReloadCoordinatorDeps {
  source: LiveSearchBookmarkSourcePort | null | undefined;
  isDisposed: () => boolean;
  getSelectedLeague: () => string;
  isLeagueResolved: () => boolean;
  resolveInitialLeague: () => Promise<void>;
  onCollectionResolved: (collection: BookmarkCollectionView) => void;
  onStateChanged: () => void;
}

export interface BookmarkReloadCoordinator {
  getCurrentCollection(): BookmarkCollectionView | null;
  isLoading(): boolean;
  getErrorMessage(): string | undefined;
  isReloadPending(): boolean;
  syncResolvedCollection(): void;
  scheduleReload(): void;
  waitForDrain(): Promise<void>;
  dispose(): void;
}

/**
 * 管理書籤集合載入、聯盟 URL 解析與並行重載排程（reload drain）
 */
export function createBookmarkReloadCoordinator(
  deps: BookmarkReloadCoordinatorDeps,
): BookmarkReloadCoordinator {
  const { source } = deps;
  let currentCollection: BookmarkCollectionView | null = source
    ? null
    : { groups: [], bookmarks: [] };
  let rawCollection: BookmarkCollectionView | null = currentCollection;
  let loading = Boolean(source);
  let errorMessage: string | undefined;
  let isReloading = false;
  let hasPendingReload = false;
  let activeGeneration = 0;
  let reloadDrainPromise: Promise<void> | null = null;

  function syncResolvedCollection(): void {
    if (!rawCollection) {
      currentCollection = rawCollection;
      return;
    }
    const context = {
      ...readBookmarkTargetContext(),
      league: deps.getSelectedLeague() || undefined,
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
      while (!deps.isDisposed()) {
        hasPendingReload = false;
        const generation = ++activeGeneration;

        let outcome: BookmarkReadOutcome<BookmarkCollectionView>;
        try {
          outcome = await source.readCollection();
        } catch (err) {
          if (deps.isDisposed() || generation !== activeGeneration) return;
          if (hasPendingReload) continue;
          errorMessage =
            err instanceof Error ? err.message : t('liveSearch.error.readBookmarksFailed');
          loading = false;
          deps.onStateChanged();
          break;
        }

        if (deps.isDisposed() || generation !== activeGeneration) return;
        if (hasPendingReload) continue;

        if (!outcome.ok) {
          errorMessage = outcome.error.message;
        } else {
          errorMessage = undefined;
          rawCollection = outcome.value;
          syncResolvedCollection();
          if (currentCollection) {
            deps.onCollectionResolved(currentCollection);
          }
        }

        loading = false;

        if (!deps.isLeagueResolved()) {
          await deps.resolveInitialLeague();
        }

        deps.onStateChanged();
        if (hasPendingReload) continue;
        break;
      }
    } finally {
      isReloading = false;
      reloadDrainPromise = null;
    }
  }

  function scheduleReload(): void {
    if (deps.isDisposed() || !source) return;
    if (isReloading) {
      hasPendingReload = true;
      return;
    }
    isReloading = true;
    reloadDrainPromise = runReloadLoop();
  }

  async function waitForDrain(): Promise<void> {
    while (!deps.isDisposed() && (isReloading || hasPendingReload)) {
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

  return {
    getCurrentCollection: () => currentCollection,
    isLoading: () => loading,
    getErrorMessage: () => errorMessage,
    isReloadPending: () => isReloading || hasPendingReload,
    syncResolvedCollection,
    scheduleReload,
    waitForDrain,
    dispose() {
      activeGeneration++;
      reloadDrainPromise = null;
    },
  };
}
