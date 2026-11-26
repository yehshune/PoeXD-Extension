/** `sidebar-layout.ts` 寫入官方頁面 `<head>` 的版面樣式節點 ID 與側欄邊距 CSS 變數 */
export const SIDEBAR_LAYOUT_STYLE_ID = 'poexd-layout-style';
export const SIDEBAR_INSET_LEFT_VAR = '--poexd-toast-inset-left';
export const SIDEBAR_INSET_RIGHT_VAR = '--poexd-toast-inset-right';

export interface SidebarViewportInsets {
  left: number;
  right: number;
}

/** 讀取側邊欄目前在視窗左右佔用的寬度（收合時為 0） */
export function readSidebarViewportInsets(doc: Document = document): SidebarViewportInsets {
  const style = getComputedStyle(doc.documentElement);
  const left = Number.parseFloat(style.getPropertyValue(SIDEBAR_INSET_LEFT_VAR)) || 0;
  const right = Number.parseFloat(style.getPropertyValue(SIDEBAR_INSET_RIGHT_VAR)) || 0;
  return { left: Math.max(0, left), right: Math.max(0, right) };
}
