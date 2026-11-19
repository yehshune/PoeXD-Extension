import {
  dispatchPoeEvent,
  listenPoeEvent,
  initPoeEventNonce,
  parsePoeKnownStats,
  parsePoeLiveTradeData,
} from '@/utils/event-contracts';
import { injectScript } from 'wxt/utils/inject-script';
import { getPreferences, type Preferences } from '@/utils/preferences';
import {
  ensureAffixLexiconLoaded,
  getHydratedModsByGroup,
  markAffixSelectorPrewarmed,
} from '@/utils/affix-lexicon';
import { setActiveDisplayLocalePreference, t } from '@/utils/i18n';
import { rememberPageLoadPreferences } from '@/utils/page-load-preferences';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';
import { watchTradePageMode } from '@/utils/trade-page-mode';
import { DomFilter } from './dom-filter';
import { initHotkeysAndTildeListeners } from './hotkeys';
import { installSearchEnterCommit } from './search-enter-commit';
import { connectSearchObservationSession } from './search-observation-session';
import { mountSidebarLayout, reserveSidebarPageLayout } from './sidebar-layout';
import { ResultPricePresenter } from './result-price-presenter';
import { ResultModHighlighter } from './result-mod-highlighter';
import { ResultItemNormalizer } from './result-item-normalizer';
import { ResultSortController } from './result-sort-controller';
import { ResultModQuickFilter } from './result-mod-quick-filter';
import { ResultPobCopy } from './result-pob-copy';
import { ResultPinButton } from './result-pin-button';
import { getTradeResultCache, type TradeResultCache } from '@/utils/trade-result-cache';
import { createPinnedItemClient } from '@/utils/pinned-item-client';
import { ResultExternalLinks } from './result-external-links';
import { isCloudflareChallenge } from '@/utils/trade-interstitial-classifier';
import { whenTradePageReady } from './trade-page-readiness';
import { createInitialPageLoadGate, type InitialPageLoadGate } from './initial-page-load-gate';
import { expectsInitialSearchResults } from '@/utils/trade-search-identity';
import { createFilterDomEnhancements, type FilterDomEnhancements } from './common';
import { initToastHost, syncToastPreferences } from './toast-host';
import { extensionMessaging } from '@/utils/extension-protocol';
import type { LiveSearchPrimaryController, TradePageRole } from '@/utils/live-search-contract';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { LiveSearchPrimaryRuntime } from './live-search-primary-runtime';
import { createLiveSearchPrimaryController } from './live-search-primary-controller';
import {
  createLiveSearchBookmarkController,
  type LiveSearchBookmarkController,
} from './live-search-bookmark-controller';
import {
  createLiveSearchPrimaryExitGuard,
  type LiveSearchPrimaryExitGuard,
} from './live-search-primary-exit-guard';
import { registerLiveSearchPrimaryEnqueueBridge } from './live-search-enqueue-receiver';
import {
  createLiveSearchConsoleHostGuard,
  type LiveSearchConsoleHostGuard,
} from './live-search-console-host-guard';
import {
  createLiveSearchConsoleTitleGuard,
  type LiveSearchConsoleTitleGuard,
} from './live-search-console-title';
import {
  createLiveSearchResumeStore,
  type LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';
import {
  createLiveSearchResumeController,
  type LiveSearchResumeController,
} from './live-search-resume-controller';
import {
  createLiveSearchSoundNotifier,
  type LiveSearchSoundNotifier,
} from './live-search-sound-notifier';
import { setKnownStats } from '@/utils/known-stats-store';
import { setLiveTradeData, setMarketLiveTradeData } from '@/utils/live-trade-data-store';
import { startMarketLiveLabelsSync } from '@/utils/market-live-labels';
import { detectBrowserLocale, resolvePageLocale } from '@/utils/locale-resolution';

let activePrimaryRuntime: LiveSearchPrimaryRuntime | null = null;
let activePrimaryController: LiveSearchPrimaryController | null = null;
let activeBookmarkController: LiveSearchBookmarkController | null = null;
let activeResumeStore: LiveSearchResumeStore | null = null;
let activeResumeController: LiveSearchResumeController | null = null;
let activeSoundNotifier: LiveSearchSoundNotifier | null = null;
let activeExitGuard: LiveSearchPrimaryExitGuard | null = null;
let activeConsoleHostGuard: LiveSearchConsoleHostGuard | null = null;
let activeConsoleTitleGuard: LiveSearchConsoleTitleGuard | null = null;

export async function runLogic(ctx: any, version: PoeVersion) {
  if (isCloudflareChallenge(window.location, document)) {
    console.log('[PoeXD] Cloudflare challenge / interstitial detected in runLogic; aborting.');
    return;
  }
  const cleanupToastHost = initToastHost(ctx);
  const pricePresenter = new ResultPricePresenter(version);
  const modHighlighter = new ResultModHighlighter();
  const sortController = new ResultSortController(version, pricePresenter);
  const itemNormalizer = new ResultItemNormalizer(version, sortController);
  const modQuickFilter = new ResultModQuickFilter();
  const resultCache = getTradeResultCache();
  const pobCopy = new ResultPobCopy(version, {}, resultCache);
  const resultPin = new ResultPinButton(version, resultCache, createPinnedItemClient(version));
  const externalLinks = new ResultExternalLinks(version, pobCopy);
  const domFilter = new DomFilter(
    version,
    pricePresenter,
    modHighlighter,
    itemNormalizer,
    modQuickFilter,
    pobCopy,
    externalLinks,
    sortController,
    resultPin,
  );
  const filterEnhancements = createFilterDomEnhancements(version);
  let cleanupPageEvents: (() => void) | null = null;
  let cleanupHotkeys: (() => void) | null = null;
  let cleanupSearchEnterCommit: (() => void) | null = null;
  let cleanupPageMode: (() => void) | null = null;
  let cleanupPreferences: (() => void) | null = null;
  let cleanupSearchSession: (() => void) | null = null;
  let stopSidebarPreferences: (() => void) | null = null;
  let removeReservedSidebarLayout: (() => void) | null = null;
  let stopWaitingTradePage: (() => void) | null = null;
  let cleanupEnqueueListener: (() => void) | null = null;
  let initialPageLoad: InitialPageLoadGate | null = null;
  let cancelAffixPrewarm: (() => void) | null = null;
  let disposed = false;
  const cleanupAll = () => {
    if (disposed) return;
    disposed = true;
    stopWaitingTradePage?.();
    initialPageLoad?.cancel();
    cancelAffixPrewarm?.();
    cleanupEnqueueListener?.();
    cleanupSearchSession?.();
    domFilter.cleanup();
    pricePresenter.cleanup();
    itemNormalizer.cleanup();
    sortController.cleanup();
    modQuickFilter.cleanup();
    pobCopy.cleanup();
    resultPin.cleanup();
    resultCache.clear();
    externalLinks.cleanup();
    modHighlighter.cleanup();
    cleanupHotkeys?.();
    cleanupSearchEnterCommit?.();
    cleanupPageMode?.();
    cleanupPreferences?.();
    stopSidebarPreferences?.();
    removeReservedSidebarLayout?.();
    filterEnhancements.cleanup();
    cleanupPageEvents?.();
    cleanupToastHost();
    if (activeConsoleTitleGuard) {
      activeConsoleTitleGuard.dispose();
      activeConsoleTitleGuard = null;
    }
    if (activeConsoleHostGuard) {
      activeConsoleHostGuard.dispose();
      activeConsoleHostGuard = null;
    }
    if (activeExitGuard) {
      activeExitGuard.dispose();
      activeExitGuard = null;
    }
    if (activeBookmarkController) {
      activeBookmarkController.dispose();
      activeBookmarkController = null;
    }
    if (activeResumeController) {
      activeResumeController.dispose();
      activeResumeController = null;
    }
    activeResumeStore = null;
    if (activePrimaryRuntime) {
      activePrimaryRuntime.dispose();
      activePrimaryRuntime = null;
      activePrimaryController = null;
    }
    if (activeSoundNotifier) {
      activeSoundNotifier.dispose();
      activeSoundNotifier = null;
    }
    console.log('[PoeXD] Logic cleaned up successfully.');
  };
  if (typeof ctx?.onCleanup === 'function') ctx.onCleanup(cleanupAll);
  if (typeof ctx?.onInvalidated === 'function') ctx.onInvalidated(cleanupAll);

  try {
    const preferencesOutcome = await getPreferences(version);
    if (!preferencesOutcome.ok) throw new Error(preferencesOutcome.error.message);
    const preferences = preferencesOutcome.value;
    rememberPageLoadPreferences(preferences.read());
    syncToastPreferences(preferences.read());
    const applyPreferences = async (
      snapshot: Readonly<Preferences>,
      { deferAffixLexicon = false }: { deferAffixLexicon?: boolean } = {},
    ) => {
      const effectiveLocalePref = snapshot.displayLocale;
      setActiveDisplayLocalePreference(effectiveLocalePref);
      // 首次套用不等詞綴字典：mods-tiers 約 3.6 MB，解析時會擋住官網腳本；
      // 用到它的控制項會自行載入，其餘在首批結果後預載（見 preloadAffixLexicon）
      if (!deferAffixLexicon) await ensureAffixLexiconLoaded(version);
      filterEnhancements.updatePureBackgroundClass(snapshot.enablePureBackground);
      filterEnhancements.setTierHelperEnabled(snapshot.enableTierHelper);
      filterEnhancements.setAffixSelectorEnabled(snapshot.enableAffixSelector);
      filterEnhancements.refreshAffixDisplayLocale();
      await pricePresenter.setEnabled(snapshot.enablePriceComparison);
      pricePresenter.refreshLocale?.();
      modHighlighter.setEnabled(snapshot.enableResultModHighlight);
      itemNormalizer.setEnabled(version === 'poe2' && snapshot.enableItemNormalizer);
      itemNormalizer.refreshLocale?.();
      sortController.setEnabled(
        version === 'poe1'
          ? snapshot.enablePriceComparison
          : snapshot.enableItemNormalizer || snapshot.enablePriceComparison,
      );
      sortController.syncSupport();
      sortController.refreshLocale();
      modQuickFilter.setEnabled(snapshot.enableResultModQuickFilter);
      modQuickFilter.refreshLocale();
      pobCopy.setEnabled(snapshot.enableResultPobCopy);
      pobCopy.refreshLocale();
      resultPin.setEnabled(true);
      resultPin.refreshLocale();
      externalLinks.setEnabled(snapshot.enableResultExternalLinks);
      externalLinks.refreshLocale();
    };
    let appliedPreferences = preferences.read();
    await applyPreferences(appliedPreferences, { deferAffixLexicon: true });
    const scheduleIdle = (callback: () => void, timeoutMs = 1500): (() => void) => {
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(callback, { timeout: timeoutMs });
        return () => cancelIdleCallback(id);
      }
      const id = setTimeout(callback, 0);
      return () => clearTimeout(id);
    };
    const preloadAffixLexicon = (role: TradePageRole) => {
      void ensureAffixLexiconLoaded(version)
        .then(() => {
          if (disposed) return;
          filterEnhancements.refreshAffixDisplayLocale();
          if (role !== 'normal') return;
          // 官網載入完畢後，趁主執行緒閒置分兩段預熱：先組好詞綴 tier 快取，再讓隱藏的 FilterPane 預先掛載
          cancelAffixPrewarm = scheduleIdle(() => {
            cancelAffixPrewarm = null;
            if (disposed) return;
            getHydratedModsByGroup(version);
            cancelAffixPrewarm = scheduleIdle(() => {
              cancelAffixPrewarm = null;
              if (disposed) return;
              markAffixSelectorPrewarmed();
            });
          });
        })
        .catch((error) => console.error('[PoeXD] 預載詞綴字典失敗:', error));
    };
    cleanupPreferences = preferences.subscribe((snapshot) => {
      if (snapshot === appliedPreferences) return;
      appliedPreferences = snapshot;
      syncToastPreferences(snapshot);
      void applyPreferences(snapshot).catch((error) =>
        console.error('[PoeXD] 套用偏好設定失敗:', error),
      );
    });
    cleanupSearchSession = await connectSearchObservationSession({
      version,
      preferences,
      consumeCriteria: (searchId, criteria) => modHighlighter.handleSearchQuery(searchId, criteria),
    });
    if (disposed) {
      cleanupSearchSession();
      cleanupSearchSession = null;
      return;
    }
    cleanupPageMode = watchTradePageMode((mode) => {
      pricePresenter.setPageMode(mode);
      itemNormalizer.setPageMode(mode);
      sortController.setPageMode(mode);
      modQuickFilter.setPageMode(mode);
      domFilter.setPageMode(mode);
      filterEnhancements.setEditorEnabled(mode === 'search');
    });
    const interceptorReady = injectApiInterceptor();
    // 與 interceptor 同時建立，才不會漏掉等待頁面角色期間送達的首批結果事件
    const pageLoadGate = createInitialPageLoadGate({
      expectsInitialResults: expectsInitialSearchResults(window.location.href),
    });
    initialPageLoad = pageLoadGate;
    cleanupPageEvents = registerPageContextEvents(
      version,
      pricePresenter,
      itemNormalizer,
      sortController,
      resultCache,
      [pobCopy, resultPin],
      externalLinks,
      filterEnhancements,
    );
    cleanupHotkeys = initHotkeysAndTildeListeners(preferences);
    cleanupSearchEnterCommit = installSearchEnterCommit();

    const initialize = async () => {
      if (disposed) return;
      // 掛載前還要等攔截器與頁面角色：先依儲存的版面讓出位置，掛載時頁面才不會位移
      void reserveSidebarPageLayout(version, preferences, () => disposed)
        .then((remove) => {
          if (disposed) remove();
          else removeReservedSidebarLayout = remove;
        })
        .catch((error) => console.warn('[PoeXD] 預留側邊欄版面失敗:', error));
      await interceptorReady;
      if (disposed) {
        return;
      }
      // 頁面資料若在攔截器就緒前已載入，輪詢之外再主動要一次（MAIN world 不重送同一份）
      dispatchPoeEvent('poexd-request-live-trade-data');
      let pageRole: TradePageRole = 'normal';
      let initialArrivalSignal = false;
      try {
        const roleRes = await extensionMessaging.sendMessage('liveSearch:getPageRole', {
          gameVersion: version,
        });
        if (roleRes?.role) {
          pageRole = roleRes.role;
          initialArrivalSignal = Boolean(roleRes.arrivalSignal);
        }
      } catch (error) {
        console.warn('[PoeXD] 取得頁面角色失敗，預設為 normal:', error);
      }
      if (disposed) {
        return;
      }
      domFilter.setPageRole(pageRole);
      pricePresenter.setPageRole(pageRole);
      itemNormalizer.setPageRole(pageRole);
      sortController.setPageRole(pageRole);
      modQuickFilter.setPageRole(pageRole);
      domFilter.init();
      if (pageRole === 'live-search-primary') {
        document.body?.setAttribute('data-poexd-page-role', 'live-search-primary');
        activeConsoleTitleGuard = createLiveSearchConsoleTitleGuard(document, version);
        activeConsoleTitleGuard.start();
        activeConsoleHostGuard = createLiveSearchConsoleHostGuard();
        activeConsoleHostGuard.start();
        const soundNotifier = createLiveSearchSoundNotifier({
          version,
          isEnabled: () => preferences.read().liveSearchSoundEnabled,
        });
        activeSoundNotifier = soundNotifier;
        activePrimaryRuntime = new LiveSearchPrimaryRuntime(version, {
          getMaxDisplayedResults: () => preferences.read().liveSearchMaxDisplayedResults,
          onResultTokenAccepted: () => soundNotifier.notify(),
          // 主控台自己打的 /fetch 不經過 MAIN world 攔截，結果要另外交給共用快取
          onResultFetched: ({ itemData, searchId, league }) =>
            resultCache.ingestResult(itemData, { sourceSearchId: searchId, league }),
        });
        activePrimaryController = createLiveSearchPrimaryController(activePrimaryRuntime);
        activeResumeStore = createLiveSearchResumeStore(version);
        const bookmarkClient = createChromeBookmarkClient(version);
        activeBookmarkController = createLiveSearchBookmarkController(
          bookmarkClient,
          activePrimaryController,
          { resumeStore: activeResumeStore, preferences },
        );
        activeResumeController = createLiveSearchResumeController({
          version,
          preferences,
          sourceController: activeBookmarkController,
          resumeStore: activeResumeStore,
        });
        activeExitGuard = createLiveSearchPrimaryExitGuard({
          shouldWarn: () => (activePrimaryController?.read().subscriptions.length ?? 0) > 0,
        });

        cleanupEnqueueListener = registerLiveSearchPrimaryEnqueueBridge({
          version,
          messenger: extensionMessaging,
          enqueueIncoming: (items) => {
            if (!activeBookmarkController?.enqueueIncomingConnections) {
              return Promise.resolve({
                success: false,
                addedCount: 0,
                skippedCount: 0,
                error: t('liveSearch.console.notReady'),
                rejectReason: 'failed',
              });
            }
            return activeBookmarkController.enqueueIncomingConnections(items);
          },
          isDisposed: () => disposed || !activeBookmarkController?.enqueueIncomingConnections,
        });
      }
      // 側邊欄一進官方頁就掛載（版面已先預留，掛載時頁面不位移）
      stopSidebarPreferences =
        (await mountSidebarLayout(
          ctx,
          version,
          preferences,
          () => disposed,
          pageRole,
          activePrimaryController,
          activeBookmarkController,
          activeResumeController,
          initialArrivalSignal,
          activeSoundNotifier,
        )) || null;
      if (disposed) {
        domFilter.cleanup();
        return;
      }
      filterEnhancements.initialize();
      if (pageRole === 'normal') {
        // 詞綴字典約 3.6 MB，解析會佔住主執行緒：等官方頁面載完首批結果再預載；
        // 主控台頁不等，以免延後主控台的搜尋保護與連線恢復
        await pageLoadGate.ready;
        if (disposed) return;
      } else {
        pageLoadGate.cancel();
      }
      preloadAffixLexicon(pageRole);
    };
    stopWaitingTradePage = whenTradePageReady(document, () => void initialize(), {
      isDisposed: () => disposed,
    });
    if (!disposed) console.log(`[PoeXD] PoeXD-Extention logic active for game version: ${version}`);
  } catch (error: any) {
    if (error.message?.includes('Extension context invalidated')) {
      console.warn('[PoeXD] 擴充功能已被重新載入，請重新整理網頁以繼續使用。');
    } else {
      console.error('[PoeXD] 初始化過程發生未知錯誤:', error);
    }
  }
}

