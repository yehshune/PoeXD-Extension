/**
 * 物品預覽（PoB 物品預覽、書籤／歷史搜尋預覽）共用的版面類別。
 * 字級、間距、圓角一律用 design tokens；兩邊要一致的外觀只在這裡改。
 */

/** Popover 外框：寬度與可用空間比照搜尋預覽 */
export const PREVIEW_POPOVER_CLASS =
  'flex flex-col w-[var(--pxd-search-preview-width)] max-w-[var(--reka-popover-content-available-width,calc(100vw-32px))] max-h-[var(--reka-popover-content-available-height,calc(100vh-32px))] overflow-hidden bg-background p-0 text-[length:var(--pxd-font-body)]';

/** 標題列下方的工具列（搜尋、存回、還原等按鈕） */
export const PREVIEW_TOOLBAR_CLASS =
  'flex min-w-0 shrink-0 flex-wrap items-center gap-[var(--pxd-space-xs)] border-b border-border px-[var(--pxd-pane-padding)] py-[var(--pxd-space-sm)]';

/** 標題列的標籤（區服、聯盟、種子編號、件數等） */
export const PREVIEW_TAG_CLASS = {
  secondary:
    'whitespace-nowrap rounded-sm border border-border bg-secondary px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-secondary-foreground',
  muted:
    'min-w-0 truncate rounded-sm border border-border bg-muted px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-muted-foreground',
} as const;

/** 數值輸入框（詞綴與群組的下限／上限、至少符合 N 項）搭配 `<Input size="sm">` */
export const PREVIEW_BOUND_INPUT_CLASS =
  'w-[var(--pxd-preview-bound-input-width,52px)] shrink-0 py-0 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/** 詞綴列：本文字級、分隔線 */
export const PREVIEW_STAT_ROW_CLASS =
  'flex items-center justify-between gap-[var(--pxd-space-md)] border-t border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] leading-[1.25] first:border-t-0';

/** 詞綴群組卡片的標頭（群組類別、群組數值） */
export const PREVIEW_GROUP_HEADER_CLASS =
  'flex flex-wrap items-center gap-[var(--pxd-space-xs)] bg-muted px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)]';
