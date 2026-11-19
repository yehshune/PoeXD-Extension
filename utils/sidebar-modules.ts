import type { Preferences } from './preferences-contract';

/**
 * Sidebar Module：側邊欄導覽列上可由使用者開關的功能分頁或入口。
 * 關閉後導覽列不再顯示該圖示，對應的頁面注入 UI 也一併停用（見各 runtime 消費端）。
 * 工具與資訊、系統設定是固定分頁，不屬於 Sidebar Module。
 */
export const SIDEBAR_MODULE_IDS = [
  'bookmark',
  'history',
  'stat-group-template',
  'pob-build',
  'pinned-items',
  'live-search',
] as const;
export type SidebarModuleId = (typeof SIDEBAR_MODULE_IDS)[number];

export const SIDEBAR_FIXED_TAB_IDS = ['tools', 'settings'] as const;
export type SidebarFixedTabId = (typeof SIDEBAR_FIXED_TAB_IDS)[number];

/** live-search 是開啟主控台的入口按鈕，不是分頁，所以不在可切換的分頁清單內。 */
export type SidebarPaneTabId = Exclude<SidebarModuleId, 'live-search'> | SidebarFixedTabId;

export type SidebarModulePreferenceKey =
  | 'sidebarModuleBookmarks'
  | 'sidebarModuleHistory'
  | 'sidebarModuleStatGroupTemplates'
  | 'sidebarModulePobBuild'
  | 'sidebarModulePinnedItems'
  | 'sidebarModuleLiveSearch';

/** 設定分頁中的區塊 id；模組可指向與它相關的設定區塊，讓使用者一鍵跳過去。 */
export const SETTINGS_SECTION_IDS = [
  'modules',
  'appearance',
  'panel',
  'searchHotkeys',
  'resultDisplay',
  'bookmarks',
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export interface SidebarModuleDefinition {
  id: SidebarModuleId;
  preferenceKey: SidebarModulePreferenceKey;
  /** 與此模組相關的設定區塊；沒有專屬設定時為 null */
  settingsSection: SettingsSectionId | null;
}

export const SIDEBAR_MODULES: readonly SidebarModuleDefinition[] = Object.freeze([
  { id: 'bookmark', preferenceKey: 'sidebarModuleBookmarks', settingsSection: 'bookmarks' },
  { id: 'history', preferenceKey: 'sidebarModuleHistory', settingsSection: 'bookmarks' },
  {
    id: 'stat-group-template',
    preferenceKey: 'sidebarModuleStatGroupTemplates',
    settingsSection: null,
  },
  { id: 'pob-build', preferenceKey: 'sidebarModulePobBuild', settingsSection: 'bookmarks' },
  { id: 'pinned-items', preferenceKey: 'sidebarModulePinnedItems', settingsSection: null },
  { id: 'live-search', preferenceKey: 'sidebarModuleLiveSearch', settingsSection: null },
] satisfies SidebarModuleDefinition[]);

export const SIDEBAR_MODULE_PREFERENCE_KEYS: readonly SidebarModulePreferenceKey[] =
  SIDEBAR_MODULES.map((module) => module.preferenceKey);

export const DEFAULT_SIDEBAR_MODULE_PREFERENCES: Readonly<
  Record<SidebarModulePreferenceKey, boolean>
> = Object.freeze(
  Object.fromEntries(SIDEBAR_MODULE_PREFERENCE_KEYS.map((key) => [key, true])) as Record<
    SidebarModulePreferenceKey,
    boolean
  >,
);

type ModulePreferences = Pick<Preferences, SidebarModulePreferenceKey>;

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
  const moduleTabs = SIDEBAR_MODULES.filter(
    (module) => module.id !== 'live-search' && prefs[module.preferenceKey] !== false,
  ).map((module) => module.id as SidebarPaneTabId);
  return [...moduleTabs, ...SIDEBAR_FIXED_TAB_IDS];
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
  const firstModuleTab = visible.find(
    (tab) => !(SIDEBAR_FIXED_TAB_IDS as readonly string[]).includes(tab),
  );
  return firstModuleTab ?? 'settings';
}

export function countEnabledSidebarModules(prefs: ModulePreferences): number {
  return SIDEBAR_MODULES.filter((module) => prefs[module.preferenceKey] !== false).length;
}
