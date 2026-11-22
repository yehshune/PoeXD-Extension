import { describe, expect, it } from 'vitest';
import {
  buildLiveSearchSourceSnapshot,
  type BuildLiveSearchSnapshotInput,
} from '@/entrypoints/content/logic/live-search-sources/snapshot-builder';
import {
  PREVIOUS_SOURCE_ID_PREFIX,
  SESSION_SOURCE_ID_PREFIX,
  type SessionConnectionMeta,
} from '@/entrypoints/content/logic/live-search-sources/types';
import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import type { LiveSearchSubscription } from '@/utils/live-search-contract';
import type { LiveSearchResumeIdentity } from '@/utils/live-search-resume-store';

const VALID_COVER = 'https://web.poecdn.com/gen/image/item.png';

function createBaseSnapshotInput(
  overrides: Partial<BuildLiveSearchSnapshotInput> = {},
): BuildLiveSearchSnapshotInput {
  return {
    loading: false,
    errorMessage: undefined,
    isLeagueResolved: true,
    isSwitchingLeague: false,
    selectedLeague: 'Standard',
    availableLeagues: ['Standard'],
    primaryContext: { gameVersion: 'poe1', runtimeLeague: null },
    hasSource: true,
    currentCollection: { groups: [], bookmarks: [] },
    currentLiveSubscriptions: [],
    temporarySearches: [],
    sessionEntriesByKey: new Map(),
    pendingSearchKeys: new Set(),
    combinedResumeMap: new Map(),
    peekCriteriaKey: () => undefined,
    ...overrides,
  };
}

describe('live-search-snapshot-builder', () => {
  describe('buildLiveSearchSourceSnapshot', () => {
    it('未解析聯盟或初始載入中回傳 loading snapshot', () => {
      const res = buildLiveSearchSourceSnapshot(
        createBaseSnapshotInput({ loading: true, isLeagueResolved: false }),
      );
      expect(res.snapshot.loading).toBe(true);
      expect(res.snapshot.groups).toEqual([]);
      expect(res.previousConnectionsSignature).toBeUndefined();
    });

    it('僅依目前聯盟投影同版本書籤並裁切空資料夾，損毀階層安全降級為 root', () => {
      const collection: BookmarkCollectionView = {
        groups: [
          { id: 'empty_root', name: 'Empty', gameVersion: 'poe1', order: 0 },
          { id: 'parent', name: 'Parent', gameVersion: 'poe1', order: 1 },
          { id: 'child', name: 'Child', parentId: 'parent', gameVersion: 'poe1', order: 0 },
          { id: 'cycle_a', name: 'CycleA', parentId: 'cycle_b', gameVersion: 'poe1', order: 2 },
          { id: 'cycle_b', name: 'CycleB', parentId: 'cycle_a', gameVersion: 'poe1', order: 3 },
        ],
        bookmarks: [
          {
            id: 'b_std',
            searchRecordId: 'sr_std',
            gameVersion: 'poe1',
            order: 0,
            name: 'Std Item',
            url: 'https://www.pathofexile.com/trade/search/Standard/AbCd1234Ef',
            groupId: 'child',
            coverImageUrl: VALID_COVER,
          },
          {
            id: 'b_hc',
            searchRecordId: 'sr_hc',
            gameVersion: 'poe1',
            order: 1,
            name: 'HC Item',
            url: 'https://www.pathofexile.com/trade/search/Hardcore/HcId1234Ef',
            groupId: 'empty_root',
          },
          {
            id: 'b_cycle',
            searchRecordId: 'sr_cycle',
            gameVersion: 'poe1',
            order: 2,
            name: 'Cycle Item',
            url: 'https://www.pathofexile.com/trade/search/Standard/CyCl1234Ef',
            groupId: 'cycle_a',
          },
          {
            id: 'b_orphan_folder',
            searchRecordId: 'sr_orphan',
            gameVersion: 'poe1',
            order: 3,
            name: 'Ungrouped Item',
            url: 'https://www.pathofexile.com/trade/search/Standard/UnGr1234Ef',
            groupId: 'nonexistent',
          },
        ],
      };

      const { snapshot } = buildLiveSearchSourceSnapshot(
        createBaseSnapshotInput({ currentCollection: collection }),
      );

      expect(snapshot.groups.map((g) => g.id)).toEqual([
        'parent',
        'child',
        'cycle_a',
        'default_ungrouped',
      ]);
      const childGroup = snapshot.groups.find((g) => g.id === 'child')!;
      expect(childGroup.items.map((i) => i.id)).toEqual(['b_std']);
      expect(childGroup.items[0].coverImageUrl).toBe(VALID_COVER);
      expect(snapshot.groups.find((g) => g.id === 'cycle_a')?.depth).toBe(0);
    });

    it('投影 sessionConnections 與 previousConnections，並略過已刪除書籤之孤兒 resume', () => {
      const sessionEntriesByKey = new Map<string, SessionConnectionMeta>([
        [
          'poe1:standard:SeSs1234Ef',
          {
            canonicalKey: 'poe1:standard:SeSs1234Ef',
            canonicalIdentity: { gameVersion: 'poe1', league: 'Standard', searchId: 'SeSs1234Ef' },
            name: 'Session Custom',
            url: 'https://www.pathofexile.com/trade/search/Standard/SeSs1234Ef',
            coverImageUrl: VALID_COVER,
          },
        ],
      ]);

      const combinedResumeMap = new Map<string, LiveSearchResumeIdentity>([
        // 已在本次連線中 -> 不應出現在上次連線
        [
          'poe1:standard:SeSs1234Ef',
          {
            gameVersion: 'poe1',
            league: 'Standard',
            searchId: 'SeSs1234Ef',
            name: 'Session Custom',
          },
        ],
        // 孤兒書籤 resume（無 name/url 且書籤已不存在）-> 應略過
        [
          'poe1:standard:OrPh1234Ef',
          { gameVersion: 'poe1', league: 'Standard', searchId: 'OrPh1234Ef' },
        ],
        // 獨立保存 name/url 的暫時搜尋 -> 應出現並帶 prev_ 前綴
        [
          'poe1:standard:PrEv1234Ef',
          {
            gameVersion: 'poe1',
            league: 'Standard',
            searchId: 'PrEv1234Ef',
            name: 'Prev Custom',
            url: 'https://www.pathofexile.com/trade/search/Standard/PrEv1234Ef',
            coverImageUrl: 'https://evil.example.com/bad.png',
          },
        ],
      ]);

      const { snapshot, previousConnectionsSignature } = buildLiveSearchSourceSnapshot(
        createBaseSnapshotInput({ sessionEntriesByKey, combinedResumeMap }),
      );

      expect(snapshot.sessionConnections).toHaveLength(1);
      expect(snapshot.sessionConnections![0].id).toBe(
        `${SESSION_SOURCE_ID_PREFIX}poe1:standard:SeSs1234Ef`,
      );
      expect(snapshot.sessionConnections![0].coverImageUrl).toBe(VALID_COVER);

      expect(snapshot.previousConnections).toHaveLength(1);
      expect(snapshot.previousConnections![0].id).toBe(
        `${PREVIOUS_SOURCE_ID_PREFIX}poe1:standard:PrEv1234Ef`,
      );
      expect(snapshot.previousConnections![0].coverImageUrl).toBeUndefined();
      expect(previousConnectionsSignature).toBe(
        `${PREVIOUS_SOURCE_ID_PREFIX}poe1:standard:PrEv1234Ef`,
      );
    });
  });
});
