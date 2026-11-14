import {
  dispatchPoeEvent,
  listenPoeEvent,
  initPoeEventNonce,
  parsePoeKnownStats,
  parsePoeLiveTradeData,
} from '@/utils/event-contracts';
import { injectScript } from 'wxt/utils/inject-script';
import { getPreferences, type Preferences } from '@/utils/preferences';
import { ensureAffixLexiconLoaded } from '@/utils/affix-lexicon';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';
import { watchTradePageMode } from '@/utils/trade-page-mode';
import { DomFilter } from './dom-filter';
import { initHotkeysAndTildeListeners } from './hotkeys';
import { installSearchEnterCommit } from './search-enter-commit';
import { connectSearchObservationSession } from './search-observation-session';
import { mountSidebarLayout } from './sidebar-layout';
import { ResultPricePresenter } from './result-price-presenter';
import { ResultModHighlighter } from './result-mod-highlighter';
import { ResultItemNormalizer } from './result-item-normalizer';
import { ResultModQuickFilter } from './result-mod-quick-filter';
import { isCloudflareChallenge } from '@/utils/trade-interstitial-classifier';
import { whenTradePageReady } from './trade-page-readiness';
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
import { setKnownStats } from '@/utils/known-stats-store';
import { setLiveTradeData } from '@/utils/live-trade-data-store';
import { resolvePageLocale } from '@/utils/locale-resolution';

