import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

describe('Theme Foundation Phase 2D — Theme Color Contract Tests', () => {
  const mainCssPath = path.resolve(__dirname, '../assets/main.css');
  const mainCssSource = readFileSync(mainCssPath, 'utf-8');

  const SHADCN_SEMANTIC_THEME_TOKENS = [
    'background',
    'foreground',
    'card',
    'card-foreground',
    'popover',
    'popover-foreground',
    'primary',
    'primary-foreground',
    'secondary',
    'secondary-foreground',
    'muted',
    'muted-foreground',
    'accent',
    'accent-foreground',
    'destructive',
    'destructive-foreground',
    'border',
    'input',
    'ring',
  ];

  // ---------------------------------------------------------------------------
  // Gate A: Theme Variable Existence & Completeness
  // ---------------------------------------------------------------------------
  describe('Gate A: Theme Variable Existence & Completeness', () => {
    it('declares all shadcn semantic theme tokens in Tailwind v4 @theme inline', () => {
      const themeInlineMatch = mainCssSource.match(/@theme\s+inline\s*\{([^}]+)\}/);
      expect(themeInlineMatch).toBeTruthy();
      const themeInlineContent = themeInlineMatch![1];

      for (const token of SHADCN_SEMANTIC_THEME_TOKENS) {
        const expectedLine = `--color-${token}: var(--${token});`;
        expect(themeInlineContent).toContain(expectedLine);
      }

      // Radius infrastructure
      expect(themeInlineContent).toContain('--radius-sm:');
      expect(themeInlineContent).toContain('--radius-md:');
      expect(themeInlineContent).toContain('--radius-lg:');
      expect(themeInlineContent).toContain('--radius-xl:');

      // Foundation geometry mappings
      expect(themeInlineContent).toContain('--spacing-sidebar: var(--pxd-sidebar-width);');
      expect(themeInlineContent).toContain('--spacing-control-sm: var(--control-height-sm);');
      expect(themeInlineContent).toContain(
        '--spacing-control-default: var(--control-height-default);',
      );
      expect(themeInlineContent).toContain('--spacing-control-lg: var(--control-height-lg);');
    });

    it('declares all semantic theme tokens and foundation geometry in :root, :host', () => {
      const rootMatch = mainCssSource.match(/(:root,\s*:host|:host,\s*:root)\s*\{([^}]+)\}/s);
      expect(rootMatch).toBeTruthy();
      const rootContent = rootMatch![2];

      for (const token of SHADCN_SEMANTIC_THEME_TOKENS) {
        const regex = new RegExp(`--${token}:\\s*[^;]+;`);
        expect(rootContent).toMatch(regex);
      }

      // Radius baseline declared
      expect(rootContent).toMatch(/--radius:\s*[^;]+;/);

      // Foundation Scale / Density / geometry tokens
      expect(rootContent).toContain('--pxd-ui-scale: 1;');
      expect(rootContent).toContain('--pxd-ui-density: 1;');
      expect(rootContent).toContain('--pxd-sidebar-width: 380px;');
      expect(rootContent).toContain('--control-height-default: 32px;');
    });

    it('strictly follows kebab-case naming for all custom CSS variables', () => {
      const allVars = mainCssSource.match(/--[a-zA-Z0-9_-]+/g) || [];
      expect(allVars.length).toBeGreaterThan(0);
      for (const v of allVars) {
        expect(v).toMatch(/^--[a-z0-9-]+$/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Gate B: Production UI Zero Raw UI Colors
  // ---------------------------------------------------------------------------
  describe('Gate B: Production UI Zero Raw UI Colors', () => {
    const uiDir = path.resolve(__dirname, '../components/ui');
    const getAllFiles = (dir: string): string[] => {
      const entries = readdirSync(dir, { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(getAllFiles(fullPath));
        } else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const primitiveFiles = getAllFiles(uiDir);

    it('verifies components/ui/* contains ZERO raw hex codes', () => {
      for (const file of primitiveFiles) {
        const content = readFileSync(file, 'utf-8');
        const rawHexMatches =
          content.match(/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g) || [];
        expect(
          rawHexMatches,
          `Raw hex colors found in ${path.relative(uiDir, file)}: ${rawHexMatches.join(', ')}`,
        ).toEqual([]);
      }
    });

    it('verifies .poe-btn-danger is eliminated from Sidebar.vue and no raw #5d1f1f exists', () => {
      const sidebarSource = readFileSync(
        path.resolve(__dirname, '../components/Sidebar.vue'),
        'utf-8',
      );
      expect(sidebarSource).not.toContain('.poe-btn-danger');
      expect(sidebarSource).not.toContain('#5d1f1f');
    });
  });

  // ---------------------------------------------------------------------------
  // Gate C: Theme Ownership for FilterPane Anchors and Mod Search Highlight
  // ---------------------------------------------------------------------------
  describe('Gate C: Theme Ownership for FilterPane Anchors and Mod Search Highlight', () => {
    it('enforces Theme ownership for FilterPane anchors and eliminates raw PoE color rules', () => {
      const filterPaneSource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/FilterPane.vue'),
        'utf-8',
      );
      const modItemSource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/ModItem.vue'),
        'utf-8',
      );

      // FilterPane anchors: no raw PoE color rules
      expect(filterPaneSource).not.toContain('.anchor-btn-inline.normal-color');
      expect(filterPaneSource).not.toContain('.anchor-btn-inline.corrupted-color');
      expect(filterPaneSource).not.toContain('.anchor-btn-inline.essence-color');
      expect(filterPaneSource).not.toContain('.anchor-btn-inline.desecrated-color');
      expect(filterPaneSource).not.toContain('.anchor-btn-inline.shaper-color');
      expect(filterPaneSource).not.toContain('.anchor-btn-inline.elder-color');
      expect(filterPaneSource).not.toContain('.anchor-btn-inline.crusader-color');

      // FilterPane anchors: uses Theme semantic tokens with mutually-exclusive active/inactive classes
      expect(filterPaneSource).toMatch(
        /currentActiveCategory === cat\.label\s*\?\s*['"]active bg-primary\/12 text-foreground border-l-primary font-semibold['"]\s*:\s*['"]bg-transparent text-muted-foreground border-l-transparent hover:bg-accent hover:text-accent-foreground['"]/,
      );
      const staticAnchorClassMatch = filterPaneSource.match(/class="anchor-btn-inline[^"]*"/);
      expect(staticAnchorClassMatch).toBeTruthy();
      expect(staticAnchorClassMatch![0]).not.toContain('bg-');
      expect(staticAnchorClassMatch![0]).not.toContain('text-muted-foreground');
      expect(staticAnchorClassMatch![0]).not.toContain('hover:');

      // FilterPane does not contain colorClass or getCategoryColorClass
      expect(filterPaneSource).not.toContain('colorClass');
      expect(filterPaneSource).not.toContain('getCategoryColorClass');

      // ModItem: text colors are Theme-owned (foreground, muted-foreground, primary)
      expect(modItemSource).toContain('text-foreground');
      expect(modItemSource).toContain('text-muted-foreground');
      expect(modItemSource).toContain('text-primary');
      expect(modItemSource).not.toContain('.mod-name.normal-color');
      expect(modItemSource).not.toContain('.tier-desc.normal-color');
      expect(modItemSource).not.toContain('#d4af37');
    });

    it('enforces Theme semantic colors in TradeSearchPreviewContent preview card and disallows untyped hardcoded colors', () => {
      const bookmarkSource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/BookmarkPane.vue'),
        'utf-8',
      );
      const previewContentSource = readFileSync(
        path.resolve(
          __dirname,
          '../components/sidebar/search-preview/TradeSearchPreviewContent.vue',
        ),
        'utf-8',
      );

      // Untyped preview metadata must not use hardcoded colors
      expect(bookmarkSource).not.toContain('#38bdf8');
      expect(bookmarkSource).not.toContain('#af6025');
      expect(bookmarkSource).not.toContain('#d4af37');
      expect(bookmarkSource).not.toContain('#f59e0b');

      expect(previewContentSource).not.toContain('#38bdf8');
      expect(previewContentSource).not.toContain('#af6025');
      expect(previewContentSource).not.toContain('#d4af37');
      expect(previewContentSource).not.toContain('#f59e0b');

      // Generic preview uses Theme semantic tokens (class-first)
      expect(previewContentSource).toContain('bg-secondary');
      expect(previewContentSource).toContain('text-secondary-foreground');
      expect(previewContentSource).toContain('text-foreground');
    });

    it('enforces Theme semantic colors on mod search highlight and disallows hardcoded gold/brown/glow', () => {
      const modItemSource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/ModItem.vue'),
        'utf-8',
      );
      expect(modItemSource).toContain(':deep(.mod-search-highlight)');
      expect(modItemSource).toMatch(
        /background-color:\s*color-mix\(in srgb, var\(--primary\) 22%, transparent\);/,
      );
      expect(modItemSource).toMatch(/color:\s*inherit\s*!important;/);
      expect(modItemSource).toContain('border-radius: var(--radius-sm);');
      expect(modItemSource).not.toContain('calc(var(--radius) * 0.35)');
      expect(modItemSource).not.toContain('#ffd700');
      expect(modItemSource).not.toContain('rgba(163, 140, 94');
      expect(modItemSource).not.toContain('rgba(255, 215, 0');
    });
  });

  // ---------------------------------------------------------------------------
  // Gate D: Phase 1 Boundary Enforcement
  // ---------------------------------------------------------------------------
  describe('Gate D: Phase 1 Boundary Enforcement', () => {
    it('enforces NO data-theme attributes in any Vue templates', () => {
      const componentsDir = path.resolve(__dirname, '../components');
      const getVueFiles = (dir: string): string[] => {
        const entries = readdirSync(dir, { withFileTypes: true });
        let files: string[] = [];
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files = files.concat(getVueFiles(fullPath));
          } else if (entry.name.endsWith('.vue')) {
            files.push(fullPath);
          }
        }
        return files;
      };

      const vueFiles = getVueFiles(componentsDir);
      for (const file of vueFiles) {
        const content = readFileSync(file, 'utf-8');
        expect(
          content,
          `${path.relative(componentsDir, file)} must not contain data-theme`,
        ).not.toContain('data-theme');
      }
    });

    it('enforces NO light theme or media prefers-color-scheme overrides in main.css', () => {
      expect(mainCssSource).not.toContain('prefers-color-scheme');
      expect(mainCssSource).not.toMatch(/\[data-theme=["']?light["']?\]/);
      expect(mainCssSource).not.toMatch(/\.light\s*\{/);
    });
  });

  // ---------------------------------------------------------------------------
  // Gate E: Surface Hierarchy & Shadow Portal Baseline
  // ---------------------------------------------------------------------------
  describe('Gate E: Surface Hierarchy & Shadow Portal Baseline', () => {
    it('keeps :root, :host strictly scoped to CSS variables without typography/foreground overrides', () => {
      const rootMatch = mainCssSource.match(/(:root,\s*:host|:host,\s*:root)\s*\{([^}]+)\}/s);
      expect(rootMatch).toBeTruthy();
      const rootContent = rootMatch![2];
      expect(rootContent).not.toMatch(/font-family:\s*[^;]+;/);
      expect(rootContent).not.toMatch(/(^|\s)color:\s*[^;]+;/);

      // Verify sidebar-layout.ts uiContainer establishes the single typography/foreground baseline
      const layoutSource = readFileSync(
        path.resolve(__dirname, '../entrypoints/content/logic/sidebar-layout.ts'),
        'utf-8',
      );
      expect(layoutSource).toContain(
        "container.style.fontFamily = \"'Microsoft JhengHei', '微軟正黑體', sans-serif\"",
      );
      expect(layoutSource).toContain("container.style.color = 'var(--foreground)'");
      expect(layoutSource).toContain("container.style.fontSize = 'var(--pxd-font-secondary)'");
    });

    it('enforces background canvas hierarchy in Sidebar.vue and eliminates radial-gradient', () => {
      const sidebarSource = readFileSync(
        path.resolve(__dirname, '../components/Sidebar.vue'),
        'utf-8',
      );
      expect(sidebarSource).toContain('bg-background');
      expect(sidebarSource).not.toContain('radial-gradient(');
      expect(sidebarSource).not.toMatch(/z-index:\s*9999999\b/);
      expect(sidebarSource).not.toContain('z-[9999999]');
      expect(sidebarSource).not.toContain('<style');
    });

    it('enforces true card surface on HistoryPane entries', () => {
      const historySource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/HistoryPane.vue'),
        'utf-8',
      );
      expect(historySource).toContain('bg-card');
      expect(historySource).not.toContain('bg-background');
    });

    it('confirms FilterPane groupedSelectedMods has zero stale colorClass', () => {
      const filterPaneSource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/FilterPane.vue'),
        'utf-8',
      );
      const groupedSelectedModsMatch = filterPaneSource.match(
        /const groupedSelectedMods = computed\(\(\) => \{([\s\S]*?)\n    \}\);/,
      );
      expect(groupedSelectedModsMatch).toBeTruthy();
      expect(groupedSelectedModsMatch![1]).not.toContain('colorClass');
    });
  });

  // ---------------------------------------------------------------------------
  // Gate F: Semantic Foreground Pairing Contract
  // ---------------------------------------------------------------------------
  describe('Gate F: Semantic Foreground Pairing Contract', () => {
    it('pairs hover:bg-accent with hover:text-accent-foreground in Button ghost variant', () => {
      const buttonIndexPath = path.resolve(__dirname, '../components/ui/button/index.ts');
      const buttonSource = readFileSync(buttonIndexPath, 'utf-8');
      expect(buttonSource).toContain('hover:bg-accent hover:text-accent-foreground');
      expect(buttonSource).not.toContain('hover:bg-accent hover:text-foreground');
    });

    it('pairs focus and open states with text-accent-foreground in DropdownMenuSubTrigger', () => {
      const subTriggerPath = path.resolve(
        __dirname,
        '../components/ui/dropdown-menu/DropdownMenuSubTrigger.vue',
      );
      const subTriggerSource = readFileSync(subTriggerPath, 'utf-8');
      expect(subTriggerSource).toContain('focus:bg-accent focus:text-accent-foreground');
      expect(subTriggerSource).toContain(
        'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
      );
    });

    it('pairs group-header hover with text-accent-foreground in FilterPane', () => {
      const filterPanePath = path.resolve(__dirname, '../components/sidebar/FilterPane.vue');
      const filterPaneSource = readFileSync(filterPanePath, 'utf-8');
      expect(filterPaneSource).toMatch(
        /group-header[^"]*hover:bg-accent hover:text-accent-foreground/,
      );
      expect(filterPaneSource).toContain('group-hover/header:text-accent-foreground');
    });

    it('preserves domain hierarchy in normal state and switches to accent-foreground on hover in ModItem', () => {
      const modItemPath = path.resolve(__dirname, '../components/sidebar/ModItem.vue');
      const modItemSource = readFileSync(modItemPath, 'utf-8');

      // Mod row
      expect(modItemSource).toContain('text-foreground group-hover/mod-row:text-accent-foreground');
      expect(modItemSource).toContain(
        'text-muted-foreground group-hover/mod-row:text-accent-foreground',
      );

      // Tier row
      expect(modItemSource).toContain('text-primary group-hover/tier-row:text-accent-foreground');
      expect(modItemSource).toContain(
        'text-muted-foreground group-hover/tier-row:text-accent-foreground',
      );

      // Highlight inherit
      expect(modItemSource).toContain('color: inherit !important;');
      expect(modItemSource).not.toContain('color: var(--foreground) !important;');
    });
  });
});
