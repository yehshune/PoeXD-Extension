// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { ResultModHighlighterAdapter } from '@/entrypoints/content/logic/result-mod-highlighter';
import {
  RESULT_MOD_HIGHLIGHT_COLORS,
  RESULT_MOD_HIGHLIGHT_STYLES,
} from '@/utils/preferences-contract';
import {
  RESULT_MOD_HIGHLIGHT_COLOR_ATTR,
  RESULT_MOD_HIGHLIGHT_PALETTES,
  RESULT_MOD_HIGHLIGHT_STYLE_ATTR,
  buildResultModHighlightCss,
  getResultModHighlightPreviewStyle,
} from '@/utils/result-mod-highlight';

describe('result-mod-highlight customization', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(RESULT_MOD_HIGHLIGHT_STYLE_ATTR);
    document.documentElement.removeAttribute(RESULT_MOD_HIGHLIGHT_COLOR_ATTR);
  });

  it('builds oklch-only CSS rules covering every highlight style and color preset including defaults', () => {
    const css = buildResultModHighlightCss();
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain('.poexd-filter-mod-highlight');
    for (const style of RESULT_MOD_HIGHLIGHT_STYLES) {
      expect(css).toContain(`[${RESULT_MOD_HIGHLIGHT_STYLE_ATTR}="${style}"]`);
    }
    for (const color of RESULT_MOD_HIGHLIGHT_COLORS) {
      expect(css).toContain(`[${RESULT_MOD_HIGHLIGHT_COLOR_ATTR}="${color}"]`);
    }
  });

  it('produces matching preview inline styles for all style and color combinations', () => {
    for (const style of RESULT_MOD_HIGHLIGHT_STYLES) {
      for (const color of RESULT_MOD_HIGHLIGHT_COLORS) {
        const preview = getResultModHighlightPreviewStyle(style, color);
        const palette = RESULT_MOD_HIGHLIGHT_PALETTES[color];
        if (style === 'glow') {
          expect(preview.backgroundColor).toBe(palette.bg);
          expect(preview.boxShadow).toContain(palette.glow);
        } else if (style === 'subtle') {
          expect(preview.backgroundColor).toBe(palette.bgSubtle);
          expect(preview.boxShadow).toBe('none');
        } else {
          expect(preview.backgroundColor).toBe(palette.bgSubtle);
          expect(preview.boxShadow).toContain(palette.bar);
        }
      }
    }
  });

  it('syncs and cleans up root appearance attributes via ResultModHighlighterAdapter', () => {
    const adapter = new ResultModHighlighterAdapter(document);
    adapter.setAppearance('bar', 'emerald');
    expect(document.documentElement.getAttribute(RESULT_MOD_HIGHLIGHT_STYLE_ATTR)).toBe('bar');
    expect(document.documentElement.getAttribute(RESULT_MOD_HIGHLIGHT_COLOR_ATTR)).toBe('emerald');

    adapter.setAppearance('subtle', 'gold');
    expect(document.documentElement.getAttribute(RESULT_MOD_HIGHLIGHT_STYLE_ATTR)).toBe('subtle');
    expect(document.documentElement.getAttribute(RESULT_MOD_HIGHLIGHT_COLOR_ATTR)).toBe('gold');

    adapter.cleanup();
    expect(document.documentElement.hasAttribute(RESULT_MOD_HIGHLIGHT_STYLE_ATTR)).toBe(false);
    expect(document.documentElement.hasAttribute(RESULT_MOD_HIGHLIGHT_COLOR_ATTR)).toBe(false);
  });
});
