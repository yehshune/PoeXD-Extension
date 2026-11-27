import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AFFIX_DISPLAY_LOCALE_VALUES,
  BOOKMARK_BUTTON_POSITIONS,
  DISPLAY_LOCALE_VALUES,
  RESULT_MOD_HIGHLIGHT_COLORS,
  RESULT_MOD_HIGHLIGHT_STYLES,
  SIDEBAR_POSITIONS,
  THEME_IDS,
} from '@/utils/preferences-contract';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';
import {
  AFFIX_DISPLAY_LOCALE_LABELS,
  AFFIX_DISPLAY_LOCALE_OPTIONS,
  BOOKMARK_BUTTON_POSITION_LABELS,
  BOOKMARK_BUTTON_POSITION_OPTIONS,
  DISPLAY_LOCALE_LABELS,
  DISPLAY_LOCALE_OPTIONS,
  RESULT_MOD_HIGHLIGHT_COLOR_LABELS,
  RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS,
  RESULT_MOD_HIGHLIGHT_STYLE_LABELS,
  RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS,
  SEARCH_ENTRY_CLICK_ACTION_LABELS,
  SEARCH_ENTRY_CLICK_ACTION_OPTIONS,
  SIDEBAR_POSITION_LABELS,
  SIDEBAR_POSITION_OPTIONS,
  THEME_LABELS,
  THEME_OPTIONS,
} from '@/components/sidebar/settings/settings-ui-metadata';

