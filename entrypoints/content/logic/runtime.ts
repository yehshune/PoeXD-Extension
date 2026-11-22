import {
  dispatchPoeEvent,
  listenPoeEvent,
  initPoeEventNonce,
  startPoeEventBuffer,
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
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import { rememberPageLoadPreferences } from '@/utils/page-load-preferences';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';
import { watchTradePageMode } from '@/utils/trade-page-mode';
import {
  createDefaultResultEnhancementPipeline,
  type ResultEnhancementPipeline,
} from './result-enhancement-pipeline';
import { initHotkeysAndTildeListeners } from './hotkeys';
import { installSearchEnterCommit } from './search-enter-commit';
import { connectSearchObservationSession } from './search-observation-session';
import { mountSidebarLayout, reserveSidebarPageLayout } from './sidebar-layout';
import { getTradeResultCache } from '@/utils/trade-result-cache';
import { getResultBoardRuntime } from './result-board-runtime';
import { isCloudflareChallenge } from '@/utils/trade-interstitial-classifier';
import { whenTradePageReady } from './trade-page-readiness';
import { createInitialPageLoadGate, type InitialPageLoadGate } from './initial-page-load-gate';
import { expectsInitialSearchResults } from '@/utils/trade-search-identity';
import { createFilterDomEnhancements } from './common';
import { initToastHost, syncToastPreferences } from './toast-host';
import { extensionMessaging } from '@/utils/extension-protocol';
import type { TradePageRole } from '@/utils/live-search-contract';
import {
  createLiveSearchPrimarySession,
  type LiveSearchPrimarySession,
} from './live-search-primary-session';
import { setKnownStats } from '@/utils/known-stats-store';
import { setLiveTradeData, setMarketLiveTradeData } from '@/utils/live-trade-data-store';
import { startMarketLiveLabelsSync } from '@/utils/market-live-labels';
import { detectBrowserLocale, resolvePageLocale } from '@/utils/locale-resolution';

export async function runLogic(ctx: any, version: PoeVersion) {
  if (isCloudflareChallenge(window.location, document)) {
    console.log('[PoeXD] Cloudflare challenge / interstitial detected in runLogic; aborting.');
    return;
  }
  const cleanupToastHost = initToastHost(ctx);
  const resultCache = getTradeResultCache();
  // 搜尋結果看板只在一般頁啟用（確定頁面角色後才允許）
  const resultBoard = getResultBoardRuntime();
  let resultBoardAllowed = false;
  const resultPipeline = createDefaultResultEnhancementPipeline(version, resultCache);
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
  let liveSearchSession: LiveSearchPrimarySession | null = null;
  let initialPageLoad: InitialPageLoadGate | null = null;
  let cancelAffixPrewarm: (() => void) | null = null;
  let stopEarlyEventBuffer: (() => void) | null = null;
  const releaseEarlyEvents = () => {
    stopEarlyEventBuffer?.();
    stopEarlyEventBuffer = null;
  };
  let disposed = false;
  const cleanupAll = () => {
    if (disposed) return;
    disposed = true;
    releaseEarlyEvents();
    stopWaitingTradePage?.();
    initialPageLoad?.cancel();
    cancelAffixPrewarm?.();
    cleanupSearchSession?.();
    resultPipeline.cleanup();
    resultBoard.cleanup();
    resultCache.clear();
    cleanupHotkeys?.();
    cleanupSearchEnterCommit?.();
    cleanupPageMode?.();
    cleanupPreferences?.();
    stopSidebarPreferences?.();
    removeReservedSidebarLayout?.();
    filterEnhancements.cleanup();
    cleanupPageEvents?.();
    cleanupToastHost();
    liveSearchSession?.dispose();
    liveSearchSession = null;
    console.log('[PoeXD] Logic cleaned up successfully.');
  };
  if (typeof ctx?.onCleanup === 'function') ctx.onCleanup(cleanupAll);
  if (typeof ctx?.onInvalidated === 'function') ctx.onInvalidated(cleanupAll);

  // 攔截器要在任何 await 之前注入：官方腳本有快取時，首批 search / fetch 會比讀偏好設定、
  // 連線 background 更早送出，晚注入就整批漏接（結果列沒有 PoB／釘選等按鈕、搜尋紀錄漏記）。
  // 各功能的監聽在初始化完成前才陸續註冊，期間的事件先緩衝，註冊時補送。
  const interceptorReady = injectApiInterceptor();
  stopEarlyEventBuffer = startPoeEventBuffer(EARLY_PAGE_EVENTS);

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
      await resultPipeline.applyPreferences(snapshot);
      resultBoard.setEnabled(resultBoardAllowed && snapshot.sidebarModuleResultBoard);
      resultBoard.ensureShortcut();
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
      consumeCriteria: (searchId, criteria) => resultPipeline.handleSearchQuery(searchId, criteria),
    });
    if (disposed) {
      cleanupSearchSession();
      cleanupSearchSession = null;
      return;
    }
    cleanupPageMode = watchTradePageMode((mode) => {
      resultPipeline.setPageMode(mode);
      filterEnhancements.setEditorEnabled(mode === 'search');
    });
    // 頁面角色確定前就建立，加上事件緩衝補送，才不會漏掉首批結果事件
    const pageLoadGate = createInitialPageLoadGate({
      expectsInitialResults: expectsInitialSearchResults(window.location.href),
    });
    initialPageLoad = pageLoadGate;
    cleanupPageEvents = registerPageContextEvents(version, resultPipeline);
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
      resultBoardAllowed = pageRole === 'normal';
      resultBoard.setEnabled(resultBoardAllowed && preferences.read().sidebarModuleResultBoard);
      resultPipeline.setPageRole(pageRole);
      resultPipeline.init();
      if (pageRole === 'live-search-primary') {
        liveSearchSession = createLiveSearchPrimarySession({
          version,
          preferences,
          resultCache,
          initialArrivalSignal,
          isHostDisposed: () => disposed,
        });
      }
      // 側邊欄一進官方頁就掛載（版面已先預留，掛載時頁面不位移）
      stopSidebarPreferences =
        (await mountSidebarLayout(ctx, version, preferences, () => disposed, {
          pageRole,
          liveSearchConsole: liveSearchSession?.console ?? null,
        })) || null;
      if (disposed) {
        resultPipeline.cleanup();
        return;
      }
      // 所有初始化期間註冊的監聽都已補送完畢，之後的事件即時處理即可
      releaseEarlyEvents();
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
    releaseEarlyEvents();
    if (error.message?.includes('Extension context invalidated')) {
      console.warn('[PoeXD] 擴充功能已被重新載入，請重新整理網頁以繼續使用。');
    } else {
      console.error('[PoeXD] 初始化過程發生未知錯誤:', error);
    }
  }
}

function registerPageContextEvents(version: PoeVersion, resultPipeline: ResultEnhancementPipeline) {
  const cleanups: (() => void)[] = [];

  cleanups.push(
    listenPoeEvent('poexd-fetch-response', async (detail) => {
      try {
        await resultPipeline.handleFetchResponse(detail, getTradeLeague());
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

/** 初始化期間需要緩衝的 Main World 事件：首批搜尋、結果與頁面資料，漏接就要等下一次才會補上 */
const EARLY_PAGE_EVENTS = [
  'poexd-fetch-response',
  'poexd-fetch-failed',
  'poexd-search-query-observed',
  'poexd-search-triggered',
  'poexd-search-result-summary',
  'poexd-known-stats',
  'poexd-live-trade-data',
] as const;

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
