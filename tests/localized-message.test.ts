import { beforeEach, describe, expect, it } from 'vitest';
import { formatMessage, resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';
import { isLocalizedMessage, localized } from '@/utils/localized-message';
import { BookmarkTransferInputError } from '@/utils/bookmark-transfer-errors';
import { describeBookmarkImportError } from '@/utils/bookmark-transfer-messages';

describe('LocalizedMessage (Background → UI messages)', () => {
  beforeEach(() => resetI18nStateForTests('zh-TW'));

  it('renders localized messages in the active UI locale at format time', () => {
    const message = localized('tools.economy.errorUpdateFailed');
    expect(formatMessage(message)).toBe('更新價格資料失敗');
    setActiveDisplayLocale('zh-CN');
    expect(formatMessage(message)).toBe('更新价格数据失败');
    setActiveDisplayLocale('en');
    expect(formatMessage(message)).toBe('Failed to update price conversion rates');
  });

  it('passes raw strings through and falls back to the given key for empty values', () => {
    expect(formatMessage('connect ECONNREFUSED')).toBe('connect ECONNREFUSED');
    expect(formatMessage(undefined, 'tools.economy.errorUpdateFailed')).toBe('更新價格資料失敗');
    expect(formatMessage('', 'tools.economy.errorUpdateFailed')).toBe('更新價格資料失敗');
    expect(formatMessage(null)).toBe('');
  });

  it('survives structured cloning across extension messaging', () => {
    const cloned = structuredClone(localized('bookmarkTransfer.error.maxFolders', { count: 3 }));
    expect(isLocalizedMessage(cloned)).toBe(true);
    expect(formatMessage(cloned)).toBe('資料夾數量超過上限（最多 3 個）');
    expect(isLocalizedMessage('bookmarkTransfer.error.generic')).toBe(false);
  });

  it('localizes bookmark import errors that previously had hardcoded zh-TW text', () => {
    const error = new BookmarkTransferInputError('bookmarkTransfer.error.noBookmarksForVersion', {
      params: { version: 'POE1' },
    });
    expect(describeBookmarkImportError(error)).toBe(
      '此書籤資料屬於另一個遊戲版本，沒有可匯入至 POE1 的書籤',
    );
    setActiveDisplayLocale('zh-CN');
    expect(describeBookmarkImportError(error)).toBe(
      '此书签数据属于另一个游戏版本，没有可导入至 POE1 的书签',
    );
    setActiveDisplayLocale('en');
    expect(describeBookmarkImportError(error)).toContain('into POE1');
  });
});
