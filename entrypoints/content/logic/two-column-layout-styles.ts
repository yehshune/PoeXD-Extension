/**
 * 寬螢幕雙欄版面的純 CSS 建構模組。
 *
 * - 雙欄宿主控件屬於 `visual-class-reset-contract.md` §2.2 的 Host-Native PoE Controls 例外：
 *   不隨 PoeXD 側邊欄主題（含亮色主題）變色，統一採用方角與官方暗黑／暖金 `oklch()` 色階融入市集。
 * - 為確保左右獨立捲動區由 Chromium GPU Compositor Thread 平滑捲動：
 *   1. 禁止使用 `backdrop-filter: blur(...)`（避免每幀 GPU readback 重繪）。
 *   2. 禁止在捲動容器上使用 `container-type: inline-size`（改由控制器僅於寬度變化時寫入 `data-*` 旗標）。
 *   3. 雙捲動區皆設 100% 不透明底色、`contain: paint`、`will-change: scroll-position` 與 `overscroll-behavior: contain`。
 */
import {
  TWO_COLUMN_COLLAPSED_WIDTH,
  TWO_COLUMN_COLUMN_GAP,
  TWO_COLUMN_DEFAULT_FILTER_WIDTH,
} from '@/utils/two-column-layout';
import { CONSOLE_RESULT_ONLY_ATTR } from './live-search-console-host-guard';

export const TWO_COLUMN_STYLE_ID = 'poexd-two-column-layout-style';
export const TWO_COLUMN_ATTR = 'data-poexd-two-column';
export const TWO_COLUMN_COLLAPSED_ATTR = 'data-poexd-two-column-collapsed';
export const TWO_COLUMN_HIDE_HEADER_ATTR = 'data-poexd-two-column-hide-header';
export const TWO_COLUMN_HEADER_OPEN_ATTR = 'data-poexd-two-column-header-open';
export const TWO_COLUMN_SEARCH_BAR_ATTR = 'data-poexd-two-col-search-bar';
export const TWO_COLUMN_CONTROLS_ATTR = 'data-poexd-two-col-controls';
export const TWO_COLUMN_FILTERS_ATTR = 'data-poexd-two-col-filters';
export const TWO_COLUMN_RESULTS_ATTR = 'data-poexd-two-col-results';
export const TWO_COLUMN_WIDTH_VAR = '--poexd-two-col-left';
export const TWO_COLUMN_MAX_WIDTH_VAR = '--poexd-two-col-max-width';
export const TWO_COLUMN_SPLITTER_CLASS = 'poexd-two-col-splitter';
export const TWO_COLUMN_COLLAPSE_BTN_CLASS = 'poexd-two-col-collapse-btn';
export const TWO_COLUMN_HEADER_TAB_CLASS = 'poexd-two-col-header-tab';
export const TWO_COLUMN_HEADER_BACKDROP_CLASS = 'poexd-two-col-header-backdrop';
export const TWO_COLUMN_TOP_BTN_CLASS = 'poexd-two-col-top-btn';

const ACTIVE_SCOPE = `html[${TWO_COLUMN_ATTR}="active"]:not([${CONSOLE_RESULT_ONLY_ATTR}="true"])`;
const COLLAPSED_SCOPE = `html[${TWO_COLUMN_ATTR}="active"][${TWO_COLUMN_COLLAPSED_ATTR}="true"]:not([${CONSOLE_RESULT_ONLY_ATTR}="true"])`;
const HIDE_HEADER_SCOPE = `html[${TWO_COLUMN_ATTR}="active"][${TWO_COLUMN_HIDE_HEADER_ATTR}="true"]:not([${CONSOLE_RESULT_ONLY_ATTR}="true"])`;
const HEADER_OPEN_SCOPE = `html[${TWO_COLUMN_ATTR}="active"][${TWO_COLUMN_HIDE_HEADER_ATTR}="true"][${TWO_COLUMN_HEADER_OPEN_ATTR}="true"]:not([${CONSOLE_RESULT_ONLY_ATTR}="true"])`;

