/**
 * PoB 購物清單的資料層閒置預熱與背景圖示擷取：
 *
 * - 只在 `chrome.storage.local` 確實存有 build 時才載入對照資料與解碼 XML；空清單零開銷。
 * - 與 `usePobBuild` 共用同一份已編譯的索引（catalog / matcher / modTranslator / visceraMods）與
 *   已解碼的 `PobBuild`，使用者切進購物清單分頁時直接命中快取，不必再等載入與重複建索引。
 * - 新分頁開啟搜尋時即使側邊欄收合或停在其他分頁，也能輕量領取待擷取的結果圖片並寫回本機，
 *   不會錯過 2 分鐘有效期限。
 */
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { loadExtensionJson } from '@/utils/extension-json-cache';
import { getActiveDisplayLocale } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { parsePobBuildXml, type PobBuild } from '@/utils/pob-build';
import { decodePobBuildCode } from '@/utils/pob-build-code';
import { createPobBuildStore, MAX_POB_BUILDS, type PobBuildStore } from '@/utils/pob-build-store';
import { createPendingIconStore, type PendingIconStore } from '@/utils/pob-icon-pending';
import { loadModLineTranslator, type ModLineTranslator } from '@/utils/pob-mod-translator';
import {
  loadTradeNameCatalog,
  type TradeNameCatalog,
  type VisceraModIndex,
} from '@/utils/pob-shopping-list';
import { loadStatMatcher, type StatMatcher } from '@/utils/pob-stat-matcher';
import { loadVisceraModIndex } from '@/utils/pob-viscera-parts';
import type { PoeVersion } from '@/utils/trade-context';

export interface PobReferenceData {
  catalog: TradeNameCatalog;
  matcher: StatMatcher | undefined;
  visceraMods: VisceraModIndex | undefined;
  modTranslator: ModLineTranslator | undefined;
  displayNames: TradeNameCatalog | undefined;
}

export interface PobPrewarmDeps {
  store: PobBuildStore;
  pendingIcon: PendingIconStore;
  loadCatalog: (version: PoeVersion, locale: string) => Promise<TradeNameCatalog>;
  loadMatcher: (version: PoeVersion) => Promise<StatMatcher>;
  loadVisceraMods?: (version: PoeVersion) => Promise<VisceraModIndex | undefined>;
  loadModTranslator: (
    version: PoeVersion,
    locale: string,
  ) => Promise<ModLineTranslator | undefined>;
  getDisplayLocale: () => string;
  getPageLocale: () => string;
  decodeBuild: (code: string) => Promise<PobBuild>;
  onResultImages: (listener: (images: string[]) => void) => () => void;
}

const MAX_DECODED_CACHE_ENTRIES = MAX_POB_BUILDS * 2;

const referenceDataCache = new Map<string, Promise<PobReferenceData>>();
const decodedBuildCache = new Map<string, Promise<PobBuild>>();
const inflightPrewarm = new Map<string, Promise<void>>();

const defaultDecodeBuild = async (code: string): Promise<PobBuild> =>
  parsePobBuildXml(await decodePobBuildCode(code));

function createDefaultPrewarmDeps(version: PoeVersion): PobPrewarmDeps {
  return {
    store: createPobBuildStore(version),
    pendingIcon: createPendingIconStore(version),
    loadCatalog: (catalogVersion, locale) =>
      loadTradeNameCatalog(loadExtensionJson, { version: catalogVersion, locale }),
    loadMatcher: (matcherVersion) => loadStatMatcher(loadExtensionJson, matcherVersion),
    loadVisceraMods: (modsVersion) => loadVisceraModIndex(modsVersion),
    loadModTranslator: (translatorVersion, locale) =>
      loadModLineTranslator(loadExtensionJson, { version: translatorVersion, locale }),
    getDisplayLocale: () => getActiveDisplayLocale(),
    getPageLocale: () => resolvePageLocale(),
    decodeBuild: defaultDecodeBuild,
    onResultImages: (listener) => {
      const stop = listenPoeEvent('poexd-result-images', (detail) =>
        listener(Array.isArray(detail.images) ? detail.images : []),
      );
      dispatchPoeEvent('poexd-request-result-images');
      return stop;
    },
  };
}

