import { describe, expect, it } from 'vitest';
import { planCustomFontSizeScale, planFontSizeModeChange } from '@/utils/appearance-preferences';
import { FONT_SIZE_PRESETS } from '@/utils/preferences-contract';

describe('font size planning', () => {
  it('applies the preset scale for preset modes', () => {
    expect(planFontSizeModeChange('small', { fontSizeScale: 1, customFontSizeScale: 1.3 })).toEqual(
      {
        fontSizeMode: 'small',
        fontSizeScale: FONT_SIZE_PRESETS.small,
      },
    );
  });

  it('starts custom from the current scale the first time', () => {
    expect(
      planFontSizeModeChange('custom', { fontSizeScale: 1.1, customFontSizeScale: null }),
    ).toEqual({ fontSizeMode: 'custom', fontSizeScale: 1.1, customFontSizeScale: 1.1 });
  });

  it('clamps a custom scale and remembers it', () => {
    const plan = planCustomFontSizeScale(10);
    expect(plan.fontSizeMode).toBe('custom');
    expect(plan.fontSizeScale).toBe(plan.customFontSizeScale);
    expect(plan.fontSizeScale).toBeLessThan(10);
  });
});
