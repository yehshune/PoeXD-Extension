import { t, type I18nKey } from './i18n';
import { BookmarkTransferInputError } from './bookmark-transfer-errors';

/** 匯入介面顯示用：只信任 `BookmarkTransferInputError`，其餘一律回傳通用訊息。 */
export function describeBookmarkImportError(error: unknown): string {
  if (error instanceof BookmarkTransferInputError) {
    return t(error.code, error.params);
  }
  return t('bookmarkTransfer.error.generic');
}

const IMPORT_FAILURE_CODE_MAP: Readonly<Record<string, I18nKey>> = {
  'storage-failure': 'bookmarkTransfer.failure.storage',
  'invalid-identity': 'bookmarkTransfer.failure.invalidIdentity',
  'not-initialized': 'bookmarkTransfer.failure.notInitialized',
  unavailable: 'bookmarkTransfer.failure.unavailable',
};

/** 確認匯入後寫入失敗時，依錯誤代碼回傳使用者訊息（不顯示內部錯誤內容）。 */
export function describeBookmarkImportFailure(error: { code?: string } | undefined): string {
  if (error?.code && IMPORT_FAILURE_CODE_MAP[error.code]) {
    return t(IMPORT_FAILURE_CODE_MAP[error.code]);
  }
  return t('bookmarkTransfer.failure.default');
}
