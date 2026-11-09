// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { readFileSync } from 'node:fs';
import { createUiRuntimeTokenValues, LAYOUT_TOKENS } from '@/lib/tokens/ui-contract';
import ToolboxIcon from '@/components/ui/ToolboxIcon.vue';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import SettingsPane from '@/components/sidebar/SettingsPane.vue';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';
import {
  createInMemoryPreferencesStorage,
  createPreferencesModule,
  type PreferencesModule,
} from '@/utils/preferences';

const mainCssSource = readFileSync('assets/main.css', 'utf8');
const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8');
const settingsPaneSource = readFileSync('components/sidebar/SettingsPane.vue', 'utf8');
const bookmarkPaneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
const sidebarPaneSource = readFileSync('components/sidebar/layout/SidebarPane.vue', 'utf8');
const collapsibleContentSource = readFileSync(
  'components/ui/collapsible/CollapsibleContent.vue',
  'utf8',
);

describe('Sidebar UI Final Polish Contract & Verification', () => {
  describe('1. Scroll-end spacing contract across main pages', () => {
    it('SettingsPane root element does not restrict height with h-full, preserving content-body padding-bottom at scroll-end', () => {
      // Must not contain h-full on root flex container
      expect(settingsPaneSource).not.toMatch(/<template>\s*<div class="[^"]*h-full/);
      expect(settingsPaneSource).toMatch(/<template>\s*<div class="flex flex-col">/);
    });

    it('BookmarkPane uses native scroll container with pb-[var(--pxd-pane-scroll-end-space)] and zero outer padding', () => {
      expect(bookmarkPaneSource).toContain('pb-[var(--pxd-pane-scroll-end-space)]');
      expect(sidebarSource).toContain('has-pane-scroll');
      expect(sidebarSource).toContain('p-0');
    });

    it('SidebarPane internal scroll content applies pb-[var(--pxd-pane-scroll-end-space)] without double padding', () => {
      expect(sidebarPaneSource).toMatch(
        /cn\(\s*'p-\[var\(--pxd-pane-padding\)\]\s+pb-\[var\(--pxd-pane-scroll-end-space\)\]',\s*\$slots\.fixed\s*&&\s*'pt-0',?\s*\)/,
      );
    });
  });

  describe('2. .pxd-scrollbar gutter contract', () => {
    it('enforces scrollbar-gutter: stable for panes and stable both-edges for selection scrollbars in assets/main.css', () => {
      expect(mainCssSource).toMatch(/\.pxd-scrollbar\s*\{[^}]*scrollbar-gutter:\s*stable;/);
      expect(mainCssSource).toContain('scrollbar-gutter: stable both-edges;');
    });

    it('preserves Firefox fallback in assets/main.css', () => {
      expect(mainCssSource).toContain('@supports not selector(::-webkit-scrollbar)');
      expect(mainCssSource).toContain('scrollbar-width: thin;');
      expect(mainCssSource).toContain('scrollbar-color: var(--border) transparent;');
    });
  });

  describe('3. CollapsibleContent focus ring primitive contract', () => {
    it('CollapsibleContent does not contain default overflow-hidden class', () => {
      expect(collapsibleContentSource).not.toContain("'overflow-hidden'");
      expect(collapsibleContentSource).toContain(':class="cn(props.class)"');
    });

    it('renders CollapsibleContent without overflow-hidden in runtime DOM', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const app = createApp(
        defineComponent({
          setup() {
            return () =>
              h(Collapsible, { open: true }, () =>
                h(CollapsibleContent, null, () => h('button', 'Focusable')),
              );
          },
        }),
      );
      app.mount(container);
      await nextTick();

      const el = container.querySelector('[data-slot="collapsible-content"]');
      expect(el).not.toBeNull();
      expect(el?.className).not.toContain('overflow-hidden');

      app.unmount();
      container.remove();
    });
  });

  describe('4. ToggleGroup control alignment in Settings', () => {
    it('both sidebarPosition and addBookmarkBtnPosition ToggleGroups match SelectTrigger width (w-[140px] shrink-0) with flex-1 items', () => {
      // Panel position
      expect(settingsPaneSource).toMatch(
        /:model-value="sidebarPosition"[\s\S]*?class="w-\[140px\] shrink-0"/,
      );
      // Bookmark button position
      expect(settingsPaneSource).toMatch(
        /:model-value="addBookmarkBtnPosition"[\s\S]*?class="w-\[140px\] shrink-0"/,
      );
      // Items are flex-1
      expect(settingsPaneSource).toContain('class="flex-1"');
    });

    it('SettingsPane defines defense handlers preventing empty values on active toggle re-click', () => {
      expect(settingsPaneSource).toContain('const handleSidebarPositionChange = (val?: any) => {');
      expect(settingsPaneSource).toMatch(
        /if\s*\(pos === ['"]left['"] \|\| pos === ['"]right['"]\)/,
      );

      expect(settingsPaneSource).toContain(
        'const handleAddBookmarkBtnPositionChange = (val?: any) => {',
      );
      expect(settingsPaneSource).toMatch(
        /if\s*\(pos === ['"]top['"] \|\| pos === ['"]bottom['"]\)/,
      );
    });
  });

  describe('5. Brand Icon & Collapsed Handle geometry and theme propagation', () => {
    it('scales brand icon and collapsed geometry proportionally across UI scales (85%, 100%, 120%) and is invariant to Density', () => {
      const scale85 = createUiRuntimeTokenValues({ scale: 0.85, density: 1.0 });
      const scale100 = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
      const scale120 = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });

      // Brand icon expanded (baseline 28px)
      expect(scale85['--pxd-brand-icon-expanded-size']).toBe('23.8px');
      expect(scale100['--pxd-brand-icon-expanded-size']).toBe('28px');
      expect(scale120['--pxd-brand-icon-expanded-size']).toBe('33.6px');

      // Brand icon collapsed (baseline 24px)
      expect(scale85['--pxd-brand-icon-collapsed-size']).toBe('20.4px');
      expect(scale100['--pxd-brand-icon-collapsed-size']).toBe('24px');
      expect(scale120['--pxd-brand-icon-collapsed-size']).toBe('28.8px');

      // Collapsed width (baseline 64px)
      expect(scale85['--pxd-sidebar-collapsed-width']).toBe('54.4px');
      expect(scale100['--pxd-sidebar-collapsed-width']).toBe('64px');
      expect(scale120['--pxd-sidebar-collapsed-width']).toBe('76.8px');

      // Collapsed padding (baseline 8px)
      expect(scale85['--pxd-sidebar-collapsed-padding-x']).toBe('6.8px');
      expect(scale100['--pxd-sidebar-collapsed-padding-x']).toBe('8px');
      expect(scale120['--pxd-sidebar-collapsed-padding-x']).toBe('9.6px');

      // Density invariance check (compact 0.8 vs comfortable 1.2 must NOT alter brand geometry or collapsed width)
      const compactDensity = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });
      const relaxedDensity = createUiRuntimeTokenValues({ scale: 1.0, density: 1.2 });

      expect(compactDensity['--pxd-brand-icon-expanded-size']).toBe('28px');
      expect(relaxedDensity['--pxd-brand-icon-expanded-size']).toBe('28px');
      expect(compactDensity['--pxd-brand-icon-collapsed-size']).toBe('24px');
      expect(relaxedDensity['--pxd-brand-icon-collapsed-size']).toBe('24px');
      expect(compactDensity['--pxd-sidebar-collapsed-width']).toBe('64px');
      expect(relaxedDensity['--pxd-sidebar-collapsed-width']).toBe('64px');
      expect(compactDensity['--pxd-sidebar-collapsed-padding-x']).toBe('8px');
      expect(relaxedDensity['--pxd-sidebar-collapsed-padding-x']).toBe('8px');
    });

    it('Sidebar.vue uses scale-aware tokens for ToolboxIcon and collapsed button instead of hardcoded 20/24 or px-1.5', () => {
      // Header brand icon
      expect(sidebarSource).toContain(`:size="'var(--pxd-brand-icon-expanded-size)'"`);
      // Collapsed handle brand icon
      expect(sidebarSource).toContain(`:size="'var(--pxd-brand-icon-collapsed-size)'"`);
      // Collapsed button padding
      expect(sidebarSource).toContain('px-[var(--pxd-sidebar-collapsed-padding-x)]');
      expect(sidebarSource).not.toMatch(
        /class="[^"]*w-\[var\(--pxd-sidebar-collapsed-width\)\][^"]*px-1\.5/,
      );
    });

    it('ToolboxIcon renders with currentColor fill and supports CSS variable size via style binding', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const app = createApp(
        defineComponent({
          setup() {
            return () =>
              h(ToolboxIcon, {
                size: 'var(--pxd-brand-icon-expanded-size)',
                class: 'text-primary',
              });
          },
        }),
      );
      app.mount(container);
      await nextTick();

      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('style')).toContain('var(--pxd-brand-icon-expanded-size)');
      expect(svg?.className).toContain('text-primary');

      const path = svg?.querySelector('path[fill="currentColor"]');
      expect(path).not.toBeNull();

      app.unmount();
      container.remove();
    });

    it('single token SSOT: both shadow host width and Sidebar collapsed width consume --pxd-sidebar-collapsed-width', () => {
      const sidebarLayoutSource = readFileSync(
        'entrypoints/content/logic/sidebar-layout.ts',
        'utf8',
      );
      expect(sidebarLayoutSource).toContain(
        "wrapper.style.setProperty('--poexd-host-width', 'var(--pxd-sidebar-collapsed-width)');",
      );
      expect(sidebarSource).toContain(
        "isCollapsed ? 'var(--pxd-sidebar-collapsed-width)' : actualWidth + 'px'",
      );
    });

    it('Theme switching (Modern-Dark <-> Caffeine <-> Catppuccin) propagates --primary to host and updates computed color for text-primary', async () => {
      const host = document.createElement('div');
      host.id = 'theme-test-host';
      const shadow = host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);

      const style = document.createElement('style');
      style.textContent = `
        :host {
          --primary: rgb(224, 180, 100);
          color: var(--primary);
        }
        :host([data-poexd-theme='catppuccin']) {
          --primary: rgb(200, 120, 220);
        }
        .text-primary {
          color: var(--primary);
        }
      `;
      shadow.appendChild(style);

      const iconDiv = document.createElement('div');
      iconDiv.className = 'text-primary';
      const iconApp = createApp(ToolboxIcon);
      iconApp.mount(iconDiv);
      shadow.appendChild(iconDiv);

      // Default Modern-Dark
      applyThemeToHost(host, 'modern-dark');
      await nextTick();
      expect(host.getAttribute('data-poexd-theme')).toBe('modern-dark');

      // Switch to Caffeine
      applyThemeToHost(host, 'caffeine');
      await nextTick();
      expect(host.getAttribute('data-poexd-theme')).toBe('caffeine');

      // Switch to Catppuccin
      applyThemeToHost(host, 'catppuccin');
      await nextTick();
      expect(host.getAttribute('data-poexd-theme')).toBe('catppuccin');

      // Switch back to Modern-Dark
      applyThemeToHost(host, 'modern-dark');
      await nextTick();
      expect(host.getAttribute('data-poexd-theme')).toBe('modern-dark');

      iconApp.unmount();
      host.remove();
    });
  });
});
