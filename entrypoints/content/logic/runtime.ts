import {
  dispatchPoeEvent,
  listenPoeEvent,
  initPoeEventNonce,
  startPoeEventBuffer,
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
import {
  createTwoColumnLayoutController,
  type TwoColumnLayoutController,
  type TwoColumnLayoutOptions,
} from './two-column-layout';
import { parseSearchResultSummary } from '@/utils/result-board/board-events';
import { getTradeResultCache, type TradeResultCache } from '@/utils/trade-result-cache';
import { getResultBoardRuntime, type ResultBoardRuntime } from './result-board-runtime';
import { isCloudflareChallenge } from '@/utils/trade-interstitial-classifier';
import { whenTradePageReady, type WhenTradePageReadyOptions } from './trade-page-readiness';
import { createInitialPageLoadGate } from './initial-page-load-gate';
import { initialPageLoadSignal } from '@/utils/initial-page-load-signal';
import { expectsInitialSearchResults } from '@/utils/trade-search-identity';
import { createFilterDomEnhancements, type FilterDomEnhancements } from './common';
import { initToastHost, syncToastPreferences } from './toast-host';
import { extensionMessaging } from '@/utils/extension-protocol';
import type { TradePageRole } from '@/utils/live-search-contract';
import {
  createLiveSearchPrimarySession,
  type LiveSearchPrimarySession,
} from './live-search-primary-session';
import { setKnownStats } from '@/utils/known-stats-store';
import { setLiveTradeData, setMarketLiveTradeData } from '@/utils/trade-label-resolver';
import { startMarketLiveLabelsSync } from '@/utils/market-live-labels';
import { detectBrowserLocale, resolvePageLocale } from '@/utils/locale-resolution';

export interface ContentPageRuntime {
  start(): Promise<void>;
  dispose(): void;
}

export interface ContentPageRuntimeDeps {
  isCloudflareChallenge: () => boolean;
  getCurrentHref: () => string;
  getHostname: () => string;
  getTradeLeague: typeof getTradeLeague;
  detectBrowserLocale: typeof detectBrowserLocale;
  resolvePageLocale: typeof resolvePageLocale;
  initToastHost: typeof initToastHost;
  syncToastPreferences: typeof syncToastPreferences;
  getTradeResultCache: () => TradeResultCache;
  getResultBoardRuntime: () => Pick<
    ResultBoardRuntime,
    'setEnabled' | 'ensureShortcut' | 'cleanup'
  >;
  createResultEnhancementPipeline: (
    version: PoeVersion,
    resultCache: TradeResultCache,
  ) => ResultEnhancementPipeline;
  createFilterDomEnhancements: (version: PoeVersion) => FilterDomEnhancements;
  createTwoColumnLayoutController: (options?: TwoColumnLayoutOptions) => TwoColumnLayoutController;
  injectApiInterceptor: () => Promise<void>;
  startPoeEventBuffer: typeof startPoeEventBuffer;
  dispatchPoeEvent: typeof dispatchPoeEvent;
  listenPoeEvent: typeof listenPoeEvent;
  parsePoeLiveTradeData: typeof parsePoeLiveTradeData;
  getPreferences: typeof getPreferences;
  rememberPageLoadPreferences: typeof rememberPageLoadPreferences;
  setActiveDisplayLocalePreference: typeof setActiveDisplayLocalePreference;
  ensureAffixLexiconLoaded: typeof ensureAffixLexiconLoaded;
  getHydratedModsByGroup: typeof getHydratedModsByGroup;
  markAffixSelectorPrewarmed: typeof markAffixSelectorPrewarmed;
  connectSearchObservationSession: typeof connectSearchObservationSession;
  watchTradePageMode: typeof watchTradePageMode;
  createInitialPageLoadGate: typeof createInitialPageLoadGate;
  markInitialPageLoadLoaded: () => void;
  initHotkeysAndTildeListeners: typeof initHotkeysAndTildeListeners;
  installSearchEnterCommit: typeof installSearchEnterCommit;
  whenTradePageReady: (onReady: () => void, options?: WhenTradePageReadyOptions) => () => void;
  reserveSidebarPageLayout: typeof reserveSidebarPageLayout;
  mountSidebarLayout: typeof mountSidebarLayout;
  getPageRole: (
    version: PoeVersion,
  ) => Promise<{ role?: TradePageRole; arrivalSignal?: boolean } | null | undefined>;
  createLiveSearchPrimarySession: typeof createLiveSearchPrimarySession;
  setKnownStats: typeof setKnownStats;
  setLiveTradeData: typeof setLiveTradeData;
  setMarketLiveTradeData: typeof setMarketLiveTradeData;
  startMarketLiveLabelsSync: typeof startMarketLiveLabelsSync;
  removeLegacyKnownStats: () => Promise<void>;
  readLocalStorage: (keys: readonly string[]) => Promise<Record<string, unknown>>;
  subscribeLocalStorage: (handler: (changedKeys: string[]) => void) => () => void;
  scheduleIdle: (callback: () => void, timeoutMs?: number) => () => void;
}

export interface ContentPageRuntimeInput {
  ctx: any;
  version: PoeVersion;
  deps?: Partial<ContentPageRuntimeDeps>;
}

/** 初始化期間需要緩衝的 Main World 事件：首批搜尋、結果與頁面資料，漏接就要等下一次才會補上 */
const EARLY_PAGE_EVENTS = [
  'poexd-fetch-response',
  'poexd-fetch-failed',
  'poexd-search-query-observed',
  'poexd-search-triggered',
  'poexd-search-result-summary',
  'poexd-live-trade-data',
] as const;

function defaultScheduleIdle(callback: () => void, timeoutMs = 1500): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
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

const DEFAULT_DEPS: ContentPageRuntimeDeps = {
  isCloudflareChallenge: () => isCloudflareChallenge(window.location, document),
  getCurrentHref: () => window.location.href,
  getHostname: () => window.location.hostname,
  getTradeLeague,
  detectBrowserLocale,
  resolvePageLocale,
  initToastHost,
  syncToastPreferences,
  getTradeResultCache,
  getResultBoardRuntime,
  createResultEnhancementPipeline: createDefaultResultEnhancementPipeline,
  createFilterDomEnhancements,
  createTwoColumnLayoutController,
  injectApiInterceptor,
  startPoeEventBuffer,
  dispatchPoeEvent,
  listenPoeEvent,
  parsePoeLiveTradeData,
  getPreferences,
  rememberPageLoadPreferences,
  setActiveDisplayLocalePreference,
  ensureAffixLexiconLoaded,
  getHydratedModsByGroup,
  markAffixSelectorPrewarmed,
  connectSearchObservationSession,
  watchTradePageMode,
  createInitialPageLoadGate,
  markInitialPageLoadLoaded: () => initialPageLoadSignal.markLoaded(),
  initHotkeysAndTildeListeners,
  installSearchEnterCommit,
  whenTradePageReady: (onReady, options) => whenTradePageReady(document, onReady, options),
  reserveSidebarPageLayout,
  mountSidebarLayout,
  getPageRole: (version) =>
    extensionMessaging.sendMessage('liveSearch:getPageRole', { gameVersion: version }),
  createLiveSearchPrimarySession,
  setKnownStats,
  setLiveTradeData,
  setMarketLiveTradeData,
  startMarketLiveLabelsSync,
  removeLegacyKnownStats: () => chrome.storage.local.remove('poexdKnownStats'),
  readLocalStorage: (keys) => chrome.storage.local.get([...keys]),
  subscribeLocalStorage: (handler) => {
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local') handler(Object.keys(changes));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
  scheduleIdle: defaultScheduleIdle,
};

interface DisposableStack {
  readonly isDisposed: boolean;
  add(cleanup: (() => void) | null | undefined): () => void;
  dispose(): void;
}

function createDisposableStack(): DisposableStack {
  let disposed = false;
  const cleanups: (() => void)[] = [];

  return {
    get isDisposed() {
      return disposed;
    },
    add(cleanup) {
      if (!cleanup) return () => {};
      if (disposed) {
        cleanup();
        return () => {};
      }
      let active = true;
      const runOnce = () => {
        if (!active) return;
        active = false;
        cleanup();
      };
      cleanups.push(runOnce);
      return runOnce;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const pending = cleanups.splice(0).reverse();
      for (const cleanup of pending) {
        cleanup();
      }
    },
  };
}

function raceWithDispose(
  disposables: DisposableStack,
  subscribe: (onComplete: () => void, onCancel: () => void) => (() => void) | void,
): Promise<boolean> {
  if (disposables.isDisposed) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      resolve(completed);
    };
    const stop = subscribe(
      () => finish(true),
      () => finish(false),
    );
    disposables.add(() => {
      stop?.();
      finish(false);
    });
  });
}

