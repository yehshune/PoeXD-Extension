import {
  DEFAULT_THEME_ID,
  DEFAULT_THEME_OVERRIDES_JSON,
  THEME_CUSTOM_RADIUS_VALUES,
  THEME_IDS,
  type ThemeCustomRadius,
  type ThemeId,
  isValidHexColor,
  isValidThemeCustomRadius,
  isValidThemeId,
  isValidThemeOverridesJson,
  normalizeThemeId,
  normalizeThemeOverridesJson,
} from '@/lib/theme/theme-contract';
import type { PoeVersion } from './trade-context';

export {
  DEFAULT_THEME_ID,
  DEFAULT_THEME_OVERRIDES_JSON,
  THEME_CUSTOM_RADIUS_VALUES,
  THEME_IDS,
  type ThemeCustomRadius,
  type ThemeId,
  isValidHexColor,
  isValidThemeCustomRadius,
  isValidThemeId,
  isValidThemeOverridesJson,
  normalizeThemeId,
  normalizeThemeOverridesJson,
};

export const SIDEBAR_POSITIONS = ['left', 'right'] as const;
export type SidebarPosition = (typeof SIDEBAR_POSITIONS)[number];

export const BOOKMARK_BUTTON_POSITIONS = ['top', 'bottom'] as const;
export type BookmarkButtonPosition = (typeof BOOKMARK_BUTTON_POSITIONS)[number];

/** 左鍵點選書籤或搜尋歷史時：開啟搜尋，或切換 Search Preview（見 GLOSSARY.md）。 */
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

export const LIVE_SEARCH_RESUME_MODES = ['off', 'prompt', 'auto'] as const;
export type LiveSearchResumeMode = (typeof LIVE_SEARCH_RESUME_MODES)[number];

/** 主控台結果展示區保留的最多筆數，超過時淘汰最舊的結果以避免官方渲染過多卡片。 */
export const LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES = [50, 100, 200, 500] as const;
export type LiveSearchMaxDisplayedResults =
  (typeof LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES)[number];

/** 主控台在速率受限排隊時的抓取順序：最新優先（LIFO）或依序（FIFO）。 */
export const LIVE_SEARCH_FETCH_ORDER_VALUES = ['newest', 'oldest'] as const;
export type LiveSearchFetchOrder = (typeof LIVE_SEARCH_FETCH_ORDER_VALUES)[number];

/**
 * 主控台待抓取物品排隊最多等待的秒數。官方推播 token 約 7 秒後失效，超過 7 秒沒有意義；
 * 好物品常在數秒內被買走，預設 1 秒。
 */
export const LIVE_SEARCH_TOKEN_MAX_AGE_BOUNDS = Object.freeze({
  min: 1,
  max: 7,
});
export type LiveSearchTokenMaxAgeSec = number;

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
  /** 主控台桌面通知：背景或未聚焦時透過瀏覽器原生 Notification API 提示新結果 */
  liveSearchDesktopNotificationEnabled: boolean;
  /** 主控台在速率受限排隊時的抓取順序 */
  liveSearchFetchOrder: LiveSearchFetchOrder;
  liveSearchMaxDisplayedResults: LiveSearchMaxDisplayedResults;
  liveSearchResumeMode: LiveSearchResumeMode;
  liveSearchSelectedLeague: string;
  /** 主控台通知音效（ADR-0016）：播放官方 <audio>，音效與音量跟隨官方設定 */
  liveSearchSoundEnabled: boolean;
  /** 主控台待抓取物品的新鮮度上限（秒）；0 代表不丟棄 */
  liveSearchTokenMaxAgeSec: LiveSearchTokenMaxAgeSec;
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
  sidebarModuleResultBoard: boolean;
  sidebarModuleStatGroupTemplates: boolean;
  sidebarPosition: SidebarPosition;
  sidebarWidth: number;
  theme: ThemeId;
  /** 各主題獨立保存的色彩與圓角覆寫（正規化 JSON 字串） */
  themeCustomOverrides: string;
}

export type PreferenceScope = 'global' | 'versioned';

export interface PreferenceDescriptor<T> {
  readonly scope: PreferenceScope;
  readonly default: T;
  readonly validate: (value: unknown) => boolean;
  readonly normalize?: (value: unknown) => T;
  /** 標記曾經依遊戲版本（`${name}_poe1` / `${name}_poe2`）儲存、現已併入全域的偏好 */
  readonly legacyVersionedGlobal?: true;
  /** 需於初始化時一併讀取的舊版儲存 key */
  readonly legacyKeys?: readonly string[];
  /** 當目前 key 未設定時，從舊版儲存資料推導遷移值；無需遷移時回傳 undefined */
  readonly legacyMigrate?: (stored: Readonly<Record<string, unknown>>) => T | undefined;
}

