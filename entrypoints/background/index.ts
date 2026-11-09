import {
  createChromeSearchRecordStorage,
  createSearchRecordModule,
  type SearchRecordOutcome,
  type SearchRecordRuntime,
} from '@/utils/search-records';
import {
  broadcastSearchRecordChange,
  registerSearchRecordBackgroundHandlers,
  type SearchRecordBroadcastTransport,
} from '@/utils/search-record-messaging';
import { extensionMessaging } from '@/utils/extension-protocol';
import {
  createBackgroundBookmarkCoordinator,
  createChromeBookmarkCoordinatorStorage,
  type BookmarkCoordinator,
} from '@/utils/bookmark-coordinator';
import {
  broadcastBookmarkChange,
  registerBookmarkBackgroundHandlers,
  type BookmarkBroadcastTransport,
} from '@/utils/bookmark-messaging';
import { registerEconomyBackgroundHandlers, type EconomyBroadcastTransport } from '@/utils/economy';
import { LiveSearchCoordinator } from '@/utils/live-search-coordinator';
import { TRADE_PAGE_MATCH_PATTERNS } from '@/utils/trade-realms';
import { registerLiveSearchBackgroundHandlers } from '@/utils/live-search-messaging';

let searchRecordModule: SearchRecordRuntime | undefined;
let searchRecordReady: Promise<SearchRecordOutcome> | undefined;
let bookmarkCoordinator: BookmarkCoordinator | undefined;
let bookmarkReady: Promise<SearchRecordOutcome> | undefined;

export default defineBackground(() => {
  console.log('PoeXD-Extention background service worker initialized.', { id: browser.runtime.id });
  searchRecordModule = createSearchRecordModule(
    createChromeSearchRecordStorage(chrome.storage.local),
  );
  bookmarkCoordinator = createBackgroundBookmarkCoordinator(
    searchRecordModule,
    createChromeBookmarkCoordinatorStorage(chrome.storage.local),
  );
  bookmarkReady = bookmarkCoordinator.initialize();
  searchRecordReady = bookmarkReady;
  void bookmarkReady.then((outcome) => {
    if (!outcome.ok) {
      console.error('[Search Records] Initialization failed:', outcome.error);
    }
  });
  const tradeTabBroadcastTransport = {
    async listTradeTabIds() {
      const tabs: Array<{ id?: number }> = await chrome.tabs.query({
        url: [...TRADE_PAGE_MATCH_PATTERNS],
      });
      return tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
    },
  };
  const searchRecordBroadcastTransport: SearchRecordBroadcastTransport = {
    listTradeTabIds: () => tradeTabBroadcastTransport.listTradeTabIds(),
    sendChangeToTab: (tabId, change) =>
      extensionMessaging.sendMessage('searchRecord:change', change, tabId),
  };
  searchRecordModule.subscribe((change) => {
    void broadcastSearchRecordChange(change, searchRecordBroadcastTransport).catch(
      (error: unknown) => {
        console.error('[Search Records] Change broadcast failed:', error);
      },
    );
  });
  registerSearchRecordBackgroundHandlers({
    getModule: () => searchRecordModule!,
    getReady: () => searchRecordReady!,
  });
  const bookmarkBroadcastTransport: BookmarkBroadcastTransport = {
    listTradeTabIds: () => tradeTabBroadcastTransport.listTradeTabIds(),
    sendChangeToTab: (tabId, change) =>
      extensionMessaging.sendMessage('bookmark:change', change, tabId),
  };
  bookmarkCoordinator.subscribe((change) => {
    void broadcastBookmarkChange(change, bookmarkBroadcastTransport).catch((error: unknown) => {
      console.error('[Bookmarks] Change broadcast failed:', error);
    });
  });
  registerBookmarkBackgroundHandlers({
    getCoordinator: () => bookmarkCoordinator!,
    getReady: () => bookmarkReady!,
  });
  const economyBroadcastTransport: EconomyBroadcastTransport = {
    listTradeTabIds: () => tradeTabBroadcastTransport.listTradeTabIds(),
    sendChangeToTab: (tabId, change) =>
      extensionMessaging.sendMessage('economy:change', change, tabId),
  };
  registerEconomyBackgroundHandlers({
    broadcastTransport: economyBroadcastTransport,
  });

  const liveSearchCoordinator = new LiveSearchCoordinator();
  registerLiveSearchBackgroundHandlers({ coordinator: liveSearchCoordinator });

  chrome.tabs.onRemoved.addListener((tabId: number) => {
    void liveSearchCoordinator.handleTabRemoved(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any, tab: any) => {
    void liveSearchCoordinator.handleTabUpdated(tabId, changeInfo, tab);
  });
});
