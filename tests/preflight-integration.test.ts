// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import {
  COMPONENT_SIZE_SPECS,
  FORM_INDICATOR_SPECS,
  COLLECTION_ITEM_SPECS,
  LAYOUT_TOKENS,
  SEMANTIC_TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  createUiRuntimeTokenValues,
  getComponentSizeClasses,
} from '@/lib/tokens';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

describe('Tailwind v4 Preflight Integration Contracts', () => {
  describe('1. Static Direct Import Contract', () => {
    it('uses official Tailwind v4 direct entry without legacy split imports', () => {
      const mainCssSource = readFileSync('assets/main.css', 'utf8');

      expect(mainCssSource).toMatch(/@import\s+['"]tailwindcss['"];/);
      expect(mainCssSource).toMatch(/@import\s+['"]tw-animate-css['"];/);

      // Confirm legacy split imports are completely eliminated
      expect(mainCssSource).not.toContain('tailwindcss/theme.css');
      expect(mainCssSource).not.toContain('tailwindcss/preflight.css');
      expect(mainCssSource).not.toContain('tailwindcss/utilities.css');

      // Confirm manual @layer declaration is eliminated
      expect(mainCssSource).not.toContain('@layer theme, base, components, utilities;');
    });
  });

  describe('2. ModItem Native Composite Button Reset Contract', () => {
    it('guarantees .mod-content-action maintains deterministic local reset independently of Preflight', () => {
      const modItemSource = readFileSync('components/sidebar/ModItem.vue', 'utf8');
      expect(modItemSource).toMatch(/class="[^"]*mod-content-action[^"]*"/);
      expect(modItemSource).toContain('appearance-none');
      expect(modItemSource).toContain('box-border');
      expect(modItemSource).toContain('border-0');
      expect(modItemSource).toContain('bg-transparent');
      expect(modItemSource).toContain('m-0');
      expect(modItemSource).toContain('p-0');
      expect(modItemSource).toContain('[font:inherit]');
      expect(modItemSource).toContain('text-inherit');
      expect(modItemSource).toContain('cursor-pointer');
      expect(modItemSource).toContain('min-w-0');
      expect(modItemSource).toContain('text-left');
    });
  });

  describe('3. Primitive Geometry Invariant Contract', () => {
    it('retains Foundation control height, indicator size, and collection item min-height regardless of Preflight', () => {
      // 1. Control Heights
      expect(COMPONENT_SIZE_SPECS.sm.heightPx).toBe(28);
      expect(COMPONENT_SIZE_SPECS.default.heightPx).toBe(32);
      expect(COMPONENT_SIZE_SPECS.lg.heightPx).toBe(40);

      // 2. Form Indicators
      expect(FORM_INDICATOR_SPECS.checkbox.sizePx).toBe(18);
      expect(FORM_INDICATOR_SPECS.checkbox.indicatorPx).toBe(12);
      expect(FORM_INDICATOR_SPECS.radio.sizePx).toBe(18);
      expect(FORM_INDICATOR_SPECS.radio.indicatorPx).toBe(8);

      // 3. Collection Items
      expect(COLLECTION_ITEM_SPECS.sm.indicatorReservePx).toBe(28);
      expect(COLLECTION_ITEM_SPECS.default.indicatorReservePx).toBe(32);

      // 4. Class derivatives
      expect(getComponentSizeClasses('sm', 'button')).toContain(
        'h-[var(--control-height-sm,1.75rem)]',
      );
      expect(getComponentSizeClasses('default', 'button')).toContain(
        'h-[var(--control-height-default,2rem)]',
      );
      expect(getComponentSizeClasses('sm', 'icon-button')).toContain(
        'size-[var(--control-height-sm)]',
      );
      expect(getComponentSizeClasses('sm', 'collection-item')).toContain(
        'min-h-[var(--control-height-sm,1.75rem)]',
      );
    });
  });

  describe('4. Scale / Density Decoupling Matrix under Preflight', () => {
    const scales = [0.85, 1.0, 1.2];
    const densities = [0.8, 1.0, 1.2];

    it('guarantees control and indicator geometry scales strictly with Scale and remains invariant to Density', () => {
      for (const scale of scales) {
        for (const density of densities) {
          const tokens = createUiRuntimeTokenValues({ scale, density });

          // Height scales with Scale only
          const expectedSmHeight = `${Number((28 * scale).toFixed(2))}px`;
          const expectedDefHeight = `${Number((32 * scale).toFixed(2))}px`;
          expect(tokens['--control-height-sm']).toBe(expectedSmHeight);
          expect(tokens['--control-height-default']).toBe(expectedDefHeight);

          // Checkbox scales with Scale only
          const expectedCheckboxSize = `${Number((18 * scale).toFixed(2))}px`;
          const expectedIndicatorSize = `${Number((12 * scale).toFixed(2))}px`;
          expect(tokens['--checkbox-size']).toBe(expectedCheckboxSize);
          expect(tokens['--checkbox-indicator-size']).toBe(expectedIndicatorSize);

          // Tier level width scales with Scale only
          const expectedTierWidth = `${Number((38 * scale).toFixed(2))}px`;
          expect(tokens['--pxd-mod-tier-level-width']).toBe(expectedTierWidth);

          // Typography scales with Scale only
          const expectedBodyFont = `${Number((13 * scale).toFixed(2))}px`;
          const expectedMicroFont = `${Number((10 * scale).toFixed(2))}px`;
          expect(tokens['--pxd-font-body']).toBe(expectedBodyFont);
          expect(tokens['--pxd-font-micro']).toBe(expectedMicroFont);

          // Layout spacing scales with both Scale and Density
          const expectedXsSpace = `${Number((4 * density * scale).toFixed(2))}px`;
          const expectedSmSpace = `${Number((6 * density * scale).toFixed(2))}px`;
          expect(tokens['--pxd-space-xs']).toBe(expectedXsSpace);
          expect(tokens['--pxd-space-sm']).toBe(expectedSmSpace);
        }
      }
    });
  });

  describe('5. Shadow Root Boundary Isolation', () => {
    it('verifies content script configures cssInjectionMode as ui to shield host document', () => {
      const contentSource = readFileSync('entrypoints/content/index.ts', 'utf8');
      expect(contentSource).toContain("cssInjectionMode: 'ui'");
      expect(contentSource).toContain("import '@/assets/main.css';");
    });
  });

  describe('6. Runtime DOM Mount & Focus Rings', () => {
    let host: HTMLElement;
    let app: ReturnType<typeof createApp>;

    afterEach(() => {
      if (app) app.unmount();
      if (host && host.parentNode) host.parentNode.removeChild(host);
    });

    it('renders Button, Input, and Checkbox with active focus-visible rings under Preflight', async () => {
      host = document.createElement('div');
      document.body.appendChild(host);

      const Wrapper = defineComponent({
        setup() {
          return () =>
            h('div', [
              h(Button, { size: 'sm' }, () => 'Test Button'),
              h(Input, { size: 'default' }),
              h(Checkbox, { 'aria-label': 'Test Checkbox' }),
            ]);
        },
      });

      app = createApp(Wrapper);
      app.mount(host);
      await nextTick();

      const btn = host.querySelector('[data-slot="button"]');
      const input = host.querySelector('input');
      const checkbox = host.querySelector('[data-slot="checkbox"]');

      expect(btn).toBeTruthy();
      expect(btn?.className).toContain('focus-visible:ring-1');
      expect(btn?.className).toContain('focus-visible:ring-ring');

      expect(input).toBeTruthy();
      expect(input?.className).toContain('focus-visible:ring-1');
      expect(input?.className).toContain('focus-visible:ring-ring');

      expect(checkbox).toBeTruthy();
      expect(checkbox?.className).toContain('focus-visible:ring-1');
      expect(checkbox?.className).toContain('focus-visible:ring-ring');
    });
  });
});
