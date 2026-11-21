// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_THEME_CUSTOM_COLORS,
  DEFAULT_THEME_CUSTOM_RADIUS,
  PRESET_THEME_IDS,
  THEME_ATTRIBUTE,
  THEME_CUSTOM_PRESETS,
  THEME_CUSTOM_RADIUS_VALUES,
  THEME_SEED_VARIABLES,
  getOklabLightness,
  isValidHexColor,
  isValidThemeCustomRadius,
  normalizeThemeCustomColors,
  normalizeThemeCustomRadius,
  pickContrastForeground,
} from '@/lib/theme/theme-contract';
import { applyThemeToHost, readThemeCustomColors } from '@/lib/theme/theme-runtime';
import { PAGE_THEME_BRIDGE_STYLE_ID, cleanupPageThemeBridge } from '@/lib/theme/page-theme-bridge';
import { DEFAULT_PREFERENCES } from '@/utils/preferences-contract';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';

describe('Custom theme (five seed colors + radius + presets)', () => {
  describe('contract', () => {
    it('validates #rrggbb hex colors only', () => {
      expect(isValidHexColor('#1a2B3c')).toBe(true);
      expect(isValidHexColor('#fff')).toBe(false);
      expect(isValidHexColor('1a2b3c')).toBe(false);
      expect(isValidHexColor('oklch(0.5 0 0)')).toBe(false);
      expect(isValidHexColor(undefined)).toBe(false);
    });

    it('validates and normalizes radius steps', () => {
      for (const radius of THEME_CUSTOM_RADIUS_VALUES) {
        expect(isValidThemeCustomRadius(radius)).toBe(true);
        expect(normalizeThemeCustomRadius(radius)).toBe(radius);
      }
      expect(isValidThemeCustomRadius('1rem')).toBe(false);
      expect(normalizeThemeCustomRadius('1rem')).toBe(DEFAULT_THEME_CUSTOM_RADIUS);
    });

    it('normalizes invalid seed colors back to defaults', () => {
      expect(
        normalizeThemeCustomColors({
          background: '#ABCDEF',
          card: '#123456',
          foreground: 'bad',
          destructive: '#FF0000',
        }),
      ).toEqual({
        background: '#abcdef',
        card: '#123456',
        foreground: DEFAULT_THEME_CUSTOM_COLORS.foreground,
        primary: DEFAULT_THEME_CUSTOM_COLORS.primary,
        destructive: '#ff0000',
      });
    });

    it('provides valid starting presets for all built-in themes', () => {
      for (const presetId of PRESET_THEME_IDS) {
        const preset = THEME_CUSTOM_PRESETS[presetId];
        expect(isValidHexColor(preset.background)).toBe(true);
        expect(isValidHexColor(preset.card)).toBe(true);
        expect(isValidHexColor(preset.foreground)).toBe(true);
        expect(isValidHexColor(preset.primary)).toBe(true);
        expect(isValidHexColor(preset.destructive)).toBe(true);
        expect(isValidThemeCustomRadius(preset.radius)).toBe(true);
      }
    });

    it('computes OKLab lightness and picks a readable foreground', () => {
      expect(getOklabLightness('#000000')).toBeCloseTo(0, 3);
      expect(getOklabLightness('#ffffff')).toBeCloseTo(1, 3);
      expect(pickContrastForeground('#3b82f6')).toBe('oklch(1 0 0)');
      expect(pickContrastForeground('#f5deb3')).toBe('oklch(0.2 0 0)');
    });

    it('uses modern-dark values as preference defaults', () => {
      expect(DEFAULT_PREFERENCES.themeCustomBackground).toBe('#171717');
      expect(DEFAULT_PREFERENCES.themeCustomCard).toBe('#262626');
      expect(DEFAULT_PREFERENCES.themeCustomForeground).toBe('#e5e5e5');
      expect(DEFAULT_PREFERENCES.themeCustomPrimary).toBe('#3b82f6');
      expect(DEFAULT_PREFERENCES.themeCustomDestructive).toBe('#ef4444');
      expect(DEFAULT_PREFERENCES.themeCustomRadius).toBe('0.375rem');
    });
  });

  describe('runtime', () => {
    it('writes seed variables for custom theme and removes them for presets', () => {
      const host = document.createElement('div');
      applyThemeToHost(host, 'custom', {
        background: '#101010',
        card: '#1a1a1a',
        foreground: '#eeeeee',
        primary: '#f5deb3',
        destructive: '#f38ba8',
        radius: '0rem',
      });
      expect(host.getAttribute(THEME_ATTRIBUTE)).toBe('custom');
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.background)).toBe('#101010');
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.card)).toBe('#1a1a1a');
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.foreground)).toBe('#eeeeee');
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.primary)).toBe('#f5deb3');
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.primaryForeground)).toBe(
        'oklch(0.2 0 0)',
      );
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.destructive)).toBe('#f38ba8');
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.destructiveForeground)).toBe(
        'oklch(0.2 0 0)',
      );
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.radius)).toBe('0rem');

      applyThemeToHost(host, 'caffeine');
      expect(host.getAttribute(THEME_ATTRIBUTE)).toBe('caffeine');
      for (const name of Object.values(THEME_SEED_VARIABLES)) {
        expect(host.style.getPropertyValue(name)).toBe('');
      }
      cleanupPageThemeBridge();
    });

    it('falls back to default seeds when custom colors or radius are missing or invalid', () => {
      const host = document.createElement('div');
      applyThemeToHost(host, 'custom', { background: 'nope', radius: '99px' });
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.background)).toBe(
        DEFAULT_THEME_CUSTOM_COLORS.background,
      );
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.card)).toBe(
        DEFAULT_THEME_CUSTOM_COLORS.card,
      );
      expect(host.style.getPropertyValue(THEME_SEED_VARIABLES.radius)).toBe(
        DEFAULT_THEME_CUSTOM_RADIUS,
      );
      cleanupPageThemeBridge();
    });

    it('re-syncs the page theme bridge when only custom colors change', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      applyThemeToHost(host, 'custom', { background: '#101010' });
      document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)?.remove();

      applyThemeToHost(host, 'custom', { background: '#202020' });
      expect(document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)).not.toBeNull();
      cleanupPageThemeBridge();
      host.remove();
    });

    it('reads seed colors and radius from a preferences snapshot', () => {
      expect(
        readThemeCustomColors({
          themeCustomBackground: '#000000',
          themeCustomCard: '#111111',
          themeCustomForeground: '#ffffff',
          themeCustomPrimary: '#ff0000',
          themeCustomDestructive: '#cc0000',
          themeCustomRadius: '0.5rem',
        }),
      ).toEqual({
        background: '#000000',
        card: '#111111',
        foreground: '#ffffff',
        primary: '#ff0000',
        destructive: '#cc0000',
        radius: '0.5rem',
      });
    });
  });

  describe('preferences', () => {
    it('accepts valid color/radius updates and rejects invalid ones', async () => {
      const storage = createInMemoryPreferencesStorage();
      const outcome = await createPreferencesModule('poe1', storage);
      if (!outcome.ok) throw new Error(outcome.error.message);

      expect(
        await outcome.value.update({
          themeCustomPrimary: '#ff8800',
          themeCustomCard: '#222233',
          themeCustomDestructive: '#dd2244',
          themeCustomRadius: '0rem',
        }),
      ).toEqual({
        ok: true,
        changed: true,
      });
      expect(storage.inspect().themeCustomPrimary).toBe('#ff8800');
      expect(storage.inspect().themeCustomCard).toBe('#222233');
      expect(storage.inspect().themeCustomDestructive).toBe('#dd2244');
      expect(storage.inspect().themeCustomRadius).toBe('0rem');

      expect(await outcome.value.update({ themeCustomPrimary: 'red' })).toEqual({
        ok: false,
        error: { code: 'invalid', message: 'Invalid Preference: themeCustomPrimary' },
      });
      expect(await outcome.value.update({ themeCustomRadius: '99rem' as any })).toEqual({
        ok: false,
        error: { code: 'invalid', message: 'Invalid Preference: themeCustomRadius' },
      });
    });

    it('repairs invalid stored seed colors/radius to defaults and shares them across versions', async () => {
      const storage = createInMemoryPreferencesStorage({
        themeCustomBackground: 'garbage',
        themeCustomForeground: '#abcdef',
        themeCustomRadius: 'invalid',
      });
      const poe1 = await createPreferencesModule('poe1', storage);
      const poe2 = await createPreferencesModule('poe2', storage);
      if (!poe1.ok || !poe2.ok) throw new Error('load failed');

      expect(poe1.value.read().themeCustomBackground).toBe(DEFAULT_THEME_CUSTOM_COLORS.background);
      expect(poe1.value.read().themeCustomRadius).toBe(DEFAULT_THEME_CUSTOM_RADIUS);
      expect(storage.inspect().themeCustomBackground).toBe(DEFAULT_THEME_CUSTOM_COLORS.background);
      expect(storage.inspect().themeCustomRadius).toBe(DEFAULT_THEME_CUSTOM_RADIUS);
      expect(poe2.value.read().themeCustomForeground).toBe('#abcdef');
    });
  });

  describe('css', () => {
    const mainCssSource = readFileSync(path.resolve(__dirname, '../assets/main.css'), 'utf-8');
    const blockMatch = mainCssSource.match(
      /:host\(\[data-poexd-theme='custom'\]\),\s*\[data-poexd-theme='custom'\]\s*\{([^}]+)\}/,
    );

    it('declares a custom theme block deriving every semantic color token and radius', () => {
      expect(blockMatch).not.toBeNull();
      const block = blockMatch![1];
      for (const token of [
        'background',
        'foreground',
        'card',
        'card-foreground',
        'popover',
        'popover-foreground',
        'primary',
        'primary-foreground',
        'secondary',
        'secondary-foreground',
        'muted',
        'muted-foreground',
        'accent',
        'accent-foreground',
        'destructive',
        'destructive-foreground',
        'border',
        'input',
        'ring',
        'radius',
      ]) {
        expect(block).toMatch(new RegExp(`--${token}:\\s*[^;]+;`));
      }
      expect(block).toContain('var(--pxd-seed-background');
      expect(block).toContain('var(--pxd-seed-card');
      expect(block).toContain('var(--pxd-seed-foreground');
      expect(block).toContain('var(--pxd-seed-primary');
      expect(block).toContain('var(--pxd-seed-destructive');
      expect(block).toContain('var(--pxd-seed-radius');
    });
  });
});
