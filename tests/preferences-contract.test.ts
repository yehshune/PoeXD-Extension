import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AFFIX_DISPLAY_LOCALE_VALUES,
  BOOKMARK_BUTTON_POSITIONS,
  DEFAULT_PREFERENCES,
  DENSITY_SCALE_VALUES,
  DISPLAY_LOCALE_VALUES,
  FONT_SIZE_PERCENT_STEP,
  FONT_SIZE_SCALE_BOUNDS,
  GLOBAL_PREFERENCE_NAMES,
  LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES,
  PREFERENCE_NAMES,
  PREFERENCE_SCHEMA,
  SIDEBAR_POSITIONS,
  SIDEBAR_WIDTH_BOUNDS,
  SUPPORTED_AFFIX_LOCALES,
  SUPPORTED_LOCALES,
  SUPPORTED_UI_LOCALES,
  isValidPreference,
  normalizePreference,
  type Preferences,
} from '@/utils/preferences-contract';

describe('Preferences Domain Contract', () => {
  it('defines canonical DEFAULT_PREFERENCES as an immutable object', () => {
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
    expect(DEFAULT_PREFERENCES).toEqual({
      addBookmarkBtnPosition: 'top',
      collapsedTabTop: 100,
      densityScale: 1,
      displayLocale: 'auto',
      enableAffixSelector: true,
      enableAutoTitle: true,
      enableBookmarkTooltip: true,
      enableFilterTilde: true,
      enableHotkeys: true,
      enableItemNormalizer: true,
      enablePriceComparison: true,
      enablePureBackground: false,
      enableResultExternalLinks: true,
      enableResultModHighlight: true,
      enableResultModQuickFilter: true,
      enableResultPobCopy: true,
      enableSearchTilde: true,
      enableTierHelper: true,
      fontSizeScale: 1,
      hotkeyClear: '\\',
      hotkeyFocus: '/',
      liveSearchDesktopNotificationEnabled: false,
      liveSearchFetchOrder: 'newest',
      liveSearchMaxDisplayedResults: 100,
      liveSearchResumeMode: 'prompt',
      liveSearchSelectedLeague: '',
      liveSearchSoundEnabled: true,
      liveSearchTokenMaxAgeSec: 1,
      marketTranslation: false,
      marketTranslationBilingual: true,
      marketTranslationResultBilingual: false,
      resultModHighlightColor: 'indigo',
      resultModHighlightStyle: 'glow',
      searchEntryClickAction: 'preview',
      sidebarModuleBookmarks: true,
      sidebarModuleHistory: true,
      sidebarModuleLiveSearch: true,
      sidebarModulePinnedItems: true,
      sidebarModulePobBuild: true,
      sidebarModuleResultBoard: true,
      sidebarModuleStatGroupTemplates: true,
      sidebarPosition: 'left',
      sidebarWidth: 380,
      theme: 'modern-dark',
      themeCustomOverrides: '{}',
    });
    expect('affixDisplayLocale' in DEFAULT_PREFERENCES).toBe(false);
  });

  it('defines allowed enum value constants and global preference names', () => {
    expect(SIDEBAR_POSITIONS).toEqual(['left', 'right']);
    expect(BOOKMARK_BUTTON_POSITIONS).toEqual(['top', 'bottom']);
    expect(DENSITY_SCALE_VALUES).toEqual([1, 0.8]);
    expect(SUPPORTED_LOCALES).toEqual([
      'en',
      'zh-TW',
      'zh-CN',
      'ja',
      'ko',
      'ru',
      'de',
      'fr',
      'es',
      'pt',
      'th',
    ]);
    expect(SUPPORTED_AFFIX_LOCALES).toEqual(SUPPORTED_LOCALES);
    expect(SUPPORTED_UI_LOCALES).toEqual(['zh-TW', 'zh-CN', 'en']);
    expect(DISPLAY_LOCALE_VALUES).toEqual(['auto', ...SUPPORTED_LOCALES]);
    expect(AFFIX_DISPLAY_LOCALE_VALUES).toEqual(DISPLAY_LOCALE_VALUES);
    expect(GLOBAL_PREFERENCE_NAMES).toEqual([
      'theme',
      'themeCustomOverrides',
      'displayLocale',
      'marketTranslation',
      'marketTranslationBilingual',
      'marketTranslationResultBilingual',
      'collapsedTabTop',
      'sidebarPosition',
      'sidebarWidth',
      'fontSizeScale',
      'densityScale',
      'enablePureBackground',
      'enableAutoTitle',
      'enableHotkeys',
      'hotkeyFocus',
      'hotkeyClear',
      'enableSearchTilde',
      'enableFilterTilde',
      'addBookmarkBtnPosition',
      'searchEntryClickAction',
      'enableBookmarkTooltip',
      'enableAffixSelector',
      'enablePriceComparison',
      'enableResultExternalLinks',
      'enableResultModHighlight',
      'resultModHighlightStyle',
      'resultModHighlightColor',
      'enableResultModQuickFilter',
      'enableResultPobCopy',
      'enableTierHelper',
    ]);
  });

  it('defines frozen numeric bounds', () => {
    expect(Object.isFrozen(SIDEBAR_WIDTH_BOUNDS)).toBe(true);
    expect(SIDEBAR_WIDTH_BOUNDS).toEqual({ min: 300, max: 800 });

    expect(Object.isFrozen(FONT_SIZE_SCALE_BOUNDS)).toBe(true);
    expect(FONT_SIZE_SCALE_BOUNDS).toEqual({ min: 0.8, max: 2 });
    expect(FONT_SIZE_PERCENT_STEP).toBe(5);
  });

  it('ensures defaults are consistent with bounds', () => {
    expect(DEFAULT_PREFERENCES.sidebarWidth).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_BOUNDS.min);
    expect(DEFAULT_PREFERENCES.sidebarWidth).toBeLessThanOrEqual(SIDEBAR_WIDTH_BOUNDS.max);
    expect(DEFAULT_PREFERENCES.fontSizeScale).toBeGreaterThanOrEqual(FONT_SIZE_SCALE_BOUNDS.min);
    expect(DEFAULT_PREFERENCES.fontSizeScale).toBeLessThanOrEqual(FONT_SIZE_SCALE_BOUNDS.max);
  });

  it('ensures SettingsPane, FontSizeScaleControl, and Sidebar import canonical contract symbols rather than hardcoding', () => {
    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const content = fs.readFileSync(settingsPanePath, 'utf-8');
    const sidebarGeometryContent = fs.readFileSync(
      path.resolve(__dirname, '../components/sidebar/composables/useSidebarGeometry.ts'),
      'utf-8',
    );
    const fontScaleControlContent = fs.readFileSync(
      path.resolve(__dirname, '../components/sidebar/settings/FontSizeScaleControl.vue'),
      'utf-8',
    );

    expect(content).toContain('DEFAULT_PREFERENCES');
    expect(sidebarGeometryContent).toContain('SIDEBAR_WIDTH_BOUNDS');
    expect(fontScaleControlContent).toContain('FONT_SIZE_PERCENT_STEP');
    expect(fontScaleControlContent).toContain('stepFontSizeScale');
    const planner = fs.readFileSync(
      path.resolve(__dirname, '../utils/appearance-preferences.ts'),
      'utf-8',
    );
    expect(planner).toContain('FONT_SIZE_SCALE_BOUNDS');
  });

  it('derives schema integrity: every default validates and round-trips through normalizePreference', () => {
    expect(Object.isFrozen(PREFERENCE_SCHEMA)).toBe(true);
    expect(Object.isFrozen(PREFERENCE_NAMES)).toBe(true);
    expect(Object.isFrozen(GLOBAL_PREFERENCE_NAMES)).toBe(true);
    expect(Object.isFrozen(LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES)).toBe(true);
    expect([...PREFERENCE_NAMES].sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort());

    for (const name of PREFERENCE_NAMES) {
      const defaultValue = DEFAULT_PREFERENCES[name];
      expect(isValidPreference(name, defaultValue)).toBe(true);
      expect(normalizePreference(name, defaultValue)).toBe(defaultValue);
    }
  });

  it('migrates legacy liveSearchTokenMaxAgeSec values into the 1–7 second range', () => {
    // 舊版 0 代表不限、上限 300：都換成 7 秒（等到官方期限）
    expect(normalizePreference('liveSearchTokenMaxAgeSec', 0)).toBe(7);
    expect(normalizePreference('liveSearchTokenMaxAgeSec', 15)).toBe(7);
    expect(normalizePreference('liveSearchTokenMaxAgeSec', 300)).toBe(7);
    expect(normalizePreference('liveSearchTokenMaxAgeSec', 3)).toBe(3);
    expect(normalizePreference('liveSearchTokenMaxAgeSec', 2.6)).toBe(3);
    expect(normalizePreference('liveSearchTokenMaxAgeSec', -1)).toBe(1);
    expect(normalizePreference('liveSearchTokenMaxAgeSec', 'x')).toBe(1);
  });

  it('rejects unknown keys, prototype keys, and wrong-typed values without falling through to string acceptance', () => {
    expect(isValidPreference('unknownPreference' as keyof Preferences, 'non-empty-string')).toBe(
      false,
    );
    expect(isValidPreference('toString' as keyof Preferences, 'non-empty-string')).toBe(false);
    expect(isValidPreference('constructor' as keyof Preferences, 'non-empty-string')).toBe(false);

    expect(isValidPreference('enableHotkeys', 'true')).toBe(false);
    expect(isValidPreference('sidebarWidth', '400')).toBe(false);
    expect(isValidPreference('sidebarWidth', Number.NaN)).toBe(false);
    expect(isValidPreference('collapsedTabTop', Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidPreference('liveSearchTokenMaxAgeSec', 3.5)).toBe(false);
    expect(isValidPreference('liveSearchTokenMaxAgeSec', -1)).toBe(false);
    expect(isValidPreference('liveSearchTokenMaxAgeSec', 0)).toBe(false);
    expect(isValidPreference('liveSearchTokenMaxAgeSec', 8)).toBe(false);
    expect(isValidPreference('liveSearchTokenMaxAgeSec', 7)).toBe(true);
    expect(isValidPreference('displayLocale', 'klingon')).toBe(false);
    expect(isValidPreference('hotkeyFocus', 123)).toBe(false);
    expect(isValidPreference('hotkeyFocus', '')).toBe(true);
  });

  it('normalizes legacy densityScale, theme, and themeCustomOverrides via PREFERENCE_SCHEMA', () => {
    expect(normalizePreference('densityScale', 0.7)).toBe(0.8);
    expect(normalizePreference('densityScale', 0.85)).toBe(0.8);
    expect(normalizePreference('densityScale', 1.15)).toBe(1);
    expect(normalizePreference('densityScale', 'compact')).toBe(1);
    expect(normalizePreference('theme', 'invalid-theme')).toBe(DEFAULT_PREFERENCES.theme);
    expect(normalizePreference('themeCustomOverrides', 'not-json')).toBe(
      DEFAULT_PREFERENCES.themeCustomOverrides,
    );
    expect(normalizePreference('sidebarWidth', 9999)).toBe(DEFAULT_PREFERENCES.sidebarWidth);
  });
});
