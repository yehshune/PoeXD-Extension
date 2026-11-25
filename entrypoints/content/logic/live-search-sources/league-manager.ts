import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import type { PoeVersion } from '@/utils/trade-context';
import { parseTradeSearchUrl, stripLiveSuffix } from '@/utils/trade-search-identity';
import type { LiveSearchPrimaryController } from '@/utils/live-search-contract';
import type {
  LiveSearchResumeIdentity,
  LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';
import { fetchTradeLeagues, type TradeLeague } from '@/utils/trade-leagues';
import type { PreferencesModule } from '@/utils/preferences';
import { sameLeague } from './source-filters';
import type { TemporarySearchRecord } from './types';

export interface LiveSearchLeagueManagerDeps {
  hasSource: boolean;
  isDisposed: () => boolean;
  isLoading: () => boolean;
  isReloadPending: () => boolean;
  waitForReloadDrain: () => Promise<void>;
  getGameVersion: () => PoeVersion;
  getCurrentCollection: () => BookmarkCollectionView | null;
  getTemporarySearches: () => readonly TemporarySearchRecord[];
  getLatestResumeIdentities: () => readonly LiveSearchResumeIdentity[];
  onSelectedLeagueChanged: (league: string) => void;
  notify: () => void;
  liveController: Pick<LiveSearchPrimaryController, 'teardownAll'>;
  preferences: PreferencesModule | null;
  resumeStore: LiveSearchResumeStore | null;
  initialLeague?: string;
  fetchLeagues?: (version: PoeVersion) => Promise<TradeLeague[]>;
  /** 是否允許自動呼叫官方 API 取得聯盟清單（由環境 seam 注入，預設 false） */
  canFetchOfficialLeagues?: boolean;
}

export interface LiveSearchLeagueManager {
  getRawSelectedLeague(): string;
  getSelectedLeague(): string;
  isResolved(): boolean;
  isSwitching(): boolean;
  getTransitionGeneration(): number;
  getAvailableLeagues(): readonly string[];
  resolveInitialLeague(): Promise<void>;
  ensureStartupResolved(): Promise<void>;
  switchLeague(targetLeague: string): Promise<boolean>;
  startStartupTasks(): void;
  dispose(): void;
}

export function createLiveSearchLeagueManager(
  deps: LiveSearchLeagueManagerDeps,
): LiveSearchLeagueManager {
  let selectedLeague: string =
    deps.initialLeague?.trim() || deps.preferences?.read().liveSearchSelectedLeague?.trim() || '';
  let hasExplicitLeague = Boolean(selectedLeague);
  let isLeagueResolved = hasExplicitLeague;
  let isFetchingOfficialLeagues = false;
  let officialLeagues: string[] = [];
  let officialLeaguesPromise: Promise<void> | null = null;
  let initialResolutionPromise: Promise<void> | null = null;
  let isSwitchingLeague = false;
  let transitionGeneration = 0;
  let currentSwitchId = 0;
  let switchChain: Promise<boolean> = Promise.resolve(true);
  let pendingTargetLeague: string | null = null;

  function setSelectedLeague(league: string): void {
    selectedLeague = league;
    deps.onSelectedLeagueChanged(league);
  }

  function getAvailableLeagues(): readonly string[] {
    const set = new Set<string>();
    const result: string[] = [];
    const currentGameVersion = deps.getGameVersion();

    function addLeague(l: string | null | undefined) {
      if (!l) return;
      const trimmed = l.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (!set.has(lower)) {
        set.add(lower);
        result.push(trimmed);
      }
    }

    for (const ol of officialLeagues) {
      addLeague(ol);
    }

    const currentCollection = deps.getCurrentCollection();
    if (currentCollection) {
      for (const b of currentCollection.bookmarks) {
        const cleanUrl = stripLiveSuffix(b.url);
        const parsed = parseTradeSearchUrl(cleanUrl);
        if (parsed && parsed.gameVersion === currentGameVersion) {
          addLeague(parsed.league);
        }
      }
    }

    for (const c of deps.getTemporarySearches()) {
      if (c.canonicalIdentity.gameVersion === currentGameVersion) {
        addLeague(c.canonicalIdentity.league);
      }
    }

    for (const r of deps.getLatestResumeIdentities()) {
      if (r.gameVersion === currentGameVersion) {
        addLeague(r.league);
      }
    }

    if (selectedLeague) {
      addLeague(selectedLeague);
    }
    addLeague('Standard');

    return Object.freeze(result);
  }

  async function resolveInitialLeague(): Promise<void> {
    if (isLeagueResolved) return;

    // 1. persisted recent selected league
    const prefLeague = deps.preferences?.read().liveSearchSelectedLeague?.trim();
    if (prefLeague) {
      setSelectedLeague(prefLeague);
      hasExplicitLeague = true;
      isLeagueResolved = true;
      return;
    }

    // 2. Resume Store league
    if (deps.resumeStore) {
      try {
        const res = await deps.resumeStore.read();
        const currentGameVersion = deps.getGameVersion();
        if (res.ok && res.value.identities.length > 0) {
          const match = res.value.identities.find((id) => id.gameVersion === currentGameVersion);
          if (match && match.league.trim()) {
            setSelectedLeague(match.league.trim());
            hasExplicitLeague = true;
            isLeagueResolved = true;
            return;
          }
        }
      } catch {}
    }

    // 3. authoritative Bookmark league (由 currentCollection 提供)
    const currentCollection = deps.getCurrentCollection();
    const currentGameVersion = deps.getGameVersion();
    if (currentCollection && currentCollection.bookmarks.length > 0) {
      for (const b of currentCollection.bookmarks) {
        const cleanUrl = stripLiveSuffix(b.url);
        const parsed = parseTradeSearchUrl(cleanUrl);
        if (parsed && parsed.gameVersion === currentGameVersion && parsed.league.trim()) {
          setSelectedLeague(parsed.league.trim());
          hasExplicitLeague = true;
          isLeagueResolved = true;
          return;
        }
      }
    }

    // 4. official league
    if (officialLeagues.length > 0 && officialLeagues[0].trim()) {
      setSelectedLeague(officialLeagues[0].trim());
      hasExplicitLeague = true;
      isLeagueResolved = true;
      return;
    }

    if (deps.hasSource && deps.isLoading()) {
      return;
    }

    if (isFetchingOfficialLeagues) {
      return;
    }

    // 5. 最終 fallback Standard
    setSelectedLeague('Standard');
    isLeagueResolved = true;
  }

  function startStartupTasks(): void {
    if (!isLeagueResolved) {
      initialResolutionPromise = resolveInitialLeague().then(() => {
        if (!deps.isDisposed() && isLeagueResolved) deps.notify();
      });
    }

    isFetchingOfficialLeagues = true;
    officialLeaguesPromise = (async () => {
      try {
        const currentGameVersion = deps.getGameVersion();
        if (deps.fetchLeagues) {
          const list = await deps.fetchLeagues(currentGameVersion);
          if (!deps.isDisposed() && Array.isArray(list)) {
            officialLeagues = list.map((l) => l.id).filter(Boolean);
          }
        } else if (deps.canFetchOfficialLeagues) {
          const list = await fetchTradeLeagues(currentGameVersion);
          if (!deps.isDisposed() && Array.isArray(list)) {
            officialLeagues = list.map((l) => l.id).filter(Boolean);
          }
        }
      } catch {
      } finally {
        isFetchingOfficialLeagues = false;
        if (!isLeagueResolved && !deps.isDisposed()) {
          await resolveInitialLeague();
        }
        if (!deps.isDisposed()) {
          deps.notify();
        }
      }
    })();
  }

  async function ensureStartupResolved(): Promise<void> {
    if (isLeagueResolved) return;
    if (initialResolutionPromise) {
      await initialResolutionPromise;
    }
    if (deps.hasSource && (deps.isReloadPending() || deps.isLoading())) {
      await deps.waitForReloadDrain();
    }
    if (officialLeaguesPromise) {
      await officialLeaguesPromise;
    }
    if (!isLeagueResolved) {
      await resolveInitialLeague();
      if (!isLeagueResolved) {
        setSelectedLeague('Standard');
        isLeagueResolved = true;
      }
    }
  }

  async function switchLeague(targetLeague: string): Promise<boolean> {
    if (deps.isDisposed()) return false;
    const trimmed = targetLeague.trim();
    if (!trimmed) return false;

    if (!isSwitchingLeague && sameLeague(trimmed, selectedLeague)) {
      return true;
    }
    if (isSwitchingLeague && pendingTargetLeague && sameLeague(trimmed, pendingTargetLeague)) {
      return switchChain;
    }

    pendingTargetLeague = trimmed;
    const switchId = ++currentSwitchId;
    transitionGeneration++;
    isSwitchingLeague = true;
    deps.notify();

    const runSwitch = async (): Promise<boolean> => {
      try {
        if (switchId !== currentSwitchId || deps.isDisposed()) {
          return false;
        }
        await deps.liveController.teardownAll();
        if (switchId !== currentSwitchId || deps.isDisposed()) {
          return false;
        }
        await deps.liveController.teardownAll({ targetLeague: trimmed });
        setSelectedLeague(trimmed);
        hasExplicitLeague = true;
        isLeagueResolved = true;
        if (deps.preferences) {
          try {
            await deps.preferences.update({ liveSearchSelectedLeague: trimmed });
          } catch {}
        }
        if (switchId !== currentSwitchId || deps.isDisposed()) {
          return false;
        }
        return true;
      } catch (err) {
        if (switchId === currentSwitchId) {
          console.error('[PoeXD LiveSearch] Failed to switch league:', err);
        }
        return false;
      } finally {
        if (switchId === currentSwitchId) {
          isSwitchingLeague = false;
          pendingTargetLeague = null;
          try {
            await deps.liveController.teardownAll();
          } catch {}
          deps.notify();
        }
      }
    };

    const nextChain = switchChain.then(runSwitch, runSwitch);
    switchChain = nextChain.catch(() => false);
    return nextChain;
  }

  return {
    getRawSelectedLeague: () => selectedLeague,
    getSelectedLeague: () => selectedLeague || 'Standard',
    isResolved: () => isLeagueResolved,
    isSwitching: () => isSwitchingLeague,
    getTransitionGeneration: () => transitionGeneration,
    getAvailableLeagues,
    resolveInitialLeague,
    ensureStartupResolved,
    switchLeague,
    startStartupTasks,
    dispose() {
      isSwitchingLeague = false;
      pendingTargetLeague = null;
    },
  };
}
