/**
 * 寬螢幕雙欄版面控制器（左：固定篩選欄；右：搜尋結果區）。
 *
 * 設計重點：
 * - 將外層視窗鎖定為 `100vh`（移除最外層頁面捲軸），以 CSS Grid 將 `#trade` 切成左篩選
 *   （`#trade > .top`）與右結果（`#vue3-portal > .results`），左右兩欄各自獨立捲動。
 * - 左側篩選欄上限拉寬至 `1200px`；寬度 `>= 920px` 時自動切換為官網「左屬性＋右詞綴」並排，
 *   較窄時採垂直堆疊並維持官網預設順序（屬性過濾在上、詞綴篩選在下）。
 * - 右側結果區還原官方原生版型比例：
 *   - 單欄 `compact` 強制 1 列 1 張置中卡片（最大 920px）；
 *   - 雙欄 `compact-two` 保留原生 `flex-wrap: wrap` 等高對齊與 1520px 置中上限（每卡 50% / 最高 760px），
 *     右欄窄於 1060px 時自動退回單欄；
 *   - 頂部 `.row.row-total` 解除 1520px 上限、滿寬固定於結果區頂端。
 * - 橋接右欄內部捲動至官方 `.load-more-btn`（`IntersectionObserver` + 捲動門檻 + 節流防連打），
 *   補回原本依賴 `window.scroll` 的滑底自動載入，並提供回頂端按鈕。
 * - 支援可選的「自動收合頂部官方標頭」（hover 頂部中央把手後以覆蓋層滑出，不推擠版面）與
 *   「最大整體寬度」置中限制。
 * - 所有顏色使用 `oklch()`（符合主題契約）。
 */
import { listenPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import type { TradePageRole } from '@/utils/live-search-contract';
import type { TwoColumnMaxWidth } from '@/utils/preferences-contract';
import { createSvgIcon } from '@/utils/safe-dom';
import {
  TWO_COLUMN_COLLAPSED_WIDTH,
  TWO_COLUMN_COLUMN_GAP,
  TWO_COLUMN_DEFAULT_FILTER_WIDTH,
  TWO_COLUMN_DEFAULT_MAX_WIDTH,
  TWO_COLUMN_RESULTS_SINGLE_CARD_BREAKPOINT,
  TWO_COLUMN_SINGLE_ROW_CONTROLS_BREAKPOINT,
  TWO_COLUMN_SINGLE_ROW_SEARCH_BAR_BREAKPOINT,
  TWO_COLUMN_WIDE_FILTER_BREAKPOINT,
  clampTwoColumnFilterWidth,
  resolveTwoColumnGeometry,
  type TwoColumnGeometry,
} from '@/utils/two-column-layout';
import { CONSOLE_RESULT_ONLY_ATTR } from './live-search-console-host-guard';

export const TWO_COLUMN_STYLE_ID = 'poexd-two-column-layout-style';
export const TWO_COLUMN_ATTR = 'data-poexd-two-column';
export const TWO_COLUMN_COLLAPSED_ATTR = 'data-poexd-two-column-collapsed';
export const TWO_COLUMN_HIDE_HEADER_ATTR = 'data-poexd-two-column-hide-header';
export const TWO_COLUMN_HEADER_OPEN_ATTR = 'data-poexd-two-column-header-open';
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

const OFFICIAL_HEADER_SELECTOR =
  '.wrapper > #statusBar, .wrapper > .linkBack, .wrapper > .logo, .wrapper > .language-select';
const LOAD_MORE_BTN_SELECTOR = '.results .controls .load-more-btn, .results .load-more-btn';
const LOAD_MORE_TRIGGER_MARGIN_PX = 240;
const LOAD_MORE_COOLDOWN_MS = 1200;
const SCROLL_TOP_SHOW_THRESHOLD_PX = 320;
const HEADER_OPEN_DELAY_MS = 120;
const HEADER_CLOSE_DELAY_MS = 240;

const CHEVRON_SVG_ATTRS = {
  width: '14',
  height: '14',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2.2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

const CHEVRON_LEFT_PATHS = ['m15 18-6-6 6-6'] as const;
const CHEVRON_RIGHT_PATHS = ['m9 18 6-6-6-6'] as const;
const CHEVRON_DOWN_PATHS = ['m6 9 6 6 6-6'] as const;
const CHEVRON_UP_PATHS = ['m18 15-6-6-6 6'] as const;

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

    /* 自動收合頂部官方標頭：平時騰出垂直高度，hover 中央把手時以覆蓋層往下滑出 */
    ${HIDE_HEADER_SCOPE} .wrapper > #statusBar,
    ${HIDE_HEADER_SCOPE} .wrapper > .linkBack,
    ${HIDE_HEADER_SCOPE} .wrapper > .logo,
    ${HIDE_HEADER_SCOPE} .wrapper > .language-select {
      position: absolute !important;
      z-index: 42 !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 0.18s ease, transform 0.18s ease !important;
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
      background: oklch(0.1 0.005 250 / 0.96) !important;
      backdrop-filter: blur(8px) !important;
      border-bottom: 1px solid oklch(0.32 0.015 250) !important;
      box-shadow: 0 6px 20px oklch(0 0 0 / 0.55) !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transform: translateY(-100%) !important;
      transition: opacity 0.18s ease, transform 0.18s ease !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .${TWO_COLUMN_HEADER_TAB_CLASS} {
      position: absolute !important;
      top: 0 !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      width: 120px !important;
      height: 14px !important;
      padding: 0 !important;
      margin: 0 !important;
      z-index: 43 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border: 1px solid oklch(0.32 0.012 250) !important;
      border-top: 0 !important;
      border-radius: 0 0 6px 6px !important;
      background: oklch(0.15 0.006 250 / 0.92) !important;
      color: oklch(0.74 0.03 82) !important;
      cursor: pointer !important;
      transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease !important;
    }

    ${HIDE_HEADER_SCOPE} .wrapper > .${TWO_COLUMN_HEADER_TAB_CLASS}:hover {
      background: oklch(0.24 0.012 250) !important;
      color: oklch(0.92 0.04 82) !important;
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

    /* 左欄：貼合剩餘視窗高度並獨立捲動內部篩選區 */
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
      background: oklch(0.115 0.005 250 / 0.97) !important;
      border: 1px solid oklch(0.27 0.008 250) !important;
      overflow: visible !important;
      container-type: inline-size !important;
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

    /* 左欄頂部：物品名稱搜尋框與聯盟／伺服器／狀態選單 */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) {
      flex: 0 0 auto !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 6px !important;
      width: 100% !important;
      padding: 8px !important;
      box-sizing: border-box !important;
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
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 4px !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right > * {
      display: block !important;
      width: 100% !important;
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
    @container (min-width: ${TWO_COLUMN_SINGLE_ROW_SEARCH_BAR_BREAKPOINT}px) {
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) {
        flex-direction: row !important;
        align-items: center !important;
        gap: 6px !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-left {
        flex: 1 1 0 !important;
        min-width: 170px !important;
        width: auto !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right {
        flex: 0 1 auto !important;
        width: auto !important;
        max-width: 65% !important;
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right > * {
        flex: 0 1 auto !important;
        width: auto !important;
        min-width: 96px !important;
        max-width: 132px !important;
      }
    }

    /* 左欄主體：即使按下搜尋被官網加上 .search-advanced-hidden，仍保持展開並獨立捲動；
       底部保留足夠留白，確保最下方的詞綴下拉選單展開時不必二次捲動 */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar.search-advanced,
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar.search-advanced.search-advanced-hidden {
      display: block !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      height: auto !important;
      max-height: none !important;
      width: 100% !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
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
    ${ACTIVE_SCOPE} #trade > .top .search-advanced-pane.brown {
      padding-top: 8px !important;
      border-top: 1px solid oklch(0.24 0.008 250) !important;
    }

    /* 左欄拉寬至 >= 920px 時，自動恢復「左屬性過濾（藍區）＋右詞綴篩選（棕區）」雙區並排 */
    @container (min-width: ${TWO_COLUMN_WIDE_FILTER_BREAKPOINT}px) {
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .search-bar:not(.search-advanced) .search-right > * {
        max-width: 156px !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-advanced-items {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
        gap: 12px !important;
        align-items: start !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-advanced-pane.brown {
        padding-top: 0 !important;
        border-top: none !important;
      }
    }

    /* 左欄較窄時（< 460px）將藍區雙欄屬性列改為單欄避免輸入框過擠 */
    @container (max-width: 459px) {
      ${ACTIVE_SCOPE} #trade > .top .search-advanced-pane.blue .filter.filter-padded {
        width: 100% !important;
        flex: 0 0 100% !important;
      }
    }

    /* 左欄底部固定操作列：極窄（< 520px）時精簡為 2 列（[搜尋][清除] + [啟動線上搜尋][送入主控台]），不佔 3 列 */
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
      background: oklch(0.11 0.005 250 / 0.99) !important;
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
      white-space: nowrap !important;
    }

    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .livesearch-btn .plus {
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
      white-space: nowrap !important;
    }

    /* 左欄寬度 >= 480px 時，全部底部操作按鈕直接併成精簡單排 */
    @container (min-width: ${TWO_COLUMN_SINGLE_ROW_CONTROLS_BREAKPOINT}px) {
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls {
        flex-wrap: nowrap !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .livesearch-btn {
        order: 0 !important;
        flex: 0 1 auto !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .poexd-send-to-console-btn {
        order: 1 !important;
        flex: 0 1 auto !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .search-btn {
        order: 2 !important;
        flex: 1 1 110px !important;
        min-width: 84px !important;
      }
      ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .clear-btn {
        order: 3 !important;
        flex: 0 0 auto !important;
      }
    }

    /* 雙欄模式下改由分隔線上的收合按鈕控制整個左側篩選欄，隱藏官網原本的上下展開／收合鈕 */
    ${ACTIVE_SCOPE} #trade > .top .search-panel > .controls .toggle-search-btn {
      display: none !important;
    }

    /* 右欄：獨立捲動的搜尋結果區 */
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
      overflow-y: auto !important;
      overflow-x: hidden !important;
      scrollbar-width: thin !important;
      scrollbar-color: oklch(0.36 0.01 250) transparent !important;
      container-type: inline-size !important;
    }

    /* 結果頂部總數／排序／看板列：解除官網 1520px 上限並滿寬固定於右欄頂端 */
    ${ACTIVE_SCOPE} #trade .results > .row.row-total {
      position: sticky !important;
      top: 0 !important;
      z-index: 12 !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      background: oklch(0.115 0.005 250 / 0.96) !important;
      backdrop-filter: blur(6px) !important;
      border-bottom: 1px solid oklch(0.24 0.008 250) !important;
    }

    ${ACTIVE_SCOPE} #trade .results > .controls {
      width: 100% !important;
      max-width: 1520px !important;
      margin: 0 auto 24px !important;
      box-sizing: border-box !important;
    }

    /* 沉浸模式（immersion）：保留官方 1520px 上限並置中 */
    ${ACTIVE_SCOPE} #trade .results:not(.compact) .resultset {
      width: 100% !important;
      max-width: 1520px !important;
      margin: 0 auto 12px !important;
    }

    /* 單欄 compact：強制維持 1 列 1 張卡片（防止寬螢幕超過 1840px 時 flex-wrap 誤折成 2 欄） */
    ${ACTIVE_SCOPE} #trade .results.compact:not(.two) .resultset {
      display: flex !important;
      flex-direction: column !important;
      flex-wrap: nowrap !important;
      align-items: center !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 0 12px !important;
    }

    ${ACTIVE_SCOPE} #trade .results.compact:not(.two) .resultset > .row {
      width: 100% !important;
      max-width: 920px !important;
      flex: 0 0 auto !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    /* 雙欄 compact-two：還原官方原生 flex-wrap 等高對齊與 1520px 上限（單卡 50%、最高 760px） */
    @container (min-width: ${TWO_COLUMN_RESULTS_SINGLE_CARD_BREAKPOINT}px) {
      ${ACTIVE_SCOPE} #trade .results.two .resultset {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: wrap !important;
        align-items: stretch !important;
        width: 100% !important;
        max-width: 1520px !important;
        margin: 0 auto 12px !important;
      }
      ${ACTIVE_SCOPE} #trade .results.two .resultset > .row {
        flex: 0 0 50% !important;
        width: 50% !important;
        max-width: 760px !important;
        box-sizing: border-box !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
    }

    /* 右欄窄於 1060px 時，compact-two 自動退回單欄避免卡片過擠 */
    @container (max-width: ${TWO_COLUMN_RESULTS_SINGLE_CARD_BREAKPOINT - 1}px) {
      ${ACTIVE_SCOPE} #trade .results.two .resultset {
        display: flex !important;
        flex-direction: column !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        width: 100% !important;
        max-width: none !important;
        margin: 0 0 12px !important;
      }
      ${ACTIVE_SCOPE} #trade .results.two .resultset > .row {
        flex: 0 0 auto !important;
        width: 100% !important;
        max-width: 920px !important;
        box-sizing: border-box !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }
    }

    /* 右下角「回到結果頂端」按鈕（取代依賴 window.scroll 的官方 .top-btn） */
    ${ACTIVE_SCOPE} #trade > .${TWO_COLUMN_TOP_BTN_CLASS} {
      position: absolute !important;
      right: 18px !important;
      bottom: 18px !important;
      z-index: 26 !important;
      width: 34px !important;
      height: 34px !important;
      padding: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 6px !important;
      border: 1px solid oklch(0.38 0.015 250) !important;
      background: oklch(0.16 0.008 250 / 0.94) !important;
      color: oklch(0.86 0.05 82) !important;
      box-shadow: 0 4px 12px oklch(0 0 0 / 0.45) !important;
      cursor: pointer !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transform: translateY(8px) !important;
      transition: opacity 0.16s ease, transform 0.16s ease, background-color 0.15s ease, border-color 0.15s ease !important;
    }

    ${ACTIVE_SCOPE} #trade > .${TWO_COLUMN_TOP_BTN_CLASS}[data-visible="true"] {
      opacity: 1 !important;
      pointer-events: auto !important;
      transform: translateY(0) !important;
    }

    ${ACTIVE_SCOPE} #trade > .${TWO_COLUMN_TOP_BTN_CLASS}:hover {
      background: oklch(0.24 0.012 250) !important;
      border-color: oklch(0.62 0.06 82) !important;
      color: oklch(0.96 0.03 82) !important;
    }

    /* 分隔線拖曳拉桿與收合按鈕 */
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
      background: oklch(0.68 0.07 82 / 0.8) !important;
    }

    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS} > .${TWO_COLUMN_COLLAPSE_BTN_CLASS} {
      position: sticky !important;
      top: 10px !important;
      margin-top: 8px !important;
      width: 22px !important;
      height: 36px !important;
      padding: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 4px !important;
      border: 1px solid oklch(0.36 0.015 250) !important;
      background: oklch(0.18 0.008 250 / 0.96) !important;
      color: oklch(0.84 0.04 82) !important;
      cursor: pointer !important;
      box-shadow: 0 2px 6px oklch(0 0 0 / 0.45) !important;
      transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease !important;
      z-index: 2 !important;
    }

    ${ACTIVE_SCOPE} #trade > .top > .${TWO_COLUMN_SPLITTER_CLASS} > .${TWO_COLUMN_COLLAPSE_BTN_CLASS}:hover {
      background: oklch(0.25 0.012 250) !important;
      border-color: oklch(0.62 0.06 82) !important;
      color: oklch(0.95 0.03 82) !important;
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
      width: 24px !important;
      height: 36px !important;
    }
  `;
}

export interface TwoColumnLayoutOptions {
  doc?: Document;
  win?: Window;
  now?: () => number;
  onFilterWidthCommit?: (width: number) => void;
}

export interface TwoColumnLayoutController {
  setEnabled(enabled: boolean): void;
  setPageRole(role: TradePageRole): void;
  setPreferredFilterWidth(width: number): void;
  setMaxWidth(maxWidth: TwoColumnMaxWidth): void;
  setAutoHideHeader(autoHide: boolean): void;
  setFiltersCollapsed(collapsed: boolean): void;
  refreshLocale(): void;
  sync(): TwoColumnGeometry;
  cleanup(): void;
}

export function createTwoColumnLayoutController(
  options: TwoColumnLayoutOptions = {},
): TwoColumnLayoutController {
  const doc = options.doc ?? document;
  const win = options.win ?? doc.defaultView ?? window;
  const now = options.now ?? Date.now;
  const onFilterWidthCommit = options.onFilterWidthCommit;

  let enabled = false;
  let pageRole: TradePageRole = 'normal';
  let preferredFilterWidth = TWO_COLUMN_DEFAULT_FILTER_WIDTH;
  let maxWidth: TwoColumnMaxWidth = TWO_COLUMN_DEFAULT_MAX_WIDTH;
  let autoHideHeader = true;
  let filtersCollapsed = false;
  let draggingWidth: number | null = null;
  let disposed = false;

  let styleEl: HTMLStyleElement | null = null;
  let splitterEl: HTMLDivElement | null = null;
  let collapseBtnEl: HTMLButtonElement | null = null;
  let headerTabEl: HTMLButtonElement | null = null;
  let headerBackdropEl: HTMLDivElement | null = null;
  let topBtnEl: HTMLButtonElement | null = null;

  let resizeObserver: ResizeObserver | null = null;
  let observedContentEl: Element | null = null;
  let tradeObserver: MutationObserver | null = null;
  let observedTradeEl: Element | null = null;

  // 右欄內部捲動橋接（自動觸發「讀取更多」＋回頂端按鈕）
  let observedResultsEl: HTMLElement | null = null;
  let resultsScrollCleanup: (() => void) | null = null;
  let resultsMutationObserver: MutationObserver | null = null;
  let loadMoreIntersectionObserver: IntersectionObserver | null = null;
  let observedLoadMoreBtn: HTMLButtonElement | null = null;
  let hasUserScrolledResults = false;
  let lastLoadMoreClickAt = 0;

  // 頂部官方標頭自動收合 hover 狀態
  let headerOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let headerCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let headerHoverCleanups: (() => void)[] = [];

  let eventCleanups: (() => void)[] = [];
  let listenersAttached = false;
  let activeDragCleanup: (() => void) | null = null;

  const readContentWidth = (): number => {
    const content = doc.querySelector<HTMLElement>('.content');
    const measured = content?.getBoundingClientRect().width;
    if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
      return measured;
    }
    return win?.innerWidth ?? 0;
  };

  const readPathname = (): string => {
    try {
      return win?.location?.pathname ?? '';
    } catch {
      return '';
    }
  };

  const ensureStyle = () => {
    if (styleEl && styleEl.isConnected) return;
    const existing = doc.getElementById(TWO_COLUMN_STYLE_ID) as HTMLStyleElement | null;
    if (existing) {
      styleEl = existing;
      return;
    }
    styleEl = doc.createElement('style');
    styleEl.id = TWO_COLUMN_STYLE_ID;
    styleEl.textContent = buildTwoColumnLayoutCss();
    (doc.head || doc.documentElement)?.appendChild(styleEl);
  };

  const removeStyle = () => {
    styleEl?.remove();
    styleEl = null;
    doc.getElementById(TWO_COLUMN_STYLE_ID)?.remove();
  };

  const updateCollapseButtonUi = () => {
    if (!collapseBtnEl) return;
    const label = filtersCollapsed
      ? t('twoColumnLayout.expand.tooltip')
      : t('twoColumnLayout.collapse.tooltip');
    collapseBtnEl.title = label;
    collapseBtnEl.setAttribute('aria-label', label);
    collapseBtnEl.setAttribute('aria-expanded', String(!filtersCollapsed));
    collapseBtnEl.replaceChildren(
      createSvgIcon(
        {
          attrs: CHEVRON_SVG_ATTRS,
          paths: filtersCollapsed ? CHEVRON_RIGHT_PATHS : CHEVRON_LEFT_PATHS,
        },
        doc,
      ),
    );
  };

  const updateControlsLocale = () => {
    if (splitterEl) {
      const aria = t('twoColumnLayout.splitter.ariaLabel');
      splitterEl.setAttribute('aria-label', aria);
      splitterEl.title = aria;
    }
    if (headerTabEl) {
      const label = t('twoColumnLayout.headerPullTab.tooltip');
      headerTabEl.title = label;
      headerTabEl.setAttribute('aria-label', label);
    }
    if (topBtnEl) {
      const label = t('twoColumnLayout.scrollTop.tooltip');
      topBtnEl.title = label;
      topBtnEl.setAttribute('aria-label', label);
    }
    updateCollapseButtonUi();
  };

  const stopActiveDrag = () => {
    activeDragCleanup?.();
    activeDragCleanup = null;
    draggingWidth = null;
  };

  const detachSplitter = () => {
    stopActiveDrag();
    splitterEl?.remove();
    splitterEl = null;
    collapseBtnEl = null;
  };

  const clearHeaderTimers = () => {
    if (headerOpenTimer !== null) {
      clearTimeout(headerOpenTimer);
      headerOpenTimer = null;
    }
    if (headerCloseTimer !== null) {
      clearTimeout(headerCloseTimer);
      headerCloseTimer = null;
    }
  };

  const setHeaderRevealed = (open: boolean) => {
    if (open) {
      doc.documentElement.setAttribute(TWO_COLUMN_HEADER_OPEN_ATTR, 'true');
    } else {
      doc.documentElement.removeAttribute(TWO_COLUMN_HEADER_OPEN_ATTR);
    }
  };

  const scheduleHeaderOpen = (immediate = false) => {
    clearHeaderTimers();
    if (immediate) {
      setHeaderRevealed(true);
      return;
    }
    headerOpenTimer = setTimeout(() => {
      headerOpenTimer = null;
      if (!disposed) setHeaderRevealed(true);
    }, HEADER_OPEN_DELAY_MS);
  };

  const scheduleHeaderClose = () => {
    clearHeaderTimers();
    headerCloseTimer = setTimeout(() => {
      headerCloseTimer = null;
      if (!disposed) setHeaderRevealed(false);
    }, HEADER_CLOSE_DELAY_MS);
  };

  const detachHeaderControls = () => {
    clearHeaderTimers();
    setHeaderRevealed(false);
    headerHoverCleanups.forEach((fn) => fn());
    headerHoverCleanups = [];
    headerTabEl?.remove();
    headerTabEl = null;
    headerBackdropEl?.remove();
    headerBackdropEl = null;
  };

  const ensureHeaderControlsMounted = () => {
    if (!autoHideHeader) {
      doc.documentElement.removeAttribute(TWO_COLUMN_HIDE_HEADER_ATTR);
      detachHeaderControls();
      return;
    }

    const wrapper = doc.querySelector<HTMLElement>('.wrapper');
    if (!wrapper) {
      detachHeaderControls();
      return;
    }

    doc.documentElement.setAttribute(TWO_COLUMN_HIDE_HEADER_ATTR, 'true');
    if (headerTabEl && headerTabEl.parentElement === wrapper && headerBackdropEl?.isConnected) {
      updateControlsLocale();
      return;
    }

    detachHeaderControls();

    const backdrop = doc.createElement('div');
    backdrop.className = TWO_COLUMN_HEADER_BACKDROP_CLASS;

    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.className = TWO_COLUMN_HEADER_TAB_CLASS;
    tab.appendChild(createSvgIcon({ attrs: CHEVRON_SVG_ATTRS, paths: CHEVRON_DOWN_PATHS }, doc));

    const onTabEnter = () => scheduleHeaderOpen(false);
    const onTabClick = (event: MouseEvent) => {
      event.preventDefault();
      scheduleHeaderOpen(true);
    };
    const onOverlayEnter = () => {
      clearHeaderTimers();
      setHeaderRevealed(true);
    };
    const onOverlayLeave = () => scheduleHeaderClose();

    tab.addEventListener('pointerenter', onTabEnter);
    tab.addEventListener('pointerleave', onOverlayLeave);
    tab.addEventListener('click', onTabClick);
    backdrop.addEventListener('pointerenter', onOverlayEnter);
    backdrop.addEventListener('pointerleave', onOverlayLeave);

    const cleanups: (() => void)[] = [
      () => tab.removeEventListener('pointerenter', onTabEnter),
      () => tab.removeEventListener('pointerleave', onOverlayLeave),
      () => tab.removeEventListener('click', onTabClick),
      () => backdrop.removeEventListener('pointerenter', onOverlayEnter),
      () => backdrop.removeEventListener('pointerleave', onOverlayLeave),
    ];

    doc.querySelectorAll<HTMLElement>(OFFICIAL_HEADER_SELECTOR).forEach((el) => {
      el.addEventListener('pointerenter', onOverlayEnter);
      el.addEventListener('pointerleave', onOverlayLeave);
      cleanups.push(() => {
        el.removeEventListener('pointerenter', onOverlayEnter);
        el.removeEventListener('pointerleave', onOverlayLeave);
      });
    });

    wrapper.prepend(backdrop);
    wrapper.prepend(tab);
    headerBackdropEl = backdrop;
    headerTabEl = tab;
    headerHoverCleanups = cleanups;
    updateControlsLocale();
  };

  const detachResultsBridge = () => {
    resultsScrollCleanup?.();
    resultsScrollCleanup = null;
    resultsMutationObserver?.disconnect();
    resultsMutationObserver = null;
    loadMoreIntersectionObserver?.disconnect();
    loadMoreIntersectionObserver = null;
    observedLoadMoreBtn = null;
    observedResultsEl = null;
    hasUserScrolledResults = false;
    topBtnEl?.remove();
    topBtnEl = null;
  };

  const syncTopButtonVisibility = () => {
    if (!topBtnEl || !observedResultsEl) return;
    if (observedResultsEl.scrollTop > SCROLL_TOP_SHOW_THRESHOLD_PX) {
      topBtnEl.setAttribute('data-visible', 'true');
    } else {
      topBtnEl.removeAttribute('data-visible');
    }
  };

  const maybeTriggerLoadMore = (forceFromIntersection = false) => {
    if (disposed || !observedResultsEl || !hasUserScrolledResults) return;
    // 即時搜尋頁不需要自動點擊「讀取更多」
    if (/\/live(?:\/|$)/i.test(readPathname())) return;

    const btn = observedResultsEl.querySelector<HTMLButtonElement>(LOAD_MORE_BTN_SELECTOR);
    if (!btn || btn.disabled || btn.classList.contains('disabled')) return;
    if (btn.getAttribute('aria-disabled') === 'true') return;
    // 在真實瀏覽器環境檢查按鈕是否可見（happy-dom 的 offsetParent 可能為 null，以 style/class 輔助）
    const style = win?.getComputedStyle?.(btn);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return;

    const nearBottom =
      forceFromIntersection ||
      observedResultsEl.scrollTop + observedResultsEl.clientHeight >=
        observedResultsEl.scrollHeight - LOAD_MORE_TRIGGER_MARGIN_PX;
    if (!nearBottom) return;

    const currentTime = now();
    if (currentTime - lastLoadMoreClickAt < LOAD_MORE_COOLDOWN_MS) return;

    lastLoadMoreClickAt = currentTime;
    btn.click();
  };

  const reobserveLoadMoreButton = () => {
    if (!observedResultsEl) return;
    const btn = observedResultsEl.querySelector<HTMLButtonElement>(LOAD_MORE_BTN_SELECTOR);
    if (btn === observedLoadMoreBtn) return;

    if (observedLoadMoreBtn && loadMoreIntersectionObserver) {
      loadMoreIntersectionObserver.unobserve(observedLoadMoreBtn);
    }
    observedLoadMoreBtn = btn;
    if (btn && loadMoreIntersectionObserver) {
      loadMoreIntersectionObserver.observe(btn);
    }
  };

  const ensureResultsBridgeMounted = () => {
    const tradeEl = doc.querySelector<HTMLElement>('#trade');
    const resultsEl = doc.querySelector<HTMLElement>('#trade .results');
    if (!tradeEl || !resultsEl) {
      detachResultsBridge();
      return;
    }

    if (topBtnEl && topBtnEl.parentElement !== tradeEl) {
      topBtnEl.remove();
      topBtnEl = null;
    }
    if (!topBtnEl) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = TWO_COLUMN_TOP_BTN_CLASS;
      btn.appendChild(createSvgIcon({ attrs: CHEVRON_SVG_ATTRS, paths: CHEVRON_UP_PATHS }, doc));
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        observedResultsEl?.scrollTo({ top: 0, behavior: 'smooth' });
      });
      tradeEl.appendChild(btn);
      topBtnEl = btn;
      updateControlsLocale();
    }

    if (observedResultsEl === resultsEl) {
      reobserveLoadMoreButton();
      syncTopButtonVisibility();
      return;
    }

    resultsScrollCleanup?.();
    resultsMutationObserver?.disconnect();
    loadMoreIntersectionObserver?.disconnect();
    observedLoadMoreBtn = null;
    observedResultsEl = resultsEl;
    hasUserScrolledResults = resultsEl.scrollTop > 40;

    const handleResultsScroll = () => {
      if (disposed || !observedResultsEl) return;
      if (observedResultsEl.scrollTop > 40) {
        hasUserScrolledResults = true;
      } else if (observedResultsEl.scrollTop <= 2) {
        hasUserScrolledResults = false;
      }
      syncTopButtonVisibility();
      maybeTriggerLoadMore(false);
    };

    resultsEl.addEventListener('scroll', handleResultsScroll, { passive: true });
    resultsScrollCleanup = () => resultsEl.removeEventListener('scroll', handleResultsScroll);

    if (typeof IntersectionObserver !== 'undefined') {
      loadMoreIntersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            maybeTriggerLoadMore(true);
          }
        },
        {
          root: resultsEl,
          rootMargin: `0px 0px ${LOAD_MORE_TRIGGER_MARGIN_PX}px 0px`,
          threshold: 0,
        },
      );
    }

    if (typeof MutationObserver !== 'undefined') {
      resultsMutationObserver = new MutationObserver(() => {
        if (!disposed) reobserveLoadMoreButton();
      });
      resultsMutationObserver.observe(resultsEl, { childList: true, subtree: true });
    }

    reobserveLoadMoreButton();
    syncTopButtonVisibility();
  };

  const startResizeDrag = (event: PointerEvent) => {
    if (filtersCollapsed || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest(`.${TWO_COLUMN_COLLAPSE_BTN_CLASS}`)) return;
    event.preventDefault();

    const startX = event.clientX;
    const contentWidth = readContentWidth();
    const { clamped: startWidth } = clampTwoColumnFilterWidth(
      preferredFilterWidth,
      contentWidth,
      maxWidth,
    );
    draggingWidth = startWidth;
    splitterEl?.setAttribute('data-resizing', 'true');
    const prevCursor = doc.body?.style.cursor ?? '';
    const prevUserSelect = doc.body?.style.userSelect ?? '';
    if (doc.body) {
      doc.body.style.cursor = 'col-resize';
      doc.body.style.userSelect = 'none';
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const { clamped } = clampTwoColumnFilterWidth(
        startWidth + delta,
        readContentWidth(),
        maxWidth,
      );
      draggingWidth = clamped;
      doc.documentElement.style.setProperty(TWO_COLUMN_WIDTH_VAR, `${clamped}px`);
    };

    const finishDrag = (commit: boolean) => {
      const finalWidth = draggingWidth;
      stopActiveDrag();
      splitterEl?.removeAttribute('data-resizing');
      if (doc.body) {
        doc.body.style.cursor = prevCursor;
        doc.body.style.userSelect = prevUserSelect;
      }
      if (commit && finalWidth !== null && finalWidth !== preferredFilterWidth) {
        preferredFilterWidth = finalWidth;
        onFilterWidthCommit?.(finalWidth);
      }
      sync();
    };

    const handleUp = () => finishDrag(true);
    const handleCancel = () => finishDrag(false);

    win.addEventListener('pointermove', handleMove);
    win.addEventListener('pointerup', handleUp);
    win.addEventListener('pointercancel', handleCancel);
    activeDragCleanup = () => {
      win.removeEventListener('pointermove', handleMove);
      win.removeEventListener('pointerup', handleUp);
      win.removeEventListener('pointercancel', handleCancel);
    };
  };

  const ensureSplitterMounted = () => {
    const topEl = doc.querySelector<HTMLElement>('#trade > .top');
    if (!topEl) {
      detachSplitter();
      return;
    }
    if (splitterEl && splitterEl.parentElement === topEl) {
      updateControlsLocale();
      return;
    }
    detachSplitter();

    const splitter = doc.createElement('div');
    splitter.className = TWO_COLUMN_SPLITTER_CLASS;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'vertical');

    const collapseBtn = doc.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = TWO_COLUMN_COLLAPSE_BTN_CLASS;
    collapseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      filtersCollapsed = !filtersCollapsed;
      sync();
    });

    splitter.addEventListener('pointerdown', startResizeDrag);
    splitter.addEventListener('dblclick', (event) => {
      if ((event.target as Element | null)?.closest(`.${TWO_COLUMN_COLLAPSE_BTN_CLASS}`)) return;
      event.preventDefault();
      if (filtersCollapsed) {
        filtersCollapsed = false;
      } else {
        preferredFilterWidth = TWO_COLUMN_DEFAULT_FILTER_WIDTH;
        onFilterWidthCommit?.(TWO_COLUMN_DEFAULT_FILTER_WIDTH);
      }
      sync();
    });
    splitter.addEventListener('click', (event) => {
      if (!filtersCollapsed) return;
      if ((event.target as Element | null)?.closest(`.${TWO_COLUMN_COLLAPSE_BTN_CLASS}`)) return;
      event.preventDefault();
      filtersCollapsed = false;
      sync();
    });

    splitter.appendChild(collapseBtn);
    topEl.appendChild(splitter);
    splitterEl = splitter;
    collapseBtnEl = collapseBtn;
    updateControlsLocale();
  };

  const observeContentAndTrade = () => {
    const contentEl = doc.querySelector('.content');
    if (contentEl && contentEl !== observedContentEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => {
        if (!disposed) sync();
      });
      resizeObserver.observe(contentEl);
      observedContentEl = contentEl;
    }

    const tradeEl = doc.querySelector('#trade');
    if (tradeEl && tradeEl !== observedTradeEl && typeof MutationObserver !== 'undefined') {
      tradeObserver?.disconnect();
      tradeObserver = new MutationObserver(() => {
        if (!disposed) sync();
      });
      tradeObserver.observe(tradeEl, { childList: true });
      observedTradeEl = tradeEl;
    }
  };

  const attachListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;

    const handleSync = () => {
      if (!disposed) sync();
    };
    win.addEventListener('resize', handleSync);
    win.addEventListener('popstate', handleSync);
    const stopHistory = listenPoeEvent('poexd-history-changed', handleSync);
    const stopCollapsed = listenPoeEvent('poexd-sidebar-collapsed-changed', handleSync);
    const stopWidthPreview = listenPoeEvent('poexd-sidebar-width-preview', handleSync);

    eventCleanups = [
      () => win.removeEventListener('resize', handleSync),
      () => win.removeEventListener('popstate', handleSync),
      stopHistory,
      stopCollapsed,
      stopWidthPreview,
    ];
  };

  const detachListeners = () => {
    if (!listenersAttached) return;
    listenersAttached = false;
    eventCleanups.forEach((fn) => fn());
    eventCleanups = [];
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedContentEl = null;
    tradeObserver?.disconnect();
    tradeObserver = null;
    observedTradeEl = null;
  };

  const clearHostState = () => {
    doc.documentElement.removeAttribute(TWO_COLUMN_ATTR);
    doc.documentElement.removeAttribute(TWO_COLUMN_COLLAPSED_ATTR);
    doc.documentElement.removeAttribute(TWO_COLUMN_HIDE_HEADER_ATTR);
    doc.documentElement.removeAttribute(TWO_COLUMN_HEADER_OPEN_ATTR);
    doc.documentElement.style.removeProperty(TWO_COLUMN_WIDTH_VAR);
    doc.documentElement.style.removeProperty(TWO_COLUMN_MAX_WIDTH_VAR);
    detachSplitter();
    detachHeaderControls();
    detachResultsBridge();
  };

  const sync = (): TwoColumnGeometry => {
    if (disposed || !enabled) {
      clearHostState();
      removeStyle();
      detachListeners();
      return resolveTwoColumnGeometry({
        enabled: false,
        pageRole,
        pathname: readPathname(),
        contentWidth: 0,
        preferredFilterWidth,
        maxWidth,
        filtersCollapsed: false,
      });
    }

    attachListeners();
    observeContentAndTrade();

    const hasSearchPanel = Boolean(doc.querySelector('#trade > .top > .search-panel'));
    const geometry = resolveTwoColumnGeometry({
      enabled: enabled && hasSearchPanel,
      pageRole,
      pathname: readPathname(),
      contentWidth: readContentWidth(),
      preferredFilterWidth: draggingWidth ?? preferredFilterWidth,
      maxWidth,
      filtersCollapsed,
    });

    if (!geometry.active) {
      clearHostState();
      return geometry;
    }

    ensureStyle();
    doc.documentElement.setAttribute(TWO_COLUMN_ATTR, 'active');
    if (geometry.filtersCollapsed) {
      doc.documentElement.setAttribute(TWO_COLUMN_COLLAPSED_ATTR, 'true');
    } else {
      doc.documentElement.removeAttribute(TWO_COLUMN_COLLAPSED_ATTR);
    }
    doc.documentElement.style.setProperty(TWO_COLUMN_WIDTH_VAR, `${geometry.leftWidth}px`);
    doc.documentElement.style.setProperty(TWO_COLUMN_MAX_WIDTH_VAR, geometry.maxWidthCss);
    ensureSplitterMounted();
    ensureHeaderControlsMounted();
    ensureResultsBridgeMounted();
    return geometry;
  };

  return {
    setEnabled(nextEnabled: boolean) {
      if (nextEnabled === enabled && (nextEnabled || !styleEl)) {
        if (nextEnabled) sync();
        return;
      }
      enabled = nextEnabled;
      if (!enabled) filtersCollapsed = false;
      sync();
    },
    setPageRole(nextRole: TradePageRole) {
      if (nextRole === pageRole) return;
      pageRole = nextRole;
      sync();
    },
    setPreferredFilterWidth(width: number) {
      if (!Number.isFinite(width) || width === preferredFilterWidth) return;
      preferredFilterWidth = width;
      if (draggingWidth === null) sync();
    },
    setMaxWidth(nextMaxWidth: TwoColumnMaxWidth) {
      if (nextMaxWidth === maxWidth) return;
      maxWidth = nextMaxWidth;
      sync();
    },
    setAutoHideHeader(nextAutoHide: boolean) {
      if (nextAutoHide === autoHideHeader) return;
      autoHideHeader = nextAutoHide;
      sync();
    },
    setFiltersCollapsed(collapsed: boolean) {
      if (collapsed === filtersCollapsed) return;
      filtersCollapsed = collapsed;
      sync();
    },
    refreshLocale() {
      updateControlsLocale();
    },
    sync,
    cleanup() {
      disposed = true;
      enabled = false;
      clearHostState();
      removeStyle();
      detachListeners();
    },
  };
}
