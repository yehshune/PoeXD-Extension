import {
  CUSTOM_THEME_ID,
  THEME_ATTRIBUTE,
  THEME_COLOR_SCHEME_ATTRIBUTE,
  THEME_PRESETS,
  isLightColor,
  isPresetThemeId,
  normalizeThemeId,
  parseCustomThemeValues,
  pickContrastForeground,
  resolveColorSchemeForHex,
  type ThemeOverride,
} from './theme-contract';
import {
  registerThemeHost,
  runWithoutPageThemeBridgeSync,
  syncPageThemeBridge,
} from './page-theme-bridge';

/** 自訂主題寫入 host inline style 的語意變數清單 */
export const THEME_OVERRIDE_CSS_VARIABLES = [
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
  '--shadow-2xs',
  '--shadow-xs',
  '--shadow-sm',
  '--shadow',
] as const;

export type ThemeOverridesInput = string | ThemeOverride | null | undefined;

/** 偏好快照中與主題及自訂槽位相關的欄位 */
export interface ThemeRuntimePreferences {
  theme?: unknown;
  themeCustomOverrides?: unknown;
}

function clearThemeOverrideVariables(host: HTMLElement) {
  for (const name of THEME_OVERRIDE_CSS_VARIABLES) {
    host.style.removeProperty(name);
  }
  host.removeAttribute(THEME_COLOR_SCHEME_ATTRIBUTE);
}

function getPopoverExpression(isLight: boolean): string {
  return isLight
    ? 'color-mix(in oklch, var(--background), oklch(1 0 0) 65%)'
    : 'color-mix(in oklch, var(--card), var(--foreground) 5%)';
}

function applyThemeOverrideVariables(host: HTMLElement, override: ThemeOverride) {
  const { background, card, foreground, primary, destructive, radius } = override;
  const currentScheme = background
    ? resolveColorSchemeForHex(background)
    : host.getAttribute(THEME_COLOR_SCHEME_ATTRIBUTE) === 'light'
      ? 'light'
      : 'dark';
  const isLight = currentScheme === 'light';

  if (background) {
    host.setAttribute(THEME_COLOR_SCHEME_ATTRIBUTE, currentScheme);
    host.style.setProperty('--background', background);
    host.style.setProperty(
      '--muted',
      'color-mix(in oklch, var(--background), var(--foreground) 8%)',
    );
    host.style.setProperty(
      '--border',
      'color-mix(in oklch, var(--background), var(--foreground) 16%)',
    );
    host.style.setProperty(
      '--input',
      'color-mix(in oklch, var(--background), var(--foreground) 22%)',
    );
    host.style.setProperty(
      '--muted-foreground',
      'color-mix(in oklch, var(--foreground), var(--background) 32%)',
    );
    host.style.setProperty(
      '--accent',
      'color-mix(in oklch, var(--background), var(--primary) 18%)',
    );
    host.style.setProperty('--popover', getPopoverExpression(isLight));
  }

  if (card) {
    host.style.setProperty('--card', card);
    host.style.setProperty('--popover', getPopoverExpression(isLight));
    host.style.setProperty('--secondary', 'color-mix(in oklch, var(--card), var(--foreground) 6%)');
  }

  if (foreground) {
    host.style.setProperty('--foreground', foreground);
    host.style.setProperty('--card-foreground', 'var(--foreground)');
    host.style.setProperty('--popover-foreground', 'var(--foreground)');
    host.style.setProperty('--secondary-foreground', 'var(--foreground)');
    host.style.setProperty('--accent-foreground', 'var(--foreground)');
    host.style.setProperty(
      '--muted-foreground',
      'color-mix(in oklch, var(--foreground), var(--background) 32%)',
    );
  }

  if (primary) {
    host.style.setProperty('--primary', primary);
    host.style.setProperty('--primary-foreground', pickContrastForeground(primary));
    host.style.setProperty('--ring', 'var(--primary)');
    host.style.setProperty(
      '--accent',
      'color-mix(in oklch, var(--background), var(--primary) 18%)',
    );
  }

  if (destructive) {
    host.style.setProperty('--destructive', destructive);
    host.style.setProperty('--destructive-foreground', pickContrastForeground(destructive));
  }

  if (radius) {
    host.style.setProperty('--radius', radius);
    const flatShadows = ['--shadow-2xs', '--shadow-xs', '--shadow-sm', '--shadow'] as const;
    if (radius === '0rem') {
      for (const s of flatShadows) host.style.setProperty(s, 'none');
    } else {
      for (const s of flatShadows) host.style.removeProperty(s);
    }
  }
}

/**
 * 拖動調色盤時的輕量即時預覽：僅更新 ShadowHost 的 CSS 變數與 custom 屬性，
 * 不改寫宿主頁面的 <style> bridge，避免全頁 CSS 重算造成卡頓。
 */
export function previewThemeOverrideOnHost(
  host: HTMLElement | null | undefined,
  override: ThemeOverride,
): void {
  if (!host) return;
  runWithoutPageThemeBridgeSync(() => {
    if (host.getAttribute(THEME_ATTRIBUTE) !== CUSTOM_THEME_ID) {
      host.setAttribute(THEME_ATTRIBUTE, CUSTOM_THEME_ID);
    }
    applyThemeOverrideVariables(host, override);
  });
}

export function applyThemeToHost(
  host: HTMLElement | null | undefined,
  theme: unknown,
  customOverrides?: ThemeOverridesInput,
): void {
  if (!host) return;
  const normalized = normalizeThemeId(theme);
  runWithoutPageThemeBridgeSync(() => {
    clearThemeOverrideVariables(host);
    if (normalized === CUSTOM_THEME_ID) {
      applyThemeOverrideVariables(host, parseCustomThemeValues(customOverrides));
    } else if (isPresetThemeId(normalized) && isLightColor(THEME_PRESETS[normalized].background)) {
      host.setAttribute(THEME_COLOR_SCHEME_ATTRIBUTE, 'light');
    }
    if (host.getAttribute(THEME_ATTRIBUTE) !== normalized) {
      host.setAttribute(THEME_ATTRIBUTE, normalized);
    }
  });
  registerThemeHost(host);
  syncPageThemeBridge(host);
}

/** 直接從偏好快照讀取 theme 與自訂槽位並套用到 host */
export function applyThemeFromPreferences(
  host: HTMLElement | null | undefined,
  prefs: ThemeRuntimePreferences | null | undefined,
): void {
  applyThemeToHost(host, prefs?.theme, prefs?.themeCustomOverrides as ThemeOverridesInput);
}
