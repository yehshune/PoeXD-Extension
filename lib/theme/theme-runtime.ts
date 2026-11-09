import {
  DEFAULT_THEME_ID,
  THEME_ATTRIBUTE,
  normalizeThemeId,
  type ThemeId,
} from './theme-contract';
import { registerThemeHost } from './page-theme-bridge';

export function applyThemeToHost(host: HTMLElement | null | undefined, theme: unknown): void {
  if (!host) return;
  const normalized = normalizeThemeId(theme);
  host.setAttribute(THEME_ATTRIBUTE, normalized);
  registerThemeHost(host);
}
