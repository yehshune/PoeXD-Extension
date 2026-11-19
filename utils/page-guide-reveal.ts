import { PAGE_GUIDE_MOCK_ATTR, TRADE_RESULTS_SELECTOR } from './trade-results-root';

/**
 * 導覽介紹結果列的工具時，把平常要滑鼠移上去才出現的按鈕固定顯示出來。
 * 結果列與第一行詞綴加上這個屬性後，相關樣式把它們當成 hover 狀態
 * （見 result-left-actions.ts 與 result-mod-quick-filter.ts）。
 */
export const PAGE_GUIDE_REVEAL_ATTR = 'data-poexd-guide-reveal';

const RESULT_ROW_SELECTOR = `${TRADE_RESULTS_SELECTOR} .row[data-id]`;
const MOD_HOST_SELECTOR = '.poexd-result-mod-host';

/** 已固定顯示的結果列（含其中的詞綴行）全部還原；導覽示意列本來就固定顯示，不動它 */
export function clearResultReveal(root: ParentNode = document): void {
  root.querySelectorAll(`[${PAGE_GUIDE_REVEAL_ATTR}]`).forEach((el) => {
    if (!el.closest(`[${PAGE_GUIDE_MOCK_ATTR}]`)) el.removeAttribute(PAGE_GUIDE_REVEAL_ATTR);
  });
}

/**
 * 固定顯示第一筆結果的工具列與第一行可快篩的詞綴；沒有結果時回傳 false。
 * 優先挑被高亮的詞綴行，示範效果比較完整。
 */
export function revealFirstResult(root: ParentNode = document): boolean {
  const row = root.querySelector(RESULT_ROW_SELECTOR);
  if (!row) return false;
  if (row.hasAttribute(PAGE_GUIDE_REVEAL_ATTR)) return true;
  clearResultReveal(root);
  row.setAttribute(PAGE_GUIDE_REVEAL_ATTR, '');
  const modHost =
    row.querySelector(`${MOD_HOST_SELECTOR}.poexd-filter-mod-highlight`) ??
    row.querySelector(MOD_HOST_SELECTOR);
  modHost?.setAttribute(PAGE_GUIDE_REVEAL_ATTR, '');
  return true;
}
