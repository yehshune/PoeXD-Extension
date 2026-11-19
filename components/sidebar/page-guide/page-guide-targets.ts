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

const RESULT_ROW = '.results .row[data-id]';
/** 導覽的示意結果列（見 utils/trade-results-root.ts） */
const MOCK_ROW = '[data-poexd-guide-mock] .row';

export const PAGE_GUIDE_TARGETS = {
  'sidebar-panel': { scope: 'sidebar', selectors: ['.sidebar-container'] },
  'sidebar-nav': { scope: 'sidebar', selectors: ['.sidebar-nav'] },
  // 導覽中收合側欄後改指向邊緣的把手，讓使用者接著試拖曳
  'sidebar-collapse': {
    scope: 'sidebar',
    selectors: ['[data-sidebar-action="collapse"]', '[data-sidebar-action="expand"]'],
  },
  'sidebar-bookmark-tab': { scope: 'sidebar', selectors: ['[data-sidebar-tab="bookmark"]'] },
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
  'tier-trigger': { scope: 'page', selectors: ['.poexd-tier-trigger'], needs: 'stat-filter' },
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
    selectors: ['.results .poexd-filter-mod-highlight', `${RESULT_ROW} [data-field^="stat."]`],
    needs: 'results',
  },
  'result-mod': {
    scope: 'page',
    selectors: [`${RESULT_ROW} [data-field^="stat."]`],
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
    selectors: ['.results .poexd-result-mod-en', `${RESULT_ROW} [data-field^="stat."]`],
    needs: 'results',
  },
} as const satisfies Record<string, PageGuideTarget>;

export type PageGuideTargetId = keyof typeof PAGE_GUIDE_TARGETS;

export function getPageGuideTarget(id: PageGuideTargetId): PageGuideTarget {
  return PAGE_GUIDE_TARGETS[id];
}

function clipsOverflow(el: Element): boolean {
  const style = getComputedStyle(el);
  return [style.overflow, style.overflowX, style.overflowY].some(
    (value) => value && value !== 'visible',
  );
}

/**
 * 寬高大於零、而且沒有被會裁切的父層整個切掉。
 * 官方收起篩選面板時，裡面的按鈕仍有尺寸，只是被高度 0 的容器裁掉。
 */
function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let top = rect.top;
  let bottom = rect.bottom;
  let left = rect.left;
  let right = rect.right;
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (!clipsOverflow(node)) continue;
    const clip = node.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
    if (bottom <= top || right <= left) return false;
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
