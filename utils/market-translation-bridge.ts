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
import {
  MARKET_MESSAGE_SOURCE,
  createDisabledMessage,
  createPayloadMessage,
  type MarketTranslationMessage,
} from './market-translation-protocol';

const MARKET_UI_SCHEMA_VERSION = 1;

export const MARKET_TRANSLATION_STORAGE_KEYS = [
  'marketTranslation',
  'displayLocale',
  ...LEGACY_DISPLAY_LOCALE_KEYS,
] as const;

export interface MarketTranslationBridgeDeps {
  hostname: string;
  browserLocale: string;
  readStorage(keys: readonly string[]): Promise<Record<string, unknown>>;
  /** 讀取擴充內建檔案（相對於擴充根目錄的路徑） */
  loadJson(path: string): Promise<unknown>;
  post(message: MarketTranslationMessage): void;
  /** 訂閱來自本視窗的 postMessage 資料；回傳取消訂閱 */
  subscribe(handler: (data: unknown) => void): () => void;
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

async function buildMessage(deps: MarketTranslationBridgeDeps): Promise<MarketTranslationMessage> {
  const stored = await deps.readStorage(MARKET_TRANSLATION_STORAGE_KEYS);
  const locale = resolveMarketTranslationLocale({
    enabled: stored.marketTranslation === true,
    displayLocale: resolveStoredDisplayLocale(stored),
    hostname: deps.hostname,
    browserLocale: deps.browserLocale,
  });
  if (!locale) return createDisabledMessage();
  const ui = parseMarketUiAsset(await deps.loadJson(getMarketUiAssetPath(locale)), locale);
  return createPayloadMessage({ locale, ui });
}

const isRequest = (data: unknown): boolean =>
  isRecord(data) && data.source === MARKET_MESSAGE_SOURCE && data.type === 'request';

/** 啟動橋接；回傳的 Promise 在第一次送出結果後完成，值為停止函式。 */
export async function startMarketTranslationBridge(
  deps: MarketTranslationBridgeDeps,
): Promise<() => void> {
  let latest: MarketTranslationMessage | null = null;
  // 先訂閱：MAIN world 可能比這裡早啟動，它的 request 要在準備好之後得到回應
  const unsubscribe = deps.subscribe((data) => {
    if (latest && isRequest(data)) deps.post(latest);
  });

  try {
    latest = await buildMessage(deps);
  } catch (error) {
    console.warn('[PoeXD] 市集漢化資料載入失敗，維持英文顯示:', error);
    latest = createDisabledMessage();
  }
  deps.post(latest);
  return unsubscribe;
}
