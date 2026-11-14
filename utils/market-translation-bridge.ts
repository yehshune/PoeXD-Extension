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
import { loadMarketTradeDictionary } from './market-translation-assets';
import {
  getMarketLiveDataCacheKey,
  getMarketLiveUiCacheKey,
  isMarketLiveCacheFresh,
  mergeMarketTradeDictionary,
  mergeMarketUiStrings,
  readValidMarketLiveDataCache,
  readValidMarketLiveUiCache,
  type MarketTranslationRefreshRequest,
} from './market-translation-live';
import { getPoeVersion, type PoeVersion } from './trade-context';
import {
  MARKET_MESSAGE_SOURCE,
  createDisabledMessage,
  createPayloadMessage,
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

export interface MarketLiveEnglishData {
  stats?: Record<string, string | string[]>;
  fields?: Record<string, string>;
}

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
  /** payload 送出後呼叫（例如啟動結果列翻譯）；停用時不呼叫 */
  onPayload?(
    payload: MarketTranslationPayload,
    version: PoeVersion,
    liveEn?: MarketLiveEnglishData,
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
  liveEn?: MarketLiveEnglishData;
}

async function buildMessage(deps: MarketTranslationBridgeDeps): Promise<BuiltBridgeResult> {
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

  // 介面字典失敗就整個停用；data 字典與本機快取各自容錯
  const [uiAsset, bundledData, cachedRaw] = await Promise.all([
    deps.loadJson(getMarketUiAssetPath(locale)),
    loadMarketTradeDictionary(deps.loadJson, { version, locale }),
    deps.readStorage([uiCacheKey, dataCacheKey]).catch(() => ({}) as Record<string, unknown>),
  ]);
  const bundledUi = parseMarketUiAsset(uiAsset, locale);
  const liveUi = readValidMarketLiveUiCache(cachedRaw[uiCacheKey], locale);
  const liveData = readValidMarketLiveDataCache(cachedRaw[dataCacheKey], version, locale);

  const now = (deps.now ?? Date.now)();
  if (
    !isMarketLiveCacheFresh(liveUi?.updatedAt, now) ||
    !isMarketLiveCacheFresh(liveData?.updatedAt, now)
  ) {
    try {
      void Promise.resolve(deps.requestLiveRefresh?.({ version, locale })).catch(() => undefined);
    } catch {
      // 背景刷新失敗不影響使用打包與既有快取
    }
  }

  const ui = mergeMarketUiStrings(bundledUi, liveUi?.strings);
  const data = mergeMarketTradeDictionary(bundledData, liveData);
  const liveEn =
    liveData?.enStats || liveData?.enFields
      ? { stats: liveData.enStats, fields: liveData.enFields }
      : undefined;

  // 偏好沒存過時預設中英並列（與 DEFAULT_PREFERENCES 一致）
  const bilingual = stored.marketTranslationBilingual !== false;
  return { message: createPayloadMessage({ locale, ui, bilingual, data }), liveEn };
}

const isRequest = (data: unknown): boolean =>
  isRecord(data) && data.source === MARKET_MESSAGE_SOURCE && data.type === 'request';

/** 啟動橋接；回傳的 Promise 在第一次送出結果後完成，值為停止函式。 */
export async function startMarketTranslationBridge(
  deps: MarketTranslationBridgeDeps,
): Promise<() => void> {
  let latest: MarketTranslationMessage | null = null;
  let liveEn: MarketLiveEnglishData | undefined;
  // 先訂閱：MAIN world 可能比這裡早啟動，它的 request 要在準備好之後得到回應
  const unsubscribe = deps.subscribe((data) => {
    if (latest && isRequest(data)) deps.post(latest);
  });

  try {
    const built = await buildMessage(deps);
    latest = built.message;
    liveEn = built.liveEn;
  } catch (error) {
    console.warn('[PoeXD] 市集漢化資料載入失敗，維持英文顯示:', error);
    latest = createDisabledMessage();
  }
  deps.post(latest);
  if (latest.type === 'payload') {
    const version = getPoeVersion(deps.pathname);
    if (liveEn) deps.onPayload?.(latest.payload, version, liveEn);
    else deps.onPayload?.(latest.payload, version);
  }
  return unsubscribe;
}
