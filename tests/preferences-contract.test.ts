import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AFFIX_DISPLAY_LOCALE_VALUES,
  BOOKMARK_BUTTON_POSITIONS,
  DEFAULT_PREFERENCES,
  DENSITY_SCALE_VALUES,
  DISPLAY_LOCALE_VALUES,
  FONT_SIZE_MODES,
  FONT_SIZE_PRESETS,
  FONT_SIZE_SCALE_BOUNDS,
  SIDEBAR_POSITIONS,
  SIDEBAR_WIDTH_BOUNDS,
  SUPPORTED_AFFIX_LOCALES,
  SUPPORTED_LOCALES,
  SUPPORTED_UI_LOCALES,
  GLOBAL_PREFERENCE_NAMES,
} from '@/utils/preferences-contract';

describe('Preferences Domain Contract', () => {
  it('defines canonical DEFAULT_PREFERENCES as an immutable object', () => {
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
    expect(DEFAULT_PREFERENCES).toEqual({
      addBookmarkBtnPosition: 'top',
      collapsedTabTop: 100,
      customFontSizeScale: null,
      densityScale: 1,
      displayLocale: 'auto',
      enableAffixSelector: true,
      enableAutoTitle: true,
      enableBookmarkTooltip: true,
      enableFilterTilde: true,
      enableHotkeys: true,
      enableItemNormalizer: true,
      enablePriceComparison: true,
      enablePureBackground: true,
      enableResultExternalLinks: true,
      enableResultModHighlight: true,
      enableResultModQuickFilter: true,
      enableResultPobCopy: true,
      enableSearchTilde: true,
      enableTierHelper: true,
      fontSizeMode: 'medium',
      fontSizeScale: 1,
      hotkeyClear: '\\',
      hotkeyFocus: '/',
      liveSearchMaxDisplayedResults: 100,
      liveSearchResumeMode: 'prompt',
      liveSearchSelectedLeague: '',
      liveSearchSoundEnabled: true,
      marketTranslation: false,
      marketTranslationBilingual: true,
      marketTranslationResultBilingual: false,
      searchEntryClickAction: 'preview',
      sidebarModuleBookmarks: true,
      sidebarModuleHistory: true,
      sidebarModuleLiveSearch: true,
      sidebarModulePinnedItems: true,
      sidebarModulePobBuild: true,
      sidebarModuleStatGroupTemplates: true,
      sidebarPosition: 'left',
      sidebarWidth: 380,
      theme: 'modern-dark',
    });
    expect('affixDisplayLocale' in DEFAULT_PREFERENCES).toBe(false);
  });

  it('defines allowed enum value constants and global preference names', () => {
    expect(SIDEBAR_POSITIONS).toEqual(['left', 'right']);
    expect(FONT_SIZE_MODES).toEqual(['small', 'medium', 'large', 'custom']);
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
      'displayLocale',
      'marketTranslation',
      'marketTranslationBilingual',
      'marketTranslationResultBilingual',
      'collapsedTabTop',
      'sidebarPosition',
      'sidebarWidth',
      'fontSizeMode',
      'fontSizeScale',
      'customFontSizeScale',
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
    ]);
  });

  it('defines frozen numeric bounds', () => {
    expect(Object.isFrozen(SIDEBAR_WIDTH_BOUNDS)).toBe(true);
    expect(SIDEBAR_WIDTH_BOUNDS).toEqual({ min: 300, max: 800 });

    expect(Object.isFrozen(FONT_SIZE_SCALE_BOUNDS)).toBe(true);
    expect(FONT_SIZE_SCALE_BOUNDS).toEqual({ min: 0.8, max: 2 });
  });

  it('defines frozen preset mappings without custom key', () => {
    expect(Object.isFrozen(FONT_SIZE_PRESETS)).toBe(true);
    expect(FONT_SIZE_PRESETS).toEqual({
      small: 0.85,
      medium: 1,
      large: 1.2,
    });
    expect('custom' in FONT_SIZE_PRESETS).toBe(false);
  });

  it('ensures defaults and presets are consistent with bounds and each other', () => {
    // Defaults match non-custom presets
    if (DEFAULT_PREFERENCES.fontSizeMode !== 'custom') {
      expect(FONT_SIZE_PRESETS[DEFAULT_PREFERENCES.fontSizeMode]).toBe(
        DEFAULT_PREFERENCES.fontSizeScale,
      );
    }

    // Default values within bounds
    expect(DEFAULT_PREFERENCES.sidebarWidth).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_BOUNDS.min);
    expect(DEFAULT_PREFERENCES.sidebarWidth).toBeLessThanOrEqual(SIDEBAR_WIDTH_BOUNDS.max);
    expect(DEFAULT_PREFERENCES.fontSizeScale).toBeGreaterThanOrEqual(FONT_SIZE_SCALE_BOUNDS.min);
    expect(DEFAULT_PREFERENCES.fontSizeScale).toBeLessThanOrEqual(FONT_SIZE_SCALE_BOUNDS.max);

    // All presets within bounds
    for (const scale of Object.values(FONT_SIZE_PRESETS)) {
      expect(scale).toBeGreaterThanOrEqual(FONT_SIZE_SCALE_BOUNDS.min);
      expect(scale).toBeLessThanOrEqual(FONT_SIZE_SCALE_BOUNDS.max);
    }
  });

  it('ensures SettingsPane and Sidebar import canonical contract symbols rather than hardcoding', () => {
    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const content = fs.readFileSync(settingsPanePath, 'utf-8');
    const sidebarContent = fs.readFileSync(
      path.resolve(__dirname, '../components/Sidebar.vue'),
      'utf-8',
    );

    expect(content).toContain('DEFAULT_PREFERENCES');
    expect(sidebarContent).toContain('SIDEBAR_WIDTH_BOUNDS');
    expect(content).toContain('FONT_SIZE_SCALE_BOUNDS');
    // 字體模式切換的預設值改由設定頁與初始導覽共用的規劃函式套用
    expect(content).toContain('planFontSizeModeChange');
    const planner = fs.readFileSync(
      path.resolve(__dirname, '../utils/appearance-preferences.ts'),
      'utf-8',
    );
    expect(planner).toContain('FONT_SIZE_PRESETS');
  });
});
