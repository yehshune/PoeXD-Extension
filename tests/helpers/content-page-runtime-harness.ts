import { vi } from 'vitest';
import type { FilterDomEnhancements } from '@/entrypoints/content/logic/common';
import type { LiveSearchPrimarySession } from '@/entrypoints/content/logic/live-search-primary-session';
import type { ResultEnhancementPipeline } from '@/entrypoints/content/logic/result-enhancement-pipeline';
import type { ContentPageRuntimeDeps } from '@/entrypoints/content/logic/runtime';
import type { TwoColumnLayoutController } from '@/entrypoints/content/logic/two-column-layout';
import { DEFAULT_PREFERENCES, type Preferences, type PreferencesModule } from '@/utils/preferences';
import type { TradeResultCache } from '@/utils/trade-result-cache';

export function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createFakePreferencesModule(initial: Partial<Preferences> = {}) {
  let snapshot: Readonly<Preferences> = Object.freeze({
    ...DEFAULT_PREFERENCES,
    ...initial,
  });
  const listeners = new Set<(next: Readonly<Preferences>) => void>();

  const module: PreferencesModule = {
    read: () => snapshot,
    update: vi.fn(async (changes) => {
      snapshot = Object.freeze({ ...snapshot, ...changes });
      for (const listener of [...listeners]) listener(snapshot);
      return { ok: true as const, changed: true };
    }),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };

  return {
    module,
    emit(changes: Partial<Preferences>) {
      snapshot = Object.freeze({ ...snapshot, ...changes });
      for (const listener of [...listeners]) listener(snapshot);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

export function createFakeRuntimeHarness(overrides: Partial<ContentPageRuntimeDeps> = {}) {
  const order: string[] = [];
  const preferences = createFakePreferencesModule();
  const pageListeners = new Map<string, Set<(detail: unknown) => void>>();
  const idleCallbacks: Array<{ cb: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
  const storageListeners = new Set<(changedKeys: string[]) => void>();
  let marketSyncApply: ((snapshot: any) => void) | null = null;
  let tradePageReadyTrigger: (() => void) | null = null;

  const toastCleanup = vi.fn(() => order.push('cleanup:toast'));
  const earlyBufferRelease = vi.fn(() => order.push('release:earlyBuffer'));
  const searchSessionCleanup = vi.fn(() => order.push('cleanup:searchSession'));
  const pageModeCleanup = vi.fn(() => order.push('cleanup:pageMode'));
  const hotkeysCleanup = vi.fn(() => order.push('cleanup:hotkeys'));
  const enterCommitCleanup = vi.fn(() => order.push('cleanup:enterCommit'));
  const marketSyncCleanup = vi.fn(() => order.push('cleanup:marketSync'));
  const tradeReadyCleanup = vi.fn(() => order.push('cleanup:tradeReady'));
  const reserveSidebarCleanup = vi.fn(() => order.push('cleanup:reserveSidebar'));
  const mountSidebarCleanup = vi.fn(() => order.push('cleanup:mountSidebar'));
  const liveSearchDispose = vi.fn(() => order.push('dispose:liveSearchSession'));

  const pageLoadGateDeferred = createDeferred<void>();
  const pageLoadGate = {
    ready: pageLoadGateDeferred.promise,
    cancel: vi.fn(() => order.push('cancel:pageLoadGate')),
  };

  const resultCache = {
    clear: vi.fn(() => order.push('clear:resultCache')),
    ingestResult: vi.fn(),
  } as unknown as TradeResultCache;

  const resultBoard = {
    setEnabled: vi.fn(),
    ensureShortcut: vi.fn(),
    cleanup: vi.fn(() => order.push('cleanup:resultBoard')),
  };

  const resultPipeline = {
    applyPreferences: vi.fn(async () => undefined),
    handleSearchQuery: vi.fn(),
    handleFetchResponse: vi.fn(async () => undefined),
    handleSearchResultSummary: vi.fn(),
    setPageMode: vi.fn(),
    setPageRole: vi.fn(),
    init: vi.fn(() => order.push('init:resultPipeline')),
    cleanup: vi.fn(() => order.push('cleanup:resultPipeline')),
  } as unknown as ResultEnhancementPipeline;

  const filterEnhancements: FilterDomEnhancements = {
    initialize: vi.fn(() => order.push('init:filterEnhancements')),
    cleanup: vi.fn(() => order.push('cleanup:filterEnhancements')),
    setEditorEnabled: vi.fn(),
    setTierHelperEnabled: vi.fn(),
    setAffixSelectorEnabled: vi.fn(),
    updatePureBackgroundClass: vi.fn(),
    refreshAffixDisplayLocale: vi.fn(),
  };

  const twoColumnLayout: TwoColumnLayoutController = {
    setEnabled: vi.fn(),
    setPageRole: vi.fn(),
    setPreferredFilterWidth: vi.fn(),
    setMaxWidth: vi.fn(),
    setAutoHideHeader: vi.fn(),
    setFiltersCollapsed: vi.fn(),
    refreshLocale: vi.fn(),
    sync: vi.fn(() => ({
      active: false,
      reason: 'disabled' as const,
      leftWidth: 460,
      maxFilterWidth: 1200,
      maxWidthCss: 'none',
      filtersCollapsed: false,
    })),
    cleanup: vi.fn(() => order.push('cleanup:twoColumnLayout')),
  };

  const liveSearchSession: LiveSearchPrimarySession = {
    console: { initialArrivalSignal: true },
    dispose: liveSearchDispose,
  };

  const ctx = {
    onCleanup: vi.fn(),
    onInvalidated: vi.fn(),
  };

  const deps: ContentPageRuntimeDeps = {
    isCloudflareChallenge: vi.fn(() => false),
    getCurrentHref: vi.fn(() => 'https://www.pathofexile.com/trade/search/Keepers'),
    getHostname: vi.fn(() => 'www.pathofexile.com'),
    getTradeLeague: vi.fn(() => 'Keepers'),
    detectBrowserLocale: vi.fn(() => 'zh-TW'),
    resolvePageLocale: vi.fn(() => 'en' as const),
    initToastHost: vi.fn(() => toastCleanup),
    syncToastPreferences: vi.fn(),
    getTradeResultCache: vi.fn(() => resultCache),
    getResultBoardRuntime: vi.fn(() => resultBoard),
    createResultEnhancementPipeline: vi.fn(() => resultPipeline),
    createFilterDomEnhancements: vi.fn(() => filterEnhancements),
    createTwoColumnLayoutController: vi.fn(() => twoColumnLayout),
    injectApiInterceptor: vi.fn(async () => {
      order.push('inject:interceptor');
    }),
    startPoeEventBuffer: vi.fn(() => {
      order.push('start:earlyBuffer');
      return earlyBufferRelease;
    }),
    dispatchPoeEvent: vi.fn(),
    listenPoeEvent: vi.fn((eventName: string, handler: (detail: any) => void) => {
      let set = pageListeners.get(eventName);
      if (!set) {
        set = new Set();
        pageListeners.set(eventName, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    }) as ContentPageRuntimeDeps['listenPoeEvent'],
    parsePoeLiveTradeData: vi.fn((detail: any) => detail),
    getPreferences: vi.fn(async () => {
      order.push('get:preferences');
      return { ok: true as const, value: preferences.module };
    }),
    rememberPageLoadPreferences: vi.fn(),
    setActiveDisplayLocalePreference: vi.fn(() => 'en' as const),
    ensureAffixLexiconLoaded: vi.fn(async () => {
      order.push('load:affixLexicon');
    }),
    getHydratedModsByGroup: vi.fn(() => {
      order.push('prewarm:hydratedMods');
      return {} as any;
    }),
    markAffixSelectorPrewarmed: vi.fn(() => {
      order.push('prewarm:affixSelector');
    }),
    connectSearchObservationSession: vi.fn(async () => searchSessionCleanup),
    watchTradePageMode: vi.fn((cb) => {
      cb('search');
      return pageModeCleanup;
    }),
    createInitialPageLoadGate: vi.fn(() => pageLoadGate),
    markInitialPageLoadLoaded: vi.fn(() => {
      order.push('signal:markLoaded');
    }),
    initHotkeysAndTildeListeners: vi.fn(() => hotkeysCleanup),
    installSearchEnterCommit: vi.fn(() => enterCommitCleanup),
    whenTradePageReady: vi.fn((onReady) => {
      tradePageReadyTrigger = onReady;
      onReady();
      return tradeReadyCleanup;
    }),
    reserveSidebarPageLayout: vi.fn(async () => reserveSidebarCleanup),
    mountSidebarLayout: vi.fn(async () => {
      order.push('mount:sidebar');
      return mountSidebarCleanup;
    }),
    getPageRole: vi.fn(async () => ({ role: 'normal' as const, arrivalSignal: false })),
    createLiveSearchPrimarySession: vi.fn(() => liveSearchSession),
    setKnownStats: vi.fn(),
    setLiveTradeData: vi.fn(),
    setMarketLiveTradeData: vi.fn(),
    startMarketLiveLabelsSync: vi.fn((opts) => {
      marketSyncApply = opts.apply;
      return marketSyncCleanup;
    }),
    removeLegacyKnownStats: vi.fn(async () => undefined),
    readLocalStorage: vi.fn(async () => ({})),
    subscribeLocalStorage: vi.fn((handler) => {
      storageListeners.add(handler);
      return () => storageListeners.delete(handler);
    }),
    scheduleIdle: vi.fn((cb) => {
      const cancel = vi.fn();
      idleCallbacks.push({ cb, cancel });
      return cancel;
    }),
    ...overrides,
  };

  return {
    ctx,
    deps,
    order,
    preferences,
    pageListeners,
    idleCallbacks,
    pageLoadGate,
    pageLoadGateDeferred,
    resultCache,
    resultBoard,
    resultPipeline,
    filterEnhancements,
    twoColumnLayout,
    liveSearchSession,
    cleanups: {
      toastCleanup,
      earlyBufferRelease,
      searchSessionCleanup,
      pageModeCleanup,
      hotkeysCleanup,
      enterCommitCleanup,
      marketSyncCleanup,
      tradeReadyCleanup,
      reserveSidebarCleanup,
      mountSidebarCleanup,
      liveSearchDispose,
    },
    emitPageEvent(name: string, detail?: unknown) {
      for (const handler of [...(pageListeners.get(name) ?? [])]) {
        handler(detail);
      }
    },
    triggerTradePageReady() {
      tradePageReadyTrigger?.();
    },
    applyMarketSync(snapshot: any) {
      marketSyncApply?.(snapshot);
    },
  };
}