function registerPageContextEvents(
  version: PoeVersion,
  resultPipeline: ResultEnhancementPipeline,
  deps: ContentPageRuntimeDeps,
): () => void {
  const cleanups: (() => void)[] = [];

  cleanups.push(
    deps.listenPoeEvent('poexd-fetch-response', async (detail) => {
      try {
        await resultPipeline.handleFetchResponse(detail, deps.getTradeLeague());
      } catch (error) {
        console.error('[PoeXD] 解析攔截資料失敗:', error);
      }
    }),
    deps.listenPoeEvent('poexd-search-result-summary', (detail) => {
      const summary = parseSearchResultSummary(detail);
      if (summary) resultPipeline.handleSearchResultSummary(summary.searchId);
    }),
  );
  // 舊版把 known stats 存在 chrome.storage（數 MB），改存記憶體後清掉
  void deps.removeLegacyKnownStats().catch(() => undefined);
  // 即時市集資料（ADR-0014）：頁面送來的內容不可信，parse 內完整驗證；
  // 遊戲版本與頁面語系由這裡自行判斷，不採用頁面送來的值
  cleanups.push(
    deps.listenPoeEvent('poexd-live-trade-data', (detail) => {
      const payload = deps.parsePoeLiveTradeData(detail);
      if (!payload) {
        console.warn('[PoeXD] 即時市集資料格式不符，改用打包資料');
        return;
      }
      const { knownStats, ...labels } = payload;
      // known stats 由同一份即時資料推導，不再另外接收一份序列化的 knownStatsFlat
      if (knownStats) deps.setKnownStats(knownStats);
      deps.setLiveTradeData(version, { pageLocale: deps.resolvePageLocale(), ...labels });
    }),
  );
  // 市集漢化啟用時，背景從目標服官方 API 更新的快取也供側邊欄標籤使用（ADR-0012）
  cleanups.push(
    deps.startMarketLiveLabelsSync({
      version,
      hostname: deps.getHostname(),
      browserLocale: deps.detectBrowserLocale(),
      readStorage: deps.readLocalStorage,
      subscribeStorage: deps.subscribeLocalStorage,
      apply: (snapshot) => deps.setMarketLiveTradeData(version, snapshot),
    }),
  );

  return () => cleanups.forEach((cleanup) => cleanup());
}

