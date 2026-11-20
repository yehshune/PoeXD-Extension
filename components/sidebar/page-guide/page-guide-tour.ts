import type { I18nKey } from '@/utils/i18n';
import type { PageGuideTargetId } from './page-guide-targets';

/**
 * 導覽中可以直接調整的基礎設定；說明框裡會放對應的控制項（見 PageGuideSetupControls）。
 * collapse-drag 要使用者實際操作側欄，因此該步驟不擋頁面點擊。
 */
export type PageGuideSetupKind =
  | 'locale'
  | 'market-translation'
  | 'appearance'
  | 'collapse-drag'
  | 'demo-replay'
  | 'result-features';

/**
 * 步驟顯示後自動播放的示範：collapse 由側欄播放滑鼠點擊收合與拖曳把手；
 * affix-selector 示範開啟詞綴面板挑選胸甲與生命詞綴；
 * tier-menu 示範點擊 T 按鈕並展開清單，外框改框住清單。
 */
export type PageGuideStepDemo = 'collapse' | 'affix-selector' | 'tier-menu';

/** 只在特定條件下出現的步驟；條件由側欄提供（見 usePageGuide 的 setTourContext） */
export type PageGuideStepCondition = 'market-translation-offer';

/** 結果步驟要顯示示意結果列（PageGuideOfficialResult），值為說明框要列出的功能開關組 */
export type PageGuideDemoFocus = 'actions' | 'mods' | 'price';

export interface PageGuideTourStep {
  id: string;
  /** 不指定時說明框置中、整頁變暗 */
  targetId?: PageGuideTargetId;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  demoFocus?: PageGuideDemoFocus;
  demo?: PageGuideStepDemo;
  /** 示範播放後外框改指向的位置 */
  demoTargetId?: PageGuideTargetId;
  setup?: PageGuideSetupKind;
  /** 步驟需要使用者直接操作頁面或側欄，不放擋點擊的遮罩 */
  interactive?: boolean;
  when?: PageGuideStepCondition;
}

/**
 * 初始導覽：先調整語言、漢化與側欄外觀（後面的說明會用選好的語言顯示），
 * 再介紹功能。結果列一律用示意結果列說明，不依賴目前頁面有沒有搜尋結果。
 */
export const PAGE_GUIDE_TOUR_STEPS: readonly PageGuideTourStep[] = Object.freeze([
  {
    id: 'locale',
    titleKey: 'pageGuide.tour.locale.title',
    bodyKey: 'pageGuide.tour.locale.body',
    setup: 'locale',
  },
  {
    id: 'market-translation',
    titleKey: 'pageGuide.tour.marketTranslation.title',
    bodyKey: 'pageGuide.tour.marketTranslation.body',
    setup: 'market-translation',
    when: 'market-translation-offer',
  },
  {
    id: 'appearance',
    targetId: 'sidebar-panel',
    titleKey: 'pageGuide.tour.appearance.title',
    bodyKey: 'pageGuide.tour.appearance.body',
    setup: 'appearance',
    // 讓使用者能直接拖曳側欄內側邊緣調整寬度
    interactive: true,
  },
  {
    id: 'sidebar',
    targetId: 'sidebar-nav',
    titleKey: 'pageGuide.tour.sidebar.title',
    bodyKey: 'pageGuide.tour.sidebar.body',
  },
  {
    id: 'collapse',
    targetId: 'sidebar-collapse',
    titleKey: 'pageGuide.tour.collapse.title',
    bodyKey: 'pageGuide.tour.collapse.body',
    setup: 'collapse-drag',
    demo: 'collapse',
    interactive: true,
  },
  {
    id: 'affix-selector',
    targetId: 'affix-selector',
    titleKey: 'pageGuide.tour.affixSelector.title',
    bodyKey: 'pageGuide.tour.affixSelector.body',
    setup: 'demo-replay',
    demo: 'affix-selector',
  },
  {
    id: 'tier',
    targetId: 'tier-trigger',
    titleKey: 'pageGuide.tour.tier.title',
    bodyKey: 'pageGuide.tour.tier.body',
    demo: 'tier-menu',
    demoTargetId: 'tier-menu',
  },
  {
    id: 'result-actions',
    targetId: 'mock-result-actions',
    titleKey: 'pageGuide.tour.resultActions.title',
    bodyKey: 'pageGuide.tour.resultActions.body',
    setup: 'result-features',
    demoFocus: 'actions',
  },
  {
    id: 'result-mods',
    targetId: 'mock-result-mods',
    titleKey: 'pageGuide.tour.resultMods.title',
    bodyKey: 'pageGuide.tour.resultMods.body',
    setup: 'result-features',
    demoFocus: 'mods',
  },
  {
    id: 'result-price',
    targetId: 'mock-result-price',
    titleKey: 'pageGuide.tour.resultPrice.title',
    bodyKey: 'pageGuide.tour.resultPrice.body',
    setup: 'result-features',
    demoFocus: 'price',
  },
  {
    id: 'settings',
    targetId: 'sidebar-settings-tab',
    titleKey: 'pageGuide.tour.settings.title',
    bodyKey: 'pageGuide.tour.settings.body',
  },
]);
