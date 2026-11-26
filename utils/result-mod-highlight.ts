import type { ResultModHighlightColor, ResultModHighlightStyle } from './preferences-contract';

export const RESULT_MOD_HIGHLIGHT_STYLE_ATTR = 'data-poexd-mod-highlight-style';
export const RESULT_MOD_HIGHLIGHT_COLOR_ATTR = 'data-poexd-mod-highlight-color';

export interface ResultModHighlightPalette {
  readonly bg: string;
  readonly bgSubtle: string;
  readonly border: string;
  readonly borderSubtle: string;
  readonly glow: string;
  readonly shadow: string;
  readonly bar: string;
  readonly swatch: string;
}

/**
 * 結果詞綴高亮的 5 組深色背景驗證色票（全部使用 oklch，符合主題契約）。
 * `indigo` 保留最初版本的預設外觀。
 */
export const RESULT_MOD_HIGHLIGHT_PALETTES: Readonly<
  Record<ResultModHighlightColor, ResultModHighlightPalette>
> = Object.freeze({
  indigo: Object.freeze({
    bg: 'oklch(0.25 0.05 260 / 0.53)',
    bgSubtle: 'oklch(0.25 0.05 260 / 0.34)',
    border: 'oklch(0.85 0.08 265 / 0.65)',
    borderSubtle: 'oklch(0.75 0.08 265 / 0.45)',
    glow: 'oklch(0.70 0.12 265 / 0.25)',
    shadow: 'oklch(0.10 0.02 265 / 0.6)',
    bar: 'oklch(0.76 0.13 265)',
    swatch: 'oklch(0.68 0.14 265)',
  }),
  gold: Object.freeze({
    bg: 'oklch(0.28 0.055 82 / 0.50)',
    bgSubtle: 'oklch(0.28 0.055 82 / 0.30)',
    border: 'oklch(0.84 0.11 84 / 0.72)',
    borderSubtle: 'oklch(0.76 0.10 84 / 0.48)',
    glow: 'oklch(0.78 0.13 84 / 0.26)',
    shadow: 'oklch(0.12 0.03 82 / 0.6)',
    bar: 'oklch(0.82 0.12 84)',
    swatch: 'oklch(0.78 0.13 84)',
  }),
  emerald: Object.freeze({
    bg: 'oklch(0.26 0.065 158 / 0.50)',
    bgSubtle: 'oklch(0.26 0.065 158 / 0.30)',
    border: 'oklch(0.80 0.12 158 / 0.68)',
    borderSubtle: 'oklch(0.72 0.11 158 / 0.46)',
    glow: 'oklch(0.72 0.14 158 / 0.25)',
    shadow: 'oklch(0.10 0.03 158 / 0.6)',
    bar: 'oklch(0.76 0.14 158)',
    swatch: 'oklch(0.70 0.14 158)',
  }),
  amber: Object.freeze({
    bg: 'oklch(0.27 0.075 48 / 0.52)',
    bgSubtle: 'oklch(0.27 0.075 48 / 0.32)',
    border: 'oklch(0.80 0.13 52 / 0.72)',
    borderSubtle: 'oklch(0.72 0.12 52 / 0.48)',
    glow: 'oklch(0.72 0.15 50 / 0.26)',
    shadow: 'oklch(0.11 0.03 48 / 0.6)',
    bar: 'oklch(0.76 0.15 52)',
    swatch: 'oklch(0.72 0.15 52)',
  }),
  violet: Object.freeze({
    bg: 'oklch(0.26 0.07 320 / 0.52)',
    bgSubtle: 'oklch(0.26 0.07 320 / 0.32)',
    border: 'oklch(0.80 0.12 322 / 0.68)',
    borderSubtle: 'oklch(0.72 0.11 322 / 0.46)',
    glow: 'oklch(0.70 0.15 322 / 0.25)',
    shadow: 'oklch(0.10 0.03 320 / 0.6)',
    bar: 'oklch(0.74 0.15 322)',
    swatch: 'oklch(0.68 0.15 322)',
  }),
});

interface StyleLayoutSpec {
  readonly boxShadow: (p: ResultModHighlightPalette) => string;
  readonly backgroundColor: (p: ResultModHighlightPalette) => string;
  readonly border: (p: ResultModHighlightPalette) => string;
  readonly padding: string;
  readonly margin: string;
}

const CSS_VAR_PALETTE: ResultModHighlightPalette = {
  bg: 'var(--poexd-mod-hl-bg)',
  bgSubtle: 'var(--poexd-mod-hl-bg-subtle)',
  border: 'var(--poexd-mod-hl-border)',
  borderSubtle: 'var(--poexd-mod-hl-border-subtle)',
  glow: 'var(--poexd-mod-hl-glow)',
  shadow: 'var(--poexd-mod-hl-shadow)',
  bar: 'var(--poexd-mod-hl-bar)',
  swatch: 'var(--poexd-mod-hl-bar)',
};