export function createContentPageRuntime(input: ContentPageRuntimeInput): ContentPageRuntime {
  const { ctx, version } = input;
  const deps: ContentPageRuntimeDeps = { ...DEFAULT_DEPS, ...input.deps };
  const disposables = createDisposableStack();
  let startPromise: Promise<void> | null = null;

  const dispose = () => {
    if (disposables.isDisposed) return;
    disposables.dispose();
    console.log('[PoeXD] Logic cleaned up successfully.');
  };

  const run = async (): Promise<void> => {
    if (disposables.isDisposed) return;

    if (deps.isCloudflareChallenge()) {
      console.log('[PoeXD] Cloudflare challenge / interstitial detected in runLogic; aborting.');
      return;
    }

    if (typeof ctx?.onCleanup === 'function') ctx.onCleanup(dispose);
    if (typeof ctx?.onInvalidated === 'function') ctx.onInvalidated(dispose);

    disposables.add(deps.initToastHost(ctx));
    const resultCache = deps.getTradeResultCache();
    disposables.add(() => resultCache.clear());
    // 搜尋結果看板只在一般頁啟用（確定頁面角色後才允許）
    const resultBoard = deps.getResultBoardRuntime();
    disposables.add(() => resultBoard.cleanup());
    let resultBoardAllowed = false;
    const resultPipeline = deps.createResultEnhancementPipeline(version, resultCache);
    disposables.add(() => resultPipeline.cleanup());
    const filterEnhancements = deps.createFilterDomEnhancements(version);
    disposables.add(() => filterEnhancements.cleanup());
    let twoColumnLayoutAllowed = false;
    let activePreferences: Awaited<ReturnType<typeof getPreferences>> extends infer O
      ? O extends { ok: true; value: infer M }
        ? M | null
        : null
      : null = null;
    const twoColumnLayout = deps.createTwoColumnLayoutController({
      onFilterWidthCommit: (width) => {
        void activePreferences?.update({ twoColumnFilterWidth: width });
      },
    });
    disposables.add(() => twoColumnLayout.cleanup());

    // 攔截器要在任何 await 之前注入：官方腳本有快取時，首批 search / fetch 會比讀偏好設定、
    // 連線 background 更早送出，晚注入就整批漏接（結果列沒有 PoB／釘選等按鈕、搜尋紀錄漏記）。
    // 各功能的監聽在初始化完成前才陸續註冊，期間的事件先緩衝，註冊時補送。
    const interceptorReady = deps.injectApiInterceptor();
    const releaseEarlyEvents = disposables.add(deps.startPoeEventBuffer(EARLY_PAGE_EVENTS));

    let cancelAffixPrewarm: (() => void) | null = null;
    disposables.add(() => {
      cancelAffixPrewarm?.();
      cancelAffixPrewarm = null;
    });

    const preloadAffixLexicon = (role: TradePageRole) => {
      void deps
        .ensureAffixLexiconLoaded(version)
        .then(() => {
          if (disposables.isDisposed) return;
          filterEnhancements.refreshAffixDisplayLocale();
          if (role !== 'normal') return;
          // 官網載入完畢後，趁主執行緒閒置分兩段預熱：先組好詞綴 tier 快取，再讓隱藏的 FilterPane 預先掛載
          cancelAffixPrewarm = deps.scheduleIdle(() => {
            cancelAffixPrewarm = null;
            if (disposables.isDisposed) return;
            deps.getHydratedModsByGroup(version);
            cancelAffixPrewarm = deps.scheduleIdle(() => {
              cancelAffixPrewarm = null;
              if (disposables.isDisposed) return;
              deps.markAffixSelectorPrewarmed();
            });
          });
        })
        .catch((error) => console.error('[PoeXD] 預載詞綴字典失敗:', error));
    };

    try {
      const preferencesOutcome = await deps.getPreferences(version);
      if (disposables.isDisposed) return;
      if (!preferencesOutcome.ok) throw new Error(preferencesOutcome.error.message);
      const preferences = preferencesOutcome.value;
      activePreferences = preferences;
      deps.rememberPageLoadPreferences(preferences.read());
      deps.syncToastPreferences(preferences.read());

      const syncTwoColumnLayout = (snapshot: Readonly<Preferences>, role?: TradePageRole) => {
        twoColumnLayout.applyConfig({
          ...(role !== undefined ? { pageRole: role } : {}),
          preferredFilterWidth: snapshot.twoColumnFilterWidth,
          maxWidth: snapshot.twoColumnMaxWidth,
          autoHideHeader: snapshot.twoColumnAutoHideHeader,
          enabled: twoColumnLayoutAllowed && snapshot.enableTwoColumnLayout,
        });
      };

      const applyPreferences = async (
        snapshot: Readonly<Preferences>,
        { deferAffixLexicon = false }: { deferAffixLexicon?: boolean } = {},
      ) => {
        const effectiveLocalePref = snapshot.displayLocale;
        deps.setActiveDisplayLocalePreference(effectiveLocalePref);
        // 首次套用不等詞綴字典：mods-tiers 約 3.6 MB，解析時會擋住官網腳本；
        // 用到它的控制項會自行載入，其餘在首批結果後預載（見 preloadAffixLexicon）
        if (!deferAffixLexicon) {
          await deps.ensureAffixLexiconLoaded(version);
          if (disposables.isDisposed) return;
        }
        filterEnhancements.updatePureBackgroundClass(snapshot.enablePureBackground);
        filterEnhancements.setTierHelperEnabled(snapshot.enableTierHelper);
        filterEnhancements.setAffixSelectorEnabled(snapshot.enableAffixSelector);
        filterEnhancements.refreshAffixDisplayLocale();
        await resultPipeline.applyPreferences(snapshot);
        if (disposables.isDisposed) return;
        resultBoard.setEnabled(resultBoardAllowed && snapshot.sidebarModuleResultBoard);
        resultBoard.ensureShortcut();
        syncTwoColumnLayout(snapshot);
        twoColumnLayout.refreshLocale();
      };

      let appliedPreferences = preferences.read();
      await applyPreferences(appliedPreferences, { deferAffixLexicon: true });
      if (disposables.isDisposed) return;

      disposables.add(
        preferences.subscribe((snapshot) => {
          if (disposables.isDisposed || snapshot === appliedPreferences) return;
          appliedPreferences = snapshot;
          deps.syncToastPreferences(snapshot);
          void applyPreferences(snapshot).catch((error) =>
            console.error('[PoeXD] 套用偏好設定失敗:', error),
          );
        }),
      );

      const cleanupSearchSession = await deps.connectSearchObservationSession({
        version,
        preferences,
        consumeCriteria: (searchId, criteria) =>
          resultPipeline.handleSearchQuery(searchId, criteria),
      });
      disposables.add(cleanupSearchSession);
      if (disposables.isDisposed) return;

      disposables.add(
        deps.watchTradePageMode((mode) => {
          resultPipeline.setPageMode(mode);
          filterEnhancements.setEditorEnabled(mode === 'search');
        }),
      );

      // 頁面角色確定前就建立，加上事件緩衝補送，才不會漏掉首批結果事件
      const pageLoadGate = deps.createInitialPageLoadGate({
        expectsInitialResults: expectsInitialSearchResults(deps.getCurrentHref()),
      });
      const cancelPageLoadGate = disposables.add(() => pageLoadGate.cancel());

      disposables.add(registerPageContextEvents(version, resultPipeline, deps));
      disposables.add(deps.initHotkeysAndTildeListeners(preferences));
      disposables.add(deps.installSearchEnterCommit());

      const readyReached = await raceWithDispose(disposables, (onComplete) =>
        deps.whenTradePageReady(onComplete, { isDisposed: () => disposables.isDisposed }),
      );
      if (!readyReached || disposables.isDisposed) return;

      // 掛載前還要等攔截器與頁面角色：先依儲存的版面讓出位置，掛載時頁面才不會位移
      void deps
        .reserveSidebarPageLayout(version, preferences, () => disposables.isDisposed)
        .then((remove) => {
          disposables.add(remove);
        })
        .catch((error) => console.warn('[PoeXD] 預留側邊欄版面失敗:', error));

      await interceptorReady;
      if (disposables.isDisposed) return;

      // 頁面資料若在攔截器就緒前已載入，輪詢之外再主動要一次（MAIN world 不重送同一份）
      deps.dispatchPoeEvent('poexd-request-live-trade-data');

      let pageRole: TradePageRole = 'normal';
      let initialArrivalSignal = false;
      try {
        const roleRes = await deps.getPageRole(version);
        if (roleRes?.role) {
          pageRole = roleRes.role;
          initialArrivalSignal = Boolean(roleRes.arrivalSignal);
        }
      } catch (error) {
        console.warn('[PoeXD] 取得頁面角色失敗，預設為 normal:', error);
      }
      if (disposables.isDisposed) return;

      resultBoardAllowed = pageRole === 'normal';
      resultBoard.setEnabled(resultBoardAllowed && preferences.read().sidebarModuleResultBoard);
      twoColumnLayoutAllowed = pageRole === 'normal';
      syncTwoColumnLayout(preferences.read(), pageRole);
      resultPipeline.setPageRole(pageRole);
      resultPipeline.init();

      let liveSearchSession: LiveSearchPrimarySession | null = null;
      if (pageRole === 'live-search-primary') {
        liveSearchSession = deps.createLiveSearchPrimarySession({
          version,
          preferences,
          resultCache,
          initialArrivalSignal,
          isHostDisposed: () => disposables.isDisposed,
        });
        disposables.add(() => liveSearchSession?.dispose());
      }

      // 側邊欄一進官方頁就掛載（版面已先預留，掛載時頁面不位移）
      const stopSidebarPreferences = await deps.mountSidebarLayout(
        ctx,
        version,
        preferences,
        () => disposables.isDisposed,
        {
          pageRole,
          liveSearchConsole: liveSearchSession?.console ?? null,
        },
      );
      disposables.add(stopSidebarPreferences);
      if (disposables.isDisposed) return;

      // 所有初始化期間註冊的監聽都已補送完畢，之後的事件即時處理即可
      releaseEarlyEvents();
      filterEnhancements.initialize();

      if (pageRole === 'normal') {
        // 詞綴字典約 3.6 MB，解析會佔住主執行緒：等官方頁面載完首批結果再預載；
        // 主控台頁不等，以免延後主控台的搜尋保護與連線恢復
        const gateCompleted = await raceWithDispose(disposables, (onComplete, onCancel) => {
          void pageLoadGate.ready.then(onComplete, onCancel);
        });
        if (!gateCompleted || disposables.isDisposed) return;
      } else {
        cancelPageLoadGate();
      }

      // 側邊欄的重量級背景載入（PoB 對照資料等）同樣等到這裡才開始
      deps.markInitialPageLoadLoaded();
      preloadAffixLexicon(pageRole);
      console.log(`[PoeXD] PoeXD-Extention logic active for game version: ${version}`);
    } catch (error: any) {
      releaseEarlyEvents();
      // 初始化失敗時不能讓等待訊號的功能永遠卡住
      deps.markInitialPageLoadLoaded();
      if (error?.message?.includes('Extension context invalidated')) {
        console.warn('[PoeXD] 擴充功能已被重新載入，請重新整理網頁以繼續使用。');
      } else {
        console.error('[PoeXD] 初始化過程發生未知錯誤:', error);
      }
    }
  };

  return {
    start() {
      if (!startPromise) {
        startPromise = run();
      }
      return startPromise;
    },
    dispose,
  };
}

export async function runLogic(ctx: any, version: PoeVersion): Promise<void> {
  const runtime = createContentPageRuntime({ ctx, version });
  await runtime.start();
}
