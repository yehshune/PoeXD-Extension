import type { I18nKey } from './i18n/messages/zh-TW';

/**
 * 書籤匯入的使用者可讀錯誤。
 *
 * 只攜帶翻譯 key 與參數，不在此翻譯：匯入解析也會在 Background 執行，Background 不打包 UI 字典。
 * 匯入介面以 `describeBookmarkImportError()`（bookmark-transfer-messages）依目前語系顯示。
 * 解析器（`atob`、`TextDecoder`、`JSON.parse`）或內部驗證拋出的原始錯誤不會直接呈現給使用者，
 * 原始錯誤保留在 `cause` 供除錯；`message` 為翻譯 key，僅供除錯辨識。
 */
export class BookmarkTransferInputError extends Error {
  readonly code: I18nKey;
  readonly params?: Readonly<Record<string, string | number>>;

  constructor(
    code: I18nKey,
    options?: {
      cause?: unknown;
      params?: Readonly<Record<string, string | number>>;
    },
  ) {
    super(code, options);
    this.name = 'BookmarkTransferInputError';
    this.code = code;
    this.params = options?.params;
  }
}

interface InternalPattern {
  pattern: RegExp;
  code: I18nKey;
  getParams?: (match: RegExpMatchArray) => Record<string, string | number>;
}

/** 內部驗證錯誤 → 使用者訊息；未列出者一律使用通用訊息。 */
const INTERNAL_PATTERNS: ReadonlyArray<InternalPattern> = [
  {
    pattern: /too large/i,
    code: 'bookmarkTransfer.error.tooLarge',
  },
  {
    pattern: /at most (\d+) folders/i,
    code: 'bookmarkTransfer.error.maxFolders',
    getParams: (match) => ({ count: match[1] }),
  },
  {
    pattern: /at most (\d+) Bookmarks/i,
    code: 'bookmarkTransfer.error.maxBookmarks',
    getParams: (match) => ({ count: match[1] }),
  },
  {
    pattern: /invalid (?:Bookmark|folder) name/i,
    code: 'bookmarkTransfer.error.invalidName',
  },
  {
    pattern: /another game version|different game version/i,
    code: 'bookmarkTransfer.error.gameVersionMismatch',
  },
  {
    pattern: /valid Path of Exile Trade URL/i,
    code: 'bookmarkTransfer.error.invalidTradeUrl',
  },
];

/** 將任何解碼錯誤轉為可安全顯示給使用者的 `BookmarkTransferInputError`。 */
export function toBookmarkTransferInputError(error: unknown): BookmarkTransferInputError {
  if (error instanceof BookmarkTransferInputError) return error;
  const raw = error instanceof Error ? error.message : '';
  for (const { pattern, code, getParams } of INTERNAL_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      const params = getParams ? getParams(match) : undefined;
      return new BookmarkTransferInputError(code, { cause: error, params });
    }
  }
  return new BookmarkTransferInputError('bookmarkTransfer.error.generic', { cause: error });
}
