/**
 * 市集漢化在 isolated world 與 MAIN world 之間的 window.postMessage 協定。
 *
 * 兩支 content script 都在 document_start 執行但先後不保證，所以 MAIN world 啟動時送 `request`，
 * isolated world 準備好就送 `payload` 或 `disabled`，收到 `request` 時再送一次最新結果。
 * 頁面本身也能送出同形訊息，但最多只影響它自己的顯示，不涉及擴充權限或使用者資料。
 *
 * payload 有數 MB：直接 window.postMessage 時，每個在 window 上聽 message 並讀取 `event.data`
 * 的 world（包含送出它的 isolated world 自己）都會各反序列化一次。所以 payload 改走
 * MessageChannel：window 上只送附帶 port 的小訊息 `payload-port`，payload 經 port 只交給 MAIN world。
 */

import type { MarketTradeDictionary } from './market-translation-data';

export const MARKET_MESSAGE_SOURCE = 'poexd-market-translation';

/** 兩支市集漢化 content script 的比對範圍：只有國際服英文市集（`*.pathofexile.com` 的在地化子網域不含在內） */
export const MARKET_TRANSLATION_MATCH_PATTERNS = [
  '*://www.pathofexile.com/trade*',
  '*://pathofexile.com/trade*',
];

/** data API 最多等待 isolated world 回覆的時間（毫秒）；逾時就放行英文 */
export const MARKET_TRANSLATION_TIMEOUT_MS = 5000;

export type MarketTranslationPayloadLocale = 'zh-TW' | 'zh-CN';

export interface MarketTranslationPayload {
  locale: MarketTranslationPayloadLocale;
  /** 官方介面字典（英文鍵 → 譯文），寫進全域 `__` */
  ui: Record<string, string>;
  /** 詞綴、通貨、物品顯示成「中文 (English)」 */
  bilingual: boolean;
  /** 四份 data API 的字典；缺少時 data API 維持英文（字典的 `ui` 由頁面端以上面的 ui 補上） */
  data?: Omit<MarketTradeDictionary, 'ui'>;
}

export type MarketTranslationMessage =
  | { source: typeof MARKET_MESSAGE_SOURCE; type: 'request' }
  | { source: typeof MARKET_MESSAGE_SOURCE; type: 'disabled' }
  | { source: typeof MARKET_MESSAGE_SOURCE; type: 'ui'; ui: Record<string, string> }
  | { source: typeof MARKET_MESSAGE_SOURCE; type: 'payload'; payload: MarketTranslationPayload };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

export function isMarketTranslationPayload(value: unknown): value is MarketTranslationPayload {
  return (
    isRecord(value) &&
    (value.locale === 'zh-TW' || value.locale === 'zh-CN') &&
    isStringMap(value.ui) &&
    typeof value.bilingual === 'boolean' &&
    (value.data === undefined || isRecord(value.data))
  );
}

export function isMarketTranslationMessage(value: unknown): value is MarketTranslationMessage {
  if (!isRecord(value) || value.source !== MARKET_MESSAGE_SOURCE) return false;
  if (value.type === 'request' || value.type === 'disabled') return true;
  if (value.type === 'ui') return isStringMap(value.ui);
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

export const createUiMessage = (ui: Record<string, string>): MarketTranslationMessage => ({
  source: MARKET_MESSAGE_SOURCE,
  type: 'ui',
  ui,
});

/** window 上的小訊息：附帶的 port 會送來一則 payload 訊息 */
export interface MarketTranslationPortMessage {
  source: typeof MARKET_MESSAGE_SOURCE;
  type: 'payload-port';
}

export function isMarketTranslationPortMessage(
  value: unknown,
): value is MarketTranslationPortMessage {
  return isRecord(value) && value.source === MARKET_MESSAGE_SOURCE && value.type === 'payload-port';
}

/**
 * 送出協定訊息；payload 經 MessageChannel 傳遞，其他訊息直接 window.postMessage。
 * `createChannel` 供測試替換。
 */
export function postMarketTranslationMessage(
  win: Pick<Window, 'postMessage'> & { location: { origin: string } },
  message: MarketTranslationMessage,
  createChannel: () => MessageChannel = () => new MessageChannel(),
): void {
  if (message.type !== 'payload') {
    win.postMessage(message, win.location.origin);
    return;
  }
  const channel = createChannel();
  const notice: MarketTranslationPortMessage = {
    source: MARKET_MESSAGE_SOURCE,
    type: 'payload-port',
  };
  win.postMessage(notice, win.location.origin, [channel.port2]);
  channel.port1.postMessage(message);
}

export const createPayloadMessage = (
  payload: MarketTranslationPayload,
): MarketTranslationMessage => ({
  source: MARKET_MESSAGE_SOURCE,
  type: 'payload',
  payload,
});
