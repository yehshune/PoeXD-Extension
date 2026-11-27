/**
 * 統一管理所有 9 個結果增強 `<style>` 註冊與清理。
 *
 * 顏色一律用 oklch()（主題契約不允許原始 hex 色碼）。
 * 清理一律透過 `removeTradeResultStyle` 保護導覽示意結果列。
 */
import { RESULT_MOD_ENGLISH_SUBTITLE_CLASS } from '@/utils/market-result-translator';
import { PAGE_GUIDE_REVEAL_ATTR } from '@/utils/page-guide-reveal';
import { buildResultModHighlightCss } from '@/utils/result-mod-highlight';
import { removeTradeResultStyle } from '@/utils/trade-results-root';
import { SIMILAR_SEARCH_RESULT_CSS } from './similar-search-styles';

export const RESULT_LEFT_ACTIONS_CLASS = 'poexd-left-actions';
export const RESULT_LEFT_ACTION_BUTTON_CLASS = 'poexd-left-actions-btn';
export const RESULT_PIN_BUTTON_CLASS = 'poexd-pin-btn';
export const RESULT_PINNED_ROW_CLASS = 'poexd-row-pinned';
export const RESULT_POB_COPY_BUTTON_CLASS = 'poexd-pob-copy-btn';
export const RESULT_EXTERNAL_LINKS_CLASS = 'poexd-result-links';
export const RESULT_EXTERNAL_LINK_BUTTON_CLASS = 'poexd-result-link-btn';
export const RESULT_MOD_QUICK_FILTER_HOST_CLASS = 'poexd-result-mod-host';
export const RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS = 'poexd-result-mod-actions';
export const RESULT_MOD_QUICK_FILTER_BUTTON_CLASS = 'poexd-result-mod-btn';
export const RESULT_MOD_QUICK_FILTER_GROUP_ATTR = 'data-poexd-quick-group';

/** Lucide `pin` 的 path（與 Sidebar 導覽列的 `Pin` 圖示相同；注入頁面的 DOM 不能用 Vue 元件） */
export const PIN_ICON_PATHS = [
  'M12 17v5',
  'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
] as const;

const PIN_ICON_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${PIN_ICON_PATHS.map((d) => `<path d='${d}'/>`).join('')}</svg>`,
)}")`;

const LEGACY_NORMALIZER_STYLE_ID = 'poexd-normalized-stats-style';

export type ResultEnhancementStyleKey =
  | 'left-actions'
  | 'pin'
  | 'pob-copy'
  | 'similar-search'
  | 'external-links'
  | 'mod-highlight'
  | 'mod-quick-filter'
  | 'price-comparison'
  | 'item-normalizer'
  | 'sort-controls';

interface StyleEntry {
  readonly id: string;
  readonly content: string;
  readonly legacyIds?: readonly string[];
}