const HIGHLIGHT_STYLE_SPECS: Readonly<Record<ResultModHighlightStyle, StyleLayoutSpec>> =
  Object.freeze({
    glow: {
      boxShadow: (p) => `0 0 20px ${p.glow}, 0 10px 30px ${p.shadow}`,
      backgroundColor: (p) => p.bg,
      border: (p) => `1px solid ${p.border}`,
      padding: '5px',
      margin: '5px 0',
    },
    subtle: {
      boxShadow: () => 'none',
      backgroundColor: (p) => p.bgSubtle,
      border: (p) => `1px solid ${p.borderSubtle}`,
      padding: '2px 5px',
      margin: '2px 0',
    },
    bar: {
      boxShadow: (p) => `inset 3px 0 0 ${p.bar}`,
      backgroundColor: (p) => p.bgSubtle,
      border: () => 'none',
      padding: '1px 4px 1px 8px',
      margin: '1px 0',
    },
  });

function formatStyleDeclarations(
  spec: StyleLayoutSpec,
  palette: ResultModHighlightPalette,
): string {
  return `
        box-shadow: ${spec.boxShadow(palette)};
        background-color: ${spec.backgroundColor(palette)};
        border: ${spec.border(palette)};
        padding: ${spec.padding};
        margin: ${spec.margin};`;
}

/** 產生注入至官方交易頁的結果詞綴高亮樣式表（透過 data 屬性切換預設組合，包含預設值以確保巢狀預覽框可獨立覆寫） */
export function buildResultModHighlightCss(): string {
  const defaultPalette = RESULT_MOD_HIGHLIGHT_PALETTES.indigo;
  const colorRules = (
    Object.entries(RESULT_MOD_HIGHLIGHT_PALETTES) as [
      ResultModHighlightColor,
      ResultModHighlightPalette,
    ][]
  )
    .map(
      ([color, p]) => `
      [${RESULT_MOD_HIGHLIGHT_COLOR_ATTR}="${color}"] .poexd-filter-mod-highlight {
        --poexd-mod-hl-bg: ${p.bg};
        --poexd-mod-hl-bg-subtle: ${p.bgSubtle};
        --poexd-mod-hl-border: ${p.border};
        --poexd-mod-hl-border-subtle: ${p.borderSubtle};
        --poexd-mod-hl-glow: ${p.glow};
        --poexd-mod-hl-shadow: ${p.shadow};
        --poexd-mod-hl-bar: ${p.bar};
      }`,
    )
    .join('\n');

  const styleRules = (
    Object.entries(HIGHLIGHT_STYLE_SPECS) as [ResultModHighlightStyle, StyleLayoutSpec][]
  )
    .map(
      ([style, spec]) => `
      [${RESULT_MOD_HIGHLIGHT_STYLE_ATTR}="${style}"] .poexd-filter-mod-highlight {${formatStyleDeclarations(spec, CSS_VAR_PALETTE)}
      }`,
    )
    .join('\n');

  return `
      .poexd-filter-mod-highlight {
        --poexd-mod-hl-bg: ${defaultPalette.bg};
        --poexd-mod-hl-bg-subtle: ${defaultPalette.bgSubtle};
        --poexd-mod-hl-border: ${defaultPalette.border};
        --poexd-mod-hl-border-subtle: ${defaultPalette.borderSubtle};
        --poexd-mod-hl-glow: ${defaultPalette.glow};
        --poexd-mod-hl-shadow: ${defaultPalette.shadow};
        --poexd-mod-hl-bar: ${defaultPalette.bar};${formatStyleDeclarations(HIGHLIGHT_STYLE_SPECS.glow, CSS_VAR_PALETTE)}
      }
${colorRules}
${styleRules}
    `;
}

/** 供設定頁即時預覽條使用（Shadow DOM 內不吃頁面 `<style>`），與官方頁樣式共用同一份規格定義 */
export function getResultModHighlightPreviewStyle(
  style: ResultModHighlightStyle,
  color: ResultModHighlightColor,
): Record<string, string> {
  const palette = RESULT_MOD_HIGHLIGHT_PALETTES[color];
  const spec = HIGHLIGHT_STYLE_SPECS[style];
  return {
    boxShadow: spec.boxShadow(palette),
    backgroundColor: spec.backgroundColor(palette),
    border: spec.border(palette),
    padding: spec.padding,
  };
}
