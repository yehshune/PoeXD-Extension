import { describe, expect, it, beforeEach } from 'vitest';
import { toBookmarkTransferInputError } from '@/utils/bookmark-transfer-errors';
import {
  describeBookmarkImportError,
  describeBookmarkImportFailure,
} from '@/utils/bookmark-transfer-messages';
import {
  STAT_GROUP_TYPE_LABELS,
  STATUS_LABELS,
  labelCriteriaOverlayParts,
  summarizeOverlayCriteria,
} from '@/components/injected/criteria-overlay-labels';
import { describeCriteriaOverlayReport } from '@/entrypoints/content/logic/criteria-overlay-session';
import { setActiveDisplayLocale, resetI18nStateForTests } from '@/utils/i18n';

describe('Structured Transfer & Criteria Overlay i18n (Seam 2)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  describe('Bookmark Transfer Errors', () => {
    it('localizes generic import error and parse failures across locales', () => {
      const err = toBookmarkTransferInputError(new Error('SyntaxError: Unexpected token'));

      setActiveDisplayLocale('zh-TW');
      expect(describeBookmarkImportError(err)).toContain('分享碼不完整或已損毀');

      setActiveDisplayLocale('zh-CN');
      expect(describeBookmarkImportError(err)).toContain('分享码不完整或已损坏');

      setActiveDisplayLocale('en');
      expect(describeBookmarkImportError(err)).toContain('Share code is incomplete or corrupted');
    });

    it('localizes structured internal error descriptions across locales', () => {
      const err = toBookmarkTransferInputError(new Error('at most 100 Bookmarks'));

      setActiveDisplayLocale('zh-TW');
      expect(describeBookmarkImportError(err)).toBe('書籤數量超過上限（最多 100 個）');

      setActiveDisplayLocale('zh-CN');
      expect(describeBookmarkImportError(err)).toBe('书签数量超过上限（最多 100 个）');

      setActiveDisplayLocale('en');
      expect(describeBookmarkImportError(err)).toBe('Bookmark count exceeds limit (max 100)');
    });

    it('localizes storage failure codes across locales', () => {
      setActiveDisplayLocale('zh-TW');
      expect(describeBookmarkImportFailure({ code: 'storage-failure' })).toBe(
        '書籤無法儲存，請稍後再試',
      );

      setActiveDisplayLocale('zh-CN');
      expect(describeBookmarkImportFailure({ code: 'storage-failure' })).toBe(
        '书签无法保存，请稍后再试',
      );

      setActiveDisplayLocale('en');
      expect(describeBookmarkImportFailure({ code: 'storage-failure' })).toBe(
        'Failed to save bookmarks. Please try again later.',
      );
    });
  });

  describe('Criteria Overlay Labels & Reports', () => {
    it('reactively translates stat group types and listing statuses', () => {
      setActiveDisplayLocale('zh-TW');
      expect(STAT_GROUP_TYPE_LABELS.and).toBe('且 (AND)');
      expect(STATUS_LABELS.online).toBe('僅限線上');

      setActiveDisplayLocale('zh-CN');
      expect(STAT_GROUP_TYPE_LABELS.and).toBe('且 (AND)');
      expect(STATUS_LABELS.online).toBe('仅限在线');

      setActiveDisplayLocale('en');
      expect(STAT_GROUP_TYPE_LABELS.and).toBe('AND');
      expect(STATUS_LABELS.online).toBe('Online Only');
    });

    it('reactively formats criteria overlay report across locales', () => {
      const report = {
        addedStatGroups: 1,
        skippedDuplicateStatGroups: 1,
        skippedUnknownStatFilters: 0,
        changedFields: 2,
        changedItem: false,
        changedStatus: true,
      };

      setActiveDisplayLocale('zh-TW');
      expect(describeCriteriaOverlayReport('MySearch', report)).toBe(
        '已套用「MySearch」：新增 1 個詞綴群組、設定 2 個篩選欄位、設定上架狀態；略過 1 個重複群組',
      );

      setActiveDisplayLocale('zh-CN');
      expect(describeCriteriaOverlayReport('MySearch', report)).toBe(
        '已套用「MySearch」：新增 1 个词缀群组、设定 2 个筛选栏位、设定上架状态；略过 1 个重复群组',
      );

      setActiveDisplayLocale('en');
      expect(describeCriteriaOverlayReport('MySearch', report)).toBe(
        'Applied "MySearch": Added 1 stat group, Set 2 filter fields, Set listing status; Skipped 1 duplicate group',
      );
    });

    it('localizes overlay parts and summary', () => {
      const criteria = {
        item: { name: 'Tabula Rasa', type: '', disc: '', term: '' },
        status: 'online',
        statGroups: [
          {
            type: 'and',
            value: undefined,
            disabled: false,
            filters: [{ id: 'explicit.stat_1', value: { min: 10 }, disabled: false }],
          },
        ],
        fields: [],
        sectionDisabled: {},
      };

      setActiveDisplayLocale('en');
      const parts = labelCriteriaOverlayParts(criteria, 'poe2');
      expect(parts.find((p) => p.key === 'item')?.group).toBe('Item');
      expect(parts.find((p) => p.key === 'status')?.label).toBe('Listing Status');
      expect(parts.find((p) => p.target.kind === 'stat-group')?.label).toContain('1 mod');
      expect(summarizeOverlayCriteria(criteria)).toBe(
        '1 stat group · Item Name / Base · Listing Status',
      );
    });
  });
});
