/**
 * 市集漢化在 isolated world 與 MAIN world 之間的 window.postMessage 協定。
 *
 * 兩支 content script 都在 document_start 執行但先後不保證，所以 MAIN world 啟動時送 `request`，
 * isolated world 準備好就送 `payload` 或 `disabled`，收到 `request` 時再送一次最新結果。
 * 頁面本身也能送出同形訊息，但最多只影響它自己的顯示，不涉及擴充權限或使用者資料。
 */

export const MARKET_MESSAGE_SOURCE = 'poexd-market-translation';

/** 兩支市集漢化 content script 的比對範圍：只有國際服英文市集（`*.pathofexile.com` 的在地化子網域不含在內） */
export const MARKET_TRANSLATION_MATCH_PATTERNS = [
  '*://www.pathofexile.com/trade*',
  '*://pathofexile.com/trade*',
];

/** data API 最多等待 isolated world 回覆的時間（毫秒）；逾時就放行英文 */
export const MARKET_TRANSLATION_TIMEOUT_MS = 1500;

export type MarketTranslationPayloadLocale = 'zh-TW' | 'zh-CN';

export interface MarketTranslationPayload {
  locale: MarketTranslationPayloadLocale;
  /** 官方介面字典（英文鍵 → 譯文），寫進全域 `__` */
  ui: Record<string, string>;
}

export type MarketTranslationMessage =
  | { source: typeof MARKET_MESSAGE_SOURCE; type: 'request' }
  | { source: typeof MARKET_MESSAGE_SOURCE; type: 'disabled' }
  | { source: typeof MARKET_MESSAGE_SOURCE; type: 'payload'; payload: MarketTranslationPayload };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

export function isMarketTranslationPayload(value: unknown): value is MarketTranslationPayload {
  return (
    isRecord(value) &&
    (value.locale === 'zh-TW' || value.locale === 'zh-CN') &&
    isStringMap(value.ui)
  );
}

export function isMarketTranslationMessage(value: unknown): value is MarketTranslationMessage {
  if (!isRecord(value) || value.source !== MARKET_MESSAGE_SOURCE) return false;
  if (value.type === 'request' || value.type === 'disabled') return true;
  return value.type === 'payload' && isMarketTranslationPayload(value.payload);
}

export const createRequestMessage = (): MarketTranslationMessage => ({
  source: MARKET_MESSAGE_SOURCE,
  type: 'request',
});

export const createDisabledMessage = (): MarketTranslationMessage => ({
  source: MARKET_MESSAGE_SOURCE,
  type: 'disabled',
});

export const createPayloadMessage = (
  payload: MarketTranslationPayload,
): MarketTranslationMessage => ({
  source: MARKET_MESSAGE_SOURCE,
  type: 'payload',
  payload,
});
