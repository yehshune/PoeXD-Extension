import { describe, expect, it } from 'vitest';
import {
  buildCanonicalTradeSearchUrl,
  evaluateLiveSearchSourceCompatibility,
  extractSectionSourceCanonicalKey,
  filterLiveSearchConnectionItems,
  filterLiveSearchSourceGroups,
  formatLiveSearchDisplayLeague,
  formatLiveSearchDisplayVersion,
  getBookmarkCanonicalKey,
  getLiveSearchGroupSubtreeItems,
  getLiveSearchGroupSubtreeSourceIds,
  matchesLiveSearchSourceStatusFilter,
  sameLeague,
} from '@/entrypoints/content/logic/live-search-sources/source-filters';
import {
  TEMPORARY_SOURCE_GROUP_ID,
  TEMPORARY_SOURCE_GROUP_NAME,
  PREVIOUS_SOURCE_ID_PREFIX,
  SESSION_SOURCE_ID_PREFIX,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
} from '@/entrypoints/content/logic/live-search-sources/types';

function makeItem(overrides: Partial<LiveSearchSourceItem> & { id: string }): LiveSearchSourceItem {
  return {
    kind: 'bookmark',
    name: overrides.id,
    url: `https://www.pathofexile.com/trade/search/Standard/${overrides.id}`,
    canonicalIdentity: {
      gameVersion: 'poe1',
      league: 'Standard',
      searchId: overrides.id,
    },
    canonicalKey: `poe1:standard:${overrides.id}`,
    compatibility: 'compatible',
    groupId: 'g1',
    groupName: 'Group 1',
    pending: false,
    removable: false,
    ...overrides,
  };
}

