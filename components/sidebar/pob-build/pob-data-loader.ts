/**
 * PoB 購物清單的統一資料載入與快取模組：
 *
 * - 把對照資料（catalog / matcher / modTranslator / displayNames / visceraMods）、物品圖片對照
 *   （itemArt）與已解碼的 `PobBuild` 收在同一個可注入 adapter 的實例裡。
 * - 正式環境由 `Sidebar.vue`（閒置／滑鼠預熱）與 `usePobBuild` 共用 `defaultPobDataLoader`，
 *   使用者切進購物清單分頁時直接命中快取，不必再等載入與重複建索引。
 * - 只在 `chrome.storage.local` 確實存有 build 時才預熱對照資料、圖片與解碼 XML；空清單零開銷。
 * - 測試透過 `createPobDataLoader(fakeAdapter)` 建立獨立實例，直接經過真實的快取、去重與失敗清除路徑。
 */
import { ensureAffixLexiconLoaded, findModTiersByStatId } from '@/utils/affix-lexicon';
import { loadExtensionJson } from '@/utils/extension-json-cache';
import { getActiveDisplayLocale } from '@/utils/i18n';
import { initialPageLoadSignal } from '@/utils/initial-page-load-signal';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { parsePobBuildXml, type PobBuild } from '@/utils/pob-build';
import { decodePobBuildCode } from '@/utils/pob-build-code';
import { createPobBuildStore, MAX_POB_BUILDS, type StoredPobBuild } from '@/utils/pob-build-store';
import { loadItemArt as loadItemArtData, type ItemArtData } from '@/utils/pob-item-art';
import { loadModLineTranslator, type ModLineTranslator } from '@/utils/pob-mod-translator';
import {
  createVisceraModIndex,
  loadTradeNameCatalog,
  type TradeNameCatalog,
  type VisceraModIndex,
} from '@/utils/pob-shopping-list';
import { loadStatMatcher, type StatMatcher } from '@/utils/pob-stat-matcher';
import type { PoeVersion } from '@/utils/trade-context';

export interface PobReferenceData {
  catalog: TradeNameCatalog;
  matcher: StatMatcher | undefined;
  visceraMods: VisceraModIndex | undefined;
  modTranslator: ModLineTranslator | undefined;
  displayNames: TradeNameCatalog | undefined;
}

export interface PobDataLoaderAdapter {
  listStoredBuilds: (version: PoeVersion) => Promise<readonly Pick<StoredPobBuild, 'code'>[]>;
  loadCatalog: (version: PoeVersion, locale: string) => Promise<TradeNameCatalog>;
  loadMatcher: (version: PoeVersion) => Promise<StatMatcher>;
  loadVisceraMods: (version: PoeVersion) => Promise<VisceraModIndex | undefined>;
  loadModTranslator: (
    version: PoeVersion,
    locale: string,
  ) => Promise<ModLineTranslator | undefined>;
  loadItemArt: (version: PoeVersion) => Promise<ItemArtData | undefined>;
  getDisplayLocale: () => string;
  getPageLocale: () => string;
  decodeBuild: (code: string) => Promise<PobBuild>;
}

export interface PobDataLoader {
  /** 載入並快取指定版本與語系的 PoB 對照資料；失敗時清除快取讓下次可重試 */
  loadReferenceData(version: PoeVersion): Promise<PobReferenceData>;
  /** 載入並快取物品圖片對照（不阻塞 loadReferenceData）；失敗時清除快取 */
  loadItemArt(version: PoeVersion): Promise<ItemArtData | undefined>;
  /** 解碼並快取 PoB 代碼（保留最近上限份數，失敗時清除快取） */
  decodeBuild(code: string): Promise<PobBuild>;
  /**
   * 在背景閒置或滑鼠移至分頁圖示時預熱 PoB 資料層。
   * 若本機尚未存任何 build，直接結束而不載入 JSON 資產。
   */
  prewarm(version: PoeVersion): Promise<void>;
}

const MAX_DECODED_CACHE_ENTRIES = MAX_POB_BUILDS * 2;

const defaultDecodeBuild = async (code: string): Promise<PobBuild> =>
  parsePobBuildXml(await decodePobBuildCode(code));

/**
 * 臟器（PoE 1 3.30）詞綴索引：用詞綴字典（mods-tiers.json）裡臟器詞綴的部位標籤與代碼。
 * PoE 2 沒有臟器，回傳 undefined；字典載不到時判斷不出部位，購物清單會保留合成的臟器項目。
 */
async function loadDefaultVisceraModIndex(
  version: PoeVersion,
): Promise<VisceraModIndex | undefined> {
  if (version !== 'poe1') return undefined;
  await ensureAffixLexiconLoaded(version, { displayLocale: 'en' });
  return createVisceraModIndex((statId) => findModTiersByStatId(statId, version, 'en'));
}

function createDefaultAdapter(): PobDataLoaderAdapter {
  return {
    listStoredBuilds: (version) => createPobBuildStore(version).list(),
    loadCatalog: (version, locale) => loadTradeNameCatalog(loadExtensionJson, { version, locale }),
    loadMatcher: (version) => loadStatMatcher(loadExtensionJson, version),
    loadVisceraMods: (version) => loadDefaultVisceraModIndex(version),
    loadModTranslator: (version, locale) =>
      loadModLineTranslator(loadExtensionJson, { version, locale }),
    loadItemArt: (version) => loadItemArtData(loadExtensionJson, version),
    getDisplayLocale: () => getActiveDisplayLocale(),
    getPageLocale: () => resolvePageLocale(),
    decodeBuild: defaultDecodeBuild,
  };
}

