import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  type ThemeId,
  isValidThemeId,
  normalizeThemeId,
} from '@/lib/theme/theme-contract';
import type { PoeVersion } from './trade-context';

export { DEFAULT_THEME_ID, THEME_IDS, type ThemeId, isValidThemeId, normalizeThemeId };

export const SIDEBAR_POSITIONS = ['left', 'right'] as const;
export type SidebarPosition = (typeof SIDEBAR_POSITIONS)[number];

export const BOOKMARK_BUTTON_POSITIONS = ['top', 'bottom'] as const;
export type BookmarkButtonPosition = (typeof BOOKMARK_BUTTON_POSITIONS)[number];

/** 左鍵點選書籤或搜尋歷史時：開啟搜尋，或切換 Search Preview（見 CONTEXT.md）。 */
export const SEARCH_ENTRY_CLICK_ACTIONS = ['open', 'preview'] as const;
export type SearchEntryClickAction = (typeof SEARCH_ENTRY_CLICK_ACTIONS)[number];

export const DENSITY_SCALE_VALUES = [1, 0.8] as const;
export type DensityScale = (typeof DENSITY_SCALE_VALUES)[number];

export const SIDEBAR_WIDTH_BOUNDS = Object.freeze({
  min: 300,
  max: 800,
});

/** 收合標籤距離視窗頂端的位置（px）；實際顯示時再依視窗高度限制在畫面內 */
export const COLLAPSED_TAB_TOP_BOUNDS = Object.freeze({
  min: 0,
  max: 4000,
});

export const FONT_SIZE_SCALE_BOUNDS = Object.freeze({
  min: 0.8,
  max: 2,
});

export const FONT_SIZE_PERCENT_STEP = 5;

export const GLOBAL_PREFERENCE_NAMES = [
  'theme',
  'displayLocale',
  'marketTranslation',
  'marketTranslationBilingual',
  'marketTranslationResultBilingual',
  'collapsedTabTop',
  'sidebarPosition',
  'sidebarWidth',
  'fontSizeScale',
  'densityScale',
  'enablePureBackground',
  'enableAutoTitle',
  'enableHotkeys',
  'hotkeyFocus',
  'hotkeyClear',
  'enableSearchTilde',
  'enableFilterTilde',
  'addBookmarkBtnPosition',
  'searchEntryClickAction',
  'enableBookmarkTooltip',
] as const;
export type GlobalPreferenceName = (typeof GLOBAL_PREFERENCE_NAMES)[number];
export type VersionedPreferenceName = Exclude<keyof Preferences, GlobalPreferenceName>;
export type GlobalPreferences = Pick<Preferences, GlobalPreferenceName>;
export type VersionedPreferences = Pick<Preferences, VersionedPreferenceName>;

/** 曾經依遊戲版本（`${name}_poe1` / `${name}_poe2`）儲存、現已併入全域的偏好名稱 */
export const LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES = [
  'collapsedTabTop',
  'sidebarPosition',
  'sidebarWidth',
  'fontSizeScale',
  'densityScale',
  'enablePureBackground',
  'enableAutoTitle',
  'enableHotkeys',
  'hotkeyFocus',
  'hotkeyClear',
  'enableSearchTilde',
  'enableFilterTilde',
  'addBookmarkBtnPosition',
  'searchEntryClickAction',
  'enableBookmarkTooltip',
] as const satisfies readonly GlobalPreferenceName[];

export function isGlobalPreference(name: string): name is GlobalPreferenceName {
  return (GLOBAL_PREFERENCE_NAMES as readonly string[]).includes(name);
}

export function getPreferenceStorageKey(name: keyof Preferences, version: PoeVersion): string {
  return isGlobalPreference(name) ? name : `${name}_${version}`;
}

export const LIVE_SEARCH_RESUME_MODES = ['off', 'prompt', 'auto'] as const;
export type LiveSearchResumeMode = (typeof LIVE_SEARCH_RESUME_MODES)[number];

/** 主控台結果展示區保留的最多筆數，超過時淘汰最舊的結果以避免官方渲染過多卡片。 */
export const LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES = [50, 100, 200, 500] as const;
export type LiveSearchMaxDisplayedResults =
  (typeof LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES)[number];

