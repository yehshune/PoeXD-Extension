import { describe, expect, it } from 'vitest';
import {
  AUTO_TRADE_LEAGUE,
  createBookmarkWorkspace,
} from '@/components/sidebar/bookmark-workspace';
import {
  createFakeBookmarkWorkspaceHost,
  type FakeBookmarkWorkspaceHost,
} from '@/components/sidebar/bookmark-workspace/fake-host';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';
import type { TradeLeague } from '@/utils/trade-leagues';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';

const mockLeagues: TradeLeague[] = [
  { id: 'Standard', text: '標準模式' },
  { id: 'Settlers', text: '卡爾葛墾荒者' },
];

describe('Bookmark Workspace — leagues', () => {
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

  const setup = (
    options: {
      bookmarks?: Bookmark[];
      host?: Partial<FakeBookmarkWorkspaceHost['state']>;
    } = {},
  ) => {
    const host = createFakeBookmarkWorkspaceHost({
      leagues: mockLeagues,
      confirmAnswer: true,
      ...options.host,
    });
    const model = createFakeBookmarkModel({
      groups: [dummyGroup],
      bookmarks: options.bookmarks ?? dummyBookmarks,
    });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });
    return { host, model, workspace };
  };

  it('lazy loads trade leagues on demand', async () => {
    const { workspace } = setup();

    expect(workspace.actions.tradeLeagues.value).toEqual([]);
    await workspace.actions.ensureTradeLeaguesLoaded();
    expect(workspace.actions.tradeLeagues.value).toEqual([AUTO_TRADE_LEAGUE, ...mockLeagues]);
    expect(workspace.actions.isLeagueLoading.value).toBe(false);
  });

  it('switches bookmarks back to the Auto league without pinning a league', async () => {
    const { host, model, workspace } = setup();

    await workspace.actions.confirmReplaceLeague('collection', AUTO_TRADE_LEAGUE);

    expect(host.state.confirms).toEqual([
      {
        message: expect.stringContaining('改為自動跟隨目前聯盟'),
        title: '替換書籤聯盟',
      },
    ]);
    expect(model.intents).toEqual([
      {
        type: 'replace-league',
        scope: 'collection',
        league: 'Auto',
      },
    ]);
    expect(host.state.toasts).toEqual([{ message: '已將 2 個書籤改為自動聯盟', tone: 'default' }]);
  });

  it('dedupes while loading and does not refetch when already cached', async () => {
    const { host, workspace } = setup();

    // Concurrent calls
    await Promise.all([
      workspace.actions.ensureTradeLeaguesLoaded(),
      workspace.actions.ensureTradeLeaguesLoaded(),
    ]);

    expect(host.state.leagueFetchCount).toBe(1);

    // Call again after already loaded
    await workspace.actions.ensureTradeLeaguesLoaded();
    expect(host.state.leagueFetchCount).toBe(1);
  });

  it('handles load error and sets leagueLoadError', async () => {
    const { workspace } = setup({
      host: { leagues: new Error('Network error') },
    });

    await workspace.actions.ensureTradeLeaguesLoaded();
    expect(workspace.actions.tradeLeagues.value).toEqual([]);
    expect(workspace.actions.leagueLoadError.value).toBe('Network error');
  });

  it('sets error message when empty leagues returned', async () => {
    const { workspace } = setup({
      host: { leagues: [] },
    });

    await workspace.actions.ensureTradeLeaguesLoaded();
    expect(workspace.actions.tradeLeagues.value).toEqual([]);
    expect(workspace.actions.leagueLoadError.value).toBe('找不到可用聯盟');
  });

  it('alerts and bails out if target count is zero', async () => {
    const { host, workspace } = setup({ bookmarks: [] });

    await workspace.actions.confirmReplaceLeague('collection', mockLeagues[0]);

    expect(host.state.alerts).toEqual([
      {
        message: '此範圍目前沒有可替換的書籤。',
        title: '替換書籤聯盟',
      },
    ]);
    expect(host.state.confirms).toHaveLength(0);
  });

  it('aborts when user cancels confirmation', async () => {
    const { host, model, workspace } = setup({
      host: { confirmAnswer: false },
    });

    await workspace.actions.confirmReplaceLeague('collection', mockLeagues[0]);

    expect(host.state.confirms).toHaveLength(1);
    expect(model.intents).toHaveLength(0);
    expect(host.state.toasts).toHaveLength(0);
  });

  it('replaces league across entire collection with plain text confirmation', async () => {
    const { host, model, workspace } = setup();
    workspace.menus.isTransferMenuOpen.value = true;

    await workspace.actions.confirmReplaceLeague('collection', mockLeagues[1]);

    expect(workspace.menus.isTransferMenuOpen.value).toBe(false);
    expect(host.state.confirms).toEqual([
      {
        message: expect.stringContaining('全部書籤中的 2 個書籤聯盟替換為「卡爾葛墾荒者」'),
        title: '替換書籤聯盟',
      },
    ]);
    expect(model.intents).toEqual([
      {
        type: 'replace-league',
        scope: 'collection',
        league: 'Settlers',
      },
    ]);
    expect(host.state.toasts).toEqual([
      { message: '已將 2 個書籤替換為「卡爾葛墾荒者」', tone: 'default' },
    ]);
  });

  it('replaces league for a specific folder with exact groupId and plain text message', async () => {
    const { host, model, workspace } = setup();
    workspace.menus.setGroupMenuOpen(dummyGroup.id, true);

    await workspace.actions.confirmReplaceLeague('folder', mockLeagues[0], dummyGroup);

    expect(workspace.menus.activeGroupMenuId.value).toBeNull();
    // Plain text dummyGroup.name: "Folder & Currency <test>"
    expect(host.state.confirms).toEqual([
      {
        message: expect.stringContaining(
          '資料夾「Folder & Currency <test>」中的 1 個書籤聯盟替換為「標準模式」',
        ),
        title: '替換書籤聯盟',
      },
    ]);
    expect(model.intents).toEqual([
      {
        type: 'replace-league',
        scope: 'folder',
        league: 'Standard',
        groupId: 'group-1',
      },
    ]);
    expect(host.state.toasts).toEqual([
      { message: '已將 1 個書籤替換為「標準模式」', tone: 'default' },
    ]);
  });
});
