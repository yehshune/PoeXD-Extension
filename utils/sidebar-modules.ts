import type { I18nKey } from './i18n';
import type { Preferences } from './preferences-contract';

/** 設定分頁中的區塊 id；模組可指向與它相關的設定區塊，讓使用者一鍵跳過去。 */
export const SETTINGS_SECTION_IDS = [
  'localization',
  'pageLayout',
  'searchHotkeys',
  'resultDisplay',
  'appearance',
  'modules',
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export type SidebarDescriptorKind = 'module-tab' | 'action' | 'fixed-tab';
export type SidebarTabScrollMode = 'pane' | 'shell';

type BooleanPreferenceKey = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

interface SidebarDescriptorBase {
  readonly id: string;
  readonly kind: SidebarDescriptorKind;
  readonly labelKey: I18nKey;
}

interface SidebarModuleTabDescriptorShape extends SidebarDescriptorBase {
  readonly kind: 'module-tab';
  readonly preferenceKey: BooleanPreferenceKey;
  readonly settingsSection: SettingsSectionId | null;
  readonly scrollMode: SidebarTabScrollMode;
  readonly descriptionKey: I18nKey;
}

interface SidebarModuleActionDescriptorShape extends SidebarDescriptorBase {
  readonly kind: 'action';
  readonly preferenceKey: BooleanPreferenceKey;
  readonly settingsSection: SettingsSectionId | null;
  readonly descriptionKey: I18nKey;
}

interface SidebarFixedTabDescriptorShape extends SidebarDescriptorBase {
  readonly kind: 'fixed-tab';
  readonly scrollMode: SidebarTabScrollMode;
}

type SidebarDescriptorShape =
  | SidebarModuleTabDescriptorShape
  | SidebarModuleActionDescriptorShape
  | SidebarFixedTabDescriptorShape;

/**
 * Sidebar 模組與固定分頁的單一宣告式描述表（純資料，不含 Vue / icon 相依）。
 *
 * - `module-tab`：可由使用者開關的功能分頁（關閉後導覽列不再顯示，對應頁面注入 UI 亦停用）
 * - `action`：可由使用者開關的外部入口按鈕（如 `live-search`，非 pane 分頁）
 * - `fixed-tab`：固定分頁（`tools`、`settings`），不屬於可開關的 Sidebar Module
 */
export const SIDEBAR_DESCRIPTORS = Object.freeze([
  {
    id: 'bookmark',
    kind: 'module-tab',
    preferenceKey: 'sidebarModuleBookmarks',
    settingsSection: null,
    scrollMode: 'pane',
    labelKey: 'sidebar.nav.bookmarks',
    descriptionKey: 'settings.modules.item.bookmark.description',
  },
  {
    id: 'history',
    kind: 'module-tab',
    preferenceKey: 'sidebarModuleHistory',
    settingsSection: null,
    scrollMode: 'pane',
    labelKey: 'sidebar.nav.history',
    descriptionKey: 'settings.modules.item.history.description',
  },
  {
    id: 'stat-group-template',
    kind: 'module-tab',
    preferenceKey: 'sidebarModuleStatGroupTemplates',
    settingsSection: null,
    scrollMode: 'pane',
    labelKey: 'sidebar.nav.statGroupTemplates',
    descriptionKey: 'settings.modules.item.stat-group-template.description',
  },
  {
    id: 'pob-build',
    kind: 'module-tab',
    preferenceKey: 'sidebarModulePobBuild',
    settingsSection: null,
    scrollMode: 'pane',
    labelKey: 'sidebar.nav.pobBuild',
    descriptionKey: 'settings.modules.item.pob-build.description',
  },
  {
    id: 'pinned-items',
    kind: 'module-tab',
    preferenceKey: 'sidebarModulePinnedItems',
    settingsSection: null,
    scrollMode: 'pane',
    labelKey: 'sidebar.nav.pinnedItems',
    descriptionKey: 'settings.modules.item.pinned-items.description',
  },
  {
    id: 'result-board',
    kind: 'module-tab',
    preferenceKey: 'sidebarModuleResultBoard',
    settingsSection: null,
    scrollMode: 'pane',
    labelKey: 'sidebar.nav.resultBoard',
    descriptionKey: 'settings.modules.item.result-board.description',
  },
  {
    id: 'live-search',
    kind: 'action',
    preferenceKey: 'sidebarModuleLiveSearch',
    settingsSection: null,
    labelKey: 'settings.modules.item.live-search.label',
    descriptionKey: 'settings.modules.item.live-search.description',
  },
  {
    id: 'tools',
    kind: 'fixed-tab',
    scrollMode: 'shell',
    labelKey: 'sidebar.nav.tools',
  },
  {
    id: 'settings',
    kind: 'fixed-tab',
    scrollMode: 'pane',
    labelKey: 'sidebar.nav.settings',
  },
] as const satisfies readonly SidebarDescriptorShape[]);

export type SidebarDescriptor = (typeof SIDEBAR_DESCRIPTORS)[number];
export type SidebarDescriptorId = SidebarDescriptor['id'];
export type SidebarModuleDefinition = Extract<
  SidebarDescriptor,
  { readonly kind: 'module-tab' | 'action' }
>;
export type SidebarFixedTabDescriptor = Extract<SidebarDescriptor, { readonly kind: 'fixed-tab' }>;
export type SidebarPaneTabDescriptor = Extract<
  SidebarDescriptor,
  { readonly kind: 'module-tab' | 'fixed-tab' }
>;

export type SidebarModuleId = SidebarModuleDefinition['id'];
export type SidebarFixedTabId = SidebarFixedTabDescriptor['id'];
/** live-search 是開啟主控台的入口按鈕，不是分頁，所以不在可切換的分頁清單內。 */
export type SidebarPaneTabId = SidebarPaneTabDescriptor['id'];
export type SidebarModulePreferenceKey = SidebarModuleDefinition['preferenceKey'];

export const SIDEBAR_MODULES: readonly SidebarModuleDefinition[] = Object.freeze(
  SIDEBAR_DESCRIPTORS.filter(
    (descriptor): descriptor is SidebarModuleDefinition => descriptor.kind !== 'fixed-tab',
  ),
);

export const SIDEBAR_MODULE_IDS: readonly SidebarModuleId[] = Object.freeze(
  SIDEBAR_MODULES.map((module) => module.id),
);

export const SIDEBAR_FIXED_TAB_IDS: readonly SidebarFixedTabId[] = Object.freeze(
  SIDEBAR_DESCRIPTORS.filter(
    (descriptor): descriptor is SidebarFixedTabDescriptor => descriptor.kind === 'fixed-tab',
  ).map((descriptor) => descriptor.id),
);

export const SIDEBAR_PANE_TABS: readonly SidebarPaneTabDescriptor[] = Object.freeze(
  SIDEBAR_DESCRIPTORS.filter(
    (descriptor): descriptor is SidebarPaneTabDescriptor => descriptor.kind !== 'action',
  ),
);

export const SIDEBAR_MODULE_PREFERENCE_KEYS: readonly SidebarModulePreferenceKey[] = Object.freeze(
  SIDEBAR_MODULES.map((module) => module.preferenceKey),
);

export const DEFAULT_SIDEBAR_MODULE_PREFERENCES: Readonly<
  Record<SidebarModulePreferenceKey, boolean>
> = Object.freeze(
  Object.fromEntries(SIDEBAR_MODULE_PREFERENCE_KEYS.map((key) => [key, true])) as Record<
    SidebarModulePreferenceKey,
    boolean
  >,
);

const PANE_SCROLL_TAB_IDS = new Set<string>(
  SIDEBAR_PANE_TABS.filter((tab) => tab.scrollMode === 'pane').map((tab) => tab.id),
);

const FIXED_TAB_ID_SET = new Set<string>(SIDEBAR_FIXED_TAB_IDS);

type ModulePreferences = Pick<Preferences, SidebarModulePreferenceKey>;

/** 指定分頁是否為固定分頁（`tools`、`settings`）。 */
export function isSidebarFixedTab(tabId: string): tabId is SidebarFixedTabId {
  return FIXED_TAB_ID_SET.has(tabId);
}

/** 指定分頁是否由子元件自身的 SidebarPane 負責捲動（而非外層 Sidebar ScrollArea）。 */
export function usesSidebarPaneScroll(tabId: string): boolean {
  return PANE_SCROLL_TAB_IDS.has(tabId);
}

export function getSidebarModule(id: SidebarModuleId): SidebarModuleDefinition {
  const found = SIDEBAR_MODULES.find((module) => module.id === id);
  if (!found) throw new Error(`Unknown Sidebar Module: ${id}`);
  return found;
}

export function isSidebarModuleEnabled(prefs: ModulePreferences, id: SidebarModuleId): boolean {
  return prefs[getSidebarModule(id).preferenceKey] !== false;
}

/** 依導覽列顯示順序回傳目前可見的分頁 id（啟用中的模組分頁，加上固定分頁）。 */
export function resolveVisiblePaneTabs(prefs: ModulePreferences): readonly SidebarPaneTabId[] {
  return SIDEBAR_PANE_TABS.filter(
    (tab) => tab.kind === 'fixed-tab' || prefs[tab.preferenceKey] !== false,
  ).map((tab) => tab.id);
}

/**
 * 目前分頁被關閉時要切到哪一頁：優先第一個仍啟用的模組分頁，全部關閉時落在系統設定，
 * 讓使用者能立即把模組開回來。
 */
export function resolveActivePaneTab(
  requested: string,
  prefs: ModulePreferences,
): SidebarPaneTabId {
  const visible = resolveVisiblePaneTabs(prefs);
  if ((visible as readonly string[]).includes(requested)) return requested as SidebarPaneTabId;
  const firstModuleTab = visible.find((tab) => !FIXED_TAB_ID_SET.has(tab));
  return firstModuleTab ?? 'settings';
}

export function countEnabledSidebarModules(prefs: ModulePreferences): number {
  return SIDEBAR_MODULES.filter((module) => prefs[module.preferenceKey] !== false).length;
}