/** 載入並快取指定版本與語系的 PoB 對照資料；失敗時清除快取讓下次可重試 */
export function loadPobReferenceData(
  version: PoeVersion,
  deps: Pick<
    PobPrewarmDeps,
    | 'loadCatalog'
    | 'loadMatcher'
    | 'loadVisceraMods'
    | 'loadModTranslator'
    | 'getDisplayLocale'
    | 'getPageLocale'
  >,
): Promise<PobReferenceData> {
  const pageLocale = deps.getPageLocale();
  const displayLocale = deps.getDisplayLocale();
  const cacheKey = `${version}|${pageLocale}|${displayLocale}`;
  const cached = referenceDataCache.get(cacheKey);
  if (cached) return cached;

  const task = Promise.all([
    deps.loadCatalog(version, pageLocale),
    deps.loadMatcher(version).catch(() => undefined),
    deps.loadModTranslator(version, displayLocale).catch(() => undefined),
    displayLocale === pageLocale
      ? undefined
      : deps.loadCatalog(version, displayLocale).catch(() => undefined),
    deps.loadVisceraMods?.(version).catch((error: unknown) => {
      console.warn('[PoeXD] viscera part data unavailable', error);
      return undefined;
    }),
  ]).then(([catalog, matcher, modTranslator, displayNames, visceraMods]): PobReferenceData => ({
    catalog,
    matcher,
    modTranslator,
    displayNames,
    visceraMods,
  }));

  referenceDataCache.set(cacheKey, task);
  task.catch(() => {
    if (referenceDataCache.get(cacheKey) === task) {
      referenceDataCache.delete(cacheKey);
    }
  });
  return task;
}

/** 解碼並快取 PoB 代碼（只留最近數十份，避免長駐分頁無限累積） */
export function decodePobBuildCached(
  code: string,
  decode: (code: string) => Promise<PobBuild> = defaultDecodeBuild,
): Promise<PobBuild> {
  const cached = decodedBuildCache.get(code);
  if (cached) return cached;

  const task = decode(code);
  if (decodedBuildCache.size >= MAX_DECODED_CACHE_ENTRIES) {
    const oldestKey = decodedBuildCache.keys().next().value;
    if (oldestKey !== undefined) decodedBuildCache.delete(oldestKey);
  }
  decodedBuildCache.set(code, task);
  task.catch(() => {
    if (decodedBuildCache.get(code) === task) {
      decodedBuildCache.delete(code);
    }
  });
  return task;
}

/**
 * 在背景閒置或滑鼠移至分頁圖示時預熱 PoB 資料層。
 * 若本機尚未存任何 build，直接結束而不載入 JSON 資產。
 */
export function prewarmPobData(
  version: PoeVersion,
  overrides: Partial<PobPrewarmDeps> = {},
): Promise<void> {
  const hasOverrides = Object.keys(overrides).length > 0;
  if (!hasOverrides) {
    const existing = inflightPrewarm.get(version);
    if (existing) return existing;
  }

  const deps = { ...createDefaultPrewarmDeps(version), ...overrides };
  const task = (async () => {
    let stored;
    try {
      stored = await deps.store.list();
    } catch {
      return;
    }
    if (stored.length === 0) return;
    await Promise.all([
      loadPobReferenceData(version, deps).catch(() => undefined),
      ...stored.map((entry) =>
        decodePobBuildCached(entry.code, deps.decodeBuild).catch(() => undefined),
      ),
    ]);
  })();

  if (!hasOverrides) {
    inflightPrewarm.set(version, task);
    task.finally(() => {
      if (inflightPrewarm.get(version) === task) {
        inflightPrewarm.delete(version);
      }
    });
  }
  return task;
}

/**
 * 輕量檢查此分頁是否有待擷取的 PoB 項目圖片：
 * 沒有待擷取項目時不掛任何事件監聽；有待擷取項目時直接寫回本機，
 * 讓新分頁即使側邊欄收合或停在其他分頁也能補齊物品圖片。
 */
export function capturePendingPobIconInBackground(
  version: PoeVersion,
  overrides: Partial<Pick<PobPrewarmDeps, 'store' | 'pendingIcon' | 'onResultImages'>> = {},
): () => void {
  const deps = { ...createDefaultPrewarmDeps(version), ...overrides };
  let disposed = false;
  let stopListening: (() => void) | undefined;

  void deps.pendingIcon
    .take()
    .then((pending) => {
      if (disposed || !pending) return;
      stopListening = deps.onResultImages((images) => {
        if (disposed) return;
        const icon = images.find((image) => isValidPoeCdnImageUrl(image));
        if (!icon) return;
        stopListening?.();
        stopListening = undefined;
        void deps.store
          .mutate(pending.buildId, (current) => ({
            icons: { ...current.icons, [pending.entryKey]: icon },
          }))
          .catch(() => undefined);
      });
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    stopListening?.();
    stopListening = undefined;
  };
}

/** 測試用：清除模組層級的預熱快取 */
export function resetPobPrewarmCacheForTests(): void {
  referenceDataCache.clear();
  decodedBuildCache.clear();
  inflightPrewarm.clear();
}
