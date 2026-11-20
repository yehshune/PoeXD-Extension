import {
  DEFAULT_PREFERENCES,
  FONT_SIZE_PERCENT_STEP,
  FONT_SIZE_SCALE_BOUNDS,
} from './preferences-contract';

export const FONT_SIZE_PERCENT_BOUNDS = Object.freeze({
  min: Math.round(FONT_SIZE_SCALE_BOUNDS.min * 100),
  max: Math.round(FONT_SIZE_SCALE_BOUNDS.max * 100),
});

export const DEFAULT_FONT_SIZE_PERCENT = Math.round(DEFAULT_PREFERENCES.fontSizeScale * 100);

/** 將縮放倍率轉成整數百分比（例如 1.05 → 105） */
export function fontSizeScaleToPercent(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_FONT_SIZE_PERCENT;
  return Math.round(scale * 100);
}

/** 將百分比夾在允許的縮放範圍內並取整數 */
export function clampFontSizePercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_FONT_SIZE_PERCENT;
  const rounded = Math.round(percent);
  return Math.min(Math.max(rounded, FONT_SIZE_PERCENT_BOUNDS.min), FONT_SIZE_PERCENT_BOUNDS.max);
}

/** 將縮放倍率夾在允許範圍內並維持 1% 精度 */
export function clampFontSizeScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_PREFERENCES.fontSizeScale;
  return clampFontSizePercent(scale * 100) / 100;
}

/** 依步進次數（每次 5%）增減縮放倍率並夾在上下限內 */
export function stepFontSizeScale(scale: number, deltaSteps: number): number {
  const currentPercent = fontSizeScaleToPercent(scale);
  const nextPercent = clampFontSizePercent(currentPercent + deltaSteps * FONT_SIZE_PERCENT_STEP);
  return nextPercent / 100;
}