function registerPageContextEvents(
  version: PoeVersion,
  pricePresenter: ResultPricePresenter,
  itemNormalizer: ResultItemNormalizer,
  sortController: ResultSortController,
  resultCache: TradeResultCache,
  resultConsumers: readonly { refresh(): void }[],
  externalLinks: ResultExternalLinks,
  filterEnhancements: FilterDomEnhancements,
) {
  const cleanups: (() => void)[] = [];

  cleanups.push(
    listenPoeEvent('poexd-fetch-response', async (detail) => {
      try {
        await Promise.all([
          pricePresenter.handleFetchResponse(detail, getTradeLeague()),
          (async () => {
            await itemNormalizer.handleFetchResponse(detail);
            sortController.handleFetchResponse(detail);
          })(),
        ]);
        resultCache.ingestFetchResponse(detail, { league: getTradeLeague() });
        resultConsumers.forEach((consumer) => consumer.refresh());
        externalLinks.refresh();
      } catch (error) {
        console.error('[PoeXD] 解析攔截資料失敗:', error);
      }
    }),
  );
  // 舊版把 known stats 存在 chrome.storage（數 MB），改存記憶體後清掉
  void chrome.storage.local.remove('poexdKnownStats').catch(() => undefined);
  cleanups.push(
    listenPoeEvent('poexd-known-stats', (detail) => {
      const stats = parsePoeKnownStats(detail);
      if (stats) {
        setKnownStats(stats);
      } else {
        console.error('[PoeXD] 解析 known-stats 失敗: 格式不符');
      }
    }),
  );
  // 即時市集資料（ADR-0014）：頁面送來的內容不可信，parse 內完整驗證；
  // 遊戲版本與頁面語系由這裡自行判斷，不採用頁面送來的值
  cleanups.push(
    listenPoeEvent('poexd-live-trade-data', (detail) => {
      const payload = parsePoeLiveTradeData(detail);
      if (!payload) {
        console.warn('[PoeXD] 即時市集資料格式不符，改用打包資料');
        return;
      }
      setLiveTradeData(version, { pageLocale: resolvePageLocale(), ...payload });
    }),
  );
  // 市集漢化啟用時，背景從目標服官方 API 更新的快取也供側邊欄標籤使用（ADR-0012）
  cleanups.push(
    startMarketLiveLabelsSync({
      version,
      hostname: window.location.hostname,
      browserLocale: detectBrowserLocale(),
      readStorage: (keys) => chrome.storage.local.get([...keys]),
      subscribeStorage: (handler) => {
        const listener = (changes: Record<string, unknown>, area: string) => {
          if (area === 'local') handler(Object.keys(changes));
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
      },
      apply: (snapshot) => setMarketLiveTradeData(version, snapshot),
    }),
  );

  return () => cleanups.forEach((cleanup) => cleanup());
}

function injectApiInterceptor(): Promise<void> {
  const nonce =
    Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  initPoeEventNonce(nonce);

  return injectScript('/interceptor.js', {
    keepInDom: true,
    modifyScript: (script: HTMLScriptElement) => {
      script.setAttribute('data-nonce', nonce);
      script.addEventListener('load', () => script.remove(), { once: true });
    },
  })
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error('[PoeXD] 注入 interceptor 失敗:', err);
    });
}