let activePrimaryRuntime: LiveSearchPrimaryRuntime | null = null;
let activePrimaryController: LiveSearchPrimaryController | null = null;
let activeBookmarkController: LiveSearchBookmarkController | null = null;
let activeResumeStore: LiveSearchResumeStore | null = null;
let activeResumeController: LiveSearchResumeController | null = null;
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
  const itemNormalizer = new ResultItemNormalizer(version, pricePresenter);
  const modQuickFilter = new ResultModQuickFilter();
  const domFilter = new DomFilter(
    version,
    pricePresenter,
    modHighlighter,
    itemNormalizer,
    modQuickFilter,
  );
  const filterEnhancements = createFilterDomEnhancements(version);
  let cleanupPageEvents: (() => void) | null = null;
  let cleanupHotkeys: (() => void) | null = null;
  let cleanupSearchEnterCommit: (() => void) | null = null;
  let cleanupPageMode: (() => void) | null = null;
  let cleanupPreferences: (() => void) | null = null;
  let cleanupSearchSession: (() => void) | null = null;
  let stopSidebarPreferences: (() => void) | null = null;
  let stopWaitingTradePage: (() => void) | null = null;
  let cleanupEnqueueListener: (() => void) | null = null;
  let disposed = false;
  const cleanupAll = () => {
    if (disposed) return;
    disposed = true;
    stopWaitingTradePage?.();
    cleanupEnqueueListener?.();
    cleanupSearchSession?.();
    domFilter.cleanup();
    pricePresenter.cleanup();
    itemNormalizer.cleanup();
    modQuickFilter.cleanup();
    modHighlighter.cleanup();
    cleanupHotkeys?.();
    cleanupSearchEnterCommit?.();
    cleanupPageMode?.();
    cleanupPreferences?.();
    stopSidebarPreferences?.();
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
    console.log('[PoeXD] Logic cleaned up successfully.');
  };
  if (typeof ctx?.onCleanup === 'function') ctx.onCleanup(cleanupAll);
  if (typeof ctx?.onInvalidated === 'function') ctx.onInvalidated(cleanupAll);

  try {
    const preferencesOutcome = await getPreferences(version);
    if (!preferencesOutcome.ok) throw new Error(preferencesOutcome.error.message);
    const preferences = preferencesOutcome.value;
    syncToastPreferences(preferences.read());
    const applyPreferences = async (snapshot: Readonly<Preferences>) => {
      const effectiveLocalePref = snapshot.displayLocale;
      setActiveDisplayLocalePreference(effectiveLocalePref);
      await ensureAffixLexiconLoaded(version);
      filterEnhancements.updatePureBackgroundClass(snapshot.enablePureBackground);
      filterEnhancements.setTierHelperEnabled(snapshot.enableTierHelper);
      filterEnhancements.setAffixSelectorEnabled(snapshot.enableAffixSelector);
      filterEnhancements.refreshAffixDisplayLocale();
      await pricePresenter.setEnabled(snapshot.enablePriceComparison);
      pricePresenter.refreshLocale?.();
      modHighlighter.setEnabled(snapshot.enableResultModHighlight);
      itemNormalizer.setEnabled(snapshot.enableItemNormalizer);
      itemNormalizer.refreshLocale?.();
      modQuickFilter.setEnabled(snapshot.enableResultModQuickFilter);
      modQuickFilter.refreshLocale();
    };
    let appliedPreferences = preferences.read();
    await applyPreferences(appliedPreferences);
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
      modQuickFilter.setPageMode(mode);
      domFilter.setPageMode(mode);
      filterEnhancements.setEditorEnabled(mode === 'search');
    });
    const interceptorReady = injectApiInterceptor();
    cleanupPageEvents = registerPageContextEvents(
      version,
      pricePresenter,
      itemNormalizer,
      filterEnhancements,
    );
    cleanupHotkeys = initHotkeysAndTildeListeners(preferences);
    cleanupSearchEnterCommit = installSearchEnterCommit();

    const initialize = async () => {
      if (disposed) return;
      await Promise.all([domFilter.init(), interceptorReady]);
      if (disposed) {
        domFilter.cleanup();
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
        domFilter.cleanup();
        return;
      }
      domFilter.setPageRole(pageRole);
      itemNormalizer.setPageRole(pageRole);
      modQuickFilter.setPageRole(pageRole);
      if (pageRole === 'live-search-primary') {
        document.body?.setAttribute('data-poexd-page-role', 'live-search-primary');
        activeConsoleTitleGuard = createLiveSearchConsoleTitleGuard(document, version);
        activeConsoleTitleGuard.start();
        activeConsoleHostGuard = createLiveSearchConsoleHostGuard();
        activeConsoleHostGuard.start();
        activePrimaryRuntime = new LiveSearchPrimaryRuntime(version, {
          getMaxDisplayedResults: () => preferences.read().liveSearchMaxDisplayedResults,
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

        cleanupEnqueueListener = extensionMessaging.onMessage(
          'liveSearch:receiveEnqueuedConnections',
          async ({ data }) => {
            if (
              disposed ||
              (data.gameVersion && data.gameVersion !== version) ||
              !activeBookmarkController?.enqueueIncomingConnections
            ) {
              return {
                success: false,
                addedCount: 0,
                skippedCount: 0,
                error: '主控台未就緒',
                rejectReason: 'failed',
              };
            }
            return await activeBookmarkController.enqueueIncomingConnections(data.items);
          },
        );

        void extensionMessaging
          .sendMessage('liveSearch:consumePendingEnqueue', {
            gameVersion: version,
          })
          .then(async (res) => {
            if (
              !disposed &&
              res?.items &&
              res.items.length > 0 &&
              activeBookmarkController?.enqueueIncomingConnections
            ) {
              await activeBookmarkController.enqueueIncomingConnections(res.items);
            }
          })
          .catch((err) => {
            console.warn('[PoeXD] 消費待處理連線佇列失敗:', err);
          });
      }
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
        )) || null;
      if (disposed) {
        domFilter.cleanup();
        return;
      }
      filterEnhancements.initialize();
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
  filterEnhancements: FilterDomEnhancements,
) {
  const cleanups: (() => void)[] = [];

  cleanups.push(
    listenPoeEvent('poexd-fetch-response', async (detail) => {
      try {
        await Promise.all([
          pricePresenter.handleFetchResponse(detail, getTradeLeague()),
          itemNormalizer.handleFetchResponse(detail),
        ]);
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
