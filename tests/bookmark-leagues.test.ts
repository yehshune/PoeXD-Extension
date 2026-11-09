// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import {
  AUTO_TRADE_LEAGUE,
  useBookmarkLeagues,
} from '@/components/sidebar/composables/useBookmarkLeagues';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';
import type { TradeLeague } from '@/utils/trade-leagues';

const mockLeagues: TradeLeague[] = [
  { id: 'Standard', text: '標準模式' },
  { id: 'Settlers', text: '卡爾葛墾荒者' },
];

let fetchLeaguesMock = vi.fn(async (_version?: any) => mockLeagues);

vi.mock('@/utils/trade-leagues', () => ({
  fetchTradeLeagues: vi.fn(async (version: any) => fetchLeaguesMock(version)),
}));

describe('useBookmarkLeagues', () => {
  const dummyBookmarks: Bookmark[] = [
    {
      id: 'bm-1',
      name: 'Item 1',
      url: 'https://pathofexile.com/trade',
      groupId: 'group-1',
      searchRecordId: '1',
      order: 0,
    },
    {
      id: 'bm-2',
      name: 'Item 2',
      url: 'https://pathofexile.com/trade',
      groupId: 'group-2',
      searchRecordId: '2',
      order: 1,
    },
  ];

  const dummyGroup: BookmarkGroup = {
    id: 'group-1',
    name: 'Folder & Currency <test>',
    order: 0,
  };

  beforeEach(() => {
    fetchLeaguesMock = vi.fn(async () => mockLeagues);
    (window as any).poexdAlert = vi.fn(async () => {});
    (window as any).poexdConfirm = vi.fn(async () => true);
  });

  it('lazy loads trade leagues on demand', async () => {
    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent: vi.fn(async () => true),
      closeAllMenus: vi.fn(),
      showToast: vi.fn(),
    });

    expect(leagues.tradeLeagues.value).toEqual([]);
    await leagues.ensureTradeLeaguesLoaded();
    expect(leagues.tradeLeagues.value).toEqual([AUTO_TRADE_LEAGUE, ...mockLeagues]);
    expect(leagues.isLeagueLoading.value).toBe(false);
  });

  it('switches bookmarks back to the Auto league without pinning a league', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);
    const showToast = vi.fn();
    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent,
      closeAllMenus: vi.fn(),
      showToast,
    });

    await leagues.confirmReplaceLeague('collection', AUTO_TRADE_LEAGUE);

    expect((window as any).poexdConfirm).toHaveBeenCalledWith(
      expect.stringContaining('改為自動跟隨目前聯盟'),
      '替換書籤聯盟',
    );
    expect(executeBookmarkIntent).toHaveBeenCalledWith({
      type: 'replace-league',
      scope: 'collection',
      league: 'Auto',
    });
    expect(showToast).toHaveBeenCalledWith('已將 2 個書籤改為自動聯盟');
  });

  it('dedupes while loading and does not refetch when already cached', async () => {
    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent: vi.fn(async () => true),
      closeAllMenus: vi.fn(),
      showToast: vi.fn(),
    });

    // Concurrent calls
    await Promise.all([leagues.ensureTradeLeaguesLoaded(), leagues.ensureTradeLeaguesLoaded()]);

    expect(fetchLeaguesMock).toHaveBeenCalledTimes(1);

    // Call again after already loaded
    await leagues.ensureTradeLeaguesLoaded();
    expect(fetchLeaguesMock).toHaveBeenCalledTimes(1);
  });

  it('handles load error and sets leagueLoadError', async () => {
    fetchLeaguesMock = vi.fn(async () => {
      throw new Error('Network error');
    });

    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent: vi.fn(async () => true),
      closeAllMenus: vi.fn(),
      showToast: vi.fn(),
    });

    await leagues.ensureTradeLeaguesLoaded();
    expect(leagues.tradeLeagues.value).toEqual([]);
    expect(leagues.leagueLoadError.value).toBe('Network error');
  });

  it('sets error message when empty leagues returned', async () => {
    fetchLeaguesMock = vi.fn(async () => []);

    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent: vi.fn(async () => true),
      closeAllMenus: vi.fn(),
      showToast: vi.fn(),
    });

    await leagues.ensureTradeLeaguesLoaded();
    expect(leagues.tradeLeagues.value).toEqual([]);
    expect(leagues.leagueLoadError.value).toBe('找不到可用聯盟');
  });

  it('alerts and bails out if target count is zero', async () => {
    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref([]), // empty bookmarks
      executeBookmarkIntent: vi.fn(async () => true),
      closeAllMenus: vi.fn(),
      showToast: vi.fn(),
    });

    await leagues.confirmReplaceLeague('collection', mockLeagues[0]);

    expect((window as any).poexdAlert).toHaveBeenCalledWith(
      '此範圍目前沒有可替換的書籤。',
      '替換書籤聯盟',
    );
    expect((window as any).poexdConfirm).not.toHaveBeenCalled();
  });

  it('aborts when user cancels confirmation', async () => {
    (window as any).poexdConfirm = vi.fn(async () => false);
    const executeBookmarkIntent = vi.fn(async () => true);
    const showToast = vi.fn();

    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent,
      closeAllMenus: vi.fn(),
      showToast,
    });

    await leagues.confirmReplaceLeague('collection', mockLeagues[0]);

    expect((window as any).poexdConfirm).toHaveBeenCalled();
    expect(executeBookmarkIntent).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('replaces league across entire collection with escaped HTML', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);
    const closeAllMenus = vi.fn();
    const showToast = vi.fn();

    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent,
      closeAllMenus,
      showToast,
    });

    await leagues.confirmReplaceLeague('collection', mockLeagues[1]);

    expect(closeAllMenus).toHaveBeenCalled();
    expect((window as any).poexdConfirm).toHaveBeenCalledWith(
      expect.stringContaining('全部書籤中的 2 個書籤聯盟替換為「卡爾葛墾荒者」'),
      '替換書籤聯盟',
    );
    expect(executeBookmarkIntent).toHaveBeenCalledWith({
      type: 'replace-league',
      scope: 'collection',
      league: 'Settlers',
    });
    expect(showToast).toHaveBeenCalledWith('已將 2 個書籤替換為「卡爾葛墾荒者」');
  });

  it('replaces league for a specific folder with exact groupId and plain text message', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);
    const closeAllMenus = vi.fn();
    const showToast = vi.fn();

    const leagues = useBookmarkLeagues({
      version: 'poe1',
      bookmarks: ref(dummyBookmarks),
      executeBookmarkIntent,
      closeAllMenus,
      showToast,
    });

    await leagues.confirmReplaceLeague('folder', mockLeagues[0], dummyGroup);

    expect(closeAllMenus).toHaveBeenCalled();
    // Plain text dummyGroup.name: "Folder & Currency <test>"
    expect((window as any).poexdConfirm).toHaveBeenCalledWith(
      expect.stringContaining(
        '資料夾「Folder & Currency <test>」中的 1 個書籤聯盟替換為「標準模式」',
      ),
      '替換書籤聯盟',
    );
    expect(executeBookmarkIntent).toHaveBeenCalledWith({
      type: 'replace-league',
      scope: 'folder',
      league: 'Standard',
      groupId: 'group-1',
    });
    expect(showToast).toHaveBeenCalledWith('已將 1 個書籤替換為「標準模式」');
  });
});
