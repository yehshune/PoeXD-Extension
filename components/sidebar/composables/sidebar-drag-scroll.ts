import type Sortable from 'sortablejs';

type SidebarDragScrollOptions = Pick<
  Sortable.Options,
  'scroll' | 'forceAutoScrollFallback' | 'scrollSensitivity' | 'scrollSpeed' | 'bubbleScroll'
>;

/**
 * 側邊欄清單拖曳時靠近上下邊緣自動捲動的 Sortable 設定。
 * 側邊欄在 shadow root 內，瀏覽器原生的拖曳自動捲動不會作用，因此強制使用 Sortable 的 fallback，
 * 並指定實際捲動的 viewport，避免冒泡去捲動官方頁面。
 */
export function createSidebarDragScrollOptions(
  scrollEl: HTMLElement | null,
): SidebarDragScrollOptions {
  return {
    scroll: scrollEl ?? undefined,
    forceAutoScrollFallback: true,
    scrollSensitivity: 48,
    scrollSpeed: 20,
    bubbleScroll: false,
  };
}
