// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { THEME_ATTRIBUTE } from '@/lib/theme/theme-contract';
import {
  PAGE_THEME_BRIDGE_STYLE_ID,
  PAGE_INJECTED_SELECTORS,
  SHADCN_SEMANTIC_VARIABLES,
  getActiveThemeHost,
  findThemeHost,
  readThemeSemanticValues,
  generatePageThemeBridgeCss,
  syncPageThemeBridge,
  registerThemeHost,
  cleanupPageThemeBridge,
} from '@/lib/theme/page-theme-bridge';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';

describe('Page UI Theme Bridge Contract Tests', () => {
  beforeEach(() => {
    cleanupPageThemeBridge();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.body.removeAttribute(THEME_ATTRIBUTE);
  });

  afterEach(() => {
    cleanupPageThemeBridge();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  // ---------------------------------------------------------------------------
  // 1. Single Source of Truth & Zero Second Palette
  // ---------------------------------------------------------------------------
  describe('1. Single Source of Truth & Zero Second Palette', () => {
    it('contains NO hardcoded color codes or theme-to-palette mapping dictionaries', () => {
      const source = readFileSync(
        path.resolve(__dirname, '../lib/theme/page-theme-bridge.ts'),
        'utf-8',
      );

      // 檢查無十六進位色彩
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      // 檢查無 oklch 硬編碼數值字典 (oklch(0....))
      expect(source).not.toMatch(/oklch\(/i);
      // 檢查無 rgb/rgba 硬編碼
      expect(source).not.toMatch(/rgba?\(/i);
      // 檢查無 theme ID 映射字典物件 (例如 { 'caffeine': { ... } })
      expect(source).not.toMatch(/caffeine\s*:\s*\{/);
    });

    it('extracts semantic CSS variables directly from host computed style', () => {
      const host = document.createElement('div');
      host.setAttribute(THEME_ATTRIBUTE, 'caffeine');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host {
          --background: oklch(0.1776 0 0);
          --foreground: oklch(0.9491 0 0);
          --popover: oklch(0.2134 0 0);
          --popover-foreground: oklch(0.9491 0 0);
          --secondary: oklch(0.3163 0.019 63.6992);
          --secondary-foreground: oklch(0.88 0.0524 66.1732);
          --border: oklch(0.2351 0.0115 91.7467);
          --radius: 0.5rem;
          --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10);
        }
      `;
      shadow.appendChild(style);
      document.body.appendChild(host);

      const values = readThemeSemanticValues(host);
      expect(values['--background']).toBe('oklch(0.1776 0 0)');
      expect(values['--foreground']).toBe('oklch(0.9491 0 0)');
      expect(values['--popover']).toBe('oklch(0.2134 0 0)');
      expect(values['--secondary']).toBe('oklch(0.3163 0.019 63.6992)');
      expect(values['--border']).toBe('oklch(0.2351 0.0115 91.7467)');
      expect(values['--radius']).toBe('0.5rem');

      // 檢查 radius 衍生值自動補齊
      expect(values['--radius-sm']).toBe('calc(var(--radius) * 0.6)');
      expect(values['--radius-md']).toBe('calc(var(--radius) * 0.8)');
      expect(values['--radius-lg']).toBe('var(--radius)');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Strict DOM Non-Pollution Contract
  // ---------------------------------------------------------------------------
  describe('2. Strict DOM Non-Pollution Contract', () => {
    it('NEVER writes theme variables or attributes to documentElement or body', () => {
      const host = document.createElement('div');
      host.setAttribute(THEME_ATTRIBUTE, 'caffeine');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host { --background: #111; --border: #222; }';
      shadow.appendChild(style);
      document.body.appendChild(host);

      applyThemeToHost(host, 'caffeine');

      // 檢查 documentElement 未被污染
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();
      expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--border')).toBe('');

      // 檢查 body 未被污染
      expect(document.body.getAttribute(THEME_ATTRIBUTE)).toBeNull();
      expect(document.body.style.getPropertyValue('--background')).toBe('');
      expect(document.body.style.getPropertyValue('--border')).toBe('');
    });

    it('scopes bridge CSS rules exclusively to PoeXD injected selectors', () => {
      const css = generatePageThemeBridgeCss({
        '--background': 'oklch(0.1776 0 0)',
        '--border': 'oklch(0.2351 0.0115 91.7467)',
      });

      // 必須包含指定的 injected controls 選擇器
      for (const sel of PAGE_INJECTED_SELECTORS) {
        expect(css).toContain(sel);
      }

      // 明確涵蓋 host-page injected UI（Toast 與 Tier Dropdown 已搬入 ShadowRoot，.poexd-theme-bridge 為 dead selector，皆不再屬於 Light DOM bridge）
      expect(PAGE_INJECTED_SELECTORS).not.toContain('.poexd-theme-bridge');
      expect(PAGE_INJECTED_SELECTORS).not.toContain('[data-poexd-toast]');
      expect(PAGE_INJECTED_SELECTORS).not.toContain('.poexd-tier-dropdown');
      expect(PAGE_INJECTED_SELECTORS).not.toContain('#poexd-sync-overlay');
      expect(PAGE_INJECTED_SELECTORS).toContain('.poexd-tier-trigger');
      expect(PAGE_INJECTED_SELECTORS).toContain('.poexd-sortable-ghost');
      expect(PAGE_INJECTED_SELECTORS).toContain('.poexd-sortable-drag');
      expect(PAGE_INJECTED_SELECTORS).toContain('.poexd-filter-mod-highlight');
      expect(PAGE_INJECTED_SELECTORS).toContain('.poexd-price-comparison');

      // 絕不可包含 :root, html, body, 或 PoE 官方容器
      expect(css).not.toMatch(/(^|\s|,):root(\s|,|\{)/);
      expect(css).not.toMatch(/(^|\s|,)html(\s|,|\{)/);
      expect(css).not.toMatch(/(^|\s|,)body(\s|,|\{)/);
      expect(css).not.toMatch(/search-advanced-pane/);
      expect(css).not.toMatch(/filter-group/);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Dynamic Synchronization & Observer Contract
  // ---------------------------------------------------------------------------
  describe('3. Dynamic Synchronization & Observer Contract', () => {
    it('automatically updates the bridge style tag when data-poexd-theme changes without page reload', async () => {
      const host = document.createElement('div');
      host.setAttribute(THEME_ATTRIBUTE, 'caffeine');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host { --background: #111; --border: #222; }';
      shadow.appendChild(style);
      document.body.appendChild(host);

      registerThemeHost(host);

      const styleEl = document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID) as HTMLStyleElement;
      expect(styleEl).toBeTruthy();
      expect(styleEl.textContent).toContain('--background: #111;');

      // 模擬主題變更：修改 host 樣式與屬性（由 caffeine 轉為 catppuccin）
      style.textContent = ':host { --background: #333; --border: #444; }';
      host.setAttribute(THEME_ATTRIBUTE, 'catppuccin');

      // 等待 MutationObserver microtask
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(styleEl.textContent).toContain('--background: #333;');
      expect(styleEl.textContent).toContain('--border: #444;');
    });

    it('cleans up observer and style element cleanly on cleanupPageThemeBridge', () => {
      const host = document.createElement('div');
      host.setAttribute(THEME_ATTRIBUTE, 'caffeine');
      document.body.appendChild(host);

      registerThemeHost(host);
      expect(document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)).toBeTruthy();
      expect(getActiveThemeHost()).toBe(host);

      cleanupPageThemeBridge();
      expect(document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID)).toBeNull();
      expect(getActiveThemeHost()).toBeNull();

      host.remove();
      expect(findThemeHost()).toBeNull();
    });

    it('safely handles null host or missing DOM without throwing', () => {
      expect(() => syncPageThemeBridge(null)).not.toThrow();
      expect(() => registerThemeHost(null)).not.toThrow();
      expect(() => registerThemeHost(undefined)).not.toThrow();
      expect(() => cleanupPageThemeBridge()).not.toThrow();
    });
  });
});
