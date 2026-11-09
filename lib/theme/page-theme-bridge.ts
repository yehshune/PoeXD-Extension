import { THEME_ATTRIBUTE } from './theme-contract';

export const PAGE_THEME_BRIDGE_STYLE_ID = 'poexd-page-theme-bridge';

export const SHADCN_SEMANTIC_VARIABLES = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--shadow-2xs',
  '--shadow-xs',
  '--shadow-sm',
  '--shadow',
  '--shadow-md',
  '--shadow-lg',
  '--shadow-xl',
  '--shadow-2xl',
] as const;

export const PAGE_INJECTED_SELECTORS = [
  '.poexd-tier-trigger',
  '.poexd-inline-btn',
  '.poexd-filter-select-btn',
  '.poexd-category-select-btn',
  '.poexd-sortable-ghost',
  '.poexd-sortable-drag',
  '.poexd-filter-mod-highlight',
  '.poexd-price-comparison',
] as const;

let activeThemeHost: HTMLElement | null = null;
let hostMutationObserver: MutationObserver | null = null;

export function getActiveThemeHost(): HTMLElement | null {
  return activeThemeHost;
}

export function findThemeHost(): HTMLElement | null {
  if (activeThemeHost && activeThemeHost.isConnected) {
    return activeThemeHost;
  }
  if (typeof document !== 'undefined') {
    return document.querySelector(`[${THEME_ATTRIBUTE}]`) as HTMLElement | null;
  }
  return null;
}

export function readThemeSemanticValues(host: HTMLElement): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof window === 'undefined' || !host) return result;

  const computed = window.getComputedStyle(host);
  for (const varName of SHADCN_SEMANTIC_VARIABLES) {
    const value = computed.getPropertyValue(varName).trim();
    if (value) {
      result[varName] = value;
    }
  }

  // 若 --radius 存在但無顯式衍生半徑，補齊 shadcn 語意衍生半徑
  if (result['--radius']) {
    if (!result['--radius-sm']) result['--radius-sm'] = 'calc(var(--radius) * 0.6)';
    if (!result['--radius-md']) result['--radius-md'] = 'calc(var(--radius) * 0.8)';
    if (!result['--radius-lg']) result['--radius-lg'] = 'var(--radius)';
    if (!result['--radius-xl']) result['--radius-xl'] = 'calc(var(--radius) * 1.4)';
  }

  return result;
}

export function generatePageThemeBridgeCss(values: Record<string, string>): string {
  const declarations = Object.entries(values)
    .map(([key, val]) => `  ${key}: ${val};`)
    .join('\n');

  if (!declarations) return '';

  const selector = PAGE_INJECTED_SELECTORS.join(',\n');
  return `${selector} {\n${declarations}\n}\n`;
}

export function syncPageThemeBridge(host?: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;

  const targetHost = host || findThemeHost();
  if (!targetHost) return false;

  // 自動記憶當前活躍 host
  if (targetHost !== activeThemeHost) {
    registerThemeHost(targetHost);
  }

  const values = readThemeSemanticValues(targetHost);
  const css = generatePageThemeBridgeCss(values);

  let styleEl = document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PAGE_THEME_BRIDGE_STYLE_ID;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  styleEl.textContent = css;
  return true;
}

export function registerThemeHost(host: HTMLElement | null | undefined): void {
  if (!host || host === activeThemeHost) return;

  activeThemeHost = host;

  if (hostMutationObserver) {
    hostMutationObserver.disconnect();
    hostMutationObserver = null;
  }

  if (typeof MutationObserver !== 'undefined') {
    hostMutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === THEME_ATTRIBUTE) {
          syncPageThemeBridge(activeThemeHost);
        }
      }
    });

    hostMutationObserver.observe(host, {
      attributes: true,
      attributeFilter: [THEME_ATTRIBUTE],
    });
  }

  syncPageThemeBridge(host);
}

export function cleanupPageThemeBridge(): void {
  if (hostMutationObserver) {
    hostMutationObserver.disconnect();
    hostMutationObserver = null;
  }
  activeThemeHost = null;

  if (typeof document !== 'undefined') {
    document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)?.remove();
  }
}