type PreferenceSchemaMap = {
  readonly [K in keyof Preferences]: PreferenceDescriptor<Preferences[K]>;
};

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isString = (value: unknown): value is string => typeof value === 'string';
const isOneOf =
  <T extends readonly unknown[]>(values: T) =>
  (value: unknown): value is T[number] =>
    values.includes(value);
const isFiniteNumberInRange =
  (bounds: Readonly<{ min: number; max: number }>) =>
  (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= bounds.min &&
    value <= bounds.max;
const isIntegerInRange =
  (bounds: Readonly<{ min: number; max: number }>) =>
  (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max;

/** 舊版允許 0（不限）與最多 300 秒：0 或超過上限都視為「等到官方期限」，換成上限 */
const normalizeTokenMaxAgeSec = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 1;
  if (value === 0) return LIVE_SEARCH_TOKEN_MAX_AGE_BOUNDS.max;
  return Math.min(
    LIVE_SEARCH_TOKEN_MAX_AGE_BOUNDS.max,
    Math.max(LIVE_SEARCH_TOKEN_MAX_AGE_BOUNDS.min, Math.round(value)),
  );
};

const isDensityScale = isOneOf(DENSITY_SCALE_VALUES);
const normalizeDensityScale = (value: unknown): number => {
  if (isDensityScale(value)) return value;
  if (value === 0.7 || value === 0.85) return 0.8;
  if (value === 1.15) return 1;
  return 1;
};

/**
 * 單一宣告式 Preference schema：集中宣告每個偏好的 scope、預設值、驗證器、
 * 正規化與舊版遷移規則；預設值表、全域白名單與驗證邏輯皆由此推導。
 */
export const PREFERENCE_SCHEMA = Object.freeze({
  theme: {
    scope: 'global',
    default: DEFAULT_THEME_ID,
    validate: isValidThemeId,
    normalize: normalizeThemeId,
  },
  themeCustomOverrides: {
    scope: 'global',
    default: DEFAULT_THEME_OVERRIDES_JSON,
    validate: isValidThemeOverridesJson,
    normalize: normalizeThemeOverridesJson,
  },
  displayLocale: {
    scope: 'global',
    default: 'auto',
    validate: isDisplayLocalePreference,
    legacyKeys: LEGACY_DISPLAY_LOCALE_KEYS,
    legacyMigrate: migrateLegacyDisplayLocale,
  },
  marketTranslation: {
    scope: 'global',
    default: false,
    validate: isBoolean,
  },
  marketTranslationBilingual: {
    scope: 'global',
    default: true,
    validate: isBoolean,
  },
  marketTranslationResultBilingual: {
    scope: 'global',
    default: false,
    validate: isBoolean,
  },
  collapsedTabTop: {
    scope: 'global',
    default: 100,
    validate: isFiniteNumberInRange(COLLAPSED_TAB_TOP_BOUNDS),
    legacyVersionedGlobal: true,
  },
  sidebarPosition: {
    scope: 'global',
    default: 'left',
    validate: isOneOf(SIDEBAR_POSITIONS),
    legacyVersionedGlobal: true,
  },
  sidebarWidth: {
    scope: 'global',
    default: 380,
    validate: isFiniteNumberInRange(SIDEBAR_WIDTH_BOUNDS),
    legacyVersionedGlobal: true,
  },
  fontSizeScale: {
    scope: 'global',
    default: 1,
    validate: isFiniteNumberInRange(FONT_SIZE_SCALE_BOUNDS),
    legacyVersionedGlobal: true,
  },
  densityScale: {
    scope: 'global',
    default: 1,
    validate: isDensityScale,
    normalize: normalizeDensityScale,
    legacyVersionedGlobal: true,
  },
  enablePureBackground: {
    scope: 'global',
    default: false,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableAutoTitle: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableHotkeys: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  hotkeyFocus: {
    scope: 'global',
    default: '/',
    validate: isString,
    legacyVersionedGlobal: true,
  },
  hotkeyClear: {
    scope: 'global',
    default: '\\',
    validate: isString,
    legacyVersionedGlobal: true,
  },
  enableSearchTilde: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableFilterTilde: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  addBookmarkBtnPosition: {
    scope: 'global',
    default: 'top',
    validate: isOneOf(BOOKMARK_BUTTON_POSITIONS),
    legacyVersionedGlobal: true,
  },
  searchEntryClickAction: {
    scope: 'global',
    default: 'preview',
    validate: isOneOf(SEARCH_ENTRY_CLICK_ACTIONS),
    legacyVersionedGlobal: true,
  },
  enableBookmarkTooltip: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableAffixSelector: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enablePriceComparison: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableResultExternalLinks: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableResultModHighlight: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableResultModQuickFilter: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableResultPobCopy: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableTierHelper: {
    scope: 'global',
    default: true,
    validate: isBoolean,
    legacyVersionedGlobal: true,
  },
  enableItemNormalizer: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  liveSearchDesktopNotificationEnabled: {
    scope: 'versioned',
    default: false,
    validate: isBoolean,
  },
  liveSearchFetchOrder: {
    scope: 'versioned',
    default: 'newest',
    validate: isOneOf(LIVE_SEARCH_FETCH_ORDER_VALUES),
  },
  liveSearchMaxDisplayedResults: {
    scope: 'versioned',
    default: 100,
    validate: isOneOf(LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES),
  },
  liveSearchResumeMode: {
    scope: 'versioned',
    default: 'prompt',
    validate: isOneOf(LIVE_SEARCH_RESUME_MODES),
  },
  liveSearchSelectedLeague: {
    scope: 'versioned',
    default: '',
    validate: isString,
  },
  liveSearchSoundEnabled: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  liveSearchTokenMaxAgeSec: {
    scope: 'versioned',
    default: 1,
    validate: isIntegerInRange(LIVE_SEARCH_TOKEN_MAX_AGE_BOUNDS),
    normalize: normalizeTokenMaxAgeSec,
  },
  sidebarModuleBookmarks: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  sidebarModuleHistory: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  sidebarModuleLiveSearch: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  sidebarModulePinnedItems: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  sidebarModulePobBuild: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  sidebarModuleResultBoard: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
  sidebarModuleStatGroupTemplates: {
    scope: 'versioned',
    default: true,
    validate: isBoolean,
  },
} as const satisfies PreferenceSchemaMap);

type PreferenceSchema = typeof PREFERENCE_SCHEMA;

export type PreferenceName = keyof Preferences;
export type GlobalPreferenceName = {
  [K in keyof PreferenceSchema]: PreferenceSchema[K]['scope'] extends 'global' ? K : never;
}[keyof PreferenceSchema];
export type VersionedPreferenceName = Exclude<PreferenceName, GlobalPreferenceName>;
export type LegacyVersionedGlobalPreferenceName = {
  [K in keyof PreferenceSchema]: PreferenceSchema[K] extends { legacyVersionedGlobal: true }
    ? K
    : never;
}[keyof PreferenceSchema];
export type GlobalPreferences = Pick<Preferences, GlobalPreferenceName>;
export type VersionedPreferences = Pick<Preferences, VersionedPreferenceName>;

export const PREFERENCE_NAMES: readonly PreferenceName[] = Object.freeze(
  Object.keys(PREFERENCE_SCHEMA) as PreferenceName[],
);

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze(
  Object.fromEntries(
    PREFERENCE_NAMES.map((name) => [name, PREFERENCE_SCHEMA[name].default]),
  ) as unknown as Preferences,
);

export const GLOBAL_PREFERENCE_NAMES: readonly GlobalPreferenceName[] = Object.freeze(
  PREFERENCE_NAMES.filter(
    (name): name is GlobalPreferenceName => PREFERENCE_SCHEMA[name].scope === 'global',
  ),
);

const GLOBAL_PREFERENCE_NAME_SET = new Set<string>(GLOBAL_PREFERENCE_NAMES);

/** 曾經依遊戲版本（`${name}_poe1` / `${name}_poe2`）儲存、現已併入全域的偏好名稱 */
export const LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES: readonly LegacyVersionedGlobalPreferenceName[] =
  Object.freeze(
    PREFERENCE_NAMES.filter(
      (name): name is LegacyVersionedGlobalPreferenceName =>
        'legacyVersionedGlobal' in PREFERENCE_SCHEMA[name] &&
        PREFERENCE_SCHEMA[name].legacyVersionedGlobal === true,
    ),
  );

export function isGlobalPreference(name: string): name is GlobalPreferenceName {
  return GLOBAL_PREFERENCE_NAME_SET.has(name);
}

export function getPreferenceStorageKey(name: keyof Preferences, version: PoeVersion): string {
  return isGlobalPreference(name) ? name : `${name}_${version}`;
}

const PREFERENCE_SCHEMA_MAP: PreferenceSchemaMap = PREFERENCE_SCHEMA;

export function isValidPreference(name: keyof Preferences, value: unknown): boolean {
  if (!Object.prototype.hasOwnProperty.call(PREFERENCE_SCHEMA, name)) return false;
  return PREFERENCE_SCHEMA_MAP[name].validate(value);
}

export function normalizePreference<K extends keyof Preferences>(
  name: K,
  value: unknown,
): Preferences[K] {
  const descriptor = PREFERENCE_SCHEMA_MAP[name];
  if (descriptor.normalize) return descriptor.normalize(value);
  return descriptor.validate(value) ? (value as Preferences[K]) : descriptor.default;
}
