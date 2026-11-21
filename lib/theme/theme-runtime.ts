import {
  CUSTOM_THEME_ID,
  THEME_ATTRIBUTE,
  THEME_SEED_VARIABLES,
  normalizeThemeCustomColors,
  normalizeThemeCustomRadius,
  normalizeThemeId,
  pickContrastForeground,
  type ThemeCustomColorKey,
} from './theme-contract';
import { registerThemeHost, syncPageThemeBridge } from './page-theme-bridge';

export type ThemeCustomColorsInput = Partial<Record<ThemeCustomColorKey | 'radius', unknown>>;

/** 偏好快照中與自訂主題相關的欄位 */
export interface ThemeCustomColorPreferences {
  themeCustomBackground?: unknown;
  themeCustomCard?: unknown;
  themeCustomForeground?: unknown;
  themeCustomPrimary?: unknown;
  themeCustomDestructive?: unknown;
  themeCustomRadius?: unknown;
}

export function readThemeCustomColors(
  prefs: ThemeCustomColorPreferences | null | undefined,
): ThemeCustomColorsInput {
  return {
    background: prefs?.themeCustomBackground,
    card: prefs?.themeCustomCard,
    foreground: prefs?.themeCustomForeground,
    primary: prefs?.themeCustomPrimary,
    destructive: prefs?.themeCustomDestructive,
    radius: prefs?.themeCustomRadius,
  };
}

function applySeedVariables(host: HTMLElement, customColors: ThemeCustomColorsInput | undefined) {
  const colors = normalizeThemeCustomColors(customColors);
  const radius = normalizeThemeCustomRadius(customColors?.radius);
  host.style.setProperty(THEME_SEED_VARIABLES.background, colors.background);
  host.style.setProperty(THEME_SEED_VARIABLES.card, colors.card);
  host.style.setProperty(THEME_SEED_VARIABLES.foreground, colors.foreground);
  host.style.setProperty(THEME_SEED_VARIABLES.primary, colors.primary);
  host.style.setProperty(
    THEME_SEED_VARIABLES.primaryForeground,
    pickContrastForeground(colors.primary),
  );
  host.style.setProperty(THEME_SEED_VARIABLES.destructive, colors.destructive);
  host.style.setProperty(
    THEME_SEED_VARIABLES.destructiveForeground,
    pickContrastForeground(colors.destructive),
  );
  host.style.setProperty(THEME_SEED_VARIABLES.radius, radius);
}

function clearSeedVariables(host: HTMLElement) {
  for (const name of Object.values(THEME_SEED_VARIABLES)) {
    host.style.removeProperty(name);
  }
}

export function applyThemeToHost(
  host: HTMLElement | null | undefined,
  theme: unknown,
  customColors?: ThemeCustomColorsInput,
): void {
  if (!host) return;
  const normalized = normalizeThemeId(theme);
  if (normalized === CUSTOM_THEME_ID) applySeedVariables(host, customColors);
  else clearSeedVariables(host);
  host.setAttribute(THEME_ATTRIBUTE, normalized);
  registerThemeHost(host);
  // 只改自訂色或圓角時主題屬性不變，需主動重新同步頁面注入控制項的配色
  if (normalized === CUSTOM_THEME_ID) syncPageThemeBridge(host);
}
