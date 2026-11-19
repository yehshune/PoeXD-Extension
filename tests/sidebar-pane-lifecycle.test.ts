import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_POSITION_OPTIONS } from '@/components/sidebar/settings/settings-ui-metadata';

const sidebarSource = readFileSync(new URL('../components/Sidebar.vue', import.meta.url), 'utf8');
const settingsSource = readFileSync(
  new URL('../components/sidebar/SettingsPane.vue', import.meta.url),
  'utf8',
);
const toggleRowsSource = readFileSync(
  new URL('../components/sidebar/settings/settings-toggle-rows.ts', import.meta.url),
  'utf8',
);

const panes = [
  ['BookmarkPane', 'bookmark'],
  ['HistoryPane', 'history'],
  ['ToolsPane', 'tools'],
  ['SettingsPane', 'settings'],
] as const;

const lazyPanes = [
  ['BookmarkPane', 'bookmark'],
  ['HistoryPane', 'history'],
  ['StatGroupTemplatePane', 'stat-group-template'],
  ['PobBuildPane', 'pob-build'],
  ['ToolsPane', 'tools'],
] as const;

describe('Sidebar pane lifecycle', () => {
  it('keeps the sidebar hidden until its saved settings are loaded', () => {
    expect(sidebarSource).toMatch(
      /:class="\{\s*['"]?collapsed['"]?:\s*isCollapsed,\s*'settings-pending invisible':\s*!areSettingsReady,?\s*\}"/,
    );
    expect(sidebarSource).toContain('@ready="settingsPaneReady = true"');
    expect(sidebarSource).toContain('const areSettingsReady = ref(false);');
    // 開頁就停在設定分頁時，等設定分頁讀完偏好才顯示
    expect(sidebarSource).toContain(
      "if (isTabMounted('settings') && !settingsPaneReady.value) return;",
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
  });

  it.each(lazyPanes)(
    'mounts %s the first time its tab is shown, then keeps it',
    (component, tab) => {
      expect(sidebarSource).toMatch(
        new RegExp(
          `<${component}\\s+v-if="isTabMounted\\('${tab}'\\)(?: && isTabVisible\\('${tab}'\\))?"\\s+v-show="activeTab === '${tab}'"`,
        ),
      );
      // 只會加入、不會移除：顯示過的分頁之後切換都不會重新掛載
      expect(sidebarSource).toMatch(
        /if \(!sidebarStateReady\.value \|\| isCollapsed\.value\) return;[\s\S]*?mountedTabs\.value = new Set\(\[\.\.\.mountedTabs\.value, tab\]\);/,
      );
    },
  );

  it('mounts SettingsPane the first time the settings tab is shown', () => {
    expect(sidebarSource).toMatch(
      /<SettingsPane\s+v-if="isTabMounted\('settings'\)"\s+v-show="activeTab === 'settings'"/,
    );
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
    expect(settingsSource).toContain('RESULT_TOGGLE_ROWS');
    expect(toggleRowsSource).toContain("key: 'enablePriceComparison'");
  });

  it('exposes the result modifier highlighting setting', () => {
    expect(toggleRowsSource).toContain("key: 'enableResultModHighlight'");
    expect(toggleRowsSource).toContain("key: 'enableResultModQuickFilter'");
  });

  it('exposes left and right sidebar controls', () => {
    expect(settingsSource).toContain('sidebarPosition');
    expect(settingsSource).toContain('SIDEBAR_POSITION_OPTIONS');
    expect(SIDEBAR_POSITION_OPTIONS.map((opt) => opt.value)).toContain('left');
    expect(SIDEBAR_POSITION_OPTIONS.map((opt) => opt.value)).toContain('right');
  });
});