describe('live-search-source-filters', () => {
  describe('sameLeague', () => {
    it('比對聯盟時忽略前後空白與大小寫，並安全處理 null/undefined', () => {
      expect(sameLeague('Standard', ' standard ')).toBe(true);
      expect(sameLeague('Keepers', 'Hardcore')).toBe(false);
      expect(sameLeague(null, undefined)).toBe(true);
      expect(sameLeague('', '  ')).toBe(true);
      expect(sameLeague('Standard', null)).toBe(false);
    });
  });

  describe('formatters & URL builders', () => {
    it('格式化遊戲版本與聯盟名稱', () => {
      expect(formatLiveSearchDisplayVersion('poe1')).toBe('PoE 1');
      expect(formatLiveSearchDisplayVersion('poe2')).toBe('PoE 2');
      expect(formatLiveSearchDisplayLeague('  settlers of kalguur  ')).toBe('Settlers Of Kalguur');
      expect(formatLiveSearchDisplayLeague('Standard')).toBe('Standard');
      expect(formatLiveSearchDisplayLeague('  ')).toBe('');
    });

    it('產生 PoE 1 / PoE 2 標準搜尋網址', () => {
      expect(buildCanonicalTradeSearchUrl('poe1', 'Standard', 'abc12345')).toContain(
        '/trade/search/Standard/abc12345',
      );
      expect(buildCanonicalTradeSearchUrl('poe2', 'Dawn of the Hunt', 'xyz98765')).toContain(
        '/trade2/search/poe2/Dawn%20of%20the%20Hunt/xyz98765',
      );
    });
  });

  describe('extractSectionSourceCanonicalKey & getBookmarkCanonicalKey', () => {
    it('解析 session_ / prev_ 前綴與書籤網址 canonical key', () => {
      expect(
        extractSectionSourceCanonicalKey(`${PREVIOUS_SOURCE_ID_PREFIX}poe1:standard:abc`),
      ).toBe('poe1:standard:abc');
      expect(
        extractSectionSourceCanonicalKey(`  ${SESSION_SOURCE_ID_PREFIX}poe1:standard:xyz `),
      ).toBe('poe1:standard:xyz');
      expect(extractSectionSourceCanonicalKey('bookmark_1')).toBeNull();

      expect(
        getBookmarkCanonicalKey({
          url: 'https://www.pathofexile.com/trade/search/Standard/AbCd1234Ef/live',
        }),
      ).toBe('poe1:standard:AbCd1234Ef');
      expect(getBookmarkCanonicalKey({ url: 'https://example.com/not-trade' })).toBeNull();
    });
  });

  describe('evaluateLiveSearchSourceCompatibility', () => {
    it('依序判定 invalid-url、legacy short code、wrong-version、wrong-league 與 compatible', () => {
      const ctx = { gameVersion: 'poe1' as const, runtimeLeague: 'Standard' };

      expect(evaluateLiveSearchSourceCompatibility(null, ctx).compatibility).toBe('invalid-url');

      expect(
        evaluateLiveSearchSourceCompatibility(
          { gameVersion: 'poe1', league: 'Standard', searchId: 'short' },
          ctx,
          'https://www.pathofexile.com/trade/search/Standard/short',
        ).compatibility,
      ).toBe('invalid-url');

      expect(
        evaluateLiveSearchSourceCompatibility(
          { gameVersion: 'poe2', league: 'Standard', searchId: 'H4sIAAAAAAAA_test1' },
          ctx,
        ).compatibility,
      ).toBe('wrong-version');

      expect(
        evaluateLiveSearchSourceCompatibility(
          { gameVersion: 'poe1', league: 'Hardcore', searchId: 'H4sIAAAAAAAA_test2' },
          ctx,
        ).compatibility,
      ).toBe('wrong-league');

      expect(
        evaluateLiveSearchSourceCompatibility(
          { gameVersion: 'poe1', league: ' standard ', searchId: 'H4sIAAAAAAAA_test3' },
          ctx,
        ).compatibility,
      ).toBe('compatible');
    });
  });

  describe('status & item filtering', () => {
    it('依狀態分類篩選來源狀態', () => {
      expect(matchesLiveSearchSourceStatusFilter('active', 'enabled')).toBe(true);
      expect(matchesLiveSearchSourceStatusFilter('connecting', 'enabled')).toBe(true);
      expect(matchesLiveSearchSourceStatusFilter('reconnecting', 'enabled')).toBe(true);
      expect(matchesLiveSearchSourceStatusFilter('idle', 'enabled')).toBe(false);

      expect(matchesLiveSearchSourceStatusFilter(undefined, 'disabled')).toBe(true);
      expect(matchesLiveSearchSourceStatusFilter('idle', 'disabled')).toBe(true);
      expect(matchesLiveSearchSourceStatusFilter('closed', 'disabled')).toBe(true);
      expect(matchesLiveSearchSourceStatusFilter('error', 'disabled')).toBe(false);

      expect(matchesLiveSearchSourceStatusFilter('error', 'error')).toBe(true);
      expect(matchesLiveSearchSourceStatusFilter('active', 'error')).toBe(false);
    });

    it('依名稱、群組名、網址或 searchId 篩選連線項目', () => {
      const items = [
        makeItem({ id: 'AbCd1234Ef', name: 'Mageblood', status: 'active' }),
        makeItem({ id: 'XyZw9876Qr', name: 'Headhunter', groupName: 'Belts', status: 'idle' }),
      ];

      expect(filterLiveSearchConnectionItems(items, { statusFilter: 'enabled' })).toHaveLength(1);
      expect(filterLiveSearchConnectionItems(items, { query: 'belts' }).map((i) => i.id)).toEqual([
        'XyZw9876Qr',
      ]);
      expect(
        filterLiveSearchConnectionItems(items, { query: 'abcd1234' }).map((i) => i.id),
      ).toEqual(['AbCd1234Ef']);
    });
  });

  describe('folder subtree & group filtering', () => {
    const parentItem = makeItem({
      id: 'p1',
      name: 'Parent Ring',
      groupId: 'root',
      status: 'active',
    });
    const childItem = makeItem({
      id: 'c1',
      name: 'Child Amulet',
      groupId: 'child',
      status: 'idle',
    });
    const customItem = makeItem({
      id: 'tmp1',
      kind: 'custom',
      name: 'Temp Jewel',
      groupId: TEMPORARY_SOURCE_GROUP_ID,
      groupName: TEMPORARY_SOURCE_GROUP_NAME,
      status: 'error',
    });

    const groups: LiveSearchSourceGroup[] = [
      {
        id: 'root',
        name: 'Gear',
        kind: 'bookmark',
        order: 0,
        items: [parentItem],
        bookmarks: [parentItem],
      },
      {
        id: 'child',
        name: 'Jewelry',
        kind: 'bookmark',
        parentId: 'root',
        order: 0,
        items: [childItem],
        bookmarks: [childItem],
      },
      {
        id: TEMPORARY_SOURCE_GROUP_ID,
        name: TEMPORARY_SOURCE_GROUP_NAME,
        kind: 'custom',
        items: [customItem],
        bookmarks: [customItem],
      },
    ];

    it('依 pre-order 聚合資料夾 subtree 項目與 ID，自訂群組維持獨立', () => {
      expect(getLiveSearchGroupSubtreeItems(groups, 'root').map((i) => i.id)).toEqual(['p1', 'c1']);
      expect(getLiveSearchGroupSubtreeSourceIds(groups, 'child')).toEqual(['c1']);
      expect(getLiveSearchGroupSubtreeSourceIds(groups, TEMPORARY_SOURCE_GROUP_ID)).toEqual([
        'tmp1',
      ]);
      expect(getLiveSearchGroupSubtreeSourceIds(groups, 'missing')).toEqual([]);
    });

    it('命中子資料夾時保留祖先鏈，命中父資料夾名稱時展開其子樹項目', () => {
      const matchedChildOnly = filterLiveSearchSourceGroups(groups, { query: 'amulet' });
      expect(matchedChildOnly.map((g) => ({ id: g.id, ids: g.items.map((i) => i.id) }))).toEqual([
        { id: 'root', ids: [] },
        { id: 'child', ids: ['c1'] },
      ]);

      const matchedParentName = filterLiveSearchSourceGroups(groups, { query: 'gear' });
      expect(matchedParentName.map((g) => ({ id: g.id, ids: g.items.map((i) => i.id) }))).toEqual([
        { id: 'root', ids: ['p1'] },
        { id: 'child', ids: ['c1'] },
      ]);

      const errorOnly = filterLiveSearchSourceGroups(groups, { statusFilter: 'error' });
      expect(errorOnly.map((g) => g.id)).toEqual([TEMPORARY_SOURCE_GROUP_ID]);
    });
  });
});
