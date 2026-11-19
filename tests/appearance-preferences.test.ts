import { describe, expect, it } from 'vitest';
import {
  planCustomFontSizeScale,
  planFontSizeModeChange,
  planSidebarSizeChange,
} from '@/utils/appearance-preferences';
import { FONT_SIZE_PRESETS, SIDEBAR_SIZE_PRESETS } from '@/utils/preferences-contract';

describe('planSidebarSizeChange', () => {
  it('applies the preset width for preset sizes', () => {
    expect(planSidebarSizeChange('large', { sidebarWidth: 380, customSidebarWidth: 500 })).toEqual({
      sidebarSize: 'large',
      sidebarWidth: SIDEBAR_SIZE_PRESETS.large,
    });
  });

  it('starts custom from the current width the first time', () => {
    expect(
      planSidebarSizeChange('custom', { sidebarWidth: 412, customSidebarWidth: null }),
    ).toEqual({ sidebarSize: 'custom', sidebarWidth: 412, customSidebarWidth: 412 });
  });

  it('restores the last custom width, clamped to the allowed range', () => {
    expect(
      planSidebarSizeChange('custom', { sidebarWidth: 380, customSidebarWidth: 99_999 })
        .sidebarWidth,
    ).toBeLessThan(99_999);
    expect(planSidebarSizeChange('custom', { sidebarWidth: 380, customSidebarWidth: 450 })).toEqual(
      {
        sidebarSize: 'custom',
        sidebarWidth: 450,
      },
    );
  });
});

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
