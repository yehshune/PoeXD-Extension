import type { I18nKey } from '@/utils/i18n';
import type { PageGuideTargetId } from './page-guide-targets';

export interface PageGuideTourStep {
  id: string;
  targetId: PageGuideTargetId;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  /** 目標不在畫面上時，說明框裡改放的示意內容 */
  fallback?: 'result-card';
}

/** 初始導覽：只挑一直都在、或能暫時補出來的位置；結果區沒有結果時改用示意卡片。 */
export const PAGE_GUIDE_TOUR_STEPS: readonly PageGuideTourStep[] = Object.freeze([
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
  },
  {
    id: 'search',
    targetId: 'search-input',
    titleKey: 'pageGuide.tour.search.title',
    bodyKey: 'pageGuide.tour.search.body',
  },
  {
    id: 'affix-selector',
    targetId: 'affix-selector',
    titleKey: 'pageGuide.tour.affixSelector.title',
    bodyKey: 'pageGuide.tour.affixSelector.body',
  },
  {
    id: 'tier',
    targetId: 'tier-trigger',
    titleKey: 'pageGuide.tour.tier.title',
    bodyKey: 'pageGuide.tour.tier.body',
  },
  {
    id: 'results',
    targetId: 'result-actions',
    titleKey: 'pageGuide.tour.results.title',
    bodyKey: 'pageGuide.tour.results.body',
    fallback: 'result-card',
  },
  {
    id: 'bookmarks',
    targetId: 'sidebar-bookmark-tab',
    titleKey: 'pageGuide.tour.bookmarks.title',
    bodyKey: 'pageGuide.tour.bookmarks.body',
  },
  {
    id: 'settings',
    targetId: 'sidebar-settings-tab',
    titleKey: 'pageGuide.tour.settings.title',
    bodyKey: 'pageGuide.tour.settings.body',
  },
]);
