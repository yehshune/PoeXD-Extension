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

export const PREVIEW_ICON_CLASS = 'size-[var(--control-icon-sm)] shrink-0';

/** 工具列與疊加的文字按鈕 */
export const PREVIEW_ACTION_BUTTON_CLASS =
  'inline-flex shrink-0 items-center gap-[var(--pxd-space-xs)] whitespace-nowrap rounded-sm border border-border bg-transparent px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] leading-none text-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** 標題列的標籤（區服、聯盟、種子編號、件數等） */
export const PREVIEW_TAG_CLASS = {
  secondary:
    'whitespace-nowrap rounded-sm border border-border bg-secondary px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-secondary-foreground',
  muted:
    'min-w-0 truncate rounded-sm border border-border bg-muted px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-muted-foreground',
} as const;

/** 詞綴列與群組標頭裡的精簡控制項高度（數值輸入框、群組類別下拉共用，同一行對齊） */
export const PREVIEW_COMPACT_CONTROL_HEIGHT_CLASS = 'h-[calc(var(--control-height-sm)*0.78)]';

/** 數值輸入框（詞綴與群組的下限／上限、至少符合 N 項） */
export const PREVIEW_BOUND_INPUT_CLASS = `${PREVIEW_COMPACT_CONTROL_HEIGHT_CLASS} shrink-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none rounded-md border border-solid border-input bg-background px-[var(--input-padding-x-sm)] py-0 text-right text-[length:var(--control-font-sm)] leading-none text-foreground tabular-nums shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50`;
export const PREVIEW_STAT_BOUND_INPUT_CLASS = `${PREVIEW_BOUND_INPUT_CLASS} w-[calc(var(--control-height-sm)*1.85)]`;
export const PREVIEW_GROUP_BOUND_INPUT_CLASS = `${PREVIEW_BOUND_INPUT_CLASS} w-[calc(var(--control-height-sm)*1.55)]`;

/** 詞綴列：本文字級、分隔線 */
export const PREVIEW_STAT_ROW_CLASS =
  'flex items-center justify-between gap-[var(--pxd-space-md)] border-t border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] leading-[1.25] first:border-t-0';

/** 詞綴群組卡片的標頭（群組類別、群組數值） */
export const PREVIEW_GROUP_HEADER_CLASS =
  'flex flex-wrap items-center gap-[var(--pxd-space-xs)] bg-muted px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)]';
