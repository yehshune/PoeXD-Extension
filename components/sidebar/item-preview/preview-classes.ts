/**
 * 物品預覽（PoB 物品預覽、書籤／歷史搜尋預覽）共用的版面類別。
 * 字級、間距、圓角一律用 design tokens；兩邊要一致的外觀只在這裡改。
 */

/** Popover 外框：寬度與可用空間比照搜尋預覽 */
export const PREVIEW_POPOVER_CLASS =
  'flex flex-col w-[var(--pxd-search-preview-width)] max-w-[var(--reka-popover-content-available-width,calc(100vw-32px))] max-h-[var(--reka-popover-content-available-height,calc(100vh-32px))] overflow-hidden border-border/80 bg-background p-0 text-[length:var(--pxd-font-body)] shadow-2xl';

/** 標題列下方的單行工具列（搜尋、存回、還原、摺疊與疊加）：固定單行不換行，微調時零高度位移 */
export const PREVIEW_TOOLBAR_CLASS =
  'flex min-w-0 shrink-0 flex-nowrap items-center gap-[var(--pxd-space-xs)] border-b border-border/60 bg-muted/20 px-[var(--pxd-pane-padding)] py-[var(--pxd-space-xs)]';

/** 標題列的標籤（區服、聯盟、種子編號、件數等）：以柔和底色區隔，不加硬邊框 */
export const PREVIEW_TAG_CLASS = {
  secondary:
    'whitespace-nowrap rounded-sm bg-secondary px-[var(--pxd-space-xs)] py-0.5 text-[length:var(--pxd-font-caption)] font-medium text-secondary-foreground',
  muted:
    'min-w-0 truncate rounded-sm bg-muted px-[var(--pxd-space-xs)] py-0.5 text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground',
} as const;

/** 頂部摘要區塊（物品／基底、上架狀態等）：右側留白與區段標題對齊，使「＋」按鈕落在同一垂直軸線 */
export const PREVIEW_META_BLOCK_CLASS =
  'rounded-md bg-muted/30 pl-[var(--pxd-space-sm)] pr-[var(--pxd-space-xs)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] leading-[1.35]';

/** 詞綴群組與篩選清單的外框卡片 */
export const PREVIEW_CARD_CLASS = 'overflow-hidden rounded-md border border-border/60 bg-card/25';

/** 預覽內部緊湊型下拉選單觸發器（群組類別、上架狀態） */
export const PREVIEW_COMPACT_SELECT_CLASS =
  'h-[calc(var(--control-height-sm)-4px)] w-auto shrink-0 border-border/50 bg-background/70 shadow-none hover:bg-background';

/** 數值輸入框（詞綴與群組的下限／上限、至少符合 N 項）搭配 `<Input size="sm">`；空值與未勾選列收起邊框降噪 */
export const PREVIEW_BOUND_INPUT_CLASS =
  'h-[calc(var(--control-height-sm)-4px)] w-[var(--pxd-preview-bound-input-width,52px)] shrink-0 rounded-sm border-border/60 bg-background/75 py-0 text-right tabular-nums shadow-none transition-colors placeholder:text-muted-foreground/40 placeholder-shown:border-transparent placeholder-shown:bg-transparent group-hover/stat-row:enabled:placeholder-shown:bg-muted/40 hover:enabled:border-input hover:enabled:bg-background focus-visible:border-ring focus-visible:bg-background disabled:border-transparent disabled:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/** 詞綴列：本文字級、淡化分隔線與懸停底色 */
export const PREVIEW_STAT_ROW_CLASS =
  'group/stat-row flex items-center justify-between gap-[var(--pxd-space-md)] border-t border-border/35 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] leading-[1.25] transition-colors first:border-t-0 hover:bg-muted/25';

/** 詞綴群組卡片的標頭（群組類別、群組數值） */
export const PREVIEW_GROUP_HEADER_CLASS =
  'flex flex-wrap items-center gap-[var(--pxd-space-xs)] border-b border-border/40 bg-muted/45 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)]';
