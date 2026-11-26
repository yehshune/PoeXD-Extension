import {
  DEFAULT_PREFERENCES,
  TWO_COLUMN_FILTER_WIDTH_BOUNDS,
  type TwoColumnMaxWidth,
} from './preferences-contract';
import type { TradePageRole } from './live-search-contract';

/** `.content` 可用寬度低於此值時自動退回官方上下單欄，避免擠壓結果卡片 */
export const TWO_COLUMN_MIN_CONTENT_WIDTH = 1020;

/** 右側搜尋結果區保留的最小寬度（px） */
export const TWO_COLUMN_MIN_RESULTS_WIDTH = 540;

/** 雙欄中間間距（px） */
export const TWO_COLUMN_COLUMN_GAP = 12;

/** 左側篩選欄收合時的寬度（px） */
export const TWO_COLUMN_COLLAPSED_WIDTH = 34;

/** 結果容器寬度低於此值時，將官網 `compact two` 改為單欄卡片以避免過窄 */
export const TWO_COLUMN_RESULTS_SINGLE_CARD_BREAKPOINT = 1060;

/** 左側篩選欄寬度達到此值時，底部操作按鈕列合併為單列（窄於此值改為精簡 2 列，不佔 3 列） */
export const TWO_COLUMN_SINGLE_ROW_CONTROLS_BREAKPOINT = 480;

/** 左側篩選欄寬度達到此值時，頂部搜尋框與伺服器／聯盟／狀態選單合併為單列 */
export const TWO_COLUMN_SINGLE_ROW_SEARCH_BAR_BREAKPOINT = 560;

/** 左側篩選欄寬度達到此值時，內部自動切換回官網「左屬性＋右詞綴」雙區並排 */
export const TWO_COLUMN_WIDE_FILTER_BREAKPOINT = 920;

export const TWO_COLUMN_DEFAULT_FILTER_WIDTH = DEFAULT_PREFERENCES.twoColumnFilterWidth;
export const TWO_COLUMN_DEFAULT_MAX_WIDTH: TwoColumnMaxWidth =
  DEFAULT_PREFERENCES.twoColumnMaxWidth;

const ELIGIBLE_TRADE_PATH_PATTERN = /^\/trade2?(?:\/(?:search|live)(?:\/|$)|\/?$)/i;

/**
 * 判斷目前路徑是否適合套用雙欄版面：
 * 僅限一般搜尋與單頁即時搜尋（`/trade`、`/trade2`、`/search/...`、`/live/...`），
 * 排除以物易物（`/exchange`）、官方歷史、設定與關於頁面。
 */
export function isTwoColumnEligiblePath(pathname: string): boolean {
  const normalized = pathname.trim();
  if (!normalized) return false;
  return ELIGIBLE_TRADE_PATH_PATTERN.test(normalized);
}

/** 將最大版面寬度選項轉成數值（px）；`'full'` 回傳 `null` 表示不限 */
export function resolveTwoColumnMaxWidthPx(maxWidth: TwoColumnMaxWidth): number | null {
  if (maxWidth === 'full') return null;
  const parsed = Number(maxWidth);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface TwoColumnGeometryInput {
  enabled: boolean;
  pageRole: TradePageRole;
  pathname: string;
  contentWidth: number;
  preferredFilterWidth: number;
  maxWidth?: TwoColumnMaxWidth;
  filtersCollapsed: boolean;
}

export type TwoColumnStatusReason =
  | 'active'
  | 'disabled'
  | 'non-normal-role'
  | 'ineligible-route'
  | 'narrow';

export interface TwoColumnGeometry {
  readonly active: boolean;
  readonly reason: TwoColumnStatusReason;
  readonly leftWidth: number;
  readonly maxFilterWidth: number;
  readonly maxWidthCss: string;
  readonly filtersCollapsed: boolean;
}

function inactiveGeometry(
  reason: Exclude<TwoColumnStatusReason, 'active'>,
  maxWidthCss: string,
): TwoColumnGeometry {
  return {
    active: false,
    reason,
    leftWidth: TWO_COLUMN_DEFAULT_FILTER_WIDTH,
    maxFilterWidth: TWO_COLUMN_FILTER_WIDTH_BOUNDS.max,
    maxWidthCss,
    filtersCollapsed: false,
  };
}

export function clampTwoColumnFilterWidth(
  preferredWidth: number,
  contentWidth: number,
  maxWidth: TwoColumnMaxWidth = 'full',
): { clamped: number; maxFilterWidth: number } {
  const safePreferred = Number.isFinite(preferredWidth)
    ? preferredWidth
    : TWO_COLUMN_DEFAULT_FILTER_WIDTH;
  const maxWidthPx = resolveTwoColumnMaxWidthPx(maxWidth);
  const effectiveWidth = maxWidthPx !== null ? Math.min(contentWidth, maxWidthPx) : contentWidth;
  const maxBySpace = Math.floor(
    effectiveWidth - TWO_COLUMN_MIN_RESULTS_WIDTH - TWO_COLUMN_COLUMN_GAP,
  );
  const maxFilterWidth = Math.max(
    TWO_COLUMN_FILTER_WIDTH_BOUNDS.min,
    Math.min(TWO_COLUMN_FILTER_WIDTH_BOUNDS.max, maxBySpace),
  );
  const clamped = Math.round(
    Math.min(maxFilterWidth, Math.max(TWO_COLUMN_FILTER_WIDTH_BOUNDS.min, safePreferred)),
  );
  return { clamped, maxFilterWidth };
}

export function resolveTwoColumnGeometry(input: TwoColumnGeometryInput): TwoColumnGeometry {
  const maxWidth = input.maxWidth ?? TWO_COLUMN_DEFAULT_MAX_WIDTH;
  const maxWidthPx = resolveTwoColumnMaxWidthPx(maxWidth);
  const maxWidthCss = maxWidthPx !== null ? `${maxWidthPx}px` : 'none';

  if (!input.enabled) return inactiveGeometry('disabled', maxWidthCss);
  if (input.pageRole !== 'normal') return inactiveGeometry('non-normal-role', maxWidthCss);
  if (!isTwoColumnEligiblePath(input.pathname)) {
    return inactiveGeometry('ineligible-route', maxWidthCss);
  }
  if (!Number.isFinite(input.contentWidth) || input.contentWidth < TWO_COLUMN_MIN_CONTENT_WIDTH) {
    return inactiveGeometry('narrow', maxWidthCss);
  }

  const { clamped, maxFilterWidth } = clampTwoColumnFilterWidth(
    input.preferredFilterWidth,
    input.contentWidth,
    maxWidth,
  );

  return {
    active: true,
    reason: 'active',
    leftWidth: input.filtersCollapsed ? TWO_COLUMN_COLLAPSED_WIDTH : clamped,
    maxFilterWidth,
    maxWidthCss,
    filtersCollapsed: input.filtersCollapsed,
  };
}