function memoizeAsync<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
  maxEntries?: number,
): Promise<V> {
  const cached = cache.get(key);
  if (cached) return cached;

  const task = load();
  if (maxEntries !== undefined && cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, task);
  task.catch(() => {
    if (cache.get(key) === task) {
      cache.delete(key);
    }
  });
  return task;
}

export function createPobDataLoader(overrides: Partial<PobDataLoaderAdapter> = {}): PobDataLoader {
  const adapter: PobDataLoaderAdapter = { ...createDefaultAdapter(), ...overrides };
  const referenceDataCache = new Map<string, Promise<PobReferenceData>>();
  const itemArtCache = new Map<PoeVersion, Promise<ItemArtData | undefined>>();
  const decodedBuildCache = new Map<string, Promise<PobBuild>>();
  const inflightPrewarm = new Map<PoeVersion, Promise<void>>();

  const loadReferenceData = (version: PoeVersion): Promise<PobReferenceData> => {
    const pageLocale = adapter.getPageLocale();
    const displayLocale = adapter.getDisplayLocale();
    const cacheKey = `${version}|${pageLocale}|${displayLocale}`;
    return memoizeAsync(referenceDataCache, cacheKey, () =>
      Promise.all([
        adapter.loadCatalog(version, pageLocale),
        adapter.loadMatcher(version).catch(() => undefined),
        adapter.loadModTranslator(version, displayLocale).catch(() => undefined),
        // 顯示語言和頁面區服不同時（例如國際服頁面配中文介面），名稱另外用顯示語言呈現
        displayLocale === pageLocale
          ? undefined
          : adapter.loadCatalog(version, displayLocale).catch(() => undefined),
        adapter.loadVisceraMods(version).catch((error: unknown) => {
          console.warn('[PoeXD] viscera part data unavailable', error);
          return undefined;
        }),
      ]).then(([catalog, matcher, modTranslator, displayNames, visceraMods]): PobReferenceData => ({
        catalog,
        matcher,
        modTranslator,
        displayNames,
        visceraMods,
      })),
    );
  };

  const loadItemArt = (version: PoeVersion): Promise<ItemArtData | undefined> =>
    memoizeAsync(itemArtCache, version, () => adapter.loadItemArt(version));

  const decodeBuild = (code: string): Promise<PobBuild> =>
    memoizeAsync(
      decodedBuildCache,
      code,
      () => adapter.decodeBuild(code),
      MAX_DECODED_CACHE_ENTRIES,
    );

  const prewarm = (version: PoeVersion): Promise<void> => {
    const existing = inflightPrewarm.get(version);
    if (existing) return existing;

    const task = (async () => {
      let stored;
      try {
        stored = await adapter.listStoredBuilds(version);
      } catch {
        return;
      }
      if (stored.length === 0) return;
      await Promise.all([
        loadReferenceData(version).catch(() => undefined),
        loadItemArt(version).catch(() => undefined),
        ...stored.map((entry) => decodeBuild(entry.code).catch(() => undefined)),
      ]);
    })();

    inflightPrewarm.set(version, task);
    task.finally(() => {
      if (inflightPrewarm.get(version) === task) {
        inflightPrewarm.delete(version);
      }
    });
    return task;
  };

  return {
    loadReferenceData,
    loadItemArt,
    decodeBuild,
    prewarm,
  };
}

/** 正式環境共用的預設實例（Sidebar 預熱與 usePobBuild 命中同一份快取） */
export const defaultPobDataLoader = createPobDataLoader();

export interface PobIdlePrewarmScheduler {
  waitForInitialPageLoad: () => Promise<void>;
  /** 主執行緒閒置時呼叫 callback，回傳取消函式 */
  requestIdle: (callback: () => void) => () => void;
}

const IDLE_PREWARM_TIMEOUT_MS = 2000;

function createDefaultIdleScheduler(): PobIdlePrewarmScheduler {
  return {
    waitForInitialPageLoad: () => initialPageLoadSignal.wait(),
    requestIdle: (callback) => {
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(callback, { timeout: IDLE_PREWARM_TIMEOUT_MS });
        return () => window.cancelIdleCallback?.(id);
      }
      const id = setTimeout(callback, 1500);
      return () => clearTimeout(id);
    },
  };
}

/**
 * 排入背景閒置預熱：先等官方頁面完成首次載入，再等主執行緒閒置。
 *
 * 只等閒置不夠：官方在等 search / fetch 回應的網路空檔也算閒置，但預熱是一段數百毫秒的同步解析，
 * 官方腳本一回來就得排在後面，拖慢官方元件掛載與首批結果。回傳取消函式。
 */
export function schedulePobIdlePrewarm(
  run: () => void,
  scheduler: PobIdlePrewarmScheduler = createDefaultIdleScheduler(),
): () => void {
  let cancelled = false;
  let cancelIdle: (() => void) | undefined;
  void scheduler.waitForInitialPageLoad().then(() => {
    if (cancelled) return;
    cancelIdle = scheduler.requestIdle(() => {
      cancelIdle = undefined;
      if (!cancelled) run();
    });
  });
  return () => {
    cancelled = true;
    cancelIdle?.();
    cancelIdle = undefined;
  };
}
