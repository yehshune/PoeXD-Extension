/**
 * Popover 裡的下拉選單（網域選單、Select）掛在 Popover 外（portal）。側欄在 Shadow DOM 裡時，
 * reka 從 document 看到的點擊與焦點目標會被換成 shadow host，把「在選單裡操作」或「選單關閉、
 * 焦點回到 Popover」誤判成點到 Popover 外而關閉 Popover。Popover 的 interact-outside 用這裡判斷。
 */

let openMenus = 0;
let lastClosedAt = 0;
/** 選單關閉後焦點回到觸發鈕的這段時間內，仍視為在操作選單 */
const SETTLE_MS = 300;
/** 掛在 Popover 外的選單內容元素（reka portal） */
const MENU_SLOTS = new Set(['dropdown-menu-content', 'select-content']);

/** 由選單元件在開關時呼叫 */
export function trackNestedMenuOpen(open: boolean): void {
  openMenus = Math.max(0, openMenus + (open ? 1 : -1));
  if (!open) lastClosedAt = Date.now();
}

/**
 * 外部互動是否其實是 Popover 自己（或其選單）的操作：事件路徑（含 Shadow DOM 內的節點）經過
 * `popover` 或任一 portal 選單，或選單正開著／剛關閉。
 */
export function isNestedMenuInteraction(
  path: readonly EventTarget[],
  popover?: (element: Element) => boolean,
): boolean {
  if (openMenus > 0 || Date.now() - lastClosedAt < SETTLE_MS) return true;
  return path.some(
    (target) =>
      target instanceof Element &&
      (MENU_SLOTS.has(target.getAttribute('data-slot') ?? '') || Boolean(popover?.(target))),
  );
}

/** 測試用：重設選單開關狀態 */
export function resetNestedMenuGuardForTests(): void {
  openMenus = 0;
  lastClosedAt = 0;
}
