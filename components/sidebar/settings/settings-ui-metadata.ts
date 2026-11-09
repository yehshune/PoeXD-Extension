import {
  BOOKMARK_BUTTON_POSITIONS,
  DISPLAY_LOCALE_VALUES,
  SEARCH_ENTRY_CLICK_ACTIONS,
  FONT_SIZE_MODES,
  SIDEBAR_POSITIONS,
  SIDEBAR_SIZES,
  THEME_IDS,
  type AffixDisplayLocalePreference,
  type BookmarkButtonPosition,
  type DisplayLocalePreference,
  type SearchEntryClickAction,
  type FontSizeMode,
  type SidebarPosition,
  type SidebarSize,
  type ThemeId,
} from '@/utils/preferences-contract';
import { t, type I18nKey } from '@/utils/i18n';

export interface SettingsOption<V> {
  label: string;
  value: V;
}

function createReactiveLabelMap<K extends string>(
  keys: readonly K[],
  getKey: (value: K) => I18nKey,
): Readonly<Record<K, string>> {
  const obj = {} as Record<K, string>;
  for (const key of keys) {
    Object.defineProperty(obj, key, {
      enumerable: true,
      get: () => t(getKey(key)),
    });
  }
  return Object.freeze(obj);
}

function createReactiveOptions<V extends string>(
  values: readonly V[],
  labelMap: Readonly<Record<V, string>>,
): readonly SettingsOption<V>[] {
  return Object.freeze(
    values.map((value) => {
      const opt = { value } as SettingsOption<V>;
      Object.defineProperty(opt, 'label', {
        enumerable: true,
        get: () => labelMap[value],
      });
      return Object.freeze(opt);
    }),
  );
}

export const THEME_LABELS: Readonly<Record<ThemeId, string>> = createReactiveLabelMap(
  THEME_IDS,
  (value) => `settings.theme.option.${value}`,
);

export const THEME_OPTIONS: readonly SettingsOption<ThemeId>[] = createReactiveOptions(
  THEME_IDS,
  THEME_LABELS,
);

export const SIDEBAR_POSITION_LABELS: Readonly<Record<SidebarPosition, string>> =
  createReactiveLabelMap(SIDEBAR_POSITIONS, (value) => `settings.sidebarPosition.option.${value}`);

export const SIDEBAR_POSITION_OPTIONS: readonly SettingsOption<SidebarPosition>[] =
  createReactiveOptions(SIDEBAR_POSITIONS, SIDEBAR_POSITION_LABELS);

export const SIDEBAR_SIZE_LABELS: Readonly<Record<SidebarSize, string>> = createReactiveLabelMap(
  SIDEBAR_SIZES,
  (value) => `settings.sidebarSize.option.${value}`,
);

export const SIDEBAR_SIZE_OPTIONS: readonly SettingsOption<SidebarSize>[] = createReactiveOptions(
  SIDEBAR_SIZES,
  SIDEBAR_SIZE_LABELS,
);

export const FONT_SIZE_MODE_LABELS: Readonly<Record<FontSizeMode, string>> = createReactiveLabelMap(
  FONT_SIZE_MODES,
  (value) => `settings.fontSize.option.${value}`,
);

export const FONT_SIZE_MODE_OPTIONS: readonly SettingsOption<FontSizeMode>[] =
  createReactiveOptions(FONT_SIZE_MODES, FONT_SIZE_MODE_LABELS);

export const BOOKMARK_BUTTON_POSITION_LABELS: Readonly<Record<BookmarkButtonPosition, string>> =
  createReactiveLabelMap(
    BOOKMARK_BUTTON_POSITIONS,
    (value) => `settings.bookmarkBtnPosition.option.${value}`,
  );

export const BOOKMARK_BUTTON_POSITION_OPTIONS: readonly SettingsOption<BookmarkButtonPosition>[] =
  createReactiveOptions(BOOKMARK_BUTTON_POSITIONS, BOOKMARK_BUTTON_POSITION_LABELS);

export const SEARCH_ENTRY_CLICK_ACTION_LABELS: Readonly<Record<SearchEntryClickAction, string>> =
  createReactiveLabelMap(
    SEARCH_ENTRY_CLICK_ACTIONS,
    (value) => `settings.searchEntryClickAction.option.${value}`,
  );

export const SEARCH_ENTRY_CLICK_ACTION_OPTIONS: readonly SettingsOption<SearchEntryClickAction>[] =
  createReactiveOptions(SEARCH_ENTRY_CLICK_ACTIONS, SEARCH_ENTRY_CLICK_ACTION_LABELS);

export const DISPLAY_LOCALE_LABELS: Readonly<Record<DisplayLocalePreference, string>> =
  createReactiveLabelMap(
    DISPLAY_LOCALE_VALUES,
    (value) => `settings.displayLocale.option.${value}`,
  );

export const DISPLAY_LOCALE_OPTIONS: readonly SettingsOption<DisplayLocalePreference>[] =
  createReactiveOptions(DISPLAY_LOCALE_VALUES, DISPLAY_LOCALE_LABELS);

export const AFFIX_DISPLAY_LOCALE_LABELS: Readonly<Record<AffixDisplayLocalePreference, string>> =
  DISPLAY_LOCALE_LABELS;

export const AFFIX_DISPLAY_LOCALE_OPTIONS: readonly SettingsOption<AffixDisplayLocalePreference>[] =
  DISPLAY_LOCALE_OPTIONS;