describe('Settings UI Metadata', () => {
  afterEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  it('maps option values exactly from canonical domain contract', () => {
    expect(THEME_OPTIONS.map((opt) => opt.value)).toEqual([...THEME_IDS]);
    expect(DISPLAY_LOCALE_OPTIONS.map((opt) => opt.value)).toEqual([...DISPLAY_LOCALE_VALUES]);
    expect(AFFIX_DISPLAY_LOCALE_OPTIONS.map((opt) => opt.value)).toEqual([
      ...AFFIX_DISPLAY_LOCALE_VALUES,
    ]);
    expect(SIDEBAR_POSITION_OPTIONS.map((opt) => opt.value)).toEqual([...SIDEBAR_POSITIONS]);
    expect(BOOKMARK_BUTTON_POSITION_OPTIONS.map((opt) => opt.value)).toEqual([
      ...BOOKMARK_BUTTON_POSITIONS,
    ]);
    expect(RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS.map((opt) => opt.value)).toEqual([
      ...RESULT_MOD_HIGHLIGHT_STYLES,
    ]);
    expect(RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS.map((opt) => opt.value)).toEqual([
      ...RESULT_MOD_HIGHLIGHT_COLORS,
    ]);
  });

  it('maps correct labels for all settings options in zh-TW, zh-CN, and en', () => {
    setActiveDisplayLocale('zh-TW');
    expect(THEME_LABELS).toEqual({
      'modern-dark': '現代暗色',
      caffeine: '暖黑拿鐵',
      catppuccin: '深紫藍',
      'graphite-hud': '暗灰琥珀',
      'nordic-slate': '冷灰冰藍',
      'tactical-olive': '暗綠薄荷',
      'roasted-cocoa': '深褐焦糖',
      'slate-mist': '柔灰淺藍',
      'warm-parchment': '暖米紙色',
      'celadon-haze': '霧青淺綠',
      'morandi-ash': '淺灰紫調',
      custom: '自訂',
    });

    expect(SIDEBAR_POSITION_LABELS).toEqual({
      left: '左側',
      right: '右側',
    });

    expect(BOOKMARK_BUTTON_POSITION_LABELS).toEqual({
      top: '右上',
      bottom: '下方',
    });

    expect(SEARCH_ENTRY_CLICK_ACTION_LABELS).toEqual({
      open: '開啟搜尋',
      preview: '展開預覽',
    });

    expect(DISPLAY_LOCALE_LABELS.auto).toBe('自動偵測');
    expect(DISPLAY_LOCALE_LABELS['zh-TW']).toBe('繁體中文');
    expect(DISPLAY_LOCALE_LABELS['zh-CN']).toBe('簡體中文');
    expect(DISPLAY_LOCALE_LABELS.en).toBe('English');

    // Verify option objects reflect their label map
    THEME_OPTIONS.forEach((opt) => {
      expect(opt.label).toBe(THEME_LABELS[opt.value]);
    });
    SIDEBAR_POSITION_OPTIONS.forEach((opt) => {
      expect(opt.label).toBe(SIDEBAR_POSITION_LABELS[opt.value]);
    });
    BOOKMARK_BUTTON_POSITION_OPTIONS.forEach((opt) => {
      expect(opt.label).toBe(BOOKMARK_BUTTON_POSITION_LABELS[opt.value]);
    });
    DISPLAY_LOCALE_OPTIONS.forEach((opt) => {
      expect(opt.label).toBe(DISPLAY_LOCALE_LABELS[opt.value]);
    });

    // Switch to zh-CN
    setActiveDisplayLocale('zh-CN');
    expect(THEME_LABELS['modern-dark']).toBe('现代暗色');
    expect(SIDEBAR_POSITION_LABELS.left).toBe('左侧');
    expect(DISPLAY_LOCALE_LABELS.auto).toBe('自动检测');
    expect(DISPLAY_LOCALE_LABELS['zh-CN']).toBe('简体中文');

    // Switch to en
    setActiveDisplayLocale('en');
    expect(THEME_LABELS['modern-dark']).toBe('Modern Dark');
    expect(SIDEBAR_POSITION_LABELS.left).toBe('Left');
    expect(DISPLAY_LOCALE_LABELS.auto).toBe('Auto');
    expect(BOOKMARK_BUTTON_POSITION_LABELS.top).toBe('Top');
    expect(SEARCH_ENTRY_CLICK_ACTION_LABELS.open).toBe('Open Search');
  });

  it('ensures all exported option arrays and label maps are immutable', () => {
    expect(Object.isFrozen(DISPLAY_LOCALE_LABELS)).toBe(true);
    expect(Object.isFrozen(DISPLAY_LOCALE_OPTIONS)).toBe(true);
    expect(Object.isFrozen(AFFIX_DISPLAY_LOCALE_LABELS)).toBe(true);
    expect(Object.isFrozen(AFFIX_DISPLAY_LOCALE_OPTIONS)).toBe(true);

    expect(Object.isFrozen(SIDEBAR_POSITION_LABELS)).toBe(true);
    expect(Object.isFrozen(SIDEBAR_POSITION_OPTIONS)).toBe(true);

    expect(Object.isFrozen(BOOKMARK_BUTTON_POSITION_LABELS)).toBe(true);
    expect(Object.isFrozen(BOOKMARK_BUTTON_POSITION_OPTIONS)).toBe(true);
    expect(Object.isFrozen(RESULT_MOD_HIGHLIGHT_STYLE_LABELS)).toBe(true);
    expect(Object.isFrozen(RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS)).toBe(true);
    expect(Object.isFrozen(RESULT_MOD_HIGHLIGHT_COLOR_LABELS)).toBe(true);
    expect(Object.isFrozen(RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS)).toBe(true);
  });

  it('static guard: SettingsPane and SearchEntrySettingsPopover import metadata and do not declare local options', () => {
    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const content = fs.readFileSync(settingsPanePath, 'utf-8');
    const popoverPath = path.resolve(
      __dirname,
      '../components/sidebar/SearchEntrySettingsPopover.vue',
    );
    const popoverContent = fs.readFileSync(popoverPath, 'utf-8');

    // Should consume canonical constants in template
    expect(content).toMatch(/v-for="opt in SIDEBAR_POSITION_OPTIONS"/);
    expect(content).toContain('DISPLAY_LOCALE_OPTIONS');
    expect(content).not.toContain('SIDEBAR_SIZE_OPTIONS');
    expect(content).not.toContain('FONT_SIZE_MODE_OPTIONS');
    expect(content).not.toContain('DENSITY_OPTIONS');
    expect(popoverContent).toContain('BOOKMARK_BUTTON_POSITION_OPTIONS');
    expect(popoverContent).toContain('SEARCH_ENTRY_CLICK_ACTION_OPTIONS');

    // Should not define local options
    expect(content).not.toMatch(/const\s+sidebarPositionOptions\s*=/);
    expect(content).not.toMatch(/const\s+sidebarSizeOptions\s*=/);
    expect(content).not.toMatch(/const\s+fontSizeModeOptions\s*=/);
    expect(content).not.toMatch(/const\s+densityOptions\s*=/);
    expect(content).not.toMatch(/const\s+bookmarkBtnPositionOptions\s*=/);
  });

  it('static guard: preferences-contract remains pure without UI presentation labels', () => {
    const contractPath = path.resolve(__dirname, '../utils/preferences-contract.ts');
    const contractContent = fs.readFileSync(contractPath, 'utf-8');

    expect(contractContent).not.toContain('左側');
    expect(contractContent).not.toContain('右側');
    expect(contractContent).not.toContain('自訂');
    expect(contractContent).not.toContain('標準');
    expect(contractContent).not.toContain('緊湊');
    expect(contractContent).not.toContain('僅資料夾右上方');
  });
});
