/**
 * 官方搜尋結果區的選擇器。導覽的示意結果列也用 `.results` 讓官方樣式套用，
 * 但標上 `data-poexd-guide-mock`，結果強化功能一律略過它。
 */
export const PAGE_GUIDE_MOCK_ATTR = 'data-poexd-guide-mock';

export const TRADE_RESULTS_SELECTOR = `.results:not([${PAGE_GUIDE_MOCK_ATTR}])`;

/**
 * 示意結果列放在官方頁面（側欄 shadow root 之外），疊在官方內容之上、
 * 但低於側欄宿主（sidebar-layout.ts 的 2147483646），導覽的外框與說明框仍蓋在它上面。
 */
export const PAGE_GUIDE_MOCK_Z_INDEX = '2147483645';

export function hasPageGuideMock(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelectorAll(`[${PAGE_GUIDE_MOCK_ATTR}]`).length > 0
  );
}

/** 清理結果強化樣式；導覽示意列顯示時保留樣式以免示意列破版 */
export function removeTradeResultStyle(styleId: string): void {
  if (typeof document === 'undefined' || hasPageGuideMock()) return;
  document.getElementById(styleId)?.remove();
}
