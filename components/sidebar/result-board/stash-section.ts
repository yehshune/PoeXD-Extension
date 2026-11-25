import type { SellerStashGroup } from '@/utils/result-board/board-projection';
import type { StashRegexResult } from '@/utils/result-board/stash-regex';

/** 賣家展開區的一個倉庫分頁：分區資料加上整頁勾選狀態與該頁的倉庫搜尋 regex */
export interface StashSection extends SellerStashGroup {
  pickState: boolean | 'indeterminate';
  regex?: StashRegexResult;
}
