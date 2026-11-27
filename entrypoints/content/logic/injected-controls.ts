import { createSvgIcon } from '@/utils/safe-dom';
import {
  HOST_TIER_TRIGGER_SPEC,
  HOST_FILTER_SELECT_BUTTON_SPEC,
  HOST_CATEGORY_BUTTON_SPEC,
} from '@/lib/tokens';
import { type PoeVersion } from '@/utils/trade-context';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { PAGE_GUIDE_MOCK_ATTR } from '@/utils/trade-results-root';

/**
 * 「類別過濾」群組標題：國際服英文、台服，以及市集漢化（ADR-0012）改寫後的繁中／簡中
 * （與 public/json/<ver>/locales/<locale>/trade-filters.json 的 type_filters 相同）
 */
const TYPE_FILTERS_TITLES = ['Type Filters', '類別過濾', '类型过滤器'] as const;

export interface InjectedControlsOptions {
  version: PoeVersion;
}

export interface InjectedControls {
  injectCustomStyles(): void;
  updatePureBackgroundClass(enable: boolean): void;
  injectFilterGroupButtons(): void;
  cleanFilterGroupButtons(): void;
  updateInjectedControlsLocale(): void;
}

export function injectCustomStyles(): void {
  let styleEl = document.getElementById('poexd-custom-style') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'poexd-custom-style';
    (document.head || document.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = `
    .logo a { max-width: 100px !important; height: auto !important; }
    body.poexd-pure-bg { background-image: none !important; background-color: #060607 !important; }
    .filter .input-group-btn { cursor: grab !important; }
    .filter .input-group-btn:active { cursor: grabbing !important; }

    /* 顏色貼齊官網群組標題列按鈕（.edit-btn / .remove-btn），不隨擴充主題變動 */
    .poexd-inline-btn {
      background-color: transparent !important;
      border: 0 !important;
      color: oklch(0.913 0 0) !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: color 0.15s, background-color 0.15s !important;
      border-radius: 0 !important;
      box-sizing: border-box !important;
      vertical-align: middle !important;
    }
    .poexd-inline-btn:hover {
      color: oklch(0.913 0 0) !important;
      background-color: oklch(0.312 0.008 248) !important;
    }
    .poexd-inline-btn:focus,
    .poexd-inline-btn:focus-visible {
      outline: none !important;
      box-shadow: inset 0 0 0 1px oklch(0.6 0 0) !important;
    }

    .poexd-filter-select-btn {
      width: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px !important;
      height: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .poexd-filter-select-btn svg {
      width: ${HOST_FILTER_SELECT_BUTTON_SPEC.iconSizePx}px !important;
      height: ${HOST_FILTER_SELECT_BUTTON_SPEC.iconSizePx}px !important;
    }

    .poexd-tier-trigger-slot {
      display: table-cell !important;
      position: relative !important;
      vertical-align: middle !important;
      white-space: nowrap !important;
      width: ${HOST_TIER_TRIGGER_SPEC.widthPx}px !important;
    }

    /* 顏色以 oklch() 對齊官網詞綴列（輸入欄底色、按鈕懸停與官網經典金），不隨擴充主題變動 */
    .poexd-tier-trigger {
      position: absolute !important;
      inset: 0 !important;
      width: auto !important;
      height: auto !important;
      background-color: oklch(0.246 0.007 248) !important;
      border: 1px solid transparent !important;
      color: oklch(0.76 0.006 248) !important;
      padding: 0 ${HOST_TIER_TRIGGER_SPEC.paddingXPx}px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: ${HOST_TIER_TRIGGER_SPEC.fontPx}px !important;
      line-height: ${HOST_TIER_TRIGGER_SPEC.lineHeightPx}px !important;
      font-weight: ${HOST_TIER_TRIGGER_SPEC.fontWeight} !important;
      box-sizing: border-box !important;
      flex-shrink: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      transition: color 0.15s, background-color 0.15s, border-color 0.15s !important;
    }
    .poexd-tier-trigger:hover {
      border-color: transparent !important;
      color: oklch(0.913 0 0) !important;
      background-color: oklch(0.312 0.008 248) !important;
    }
    .poexd-tier-trigger[data-tier-active="true"] {
      color: oklch(0.654 0.055 78) !important;
      border-color: oklch(0.654 0.055 78 / 0.65) !important;
    }
    .poexd-tier-trigger[data-state="open"],
    .poexd-tier-trigger[aria-expanded="true"] {
      background-color: oklch(0.312 0.008 248) !important;
      color: oklch(0.75 0.06 78) !important;
      border-color: oklch(0.654 0.055 78) !important;
    }
    .poexd-tier-trigger:focus,
    .poexd-tier-trigger:focus-visible {
      outline: none !important;
      box-shadow: inset 0 0 0 1px oklch(0.654 0.055 78) !important;
    }

    /* 直接沿用官網 .btn 樣式，不隨擴充主題變動，僅固定嵌入排版幾何 */
    .poexd-category-select-btn {
      padding: ${HOST_CATEGORY_BUTTON_SPEC.paddingYPx}px ${HOST_CATEGORY_BUTTON_SPEC.paddingXPx}px !important;
      margin-left: ${HOST_CATEGORY_BUTTON_SPEC.marginLeftPx}px !important;
      font-size: ${HOST_CATEGORY_BUTTON_SPEC.fontPx}px !important;
      height: ${HOST_CATEGORY_BUTTON_SPEC.heightPx}px !important;
      line-height: ${HOST_CATEGORY_BUTTON_SPEC.lineHeightPx}px !important;
      border-radius: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: middle !important;
      cursor: pointer !important;
    }

    #trade .controls .controls-left:has(.poexd-send-to-console-btn) {
      display: flex !important;
      flex-wrap: wrap !important;
      align-items: center !important;
      gap: 4px !important;
    }
    @media (max-width: 767px) {
      #trade .controls .controls-left:has(.poexd-send-to-console-btn) {
        margin-bottom: 5px !important;
      }
      #trade .controls .controls-left:has(.poexd-send-to-console-btn) .livesearch-btn {
        margin-bottom: 0 !important;
      }
    }
    @media (min-width: 1200px) {
      #trade .controls:has(.poexd-send-to-console-btn) {
        display: flex !important;
        align-items: flex-start !important;
      }
      #trade .controls:has(.poexd-send-to-console-btn) .controls-left,
      #trade .controls:has(.poexd-send-to-console-btn) .controls-right {
        flex: 1 1 0 !important;
        width: auto !important;
        float: none !important;
      }
      #trade .controls:has(.poexd-send-to-console-btn) .controls-center {
        flex: 0 0 28% !important;
        width: auto !important;
        float: none !important;
      }
      #trade .controls:has(.poexd-send-to-console-btn) .controls-center .search-btn {
        width: 100% !important;
      }
      #trade .controls:has(.poexd-send-to-console-btn) > .clear {
        display: none !important;
      }
    }

    /* 顏色以 oklch() 對齊官網搜尋按鈕藍，不寫原始 hex/rgb */
    .poexd-send-to-console-btn {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-width: 96px !important;
      min-height: 34px !important;
      margin: 0 !important;
      padding: 6px 12px !important;
      font-family: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif !important;
      font-size: 13px !important;
      line-height: 16px !important;
      font-weight: 400 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background-color: oklch(0.295 0.062 246) !important;
      border: 1px solid oklch(0.45 0.075 268) !important;
      color: oklch(0.913 0 0) !important;
      cursor: pointer !important;
      transition: background-color 0.15s, border-color 0.15s, opacity 0.15s !important;
    }
    .poexd-send-to-console-btn:hover:not(:disabled) {
      background-color: oklch(0.345 0.075 246) !important;
      border-color: oklch(0.55 0.085 268) !important;
      color: oklch(0.913 0 0) !important;
    }
    .poexd-send-to-console-btn:focus,
    .poexd-send-to-console-btn:focus-visible {
      outline: none !important;
      box-shadow: 0 0 0 2px var(--ring) !important;
    }
    .poexd-send-to-console-btn:disabled {
      opacity: 0.6 !important;
      cursor: wait !important;
    }

    .poexd-sortable-ghost {
      opacity: 0.35 !important;
      border: 1px dashed var(--primary) !important;
      background-color: var(--accent) !important;
    }
    .poexd-sortable-drag {
      background-color: var(--popover) !important;
      color: var(--popover-foreground) !important;
      box-shadow: var(--shadow-md) !important;
      border: 1px solid var(--border) !important;
      border-radius: var(--radius) !important;
    }

    /* 官方結果列離屏虛擬化：80～100 筆結果時跳過畫面外卡片排版與繪製，避免調整側欄或視窗寬度時卡頓 */
    #trade .results:not([${PAGE_GUIDE_MOCK_ATTR}]) .resultset > .row {
      content-visibility: auto !important;
      contain-intrinsic-block-size: auto 280px !important;
    }
    #trade .results:not([${PAGE_GUIDE_MOCK_ATTR}]) .resultset.exchange > .row.exchange {
      contain-intrinsic-block-size: auto 81px !important;
    }
  `;
}

export function updatePureBackgroundClass(enable: boolean): void {
  const body = document.body;
  if (!body) {
    setTimeout(() => updatePureBackgroundClass(enable), 50);
    return;
  }
  if (enable) {
    body.classList.add('poexd-pure-bg');
  } else {
    body.classList.remove('poexd-pure-bg');
  }
}

type FilterGroupButtonMode = 'affix' | 'mercenary' | 'mercenary-condition';

const MERCENARY_GROUP_TYPE = 'mercenary';
/** 可以放傭兵技能的一般條件群組（weight 需逐條填權重，不提供）。 */
const MERCENARY_CONDITION_GROUP_TYPES: ReadonlySet<string> = new Set(['and', 'not', 'count', 'if']);
const FILTER_ICON_PATH =
  'M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0 0 19 4H5c-.78 0-1.23.89-.75 1.61z';
const MERCENARY_ICON_PATH =
  'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';

/**
 * 官方「傭兵技能群組」只能加入傭兵技能，一般詞綴選擇器對它沒有用。
 * 優先使用 Main World 依 Vuex 標記的群組類型；尚未標記時，以群組內只出現傭兵選項判斷。
 */
export function isMercenaryFilterGroup(group: Element): boolean {
  const tagged = group.getAttribute('data-poexd-group-type');
  if (tagged) return tagged === MERCENARY_GROUP_TYPE;
  const body = group.querySelector('.filter-group-body');
  if (!body) return false;
  const typed = body.querySelectorAll('.mutate-type');
  return (
    typed.length > 0 &&
    Array.from(typed).every((el) => el.classList.contains('mutate-type-mercenary'))
  );
}

/**
 * 傭兵搜尋中的一般條件群組（and / not / count / if）也能放傭兵技能，額外提供傭兵按鈕。
 * 依 Main World 標記的群組類型與傭兵搜尋旗標判斷。
 */
export function isMercenaryConditionGroup(group: Element): boolean {
  if (group.getAttribute('data-poexd-mercenary-search') !== '1') return false;
  return MERCENARY_CONDITION_GROUP_TYPES.has(group.getAttribute('data-poexd-group-type') ?? '');
}

function filterGroupButtonTitle(mode: FilterGroupButtonMode): string {
  if (mode === 'mercenary') return t('injectedControls.selectMercenaryGroupTitle');
  if (mode === 'mercenary-condition') return t('mercenaryPicker.groupTitle');
  return t('injectedControls.selectAffixGroupTitle');
}

function resolveFilterGroupIndex(button: HTMLButtonElement, fallbackIndex: number): number {
  const groupEl = button.closest('.filter-group');
  if (!groupEl) return fallbackIndex;
  const groups = Array.from(document.querySelectorAll('.search-advanced-pane.brown .filter-group'));
  const currentIndex = groups.indexOf(groupEl);
  return currentIndex >= 0 ? currentIndex : fallbackIndex;
}

function createFilterGroupButton(
  mode: FilterGroupButtonMode,
  fallbackGroupIndex: number,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    mode === 'mercenary-condition'
      ? 'btn poexd-inline-btn poexd-filter-select-btn poexd-mercenary-condition-btn'
      : 'btn poexd-inline-btn poexd-filter-select-btn';
  button.dataset.poexdMode = mode;
  button.title = filterGroupButtonTitle(mode);
  button.replaceChildren(
    createSvgIcon({
      attrs: { viewBox: '0 0 24 24', style: 'fill: currentColor; pointer-events: none;' },
      paths: [mode === 'affix' ? FILTER_ICON_PATH : MERCENARY_ICON_PATH],
    }),
  );
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const groupIndex = resolveFilterGroupIndex(button, fallbackGroupIndex);
    if (mode === 'mercenary') {
      dispatchPoeEvent('poexd-open-mercenary-picker', { groupIndex });
    } else if (mode === 'mercenary-condition') {
      dispatchPoeEvent('poexd-open-mercenary-picker', { groupIndex, condition: true });
    } else {
      dispatchPoeEvent('poexd-open-affix-modal', { groupIndex });
    }
  });
  return button;
}

