import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_POSITION_OPTIONS } from '@/components/sidebar/settings/settings-ui-metadata';

const sidebarSource = readFileSync(new URL('../components/Sidebar.vue', import.meta.url), 'utf8');
const settingsSource = readFileSync(
  new URL('../components/sidebar/SettingsPane.vue', import.meta.url),
  'utf8',
);

const panes = [
  ['BookmarkPane', 'bookmark'],
  ['HistoryPane', 'history'],
  ['ToolsPane', 'tools'],
  ['SettingsPane', 'settings'],
] as const;

describe('Sidebar pane lifecycle', () => {
  it('keeps the sidebar hidden until its saved settings are loaded', () => {
    expect(sidebarSource).toMatch(
      /:class="\{\s*['"]?collapsed['"]?:\s*isCollapsed,\s*'settings-pending invisible':\s*!areSettingsReady,?\s*\}"/,
    );
    expect(sidebarSource).toContain('@ready="settingsPaneReady = true"');
    expect(sidebarSource).toContain(
      'const areSettingsReady = computed(() => sidebarStateReady.value && settingsPaneReady.value);',
    );
    expect(sidebarSource).toContain('sidebarStateReady.value = true;');
    expect(sidebarSource).not.toContain('<style');
    expect(settingsSource).toMatch(/emit\(['"]ready['"]\)/);
  });

  it('keeps the expanded sidebar mounted while collapsed', () => {
    expect(sidebarSource).toMatch(
      /<Button\s+v-show="isCollapsed"[\s\S]*?data-sidebar-action="expand"/,
    );
    expect(sidebarSource).toMatch(/<div\s+v-show="!isCollapsed"\s+class="sidebar-container[^"]*"/);
    expect(sidebarSource).not.toContain('v-if="isCollapsed"');
  });

  it('does not render the Bookmark empty state before initial loading finishes', () => {
    const bookmarkSource = readFileSync(
      new URL('../components/sidebar/BookmarkPane.vue', import.meta.url),
      'utf8',
    );

    expect(bookmarkSource).toMatch(/v-if="isLoading"[\s\S]*?class="empty-state/);
    expect(bookmarkSource).toMatch(/v-else-if="groups\.length === 0"[\s\S]*?class="empty-state/);
    expect(bookmarkSource).toContain('isLoading.value = false;');
  });

  it.each(panes)('keeps %s mounted while switching tabs', (component, tab) => {
    expect(sidebarSource).toMatch(
      new RegExp(`<${component}[\\s\\S]*?v-show="activeTab === '${tab}'"`),
    );
    expect(sidebarSource).not.toContain(`<${component} v-if=`);
  });

  it('falls back to Bookmarks when a saved tab no longer exists', () => {
    expect(sidebarSource).toMatch(
      /tabs\.some\(\(?tab\)?\s*=>\s*tab\.id\s*===\s*storedActiveTab\)[\s\S]*?\?\s*storedActiveTab[\s\S]*?:\s*'bookmark'/,
    );
  });

  it('does not expose the retired Ninja currency pane', () => {
    expect(sidebarSource).not.toContain('CurrencyPane');
    expect(sidebarSource).not.toContain("id: 'currency'");
  });

  it('exposes the price comparison setting', () => {
    expect(settingsSource).toContain('v-model="enablePriceComparison"');
  });

  it('exposes the result modifier highlighting setting', () => {
    expect(settingsSource).toContain('v-model="enableResultModHighlight"');
    expect(settingsSource).toContain('v-model="enableResultModQuickFilter"');
  });

  it('exposes left and right sidebar controls', () => {
    expect(settingsSource).toContain('sidebarPosition');
    expect(settingsSource).toContain('SIDEBAR_POSITION_OPTIONS');
    expect(SIDEBAR_POSITION_OPTIONS.map((opt) => opt.value)).toContain('left');
    expect(SIDEBAR_POSITION_OPTIONS.map((opt) => opt.value)).toContain('right');
  });
});
