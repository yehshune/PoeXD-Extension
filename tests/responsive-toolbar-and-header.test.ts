// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Unified Responsive Design Contract: Header & Toolbars', () => {
  const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8');
  const sidebarPaneSource = readFileSync('components/sidebar/layout/SidebarPane.vue', 'utf8');
  const bookmarkPaneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
  const historyPaneSource = readFileSync('components/sidebar/HistoryPane.vue', 'utf8');
  const statGroupToolbarSource = readFileSync(
    'components/sidebar/stat-group-templates/StatGroupTemplateToolbar.vue',
    'utf8',
  );
  const settingsPaneSource = readFileSync('components/sidebar/SettingsPane.vue', 'utf8');
  const toggleIndexSource = readFileSync('components/ui/toggle/index.ts', 'utf8');
  const mainCssSource = readFileSync('assets/main.css', 'utf8');

  describe('1. Sidebar Top Header & Tab Title (Item 1)', () => {
    it('enforces @container on sidebar content with inline-size container type', () => {
      expect(sidebarSource).toContain(
        'class="sidebar-content flex-1 h-full bg-background flex flex-col box-border min-w-0 @container"',
      );
      expect(sidebarSource).toContain("containerType: 'inline-size'");
    });

    it('prevents active-tab-title from wrapping, enforcing whitespace-nowrap and truncate', () => {
      expect(sidebarSource).toMatch(
        /class="active-tab-title[^"]*whitespace-nowrap[^"]*shrink-0[^"]*min-w-0[^"]*truncate"/,
      );
      expect(sidebarSource).toContain(':title="activeTabName"');
    });

    it('sets min-w-0 and overflow-hidden on header-left and marks app-title and app-version with responsive classes', () => {
      expect(sidebarSource).toMatch(
        /class="header-left flex items-baseline gap-\[var\(--pxd-space-sm\)\] min-w-0 shrink overflow-hidden"/,
      );
      expect(sidebarSource).toContain('pxd-header-title');
      expect(sidebarSource).toContain('pxd-header-version');
    });

    it('defines container queries in main.css to hide version and title on small container widths', () => {
      expect(mainCssSource).toMatch(
        /@container\s*\(max-width:\s*320px\)\s*\{\s*\.pxd-header-version\s*\{\s*display:\s*none\s*!important;\s*\}\s*\}/,
      );
      expect(mainCssSource).toMatch(
        /@container\s*\(max-width:\s*250px\)\s*\{\s*\.pxd-header-title\s*\{\s*display:\s*none\s*!important;\s*\}\s*\}/,
      );
    });
  });

  describe('2. SidebarPane Container & Fixed Slot Boundary (Items 1 & 2)', () => {
    it('declares @container and container-type: inline-size on sidebar-pane', () => {
      expect(sidebarPaneSource).toContain('@container');
      expect(sidebarPaneSource).toMatch(/container-type:\s*inline-size;?"/);
    });

    it('constrains fixed slot with min-w-0 and w-full', () => {
      expect(sidebarPaneSource).toMatch(
        /data-slot="sidebar-pane-fixed"[^>]*class="[^"]*min-w-0 w-full"/,
      );
    });
  });

  describe('3. BookmarkPane Top Controls Toolbar (Item 2)', () => {
    it('constrains top toolbar row with w-full max-w-full min-w-0', () => {
      expect(bookmarkPaneSource).toMatch(
        /class="flex items-center gap-\[var\(--pxd-space-sm\)\] pb-\[var\(--pxd-space-md\)\] w-full max-w-full min-w-0"/,
      );
    });

    it('provides FolderPlus icon and pxd-toolbar-btn-text label for New Folder button', () => {
      expect(bookmarkPaneSource).toMatch(
        /<FolderPlus \/>[\s\S]*?<span class="pxd-toolbar-btn-text ml-1\.5 truncate">/,
      );
    });

    it('provides ChevronsUpDown icon and pxd-toolbar-btn-text label for Expand/Collapse button', () => {
      expect(bookmarkPaneSource).toMatch(
        /<ChevronsUpDown \/>[\s\S]*?<span class="pxd-toolbar-btn-text ml-1\.5 truncate">/,
      );
    });
  });

  describe('4. History and Affix Group Top Controls (Item 3)', () => {
    it('HistoryPane: constrains top row, truncates label, and equips Clear All button with Trash2 and responsive label', () => {
      expect(historyPaneSource).toMatch(
        /class="flex items-center justify-between gap-\[var\(--pxd-space-sm\)\] pb-\[var\(--pxd-space-md\)\] w-full min-w-0"/,
      );
      expect(historyPaneSource).toMatch(/for="enable-history"[^>]*class="[^"]*min-w-0 truncate"/);
      expect(historyPaneSource).toMatch(
        /<Trash2 \/>[\s\S]*?<span class="pxd-toolbar-btn-text ml-1\.5 truncate">/,
      );
    });

    it('StatGroupTemplateToolbar: constrains toolbar, equips Save Current with BookmarkPlus and Undo with Undo2 and responsive labels', () => {
      expect(statGroupToolbarSource).toMatch(
        /class="flex items-center gap-\[var\(--pxd-space-sm\)\] pb-\[var\(--pxd-space-md\)\] w-full max-w-full min-w-0"/,
      );
      expect(statGroupToolbarSource).toMatch(
        /<BookmarkPlus \/>[\s\S]*?<span class="pxd-toolbar-btn-text ml-1\.5 truncate">/,
      );
      expect(statGroupToolbarSource).toMatch(
        /<Undo2 \/>[\s\S]*?<span class="pxd-toolbar-btn-text ml-1\.5 truncate">/,
      );
    });

    it('assets/main.css: defines container query hiding pxd-toolbar-btn-text on small widths', () => {
      expect(mainCssSource).toMatch(
        /@container\s*\(max-width:\s*300px\)\s*\{\s*\.pxd-toolbar-btn-text\s*\{\s*display:\s*none\s*!important;\s*\}\s*\}/,
      );
    });
  });

  describe('5. Search Entry Click Action & Toggle Variants (Item 4)', () => {
    it('toggleVariants defines whitespace-nowrap to prevent text wrapping inside toggles', () => {
      expect(toggleIndexSource).toContain('whitespace-nowrap');
    });

    it('SettingsPane searchEntryClickAction ToggleGroupItem has whitespace-nowrap, overflow-hidden, and truncate', () => {
      expect(settingsPaneSource).toMatch(
        /<ToggleGroupItem[\s\S]*?class="flex-1 px-1 whitespace-nowrap overflow-hidden"[\s\S]*?<span class="truncate block w-full text-center">/,
      );
    });
  });

  describe('6. Unified Spacing Contract: 3 Vertical Gaps Across Panes', () => {
    it('Gap 1 (Header border-b to controls area): SidebarPane fixed slot uses pt-[var(--pxd-space-md)]', () => {
      expect(sidebarPaneSource).toMatch(
        /data-slot="sidebar-pane-fixed"[^>]*class="[^"]*pt-\[var\(--pxd-space-md\)\][^"]*pb-0[^"]*"/,
      );
    });

    it('Gap 2 (Controls toolbar bottom to separator): Bookmark, History, and StatGroup all use pb-[var(--pxd-space-md)] and mb-only Separator', () => {
      // BookmarkPane
      expect(bookmarkPaneSource).toMatch(
        /class="flex items-center gap-\[var\(--pxd-space-sm\)\] pb-\[var\(--pxd-space-md\)\]/,
      );
      expect(bookmarkPaneSource).toMatch(/<Separator class="mb-\[var\(--pxd-space-md\)\]" \/>/);
      expect(bookmarkPaneSource).not.toMatch(/<Separator class="my-\[var\(--pxd-space-md\)\]"/);

      // HistoryPane
      expect(historyPaneSource).toMatch(
        /class="flex items-center justify-between gap-\[var\(--pxd-space-sm\)\] pb-\[var\(--pxd-space-md\)\]/,
      );
      expect(historyPaneSource).toMatch(/<Separator class="mb-\[var\(--pxd-space-md\)\]" \/>/);
      expect(historyPaneSource).not.toMatch(/<Separator class="my-\[var\(--pxd-space/);

      // StatGroupTemplateToolbar
      expect(statGroupToolbarSource).toMatch(
        /class="flex items-center gap-\[var\(--pxd-space-sm\)\] pb-\[var\(--pxd-space-md\)\]/,
      );
      expect(statGroupToolbarSource).toMatch(/<Separator class="mb-\[var\(--pxd-space-md\)\]" \/>/);
      expect(statGroupToolbarSource).not.toMatch(/<Separator class="my-\[var\(--pxd-space/);
    });

    it('Gap 3 (Separator to content area): Bookmark, History, and StatGroup all space content with var(--pxd-space-md)', () => {
      // Separators have mb-[var(--pxd-space-md)]
      expect(bookmarkPaneSource).toMatch(/<Separator class="mb-\[var\(--pxd-space-md\)\]" \/>/);
      expect(bookmarkPaneSource).toMatch(/bookmark-accordion-list[^"]*pt-0/);
      expect(bookmarkPaneSource).not.toMatch(
        /bookmark-accordion-list[^"]*pt-\[var\(--pxd-space-xs\)\]/,
      );

      expect(historyPaneSource).toMatch(/<Separator class="mb-\[var\(--pxd-space-md\)\]" \/>/);
      expect(statGroupToolbarSource).toMatch(/<Separator class="mb-\[var\(--pxd-space-md\)\]" \/>/);
    });
  });
});
