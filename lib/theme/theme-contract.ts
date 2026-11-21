export const PRESET_THEME_IDS = ['modern-dark', 'caffeine', 'catppuccin'] as const;
export type PresetThemeId = (typeof PRESET_THEME_IDS)[number];

export const THEME_IDS = [...PRESET_THEME_IDS, 'custom'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = 'modern-dark';
export const CUSTOM_THEME_ID = 'custom' satisfies ThemeId;

export const THEME_ATTRIBUTE = 'data-poexd-theme';

export function isValidThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly unknown[]).includes(value);
}

export function isPresetThemeId(value: unknown): value is PresetThemeId {
  return typeof value === 'string' && (PRESET_THEME_IDS as readonly unknown[]).includes(value);
}

export function normalizeThemeId(value: unknown): ThemeId {
  return isValidThemeId(value) ? value : DEFAULT_THEME_ID;
}

/** 主題圓角段位（0px / 4px / 6px / 8px） */
export const THEME_CUSTOM_RADIUS_VALUES = ['0rem', '0.25rem', '0.375rem', '0.5rem'] as const;
export type ThemeCustomRadius = (typeof THEME_CUSTOM_RADIUS_VALUES)[number];

export const DEFAULT_THEME_CUSTOM_RADIUS: ThemeCustomRadius = '0.375rem';

export function isValidThemeCustomRadius(value: unknown): value is ThemeCustomRadius {
  return (
    typeof value === 'string' && (THEME_CUSTOM_RADIUS_VALUES as readonly unknown[]).includes(value)
  );
}

/** 主題五個核心色，皆為 `#rrggbb` */
export interface ThemeCustomColors {
  background: string;
  card: string;
  foreground: string;
  primary: string;
  destructive: string;
}

export interface ThemePresetValues extends ThemeCustomColors {
  radius: ThemeCustomRadius;
}

export type ThemeOverride = Partial<ThemePresetValues>;

export const THEME_CUSTOM_COLOR_KEYS = [
  'background',
  'card',
  'foreground',
  'primary',
  'destructive',
] as const;
export type ThemeCustomColorKey = (typeof THEME_CUSTOM_COLOR_KEYS)[number];

export const DEFAULT_THEME_OVERRIDES_JSON = '{}';

/** 三個內建主題的原廠色票與圓角（供顯示與作為進入自訂時的起點） */
export const THEME_PRESETS: Readonly<Record<PresetThemeId, Readonly<ThemePresetValues>>> =
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

export const DEFAULT_CUSTOM_THEME_VALUES: Readonly<ThemePresetValues> =
  THEME_PRESETS['modern-dark'];

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function normalizeCustomThemeOverride(raw: unknown): ThemeOverride {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const out: ThemeOverride = {};

  for (const key of THEME_CUSTOM_COLOR_KEYS) {
    const val = record[key];
    if (!isValidHexColor(val)) continue;
    const hex = val.toLowerCase();
    if (hex !== DEFAULT_CUSTOM_THEME_VALUES[key]) out[key] = hex;
  }
  if (
    isValidThemeCustomRadius(record.radius) &&
    record.radius !== DEFAULT_CUSTOM_THEME_VALUES.radius
  ) {
    out.radius = record.radius;
  }
  return out;
}

export function parseCustomThemeOverride(raw: unknown): ThemeOverride {
  if (typeof raw !== 'string') return normalizeCustomThemeOverride(raw);
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '{}') return {};
  try {
    return normalizeCustomThemeOverride(JSON.parse(trimmed));
  } catch {
    return {};
  }
}

export function serializeCustomThemeOverride(override: ThemeOverride): string {
  const normalized = normalizeCustomThemeOverride(override);
  return Object.keys(normalized).length === 0
    ? DEFAULT_THEME_OVERRIDES_JSON
    : JSON.stringify(normalized);
}

export function isValidThemeOverridesJson(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function normalizeThemeOverridesJson(value: unknown): string {
  return serializeCustomThemeOverride(parseCustomThemeOverride(value));
}

export function parseCustomThemeValues(raw: unknown): ThemePresetValues {
  return {
    ...DEFAULT_CUSTOM_THEME_VALUES,
    ...parseCustomThemeOverride(raw),
  };
}

export function resolveThemeEffectiveValues(
  themeId: ThemeId,
  customRaw: unknown,
): ThemePresetValues {
  if (isPresetThemeId(themeId)) {
    return { ...THEME_PRESETS[themeId] };
  }
  return parseCustomThemeValues(customRaw);
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** OKLab 感知亮度（0–1），用來決定主色與危險色上的文字該用黑或白 */
export function getOklabLightness(hex: string): number {
  const normalized = isValidHexColor(hex) ? hex.toLowerCase() : '#000000';
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
