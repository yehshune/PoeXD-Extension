import type { PreferencesModule } from '@/utils/preferences';
import type {
  LiveSearchResumeIdentity,
  LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';
import type { LiveSearchBatchOutcome } from './types';

export interface LiveSearchStartupResumeDeps {
  resumeStore: LiveSearchResumeStore;
  preferences: PreferencesModule;
  isDisposed: () => boolean;
  isReady: () => boolean;
  getStateVersion: () => number;
  syncResumePlan: (identities: readonly LiveSearchResumeIdentity[]) => void;
  clearPreviousForCurrentLeague: () => Promise<boolean>;
  pruneCurrentLeague: () => Promise<void>;
  getActionablePreviousIds: () => Promise<string[]>;
  runAutoRestore: (sourceIds: readonly string[]) => Promise<LiveSearchBatchOutcome>;
  onAutoRestoreOutcome: (outcome: LiveSearchBatchOutcome) => void;
}

export interface LiveSearchStartupResume {
  evaluate(): void;
  hasExecuted(): boolean;
  dispose(): void;
}

/**
 * Source Engine 內部的啟動恢復策略狀態機（不對外匯出 seam）。
 *
 * 確保每個主控台 document 僅在書籤、聯盟與 LiveSearch Resume Plan 均就緒後執行一次
 * `liveSearchResumeMode` 決策（off / prompt / auto），並集中維護失敗防呆與延遲讀取競態防護。
 */
export function createLiveSearchStartupResume(
  deps: LiveSearchStartupResumeDeps,
): LiveSearchStartupResume {
  let executed = false;
  let executing = false;
  let disposed = false;

  async function run(): Promise<void> {
    if (executed || executing || disposed || deps.isDisposed()) return;
    executing = true;
    try {
      while (!executed && !disposed && !deps.isDisposed()) {
        if (!deps.isReady()) {
          break;
        }

        const versionBeforeRead = deps.getStateVersion();
        const readOutcome = await deps.resumeStore.read();
        if (disposed || deps.isDisposed()) return;

        if (!readOutcome.ok) {
          if (deps.getStateVersion() !== versionBeforeRead) continue;
          break;
        }

        if (deps.getStateVersion() !== versionBeforeRead || !deps.isReady()) {
          continue;
        }

        deps.syncResumePlan(readOutcome.value.identities);

        const mode = deps.preferences.read().liveSearchResumeMode;
        if (mode === 'off') {
          executed = true;
          await deps.clearPreviousForCurrentLeague();
          return;
        }

        await deps.pruneCurrentLeague();
        if (disposed || deps.isDisposed()) return;

        executed = true;

        if (mode !== 'auto') {
          return;
        }

        const actionableIds = await deps.getActionablePreviousIds();
        if (disposed || deps.isDisposed() || actionableIds.length === 0) {
          return;
        }

        const outcome = await deps.runAutoRestore(actionableIds);
        if (!disposed && !deps.isDisposed()) {
          deps.onAutoRestoreOutcome(outcome);
        }
        return;
      }
    } finally {
      executing = false;
    }
  }

  return {
    evaluate() {
      if (executed || executing || disposed || deps.isDisposed()) return;
      void run();
    },
    hasExecuted() {
      return executed;
    },
    dispose() {
      disposed = true;
    },
  };
}
