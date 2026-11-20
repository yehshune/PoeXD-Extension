import { describe, expect, it } from 'vitest';
import {
  FONT_SIZE_PERCENT_BOUNDS,
  clampFontSizePercent,
  clampFontSizeScale,
  fontSizePercentToScale,
  fontSizeScaleToPercent,
  stepFontSizeScale,
} from '@/utils/appearance-preferences';

describe('font size scale helpers', () => {
  it('converts between scale and clamped percent', () => {
    expect(fontSizeScaleToPercent(1)).toBe(100);
    expect(fontSizeScaleToPercent(1.05)).toBe(105);
    expect(fontSizePercentToScale(105)).toBe(1.05);
    expect(fontSizePercentToScale(114.6)).toBe(1.15);
    expect(fontSizePercentToScale(50)).toBe(0.8);
    expect(clampFontSizePercent(50)).toBe(FONT_SIZE_PERCENT_BOUNDS.min);
    expect(clampFontSizePercent(300)).toBe(FONT_SIZE_PERCENT_BOUNDS.max);
    expect(clampFontSizePercent(114.6)).toBe(115);
  });

  it('clamps scale cleanly to 1% increments', () => {
    expect(clampFontSizeScale(0.2)).toBe(0.8);
    expect(clampFontSizeScale(10)).toBe(2);
    expect(clampFontSizeScale(1.15)).toBe(1.15);
  });

  it('steps scale by 5% per increment without floating-point drift and respects bounds', () => {
    expect(stepFontSizeScale(1, 1)).toBe(1.05);
    expect(stepFontSizeScale(1, -1)).toBe(0.95);
    expect(stepFontSizeScale(0.85, 1)).toBe(0.9);
    expect(stepFontSizeScale(0.8, -1)).toBe(0.8);
    expect(stepFontSizeScale(2, 1)).toBe(2);
  });
});
