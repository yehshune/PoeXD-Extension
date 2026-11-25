/**
 * 市集漢化的 isolated world 橋接（ADR-0012）：讀偏好、載入擴充內建的翻譯分片，
 * 再以 window.postMessage 交給 MAIN world（見 market-translation-protocol.ts）。
 *
 * 任何失敗都送出 `disabled`，讓頁面立即放行英文，不必等到逾時。
 */
import { LEGACY_DISPLAY_LOCALE_KEYS, resolveStoredDisplayLocale } from './preferences-contract';
import {
  getMarketUiAssetPath,
  resolveMarketTranslationLocale,
  type MarketTranslationLocale,
} from './market-translation';
import { loadMarketTradeDictionary, type MarketLiveEnglishData } from './market-translation-assets';
import type { MarketTranslationRefreshRequest } from './market-translation-live';
import {
  getMarketLiveDataCacheKey,
  getMarketLiveEnglishCacheKey,
  getMarketLiveUiCacheKey,
  isLegacyMarketLiveDataCache,
  isMarketLiveCacheFresh,
  mergeMarketTradeDictionary,
  mergeMarketUiStrings,
  readValidMarketLiveDataCache,
  readValidMarketLiveEnglishCache,
  readValidMarketLiveUiCache,
  resolveMarketLiveEnglishData,
} from './market-live-cache';
import { getPoeVersion, type PoeVersion } from './trade-context';
import {
  MARKET_MESSAGE_SOURCE,
  createDisabledMessage,
  createPayloadMessage,
  createUiMessage,
  type MarketTranslationMessage,
  type MarketTranslationPayload,
} from './market-translation-protocol';

const MARKET_UI_SCHEMA_VERSION = 1;

export const MARKET_TRANSLATION_STORAGE_KEYS = [
  'marketTranslation',
  'marketTranslationBilingual',
  'displayLocale',
  ...LEGACY_DISPLAY_LOCALE_KEYS,
] as const;