const STYLE_REGISTRY: Record<ResultEnhancementStyleKey, StyleEntry> = {
  'left-actions': {
    id: 'poexd-result-left-actions-style',
    content: `
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
      .row[${PAGE_GUIDE_REVEAL_ATTR}] .${RESULT_LEFT_ACTIONS_CLASS},
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
    `,
  },
  pin: {
    id: 'poexd-result-pin-style',
    content: `
      .${RESULT_PIN_BUTTON_CLASS} {
        order: 0 !important;
        color: oklch(0.858 0.068 82.8) !important;
      }

      .${RESULT_PIN_BUTTON_CLASS}:hover,
      .${RESULT_PIN_BUTTON_CLASS}[aria-pressed='true'] {
        border-color: oklch(0.58 0.08 82.8) !important;
      }

      /* 已釘選時圖示填滿 */
      .${RESULT_PIN_BUTTON_CLASS}[aria-pressed='true'] svg {
        fill: currentColor;
      }

      /*
       * 標記掛在物品圖示容器上：官方已經使用 \`.left::after\`，覆寫它會讓官方 hover 按鈕位移；
       * \`.iconContainer\` 本身是 relative，官方也沒有使用它的偽元素
       */
      .row.${RESULT_PINNED_ROW_CLASS} > .left .iconContainer::after {
        content: '';
        position: absolute;
        right: 0;
        bottom: 0;
        z-index: 1;
        width: 14px;
        height: 14px;
        background-color: oklch(0.858 0.068 82.8);
        -webkit-mask: ${PIN_ICON_MASK} center / contain no-repeat;
        mask: ${PIN_ICON_MASK} center / contain no-repeat;
        pointer-events: none;
      }
    `,
  },
  'similar-search': {
    id: 'poexd-result-similar-search-style',
    content: SIMILAR_SEARCH_RESULT_CSS,
  },
  'pob-copy': {
    id: 'poexd-result-pob-copy-style',
    content: `
      .${RESULT_POB_COPY_BUTTON_CLASS} {
        order: 1 !important;
        color: oklch(0.858 0.068 82.8) !important;
      }

      .${RESULT_POB_COPY_BUTTON_CLASS}:hover {
        border-color: oklch(0.58 0.08 82.8) !important;
      }
    `,
  },
  'external-links': {
    id: 'poexd-result-external-links-style',
    content: `
      .${RESULT_EXTERNAL_LINKS_CLASS} {
        order: 2 !important;
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
        margin: 0 !important;
      }

      .${RESULT_EXTERNAL_LINK_BUTTON_CLASS} {
        color: oklch(0.82 0.03 240) !important;
      }

      .${RESULT_EXTERNAL_LINK_BUTTON_CLASS}:hover {
        border-color: oklch(0.58 0.06 240) !important;
      }
    `,
  },
  'mod-highlight': {
    id: 'poexd-filter-mod-highlight-style',
    content: buildResultModHighlightCss(),
  },
  'mod-quick-filter': {
    id: 'poexd-result-mod-quick-filter-style',
    content: `
      .${RESULT_MOD_QUICK_FILTER_HOST_CLASS} {
        position: relative !important;
      }

      .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS} {
        position: absolute !important;
        right: 6px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        z-index: 6 !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        padding: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease;
      }

      .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:hover > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS},
      .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}[${PAGE_GUIDE_REVEAL_ATTR}] > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS} {
        opacity: 1 !important;
        pointer-events: auto !important;
      }

      .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:has(> .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}) > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS} {
        top: 0 !important;
        transform: none !important;
      }

      #trade .results.compact .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:has(> .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}) > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS} {
        top: -1px !important;
      }

      #trade .results:not(.compact) .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:has(> .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}) > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS} {
        top: 1.5px !important;
      }

      #trade .results.compact .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:hover > .lc.l,
      #trade .results.compact .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}[${PAGE_GUIDE_REVEAL_ATTR}] > .lc.l {
        right: 112px !important;
      }

      #trade .results:not(.compact) .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:hover > .lc.r,
      #trade .results:not(.compact) .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}[${PAGE_GUIDE_REVEAL_ATTR}] > .lc.r {
        right: 112px !important;
      }

      .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS} {
        appearance: none !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 19px !important;
        padding: 0 6px !important;
        border-radius: 0 !important;
        border: 1px solid oklch(0.387 0 0) !important;
        background: oklch(0.252 0 0 / 0.96) !important;
        color: oklch(0.858 0.068 82.8) !important;
        box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.06) !important;
        font-family: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif !important;
        font-size: 11px !important;
        font-weight: 400 !important;
        line-height: 1 !important;
        letter-spacing: 0.03em !important;
        cursor: pointer !important;
        white-space: nowrap !important;
        transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease !important;
      }

      .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${RESULT_MOD_QUICK_FILTER_GROUP_ATTR}="and"] {
        background: oklch(0.285 0.055 246 / 0.96) !important;
        border-color: oklch(0.45 0.075 268) !important;
        color: oklch(0.913 0 0) !important;
      }

      .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${RESULT_MOD_QUICK_FILTER_GROUP_ATTR}="and"]:hover:not(:disabled) {
        background: oklch(0.345 0.075 246) !important;
        border-color: oklch(0.58 0.08 260) !important;
        color: oklch(0.96 0.03 83) !important;
      }

      .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${RESULT_MOD_QUICK_FILTER_GROUP_ATTR}="not"] {
        background: oklch(0.255 0.052 20 / 0.96) !important;
        border-color: oklch(0.43 0.082 22) !important;
        color: oklch(0.89 0.04 80) !important;
      }

      .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${RESULT_MOD_QUICK_FILTER_GROUP_ATTR}="not"]:hover:not(:disabled) {
        background: oklch(0.325 0.078 20) !important;
        border-color: oklch(0.56 0.105 22) !important;
        color: oklch(0.96 0.03 83) !important;
      }

      .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}:disabled {
        opacity: 0.55 !important;
        cursor: progress !important;
      }
    `,
  },
  'price-comparison': {
    id: 'poexd-price-comparison-style',
    content: `
      .poexd-price-comparison {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        padding: 5px 10px !important;
        margin: 4px 0 !important;
        /* 結果列價格換算維持原本預設外觀，不隨擴充主題變色 */
        background-color: oklch(0.2393 0 0);
        border: 1px solid oklch(0.3715 0 0);
        font-size: 14px !important;
        line-height: 1.25 !important;
        white-space: nowrap;
      }
      .poexd-price-comparison-icon {
        display: block !important;
        width: 24px !important;
        height: 24px !important;
        flex-shrink: 0 !important;
        object-fit: contain !important;
      }
      .results.compact .poexd-price-comparison {
        display: inline-flex !important;
        gap: 4px !important;
        height: 20px !important;
        padding: 0 6px !important;
        margin: 0 6px 0 0 !important;
        font-size: 11px !important;
        line-height: 1 !important;
      }
      .results.compact .poexd-price-comparison-icon {
        width: 16px !important;
        height: 16px !important;
      }
    `,
  },
  'item-normalizer': {
    id: 'poexd-normalized-stats-style-v2',
    legacyIds: [LEGACY_NORMALIZER_STYLE_ID],
    content: `
      .poexd-left-badges .poexd-additional {
        --poexd-fx-surface: oklch(0.235 0.005 250 / 0.96);
        --poexd-fx-border: oklch(0.387 0 0);
        --poexd-fx-fg: oklch(0.913 0 0);
        --poexd-fx-label: oklch(0.76 0.028 78);
        --poexd-fx-warn: oklch(0.52 0.075 72);
        --poexd-fx-warn-bg: oklch(0.28 0.045 72 / 0.65);
        --poexd-fx-warn-fg: oklch(0.858 0.068 82.8);
        --poexd-fx-radius: 0px;
        --poexd-fx-font: Verdana, Arial, Helvetica, sans-serif;
      }

      /* 圖片下方（.left）的打孔潛力標籤列：置中排版於物品圖示下方 */
      .poexd-left-badges {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        width: 100%;
      }
      .poexd-left-badges:empty {
        display: none;
      }

      /* PoeXD 打孔標籤：比照官方 .btn-xs / 詞綴面板風格 */
      .poexd-left-badges .poexd-additional {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        box-sizing: border-box;
        height: 20px;
        margin: 0;
        padding: 0 7px;
        background: var(--poexd-fx-surface);
        border: 1px solid var(--poexd-fx-border);
        border-radius: var(--poexd-fx-radius);
        color: var(--poexd-fx-label);
        font-family: var(--poexd-fx-font);
        font-size: 11.5px;
        font-style: normal;
        font-weight: 400;
        line-height: 18px;
        letter-spacing: 0;
        text-transform: none;
        text-decoration: none !important;
        vertical-align: middle;
        white-space: nowrap;
        cursor: default;
        box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
        transition:
          background-color 0.12s ease,
          border-color 0.12s ease,
          color 0.12s ease;
      }
      .poexd-left-badges .poexd-additional.poexd-socket-warn {
        border-color: oklch(0.47 0.068 72);
      }
      .poexd-left-badges .poexd-additional.poexd-socket-warn:hover {
        background: var(--poexd-fx-warn-bg);
        border-color: var(--poexd-fx-warn);
        color: var(--poexd-fx-fg);
      }
      .poexd-left-badges .poexd-additional.poexd-socket-warn .colourDefault {
        color: var(--poexd-fx-warn-fg) !important;
        font-weight: 700;
        margin-left: 2px;
      }

      /* 官方 .itemPopupAdditional 行內符文覆寫附註：移除官方 span::before 冒號，並依版型區分浮層與橫列排版 */
      .results .row .middle .itemPopupAdditional .s .poexd-inline-override::before,
      .results .row .middle .itemPopupAdditional .s .poexd-inline-override *::before {
        content: none !important;
      }
      .results .row .middle .itemPopupAdditional .poexd-inline-override {
        display: inline-flex;
        align-items: baseline;
        gap: 2px;
        margin-left: 4px;
        font-size: 0.92em;
        font-weight: 700;
        color: oklch(0.71 0.145 274);
        white-space: nowrap;
      }
      .results .row .middle .itemPopupAdditional .poexd-inline-arrow {
        font-size: 0.85em;
        opacity: 0.85;
      }

      /* Compact / Compact Two 版型（右上角浮層）：維持原有垂直行數，依內容向右對齊展開 */
      .results.compact .row .middle .itemPopupAdditional:has(.poexd-inline-override) {
        width: max-content;
        max-width: min(260px, 68%);
        align-items: flex-end;
      }
      .results.compact .row .middle .itemPopupAdditional > .s:has(.poexd-inline-override) {
        display: inline-flex;
        align-items: baseline;
        justify-content: flex-end;
        flex-wrap: nowrap;
        width: auto;
        white-space: nowrap;
      }

      /* Default 版型（下方橫列）：保留全寬橫列，讓含覆寫的欄位依內容擴展寬度避免相鄰重疊 */
      .results:not(.compact) .row .middle .itemPopupAdditional:has(.poexd-inline-override) {
        flex-wrap: wrap;
        gap: 4px 6px;
      }
      .results:not(.compact) .row .middle .itemPopupAdditional > .s:has(.poexd-inline-override) {
        flex: 0 1 auto;
        min-width: 20%;
        width: auto;
        padding: 0 6px;
        white-space: nowrap;
      }
    `,
  },
  'sort-controls': {
    id: 'poexd-result-sort-controls-style',
    content: `
      .poexd-total-controls {
        --poexd-fx-bg: oklch(0.19 0.005 250 / 0.92);
        --poexd-fx-surface: oklch(0.235 0.005 250 / 0.96);
        --poexd-fx-surface-hover: oklch(0.295 0.006 250);
        --poexd-fx-border: oklch(0.387 0 0);
        --poexd-fx-border-strong: oklch(0.52 0.04 76);
        --poexd-fx-fg: oklch(0.913 0 0);
        --poexd-fx-gold: oklch(0.858 0.068 82.8);
        --poexd-fx-muted: oklch(0.67 0.048 76);
        --poexd-fx-primary: oklch(0.45 0.075 268);
        --poexd-fx-primary-bg: oklch(0.295 0.062 246 / 0.96);
        --poexd-fx-primary-bg-hover: oklch(0.345 0.075 246);
        --poexd-fx-accent-fg: oklch(0.95 0.025 82);
        --poexd-fx-radius: 0px;
        --poexd-fx-font: Verdana, Arial, Helvetica, sans-serif;
        --poexd-fx-font-display: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif;
        --poexd-native-btn-size: 30px;
        --poexd-native-btn-top: 0px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        z-index: 50;
        margin: 0 12px 0 0;
        flex-shrink: 0;
        font-family: var(--poexd-fx-font);
        line-height: 1;
      }
      .row.row-total > .poexd-total-controls {
        position: absolute;
        top: var(--poexd-native-btn-top);
        left: 8px;
        height: var(--poexd-native-btn-size);
        margin: 0;
      }
      .poexd-total-controls .poexd-btn-wrapper {
        position: relative;
        display: inline-flex;
        align-items: center;
        height: 100%;
      }
      .poexd-total-controls .poexd-icon-btn {
        all: unset;
        box-sizing: border-box;
        width: var(--poexd-native-btn-size);
        height: var(--poexd-native-btn-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--poexd-fx-bg);
        border: 1px solid oklch(0.35 0.018 76 / 0.85);
        border-radius: var(--poexd-fx-radius);
        color: var(--poexd-fx-muted);
        cursor: pointer;
        box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
        transition:
          background-color 0.12s ease,
          border-color 0.12s ease,
          color 0.12s ease;
      }
      .poexd-total-controls .poexd-icon-btn:hover {
        background: var(--poexd-fx-surface-hover);
        border-color: var(--poexd-fx-border-strong);
        color: var(--poexd-fx-gold);
      }
      .poexd-total-controls .poexd-icon-btn:focus-visible {
        outline: 1px solid var(--poexd-fx-gold);
        outline-offset: 1px;
      }
      .poexd-total-controls .poexd-icon-btn.poexd-active {
        background: var(--poexd-fx-primary-bg);
        border-color: var(--poexd-fx-primary);
        color: var(--poexd-fx-gold);
      }
      .poexd-total-controls .poexd-icon-btn.poexd-active:hover {
        background: var(--poexd-fx-primary-bg-hover);
        border-color: oklch(0.58 0.085 268);
        color: var(--poexd-fx-accent-fg);
      }
      .poexd-total-controls .poexd-icon-btn svg {
        width: 15px;
        height: 15px;
        pointer-events: none;
      }
      .poexd-total-controls .poexd-popover {
        display: none;
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 220px;
        box-sizing: border-box;
        background: oklch(0.175 0.005 250 / 0.98);
        border: 1px solid var(--poexd-fx-border);
        border-radius: var(--poexd-fx-radius);
        padding: 3px;
        box-shadow: 0 8px 22px oklch(0 0 0 / 0.72);
        z-index: 99999;
        font-family: var(--poexd-fx-font);
        text-align: left;
      }
      .poexd-total-controls .poexd-popover.poexd-open {
        display: block;
      }
      .poexd-total-controls .poexd-popover-header {
        margin: 0 -3px 3px;
        padding: 5px 10px;
        font-family: var(--poexd-fx-font-display);
        font-size: 11px;
        font-weight: 400;
        line-height: 1.3;
        color: var(--poexd-fx-muted);
        border-bottom: 1px solid oklch(0.32 0.012 76 / 0.7);
        letter-spacing: 0.04em;
      }
      .poexd-total-controls .poexd-popover-item {
        padding: 5px 8px;
        border-radius: var(--poexd-fx-radius);
        font-size: 12px;
        line-height: 1.4;
        color: var(--poexd-fx-fg);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition:
          background-color 0.12s ease,
          color 0.12s ease;
        user-select: none;
        white-space: nowrap;
      }
      .poexd-total-controls .poexd-popover-item:hover {
        background: var(--poexd-fx-primary-bg);
        color: var(--poexd-fx-accent-fg);
      }
      .poexd-total-controls .poexd-popover-item.poexd-selected {
        color: var(--poexd-fx-gold);
        font-weight: 600;
      }
      .poexd-total-controls .poexd-check-mark {
        font-size: 12px;
        color: var(--poexd-fx-gold);
        font-weight: 700;
        margin-left: 12px;
      }
    `,
  },
};

