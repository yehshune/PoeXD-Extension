export const PRESET_THEME_IDS = [
  'modern-dark',
  'caffeine',
  'catppuccin',
  'graphite-hud',
  'nordic-slate',
  'tactical-olive',
  'roasted-cocoa',
  'slate-mist',
  'warm-parchment',
  'celadon-haze',
  'morandi-ash',
] as const;
export type PresetThemeId = (typeof PRESET_THEME_IDS)[number];

export const THEME_IDS = [...PRESET_THEME_IDS, 'custom'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = 'modern-dark';
export const CUSTOM_THEME_ID = 'custom' satisfies ThemeId;

export const THEME_ATTRIBUTE = 'data-poexd-theme';
export const THEME_COLOR_SCHEME_ATTRIBUTE = 'data-poexd-color-scheme';
export type ThemeColorScheme = 'light' | 'dark';

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

/** 十一個內建主題的原廠色票與圓角（供顯示與作為進入自訂時的起點） */
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
    'graphite-hud': Object.freeze({
      background: '#1e2026',
      card: '#2a2d36',
      foreground: '#eceef2',
      primary: '#f59e0b',
      destructive: '#f87171',
      radius: '0.25rem',
    }),
    'slate-mist': Object.freeze({
      background: '#cbd5e1',
      card: '#b6c3d4',
      foreground: '#0f172a',
      primary: '#1d4ed8',
      destructive: '#dc2626',
      radius: '0.25rem',
    }),
    'nordic-slate': Object.freeze({
      background: '#242933',
      card: '#313846',
      foreground: '#eceff4',
      primary: '#88c0d0',
      destructive: '#bf616a',
      radius: '0.375rem',
    }),
    'warm-parchment': Object.freeze({
      background: '#dfd8c8',
      card: '#cfc6b2',
      foreground: '#292218',
      primary: '#9a3412',
      destructive: '#b91c1c',
      radius: '0.375rem',
    }),
    'tactical-olive': Object.freeze({
      background: '#1d231f',
      card: '#29322c',
      foreground: '#e6ece8',
      primary: '#6ee7b7',
      destructive: '#fb7185',
      radius: '0rem',
    }),
    'celadon-haze': Object.freeze({
      background: '#ced8d2',
      card: '#b9c7bf',
      foreground: '#14241d',
      primary: '#0f766e',
      destructive: '#be123c',
      radius: '0.5rem',
    }),
    'roasted-cocoa': Object.freeze({
      background: '#241e1b',
      card: '#332a26',
      foreground: '#f2eae4',
      primary: '#e09f67',
      destructive: '#e56b6f',
      radius: '0.375rem',
    }),
    'morandi-ash': Object.freeze({
      background: '#d4cdd3',
      card: '#c1b8c0',
      foreground: '#1f1921',
      primary: '#6d28d9',
      destructive: '#be185d',
      radius: '0.5rem',
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

/** OKLab 感知亮度門檻：高於此值視為淺色底，配深色字並啟用亮色語意調整 */
export const OKLAB_LIGHT_THRESHOLD = 0.65;

/** 判斷 `#rrggbb` 是否屬於淺色 */
export function isLightColor(hex: string): boolean {
  return getOklabLightness(hex) > OKLAB_LIGHT_THRESHOLD;
}

/** 依背景色亮度推導 `light` 或 `dark` 色彩方案 */
export function resolveColorSchemeForHex(hex: string): ThemeColorScheme {
  return isLightColor(hex) ? 'light' : 'dark';
}

/** 底色亮時配深色字、暗時配白字 */
export function pickContrastForeground(hex: string): string {
  return isLightColor(hex) ? 'oklch(0.2 0 0)' : 'oklch(1 0 0)';
}

const RADIUS_ALIAS_MAP: Readonly<Record<string, ThemeCustomRadius>> = Object.freeze({
  '0': '0rem',
  '0px': '0rem',
  '0rem': '0rem',
  直角: '0rem',
  sharp: '0rem',
  '4px': '0.25rem',
  '0.25rem': '0.25rem',
  微圓: '0.25rem',
  subtle: '0.25rem',
  '6px': '0.375rem',
  '0.375rem': '0.375rem',
  標準: '0.375rem',
  standard: '0.375rem',
  '8px': '0.5rem',
  '0.5rem': '0.5rem',
  圓潤: '0.5rem',
  rounded: '0.5rem',
});

function resolveRadiusAlias(value: unknown): ThemeCustomRadius | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  if (isValidThemeCustomRadius(key)) return key;
  return RADIUS_ALIAS_MAP[key] ?? RADIUS_ALIAS_MAP[value.trim()];
}

/**
 * 解析使用者貼上的自訂主題 JSON。
 * 同時相容內部格式 `{ background, card, foreground, primary, destructive, radius }`
 * 以及常見設計系統格式 `{ colors: { background, surface, text, primary, danger }, radius }`。
 */
export function parseThemeImportJson(raw: string): ThemePresetValues | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const colorsSource =
    record.colors && typeof record.colors === 'object' && !Array.isArray(record.colors)
      ? (record.colors as Record<string, unknown>)
      : record;

  const picked: ThemeOverride = {};
  const mapField = (target: ThemeCustomColorKey, aliases: readonly string[]) => {
    for (const alias of aliases) {
      const val = colorsSource[alias];
      if (isValidHexColor(val)) {
        picked[target] = val.toLowerCase();
        return;
      }
    }
  };

  mapField('background', ['background', 'bg']);
  mapField('card', ['card', 'surface']);
  mapField('foreground', ['foreground', 'text']);
  mapField('primary', ['primary']);
  mapField('destructive', ['destructive', 'danger']);

  const radius = resolveRadiusAlias(record.radius ?? colorsSource.radius);
  if (radius) picked.radius = radius;

  if (Object.keys(picked).length === 0) return null;
  return {
    ...DEFAULT_CUSTOM_THEME_VALUES,
    ...picked,
  };
}