const SINGLE_SEARCH_BAR_SCOPE = `${ACTIVE_SCOPE}[${TWO_COLUMN_SEARCH_BAR_ATTR}="single"]`;
const SINGLE_CONTROLS_SCOPE = `${ACTIVE_SCOPE}[${TWO_COLUMN_CONTROLS_ATTR}="single"]`;
const WIDE_FILTERS_SCOPE = `${ACTIVE_SCOPE}[${TWO_COLUMN_FILTERS_ATTR}="wide"]`;
const NARROW_FILTERS_SCOPE = `${ACTIVE_SCOPE}[${TWO_COLUMN_FILTERS_ATTR}="narrow"]`;
const WIDE_RESULTS_SCOPE = `${ACTIVE_SCOPE}[${TWO_COLUMN_RESULTS_ATTR}="wide"]`;
const NARROW_RESULTS_SCOPE = `${ACTIVE_SCOPE}[${TWO_COLUMN_RESULTS_ATTR}="narrow"]`;

function buildSingleColumnResultsetCss(selector: string): string {
  return `
    ${selector} {
      display: flex !important;
      flex-direction: column !important;
      flex-wrap: nowrap !important;
      align-items: center !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 0 12px !important;
    }

    ${selector} > .row {
      flex: 0 0 auto !important;
      width: 100% !important;
      max-width: 920px !important;
      box-sizing: border-box !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }
  `;
}

