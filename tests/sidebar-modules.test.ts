import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_MODULE_PREFERENCES,
  SIDEBAR_DESCRIPTORS,
  SIDEBAR_FIXED_TAB_IDS,
  SIDEBAR_MODULES,
  SIDEBAR_PANE_TABS,
  countEnabledSidebarModules,
  getSidebarModule,
  isSidebarModuleEnabled,
  resolveActivePaneTab,
  resolveVisiblePaneTabs,
  usesSidebarPaneScroll,
} from '@/utils/sidebar-modules';
import {
  SIDEBAR_DESCRIPTOR_ICONS,
  SIDEBAR_MODULE_PRESENTATION,
  SIDEBAR_NAV_TABS,
  getSidebarModuleDescription,
  getSidebarModuleLabel,
} from '@/components/sidebar/sidebar-module-presentation';
import { DEFAULT_PREFERENCES } from '@/utils/preferences-contract';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';
import { resetI18nStateForTests } from '@/utils/i18n';

const allOn = { ...DEFAULT_SIDEBAR_MODULE_PREFERENCES };

describe('Sidebar Modules domain', () => {
  it('turns every module on by default, matching DEFAULT_PREFERENCES', () => {
    for (const module of SIDEBAR_MODULES) {
      expect(DEFAULT_PREFERENCES[module.preferenceKey]).toBe(true);
      expect(DEFAULT_SIDEBAR_MODULE_PREFERENCES[module.preferenceKey]).toBe(true);
    }
    expect(countEnabledSidebarModules(allOn)).toBe(SIDEBAR_MODULES.length);
  });

  it('lists visible pane tabs in navigation order with fixed tabs last', () => {
    expect(resolveVisiblePaneTabs(allOn)).toEqual([
      'bookmark',
      'history',
      'stat-group-template',
      'pob-build',
      'pinned-items',
      'result-board',
      'tools',
      'settings',
    ]);
    expect(
      resolveVisiblePaneTabs({
        ...allOn,
        sidebarModuleHistory: false,
        sidebarModuleLiveSearch: false,
      }),
    ).toEqual([
      'bookmark',
      'stat-group-template',
      'pob-build',
      'pinned-items',
      'result-board',
      'tools',
      'settings',
    ]);
  });

  it('never lists the live search entry as a pane tab', () => {
    expect(resolveVisiblePaneTabs(allOn)).not.toContain('live-search');
    expect(isSidebarModuleEnabled(allOn, 'live-search')).toBe(true);
    expect(
      isSidebarModuleEnabled({ ...allOn, sidebarModuleLiveSearch: false }, 'live-search'),
    ).toBe(false);
  });

  it('keeps a visible requested tab and falls back when it was turned off', () => {
    expect(resolveActivePaneTab('history', allOn)).toBe('history');
    expect(resolveActivePaneTab('tools', { ...allOn, sidebarModuleBookmarks: false })).toBe(
      'tools',
    );
    expect(resolveActivePaneTab('history', { ...allOn, sidebarModuleHistory: false })).toBe(
      'bookmark',
    );
    expect(resolveActivePaneTab('unknown-tab', allOn)).toBe('bookmark');
  });

  it('falls back to settings when all module tabs are off', () => {
    const allOff = Object.fromEntries(
      Object.keys(allOn).map((key) => [key, false]),
    ) as typeof allOn;
    expect(resolveActivePaneTab('bookmark', allOff)).toBe('settings');
    expect(countEnabledSidebarModules(allOff)).toBe(0);
  });

  it('points modules to related settings sections', () => {
    expect(getSidebarModule('bookmark').settingsSection).toBe('bookmarks');
    expect(getSidebarModule('pinned-items').settingsSection).toBeNull();
    expect(() => getSidebarModule('nope' as never)).toThrow('Unknown Sidebar Module');
  });

  it('persists module switches per game version as boolean Preferences', async () => {
    const storage = createInMemoryPreferencesStorage({ sidebarModuleHistory_poe2: 'yes' });
    const outcome = await createPreferencesModule('poe2', storage);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // invalid stored value is repaired to the default
    expect(outcome.value.read().sidebarModuleHistory).toBe(true);
    const update = await outcome.value.update({ sidebarModulePobBuild: false });
    expect(update.ok).toBe(true);
    expect(storage.inspect()['sidebarModulePobBuild_poe2']).toBe(false);
    const invalid = await outcome.value.update({ sidebarModulePobBuild: 'off' as never });
    expect(invalid.ok).toBe(false);
  });

  it('derives pane scroll ownership from the single descriptor table', () => {
    for (const tab of [
      'bookmark',
      'history',
      'stat-group-template',
      'pob-build',
      'pinned-items',
      'result-board',
      'settings',
    ]) {
      expect(usesSidebarPaneScroll(tab)).toBe(true);
    }

    for (const tab of ['tools', 'live-search', 'unknown-tab', '']) {
      expect(usesSidebarPaneScroll(tab)).toBe(false);
    }
  });

  it('declares all toggleable modules and fixed tabs in one pure non-Vue descriptor table', () => {
    expect(SIDEBAR_DESCRIPTORS).toHaveLength(9);
    expect(SIDEBAR_FIXED_TAB_IDS).toEqual(['tools', 'settings']);
    expect(SIDEBAR_PANE_TABS.map((tab) => tab.id)).toEqual([
      'bookmark',
      'history',
      'stat-group-template',
      'pob-build',
      'pinned-items',
      'result-board',
      'tools',
      'settings',
    ]);

    const source = readFileSync('utils/sidebar-modules.ts', 'utf8');
    expect(source).not.toMatch(/from\s+['"]vue['"]/);
    expect(source).not.toMatch(/from\s+['"]@lucide\/vue['"]/);
  });

  it('resolves icons and localized labels for every Sidebar module and nav tab', () => {
    resetI18nStateForTests('zh-TW');
    for (const descriptor of SIDEBAR_DESCRIPTORS) {
      expect(SIDEBAR_DESCRIPTOR_ICONS[descriptor.id]).toBeTruthy();
      expect(descriptor.labelKey.length).toBeGreaterThan(0);
    }

    for (const module of SIDEBAR_MODULES) {
      expect(SIDEBAR_MODULE_PRESENTATION[module.id].icon).toBe(SIDEBAR_DESCRIPTOR_ICONS[module.id]);
      expect(getSidebarModuleLabel(module.id).length).toBeGreaterThan(0);
      expect(getSidebarModuleDescription(module.id).length).toBeGreaterThan(0);
    }

    expect(SIDEBAR_NAV_TABS.map((tab) => tab.id)).toEqual(SIDEBAR_PANE_TABS.map((tab) => tab.id));
    for (const tab of SIDEBAR_NAV_TABS) {
      expect(tab.icon).toBe(SIDEBAR_DESCRIPTOR_ICONS[tab.id]);
      expect(tab.name.length).toBeGreaterThan(0);
    }

    const zhName = SIDEBAR_NAV_TABS[0].name;
    resetI18nStateForTests('en');
    const enName = SIDEBAR_NAV_TABS[0].name;
    expect(enName).not.toBe(zhName);
    resetI18nStateForTests('zh-TW');
  });
});
