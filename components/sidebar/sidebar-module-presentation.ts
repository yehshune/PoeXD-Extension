import type { Component } from 'vue';
import {
  Bookmark,
  CircleHelp,
  History,
  LayoutList,
  Pin,
  Radio,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
} from '@lucide/vue';
import { t, type I18nKey } from '@/utils/i18n';
import {
  SIDEBAR_MODULES,
  SIDEBAR_PANE_TABS,
  type SidebarDescriptorId,
  type SidebarModuleId,
  type SidebarPaneTabId,
} from '@/utils/sidebar-modules';
import type { SidebarNavTab } from './layout/SidebarNavRail.vue';

interface SidebarModulePresentation {
  readonly icon: Component;
  readonly labelKey: I18nKey;
  readonly descriptionKey: I18nKey;
}

export interface SidebarPaneNavTab extends SidebarNavTab {
  readonly id: SidebarPaneTabId;
}

/** 涵蓋所有可開關模組與固定分頁的編譯期窮舉圖示表。 */
export const SIDEBAR_DESCRIPTOR_ICONS: Readonly<Record<SidebarDescriptorId, Component>> =
  Object.freeze({
    bookmark: Bookmark,
    history: History,
    'stat-group-template': SlidersHorizontal,
    'pob-build': ShoppingCart,
    'pinned-items': Pin,
    'result-board': LayoutList,
    'live-search': Radio,
    tools: CircleHelp,
    settings: Settings,
  });

/** 導覽列與設定頁共用的模組圖示與文字，由 SIDEBAR_MODULES 與 SIDEBAR_DESCRIPTOR_ICONS 推導。 */
export const SIDEBAR_MODULE_PRESENTATION: Readonly<
  Record<SidebarModuleId, SidebarModulePresentation>
> = Object.freeze(
  Object.fromEntries(
    SIDEBAR_MODULES.map((module) => [
      module.id,
      Object.freeze({
        icon: SIDEBAR_DESCRIPTOR_ICONS[module.id],
        labelKey: module.labelKey,
        descriptionKey: module.descriptionKey,
      }),
    ]),
  ) as Record<SidebarModuleId, SidebarModulePresentation>,
);

/** 導覽列所有可切換分頁（模組分頁＋固定分頁），由 SIDEBAR_PANE_TABS 與 SIDEBAR_DESCRIPTOR_ICONS 推導。 */
export const SIDEBAR_NAV_TABS: readonly SidebarPaneNavTab[] = Object.freeze(
  SIDEBAR_PANE_TABS.map((descriptor) => ({
    id: descriptor.id,
    get name() {
      return t(descriptor.labelKey);
    },
    icon: SIDEBAR_DESCRIPTOR_ICONS[descriptor.id],
  })),
);

export function getSidebarModuleLabel(id: SidebarModuleId): string {
  return t(SIDEBAR_MODULE_PRESENTATION[id].labelKey);
}

export function getSidebarModuleDescription(id: SidebarModuleId): string {
  return t(SIDEBAR_MODULE_PRESENTATION[id].descriptionKey);
}
