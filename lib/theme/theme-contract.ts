export const PRESET_THEME_IDS = ['modern-dark', 'caffeine', 'catppuccin'] as const;
export type PresetThemeId = (typeof PRESET_THEME_IDS)[number];

export const THEME_IDS = [...PRESET_THEME_IDS, 'custom'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = 'modern-dark';

/** 玩家自選色的主題：由種子色與圓角推導完整語意色 */
export const CUSTOM_THEME_ID = 'custom' satisfies ThemeId;

export const THEME_ATTRIBUTE = 'data-poexd-theme';

export function isValidThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly unknown[]).includes(value);
}

export function normalizeThemeId(value: unknown): ThemeId {
  return isValidThemeId(value) ? value : DEFAULT_THEME_ID;
}

/** 自訂主題的圓角段位（0px / 4px / 6px / 8px） */
export const THEME_CUSTOM_RADIUS_VALUES = ['0rem', '0.25rem', '0.375rem', '0.5rem'] as const;
export type ThemeCustomRadius = (typeof THEME_CUSTOM_RADIUS_VALUES)[number];

export const DEFAULT_THEME_CUSTOM_RADIUS: ThemeCustomRadius = '0.375rem';

export function isValidThemeCustomRadius(value: unknown): value is ThemeCustomRadius {
  return (
    typeof value === 'string' && (THEME_CUSTOM_RADIUS_VALUES as readonly unknown[]).includes(value)
  );
}

export function normalizeThemeCustomRadius(value: unknown): ThemeCustomRadius {
  return isValidThemeCustomRadius(value) ? value : DEFAULT_THEME_CUSTOM_RADIUS;
}

/** 自訂主題的五個種子色，皆為 `#rrggbb` */
export interface ThemeCustomColors {
  background: string;
  card: string;
  foreground: string;
  primary: string;
  destructive: string;
}

export interface ThemeCustomPreset extends ThemeCustomColors {
  radius: ThemeCustomRadius;
}

export const THEME_CUSTOM_COLOR_KEYS = [
  'background',
  'card',
  'foreground',
  'primary',
  'destructive',
] as const;
export type ThemeCustomColorKey = (typeof THEME_CUSTOM_COLOR_KEYS)[number];

/** 各內建預設主題對應的自訂起始值，方便玩家一鍵帶入後微調 */
export const THEME_CUSTOM_PRESETS: Readonly<Record<PresetThemeId, Readonly<ThemeCustomPreset>>> =
  Object.freeze({
    'modern-dark': Object.freeze({
      background: '#171717',
      card: '#262626',
      foreground: '#e5e5e5',
      primary: '#3b82f6',
      destructive: '#ef4444',
      radius: '0.375rem',
    }),
    caffeine: Object.freeze({
      background: '#111111',
      card: '#191919',
      foreground: '#eeeeee',
      primary: '#f0d1b4',
      destructive: '#e54d2e',
      radius: '0.5rem',
    }),
    catppuccin: Object.freeze({
      background: '#181825',
      card: '#1e1e2e',
      foreground: '#cdd6f4',
      primary: '#cba6f7',
      destructive: '#f38ba8',
      radius: '0.375rem',
    }),
  });

/** 預設值取自 modern-dark 的對應色，切到自訂時畫面不會突然變色 */
export const DEFAULT_THEME_CUSTOM_COLORS: Readonly<ThemeCustomColors> = Object.freeze({
  background: THEME_CUSTOM_PRESETS['modern-dark'].background,
  card: THEME_CUSTOM_PRESETS['modern-dark'].card,
  foreground: THEME_CUSTOM_PRESETS['modern-dark'].foreground,
  primary: THEME_CUSTOM_PRESETS['modern-dark'].primary,
  destructive: THEME_CUSTOM_PRESETS['modern-dark'].destructive,
});

/** 寫在 host inline style 上、供 main.css 的 custom 區塊讀取的種子變數 */
export const THEME_SEED_VARIABLES = Object.freeze({
  background: '--pxd-seed-background',
  card: '--pxd-seed-card',
  foreground: '--pxd-seed-foreground',
  primary: '--pxd-seed-primary',
  primaryForeground: '--pxd-seed-primary-foreground',
  destructive: '--pxd-seed-destructive',
  destructiveForeground: '--pxd-seed-destructive-foreground',
  radius: '--pxd-seed-radius',
} as const);

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  return isValidHexColor(value) ? value.toLowerCase() : fallback;
}

export function normalizeThemeCustomColors(
  value: Partial<Record<ThemeCustomColorKey, unknown>> | null | undefined,
): ThemeCustomColors {
  return {
    background: normalizeHexColor(value?.background, DEFAULT_THEME_CUSTOM_COLORS.background),
    card: normalizeHexColor(value?.card, DEFAULT_THEME_CUSTOM_COLORS.card),
    foreground: normalizeHexColor(value?.foreground, DEFAULT_THEME_CUSTOM_COLORS.foreground),
    primary: normalizeHexColor(value?.primary, DEFAULT_THEME_CUSTOM_COLORS.primary),
    destructive: normalizeHexColor(value?.destructive, DEFAULT_THEME_CUSTOM_COLORS.destructive),
  };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** OKLab 感知亮度（0–1），用來決定主色與危險色上的文字該用黑或白 */
export function getOklabLightness(hex: string): number {
  const normalized = normalizeHexColor(hex, '#000000');
  const r = srgbChannelToLinear(Number.parseInt(normalized.slice(1, 3), 16));
  const g = srgbChannelToLinear(Number.parseInt(normalized.slice(3, 5), 16));
  const b = srgbChannelToLinear(Number.parseInt(normalized.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** 底色亮時配深色字、暗時配白字 */
export function pickContrastForeground(hex: string): string {
  return getOklabLightness(hex) > 0.7 ? 'oklch(0.2 0 0)' : 'oklch(1 0 0)';
}
