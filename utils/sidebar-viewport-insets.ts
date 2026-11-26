/** `sidebar-layout.ts` 寫入官方頁面 `<head>` 的版面樣式節點 ID 與側欄邊距 CSS 變數 */
export const SIDEBAR_LAYOUT_STYLE_ID = 'poexd-layout-style';
export const SIDEBAR_INSET_LEFT_VAR = '--poexd-toast-inset-left';
export const SIDEBAR_INSET_RIGHT_VAR = '--poexd-toast-inset-right';
export const SIDEBAR_INSET_LEFT_ATTR = 'data-inset-left';
export const SIDEBAR_INSET_RIGHT_ATTR = 'data-inset-right';
export const TOAST_HOST_TAG = 'poexd-toast-container';

export interface SidebarViewportInsets {
  left: number;
  right: number;
}

/** 讀取側邊欄目前在視窗左右佔用的寬度（收合時為 0） */
export function readSidebarViewportInsets(doc: Document = document): SidebarViewportInsets {
  const layoutStyle = doc.getElementById(SIDEBAR_LAYOUT_STYLE_ID);
  if (
    layoutStyle &&
    (layoutStyle.hasAttribute(SIDEBAR_INSET_LEFT_ATTR) ||
      layoutStyle.hasAttribute(SIDEBAR_INSET_RIGHT_ATTR))
  ) {
    const left = Number.parseFloat(layoutStyle.getAttribute(SIDEBAR_INSET_LEFT_ATTR) ?? '') || 0;
    const right = Number.parseFloat(layoutStyle.getAttribute(SIDEBAR_INSET_RIGHT_ATTR) ?? '') || 0;
    return { left: Math.max(0, left), right: Math.max(0, right) };
  }

  const toastHost = doc.querySelector<HTMLElement>(TOAST_HOST_TAG);
  if (toastHost) {
    const toastStyle = getComputedStyle(toastHost);
    const leftRaw = toastStyle.getPropertyValue(SIDEBAR_INSET_LEFT_VAR);
    const rightRaw = toastStyle.getPropertyValue(SIDEBAR_INSET_RIGHT_VAR);
    if (leftRaw || rightRaw) {
      return {
        left: Math.max(0, Number.parseFloat(leftRaw) || 0),
        right: Math.max(0, Number.parseFloat(rightRaw) || 0),
      };
    }
  }

  const style = getComputedStyle(doc.documentElement);
  const left = Number.parseFloat(style.getPropertyValue(SIDEBAR_INSET_LEFT_VAR)) || 0;
  const right = Number.parseFloat(style.getPropertyValue(SIDEBAR_INSET_RIGHT_VAR)) || 0;
  return { left: Math.max(0, left), right: Math.max(0, right) };
}
