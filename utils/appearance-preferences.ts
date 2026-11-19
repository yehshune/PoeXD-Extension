import {
  FONT_SIZE_PRESETS,
  FONT_SIZE_SCALE_BOUNDS,
  SIDEBAR_SIZE_PRESETS,
  SIDEBAR_WIDTH_BOUNDS,
  type FontSizeMode,
  type Preferences,
  type SidebarSize,
} from './preferences-contract';

const clamp = (value: number, bounds: { min: number; max: number }) =>
  Math.min(Math.max(value, bounds.min), bounds.max);

/**
 * 切換側欄寬度模式要寫入的偏好：預設大小直接套對應寬度；
 * 自訂沿用上次的自訂寬度，第一次切到自訂時以目前寬度作為自訂寬度。
 * 設定頁與初始導覽共用。
 */
export function planSidebarSizeChange(
  size: SidebarSize,
  current: Pick<Preferences, 'sidebarWidth' | 'customSidebarWidth'>,
): Partial<Preferences> {
  if (size !== 'custom') return { sidebarSize: size, sidebarWidth: SIDEBAR_SIZE_PRESETS[size] };
  if (current.customSidebarWidth === null) {
    return {
      sidebarSize: 'custom',
      sidebarWidth: current.sidebarWidth,
      customSidebarWidth: current.sidebarWidth,
    };
  }
  return {
    sidebarSize: 'custom',
    sidebarWidth: clamp(current.customSidebarWidth, SIDEBAR_WIDTH_BOUNDS),
  };
}

/** 切換字體大小模式要寫入的偏好；自訂的規則同 planSidebarSizeChange */
export function planFontSizeModeChange(
  mode: FontSizeMode,
  current: Pick<Preferences, 'fontSizeScale' | 'customFontSizeScale'>,
): Partial<Preferences> {
  if (mode !== 'custom') return { fontSizeMode: mode, fontSizeScale: FONT_SIZE_PRESETS[mode] };
  if (current.customFontSizeScale === null) {
    return {
      fontSizeMode: 'custom',
      fontSizeScale: current.fontSizeScale,
      customFontSizeScale: current.fontSizeScale,
    };
  }
  return {
    fontSizeMode: 'custom',
    fontSizeScale: clamp(current.customFontSizeScale, FONT_SIZE_SCALE_BOUNDS),
  };
}

/** 設定自訂字體比例；超出範圍時夾到上下限 */
export function planCustomFontSizeScale(scale: number): Partial<Preferences> {
  const clamped = clamp(scale, FONT_SIZE_SCALE_BOUNDS);
  return { fontSizeMode: 'custom', fontSizeScale: clamped, customFontSizeScale: clamped };
}
