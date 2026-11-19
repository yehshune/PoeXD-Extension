import { COLLAPSED_TAB_TOP_BOUNDS, DEFAULT_PREFERENCES } from './preferences-contract';

/** 拖曳超過此距離（px）才算拖曳，否則視為點擊展開 */
export const COLLAPSED_TAB_DRAG_THRESHOLD = 4;

/** 鍵盤（Alt + ↑/↓）每次移動的距離（px） */
export const COLLAPSED_TAB_KEYBOARD_STEP = 20;

/**
 * 收合標籤的 top：限制在視窗內，標籤不會被拖出畫面。
 * viewportHeight 或 tabHeight 無效時只套用偏好的上下限。
 */
export function clampCollapsedTabTop(
  top: number,
  viewportHeight: number,
  tabHeight: number,
): number {
  const safeTop = Number.isFinite(top) ? top : DEFAULT_PREFERENCES.collapsedTabTop;
  const viewportMax =
    Number.isFinite(viewportHeight) && Number.isFinite(tabHeight)
      ? Math.max(COLLAPSED_TAB_TOP_BOUNDS.min, viewportHeight - tabHeight)
      : COLLAPSED_TAB_TOP_BOUNDS.max;
  const max = Math.min(COLLAPSED_TAB_TOP_BOUNDS.max, viewportMax);
  return Math.round(Math.min(Math.max(safeTop, COLLAPSED_TAB_TOP_BOUNDS.min), max));
}

/**
 * 儲存的位置是在別的視窗大小下拖的；用 CSS clamp 讓標籤在視窗縮小時仍留在畫面內，
 * 不必監聽 resize。shadow host 與 Sidebar.vue 共用同一個運算式，兩者位置才會一致。
 */
export function collapsedTabTopCss(top: number | undefined): string {
  const safeTop =
    typeof top === 'number' && Number.isFinite(top) ? top : DEFAULT_PREFERENCES.collapsedTabTop;
  return `clamp(0px, ${Math.round(safeTop)}px, calc(100vh - var(--control-height-default)))`;
}
