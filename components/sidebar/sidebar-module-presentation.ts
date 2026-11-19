import type { Component } from 'vue';
import { Bookmark, History, Pin, Radio, ShoppingCart, SlidersHorizontal } from '@lucide/vue';
import { t, type I18nKey } from '@/utils/i18n';
import type { SidebarModuleId } from '@/utils/sidebar-modules';

interface SidebarModulePresentation {
  icon: Component;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
}

/** 導覽列與設定頁共用的模組圖示與文字，確保兩邊看到的是同一個東西。 */
export const SIDEBAR_MODULE_PRESENTATION: Readonly<
  Record<SidebarModuleId, SidebarModulePresentation>
> = Object.freeze({
  bookmark: {
    icon: Bookmark,
    labelKey: 'sidebar.nav.bookmarks',
    descriptionKey: 'settings.modules.item.bookmark.description',
  },
  history: {
    icon: History,
    labelKey: 'sidebar.nav.history',
    descriptionKey: 'settings.modules.item.history.description',
  },
  'stat-group-template': {
    icon: SlidersHorizontal,
    labelKey: 'sidebar.nav.statGroupTemplates',
    descriptionKey: 'settings.modules.item.stat-group-template.description',
  },
  'pob-build': {
    icon: ShoppingCart,
    labelKey: 'sidebar.nav.pobBuild',
    descriptionKey: 'settings.modules.item.pob-build.description',
  },
  'pinned-items': {
    icon: Pin,
    labelKey: 'sidebar.nav.pinnedItems',
    descriptionKey: 'settings.modules.item.pinned-items.description',
  },
  'live-search': {
    icon: Radio,
    labelKey: 'settings.modules.item.live-search.label',
    descriptionKey: 'settings.modules.item.live-search.description',
  },
});

export function getSidebarModuleLabel(id: SidebarModuleId): string {
  return t(SIDEBAR_MODULE_PRESENTATION[id].labelKey);
}

export function getSidebarModuleDescription(id: SidebarModuleId): string {
  return t(SIDEBAR_MODULE_PRESENTATION[id].descriptionKey);
}
