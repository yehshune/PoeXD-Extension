import { describe, expect, it } from 'vitest';
import { createLiveSearchConnectionRegistry } from '@/entrypoints/content/logic/live-search-sources/connection-registry';
import { buildLiveSearchSourceSnapshot } from '@/entrypoints/content/logic/live-search-sources/snapshot-builder';
import {
  CUSTOM_SOURCE_GROUP_ID,
  PREVIOUS_SOURCE_ID_PREFIX,
  SESSION_SOURCE_ID_PREFIX,
} from '@/entrypoints/content/logic/live-search-sources/types';
import type { LiveSearchSubscription } from '@/utils/live-search-contract';

const VALID_COVER = 'https://web.poecdn.com/gen/image/item.png';

describe('LiveSearchConnectionRegistry', () => {
  it('當書籤出現相同 canonical key 時將 Temporary Search 提升為 Bookmark，並回傳需補寫的 Resume Plan identities', () => {
    const registry = createLiveSearchConnectionRegistry();
    const key = 'poe1:standard:PrOm1234Ef';
    const identity = { gameVersion: 'poe1' as const, league: 'Standard', searchId: 'PrOm1234Ef' };
    const url = 'https://www.pathofexile.com/trade/search/Standard/PrOm1234Ef';

    registry.upsertCustomSource({
      canonicalKey: key,
      canonicalIdentity: identity,
      name: 'Temp',
      url,
    });
    registry.registerSessionEntry({
      canonicalKey: key,
      canonicalIdentity: identity,
      name: 'Temp',
      url,
    });

    const activeSub = {
      id: 'sub_1',
      ...identity,
      name: 'Temp',
      url,
      status: 'active',
    } as Readonly<LiveSearchSubscription>;

    const promoted = registry.reconcileOwnership(
      {
        groups: [],
        bookmarks: [
          {
            id: 'b_promoted',
            searchRecordId: 'sr_promoted',
            gameVersion: 'poe1',
            order: 0,
            name: 'Saved Bookmark',
            url,
            groupId: 'g1',
            coverImageUrl: VALID_COVER,
          },
        ],
      },
      [activeSub],
      (k) => (k === key ? activeSub : undefined),
    );

    expect(registry.getCustomSources()).toHaveLength(0);
    expect(promoted).toEqual([identity]);
    expect(registry.getSessionEntry(key)).toMatchObject({
      name: 'Saved Bookmark',
      sourceBookmarkId: 'b_promoted',
      coverImageUrl: VALID_COVER,
    });
  });

  it('當 active Bookmark 被刪除時建立 origin-bookmark-removed Temporary Search 並清除過期 sourceBookmarkId', () => {
    const registry = createLiveSearchConnectionRegistry();
    const key = 'poe1:standard:FaLl1234Ef';
    const identity = { gameVersion: 'poe1' as const, league: 'Standard', searchId: 'FaLl1234Ef' };
    const url = 'https://www.pathofexile.com/trade/search/Standard/FaLl1234Ef';

    registry.registerSessionEntry({
      canonicalKey: key,
      canonicalIdentity: identity,
      name: 'Old Bookmark',
      url,
      sourceBookmarkId: 'b_deleted',
    });

    const activeSub = {
      id: 'sub_fallback',
      ...identity,
      name: 'Old Bookmark',
      url,
      status: 'active',
    } as Readonly<LiveSearchSubscription>;

    registry.reconcileOwnership({ groups: [], bookmarks: [] }, [activeSub], (k) =>
      k === key ? activeSub : undefined,
    );

    expect(registry.getSessionEntry(key)?.sourceBookmarkId).toBeUndefined();
    expect(registry.getCustomSources()).toHaveLength(1);
    expect(registry.getCustomSources()[0]).toMatchObject({
      id: 'custom_fallback_sub_fallback',
      canonicalKey: key,
      provenance: 'origin-bookmark-removed',
    });

    const { snapshot } = buildLiveSearchSourceSnapshot({
      loading: false,
      isLeagueResolved: true,
      isSwitchingLeague: false,
      selectedLeague: 'Standard',
      availableLeagues: ['Standard'],
      primaryContext: { gameVersion: 'poe1', runtimeLeague: null },
      hasSource: true,
      currentCollection: { groups: [], bookmarks: [] },
      currentLiveSubscriptions: [activeSub],
      customSources: registry.getCustomSources(),
      sessionEntriesByKey: registry.getSessionEntries(),
      pendingSearchKeys: registry.getPendingSearchKeys(),
      combinedResumeMap: registry.buildCombinedResumeMap(),
      peekCriteriaKey: () => undefined,
    });
    expect(snapshot.groups.map((g) => g.id)).toEqual([CUSTOM_SOURCE_GROUP_ID]);
  });

  it('依聯盟清理 LiveSearch Resume Plan 上次連線並保留本次連線與其他聯盟紀錄', () => {
    const registry = createLiveSearchConnectionRegistry();
    const stdSessionKey = 'poe1:standard:SeSs1234Ef';
    const stdPrevKey = 'poe1:standard:PrEv1234Ef';
    const hcPrevKey = 'poe1:hardcore:HcPr1234Ef';

    registry.applyInitialResumeRead([
      { gameVersion: 'poe1', league: 'Standard', searchId: 'SeSs1234Ef', name: 'In Session' },
      { gameVersion: 'poe1', league: 'Standard', searchId: 'PrEv1234Ef', name: 'Std Prev' },
      { gameVersion: 'poe1', league: 'Hardcore', searchId: 'HcPr1234Ef', name: 'HC Prev' },
    ]);
    registry.registerSessionEntry({
      canonicalKey: stdSessionKey,
      canonicalIdentity: { gameVersion: 'poe1', league: 'Standard', searchId: 'SeSs1234Ef' },
      name: 'In Session',
      url: 'https://www.pathofexile.com/trade/search/Standard/SeSs1234Ef',
    });

    const removedKeys = registry.clearPreviousForLeague('Standard');
    expect(removedKeys).toEqual([stdPrevKey]);
    expect(registry.findResumeEntryByCanonicalKey(stdPrevKey)).toBeUndefined();
    expect(registry.findResumeEntryByCanonicalKey(stdSessionKey)).toBeDefined();
    expect(registry.findResumeEntryByCanonicalKey(hcPrevKey)).toBeDefined();
  });

  it('可從 session_* / prev_* 來源鍵解析並具現化 Temporary Search，並維持 preserveExistingName 語意', () => {
    const registry = createLiveSearchConnectionRegistry();
    const key = 'poe1:standard:MaTr1234Ef';
    const identity = { gameVersion: 'poe1' as const, league: 'Standard', searchId: 'MaTr1234Ef' };

    registry.applyInitialResumeRead([
      {
        ...identity,
        name: 'Saved Temp',
        url: 'https://www.pathofexile.com/trade/search/Standard/MaTr1234Ef',
      },
    ]);

    expect(registry.resolveCanonicalKeyBySourceId(`${PREVIOUS_SOURCE_ID_PREFIX}${key}`, null)).toBe(
      key,
    );
    expect(registry.resolveCanonicalKeyBySourceId(`${SESSION_SOURCE_ID_PREFIX}${key}`, null)).toBe(
      key,
    );

    const materialized = registry.ensureCustomSourceForSectionKey(key, 'Standard');
    expect(materialized).toMatchObject({ canonicalKey: key, name: 'Saved Temp' });

    const updated = registry.upsertCustomSource({
      canonicalKey: key,
      canonicalIdentity: identity,
      name: 'MaTr1234Ef',
      url: 'https://www.pathofexile.com/trade/search/Standard/MaTr1234Ef',
      preserveExistingName: true,
    });
    expect(updated.id).toBe(materialized!.id);
    expect(updated.name).toBe('Saved Temp');
  });

  it('pruneBaselineForLeague 僅移除目前聯盟中已刪除且無自訂 metadata 的書籤型 Resume 基準項目', () => {
    const registry = createLiveSearchConnectionRegistry();
    const deletedKey = 'poe1:standard:DeLeTeD123';
    const keptBookmarkKey = 'poe1:standard:KeEpBm1234';
    const namedTempKey = 'poe1:standard:TempKeep12';
    const urlTempKey = 'poe1:standard:UrlKeep123';
    const otherLeagueKey = 'poe1:hardcore:HcDeleted1';

    // 先由 store 訂閱回呼建立基準，再由較晚完成的初始讀取覆寫 latest 為空：
    // 此時項目只存在於 baselineResumeByKey，combined map 能直接反映 prune 效果。
    registry.applyResumePlanSnapshot([
      { gameVersion: 'poe1', league: 'Standard', searchId: 'DeLeTeD123' },
      { gameVersion: 'poe1', league: 'Standard', searchId: 'KeEpBm1234' },
      { gameVersion: 'poe1', league: 'Standard', searchId: 'TempKeep12', name: 'Temp Name' },
      {
        gameVersion: 'poe1',
        league: 'Standard',
        searchId: 'UrlKeep123',
        url: 'https://www.pathofexile.com/trade/search/Standard/UrlKeep123',
      },
      { gameVersion: 'poe1', league: 'Hardcore', searchId: 'HcDeleted1' },
    ]);
    registry.applyInitialResumeRead([]);
    expect(registry.buildCombinedResumeMap().has(deletedKey)).toBe(true);

    registry.pruneBaselineForLeague(new Set([keptBookmarkKey]), 'Standard');

    expect([...registry.buildCombinedResumeMap().keys()].sort()).toEqual(
      [keptBookmarkKey, namedTempKey, otherLeagueKey, urlTempKey].sort(),
    );
  });

  it('pruneBaselineForLeague 不觸碰 latestResumeIdentities（交由 store.pruneToAuthoritative 回呼更新）', () => {
    const registry = createLiveSearchConnectionRegistry();
    const deletedKey = 'poe1:standard:DeLeTeD123';
    registry.applyInitialResumeRead([
      { gameVersion: 'poe1', league: 'Standard', searchId: 'DeLeTeD123' },
    ]);

    registry.pruneBaselineForLeague(new Set(), 'Standard');

    expect(registry.getLatestResumeIdentities()).toHaveLength(1);
    expect(registry.buildCombinedResumeMap().has(deletedKey)).toBe(true);

    // store 回呼送出已修剪的 plan 後，項目才完全消失
    registry.applyResumePlanSnapshot([]);
    expect(registry.buildCombinedResumeMap().has(deletedKey)).toBe(false);
  });
});
