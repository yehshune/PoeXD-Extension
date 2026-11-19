import { ensureLeftActionsStyle } from './result-left-actions';
import { ensureHighlightStyle } from './result-mod-highlighter';
import { ensureResultModQuickFilterStyle } from './result-mod-quick-filter';
import { ensureResultPinStyle } from './result-pin-button';
import { ensureResultPobCopyStyle } from './result-pob-copy';
import { ensureResultExternalLinksStyle } from './result-external-links';
import { ensurePriceComparisonStyle } from './result-price-presenter';

/**
 * 一次注入所有結果強化按鈕的樣式。各功能平常在第一筆結果出現時才注入；
 * 導覽的示意結果列在還沒搜尋過的頁面上也要長得和真的一樣。
 */
export function ensureResultEnhancementStyles(): void {
  ensureLeftActionsStyle();
  ensureResultPinStyle();
  ensureResultPobCopyStyle();
  ensureResultExternalLinksStyle();
  ensureHighlightStyle();
  ensureResultModQuickFilterStyle();
  ensurePriceComparisonStyle();
}
