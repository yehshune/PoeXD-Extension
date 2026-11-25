import { describe, expect, it, vi } from 'vitest';
import {
  createLiveSearchLeagueManager,
  type LiveSearchLeagueManagerDeps,
} from '@/entrypoints/content/logic/live-search-sources/league-manager';
import type { PoeVersion } from '@/utils/trade-context';
import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import type { LiveSearchPrimaryController } from '@/utils/live-search-contract';
import type { LiveSearchResumeStore } from '@/utils/live-search-resume-store';
import type { PreferencesModule } from '@/utils/preferences';
import * as tradeLeaguesModule from '@/utils/trade-leagues';

function createFakeLiveController(
  teardownImpl?: (opts?: { targetLeague?: string }) => Promise<void>,
): LiveSearchPrimaryController {
  return {
    teardownAll: vi.fn(teardownImpl ?? (async () => {})),
  } as unknown as LiveSearchPrimaryController;
}

function createManager(overrides: Partial<LiveSearchLeagueManagerDeps> = {}) {
  const onSelectedLeagueChanged = vi.fn();
  const notify = vi.fn();
  const liveController = overrides.liveController ?? createFakeLiveController();
  const manager = createLiveSearchLeagueManager({
    hasSource: false,
    isDisposed: () => false,
    isLoading: () => false,
    isReloadPending: () => false,
    waitForReloadDrain: async () => {},
    getGameVersion: () => 'poe1',
    getCurrentCollection: () => null,
    getTemporarySearches: () => [],
    getLatestResumeIdentities: () => [],
    onSelectedLeagueChanged,
    notify,
    liveController,
    preferences: null,
    resumeStore: null,
    ...overrides,
  });
  return { manager, notify, liveController, onSelectedLeagueChanged };
}

