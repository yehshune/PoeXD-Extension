import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { extensionMessaging } from '@/utils/extension-protocol';
import { t } from '@/utils/i18n';
import type { LiveSearchPrimaryController } from '@/utils/live-search-contract';
import { createLiveSearchResumeStore } from '@/utils/live-search-resume-store';
import type { PreferencesModule } from '@/utils/preferences';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';
import { DEFAULT_TRADE_ORIGIN, getSupportedTradeOrigin } from '@/utils/trade-realms';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { createLiveSearchConsoleHostGuard } from './live-search-console-host-guard';
import { createLiveSearchConsoleTitleGuard } from './live-search-console-title';
import { registerLiveSearchPrimaryEnqueueBridge } from './live-search-enqueue-receiver';
import { createLiveSearchPrimaryExitGuard } from './live-search-primary-exit-guard';
import { LiveSearchPrimaryRuntime } from './live-search-primary-runtime';
import {
  createLiveSearchDesktopNotifier,
  type LiveSearchDesktopNotifier,
} from './live-search-desktop-notifier';
import {
  createLiveSearchResultSourceBadge,
  type LiveSearchResultSourceBadge,
} from './live-search-result-source-badge';
import {
  createLiveSearchSoundNotifier,
  type LiveSearchSoundNotifier,
} from './live-search-sound-notifier';
import {
  createLiveSearchSourceController,
  type LiveSearchSourceController,
} from './live-search-sources';

/**
 * 提供給 Sidebar / Console UI 的單一精簡 handle，取代多層個別 prop 貫穿
 */
export interface LiveSearchConsoleHandles {
  primaryController?: LiveSearchPrimaryController | null;
  sourceController?: LiveSearchSourceController | null;
  soundNotifier?: LiveSearchSoundNotifier | null;
  desktopNotifier?: LiveSearchDesktopNotifier | null;
  initialArrivalSignal?: boolean;
}

export interface LiveSearchPrimarySession {
  readonly console: LiveSearchConsoleHandles;
  dispose(): void;
}

export interface LiveSearchPrimaryEnvironment {
  readonly origin: string;
  readonly canFetchOfficialLeagues: boolean;
  readonly getCurrentPageLeague?: () => string | undefined;
}

function createBrowserEnvironment(): LiveSearchPrimaryEnvironment {
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  const origin = getSupportedTradeOrigin(loc?.origin) ?? DEFAULT_TRADE_ORIGIN;
  const canFetchOfficialLeagues = Boolean(
    loc && loc.protocol.startsWith('http') && !loc.host.includes('localhost'),
  );
  return {
    origin,
    canFetchOfficialLeagues,
    ...(import.meta.env.DEV ? { getCurrentPageLeague: () => getTradeLeague() } : {}),
  };
}

export interface LiveSearchPrimarySessionFactories {
  createTitleGuard: typeof createLiveSearchConsoleTitleGuard;
  createHostGuard: typeof createLiveSearchConsoleHostGuard;
  createSoundNotifier: typeof createLiveSearchSoundNotifier;
  createDesktopNotifier: typeof createLiveSearchDesktopNotifier;
  createResultSourceBadge: typeof createLiveSearchResultSourceBadge;
  createRuntime: (
    version: PoeVersion,
    options: ConstructorParameters<typeof LiveSearchPrimaryRuntime>[1],
  ) => LiveSearchPrimaryRuntime;
  createResumeStore: typeof createLiveSearchResumeStore;
  createBookmarkClient: typeof createChromeBookmarkClient;
  createSourceController: typeof createLiveSearchSourceController;
  createExitGuard: typeof createLiveSearchPrimaryExitGuard;
  registerEnqueueBridge: typeof registerLiveSearchPrimaryEnqueueBridge;
  messenger: typeof extensionMessaging;
}

export interface CreateLiveSearchPrimarySessionInput {
  version: PoeVersion;
  preferences: PreferencesModule;
  resultCache: Pick<TradeResultCache, 'ingestResult'>;
  initialArrivalSignal?: boolean;
  isHostDisposed?: () => boolean;
  doc?: Document;
  environment?: Partial<LiveSearchPrimaryEnvironment>;
  factories?: Partial<LiveSearchPrimarySessionFactories>;
}

