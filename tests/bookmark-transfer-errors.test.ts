import { describe, expect, it } from 'vitest';
import { decodeBookmarkTransfer } from '@/utils/bookmark-transfer';
import { encodeTftBase64 } from '@/utils/bookmark-transfer-tft';
import { BookmarkTransferInputError } from '@/utils/bookmark-transfer-errors';
import {
  describeBookmarkImportError,
  describeBookmarkImportFailure,
} from '@/utils/bookmark-transfer-messages';

const GENERIC_IMPORT_ERROR_MESSAGE =
  '分享碼不完整或已損毀，請確認已完整複製（支援 TFT Trade Extension 與 Better Trading 格式）';

/** 解析器（atob / TextDecoder / JSON.parse）與內部英文驗證訊息的特徵，不得出現在使用者訊息中。 */
const LEAKED_DETAIL =
  /atob|JSON|Expected|Unexpected|position|token|encoding|Window|Bookmark Transfer|malformed/i;

async function rejection(input: string): Promise<BookmarkTransferInputError> {
  const error = await decodeBookmarkTransfer(input, { gameVersion: 'poe1' }).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BookmarkTransferInputError);
  return error as BookmarkTransferInputError;
}

describe('Bookmark import error messages', () => {
  it.each([
    ['broken JSON backup', '{"folders": [ {"id": "a",, }'],
    ['truncated Base64 (atob failure)', 'eyJmb2xkZXJzIjpbXX0'.slice(0, 5)],
    ['Base64 that is not UTF-8', btoa('\xff\xfe\xfd')],
    ['Base64 of broken JSON', encodeTftBase64('{"folders":')],
    ['Base64 of unrelated JSON', encodeTftBase64('{"hello":1}')],
    ['random text', 'hello world!'],
    ['legacy PoeXD code', 'poexd-bm2:abc'],
    ['broken Better Trading code', '3:abc'],
  ])('never leaks parser internals for %s', async (_label, input) => {
    const error = await rejection(input);
    expect(describeBookmarkImportError(error)).not.toMatch(LEAKED_DETAIL);
  });

  it('keeps the original error as cause for debugging', async () => {
    const error = await rejection('{"folders": [,');
    expect(describeBookmarkImportError(error)).toBe(GENERIC_IMPORT_ERROR_MESSAGE);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('keeps specific readable messages such as a game version mismatch', async () => {
    const poe2Only = encodeTftBase64(
      JSON.stringify({
        folders: [
          {
            id: 'f',
            name: 'A',
            parentId: null,
            bookmarks: [
              {
                id: 'b',
                name: 'x',
                league: 'Auto',
                poeVersion: 'Poe2',
                endpoint: 'abc',
                type: 'search',
              },
            ],
          },
        ],
      }),
    );
    expect(describeBookmarkImportError(await rejection(poe2Only))).toContain('另一個遊戲版本');
  });

  it('falls back to a generic message for anything that is not a safe import error', () => {
    expect(describeBookmarkImportError(new SyntaxError("Expected ',' or '}'"))).toBe(
      GENERIC_IMPORT_ERROR_MESSAGE,
    );
    expect(describeBookmarkImportError('boom')).toBe(GENERIC_IMPORT_ERROR_MESSAGE);
  });

  it('describes import write failures by code without exposing internal messages', () => {
    expect(describeBookmarkImportFailure({ code: 'storage-failure' })).toBe(
      '書籤無法儲存，請稍後再試',
    );
    expect(describeBookmarkImportFailure({ code: 'invalid-identity' })).toContain('目標資料夾');
    expect(describeBookmarkImportFailure({ code: 'whatever' })).toBe('匯入失敗，請稍後再試');
    expect(describeBookmarkImportFailure(undefined)).toBe('匯入失敗，請稍後再試');
  });
});