export function cleanFilterGroupButtons(): void {
  document
    .querySelectorAll<HTMLElement>('.poexd-filter-select-btn, .poexd-category-select-btn')
    .forEach((btn) => {
      btn.remove();
    });
}

export function createInjectedControls(options: InjectedControlsOptions): InjectedControls {
  const injectFilterGroupButtons = (): void => {
    try {
      chrome.runtime.getURL('');
    } catch {
      return;
    }

    const misplacedFilterBtn = document.querySelector('.poexd-filter-select-btn');
    if (
      misplacedFilterBtn &&
      misplacedFilterBtn.closest('.filter-body') &&
      !misplacedFilterBtn.closest('.filter-group-header')
    ) {
      misplacedFilterBtn.remove();
    }

    const groups = document.querySelectorAll('.search-advanced-pane.brown .filter-group');
    groups.forEach((group, index) => {
      const header = group.querySelector('.filter-group-header .filter');
      if (!header) return;
      const mode: FilterGroupButtonMode =
        options.version === 'poe1' && isMercenaryFilterGroup(group) ? 'mercenary' : 'affix';
      const removeBtn = header.querySelector('.remove-btn');
      const container = removeBtn?.closest('.input-group-btn');

      const wantsCondition =
        options.version === 'poe1' && mode === 'affix' && isMercenaryConditionGroup(group);
      const conditionBtn = header.querySelector<HTMLElement>('.poexd-mercenary-condition-btn');
      if (conditionBtn && !wantsCondition) conditionBtn.remove();

      const existing = header.querySelector<HTMLElement>(
        '.poexd-filter-select-btn:not(.poexd-mercenary-condition-btn)',
      );
      if (existing && existing.dataset.poexdMode !== mode) existing.remove();
      if (!container || !removeBtn) return;
      if (!existing || existing.dataset.poexdMode !== mode) {
        container.insertBefore(createFilterGroupButton(mode, index), removeBtn);
      }
      if (wantsCondition && !conditionBtn) {
        container.insertBefore(createFilterGroupButton('mercenary-condition', index), removeBtn);
      }
    });

    let categoryGroup: Element | null = null;
    for (const group of Array.from(groups)) {
      const headerTitleEl = group.querySelector('.filter-group-header .filter-title');
      if (headerTitleEl) {
        const text = headerTitleEl.textContent?.trim() || '';
        if (TYPE_FILTERS_TITLES.some((title) => text.includes(title))) {
          categoryGroup = group;
          break;
        }
      }
    }

    if (categoryGroup) {
      const header =
        categoryGroup.querySelector('.filter-group-header .filter') ||
        categoryGroup.querySelector('.filter-group-header');
      if (header && !header.querySelector('.poexd-category-select-btn')) {
        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'btn poexd-category-select-btn';
        selectBtn.title = t('injectedControls.selectAffixTitle');
        selectBtn.textContent = t('injectedControls.selectAffix');

        selectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const currentGroupsCount = document.querySelectorAll(
            '.search-advanced-pane.brown .filter-group',
          ).length;
          const targetIdx = currentGroupsCount > 0 ? currentGroupsCount - 1 : 0;
          dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: targetIdx });
        });
        header.appendChild(selectBtn);
      }
    }
  };

  const updateInjectedControlsLocale = (): void => {
    document.querySelectorAll<HTMLElement>('.poexd-filter-select-btn').forEach((btn) => {
      const mode = btn.dataset.poexdMode;
      btn.title = filterGroupButtonTitle(
        mode === 'mercenary' || mode === 'mercenary-condition' ? mode : 'affix',
      );
    });

    document.querySelectorAll<HTMLElement>('.poexd-category-select-btn').forEach((btn) => {
      btn.title = t('injectedControls.selectAffixTitle');
      btn.textContent = t('injectedControls.selectAffix');
    });
  };

  return {
    injectCustomStyles,
    updatePureBackgroundClass,
    injectFilterGroupButtons,
    cleanFilterGroupButtons,
    updateInjectedControlsLocale,
  };
}
