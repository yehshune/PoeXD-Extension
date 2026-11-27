/**
 * 找相似在官方結果列上的按鈕、Similarity 標章與詞綴標記樣式（注入到頁面 `<head>`）。
 */
export const RESULT_SIMILAR_BUTTON_CLASS = 'poexd-similar-btn';
export const RESULT_SIMILAR_BADGE_CLASS = 'poexd-similar-badge';
export const RESULT_SIMILAR_MARK_ATTR = 'data-poexd-similar-mark';

const MET = 'oklch(0.72 0.15 150)';
const WITHIN = 'oklch(0.8 0.13 85)';
const MISSING = 'oklch(0.65 0.18 25)';

export const SIMILAR_SEARCH_RESULT_CSS = `
  .${RESULT_SIMILAR_BUTTON_CLASS} {
    order: 0 !important;
    color: oklch(0.8 0.1 230) !important;
  }
  .${RESULT_SIMILAR_BUTTON_CLASS}:hover {
    border-color: oklch(0.55 0.1 230) !important;
  }
  .${RESULT_SIMILAR_BADGE_CLASS} {
    display: inline-block;
    margin-top: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid currentColor;
    font-size: 11px;
    line-height: 16px;
    font-weight: 600;
    background: rgba(0, 0, 0, 0.55);
    white-space: nowrap;
  }
  .${RESULT_SIMILAR_BADGE_CLASS}[data-level="high"] { color: ${MET}; }
  .${RESULT_SIMILAR_BADGE_CLASS}[data-level="mid"] { color: ${WITHIN}; }
  .${RESULT_SIMILAR_BADGE_CLASS}[data-level="low"] { color: ${MISSING}; }
  [${RESULT_SIMILAR_MARK_ATTR}] {
    box-shadow: inset 3px 0 0 var(--poexd-similar-mark-color);
    background-image: linear-gradient(90deg, color-mix(in oklch, var(--poexd-similar-mark-color) 22%, transparent), transparent 70%);
  }
  [${RESULT_SIMILAR_MARK_ATTR}="met"] { --poexd-similar-mark-color: ${MET}; }
  [${RESULT_SIMILAR_MARK_ATTR}="within"] { --poexd-similar-mark-color: ${WITHIN}; }
  [${RESULT_SIMILAR_MARK_ATTR}="missing"] { --poexd-similar-mark-color: ${MISSING}; }
`;
