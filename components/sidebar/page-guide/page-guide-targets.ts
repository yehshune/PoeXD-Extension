import { PAGE_GUIDE_REVEAL_ATTR } from '@/utils/page-guide-reveal';
import { PAGE_GUIDE_MOCK_ATTR, TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';

/**
 * 頁面導覽可以指到的位置。selectors 依序嘗試，取第一個畫面上看得到的元素；
 * 官方頁面改版時只需要更新這份對照表。
 */
export type PageGuideScope = 'page' | 'sidebar';
/**
 * results：要先有搜尋結果；filters：篩選面板收起時先暫時展開；
 * stat-filter：展開面板並加入一條示範詞綴
 */
export type PageGuideNeed = 'results' | 'filters' | 'stat-filter';

export interface PageGuideTarget {
  scope: PageGuideScope;
  selectors: readonly string[];
  needs?: PageGuideNeed;
}

const RESULT_ROW = `${TRADE_RESULTS_SELECTOR} .row[data-id]`;
/** 導覽的示意結果列（見 utils/trade-results-root.ts） */
const MOCK_ROW = `[${PAGE_GUIDE_MOCK_ATTR}] .row`;

export const PAGE_GUIDE_TARGETS = {
  'sidebar-panel': { scope: 'sidebar', selectors: ['.sidebar-container'] },
  'sidebar-nav': { scope: 'sidebar', selectors: ['.sidebar-nav'] },
  // 導覽中收合側欄後改指向邊緣的把手，讓使用者接著試拖曳
  'sidebar-collapse': {
    scope: 'sidebar',
    selectors: ['[data-sidebar-action="collapse"]', '[data-sidebar-action="expand"]'],
  },
  'sidebar-settings-tab': { scope: 'sidebar', selectors: ['[data-sidebar-tab="settings"]'] },
  'search-input': {
    scope: 'page',
    selectors: ['.search-left .multiselect', '.search-left input', '.search-bar'],
  },
  'affix-selector': {
    scope: 'page',
    selectors: ['.poexd-filter-select-btn', '.poexd-category-select-btn'],
    needs: 'filters',
  },
  'tier-trigger': {
    scope: 'page',
    selectors: ['[data-poexd-page-guide-demo="true"] .poexd-tier-trigger', '.poexd-tier-trigger'],
    needs: 'stat-filter',
  },
  // 導覽的示意結果列（PageGuideOfficialResult），只在結果步驟出現
  'mock-result-actions': {
    scope: 'page',
    selectors: [`${MOCK_ROW} .poexd-left-actions`, `${MOCK_ROW} .left`],
  },
  'mock-result-mods': {
    scope: 'page',
    selectors: [`${MOCK_ROW} [data-mock-mod="highlight"]`],
  },
  'mock-result-price': {
    scope: 'page',
    selectors: [`${MOCK_ROW} .price`],
  },
  // 階級步驟自動展開的 T 階清單
  'tier-menu': {
    scope: 'sidebar',
    selectors: ['[data-slot="dropdown-menu-content"][data-state="open"]'],
  },
  'result-price': {
    scope: 'page',
    selectors: [`${RESULT_ROW} .poexd-price-comparison`, `${RESULT_ROW} .price`],
    needs: 'results',
  },
  'result-mod-highlight': {
    scope: 'page',
    selectors: [
      `${TRADE_RESULTS_SELECTOR} .poexd-filter-mod-highlight`,
      `${RESULT_ROW} [data-field^="stat."]`,
    ],
    needs: 'results',
  },
  'result-mod': {
    scope: 'page',
    selectors: [
      `${RESULT_ROW} .poexd-result-mod-host[${PAGE_GUIDE_REVEAL_ATTR}] > .poexd-result-mod-actions`,
      `${RESULT_ROW} .poexd-result-mod-actions`,
      `${RESULT_ROW} [data-field^="stat."]`,
    ],
    needs: 'results',
  },
  'result-pob-copy': {
    scope: 'page',
    selectors: [`${RESULT_ROW} .poexd-pob-copy-btn`],
    needs: 'results',
  },
  'result-external-links': {
    scope: 'page',
    selectors: [`${RESULT_ROW} .poexd-result-link-btn`],
    needs: 'results',
  },
  'result-normalizer': {
    scope: 'page',
    selectors: [`${RESULT_ROW} .poexd-left-badges`, `${RESULT_ROW} .left`],
    needs: 'results',
  },
  'result-mod-en': {
    scope: 'page',
    selectors: [
      `${TRADE_RESULTS_SELECTOR} .poexd-result-mod-en`,
      `${RESULT_ROW} [data-field^="stat."]`,
    ],
    needs: 'results',
  },
} as const satisfies Record<string, PageGuideTarget>;

export type PageGuideTargetId = keyof typeof PAGE_GUIDE_TARGETS;

export function getPageGuideTarget(id: PageGuideTargetId): PageGuideTarget {
  return PAGE_GUIDE_TARGETS[id];
}

function isScrollableOverflow(value: string): boolean {
  return value === 'auto' || value === 'scroll';
}

function clipsAxis(value: string): boolean {
  return Boolean(value && value !== 'visible');
}

/**
 * 寬高大於零、而且沒有被無法捲動的父層整個裁切掉。
 * - 官方收起篩選面板（height: 0; overflow: hidden）或雙欄收合左欄（width: 0; overflow: hidden）會回傳 false。
 * - 若祖先是可捲動容器（例如雙欄模式的 `.search-advanced` 為 `overflow-y: auto`），
 *   即使目標目前位於捲動視窗外、且外層 `#trade`/`body` 為 `overflow: hidden`，
 *   只要該可捲動容器本身有可視尺寸，目標仍可經由 `scrollIntoView()` 捲進畫面，因此視為可見。
 */
function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let top = rect.top;
  let bottom = rect.bottom;
  let left = rect.left;
  let right = rect.right;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflowX = style.overflowX || style.overflow;
    const overflowY = style.overflowY || style.overflow;
    const clipX = clipsAxis(overflowX);
    const clipY = clipsAxis(overflowY);
    if (!clipX && !clipY) continue;
    const clip = node.getBoundingClientRect();

    if (clipY) {
      if (clip.bottom <= clip.top) return false;
      if (isScrollableOverflow(overflowY)) {
        if (bottom <= clip.top || top >= clip.bottom) {
          top = clip.top;
          bottom = clip.bottom;
        } else {
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
      } else {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
        if (bottom <= top) return false;
      }
    }

    if (clipX) {
      if (clip.right <= clip.left) return false;
      if (isScrollableOverflow(overflowX)) {
        if (right <= clip.left || left >= clip.right) {
          left = clip.left;
          right = clip.right;
        } else {
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
      } else {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
        if (right <= left) return false;
      }
    }
  }
  return true;
}

/** 依對照表找出第一個看得到的元素；sidebar 範圍要傳入側欄的 shadow root。 */
export function findPageGuideElement(
  target: PageGuideTarget,
  roots: { page: ParentNode; sidebar: ParentNode | null },
): Element | null {
  const root = target.scope === 'sidebar' ? roots.sidebar : roots.page;
  if (!root) return null;
  for (const selector of target.selectors) {
    const match = Array.from(root.querySelectorAll(selector)).find(isVisible);
    if (match) return match;
  }
  return null;
}
