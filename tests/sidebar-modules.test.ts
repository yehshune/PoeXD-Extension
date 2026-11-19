import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_MODULE_PREFERENCES,
  SIDEBAR_MODULES,
  countEnabledSidebarModules,
  getSidebarModule,
  isSidebarModuleEnabled,
  resolveActivePaneTab,
  resolveVisiblePaneTabs,
} from '@/utils/sidebar-modules';
import { DEFAULT_PREFERENCES } from '@/utils/preferences-contract';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';

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
});
