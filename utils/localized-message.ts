import type { I18nKey } from './i18n/messages/zh-TW';

/**
 * 跨執行環境（Background → UI）傳遞的可翻譯訊息。
 *
 * Background 不持有 UI 語系狀態，也不應打包 UI 字典，因此只回傳翻譯 key 與參數，
 * 由 UI 端在渲染當下以 `formatMessage()` 依目前語系翻譯。
 * 原始例外訊息（例如 `Error.message`）仍以字串傳遞，UI 端原樣顯示。
 */
export interface LocalizedMessage {
  readonly key: I18nKey;
  readonly params?: Readonly<Record<string, string | number>>;
}

export type MessageValue = string | LocalizedMessage;

export function localized(
  key: I18nKey,
  params?: Readonly<Record<string, string | number>>,
): LocalizedMessage {
  return params ? { key, params } : { key };
}

export function isLocalizedMessage(value: unknown): value is LocalizedMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { key?: unknown }).key === 'string'
  );
}
