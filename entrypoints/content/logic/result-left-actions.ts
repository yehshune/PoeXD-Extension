/**
 * 結果卡片左上角 hover 工具列（位於官方重整按鈕右側，供 PoB 複製、PoEDB 等按鈕共用）。
 */

const STYLE_ID = 'poexd-result-left-actions-style';
const BUTTON_HOST_SELECTOR = '.left';

export const RESULT_LEFT_ACTIONS_CLASS = 'poexd-left-actions';
export const RESULT_LEFT_ACTION_BUTTON_CLASS = 'poexd-left-actions-btn';

// 顏色一律用 oklch()（主題契約不允許原始 hex 色碼）
const STYLE_CONTENT = `
  .${RESULT_LEFT_ACTIONS_CLASS} {
    position: absolute !important;
    top: 8px !important;
    left: 44px !important;
    z-index: 2 !important;
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
    height: 30px !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    transition: opacity 0.12s ease, visibility 0.12s ease !important;
  }

  .row:hover .${RESULT_LEFT_ACTIONS_CLASS},
  .${RESULT_LEFT_ACTIONS_CLASS}:has(:focus-visible) {
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
  }

  .${RESULT_LEFT_ACTION_BUTTON_CLASS} {
    appearance: none !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    height: 20px !important;
    padding: 0 5px !important;
    margin: 0 !important;
    border-radius: 0 !important;
    border: 1px solid oklch(0.387 0 0) !important;
    background: oklch(0.252 0 0 / 0.96) !important;
    font-family: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif !important;
    font-size: 11px !important;
    line-height: 1 !important;
    letter-spacing: 0.03em !important;
    cursor: pointer !important;
    white-space: nowrap !important;
    transition: border-color 0.12s ease !important;
  }
`;

function ensureLeftActionsStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_CONTENT;
  (document.head ?? document.documentElement).appendChild(style);
}

/** 將單一功能節點掛載到結果列 `.left` 的左上角 hover 工具列 */
export function mountLeftAction(row: Element, action: HTMLElement): void {
  const host = row.querySelector(BUTTON_HOST_SELECTOR) ?? row;
  let strip = host.querySelector(`.${RESULT_LEFT_ACTIONS_CLASS}`) as HTMLElement | null;
  if (!strip) {
    strip = document.createElement('div');
    strip.className = RESULT_LEFT_ACTIONS_CLASS;
    host.appendChild(strip);
  }
  strip.appendChild(action);
  ensureLeftActionsStyle();
}

/** 依 class 名稱移除功能節點，並在工具列清空時一併清理容器與樣式 */
export function removeLeftActionsByClass(className: string): void {
  if (typeof document === 'undefined' || !className) return;
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(className)
      : className;
  document.querySelectorAll(`.${escaped}`).forEach((el) => el.remove());
  document.querySelectorAll(`.${RESULT_LEFT_ACTIONS_CLASS}`).forEach((strip) => {
    if (strip.children.length === 0) strip.remove();
  });
  if (document.querySelectorAll(`.${RESULT_LEFT_ACTIONS_CLASS}`).length === 0) {
    document.getElementById(STYLE_ID)?.remove();
  }
}
