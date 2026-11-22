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
  createLiveSearchSoundNotifier,
  type LiveSearchSoundNotifier,
} from './live-search-sound-notifier';
import {
  createLiveSearchBookmarkController,
  type LiveSearchBookmarkController,
} from './live-search-sources';

/**
 * 提供給 Sidebar / Console UI 的單一精簡 handle，取代多層個別 prop 貫穿
 */
export interface LiveSearchConsoleHandles {
  primaryController?: LiveSearchPrimaryController | null;
  sourceController?: LiveSearchBookmarkController | null;
  resumeController?: LiveSearchResumeController | null;
  soundNotifier?: LiveSearchSoundNotifier | null;
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
  createRuntime: (
    version: PoeVersion,
    options: ConstructorParameters<typeof LiveSearchPrimaryRuntime>[1],
  ) => Pick<LiveSearchPrimaryRuntime, 'dispose'> & LiveSearchPrimaryRuntime;
  createPrimaryController: typeof createLiveSearchPrimaryController;
  createResumeStore: typeof createLiveSearchResumeStore;
  createBookmarkClient: typeof createChromeBookmarkClient;
  createSourceController: typeof createLiveSearchBookmarkController;
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
  createRuntime: (version, options) => new LiveSearchPrimaryRuntime(version, options),
  createPrimaryController: createLiveSearchPrimaryController,
  createResumeStore: createLiveSearchResumeStore,
  createBookmarkClient: createChromeBookmarkClient,
  createSourceController: createLiveSearchBookmarkController,
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

  const titleGuard = f.createTitleGuard(doc, version);
  titleGuard.start();

  const hostGuard = f.createHostGuard();
  hostGuard.start();

  const soundNotifier = f.createSoundNotifier({
    version,
    isEnabled: () => preferences.read().liveSearchSoundEnabled,
  });

  const primaryRuntime = f.createRuntime(version, {
    getMaxDisplayedResults: () => preferences.read().liveSearchMaxDisplayedResults,
    onResultTokenAccepted: () => soundNotifier.notify(),
    // 主控台自己打的 /fetch 不經過 MAIN world 攔截，結果要另外交給共用快取
    onResultFetched: ({ itemData, searchId, league }) =>
      resultCache.ingestResult(itemData, { sourceSearchId: searchId, league }),
  });

  const primaryController = f.createPrimaryController(primaryRuntime);
  const resumeStore = f.createResumeStore(version);
  const bookmarkClient = f.createBookmarkClient(version);
  const sourceController = f.createSourceController(bookmarkClient, primaryController, {
    resumeStore,
    preferences,
  });
  const resumeController = f.createResumeController({
    version,
    preferences,
    sourceController,
    resumeStore,
  });
  const exitGuard = f.createExitGuard({
    shouldWarn: () => (primaryController.read().subscriptions.length ?? 0) > 0,
  });

  let disposed = false;
  const cleanupEnqueueListener = f.registerEnqueueBridge({
    version,
    messenger: f.messenger,
    enqueueIncoming: (items) => {
      if (disposed || !sourceController.enqueueIncomingConnections) {
        return Promise.resolve({
          success: false,
          addedCount: 0,
          skippedCount: 0,
          error: t('liveSearch.console.notReady'),
          rejectReason: 'failed',
        });
      }
      return sourceController.enqueueIncomingConnections(items);
    },
    isDisposed: () =>
      disposed || Boolean(isHostDisposed?.()) || !sourceController.enqueueIncomingConnections,
  });

  return {
    console: {
      primaryController,
      sourceController,
      resumeController,
      soundNotifier,
      initialArrivalSignal,
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cleanupEnqueueListener();
      titleGuard.dispose();
      hostGuard.dispose();
      exitGuard.dispose();
      sourceController.dispose();
      resumeController.dispose();
      primaryRuntime.dispose();
      soundNotifier.dispose();
    },
  };
}