describe('live-search-league-manager', () => {
  describe('initial league resolution priority', () => {
    it('initialLeague 直接視為已解析，不觸發 fallback', async () => {
      const { manager } = createManager({ initialLeague: '  Keepers  ' });
      expect(manager.isResolved()).toBe(true);
      expect(manager.getRawSelectedLeague()).toBe('Keepers');
      expect(manager.getSelectedLeague()).toBe('Keepers');
      await manager.resolveInitialLeague();
      expect(manager.getSelectedLeague()).toBe('Keepers');
    });

    it('依序採用 preferences > resumeStore > bookmark > officialLeagues > Standard', async () => {
      const preferences = {
        read: () => ({ liveSearchSelectedLeague: 'Mercenaries' }),
        update: vi.fn(async () => {}),
      } as unknown as PreferencesModule;

      const { manager: fromPref } = createManager({ preferences });
      expect(fromPref.getSelectedLeague()).toBe('Mercenaries');

      const resumeStore = {
        read: vi.fn(async () => ({
          ok: true as const,
          value: {
            identities: [
              { gameVersion: 'poe1' as const, league: 'Hardcore', searchId: 'AbCd1234Ef' },
            ],
          },
        })),
      } as unknown as LiveSearchResumeStore;

      const { manager: fromResume } = createManager({ resumeStore });
      await fromResume.resolveInitialLeague();
      expect(fromResume.getSelectedLeague()).toBe('Hardcore');

      const collection: BookmarkCollectionView = {
        groups: [],
        bookmarks: [
          {
            id: 'b1',
            searchRecordId: 'sr_b1',
            gameVersion: 'poe1',
            order: 0,
            name: 'Ring',
            url: 'https://www.pathofexile.com/trade/search/Settlers/AbCd1234Ef',
            groupId: 'g1',
          },
        ],
      };
      const { manager: fromBookmark } = createManager({
        getCurrentCollection: () => collection,
      });
      await fromBookmark.resolveInitialLeague();
      expect(fromBookmark.getSelectedLeague()).toBe('settlers');

      const { manager: fromFallback } = createManager();
      await fromFallback.resolveInitialLeague();
      expect(fromFallback.getSelectedLeague()).toBe('Standard');
    });

    it('等待 resumeStore.read() 期間若 gameVersion 更新，解析時讀取最新 gameVersion', async () => {
      let version: PoeVersion = 'poe1';
      let resolveRead!: () => void;
      const resumeStore = {
        read: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveRead = () =>
                resolve({
                  ok: true as const,
                  value: {
                    identities: [
                      {
                        gameVersion: 'poe2' as const,
                        league: 'Dawn of the Hunt',
                        searchId: 'AbCd1234Ef',
                      },
                    ],
                  },
                });
            }),
        ),
      } as unknown as LiveSearchResumeStore;

      const { manager } = createManager({
        getGameVersion: () => version,
        resumeStore,
      });

      const pending = manager.resolveInitialLeague();
      version = 'poe2';
      resolveRead();
      await pending;

      expect(manager.getSelectedLeague()).toBe('Dawn of the Hunt');
    });
  });

  describe('getAvailableLeagues', () => {
    it('彙整官方、書籤、暫時搜尋、resume 與當前聯盟並去重，最後固定補 Standard', async () => {
      const collection: BookmarkCollectionView = {
        groups: [],
        bookmarks: [
          {
            id: 'b1',
            searchRecordId: 'sr_b1',
            gameVersion: 'poe1',
            order: 0,
            name: 'B1',
            url: 'https://www.pathofexile.com/trade/search/Hardcore/AbCd1234Ef',
            groupId: 'g1',
          },
          {
            id: 'b2',
            searchRecordId: 'sr_b2',
            gameVersion: 'poe2',
            order: 1,
            name: 'PoE2',
            url: 'https://www.pathofexile.com/trade2/search/poe2/Dawn/AbCd1234Ef',
            groupId: 'g1',
          },
        ],
      };
      const { manager } = createManager({
        initialLeague: 'Keepers',
        fetchLeagues: async () => [
          { id: 'Keepers', text: 'Keepers' },
          { id: 'keepers', text: 'keepers dup' },
        ],
        getCurrentCollection: () => collection,
        getLatestResumeIdentities: () => [
          { gameVersion: 'poe1', league: 'SSF Standard', searchId: 'AbCd1234Ef' },
        ],
      });

      manager.startStartupTasks();
      await manager.ensureStartupResolved();
      // 等待 officialLeaguesPromise 完成
      await Promise.resolve();

      expect(manager.getAvailableLeagues()).toEqual([
        'Keepers',
        'hardcore',
        'SSF Standard',
        'Standard',
      ]);
    });

    it('僅在 canFetchOfficialLeagues 為 true 且未提供自訂 fetchLeagues 時自動呼叫官方聯盟 API', async () => {
      const fetchSpy = vi
        .spyOn(tradeLeaguesModule, 'fetchTradeLeagues')
        .mockResolvedValue([{ id: 'Keepers', text: 'Keepers' }]);

      try {
        const { manager: disabled } = createManager({ canFetchOfficialLeagues: false });
        disabled.startStartupTasks();
        await disabled.ensureStartupResolved();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(disabled.getAvailableLeagues()).not.toContain('Keepers');

        const { manager: enabled } = createManager({ canFetchOfficialLeagues: true });
        enabled.startStartupTasks();
        await enabled.ensureStartupResolved();
        expect(fetchSpy).toHaveBeenCalledWith('poe1');
        expect(enabled.getAvailableLeagues()).toContain('Keepers');
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('switchLeague', () => {
    it('同聯盟不重複切換；切換成功會遞增 generation 並寫入 preferences', async () => {
      const preferences = {
        read: () => ({ liveSearchSelectedLeague: 'Standard' }),
        update: vi.fn(async () => {}),
      } as unknown as PreferencesModule;

      const { manager, liveController, onSelectedLeagueChanged } = createManager({
        initialLeague: 'Standard',
        preferences,
      });

      expect(await manager.switchLeague('  standard  ')).toBe(true);
      expect(manager.getTransitionGeneration()).toBe(0);

      expect(await manager.switchLeague('Hardcore')).toBe(true);
      expect(manager.getTransitionGeneration()).toBe(1);
      expect(manager.getSelectedLeague()).toBe('Hardcore');
      expect(manager.isSwitching()).toBe(false);
      expect(onSelectedLeagueChanged).toHaveBeenCalledWith('Hardcore');
      expect(preferences.update).toHaveBeenCalledWith({ liveSearchSelectedLeague: 'Hardcore' });
      expect(liveController.teardownAll).toHaveBeenCalledWith({ targetLeague: 'Hardcore' });
    });

    it('快速連續切換時舊請求被 supersede 回傳 false，最新請求生效', async () => {
      let releaseFirst!: () => void;
      let calls = 0;
      const liveController = createFakeLiveController(async () => {
        calls++;
        if (calls === 1) {
          await new Promise<void>((r) => {
            releaseFirst = r;
          });
        }
      });

      const { manager } = createManager({ initialLeague: 'Standard', liveController });
      const p1 = manager.switchLeague('Hardcore');
      await Promise.resolve();
      const p2 = manager.switchLeague('SSF Standard');

      releaseFirst();
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe(false);
      expect(r2).toBe(true);
      expect(manager.getSelectedLeague()).toBe('SSF Standard');
      expect(manager.isSwitching()).toBe(false);
    });
  });
});