export const SUPPORTED_LOCALES = [
  'en',
  'zh-TW',
  'zh-CN',
  'ja',
  'ko',
  'ru',
  'de',
  'fr',
  'es',
  'pt',
  'th',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const SUPPORTED_UI_LOCALES = ['zh-TW', 'zh-CN', 'en'] as const;
export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

export const DISPLAY_LOCALE_VALUES = ['auto', ...SUPPORTED_LOCALES] as const;
export type DisplayLocalePreference = (typeof DISPLAY_LOCALE_VALUES)[number];

/** 舊版依遊戲版本分開儲存的詞綴顯示語系 key，依優先順序排列（已併入全域 displayLocale） */
export const LEGACY_DISPLAY_LOCALE_KEYS = [
  'affixDisplayLocale_poe2',
  'affixDisplayLocale_poe1',
  'affixDisplayLocale',
] as const;

const isDisplayLocalePreference = (value: unknown): value is DisplayLocalePreference =>
  (DISPLAY_LOCALE_VALUES as readonly unknown[]).includes(value);

/**
 * 從舊版 key 推導 displayLocale：優先採用第一個明確指定的語系，否則為 auto；
 * 沒有任何有效舊值時回傳 undefined（代表無需遷移）。
 */
export function migrateLegacyDisplayLocale(
  stored: Readonly<Record<string, unknown>>,
): DisplayLocalePreference | undefined {
  const candidates = LEGACY_DISPLAY_LOCALE_KEYS.map((key) => stored[key]).filter(
    isDisplayLocalePreference,
  );
  if (candidates.length === 0) return undefined;
  return candidates.find((c) => c !== 'auto') ?? 'auto';
}

/** 讀取已儲存的 displayLocale；缺少或無效時退回舊版 key 遷移結果，最後為 auto */
export function resolveStoredDisplayLocale(
  stored: Readonly<Record<string, unknown>> | undefined | null,
): DisplayLocalePreference {
  if (!stored) return 'auto';
  if (isDisplayLocalePreference(stored.displayLocale)) return stored.displayLocale;
  return migrateLegacyDisplayLocale(stored) ?? 'auto';
}

export const SUPPORTED_AFFIX_LOCALES = SUPPORTED_LOCALES;
export type SupportedAffixLocale = SupportedLocale;

export const AFFIX_DISPLAY_LOCALE_VALUES = DISPLAY_LOCALE_VALUES;
export type AffixDisplayLocalePreference = DisplayLocalePreference;

export interface Preferences {
  addBookmarkBtnPosition: BookmarkButtonPosition;
  /** 收合標籤可沿面板所在側邊上下拖曳，記住距離視窗頂端的位置（px） */
  collapsedTabTop: number;
  densityScale: number;
  displayLocale: DisplayLocalePreference;
  enableAffixSelector: boolean;
  enableAutoTitle: boolean;
  enableBookmarkTooltip: boolean;
  enableFilterTilde: boolean;
  enableHotkeys: boolean;
  enableItemNormalizer: boolean;
  enablePriceComparison: boolean;
  enablePureBackground: boolean;
  enableResultExternalLinks: boolean;
  enableResultModHighlight: boolean;
  enableResultModQuickFilter: boolean;
  enableResultPobCopy: boolean;
  enableSearchTilde: boolean;
  enableTierHelper: boolean;
  fontSizeScale: number;
  hotkeyClear: string;
  hotkeyFocus: string;
  liveSearchMaxDisplayedResults: LiveSearchMaxDisplayedResults;
  liveSearchResumeMode: LiveSearchResumeMode;
  liveSearchSelectedLeague: string;
  /** 主控台通知音效（ADR-0016）：播放官方 <audio>，音效與音量跟隨官方設定 */
  liveSearchSoundEnabled: boolean;
  /** 市集漢化（ADR-0012）：國際服英文市集頁以 Display Locale 的繁中或簡中顯示 */
  marketTranslation: boolean;
  /** 市集漢化的下拉選單（詞綴、通貨、物品）顯示成「中文 (English)」，中英文都搜得到 */
  marketTranslationBilingual: boolean;
  /** 市集漢化的搜尋結果詞綴在譯文下方以淡色副標顯示英文原文 */
  marketTranslationResultBilingual: boolean;
  searchEntryClickAction: SearchEntryClickAction;
  /** Sidebar Module 開關（見 utils/sidebar-modules.ts）：關閉後導覽列不顯示，相關頁面注入 UI 也停用 */
  sidebarModuleBookmarks: boolean;
  sidebarModuleHistory: boolean;
  sidebarModuleLiveSearch: boolean;
  sidebarModulePinnedItems: boolean;
  sidebarModulePobBuild: boolean;
  sidebarModuleStatGroupTemplates: boolean;
  sidebarPosition: SidebarPosition;
  sidebarWidth: number;
  theme: ThemeId;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  addBookmarkBtnPosition: 'top',
  collapsedTabTop: 100,
  densityScale: 1,
  displayLocale: 'auto',
  enableAffixSelector: true,
  enableAutoTitle: true,
  enableBookmarkTooltip: true,
  enableFilterTilde: true,
  enableHotkeys: true,
  enableItemNormalizer: true,
  enablePriceComparison: true,
  enablePureBackground: true,
  enableResultExternalLinks: true,
  enableResultModHighlight: true,
  enableResultModQuickFilter: true,
  enableResultPobCopy: true,
  enableSearchTilde: true,
  enableTierHelper: true,
  fontSizeScale: 1,
  hotkeyClear: '\\',
  hotkeyFocus: '/',
  liveSearchMaxDisplayedResults: 100,
  liveSearchResumeMode: 'prompt',
  liveSearchSelectedLeague: '',
  liveSearchSoundEnabled: true,
  marketTranslation: false,
  marketTranslationBilingual: true,
  marketTranslationResultBilingual: false,
  searchEntryClickAction: 'preview',
  sidebarModuleBookmarks: true,
  sidebarModuleHistory: true,
  sidebarModuleLiveSearch: true,
  sidebarModulePinnedItems: true,
  sidebarModulePobBuild: true,
  sidebarModuleStatGroupTemplates: true,
  sidebarPosition: 'left',
  sidebarWidth: 380,
  theme: DEFAULT_THEME_ID,
});
