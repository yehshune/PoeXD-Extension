export const THEME_IDS = ['modern-dark', 'caffeine', 'catppuccin'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = 'modern-dark';

export const THEME_ATTRIBUTE = 'data-poexd-theme';

export function isValidThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly unknown[]).includes(value);
}

export function normalizeThemeId(value: unknown): ThemeId {
  return isValidThemeId(value) ? value : DEFAULT_THEME_ID;
}
