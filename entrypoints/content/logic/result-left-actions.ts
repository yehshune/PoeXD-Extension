/**
 * 結果列共用 DOM 輔助：列識別、列掃描與左上角 hover 工具列（`.left`）掛載點。
 */
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import {
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  RESULT_LEFT_ACTIONS_CLASS,
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';

export { RESULT_LEFT_ACTION_BUTTON_CLASS, RESULT_LEFT_ACTIONS_CLASS };

const BUTTON_HOST_SELECTOR = '.left';
export const RESULT_ITEM_ROW_SELECTOR = '.row[data-id], .row[id]';

export function resolveRowId(row: Element): string {
  return row.getAttribute('data-id') || row.getAttribute('id') || '';
}

export function resolveMappedRowId<T>(row: Element, map: Record<string, T>): string | undefined {
  const candidates = [row.getAttribute('data-id'), row.getAttribute('id')];
  return candidates.find((candidate) => candidate && map[candidate]) || undefined;
}

export function collectResultRows(container: Element): Element[] {
  const rows = Array.from(container.querySelectorAll(RESULT_ITEM_ROW_SELECTOR)).filter(
    (r) => !r.matches?.('.row-total, .controls'),
  );
  if (
    container.matches?.(RESULT_ITEM_ROW_SELECTOR) &&
    !container.matches?.('.row-total, .controls')
  ) {
    rows.unshift(container);
  }
  return rows;
}

/** 將單一功能節點掛載到結果列 `.left` 的左上角 hover 工具列 */
export function mountLeftAction(row: Element, action: HTMLElement, doc?: Document): void {
  const targetDoc =
    doc ?? row.ownerDocument ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc) return;
  const host = row.querySelector(BUTTON_HOST_SELECTOR) ?? row;
  let strip = host.querySelector(`.${RESULT_LEFT_ACTIONS_CLASS}`) as HTMLElement | null;
  if (!strip) {
    strip = targetDoc.createElement('div');
    strip.className = RESULT_LEFT_ACTIONS_CLASS;
    host.appendChild(strip);
  }
  strip.appendChild(action);
  ensureResultEnhancementStyle('left-actions', targetDoc);
}

/** 依 class 名稱移除功能節點（略過導覽示意列），並在工具列清空時一併清理容器與樣式 */
export function removeLeftActionsByClass(className: string, doc?: Document): void {
  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc || !className) return;
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(className)
      : className;
  targetDoc.querySelectorAll(`${TRADE_RESULTS_SELECTOR} .${escaped}`).forEach((el) => el.remove());
  targetDoc
    .querySelectorAll(`${TRADE_RESULTS_SELECTOR} .${RESULT_LEFT_ACTIONS_CLASS}`)
    .forEach((strip) => {
      if (strip.children.length === 0) strip.remove();
    });
  if (targetDoc.querySelectorAll(`.${RESULT_LEFT_ACTIONS_CLASS}`).length === 0) {
    removeResultEnhancementStyle('left-actions', targetDoc);
  }
}
