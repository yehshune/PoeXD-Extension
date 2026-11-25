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
import { registerPobShareBackgroundHandlers } from '@/utils/pob-share-fetch';
import { createPinnedItemStore } from '@/utils/pinned-items';
import { LiveSearchCoordinator } from '@/utils/live-search-coordinator';
import { TRADE_PAGE_MATCH_PATTERNS } from '@/utils/trade-realms';
import { registerLiveSearchBackgroundHandlers } from '@/utils/live-search-messaging';
import { registerMarketTranslationBackgroundHandlers } from '@/utils/market-translation-live';
import { clearMarketTranslationLiveCache } from '@/utils/market-live-cache';
import { registerActionSidebarToggle } from '@/utils/action-sidebar-toggle';
import {
  createInstallOnboardingState,
  createUpdateOnboardingState,
  ONBOARDING_STORAGE_KEY,
  parseOnboardingState,
} from '@/utils/onboarding';

let searchRecordModule: SearchRecordRuntime | undefined;
let searchRecordReady: Promise<SearchRecordOutcome> | undefined;
let bookmarkCoordinator: BookmarkCoordinator | undefined;
let bookmarkReady: Promise<SearchRecordOutcome> | undefined;

export default defineBackground(() => {
  console.log('PoeXD-Extention background service worker initialized.', { id: browser.runtime.id });
  // 在全新安裝或版本更新時寫入引導／改版提示狀態；需在 Service Worker 啟動時同步註冊才收得到事件
  browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    const version = browser.runtime.getManifest().version;
    const initial = createInstallOnboardingState(reason, version);
    if (initial) {
      void browser.storage.local
        .set({ [ONBOARDING_STORAGE_KEY]: { ...initial } })
        .catch((error: unknown) => console.error('[Onboarding] 無法寫入初次安裝狀態:', error));
      return;
    }
    if (reason === 'update') {
      // 擴充升級時清掉舊版即時翻譯快取，避免過時快取覆蓋新版內建分片
      void clearMarketTranslationLiveCache(browser.storage.local).catch((error: unknown) =>
        console.error('[MarketTranslation] 無法清除舊版即時翻譯快取:', error),
      );
      void browser.storage.local
        .get([ONBOARDING_STORAGE_KEY])
        .then((stored) => {
          const current = parseOnboardingState(stored[ONBOARDING_STORAGE_KEY]);
          const updated = createUpdateOnboardingState({
            reason,
            version,
            previousVersion,
            current,
          });
          if (!updated) return;
          return browser.storage.local.set({ [ONBOARDING_STORAGE_KEY]: { ...updated } });
        })
        .catch((error: unknown) => console.error('[Onboarding] 無法寫入改版更新狀態:', error));
    }
  });
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
  registerMarketTranslationBackgroundHandlers();
  registerPobShareBackgroundHandlers({ messenger: extensionMessaging });
  registerActionSidebarToggle();
  const pinnedItemStore = createPinnedItemStore({
    get: (keys) => chrome.storage.local.get([...keys]),
    set: (values) => chrome.storage.local.set(values),
  });
  extensionMessaging.onMessage('pinnedItem:execute', ({ data }) => pinnedItemStore.execute(data));

  chrome.tabs.onRemoved.addListener((tabId: number) => {
    void liveSearchCoordinator.handleTabRemoved(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any, tab: any) => {
    void liveSearchCoordinator.handleTabUpdated(tabId, changeInfo, tab);
  });
});
