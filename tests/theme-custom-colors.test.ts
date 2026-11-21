// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUSTOM_THEME_VALUES,
  DEFAULT_THEME_OVERRIDES_JSON,
  PRESET_THEME_IDS,
  THEME_ATTRIBUTE,
  THEME_CUSTOM_RADIUS_VALUES,
  THEME_PRESETS,
  getOklabLightness,
  isValidHexColor,
  isValidThemeCustomRadius,
  isValidThemeOverridesJson,
  normalizeThemeOverridesJson,
  parseCustomThemeOverride,
  parseCustomThemeValues,
  pickContrastForeground,
  resolveThemeEffectiveValues,
  serializeCustomThemeOverride,
} from '@/lib/theme/theme-contract';
import {
  THEME_OVERRIDE_CSS_VARIABLES,
  applyThemeFromPreferences,
  applyThemeToHost,
  previewThemeOverrideOnHost,
} from '@/lib/theme/theme-runtime';
import { PAGE_THEME_BRIDGE_STYLE_ID, cleanupPageThemeBridge } from '@/lib/theme/page-theme-bridge';
import { DEFAULT_PREFERENCES } from '@/utils/preferences-contract';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';

describe('Standalone custom theme slot + 3 built-in presets', () => {
  describe('contract', () => {
    it('validates #rrggbb hex colors and radius steps', () => {
      expect(isValidHexColor('#1a2B3c')).toBe(true);
      expect(isValidHexColor('#fff')).toBe(false);
      expect(isValidHexColor('oklch(0.5 0 0)')).toBe(false);

      for (const radius of THEME_CUSTOM_RADIUS_VALUES) {
        expect(isValidThemeCustomRadius(radius)).toBe(true);
      }
      expect(isValidThemeCustomRadius('1rem')).toBe(false);
    });

    it('provides valid factory defaults for all 3 built-in presets', () => {
      for (const presetId of PRESET_THEME_IDS) {
        const preset = THEME_PRESETS[presetId];
        expect(isValidHexColor(preset.background)).toBe(true);
        expect(isValidHexColor(preset.card)).toBe(true);
        expect(isValidHexColor(preset.foreground)).toBe(true);
        expect(isValidHexColor(preset.primary)).toBe(true);
        expect(isValidHexColor(preset.destructive)).toBe(true);
        expect(isValidThemeCustomRadius(preset.radius)).toBe(true);
      }
    });

    it('strips default-equal fields and normalizes custom override JSON', () => {
      const json = serializeCustomThemeOverride({
        background: DEFAULT_CUSTOM_THEME_VALUES.background, // default -> stripped
        primary: '#FF8800', // normalized to lowercase
        radius: '0rem',
      });
      expect(parseCustomThemeOverride(json)).toEqual({
        primary: '#ff8800',
        radius: '0rem',
      });
      expect(parseCustomThemeValues(json)).toEqual({
        ...DEFAULT_CUSTOM_THEME_VALUES,
        primary: '#ff8800',
        radius: '0rem',
      });
    });

    it('validates and repairs themeCustomOverrides JSON strings', () => {
      expect(DEFAULT_PREFERENCES.themeCustomOverrides).toBe(DEFAULT_THEME_OVERRIDES_JSON);
      expect(isValidThemeOverridesJson('{}')).toBe(true);
      expect(isValidThemeOverridesJson('not-json')).toBe(false);
      expect(isValidThemeOverridesJson('[]')).toBe(false);
      expect(normalizeThemeOverridesJson('not-json')).toBe('{}');
    });

    it('resolves effective values cleanly for presets vs custom slot', () => {
      const customJson = '{"primary":"#ff8800","radius":"0rem"}';
      expect(resolveThemeEffectiveValues('caffeine', customJson)).toEqual(THEME_PRESETS.caffeine);
      expect(resolveThemeEffectiveValues('custom', customJson)).toEqual({
        ...DEFAULT_CUSTOM_THEME_VALUES,
        primary: '#ff8800',
        radius: '0rem',
      });
    });

    it('computes OKLab lightness and picks a readable foreground', () => {
      expect(getOklabLightness('#000000')).toBeCloseTo(0, 3);
      expect(getOklabLightness('#ffffff')).toBeCloseTo(1, 3);
      expect(pickContrastForeground('#3b82f6')).toBe('oklch(1 0 0)');
      expect(pickContrastForeground('#f5deb3')).toBe('oklch(0.2 0 0)');
    });
  });

  describe('runtime', () => {
    it('applies inline overrides only for custom theme and clears them for presets', () => {
      const host = document.createElement('div');
      const customJson = serializeCustomThemeOverride({ primary: '#ff8800', radius: '0rem' });

      // Preset theme keeps zero inline overrides
      applyThemeToHost(host, 'caffeine', customJson);
      expect(host.getAttribute(THEME_ATTRIBUTE)).toBe('caffeine');
      for (const prop of THEME_OVERRIDE_CSS_VARIABLES) {
        expect(host.style.getPropertyValue(prop)).toBe('');
      }

      // Switching to custom applies custom slot + derived semantic tokens
      applyThemeToHost(host, 'custom', customJson);
      expect(host.getAttribute(THEME_ATTRIBUTE)).toBe('custom');
      expect(host.style.getPropertyValue('--primary')).toBe('#ff8800');
      expect(host.style.getPropertyValue('--primary-foreground')).toBe('oklch(0.2 0 0)');
      expect(host.style.getPropertyValue('--ring')).toBe('var(--primary)');
      expect(host.style.getPropertyValue('--accent')).toContain('color-mix');
      expect(host.style.getPropertyValue('--radius')).toBe('0rem');

      // Switching back to a preset clears inline overrides
      applyThemeToHost(host, 'catppuccin', customJson);
      expect(host.getAttribute(THEME_ATTRIBUTE)).toBe('catppuccin');
      expect(host.style.getPropertyValue('--primary')).toBe('');
      expect(host.style.getPropertyValue('--radius')).toBe('');
      cleanupPageThemeBridge();
    });

    it('re-syncs the page theme bridge when custom values change', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      applyThemeFromPreferences(host, {
        theme: 'custom',
        themeCustomOverrides: '{"background":"#101010"}',
      });
      document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)?.remove();

      applyThemeFromPreferences(host, {
        theme: 'custom',
        themeCustomOverrides: '{"background":"#202020"}',
      });
      expect(document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)).not.toBeNull();
      cleanupPageThemeBridge();
      host.remove();
    });

    it('previewThemeOverrideOnHost updates host variables without triggering page-theme-bridge style rewrites', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      applyThemeToHost(host, 'modern-dark');
      document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)?.remove();

      previewThemeOverrideOnHost(host, { primary: '#ff8800' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(host.getAttribute(THEME_ATTRIBUTE)).toBe('custom');
      expect(host.style.getPropertyValue('--primary')).toBe('#ff8800');
      expect(document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)).toBeNull();
      cleanupPageThemeBridge();
      host.remove();
    });
  });

  describe('preferences', () => {
    it('persists valid override JSON, rejects invalid JSON, and shares across versions', async () => {
      const storage = createInMemoryPreferencesStorage({
        themeCustomOverrides: 'corrupted-json',
      });
      const poe1 = await createPreferencesModule('poe1', storage);
      const poe2 = await createPreferencesModule('poe2', storage);
      if (!poe1.ok || !poe2.ok) throw new Error('load failed');

      expect(poe1.value.read().themeCustomOverrides).toBe('{}');
      expect(storage.inspect().themeCustomOverrides).toBe('{}');

      const next = serializeCustomThemeOverride({ primary: '#ff8800' });
      expect(await poe1.value.update({ themeCustomOverrides: next })).toEqual({
        ok: true,
        changed: true,
      });
      expect(poe2.value.read().themeCustomOverrides).toBe(next);

      expect(await poe1.value.update({ themeCustomOverrides: 'not-json' })).toEqual({
        ok: false,
        error: { code: 'invalid', message: 'Invalid Preference: themeCustomOverrides' },
      });
    });
  });
});
