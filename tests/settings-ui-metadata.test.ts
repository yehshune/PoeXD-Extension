import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AFFIX_DISPLAY_LOCALE_VALUES,
  BOOKMARK_BUTTON_POSITIONS,
  DISPLAY_LOCALE_VALUES,
  FONT_SIZE_MODES,
  SIDEBAR_POSITIONS,
  SIDEBAR_SIZES,
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
  FONT_SIZE_MODE_LABELS,
  FONT_SIZE_MODE_OPTIONS,
  SEARCH_ENTRY_CLICK_ACTION_LABELS,
  SEARCH_ENTRY_CLICK_ACTION_OPTIONS,
  SIDEBAR_POSITION_LABELS,
  SIDEBAR_POSITION_OPTIONS,
  SIDEBAR_SIZE_LABELS,
  SIDEBAR_SIZE_OPTIONS,
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
    expect(SIDEBAR_SIZE_OPTIONS.map((opt) => opt.value)).toEqual([...SIDEBAR_SIZES]);
    expect(FONT_SIZE_MODE_OPTIONS.map((opt) => opt.value)).toEqual([...FONT_SIZE_MODES]);
    expect(BOOKMARK_BUTTON_POSITION_OPTIONS.map((opt) => opt.value)).toEqual([
      ...BOOKMARK_BUTTON_POSITIONS,
    ]);
  });

  it('maps correct labels for all settings options in zh-TW, zh-CN, and en', () => {
    setActiveDisplayLocale('zh-TW');
    expect(THEME_LABELS).toEqual({
      'modern-dark': '現代暗色',
      caffeine: '咖啡因',
      catppuccin: '貓布奇諾',
    });

    expect(SIDEBAR_POSITION_LABELS).toEqual({
      left: '左側',
      right: '右側',
    });

    expect(SIDEBAR_SIZE_LABELS).toEqual({
      small: '小',
      medium: '中',
      large: '大',
      custom: '自訂',
    });

    expect(FONT_SIZE_MODE_LABELS).toEqual({
      small: '小',
      medium: '中',
      large: '大',
      custom: '自訂',
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
    SIDEBAR_SIZE_OPTIONS.forEach((opt) => {
      expect(opt.label).toBe(SIDEBAR_SIZE_LABELS[opt.value]);
    });
    FONT_SIZE_MODE_OPTIONS.forEach((opt) => {
      expect(opt.label).toBe(FONT_SIZE_MODE_LABELS[opt.value]);
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
    expect(SIDEBAR_SIZE_LABELS.custom).toBe('自定义');
    expect(DISPLAY_LOCALE_LABELS.auto).toBe('自动检测');
    expect(DISPLAY_LOCALE_LABELS['zh-CN']).toBe('简体中文');

    // Switch to en
    setActiveDisplayLocale('en');
    expect(THEME_LABELS['modern-dark']).toBe('Modern Dark');
    expect(SIDEBAR_POSITION_LABELS.left).toBe('Left');
    expect(SIDEBAR_SIZE_LABELS.custom).toBe('Custom');
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

    expect(Object.isFrozen(SIDEBAR_SIZE_LABELS)).toBe(true);
    expect(Object.isFrozen(SIDEBAR_SIZE_OPTIONS)).toBe(true);

    expect(Object.isFrozen(FONT_SIZE_MODE_LABELS)).toBe(true);
    expect(Object.isFrozen(FONT_SIZE_MODE_OPTIONS)).toBe(true);

    expect(Object.isFrozen(BOOKMARK_BUTTON_POSITION_LABELS)).toBe(true);
    expect(Object.isFrozen(BOOKMARK_BUTTON_POSITION_OPTIONS)).toBe(true);
  });

  it('static guard: SettingsPane imports metadata and does not declare local options', () => {
    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const content = fs.readFileSync(settingsPanePath, 'utf-8');

    // Should consume canonical constants in template
    expect(content).toMatch(/v-for="opt in SIDEBAR_POSITION_OPTIONS"/);
    expect(content).toContain('DISPLAY_LOCALE_OPTIONS');
    expect(content).toContain('SIDEBAR_SIZE_OPTIONS');
    expect(content).toContain('FONT_SIZE_MODE_OPTIONS');
    expect(content).not.toContain('DENSITY_OPTIONS');
    expect(content).toContain('BOOKMARK_BUTTON_POSITION_OPTIONS');

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
