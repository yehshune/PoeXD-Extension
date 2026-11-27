/**
 * 寬螢幕雙欄版面的 DOM 契約：`<html>` 狀態屬性、注入控件的 class 與樣式 id。
 *
 * 放在 `utils/`，讓側欄（Page Guide、設定頁）讀取雙欄狀態時不必依賴
 * content script 的樣式模組（`entrypoints/content/logic/two-column-layout-styles`）。
 */
export const TWO_COLUMN_STYLE_ID = 'poexd-two-column-layout-style';
export const TWO_COLUMN_ATTR = 'data-poexd-two-column';
export const TWO_COLUMN_NARROW_ATTR = 'data-poexd-two-column-narrow';
export const TWO_COLUMN_COLLAPSED_ATTR = 'data-poexd-two-column-collapsed';
export const TWO_COLUMN_HIDE_HEADER_ATTR = 'data-poexd-two-column-hide-header';
export const TWO_COLUMN_HEADER_OPEN_ATTR = 'data-poexd-two-column-header-open';
export const TWO_COLUMN_SEARCH_BAR_ATTR = 'data-poexd-two-col-search-bar';
export const TWO_COLUMN_CONTROLS_ATTR = 'data-poexd-two-col-controls';
export const TWO_COLUMN_FILTERS_ATTR = 'data-poexd-two-col-filters';
export const TWO_COLUMN_RESULTS_ATTR = 'data-poexd-two-col-results';
export const TWO_COLUMN_SPLITTER_CLASS = 'poexd-two-col-splitter';
export const TWO_COLUMN_COLLAPSE_BTN_CLASS = 'poexd-two-col-collapse-btn';
export const TWO_COLUMN_HEADER_TAB_CLASS = 'poexd-two-col-header-tab';
export const TWO_COLUMN_HEADER_BACKDROP_CLASS = 'poexd-two-col-header-backdrop';
export const TWO_COLUMN_TOP_BTN_CLASS = 'poexd-two-col-top-btn';
