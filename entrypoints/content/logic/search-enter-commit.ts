/**
 * 修正官網「輸入數值後按 Enter，第一次搜尋沒帶到該篩選」的時序問題（三服都有，與本擴充無關）。
 *
 * 官網在 `.search-advanced input.form-control` 的 keydown（Enter）就排程搜尋，
 * 但篩選輸入框只在 change 事件才把值寫進狀態；瀏覽器在 Enter 觸發的 change 晚於 keydown，
 * 所以第一次搜尋用的是舊條件，第二次 Enter 才正確。
 *
 * 這裡在捕獲階段（早於官網掛在 document 冒泡階段的處理）先對輸入框派送 change，
 * 讓官網自己的處理先寫入狀態。之後瀏覽器原生的 change 只會再寫一次同樣的值。
 */
const SEARCH_INPUT_SELECTOR = '.search-advanced input.form-control';

export function installSearchEnterCommit(win: Window = window): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches(SEARCH_INPUT_SELECTOR)) return;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  };
  win.addEventListener('keydown', handleKeyDown, true);
  return () => win.removeEventListener('keydown', handleKeyDown, true);
}
