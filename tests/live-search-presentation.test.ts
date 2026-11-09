// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  projectResumableInspectItems,
  formatBatchEnableSummary,
  resolveBatchEnableToast,
  formatBatchStopSummary,
  resolveBatchStopToast,
} from '@/components/sidebar/live-search-presentation';
import type {
  LiveSearchBatchOutcome,
  LiveSearchSourceGroup,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';

describe('LiveSearch Shared Presentation Helpers', () => {
  describe('projectResumableInspectItems', () => {
    it('防禦空輸入：無 ids 或無 groups 時安全回傳空陣列', () => {
      expect(projectResumableInspectItems(undefined, undefined)).toEqual([]);
      expect(projectResumableInspectItems([], [])).toEqual([]);
      expect(projectResumableInspectItems(['bm_1'], undefined)).toEqual([]);
      expect(projectResumableInspectItems(undefined, [{ id: 'grp_1' } as any])).toEqual([]);
    });

    it('依 resumableSourceIds 精確投影，忽略 custom 類型與非清單項目，並使用 formatFolderPath 產生完整路徑', () => {
      const groups: LiveSearchSourceGroup[] = [
        {
          id: 'folder_parent',
          name: '裝備',
          depth: 0,
          order: 0,
          kind: 'bookmark',
          items: [],
        } as any,
        {
          id: 'folder_child',
          name: '武器',
          parentId: 'folder_parent',
          depth: 1,
          order: 0,
          kind: 'bookmark',
          items: [
            {
              id: 'bm_bow',
              name: '強力弓',
              kind: 'bookmark',
              status: 'idle',
            },
            {
              id: 'bm_sword',
              name: '單手劍',
              kind: 'bookmark',
              status: 'connecting',
            },
          ] as any,
        } as any,
        {
          id: 'custom_sources',
          name: '暫時搜尋',
          depth: 0,
          order: 1,
          kind: 'custom',
          items: [
            {
              id: 'custom_1',
              name: '自訂搜尋',
              kind: 'custom',
              status: 'idle',
            },
          ] as any,
        } as any,
      ];

      const result = projectResumableInspectItems(
        ['bm_bow', 'custom_1', 'bm_sword', 'bm_nonexistent'],
        groups,
      );

      expect(result).toEqual([
        {
          id: 'bm_bow',
          name: '強力弓',
          groupPath: '裝備 / 武器',
          status: 'idle',
        },
        {
          id: 'bm_sword',
          name: '單手劍',
          groupPath: '裝備 / 武器',
          status: 'connecting',
        },
      ]);
    });
  });

  describe('formatBatchEnableSummary & resolveBatchEnableToast', () => {
    it('格式化成功啟用、略過與失敗數量', () => {
      const outcome: LiveSearchBatchOutcome = {
        succeeded: 3,
        skipped: 1,
        failed: 2,
      } as any;
      expect(formatBatchEnableSummary(outcome)).toBe('已啟用 3 項 · 略過 1 項 · 2 項無法啟用');

      const toast = resolveBatchEnableToast(outcome);
      expect(toast.message).toBe('已啟用 3 項 · 略過 1 項 · 2 項無法啟用');
      expect(toast.tone).toBe('error'); // 存在 failed > 0 為 error tone
    });

    it('全部成功時 tone 為 default', () => {
      const outcome: LiveSearchBatchOutcome = {
        succeeded: 4,
        skipped: 0,
        failed: 0,
      } as any;
      expect(formatBatchEnableSummary(outcome)).toBe('已啟用 4 項');

      const toast = resolveBatchEnableToast(outcome);
      expect(toast.message).toBe('已啟用 4 項');
      expect(toast.tone).toBe('default');
    });

    it('rejectReason 存在時優先輸出錯誤訊息與 error tone', () => {
      const outcome: LiveSearchBatchOutcome = {
        succeeded: 0,
        skipped: 0,
        failed: 0,
        rejectReason: 'mixed-league',
        error: '選取項目包含多個聯盟，請分開啟用',
      } as any;
      const toast = resolveBatchEnableToast(outcome);
      expect(toast.message).toBe('選取項目包含多個聯盟，請分開啟用');
      expect(toast.tone).toBe('error');
    });
  });

  describe('formatBatchStopSummary & resolveBatchStopToast', () => {
    it('格式化停止結果與 toast 提示', () => {
      const outcome: LiveSearchBatchOutcome = {
        succeeded: 2,
        skipped: 1,
        failed: 0,
      } as any;
      expect(formatBatchStopSummary(outcome)).toBe('已停止 2 項 · 略過 1 項');

      const toast = resolveBatchStopToast(outcome);
      expect(toast.message).toBe('已停止 2 項 · 略過 1 項');
      expect(toast.tone).toBe('default');
    });

    it('停止失敗時輸出錯誤訊息與 error tone', () => {
      const outcome: LiveSearchBatchOutcome = {
        succeeded: 0,
        skipped: 0,
        failed: 0,
        rejectReason: 'disposed',
        error: '控制器已釋放',
      } as any;
      const toast = resolveBatchStopToast(outcome);
      expect(toast.message).toBe('控制器已釋放');
      expect(toast.tone).toBe('error');
    });
  });
});