export function buildTwoColumnLayoutCss(): string {
  return `
    /* 鎖定外層視窗為 100vh，避免出現最外層捲軸；改由左篩選欄與右結果欄各自獨立捲動 */
    ${ACTIVE_SCOPE},
    ${ACTIVE_SCOPE} body {
      height: 100vh !important;
      max-height: 100vh !important;
      overflow: hidden !important;
    }

    ${ACTIVE_SCOPE} .container-fluid {
      height: 100vh !important;
      max-height: 100vh !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }

    ${ACTIVE_SCOPE} .content {
      height: 100vh !important;
      max-height: 100vh !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      float: none !important;
      box-sizing: border-box !important;
    }

    ${ACTIVE_SCOPE} .content > .bottom {
      display: none !important;
    }

    ${ACTIVE_SCOPE} .wrapper {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      height: 100% !important;
      width: 100% !important;
      max-width: var(${TWO_COLUMN_MAX_WIDTH_VAR}, none) !important;
      margin-inline: auto !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      position: relative !important;
    }

    ${ACTIVE_SCOPE} .wrapper > .logo {
      flex: 0 0 auto !important;
      height: 54px !important;
      margin-bottom: 4px !important;
    }
    ${ACTIVE_SCOPE} .wrapper > .logo a {
      max-width: 72px !important;
    }

    /* 自動收合頂部官方標頭（市集原生暗黑／暖金風格，不使用 PoeXD 側欄主題） */
    ${HIDE_HEADER_SCOPE} .wrapper > #statusBar,
    ${HIDE_HEADER_SCOPE} .wrapper > .linkBack,
    ${HIDE_HEADER_SCOPE} .wrapper > .logo,
    ${HIDE_HEADER_SCOPE} .wrapper > .language-select {
      position: absolute !important;
      z-index: 42 !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 0.16s ease, transform 0.16s ease !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > #statusBar {
      top: 4px !important;
      left: 8px !important;
      transform: translateY(-16px) !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .linkBack {
      top: 45px !important;
      left: 8px !important;
      transform: translateY(-16px) !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .logo {
      top: 4px !important;
      left: 50% !important;
      width: auto !important;
      height: 62px !important;
      margin: 0 !important;
      transform: translate(-50%, -16px) !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .language-select {
      top: 8px !important;
      right: 8px !important;
      transform: translateY(-16px) !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .${TWO_COLUMN_HEADER_BACKDROP_CLASS} {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: 76px !important;
      z-index: 40 !important;
      background: oklch(0.095 0.004 250) !important;
      border-bottom: 1px solid oklch(0.32 0.012 250) !important;
      box-shadow: 0 6px 18px oklch(0 0 0 / 0.6) !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transform: translateY(-100%) !important;
      transition: opacity 0.16s ease, transform 0.16s ease !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .${TWO_COLUMN_HEADER_TAB_CLASS} {
      position: absolute !important;
      top: 0 !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      width: 112px !important;
      height: 14px !important;
      padding: 0 !important;
      margin: 0 !important;
      z-index: 43 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border: 1px solid oklch(0.36 0.008 250) !important;
      border-top: 0 !important;
      border-radius: 0 !important;
      background: oklch(0.18 0.005 250) !important;
      color: oklch(0.858 0.068 82.8) !important;
      cursor: pointer !important;
      transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, opacity 0.15s ease !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .${TWO_COLUMN_HEADER_TAB_CLASS}:hover {
      background: oklch(0.26 0.006 250) !important;
      border-color: oklch(0.52 0.04 76) !important;
      color: oklch(0.95 0.025 82) !important;
    }

    ${HIDE_HEADER_SCOPE} #trade > .navigation {
      padding-top: 8px !important;
    }

    ${HEADER_OPEN_SCOPE} .wrapper > .${TWO_COLUMN_HEADER_BACKDROP_CLASS} {
      opacity: 1 !important;
      pointer-events: auto !important;
      transform: translateY(0) !important;
    }

    ${HEADER_OPEN_SCOPE} .wrapper > #statusBar,
    ${HEADER_OPEN_SCOPE} .wrapper > .linkBack,
    ${HEADER_OPEN_SCOPE} .wrapper > .language-select {
      opacity: 1 !important;
      pointer-events: auto !important;
      transform: translateY(0) !important;
    }

    ${HEADER_OPEN_SCOPE} .wrapper > .logo {
      opacity: 1 !important;
      pointer-events: auto !important;
      transform: translate(-50%, 0) !important;
    }

    ${HEADER_OPEN_SCOPE} .wrapper > .${TWO_COLUMN_HEADER_TAB_CLASS} {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    ${ACTIVE_SCOPE} #trade {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      height: auto !important;
      margin-bottom: 0 !important;
      padding-bottom: 6px !important;
      display: grid !important;
      grid-template-columns: var(${TWO_COLUMN_WIDTH_VAR}, ${TWO_COLUMN_DEFAULT_FILTER_WIDTH}px) minmax(0, 1fr) !important;
      grid-template-rows: auto minmax(0, 1fr) !important;
      column-gap: ${TWO_COLUMN_COLUMN_GAP}px !important;
      align-items: stretch !important;
      max-width: none !important;
      width: 100% !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      position: relative !important;
    }

    ${ACTIVE_SCOPE} #trade > .navigation {
      grid-column: 1 / -1 !important;
      grid-row: 1 !important;
      display: flow-root !important;
      height: auto !important;
      margin-bottom: 6px !important;
    }

    ${ACTIVE_SCOPE} #trade > .clear,
    ${ACTIVE_SCOPE} #trade > audio,
    ${ACTIVE_SCOPE} #trade > .top-btn {
      display: none !important;
    }

    ${ACTIVE_SCOPE} #trade > .loader {
      grid-column: 2 !important;
      grid-row: 2 !important;
    }

    /* 預留給官方橫幅或頂部訊息列 */
    ${ACTIVE_SCOPE} #trade > :not(.navigation):not(.top):not(#vue3-portal):not(.clear):not(audio):not(.loader):not(.top-btn):not(.${TWO_COLUMN_TOP_BTN_CLASS}) {
      grid-column: 2 !important;
    }

    /* 左欄：不透明深色表面＋貼合剩餘視窗高度 */
    ${ACTIVE_SCOPE} #trade > .top {
      grid-column: 1 !important;
      grid-row: 2 !important;
      position: relative !important;
      top: auto !important;
      z-index: 15 !important;
      width: 100% !important;
      height: 100% !important;
      max-height: 100% !important;
      min-height: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      box-sizing: border-box !important;
      background: oklch(0.115 0.005 250) !important;
      border: 1px solid oklch(0.27 0.008 250) !important;
      overflow: visible !important;
    }

    ${ACTIVE_SCOPE} #trade > .top > .search-panel {
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      height: 100% !important;
      max-height: 100% !important;
      min-height: 0 !important;
      box-sizing: border-box !important;
    }

    /* 左欄頂部：物品名稱搜尋框與聯盟／伺服器／狀態選單（2 個或 3 個選單皆自動均分） */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) {
      flex: 0 0 auto !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 6px !important;
      width: 100% !important;
      padding: 8px !important;
      box-sizing: border-box !important;
      background: oklch(0.115 0.005 250) !important;
      border-bottom: 1px solid oklch(0.24 0.008 250) !important;
      position: relative !important;
      z-index: 6 !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-left,
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right {
      float: none !important;
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right {
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right > * {
      display: block !important;
      flex: 1 1 0 !important;
      width: auto !important;
      min-width: 0 !important;
      padding: 0 !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right .multiselect__select {
      width: 22px !important;
      padding: 4px 2px !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right .multiselect__tags {
      padding-right: 22px !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right .multiselect__single {
      display: block !important;
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right .multiselect__content-wrapper {
      min-width: max-content !important;
      width: auto !important;
      max-width: 300px !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right > :last-child .multiselect__content-wrapper {
      left: auto !important;
      right: 0 !important;
    }

    /* 左欄寬度 >= 560px 時，將搜尋框與精簡的伺服器／聯盟／交易狀態選單併回同一列，僅在極窄時才換兩列 */
    ${SINGLE_SEARCH_BAR_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) {
      flex-direction: row !important;
      align-items: center !important;
      gap: 6px !important;
    }
    ${SINGLE_SEARCH_BAR_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-left {
      flex: 1 1 0 !important;
      min-width: 170px !important;
      width: auto !important;
    }
    ${SINGLE_SEARCH_BAR_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right {
      flex: 0 1 auto !important;
      width: auto !important;
      max-width: 65% !important;
    }
    ${SINGLE_SEARCH_BAR_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right > * {
      flex: 0 1 auto !important;
      min-width: 96px !important;
      max-width: 132px !important;
    }

    /* 左欄主體：不透明底色＋GPU 合成層獨立捲動；底部保留足夠留白方便最下方詞綴選單展開 */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar.search-advanced,
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar.search-advanced.search-advanced-hidden {
      display: block !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      height: auto !important;
      max-height: none !important;
      width: 100% !important;
      background: oklch(0.115 0.005 250) !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain !important;
      contain: paint !important;
      will-change: scroll-position !important;
      padding: 8px 8px clamp(280px, 42vh, 460px) !important;
      box-sizing: border-box !important;
      scrollbar-width: thin !important;
      scrollbar-color: oklch(0.36 0.01 250) transparent !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-advanced-items {
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
      width: 100% !important;
      height: auto !important;
      padding: 0 !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-advanced-pane.blue,
    ${ACTIVE_SCOPE} #trade > .top .search-advanced-pane.brown {
      float: none !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      box-sizing: border-box !important;
    }

    /* 單欄堆疊時維持官網預設順序（屬性過濾在上、詞綴篩選在下），加細分隔線區隔兩區 */
    ${ACTIVE_SCOPE} #trade > .top .search-advanced-pane + .search-advanced-pane {
      padding-top: 8px !important;
      border-top: 1px solid oklch(0.24 0.008 250) !important;
    }

    /* 以物易物（/exchange）單欄堆疊時，攤平兩側 pane 並將「賣家篩選（.filter-group.blue）」置底，排成：想要 → 持有 → 賣家篩選 */
    ${ACTIVE_SCOPE} #trade > .top .search-advanced-items.exchange > .search-advanced-pane {
      display: contents !important;
    }
    ${ACTIVE_SCOPE} #trade > .top .search-advanced-items.exchange .filter-group {
      width: 100% !important;
      margin: 0 !important;
      box-sizing: border-box !important;
    }
    ${ACTIVE_SCOPE} #trade > .top .search-advanced-items.exchange > .search-advanced-pane:nth-child(2) > .filter-group {
      padding-top: 8px !important;
      border-top: 1px solid oklch(0.24 0.008 250) !important;
    }
    ${ACTIVE_SCOPE} #trade > .top .search-advanced-items.exchange .filter-group.blue {
      order: 2 !important;
      padding-top: 8px !important;
      border-top: 1px solid oklch(0.24 0.008 250) !important;
    }

    /* 左欄拉寬至 >= 920px 時，自動恢復「左屬性過濾（藍區）＋右詞綴篩選（棕區）」或以物易物「左想要＋賣家／右持有」雙區並排 */
    ${WIDE_FILTERS_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right > * {
      max-width: 156px !important;
    }
    ${WIDE_FILTERS_SCOPE} #trade > .top .search-advanced-items {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
      gap: 12px !important;
      align-items: start !important;
    }
    ${WIDE_FILTERS_SCOPE} #trade > .top .search-advanced-pane + .search-advanced-pane {
      padding-top: 0 !important;
      border-top: none !important;
    }
    ${WIDE_FILTERS_SCOPE} #trade > .top .search-advanced-items.exchange > .search-advanced-pane {
      display: flex !important;
      gap: 10px !important;
    }
    ${WIDE_FILTERS_SCOPE} #trade > .top .search-advanced-items.exchange > .search-advanced-pane:nth-child(2) > .filter-group,
    ${WIDE_FILTERS_SCOPE} #trade > .top .search-advanced-items.exchange .filter-group.blue {
      order: 0 !important;
      padding-top: 0 !important;
      border-top: none !important;
    }

    /* 左欄較窄時（< 460px）將藍區雙欄屬性列與以物易物賣家篩選改為單欄避免輸入框過擠 */
    ${NARROW_FILTERS_SCOPE} #trade > .top .search-advanced-pane.blue .filter.filter-padded,
    ${NARROW_FILTERS_SCOPE} #trade > .top .search-advanced-items.exchange .filter-group.blue .filter.filter-property {
      width: 100% !important;
      flex: 0 0 100% !important;
      float: none !important;
      margin-left: 0 !important;
    }

    /* 左欄底部固定操作列：極窄（< 480px）時精簡為 2 列（[搜尋][清除] + [啟動線上搜尋][送入主控台]），不佔 3 列 */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls {
      flex: 0 0 auto !important;
      display: flex !important;
      flex-direction: row !important;
      flex-wrap: wrap !important;
      align-items: center !important;
      gap: 6px !important;
      width: 100% !important;
      padding: 8px !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      background: oklch(0.11 0.005 250) !important;
      border-top: 1px solid oklch(0.25 0.008 250) !important;
      position: relative !important;
      z-index: 4 !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls > .clear {
      display: none !important;
    }

    /* 將官網三段容器透明化，讓按鈕依寬度直接精準排成 1 列或 2 列 */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .controls-left,
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .controls-center,
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .controls-right {
      display: contents !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .search-btn {
      order: 0 !important;
      flex: 1 1 calc(100% - 88px) !important;
      width: auto !important;
      min-width: 120px !important;
      margin: 0 !important;
      white-space: nowrap !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .clear-btn {
      order: 1 !important;
      flex: 0 0 auto !important;
      width: auto !important;
      min-width: 64px !important;
      margin: 0 !important;
      padding-inline: 12px !important;
      white-space: nowrap !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .livesearch-btn {
      order: 2 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      flex: 1 1 120px !important;
      width: auto !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding-inline: 10px !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .livesearch-btn > span:not(.plus) {
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .livesearch-btn .plus {
      flex: 0 0 auto !important;
      float: none !important;
      margin: 0 !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .poexd-send-to-console-btn {
      order: 3 !important;
      flex: 1 1 100px !important;
      width: auto !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding-inline: 10px !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    /* 左欄寬度 >= 480px 時，全部底部操作按鈕直接併成精簡單排 */
    ${SINGLE_CONTROLS_SCOPE} #trade > .top .search-panel > .controls {
      flex-wrap: nowrap !important;
    }
    ${SINGLE_CONTROLS_SCOPE} #trade > .top .search-panel > .controls .livesearch-btn {
      order: 0 !important;
      flex: 0 1 auto !important;
    }
    ${SINGLE_CONTROLS_SCOPE} #trade > .top .search-panel > .controls .poexd-send-to-console-btn {
      order: 1 !important;
      flex: 0 1 auto !important;
    }
    ${SINGLE_CONTROLS_SCOPE} #trade > .top .search-panel > .controls .search-btn {
      order: 2 !important;
      flex: 1 1 110px !important;
      min-width: 84px !important;
    }
    ${SINGLE_CONTROLS_SCOPE} #trade > .top .search-panel > .controls .clear-btn {
      order: 3 !important;
      flex: 0 0 auto !important;
    }

    /* 雙欄模式下改由分隔線上的收合按鈕控制整個左側篩選欄，隱藏官網原本的上下展開／收合鈕 */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .toggle-search-btn {
      display: none !important;
    }

    /* 右欄：不透明底色＋GPU 合成層獨立捲動的搜尋結果區 */
    ${ACTIVE_SCOPE} #trade > #vue3-portal {
      display: contents !important;
    }

    ${ACTIVE_SCOPE} #trade .results {
      grid-column: 2 !important;
      grid-row: 2 !important;
      min-width: 0 !important;
      min-height: 0 !important;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: 100% !important;
      margin: 0 !important;
      padding-right: 4px !important;
      box-sizing: border-box !important;
      background: oklch(0.08 0.004 250) !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain !important;
      contain: paint !important;
      will-change: scroll-position !important;
      scrollbar-width: thin !important;
      scrollbar-color: oklch(0.36 0.01 250) transparent !important;
    }

    /* 結果頂部總數／排序／看板列：純不透明深色底（避免毛玻璃濾鏡重繪），滿寬固定於右欄頂端 */
    ${ACTIVE_SCOPE} #trade .results > .row.row-total {
      position: sticky !important;
      top: 0 !important;
      z-index: 12 !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      background: oklch(0.115 0.005 250) !important;
      border-bottom: 1px solid oklch(0.24 0.008 250) !important;
    }

    ${ACTIVE_SCOPE} #trade .results > .controls {
      width: 100% !important;
      max-width: 1520px !important;
      margin: 0 auto 24px !important;
      box-sizing: border-box !important;
    }

    /* 沉浸模式（immersion）與以物易物（exchange）：保留官方 1520px 上限並置中 */
    ${ACTIVE_SCOPE} #trade .results:not(.compact) .resultset {
      width: 100% !important;
      max-width: 1520px !important;
      margin: 0 auto 12px !important;
    }

    /* 以物易物結果列：確保在窄右欄下三段欄位可彈性收縮不溢出 */
    ${ACTIVE_SCOPE} #trade .results .resultset.exchange > .row.exchange {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    ${ACTIVE_SCOPE} #trade .results .resultset.exchange > .row.exchange > .left,
    ${ACTIVE_SCOPE} #trade .results .resultset.exchange > .row.exchange > .middle,
    ${ACTIVE_SCOPE} #trade .results .resultset.exchange > .row.exchange > .right {
      min-width: 0 !important;
    }

    /* 單欄 compact：強制維持 1 列 1 張卡片（防止寬螢幕超過 1840px 時 flex-wrap 誤折成 2 欄） */
    ${buildSingleColumnResultsetCss(`${ACTIVE_SCOPE} #trade .results.compact:not(.two) .resultset`)}

    /* 雙欄 compact-two：還原官方原生 flex-wrap 等高對齊與 1520px 上限（單卡 50%、最高 760px） */
    ${WIDE_RESULTS_SCOPE} #trade .results.two .resultset {
      display: flex !important;
      flex-direction: row !important;
      flex-wrap: wrap !important;
      align-items: stretch !important;
      width: 100% !important;
      max-width: 1520px !important;
      margin: 0 auto 12px !important;
    }
    ${WIDE_RESULTS_SCOPE} #trade .results.two .resultset > .row {
      flex: 0 0 50% !important;
      width: 50% !important;
      max-width: 760px !important;
      box-sizing: border-box !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }

    /* 右欄窄於 1060px 時，compact-two 自動退回單欄避免卡片過擠 */
    ${NARROW_RESULTS_SCOPE} #trade .results.two .resultset {
      display: flex !important;
      flex-direction: column !important;
      flex-wrap: nowrap !important;
      align-items: center !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 0 12px !important;
    }
    ${NARROW_RESULTS_SCOPE} #trade .results.two .resultset > .row {
      flex: 0 0 auto !important;
      width: 100% !important;
      max-width: 920px !important;
      box-sizing: border-box !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    /* 右下角「回到結果頂端」按鈕（市集原生暗黑方角＋暖金風格，不跟隨 PoeXD 主題） */
    ${ACTIVE_SCOPE} #trade > .${TWO_COLUMN_TOP_BTN_CLASS} {
      position: absolute !important;
      right: 18px !important;
      bottom: 18px !important;
      z-index: 26 !important;
      width: 32px !important;
      height: 32px !important;
      padding: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 0 !important;
      border: 1px solid oklch(0.387 0 0) !important;
      background: oklch(0.245 0.006 250 / 0.96) !important;
      color: oklch(0.858 0.068 82.8) !important;
      box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05), 0 4px 12px oklch(0 0 0 / 0.5) !important;
      cursor: pointer !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transform: translateY(8px) !important;
      transition: opacity 0.14s ease, transform 0.14s ease, background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease !important;
    }

    ${ACTIVE_SCOPE} #trade > .${TWO_COLUMN_TOP_BTN_CLASS}[data-visible="true"] {
      opacity: 1 !important;
      pointer-events: auto !important;
      transform: translateY(0) !important;
    }

    ${ACTIVE_SCOPE} #trade > .${TWO_COLUMN_TOP_BTN_CLASS}:hover {
      background: oklch(0.295 0.006 250) !important;
      border-color: oklch(0.52 0.04 76) !important;
      color: oklch(0.95 0.025 82) !important;
    }

    /* 分隔線拖曳拉桿與收合按鈕（市集原生暗黑方角＋暖金風格） */
    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS} {
      position: absolute !important;
      top: 0 !important;
      right: -${Math.floor(TWO_COLUMN_COLUMN_GAP / 2) + 4}px !important;
      width: ${TWO_COLUMN_COLUMN_GAP + 4}px !important;
      height: 100% !important;
      cursor: col-resize !important;
      z-index: 25 !important;
      display: flex !important;
      align-items: flex-start !important;
      justify-content: center !important;
      touch-action: none !important;
    }

    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS}::before {
      content: '' !important;
      position: absolute !important;
      top: 0 !important;
      bottom: 0 !important;
      left: 50% !important;
      width: 2px !important;
      transform: translateX(-50%) !important;
      background: transparent !important;
      transition: background-color 0.15s ease !important;
    }

    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS}:hover::before,
    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS}[data-resizing="true"]::before {
      background: oklch(0.654 0.055 78 / 0.85) !important;
    }

    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS} > .${TWO_COLUMN_COLLAPSE_BTN_CLASS} {
      position: relative !important;
      margin-top: 8px !important;
      width: 20px !important;
      height: 36px !important;
      padding: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 0 !important;
      border: 1px solid oklch(0.387 0 0) !important;
      background: oklch(0.245 0.006 250 / 0.96) !important;
      color: oklch(0.858 0.068 82.8) !important;
      cursor: pointer !important;
      box-shadow: 0 2px 6px oklch(0 0 0 / 0.45) !important;
      transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease !important;
      z-index: 2 !important;
    }

    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS} > .${TWO_COLUMN_COLLAPSE_BTN_CLASS}:hover {
      background: oklch(0.295 0.006 250) !important;
      border-color: oklch(0.52 0.04 76) !important;
      color: oklch(0.95 0.025 82) !important;
    }

    /* 左側篩選欄收合狀態：縮成滿高窄直條，結果區幾乎吃滿全寬 */
    ${COLLAPSED_SCOPE} #trade > .top {
      width: ${TWO_COLUMN_COLLAPSED_WIDTH}px !important;
      height: 100% !important;
      overflow: visible !important;
    }

    ${COLLAPSED_SCOPE} #trade > .top > .search-panel {
      display: none !important;
    }

    ${COLLAPSED_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS} {
      inset: 0 !important;
      right: 0 !important;
      width: 100% !important;
      cursor: pointer !important;
    }

    ${COLLAPSED_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS}::before {
      display: none !important;
    }

    ${COLLAPSED_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS} > .${TWO_COLUMN_COLLAPSE_BTN_CLASS} {
      margin-top: 8px !important;
      width: 22px !important;
      height: 36px !important;
    }
  `;
}
