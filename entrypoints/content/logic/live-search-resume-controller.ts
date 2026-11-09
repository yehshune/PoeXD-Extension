import type { PoeVersion } from '@/utils/trade-context';
import type { PreferencesModule } from '@/utils/preferences';
import type {
  LiveSearchBatchOutcome,
  LiveSearchSourceController,
  LiveSearchSourceSnapshot,
} from './live-search-bookmark-controller';
import {
  getResumeCanonicalKey,
  type LiveSearchResumePlanData,
  type LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';

export type LiveSearchResumeState =
  | 'idle'
  | 'waiting'
  | 'prompted'
  | 'restoring'
  | 'restored'
  | 'skipped'
  | 'off';

export interface LiveSearchResumeSnapshot {
  state: LiveSearchResumeState;
  resumableCount: number;
  resumableSourceIds: readonly string[];
  bannerVisible: boolean;
  hasPersistedPlan: boolean;
  autoRestoreOutcome?: LiveSearchBatchOutcome | null;
}

export interface LiveSearchResumeControllerOptions {
  version: PoeVersion;
  preferences: PreferencesModule;
  sourceController: LiveSearchSourceController;
  resumeStore: LiveSearchResumeStore;
}

export interface LiveSearchResumeController {
  readonly version: PoeVersion;
  read(): Readonly<LiveSearchResumeSnapshot>;
  subscribe(listener: (snapshot: Readonly<LiveSearchResumeSnapshot>) => void): () => void;
  restore(): Promise<LiveSearchBatchOutcome | null>;
  skip(): void;
  clear(): Promise<boolean>;
  dispose(): void;
}

export function createLiveSearchResumeController(
  options: LiveSearchResumeControllerOptions,
): LiveSearchResumeController {
  const { version, preferences, sourceController, resumeStore } = options;
  const listeners = new Set<(snapshot: Readonly<LiveSearchResumeSnapshot>) => void>();

  let state: LiveSearchResumeState = 'idle';
  let resumableCount = 0;
  let resumableSourceIds: string[] = [];
  let bannerVisible = false;
  let hasPersistedPlan = false;
  let hasExecutedStartupDecision = false;
  let isExecutingStartupDecision = false;
  let disposed = false;
  let autoRestoreOutcome: LiveSearchBatchOutcome | null = null;

  let latestSourceSnapshot: Readonly<LiveSearchSourceSnapshot> | null = null;
  let unsubSource: (() => void) | null = null;
  let unsubStore: (() => void) | null = null;

  let startupLeague: string | null = null;

  function buildSnapshot(): Readonly<LiveSearchResumeSnapshot> {
    return Object.freeze({
      state,
      resumableCount,
      resumableSourceIds: [...resumableSourceIds],
      bannerVisible,
      hasPersistedPlan,
      autoRestoreOutcome,
    });
  }

  function notify(): void {
    if (disposed) return;
    const snap = buildSnapshot();
    for (const listener of Array.from(listeners)) {
      try {
        listener(snap);
      } catch (err) {
        console.error('[PoeXD ResumeController] Error in listener:', err);
      }
    }
  }

  function findMatchingSourceIds(
    plan: LiveSearchResumePlanData,
    snapshot: Readonly<LiveSearchSourceSnapshot>,
    targetLeague?: string,
  ): string[] {
    const bookmarkItems = snapshot.groups
      .filter((g) => g.kind === 'bookmark')
      .flatMap((g) => g.items)
      .filter((item) => item.kind === 'bookmark');

    const leagueFilter = (targetLeague ?? snapshot.selectedLeague)?.trim().toLowerCase();
    const filteredIdentities = leagueFilter
      ? plan.identities.filter((id) => id.league.trim().toLowerCase() === leagueFilter)
      : plan.identities;

    const planByKey = new Map<string, (typeof filteredIdentities)[number]>();
    for (const id of filteredIdentities) {
      const key = getResumeCanonicalKey(id);
      if (!planByKey.has(key)) {
        planByKey.set(key, id);
      }
    }

    const seenIds = new Set<string>();
    const seenCanonicalKeys = new Set<string>();
    const matchingIds: string[] = [];

    const bookmarksByCanonicalKey = new Map<string, typeof bookmarkItems>();
    for (const b of bookmarkItems) {
      if (!b.canonicalKey || !planByKey.has(b.canonicalKey)) continue;
      const list = bookmarksByCanonicalKey.get(b.canonicalKey);
      if (list) {
        list.push(b);
      } else {
        bookmarksByCanonicalKey.set(b.canonicalKey, [b]);
      }
    }

    for (const [canonicalKey, candidates] of bookmarksByCanonicalKey.entries()) {
      if (seenCanonicalKeys.has(canonicalKey)) continue;
      seenCanonicalKeys.add(canonicalKey);

      const planEntry = planByKey.get(canonicalKey);
      const preferred =
        (planEntry?.name ? candidates.find((c) => c.name === planEntry.name) : undefined) ??
        candidates[0];

      if (!preferred || seenIds.has(preferred.id)) continue;

      // resumableSourceIds / resumableCount 必須表示「目前真的可恢復」：
      // 排除已 active, connecting, reconnecting, 已存在 error subscription, pending,
      // 或任何 enableMany preflight 會跳過的非 compatible 來源。
      const isActionable =
        (!preferred.status || preferred.status === 'idle' || preferred.status === 'closed') &&
        !preferred.pending &&
        preferred.compatibility === 'compatible';

      if (isActionable) {
        seenIds.add(preferred.id);
        matchingIds.push(preferred.id);
      }
    }

    for (const prev of snapshot.previousConnections ?? []) {
      if (
        prev.canonicalKey &&
        planByKey.has(prev.canonicalKey) &&
        !seenCanonicalKeys.has(prev.canonicalKey) &&
        !seenIds.has(prev.id)
      ) {
        seenCanonicalKeys.add(prev.canonicalKey);
        const isActionable =
          (!prev.status || prev.status === 'idle' || prev.status === 'closed') &&
          !prev.pending &&
          prev.compatibility === 'compatible';
        if (isActionable) {
          seenIds.add(prev.id);
          matchingIds.push(prev.id);
        }
      }
    }
    return matchingIds;
  }

  async function runStartupDecision(): Promise<void> {
    if (isExecutingStartupDecision || hasExecutedStartupDecision || disposed) {
      return;
    }
    isExecutingStartupDecision = true;

    try {
      while (!hasExecutedStartupDecision && !disposed) {
        const currentSnapshot = latestSourceSnapshot;
        if (
          !currentSnapshot ||
          currentSnapshot.loading ||
          currentSnapshot.error ||
          !currentSnapshot.leagueResolved
        ) {
          if (state !== 'waiting') {
            state = 'waiting';
            notify();
          }
          break;
        }

        const readOutcome = await resumeStore.read();
        if (disposed) return;

        // Resume Plan 讀取失敗防護：
        // 不 prune、不 prompt、不 auto restore、不標記 startup decision 完成
        if (!readOutcome.ok) {
          if (state !== 'waiting') {
            state = 'waiting';
            notify();
          }
          if (latestSourceSnapshot !== currentSnapshot) {
            continue;
          }
          break;
        }

        // Delayed-read race 防護：
        // 若在 await resumeStore.read() 期間 Bookmark 發生變更並產生更新的 snapshot，
        // 捨棄過期 snapshot，以最新 authoritative snapshot 重新決策
        if (latestSourceSnapshot !== currentSnapshot) {
          continue;
        }

        const plan = readOutcome.value;
        const mode = preferences.read().liveSearchResumeMode;

        if (mode === 'off') {
          hasExecutedStartupDecision = true;
          state = 'off';
          bannerVisible = false;
          resumableCount = 0;
          resumableSourceIds = [];
          if (typeof sourceController.clearPreviousConnections === 'function') {
            await sourceController.clearPreviousConnections();
            const postClearRead = await resumeStore.read();
            hasPersistedPlan = postClearRead.ok && postClearRead.value.identities.length > 0;
          } else {
            const targetLeagueNorm = (currentSnapshot.selectedLeague || '').trim().toLowerCase();
            const keysToClear = plan.identities
              .filter(
                (id) => !targetLeagueNorm || id.league.trim().toLowerCase() === targetLeagueNorm,
              )
              .map(
                (id) => `${id.gameVersion}:${id.league.trim().toLowerCase()}:${id.searchId.trim()}`,
              );
            if (keysToClear.length > 0) {
              await resumeStore.removeIdentities(keysToClear);
            }
            hasPersistedPlan = plan.identities.length > keysToClear.length;
          }
          notify();
          return;
        }

        const bookmarkItems = currentSnapshot.groups
          .filter((g) => g.kind === 'bookmark')
          .flatMap((g) => g.items);

        const validBookmarkKeys = new Set<string>();
        for (const b of bookmarkItems) {
          if (b.canonicalKey) {
            validBookmarkKeys.add(b.canonicalKey);
          }
        }

        // 1. Prune missing identities from plan for the current selected league (Section 10, 14)
        void resumeStore.pruneToAuthoritative(validBookmarkKeys, {
          league: currentSnapshot.selectedLeague,
        });

        // 2. Join plan identities with current bookmark sources (Canonical Identity Authority)
        startupLeague = currentSnapshot.selectedLeague;
        const matchingIds = findMatchingSourceIds(
          plan,
          currentSnapshot,
          currentSnapshot.selectedLeague,
        );

        hasExecutedStartupDecision = true;

        if (matchingIds.length === 0) {
          state = 'off';
          bannerVisible = false;
          resumableCount = 0;
          resumableSourceIds = [];
          notify();
          return;
        }

        resumableCount = matchingIds.length;
        resumableSourceIds = matchingIds;

        if (mode === 'prompt') {
          state = 'prompted';
          bannerVisible = true;
          notify();
        } else if (mode === 'auto') {
          state = 'restoring';
          bannerVisible = false;
          notify();

          let outcome: LiveSearchBatchOutcome | null = null;
          try {
            outcome = await sourceController.enableMany(resumableSourceIds);
          } catch (err) {
            outcome = {
              success: false,
              requested: resumableSourceIds.length,
              succeeded: 0,
              skipped: 0,
              failed: resumableSourceIds.length,
              error: err instanceof Error ? err.message : '自動恢復連線失敗',
              skipReasons: {
                alreadyActive: 0,
                pending: 0,
                incompatible: 0,
                duplicateInBatch: 0,
                inactive: 0,
                notFound: 0,
              },
              incompatibleBreakdown: { wrongLeague: 0, wrongVersion: 0, invalidUrl: 0 },
              runtimeFailureCount: resumableSourceIds.length,
            };
          } finally {
            if (!disposed) {
              autoRestoreOutcome = outcome;
              state = 'restored';
              const latestSnap = latestSourceSnapshot ?? sourceController.read();
              if (latestSnap) {
                const updatedIds = findMatchingSourceIds(
                  plan,
                  latestSnap,
                  latestSnap.selectedLeague,
                );
                resumableCount = updatedIds.length;
                resumableSourceIds = updatedIds;
              }
              notify();
            }
          }
        }
      }
    } finally {
      isExecutingStartupDecision = false;
    }
  }

  async function handleSourceSnapshot(
    sourceSnapshot: Readonly<LiveSearchSourceSnapshot>,
  ): Promise<void> {
    if (disposed) return;
    latestSourceSnapshot = sourceSnapshot;

    if (sourceSnapshot.loading) {
      if (!hasExecutedStartupDecision && state !== 'waiting') {
        state = 'waiting';
        notify();
      }
      return;
    }

    // Bookmark read failure defense (Section 11, 20):
    // 若 Bookmark collection read 失敗，不得 prune plan，不得 auto resume，不得顯示錯誤的「0項可恢復」
    if (sourceSnapshot.error) {
      if (!hasExecutedStartupDecision && state !== 'waiting') {
        state = 'waiting';
        notify();
      }
      return;
    }

    // Authoritative Bookmark collection is ready
    if (!hasExecutedStartupDecision) {
      await runStartupDecision();
      return;
    }

    // Startup 決策執行後的 Snapshot 更新（例如手動 League Switch 或書籤異動）：
    // 持續投影 current selected league 的 persisted Resume Plan ∩ authoritative Bookmark Sources
    const readOutcome = await resumeStore.read();
    if (disposed || !readOutcome.ok) return;

    const currentSnap = latestSourceSnapshot ?? sourceSnapshot;
    const isSameLeague =
      startupLeague &&
      currentSnap.selectedLeague &&
      startupLeague.trim().toLowerCase() === currentSnap.selectedLeague.trim().toLowerCase();

    const matchingIds = findMatchingSourceIds(
      readOutcome.value,
      currentSnap,
      currentSnap.selectedLeague,
    );

    const idsChanged =
      matchingIds.length !== resumableSourceIds.length ||
      matchingIds.some((id, idx) => id !== resumableSourceIds[idx]);

    if (!isSameLeague || idsChanged) {
      resumableCount = matchingIds.length;
      resumableSourceIds = matchingIds;

      if (state === 'prompted') {
        // 若手動切換至其他聯盟，startup banner 不得在切換後重新出現（本 document 只提示一次）
        if (!isSameLeague) {
          state = 'skipped';
          bannerVisible = false;
        } else if (matchingIds.length === 0) {
          state = 'off';
          bannerVisible = false;
        }
      }
      notify();
    }
  }

  // Subscribe to Resume Store updates to track hasPersistedPlan
  unsubStore = resumeStore.subscribe((plan: LiveSearchResumePlanData) => {
    const nextHasPlan = plan.identities.length > 0;
    hasPersistedPlan = nextHasPlan;
    if (hasExecutedStartupDecision && latestSourceSnapshot) {
      const matchingIds = findMatchingSourceIds(
        plan,
        latestSourceSnapshot,
        latestSourceSnapshot.selectedLeague,
      );
      resumableCount = matchingIds.length;
      resumableSourceIds = matchingIds;
      if (state === 'prompted' && matchingIds.length === 0) {
        state = 'off';
        bannerVisible = false;
      }
    }
    notify();
  });

  // Eagerly trigger store read so hasPersistedPlan is known immediately
  void resumeStore.read();

  // Subscribe to Source Controller snapshot
  unsubSource = sourceController.subscribe((snap) => {
    latestSourceSnapshot = snap;
    void handleSourceSnapshot(snap);
  });

  return {
    version,

    read(): Readonly<LiveSearchResumeSnapshot> {
      return buildSnapshot();
    },

    subscribe(listener: (snapshot: Readonly<LiveSearchResumeSnapshot>) => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      try {
        listener(buildSnapshot());
      } catch (err) {
        console.error('[PoeXD ResumeController] Error in initial listener:', err);
      }
      return () => {
        listeners.delete(listener);
      };
    },

    async restore(): Promise<LiveSearchBatchOutcome | null> {
      if (disposed || state === 'restoring') {
        return null;
      }

      // Canonical Identity Authority:
      // 恢復前一律重新讀取最新 Resume Plan ∩ 最新 Authoritative Bookmark Sources，
      // 針對目前 selected league 重新進行 canonical join，嚴禁使用過期 IDs
      const planOutcome = await resumeStore.read();
      if (!planOutcome.ok) {
        return null;
      }

      const currentSnapshot = latestSourceSnapshot ?? sourceController.read();
      const validIds = findMatchingSourceIds(
        planOutcome.value,
        currentSnapshot,
        currentSnapshot.selectedLeague,
      );

      if (validIds.length === 0) {
        if (state === 'prompted') {
          state = 'off';
          bannerVisible = false;
        }
        resumableCount = 0;
        resumableSourceIds = [];
        notify();
        return {
          success: true,
          requested: 0,
          succeeded: 0,
          skipped: 0,
          failed: 0,
          skipReasons: {
            alreadyActive: 0,
            pending: 0,
            incompatible: 0,
            duplicateInBatch: 0,
            inactive: 0,
            notFound: 0,
          },
          incompatibleBreakdown: { wrongLeague: 0, wrongVersion: 0, invalidUrl: 0 },
          runtimeFailureCount: 0,
        };
      }

      state = 'restoring';
      bannerVisible = false;
      notify();

      try {
        const outcome = await sourceController.enableMany(validIds);
        state = 'restored';
        const latestSnap = latestSourceSnapshot ?? sourceController.read();
        if (latestSnap) {
          const updatedIds = findMatchingSourceIds(
            planOutcome.value,
            latestSnap,
            latestSnap.selectedLeague,
          );
          resumableCount = updatedIds.length;
          resumableSourceIds = updatedIds;
        }
        notify();
        return outcome;
      } catch (err) {
        state = 'restored';
        notify();
        throw err;
      }
    },

    skip(): void {
      if (disposed) return;
      if (state === 'prompted') {
        state = 'skipped';
      }
      bannerVisible = false;
      notify();
    },

    async clear(): Promise<boolean> {
      if (disposed) return false;
      const success = await resumeStore.clear();
      if (!success) {
        return false;
      }

      resumableCount = 0;
      resumableSourceIds = [];
      bannerVisible = false;
      if (state === 'prompted' || state === 'waiting') {
        state = 'off';
      }
      hasPersistedPlan = false;
      notify();
      return true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubSource?.();
      unsubSource = null;
      unsubStore?.();
      unsubStore = null;
      listeners.clear();
    },
  };
}
