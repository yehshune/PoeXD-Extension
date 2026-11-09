// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  THEME_IDS,
  DEFAULT_THEME_ID,
  THEME_ATTRIBUTE,
  isValidThemeId,
  normalizeThemeId,
} from '@/lib/theme/theme-contract';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';
import {
  GLOBAL_PREFERENCE_NAMES,
  getPreferenceStorageKey,
  isGlobalPreference,
} from '@/utils/preferences-contract';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';

describe('Theme Foundation — Formal Theme System (Modern-Dark, Caffeine & Catppuccin)', () => {
  // ---------------------------------------------------------------------------
  // 1. Theme Contract SSOT & Normalization
  // ---------------------------------------------------------------------------
  describe('1. Theme Contract SSOT & Normalization', () => {
    it('defines canonical THEME_IDS as ["modern-dark", "caffeine", "catppuccin"] and DEFAULT_THEME_ID as "modern-dark"', () => {
      expect(THEME_IDS).toEqual(['modern-dark', 'caffeine', 'catppuccin']);
      expect(DEFAULT_THEME_ID).toBe('modern-dark');
      expect(THEME_ATTRIBUTE).toBe('data-poexd-theme');
    });

    it('strictly validates ThemeId allowing only "modern-dark", "caffeine", and "catppuccin"', () => {
      expect(isValidThemeId('modern-dark')).toBe(true);
      expect(isValidThemeId('caffeine')).toBe(true);
      expect(isValidThemeId('catppuccin')).toBe(true);
      expect(isValidThemeId('poexd-dark')).toBe(false);
      expect(isValidThemeId('light')).toBe(false);
      expect(isValidThemeId('dark')).toBe(false);
      expect(isValidThemeId('system')).toBe(false);
      expect(isValidThemeId('auto')).toBe(false);
      expect(isValidThemeId('unknown')).toBe(false);
      expect(isValidThemeId(123)).toBe(false);
      expect(isValidThemeId(null)).toBe(false);
      expect(isValidThemeId(undefined)).toBe(false);
    });

    it('normalizes valid and invalid theme values (including legacy "poexd-dark") to contract', () => {
      expect(normalizeThemeId('modern-dark')).toBe('modern-dark');
      expect(normalizeThemeId('caffeine')).toBe('caffeine');
      expect(normalizeThemeId('catppuccin')).toBe('catppuccin');
      expect(normalizeThemeId('poexd-dark')).toBe('modern-dark');
      expect(normalizeThemeId('light')).toBe('modern-dark');
      expect(normalizeThemeId('dark')).toBe('modern-dark');
      expect(normalizeThemeId('system')).toBe('modern-dark');
      expect(normalizeThemeId('auto')).toBe('modern-dark');
      expect(normalizeThemeId('unknown')).toBe('modern-dark');
      expect(normalizeThemeId(undefined)).toBe('modern-dark');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Preference Scope Contract (Global vs Versioned)
  // ---------------------------------------------------------------------------
  describe('2. Preference Scope Contract (Global vs Versioned)', () => {
    it('declares "theme" as a global preference and maps keys correctly', () => {
      expect(GLOBAL_PREFERENCE_NAMES).toContain('theme');
      expect(isGlobalPreference('theme')).toBe(true);
      expect(isGlobalPreference('sidebarWidth')).toBe(false);
      expect(isGlobalPreference('densityScale')).toBe(false);

      // Theme key is unversioned (global)
      expect(getPreferenceStorageKey('theme', 'poe1')).toBe('theme');
      expect(getPreferenceStorageKey('theme', 'poe2')).toBe('theme');

      // Other preferences remain versioned
      expect(getPreferenceStorageKey('sidebarWidth', 'poe1')).toBe('sidebarWidth_poe1');
      expect(getPreferenceStorageKey('sidebarWidth', 'poe2')).toBe('sidebarWidth_poe2');
      expect(getPreferenceStorageKey('densityScale', 'poe1')).toBe('densityScale_poe1');
    });

    it('returns { ok: true, changed: false } and performs no storage writes or listener notification on no-op theme update', async () => {
      const storage = createInMemoryPreferencesStorage({ theme: 'caffeine' });
      const setSpy = vi.spyOn(storage, 'set');
      const outcome = await createPreferencesModule('poe1', storage);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);

      let notificationCount = 0;
      outcome.value.subscribe(() => {
        notificationCount++;
      });
      expect(notificationCount).toBe(1); // initial delivery on subscription

      const res = await outcome.value.update({ theme: outcome.value.read().theme });
      expect(res).toEqual({ ok: true, changed: false });
      expect(setSpy).not.toHaveBeenCalled();
      expect(notificationCount).toBe(1); // no extra delivery for no-op
    });

    it('returns { ok: true, changed: false } on no-op theme update even if storage key was not initially in storage', async () => {
      const storage = createInMemoryPreferencesStorage();
      const outcome = await createPreferencesModule('poe1', storage);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);

      const setSpy = vi.spyOn(storage, 'set');
      const res = await outcome.value.update({ theme: 'modern-dark' });
      expect(res).toEqual({ ok: true, changed: false });
      expect(setSpy).not.toHaveBeenCalled();
      expect(storage.inspect().theme).toBeUndefined();
    });

    it('rejects invalid theme updates with code "invalid"', async () => {
      const storage = createInMemoryPreferencesStorage();
      const outcome = await createPreferencesModule('poe1', storage);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error.message);

      const updateResult = await outcome.value.update({
        theme: 'light' as any,
      });
      expect(updateResult).toEqual({
        ok: false,
        error: { code: 'invalid', message: 'Invalid Preference: theme' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Cross-Version Global Storage Ownership & Live Multi-Theme Propagation
  // ---------------------------------------------------------------------------
  describe('3. Cross-Version Global Storage Ownership & Live Multi-Theme Propagation', () => {
    it('shares global "theme" storage key across poe1 and poe2, propagates live updates, and preserves versioned isolation', async () => {
      const sharedStorage = createInMemoryPreferencesStorage({
        theme: 'caffeine',
        sidebarWidth_poe1: 420,
        sidebarWidth_poe2: 360,
      });

      const poe1Outcome = await createPreferencesModule('poe1', sharedStorage);
      const poe2Outcome = await createPreferencesModule('poe2', sharedStorage);
      expect(poe1Outcome.ok).toBe(true);
      expect(poe2Outcome.ok).toBe(true);
      if (!poe1Outcome.ok || !poe2Outcome.ok) throw new Error('Failed to load modules');

      const poe1 = poe1Outcome.value;
      const poe2 = poe2Outcome.value;

      // Initial read: both modules read initial shared theme
      expect(poe1.read().theme).toBe('caffeine');
      expect(poe2.read().theme).toBe('caffeine');

      // Setup subscriber on poe2 to test live propagation
      let poe2ReceivedTheme: string | undefined;
      poe2.subscribe((prefs) => {
        poe2ReceivedTheme = prefs.theme;
      });

      // Update theme via poe1 to 'catppuccin'
      const updateRes = await poe1.update({ theme: 'catppuccin' });
      expect(updateRes).toEqual({ ok: true, changed: true });

      // Verify poe1 read updated theme
      expect(poe1.read().theme).toBe('catppuccin');

      // Verify poe2 also received and reads updated theme (live propagation)
      expect(poe2.read().theme).toBe('catppuccin');
      expect(poe2ReceivedTheme).toBe('catppuccin');

      // Versioned preferences remain isolated per version
      expect(poe1.read().sidebarWidth).toBe(420);
      expect(poe2.read().sidebarWidth).toBe(360);

      // Updating versioned preference on poe1 only updates poe1's key in shared storage
      await poe1.update({ sidebarWidth: 460 });
      expect(poe1.read().sidebarWidth).toBe(460);
      expect(poe2.read().sidebarWidth).toBe(360);

      const inspectData = sharedStorage.inspect();
      expect(inspectData.sidebarWidth_poe1).toBe(460);
      expect(inspectData.sidebarWidth_poe2).toBe(360);
      expect(inspectData.theme).toBe('catppuccin');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Runtime Ownership & Shadow Host Application
  // ---------------------------------------------------------------------------
  describe('4. Runtime Ownership & Shadow Host Application', () => {
    it('sets data-poexd-theme on shadowHost for modern-dark, caffeine, and catppuccin without polluting document.body or html', () => {
      const shadowHost = document.createElement('div');
      shadowHost.id = 'poexd-shadow-host';

      applyThemeToHost(shadowHost, 'modern-dark');
      expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('modern-dark');
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();
      expect(document.body.getAttribute(THEME_ATTRIBUTE)).toBeNull();

      applyThemeToHost(shadowHost, 'caffeine');
      expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('caffeine');
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();
      expect(document.body.getAttribute(THEME_ATTRIBUTE)).toBeNull();

      applyThemeToHost(shadowHost, 'catppuccin');
      expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('catppuccin');
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();
      expect(document.body.getAttribute(THEME_ATTRIBUTE)).toBeNull();
    });

    it('safely handles null or undefined host element', () => {
      expect(() => applyThemeToHost(null, 'modern-dark')).not.toThrow();
      expect(() => applyThemeToHost(undefined, 'catppuccin')).not.toThrow();
    });

    it('falls back to DEFAULT_THEME_ID when applying invalid theme to host', () => {
      const shadowHost = document.createElement('div');
      applyThemeToHost(shadowHost, 'invalid-theme');
      expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe(DEFAULT_THEME_ID);
      expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('modern-dark');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. CSS Host Selector & Architecture Contract
  // ---------------------------------------------------------------------------
  describe('5. CSS Host Selector & Architecture Contract', () => {
    const mainCssSource = readFileSync(path.resolve(__dirname, '../assets/main.css'), 'utf-8');

    it('declares :host([data-poexd-theme="modern-dark"]) with color-scheme: dark', () => {
      expect(mainCssSource).toMatch(
        /:host\(\[data-poexd-theme=['"]modern-dark['"]\]\)(?:,\s*\[data-poexd-theme=['"]modern-dark['"]\])?\s*\{\s*color-scheme:\s*dark;\s*\}/,
      );
    });

    it('declares :host([data-poexd-theme="caffeine"]) with color-scheme: dark and explicit overrides', () => {
      expect(mainCssSource).toMatch(
        /:host\(\[data-poexd-theme=['"]caffeine['"]\]\)(?:,\s*\[data-poexd-theme=['"]caffeine['"]\])?\s*\{\s*color-scheme:\s*dark;/,
      );
      const caffeineBlockMatch = mainCssSource.match(
        /:host\(\[data-poexd-theme=['"]caffeine['"]\]\)(?:,\s*\[data-poexd-theme=['"]caffeine['"]\])?\s*\{([^}]+)\}/,
      );
      expect(caffeineBlockMatch).not.toBeNull();
      const block = caffeineBlockMatch![1];
      expect(block).toContain('--background: oklch(0.1776 0 0);');
      expect(block).toContain('--radius: 0.5rem;');
    });

    it('declares :host([data-poexd-theme="catppuccin"]) with color-scheme: dark', () => {
      expect(mainCssSource).toMatch(
        /:host\(\[data-poexd-theme=['"]catppuccin['"]\]\)(?:,\s*\[data-poexd-theme=['"]catppuccin['"]\])?\s*\{\s*color-scheme:\s*dark;/,
      );
    });

    it('overrides semantic colors, radius, and shadows in catppuccin selector', () => {
      const catppuccinBlockMatch = mainCssSource.match(
        /:host\(\[data-poexd-theme=['"]catppuccin['"]\]\)(?:,\s*\[data-poexd-theme=['"]catppuccin['"]\])?\s*\{([^}]+)\}/,
      );
      expect(catppuccinBlockMatch).not.toBeNull();
      const block = catppuccinBlockMatch![1];

      // Semantic colors overridden
      expect(block).toContain('--background:');
      expect(block).toContain('--foreground:');
      expect(block).toContain('--card:');
      expect(block).toContain('--primary:');
      expect(block).toContain('--muted:');
      expect(block).toContain('--border:');

      // Radius overridden
      expect(block).toContain('--radius:');

      // Shadows overridden
      expect(block).toContain('--shadow:');
      expect(block).toContain('--shadow-md:');
      expect(block).toContain('--shadow-2xl:');
    });

    it('defines canonical baseline in :root, :host matching modern-dark contract', () => {
      expect(mainCssSource).toContain('--background: oklch(0.2046 0 0);');
      expect(mainCssSource).toContain('--foreground: oklch(0.9219 0 0);');
      expect(mainCssSource).toContain('--radius: 0.375rem;');
    });

    it('strictly forbids legacy poexd-dark, system, or auto theme selectors', () => {
      expect(mainCssSource).not.toContain("data-poexd-theme='poexd-dark'");
      expect(mainCssSource).not.toContain('data-poexd-theme="poexd-dark"');
      expect(mainCssSource).not.toContain("data-poexd-theme='system'");
      expect(mainCssSource).not.toContain('data-poexd-theme="system"');
      expect(mainCssSource).not.toContain("data-poexd-theme='auto'");
      expect(mainCssSource).not.toContain('data-poexd-theme="auto"');
    });
  });
});
