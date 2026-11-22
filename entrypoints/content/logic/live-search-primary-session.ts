import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { extensionMessaging } from '@/utils/extension-protocol';
import { t } from '@/utils/i18n';
import type { LiveSearchPrimaryController } from '@/utils/live-search-contract';
import { createLiveSearchResumeStore } from '@/utils/live-search-resume-store';
import type { PreferencesModule } from '@/utils/preferences';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { createLiveSearchConsoleHostGuard } from './live-search-console-host-guard';
import { createLiveSearchConsoleTitleGuard } from './live-search-console-title';
import { registerLiveSearchPrimaryEnqueueBridge } from './live-search-enqueue-receiver';
import { createLiveSearchPrimaryController } from './live-search-primary-controller';
import { createLiveSearchPrimaryExitGuard } from './live-search-primary-exit-guard';
import { LiveSearchPrimaryRuntime } from './live-search-primary-runtime';
import {
  createLiveSearchResumeController,
  type LiveSearchResumeController,
} from './live-search-resume-controller';
import {
  createLiveSearchDesktopNotifier,
  type LiveSearchDesktopNotifier,
} from './live-search-desktop-notifier';
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
  resumeController?: LiveSearchResumeController | null;
  soundNotifier?: LiveSearchSoundNotifier | null;
  desktopNotifier?: LiveSearchDesktopNotifier | null;
  initialArrivalSignal?: boolean;
}

export interface LiveSearchPrimarySession {
  readonly console: LiveSearchConsoleHandles;
  dispose(): void;
}

export interface LiveSearchPrimarySessionFactories {
  createTitleGuard: typeof createLiveSearchConsoleTitleGuard;
  createHostGuard: typeof createLiveSearchConsoleHostGuard;
  createSoundNotifier: typeof createLiveSearchSoundNotifier;
  createDesktopNotifier: typeof createLiveSearchDesktopNotifier;
  createRuntime: (
    version: PoeVersion,
    options: ConstructorParameters<typeof LiveSearchPrimaryRuntime>[1],
  ) => LiveSearchPrimaryRuntime;
  createPrimaryController: typeof createLiveSearchPrimaryController;
  createResumeStore: typeof createLiveSearchResumeStore;
  createBookmarkClient: typeof createChromeBookmarkClient;
  createSourceController: typeof createLiveSearchSourceController;
  createResumeController: typeof createLiveSearchResumeController;
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
  factories?: Partial<LiveSearchPrimarySessionFactories>;
}

const DEFAULT_FACTORIES: LiveSearchPrimarySessionFactories = {
  createTitleGuard: createLiveSearchConsoleTitleGuard,
  createHostGuard: createLiveSearchConsoleHostGuard,
  createSoundNotifier: createLiveSearchSoundNotifier,
  createDesktopNotifier: createLiveSearchDesktopNotifier,
  createRuntime: (version, options) => new LiveSearchPrimaryRuntime(version, options),
  createPrimaryController: createLiveSearchPrimaryController,
  createResumeStore: createLiveSearchResumeStore,
  createBookmarkClient: createChromeBookmarkClient,
  createSourceController: createLiveSearchSourceController,
  createResumeController: createLiveSearchResumeController,
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
  const f: LiveSearchPrimarySessionFactories = { ...DEFAULT_FACTORIES, ...input.factories };

  doc.body?.setAttribute('data-poexd-page-role', 'live-search-primary');

  let disposed = false;
  let titleGuard: ReturnType<LiveSearchPrimarySessionFactories['createTitleGuard']> | null = null;
  let hostGuard: ReturnType<LiveSearchPrimarySessionFactories['createHostGuard']> | null = null;
  let soundNotifier: LiveSearchSoundNotifier | null = null;
  let desktopNotifier: LiveSearchDesktopNotifier | null = null;
  let primaryRuntime: ReturnType<LiveSearchPrimarySessionFactories['createRuntime']> | null = null;
  let sourceController: LiveSearchSourceController | null = null;
  let resumeController: LiveSearchResumeController | null = null;
  let exitGuard: ReturnType<LiveSearchPrimarySessionFactories['createExitGuard']> | null = null;
  let cleanupEnqueueListener: (() => void) | null = null;

  /** 依固定順序釋放已建立的子模組；建構中途失敗時也只釋放已建立者 */
  function disposeCreated(): void {
    cleanupEnqueueListener?.();
    titleGuard?.dispose();
    hostGuard?.dispose();
    exitGuard?.dispose();
    sourceController?.dispose();
    resumeController?.dispose();
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
          .sendMessage('liveSearch:openPrimary', { gameVersion: version })
          .catch(() => {});
      },
    });
    desktopNotifier = desktop;

    const resolveSourceName = (ownerKey: string): string | undefined => {
      const connections = sourceController?.read().sessionConnections;
      if (!connections) return undefined;
      return connections.find((item) => item.canonicalKey === ownerKey)?.name;
    };

    primaryRuntime = f.createRuntime(version, {
      getMaxDisplayedResults: () => preferences.read().liveSearchMaxDisplayedResults,
      onResultTokenAccepted: (event) => {
        notifier.notify();
        desktop.notify({
          ownerKey: event?.ownerKey,
          sourceName: event?.ownerKey ? resolveSourceName(event.ownerKey) : undefined,
        });
      },
      // 主控台自己打的 /fetch 不經過 MAIN world 攔截，結果要另外交給共用快取
      onResultFetched: ({ itemData, searchId, league }) =>
        resultCache.ingestResult(itemData, { sourceSearchId: searchId, league }),
    });

    const controller = f.createPrimaryController(primaryRuntime);
    primaryController = controller;
    const resumeStore = f.createResumeStore(version);
    const bookmarkClient = f.createBookmarkClient(version);
    const sources = f.createSourceController(bookmarkClient, controller, {
      resumeStore,
      preferences,
    });
    sourceController = sources;
    resumeController = f.createResumeController({
      version,
      preferences,
      sourceController: sources,
      resumeStore,
    });
    exitGuard = f.createExitGuard({
      shouldWarn: () => (controller.read().subscriptions.length ?? 0) > 0,
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
      resumeController,
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
