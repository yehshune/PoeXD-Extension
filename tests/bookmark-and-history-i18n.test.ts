// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import BookmarkImportDiffNode from '@/components/sidebar/BookmarkImportDiffNode.vue';
import BookmarkImportDialog from '@/components/sidebar/BookmarkImportDialog.vue';
import BookmarkFolderNode from '@/components/sidebar/BookmarkFolderNode.vue';
import HistoryPane from '@/components/sidebar/HistoryPane.vue';
import { BOOKMARK_PANE_CONTEXT_KEY } from '@/components/sidebar/bookmark-tree';
import { setActiveDisplayLocale, resetI18nStateForTests, t } from '@/utils/i18n';
import {
  formatTradeLeagueText,
  AUTO_TRADE_LEAGUE,
} from '@/components/sidebar/composables/useBookmarkLeagues';
import { ref } from 'vue';

vi.mock('@/utils/search-record-messaging', () => ({
  createChromeSearchRecordClient: () => ({
    execute: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('@/components/sidebar/history-domain-feed', () => ({
  createHistoryDomainFeed: (_client: any, _version: any, onSnapshot: any) => ({
    start: vi.fn(async () => {
      onSnapshot({ history: [], enabled: true });
    }),
    stop: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: { bookmarks: [] } })),
    subscribe: vi.fn(() => () => {}),
  }),
}));

vi.mock('@/utils/preferences', () => ({
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      subscribe: vi.fn(() => () => {}),
    },
  })),
}));