export interface MarketTranslationBridgeDeps {
  hostname: string;
  /** 決定載入 PoE1 或 PoE2 的 data 字典 */
  pathname: string;
  browserLocale: string;
  readStorage(keys: readonly string[]): Promise<Record<string, unknown>>;
  /** 讀取擴充內建檔案（相對於擴充根目錄的路徑） */
  loadJson(path: string): Promise<unknown>;
  post(message: MarketTranslationMessage): void;
  /** 訂閱來自本視窗的 postMessage 資料；回傳取消訂閱 */
  subscribe(handler: (data: unknown) => void): () => void;
  /** 背景非同步向官方 API 更新最新譯文（不阻塞開頁閘門） */
  requestLiveRefresh?(request: MarketTranslationRefreshRequest): Promise<unknown> | void;
  now?: () => number;
  /**
   * payload 送出後呼叫（例如啟動結果列翻譯）；停用時不呼叫。
   * 國際服英文資料只有結果列翻譯用得到，由 loadLiveEn 在需要時才讀取（沒有時為 undefined）。
   */
  onPayload?(
    payload: MarketTranslationPayload,
    version: PoeVersion,
    loadLiveEn: () => Promise<MarketLiveEnglishData | undefined>,
  ): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 驗證 `trade-ui.json` 並取出字串表；格式或語系不符時拋出錯誤。 */
export function parseMarketUiAsset(
  data: unknown,
  locale: MarketTranslationLocale,
): Record<string, string> {
  if (!isRecord(data)) throw new Error('trade-ui.json 不是物件');
  if (data.schemaVersion !== MARKET_UI_SCHEMA_VERSION) {
    throw new Error(`trade-ui.json schemaVersion ${String(data.schemaVersion)} 不支援`);
  }
  if (data.locale !== locale) {
    throw new Error(`trade-ui.json 語系 ${String(data.locale)} ≠ ${locale}`);
  }
  const strings = data.strings;
  if (!isRecord(strings) || !Object.values(strings).every((value) => typeof value === 'string')) {
    throw new Error('trade-ui.json 的 strings 格式錯誤');
  }
  return strings as Record<string, string>;
}

interface BuiltBridgeResult {
  message: MarketTranslationMessage;
  loadLiveEn?: () => Promise<MarketLiveEnglishData | undefined>;
}

async function buildMessage(
  deps: MarketTranslationBridgeDeps,
  onUiReady: (ui: Record<string, string>) => void,
): Promise<BuiltBridgeResult> {
  const stored = await deps.readStorage(MARKET_TRANSLATION_STORAGE_KEYS);
  const locale = resolveMarketTranslationLocale({
    enabled: stored.marketTranslation === true,
    displayLocale: resolveStoredDisplayLocale(stored),
    hostname: deps.hostname,
    browserLocale: deps.browserLocale,
  });
  if (!locale) return { message: createDisabledMessage() };
  const version = getPoeVersion(deps.pathname);
  const uiCacheKey = getMarketLiveUiCacheKey(locale);
  const dataCacheKey = getMarketLiveDataCacheKey(version, locale);

  // 介面字典（~56 KB）與大型 data 分片／快取並行載入，前者備妥就立刻送給 MAIN world 寫入 window.__，
  // 避免官網已快取的 JS 模組在 data 載完前就先求值模組頂層的 translate() 而鎖死英文
  const uiPromise = Promise.all([
    deps.loadJson(getMarketUiAssetPath(locale)),
    deps.readStorage([uiCacheKey]).catch(() => ({}) as Record<string, unknown>),
  ]).then(([uiAsset, uiCachedRaw]) => {
    const bundledUi = parseMarketUiAsset(uiAsset, locale);
    const liveUi = readValidMarketLiveUiCache(uiCachedRaw[uiCacheKey], locale);
    const ui = mergeMarketUiStrings(bundledUi, liveUi?.strings);
    onUiReady(ui);
    return { ui, liveUi };
  });

  const dataPromise = Promise.all([
    loadMarketTradeDictionary(deps.loadJson, { version, locale }),
    deps.readStorage([dataCacheKey]).catch(() => ({}) as Record<string, unknown>),
  ]).then(([bundledData, dataCachedRaw]) => {
    const liveData = readValidMarketLiveDataCache(dataCachedRaw[dataCacheKey], version, locale);
    return { bundledData, liveData };
  });

  // 介面字典失敗就整個停用；data 字典與本機快取各自容錯
  const [{ ui, liveUi }, { bundledData, liveData }] = await Promise.all([uiPromise, dataPromise]);

  const now = (deps.now ?? Date.now)();
  if (
    !isMarketLiveCacheFresh(liveUi?.updatedAt, now) ||
    !isMarketLiveCacheFresh(liveData?.updatedAt, now) ||
    // 舊格式（英文資料合併存放）：背景會在不重抓的情況下拆開存放
    isLegacyMarketLiveDataCache(liveData)
  ) {
    try {
      void Promise.resolve(deps.requestLiveRefresh?.({ version, locale })).catch(() => undefined);
    } catch {
      // 背景刷新失敗不影響使用打包與既有快取
    }
  }

  const data = mergeMarketTradeDictionary(bundledData, liveData);
  const englishKey = getMarketLiveEnglishCacheKey(version, locale);
  const loadLiveEn = async () => {
    try {
      const stored = await deps.readStorage([englishKey]);
      const english = readValidMarketLiveEnglishCache(stored[englishKey], version, locale);
      return resolveMarketLiveEnglishData(english, liveData);
    } catch (error) {
      console.warn('[PoeXD] 讀取市集漢化英文快取失敗，結果列改用打包資料:', error);
      return resolveMarketLiveEnglishData(null, liveData);
    }
  };

  // 偏好沒存過時預設中英並列（與 DEFAULT_PREFERENCES 一致）
  const bilingual = stored.marketTranslationBilingual !== false;
  return { message: createPayloadMessage({ locale, ui, bilingual, data }), loadLiveEn };
}

const isRequest = (data: unknown): boolean =>
  isRecord(data) && data.source === MARKET_MESSAGE_SOURCE && data.type === 'request';

/** 啟動橋接；回傳的 Promise 在第一次送出結果後完成，值為停止函式。 */
export async function startMarketTranslationBridge(
  deps: MarketTranslationBridgeDeps,
): Promise<() => void> {
  let latestUi: MarketTranslationMessage | null = null;
  let latest: MarketTranslationMessage | null = null;
  let loadLiveEn: BuiltBridgeResult['loadLiveEn'];
  // 先訂閱：MAIN world 可能比這裡早啟動，它的 request 要在準備好之後得到回應
  const unsubscribe = deps.subscribe((data) => {
    if (!isRequest(data)) return;
    if (latest) {
      deps.post(latest);
    } else if (latestUi) {
      deps.post(latestUi);
    }
  });

  try {
    const built = await buildMessage(deps, (ui) => {
      latestUi = createUiMessage(ui);
      deps.post(latestUi);
    });
    latest = built.message;
    loadLiveEn = built.loadLiveEn;
  } catch (error) {
    console.warn('[PoeXD] 市集漢化資料載入失敗，維持英文顯示:', error);
    latest = createDisabledMessage();
  }
  deps.post(latest);
  if (latest.type === 'payload') {
    const version = getPoeVersion(deps.pathname);
    deps.onPayload?.(latest.payload, version, loadLiveEn ?? (async () => undefined));
  }
  return unsubscribe;
}
