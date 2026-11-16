// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createUiRuntimeTokenValues, LAYOUT_TOKENS } from '@/lib/tokens';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

describe('LiveSearch Floating UI Scale / Density Foundation Convergence', () => {
  describe('Overlay Semantic Geometry Tokens (Runtime Values)', () => {
    it('outputs precise scale-aware px values across UI Scale presets (0.85, 1.0, 1.2)', () => {
      const scale085 = createUiRuntimeTokenValues({
        scale: 0.85,
        density: 1.0,
      });
      const scale100 = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
      const scale120 = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });

      // Resume Inspect Popover geometry
      expect(scale085[LAYOUT_TOKENS.overlayInspectWidthVar]).toBe('255px');
      expect(scale100[LAYOUT_TOKENS.overlayInspectWidthVar]).toBe('300px');
      expect(scale120[LAYOUT_TOKENS.overlayInspectWidthVar]).toBe('360px');

      expect(scale085[LAYOUT_TOKENS.overlayInspectMaxHeightVar]).toBe('187px');
      expect(scale100[LAYOUT_TOKENS.overlayInspectMaxHeightVar]).toBe('220px');
      expect(scale120[LAYOUT_TOKENS.overlayInspectMaxHeightVar]).toBe('264px');

      // Trade Search Preview overlay width
      expect(scale085[LAYOUT_TOKENS.searchPreviewWidthVar]).toBe('323px');
      expect(scale100[LAYOUT_TOKENS.searchPreviewWidthVar]).toBe('380px');
      expect(scale120[LAYOUT_TOKENS.searchPreviewWidthVar]).toBe('456px');

      // Tooltip max width
      expect(scale085[LAYOUT_TOKENS.tooltipMaxWidthVar]).toBe('238px');
      expect(scale100[LAYOUT_TOKENS.tooltipMaxWidthVar]).toBe('280px');
      expect(scale120[LAYOUT_TOKENS.tooltipMaxWidthVar]).toBe('336px');

      // Temporary Search Dialog geometry
      expect(scale085[LAYOUT_TOKENS.temporarySearchDialogWidthVar]).toBe('357px');
      expect(scale100[LAYOUT_TOKENS.temporarySearchDialogWidthVar]).toBe('420px');
      expect(scale120[LAYOUT_TOKENS.temporarySearchDialogWidthVar]).toBe('504px');

      expect(scale085[LAYOUT_TOKENS.temporarySearchDialogMaxHeightVar]).toBe('442px');
      expect(scale100[LAYOUT_TOKENS.temporarySearchDialogMaxHeightVar]).toBe('520px');
      expect(scale120[LAYOUT_TOKENS.temporarySearchDialogMaxHeightVar]).toBe('624px');

      // Mercenary picker build combobox width
      expect(scale085[LAYOUT_TOKENS.mercenaryBuildWidthVar]).toBe('255px');
      expect(scale100[LAYOUT_TOKENS.mercenaryBuildWidthVar]).toBe('300px');
      expect(scale120[LAYOUT_TOKENS.mercenaryBuildWidthVar]).toBe('360px');
    });

    it('enforces Density-invariant contract for overlay geometries across densities (0.8, 1.0, 1.2)', () => {
      const compactTokens = createUiRuntimeTokenValues({
        scale: 1.0,
        density: 0.8,
      });
      const defaultTokens = createUiRuntimeTokenValues({
        scale: 1.0,
        density: 1.0,
      });
      const comfortableTokens = createUiRuntimeTokenValues({
        scale: 1.0,
        density: 1.2,
      });

      const overlayVars = [
        LAYOUT_TOKENS.overlayInspectWidthVar,
        LAYOUT_TOKENS.overlayInspectMaxHeightVar,
        LAYOUT_TOKENS.searchPreviewWidthVar,
        LAYOUT_TOKENS.tooltipMaxWidthVar,
        LAYOUT_TOKENS.temporarySearchDialogWidthVar,
        LAYOUT_TOKENS.temporarySearchDialogMaxHeightVar,
        LAYOUT_TOKENS.mercenaryBuildWidthVar,
      ];

      for (const tokenVar of overlayVars) {
        expect(compactTokens[tokenVar]).toBe(defaultTokens[tokenVar]);
        expect(comfortableTokens[tokenVar]).toBe(defaultTokens[tokenVar]);
      }
    });
  });

  describe('TooltipContent Readable Width & Wrapping Contract', () => {
    it('applies bounded max-width and wrapping classes by default and lets preview tooltip override max-w', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const app = createApp(
        defineComponent({
          setup() {
            return () =>
              h(TooltipProvider, null, {
                default: () => [
                  h(
                    Tooltip,
                    { open: true },
                    {
                      default: () => [
                        h(TooltipTrigger, { asChild: true }, { default: () => h('span', 'info') }),
                        h(TooltipContent, null, {
                          default: () =>
                            '把國際服英文市集的介面、篩選器與搜尋結果顯示成中文，依「語言」設定採用台服（繁體）或國服（簡體）的官方用語。',
                        }),
                      ],
                    },
                  ),
                ],
              });
          },
        }),
      );

      app.mount(container);
      await nextTick();
      await nextTick();

      try {
        const tooltipEl = document.body.querySelector('[data-slot="tooltip-content"]');
        expect(tooltipEl).not.toBeNull();
        const cls = tooltipEl?.getAttribute('class') ?? '';
        expect(cls).toContain(
          'max-w-[min(var(--pxd-tooltip-max-width,280px),var(--reka-tooltip-content-available-width,calc(100vw-32px)))]',
        );
        expect(cls).toContain('whitespace-normal');
        expect(cls).toContain('break-words');
        expect(cls).toContain('leading-normal');

        const previewTooltipSource = readFileSync(
          'components/sidebar/search-preview/TradeSearchPreviewTooltip.vue',
          'utf8',
        );
        expect(previewTooltipSource).toContain(
          'max-w-[var(--reka-tooltip-content-available-width,calc(100vw-32px))]',
        );
      } finally {
        app.unmount();
        container.remove();
      }
    });

    it('overrides default tooltip max-width cleanly when consumer passes custom max-w class', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const app = createApp(
        defineComponent({
          setup() {
            return () =>
              h(TooltipProvider, null, {
                default: () =>
                  h(
                    Tooltip,
                    { open: true },
                    {
                      default: () => [
                        h(
                          TooltipTrigger,
                          { asChild: true },
                          { default: () => h('span', 'trigger') },
                        ),
                        h(
                          TooltipContent,
                          {
                            class:
                              'w-[var(--pxd-search-preview-width)] max-w-[var(--reka-tooltip-content-available-width,calc(100vw-32px))]',
                          },
                          { default: () => 'preview' },
                        ),
                      ],
                    },
                  ),
              });
          },
        }),
      );

      app.mount(container);
      await nextTick();
      await nextTick();

      try {
        const tooltipEl = document.body.querySelector('[data-slot="tooltip-content"]');
        expect(tooltipEl).not.toBeNull();
        const cls = tooltipEl?.getAttribute('class') ?? '';
        expect(cls).toContain(
          'max-w-[var(--reka-tooltip-content-available-width,calc(100vw-32px))]',
        );
        expect(cls).not.toContain('max-w-[min(var(--pxd-tooltip-max-width,280px)');
      } finally {
        app.unmount();
        container.remove();
      }
    });
  });
});
