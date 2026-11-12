import { describe, expect, it } from 'vitest';
import { createUiRuntimeTokenValues, LAYOUT_TOKENS } from '@/lib/tokens';

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
});