const DEFAULT_FACTORIES: LiveSearchPrimarySessionFactories = {
  createTitleGuard: createLiveSearchConsoleTitleGuard,
  createHostGuard: createLiveSearchConsoleHostGuard,
  createSoundNotifier: createLiveSearchSoundNotifier,
  createDesktopNotifier: createLiveSearchDesktopNotifier,
  createResultSourceBadge: createLiveSearchResultSourceBadge,
  createRuntime: (version, options) => new LiveSearchPrimaryRuntime(version, options),
  createResumeStore: createLiveSearchResumeStore,
  createBookmarkClient: createChromeBookmarkClient,
  createSourceController: createLiveSearchSourceController,
  createExitGuard: createLiveSearchPrimaryExitGuard,
  registerEnqueueBridge: registerLiveSearchPrimaryEnqueueBridge,
  messenger: extensionMessaging,
};

/**
 * 封裝 LiveSearch Primary Page 的完整啟動組裝與有序釋放，
 * 使 runtime.ts 不再持有 9 個全域可變狀態，並僅透過單一 handle 銜接側邊欄。
 */
export function createLiveSearchPrimarySession(
  input: CreateLiveSearchPrimarySessionInput,
): LiveSearchPrimarySession {
  const { version, preferences, resultCache, initialArrivalSignal = false, isHostDisposed } = input;
  const doc = input.doc ?? document;
  const env: LiveSearchPrimaryEnvironment = {
    ...createBrowserEnvironment(),
    ...input.environment,
  };
  const f: LiveSearchPrimarySessionFactories = { ...DEFAULT_FACTORIES, ...input.factories };

  doc.body?.setAttribute('data-poexd-page-role', 'live-search-primary');

  let disposed = false;
  let titleGuard: ReturnType<LiveSearchPrimarySessionFactories['createTitleGuard']> | null = null;
  let hostGuard: ReturnType<LiveSearchPrimarySessionFactories['createHostGuard']> | null = null;
  let soundNotifier: LiveSearchSoundNotifier | null = null;
  let desktopNotifier: LiveSearchDesktopNotifier | null = null;
  let resultSourceBadge: LiveSearchResultSourceBadge | null = null;
  let unsubBadgeSync: (() => void) | null = null;
  let unsubSourceBadgeSync: (() => void) | null = null;
  let primaryRuntime: ReturnType<LiveSearchPrimarySessionFactories['createRuntime']> | null = null;
  let sourceController: LiveSearchSourceController | null = null;
  let exitGuard: ReturnType<LiveSearchPrimarySessionFactories['createExitGuard']> | null = null;
  let cleanupEnqueueListener: (() => void) | null = null;

  /** 依固定順序釋放已建立的子模組；建構中途失敗時也只釋放已建立者 */
  function disposeCreated(): void {
    cleanupEnqueueListener?.();
    unsubSourceBadgeSync?.();
    unsubBadgeSync?.();
    resultSourceBadge?.dispose();
    titleGuard?.dispose();
    hostGuard?.dispose();
    exitGuard?.dispose();
    sourceController?.dispose();
    primaryRuntime?.dispose();
    desktopNotifier?.dispose();
    soundNotifier?.dispose();
  }

  let primaryController: LiveSearchPrimaryController;
  try {
    titleGuard = f.createTitleGuard(doc, version);
    titleGuard.start();

    hostGuard = f.createHostGuard();
    hostGuard.start();

    const notifier = f.createSoundNotifier({
      version,
      isEnabled: () => preferences.read().liveSearchSoundEnabled,
    });
    soundNotifier = notifier;

    const desktop = f.createDesktopNotifier({
      version,
      isEnabled: () => preferences.read().liveSearchDesktopNotificationEnabled,
      onFocusConsole: () => {
        if (typeof window !== 'undefined' && typeof window.focus === 'function') {
          window.focus();
        }
        void f.messenger
          .sendMessage('liveSearch:focusPrimary', { gameVersion: version })
          .catch(() => {});
      },
    });
    desktopNotifier = desktop;

    // 來源名稱查表：source controller 的 read() 每次都重建整份快照（解析全部書籤 URL），
    // 結果來源標籤每次同步會對每一列查名稱，直接呼叫 read() 會讓主控台每次互動卡上數秒。
    // 因此只在 source 快照通知時重建一次查表，查名稱為 O(1)。
    let sourceNames: ReadonlyMap<string, string> | null = null;
    const buildSourceNames = (
      snap: ReturnType<LiveSearchSourceController['read']>,
    ): ReadonlyMap<string, string> => {
      const names = new Map<string, string>();
      for (const group of snap.groups ?? []) {
        for (const item of group.items) {
          if (item.canonicalKey && item.name && !names.has(item.canonicalKey)) {
            names.set(item.canonicalKey, item.name);
          }
        }
      }
      // 本次工作階段的連線名稱優先於書籤群組內的名稱
      for (const item of snap.sessionConnections ?? []) {
        if (item.canonicalKey && item.name) names.set(item.canonicalKey, item.name);
      }
      return names;
    };
    const resolveSourceName = (ownerKey: string): string | undefined => {
      // 尚未收到快照通知（或 controller 不支援訂閱）時才退回即時讀取
      const names =
        sourceNames ??
        (typeof sourceController?.read === 'function'
          ? buildSourceNames(sourceController.read())
          : null);
      return names?.get(ownerKey);
    };

    const badge = f.createResultSourceBadge({
      document: doc,
      resolveSourceName,
      getFilterOwner: () => primaryRuntime?.getResultFilter() ?? null,
      onSelectOwner: (ownerKey) => {
        if (!primaryRuntime) return;
        const current = primaryRuntime.getResultFilter();
        primaryRuntime.setResultFilter(current === ownerKey ? null : ownerKey);
      },
      formatTooltip: (name) => t('liveSearch.resultFilter.badgeTooltip', { name }),
    });
    resultSourceBadge = badge;

    primaryRuntime = f.createRuntime(version, {
      origin: env.origin,
      getCurrentPageLeague: env.getCurrentPageLeague,
      getMaxDisplayedResults: () => preferences.read().liveSearchMaxDisplayedResults,
      getFetchOrder: () => preferences.read().liveSearchFetchOrder,
      getTokenMaxAgeSec: () => preferences.read().liveSearchTokenMaxAgeSec,
      onResultDelivered: (event) => {
        if (event?.ownerKey && sourceController?.isMuted?.(event.ownerKey)) {
          return;
        }
        notifier.notify();
        desktop.notify({
          ownerKey: event?.ownerKey,
          sourceName: event?.ownerKey ? resolveSourceName(event.ownerKey) : undefined,
        });
      },
      // 主控台自己打的 /fetch 不經過 MAIN world 攔截，結果要另外交給共用快取
      onResultFetched: ({ itemData, searchId, league }) =>
        resultCache.ingestResult(itemData, { sourceSearchId: searchId, league }),
      onResultRendered: ({ itemId, ownerKey }) => badge.record(itemId, ownerKey),
      onResultsCleared: () => badge.clear(),
    });
    unsubBadgeSync =
      typeof primaryRuntime.subscribe === 'function'
        ? primaryRuntime.subscribe(() => {
            badge.syncAll();
          })
        : null;

    primaryController = primaryRuntime;
    const resumeStore = f.createResumeStore(version);
    const bookmarkClient = f.createBookmarkClient(version);
    const sources = f.createSourceController(bookmarkClient, primaryController, {
      resumeStore,
      preferences,
      origin: env.origin,
      canFetchOfficialLeagues: env.canFetchOfficialLeagues,
    });
    sourceController = sources;
    unsubSourceBadgeSync =
      typeof sources.subscribe === 'function'
        ? sources.subscribe((snapshot) => {
            sourceNames = buildSourceNames(snapshot);
            badge.syncAll();
          })
        : null;
    exitGuard = f.createExitGuard({
      shouldWarn: () => (primaryController.read().subscriptions.length ?? 0) > 0,
    });

    cleanupEnqueueListener = f.registerEnqueueBridge({
      version,
      messenger: f.messenger,
      enqueueIncoming: (items) => {
        if (disposed || !sources.enqueueIncomingConnections) {
          return Promise.resolve({
            success: false,
            addedCount: 0,
            skippedCount: 0,
            error: t('liveSearch.console.notReady'),
            rejectReason: 'failed',
          });
        }
        return sources.enqueueIncomingConnections(items);
      },
      isDisposed: () =>
        disposed || Boolean(isHostDisposed?.()) || !sources.enqueueIncomingConnections,
    });
  } catch (err) {
    disposed = true;
    try {
      disposeCreated();
    } catch (cleanupErr) {
      console.error('[PoeXD LiveSearch] Failed to roll back partial primary session:', cleanupErr);
    }
    throw err;
  }

  return {
    console: {
      primaryController,
      sourceController,
      soundNotifier,
      desktopNotifier,
      initialArrivalSignal,
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      disposeCreated();
    },
  };
}