const PAGE_GUIDE_STYLE_KEYS: readonly ResultEnhancementStyleKey[] = [
  'left-actions',
  'pin',
  'pob-copy',
  'external-links',
  'mod-highlight',
  'mod-quick-filter',
  'price-comparison',
];

const ALL_STYLE_KEYS: readonly ResultEnhancementStyleKey[] = Object.keys(
  STYLE_REGISTRY,
) as ResultEnhancementStyleKey[];

function resolveDoc(doc?: Document): Document | undefined {
  return doc ?? (typeof document !== 'undefined' ? document : undefined);
}

export function ensureResultEnhancementStyle(key: ResultEnhancementStyleKey, doc?: Document): void {
  const targetDoc = resolveDoc(doc);
  if (!targetDoc) return;
  const entry = STYLE_REGISTRY[key];
  if (targetDoc.getElementById(entry.id)) return;
  entry.legacyIds?.forEach((legacyId) => targetDoc.getElementById(legacyId)?.remove());
  const style = targetDoc.createElement('style');
  style.id = entry.id;
  style.textContent = entry.content;
  (targetDoc.head ?? targetDoc.documentElement)?.appendChild(style);
}

export function removeResultEnhancementStyle(key: ResultEnhancementStyleKey, doc?: Document): void {
  const targetDoc = resolveDoc(doc);
  if (!targetDoc) return;
  const entry = STYLE_REGISTRY[key];
  removeTradeResultStyle(entry.id, targetDoc);
  entry.legacyIds?.forEach((legacyId) => removeTradeResultStyle(legacyId, targetDoc));
}

export function removeAllResultEnhancementStyles(doc?: Document): void {
  for (const key of ALL_STYLE_KEYS) {
    removeResultEnhancementStyle(key, doc);
  }
}

/**
 * 一次注入導覽示意結果列所需的 7 組結果強化樣式。
 * 導覽的示意結果列在還沒搜尋過的頁面上也要長得和真的一樣。
 */
export function ensureResultEnhancementStyles(doc?: Document): void {
  for (const key of PAGE_GUIDE_STYLE_KEYS) {
    ensureResultEnhancementStyle(key, doc);
  }
}
