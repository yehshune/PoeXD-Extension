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

/** 產生注入至官方交易頁的結果詞綴高亮樣式表（透過 `:root` 的 data 屬性切換預設組合） */
export function buildResultModHighlightCss(): string {
  const defaultPalette = RESULT_MOD_HIGHLIGHT_PALETTES.indigo;
  const colorRules = (
    Object.entries(RESULT_MOD_HIGHLIGHT_PALETTES) as [
      ResultModHighlightColor,
      ResultModHighlightPalette,
    ][]
  )
    .filter(([color]) => color !== 'indigo')
    .map(
      ([color, p]) => `
      :root[${RESULT_MOD_HIGHLIGHT_COLOR_ATTR}="${color}"] .poexd-filter-mod-highlight {
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

  return `
      .poexd-filter-mod-highlight {
        --poexd-mod-hl-bg: ${defaultPalette.bg};
        --poexd-mod-hl-bg-subtle: ${defaultPalette.bgSubtle};
        --poexd-mod-hl-border: ${defaultPalette.border};
        --poexd-mod-hl-border-subtle: ${defaultPalette.borderSubtle};
        --poexd-mod-hl-glow: ${defaultPalette.glow};
        --poexd-mod-hl-shadow: ${defaultPalette.shadow};
        --poexd-mod-hl-bar: ${defaultPalette.bar};
        box-shadow: 0 0 20px var(--poexd-mod-hl-glow), 0 10px 30px var(--poexd-mod-hl-shadow);
        background-color: var(--poexd-mod-hl-bg);
        border: 1px solid var(--poexd-mod-hl-border);
        padding: 5px;
        margin: 5px 0;
      }
${colorRules}
      :root[${RESULT_MOD_HIGHLIGHT_STYLE_ATTR}="subtle"] .poexd-filter-mod-highlight {
        box-shadow: none;
        background-color: var(--poexd-mod-hl-bg-subtle);
        border: 1px solid var(--poexd-mod-hl-border-subtle);
        padding: 2px 5px;
        margin: 2px 0;
      }

      :root[${RESULT_MOD_HIGHLIGHT_STYLE_ATTR}="bar"] .poexd-filter-mod-highlight {
        box-shadow: inset 3px 0 0 var(--poexd-mod-hl-bar);
        background-color: var(--poexd-mod-hl-bg-subtle);
        border: none;
        padding: 1px 4px 1px 8px;
        margin: 1px 0;
      }
    `;
}

/** 供設定頁即時預覽條使用（Shadow DOM 內不吃頁面 `<style>`），與官方頁樣式保持同一來源 */
export function getResultModHighlightPreviewStyle(
  style: ResultModHighlightStyle,
  color: ResultModHighlightColor,
): Record<string, string> {
  const p = RESULT_MOD_HIGHLIGHT_PALETTES[color];
  if (style === 'subtle') {
    return {
      boxShadow: 'none',
      backgroundColor: p.bgSubtle,
      border: `1px solid ${p.borderSubtle}`,
      padding: '2px 6px',
    };
  }
  if (style === 'bar') {
    return {
      boxShadow: `inset 3px 0 0 ${p.bar}`,
      backgroundColor: p.bgSubtle,
      border: '1px solid transparent',
      padding: '2px 6px 2px 9px',
    };
  }
  return {
    boxShadow: `0 0 16px ${p.glow}, 0 6px 18px ${p.shadow}`,
    backgroundColor: p.bg,
    border: `1px solid ${p.border}`,
    padding: '4px 6px',
  };
}
