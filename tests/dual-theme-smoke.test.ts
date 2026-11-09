// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import {
  createInMemoryPreferencesStorage,
  createPreferencesModule,
  type PreferencesModule,
} from '@/utils/preferences';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';
import { THEME_ATTRIBUTE, DEFAULT_THEME_ID } from '@/lib/theme/theme-contract';
import {
  registerThemeHost,
  cleanupPageThemeBridge,
  PAGE_THEME_BRIDGE_STYLE_ID,
} from '@/lib/theme/page-theme-bridge';

describe('Formal Multi-Theme Switching Smoke Test (Modern-Dark <-> Caffeine <-> Catppuccin)', () => {
  let shadowHost: HTMLElement;
  let shadowRoot: ShadowRoot;
  let styleEl: HTMLStyleElement;
  let storage: ReturnType<typeof createInMemoryPreferencesStorage>;
  let prefModule: PreferencesModule;

  beforeEach(async () => {
    storage = createInMemoryPreferencesStorage();
    const outcome = await createPreferencesModule('poe1', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);
    prefModule = outcome.value;

    shadowHost = document.createElement('div');
    shadowHost.id = 'poexd-host';
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    styleEl = document.createElement('style');
    // Simulate main.css variables under :host
    styleEl.textContent = `
      :root,
      :host {
        --background: oklch(0.2046 0 0);
        --foreground: oklch(0.9219 0 0);
        --primary: oklch(0.6231 0.1880 259.8145);
        --border: oklch(0.3715 0 0);
        --radius: 0.375rem;
      }
      :host([data-poexd-theme='modern-dark']) {
        color-scheme: dark;
      }
      :host([data-poexd-theme='caffeine']) {
        color-scheme: dark;
        --background: oklch(0.1776 0 0);
        --foreground: oklch(0.9491 0 0);
        --border: oklch(0.2351 0.0115 91.7467);
        --radius: 0.5rem;
      }
      :host([data-poexd-theme='catppuccin']) {
        color-scheme: dark;
        --background: oklch(0.2155 0.0254 284.0647);
        --foreground: oklch(0.8787 0.0426 272.2767);
        --border: oklch(0.324 0.0319 281.9784);
        --radius: 0.35rem;
      }
    `;
    shadowRoot.appendChild(styleEl);
    document.body.appendChild(shadowHost);

    // Initial theme apply
    applyThemeToHost(shadowHost, prefModule.read().theme);
    registerThemeHost(shadowHost);
  });

  afterEach(() => {
    cleanupPageThemeBridge();
    shadowHost.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('executes full cycles across Modern-Dark, Caffeine, and Catppuccin with instant bridge synchronization and no DOM/runtime pollution', async () => {
    const bridgeStyle = document.getElementById(PAGE_THEME_BRIDGE_STYLE_ID) as HTMLStyleElement;
    expect(bridgeStyle).not.toBeNull();

    // Round 0: Initial Modern-Dark (canonical default for empty storage)
    expect(prefModule.read().theme).toBe('modern-dark');
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('modern-dark');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();
    expect(document.body.getAttribute(THEME_ATTRIBUTE)).toBeNull();

    // Cycle 1 - Step 1: Modern-Dark -> Caffeine
    await prefModule.update({ theme: 'caffeine' });
    applyThemeToHost(shadowHost, prefModule.read().theme);
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('caffeine');
    await new Promise((r) => setTimeout(r, 20)); // wait for MutationObserver

    expect(bridgeStyle.textContent).toContain('--background:');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();

    // Cycle 1 - Step 2: Caffeine -> Catppuccin
    await prefModule.update({ theme: 'catppuccin' });
    applyThemeToHost(shadowHost, prefModule.read().theme);
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('catppuccin');
    await new Promise((r) => setTimeout(r, 20));

    // Cycle 1 - Step 3: Catppuccin -> Modern-Dark
    await prefModule.update({ theme: 'modern-dark' });
    applyThemeToHost(shadowHost, prefModule.read().theme);
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('modern-dark');
    await new Promise((r) => setTimeout(r, 20));

    // Cycle 2 - Step 1: Modern-Dark -> Catppuccin
    await prefModule.update({ theme: 'catppuccin' });
    applyThemeToHost(shadowHost, prefModule.read().theme);
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('catppuccin');
    await new Promise((r) => setTimeout(r, 20));

    // Cycle 2 - Step 2: Catppuccin -> Caffeine
    await prefModule.update({ theme: 'caffeine' });
    applyThemeToHost(shadowHost, prefModule.read().theme);
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('caffeine');
    await new Promise((r) => setTimeout(r, 20));

    // Cycle 2 - Step 3: Caffeine -> Modern-Dark
    await prefModule.update({ theme: 'modern-dark' });
    applyThemeToHost(shadowHost, prefModule.read().theme);
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('modern-dark');
    await new Promise((r) => setTimeout(r, 20));

    // Final checks: no pollution, valid default state
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();
    expect(document.body.getAttribute(THEME_ATTRIBUTE)).toBeNull();
    expect(shadowHost.getAttribute(THEME_ATTRIBUTE)).toBe('modern-dark');
  });

  it('preserves existing stored theme preferences (caffeine or catppuccin) without migrating or overwriting', async () => {
    const caffeineStorage = createInMemoryPreferencesStorage({ theme: 'caffeine' });
    const poe1Caffeine = await createPreferencesModule('poe1', caffeineStorage);
    expect(poe1Caffeine.ok).toBe(true);
    if (!poe1Caffeine.ok) throw new Error(poe1Caffeine.error.message);
    expect(poe1Caffeine.value.read().theme).toBe('caffeine');
    expect(caffeineStorage.inspect().theme).toBe('caffeine');

    const catppuccinStorage = createInMemoryPreferencesStorage({ theme: 'catppuccin' });
    const poe1Catppuccin = await createPreferencesModule('poe1', catppuccinStorage);
    expect(poe1Catppuccin.ok).toBe(true);
    if (!poe1Catppuccin.ok) throw new Error(poe1Catppuccin.error.message);
    expect(poe1Catppuccin.value.read().theme).toBe('catppuccin');
    expect(catppuccinStorage.inspect().theme).toBe('catppuccin');
  });
});