describe('Bookmarks, History & Bookmark Import i18n (Seam 4)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  describe('BookmarkImportDialog', () => {
    it('reactively renders localized labels and buttons across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const app = createApp({
        render() {
          return h(BookmarkImportDialog, {
            open: true,
            version: 'poe2',
            currentCollection: { groups: [], bookmarks: [] },
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(document.body.textContent).toContain('匯入書籤');
      expect(document.body.textContent).toContain('從剪貼簿匯入');
      expect(document.body.textContent).toContain('選擇書籤檔');
      expect(document.body.textContent).toContain('取消');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(document.body.textContent).toContain('导入书签');
      expect(document.body.textContent).toContain('从剪贴板导入');
      expect(document.body.textContent).toContain('选择书签档');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(document.body.textContent).toContain('Import Bookmarks');
      expect(document.body.textContent).toContain('Import from clipboard');
      expect(document.body.textContent).toContain('Choose bookmark file');
      expect(document.body.textContent).toContain('Cancel');

      app.unmount();
      host.remove();
    });
  });

  describe('HistoryPane', () => {
    it('reactively renders localized history labels and empty states across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const app = createApp({
        render() {
          return h(HistoryPane);
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(host.textContent).toContain('記錄搜尋歷史');
      expect(host.textContent).toContain('尚無歷史搜尋紀錄');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('记录搜索历史');
      expect(host.textContent).toContain('暂无历史搜索记录');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('Record search history');
      expect(host.textContent).toContain('No search history yet');

      app.unmount();
      host.remove();
    });
  });

  describe('BookmarkFolderNode', () => {
    it('reactively localizes folder hints and empty message without mutating user names', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const fakeContext = {
        activeGroupMenuId: ref(null),
        setGroupMenuOpen: vi.fn(),
        getFilteredGroupBookmarks: vi.fn(() => []),
        groups: ref([{ id: 'g1', name: 'My Custom Folder', order: 0 }]),
        bookmarks: ref([]),
        addBookmarkBtnPosition: ref('bottom' as const),
        isDragging: ref(false),
        isDraggingBookmark: ref(false),
        editingGroupId: ref(null),
        editingGroupName: ref(''),
        editingBookmarkId: ref(null),
        editingBookmarkName: ref(''),
        isGroupCollapsed: vi.fn(() => false),
        toggleGroupCollapse: vi.fn(),
        hasSubtreeFolders: vi.fn(() => false),
        isSubtreeAllCollapsed: vi.fn(() => false),
        toggleSubtreeCollapse: vi.fn(),
        startRenameGroup: vi.fn(),
        moveFolder: vi.fn(),
        getFolderPath: vi.fn(() => 'My Custom Folder'),
        sendFolderToLiveSearchConsole: vi.fn(),
        copyTransfer: vi.fn(),
        ensureTradeLeaguesLoaded: vi.fn(),
        tradeLeagues: ref([]),
        isLeagueLoading: ref(false),
        leagueLoadError: ref(null),
        confirmReplaceLeague: vi.fn(),
        confirmDeleteGroup: vi.fn(),
        addBookmarkToGroup: vi.fn(),
        handleGroupTriggerPointerDown: vi.fn(),
        handleTriggerClick: vi.fn(),
        activeBookmarkMenuId: ref(null),
        isMoveSubMenu: ref(false),
        isCoverSubMenu: ref(false),
      };

      const app = createApp({
        render() {
          return h(BookmarkFolderNode, {
            node: {
              folder: { id: 'g1', name: 'User Saved Folder Name', order: 0 },
              depth: 0,
            },
          });
        },
      });
      app.provide(BOOKMARK_PANE_CONTEXT_KEY, fakeContext);
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(host.textContent).toContain('User Saved Folder Name');
      expect(host.textContent).toContain('資料夾內尚無書籤 (可拖移書籤至此)');
      expect(host.textContent).toContain('＋ 新增當前網頁');

      // Switch to zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('User Saved Folder Name'); // Unchanged
      expect(host.textContent).toContain('资料夹内尚无书签 (可拖移书签至此)');
      expect(host.textContent).toContain('＋ 添加当前网页');

      // Switch to en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('User Saved Folder Name'); // Preserved!
      expect(host.textContent).toContain('No bookmarks in folder (drag bookmarks here)');
      expect(host.textContent).toContain('＋ Add Current Page');

      app.unmount();
      host.remove();
    });
  });

  describe('BookmarkImportDiffNode', () => {
    it('reactively translates diff status badges across locales without mutating node names', async () => {
      const node = {
        name: 'My Special User Folder',
        status: 'create' as const,
        folders: [],
        bookmarks: [
          {
            name: 'User Custom Bookmark',
            url: 'https://www.pathofexile.com/trade/search/Standard/test',
            status: 'create' as const,
          },
          {
            name: 'Existing Preserved Bookmark',
            url: 'https://www.pathofexile.com/trade/search/Standard/test2',
            status: 'retain' as const,
          },
          {
            name: 'Updated Bookmark',
            url: 'https://www.pathofexile.com/trade/search/Standard/test3',
            status: 'update' as const,
          },
          {
            name: 'Skipped Bookmark',
            url: 'https://www.pathofexile.com/trade/search/Standard/test4',
            status: 'skip' as const,
          },
        ],
      };

      const host = document.createElement('div');
      document.body.appendChild(host);

      const app = createApp({
        render() {
          return h(BookmarkImportDiffNode, {
            node,
            showOnlyChanged: false,
            expandAll: true,
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(host.textContent).toContain('My Special User Folder');
      expect(host.textContent).toContain('User Custom Bookmark');
      expect(host.textContent).toContain('新增');
      expect(host.textContent).toContain('保留');
      expect(host.textContent).toContain('1 更新');
      expect(host.textContent).toContain('1 略過');

      // Switch to zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('My Special User Folder'); // Unmutated user name
      expect(host.textContent).toContain('新增');
      expect(host.textContent).toContain('保留');
      expect(host.textContent).toContain('1 更新');
      expect(host.textContent).toContain('1 略过');

      // Switch to English
      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('My Special User Folder'); // User name strictly preserved!
      expect(host.textContent).toContain('User Custom Bookmark');
      expect(host.textContent).toContain('New');
      expect(host.textContent).toContain('Keep');
      expect(host.textContent).toContain('1 updated');
      expect(host.textContent).toContain('1 skipped');

      app.unmount();
      host.remove();
    });
  });

  describe('Bookmark & History i18n Catalogs', () => {
    it('provides localized strings for bookmark actions, folders, and history', () => {
      setActiveDisplayLocale('zh-TW');
      expect(t('bookmark.action.newFolder')).toBe('新建資料夾');
      expect(t('bookmark.empty.noBookmarks')).toBe('尚無書籤資料');
      expect(t('history.action.clearAll')).toBe('清空歷史紀錄');
      expect(formatTradeLeagueText(AUTO_TRADE_LEAGUE)).toBe('自動（跟隨目前聯盟）');

      setActiveDisplayLocale('zh-CN');
      expect(t('bookmark.action.newFolder')).toBe('新建资料夹');
      expect(t('bookmark.empty.noBookmarks')).toBe('尚无书签数据');
      expect(t('history.action.clearAll')).toBe('清空历史记录');
      expect(formatTradeLeagueText(AUTO_TRADE_LEAGUE)).toBe('自动（跟随当前联赛）');

      setActiveDisplayLocale('en');
      expect(t('bookmark.action.newFolder')).toBe('New Folder');
      expect(t('bookmark.empty.noBookmarks')).toBe('No bookmarks yet');
      expect(t('history.action.clearAll')).toBe('Clear History');
      expect(formatTradeLeagueText(AUTO_TRADE_LEAGUE)).toBe('Auto (Follow current league)');
    });
  });
});
