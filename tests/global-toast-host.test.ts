// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { nextTick } from 'vue';
import { dispatchPoeEvent, initPoeEventNonce } from '@/utils/event-contracts';
import {
  initToastHost,
  getToastShadowRoot,
  syncToastPreferences,
} from '@/entrypoints/content/logic/toast-host';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';

describe('Global Toast Host Contract', () => {
  let cleanupHost: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    initPoeEventNonce('toast-host-unit-test');
    cleanupHost = initToastHost();
  });

  afterEach(() => {
    if (cleanupHost) {
      cleanupHost();
      cleanupHost = null;
    }
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const getToastElement = (): HTMLElement | null => {
    const shadow =
      getToastShadowRoot() || document.querySelector('poexd-toast-container')?.shadowRoot;
    return shadow?.querySelector<HTMLElement>('[data-poexd-toast]') ?? null;
  };

  const getAllToastElements = (): HTMLElement[] => {
    const shadow =
      getToastShadowRoot() || document.querySelector('poexd-toast-container')?.shadowRoot;
    return shadow ? Array.from(shadow.querySelectorAll<HTMLElement>('[data-poexd-toast]')) : [];
  };

  describe('Single DOM Host & Placement', () => {
    it('creates exactly one [data-poexd-toast] element upon dispatch with invariant top-center geometry', async () => {
      expect(getAllToastElements().length).toBe(0);

      dispatchPoeEvent('poexd-toast', {
        message: 'Hello World',
      });
      await nextTick();

      const toasts = getAllToastElements();
      expect(toasts.length).toBe(1);

      const toastEl = toasts[0];
      expect(toastEl.textContent?.trim()).toBe('Hello World');
      expect(toastEl.getAttribute('role')).toBe('status');
      expect(toastEl.getAttribute('aria-live')).toBe('polite');

      // Invariant top-center viewport positioning classes (Scale & Density invariant)
      expect(toastEl.className).toContain('fixed');
      expect(toastEl.className).toContain('top-[20px]');
      expect(toastEl.className).toContain('left-1/2');
      expect(toastEl.className).toContain('-translate-x-1/2');
      expect(toastEl.className).toContain('max-w-[calc(100vw-32px)]');
      expect(toastEl.className).toContain('z-[2147483647]');

      // Canonical UI Foundation typography and layout spacing tokens
      expect(toastEl.className).toContain('text-[length:var(--pxd-font-section-title)]');
      expect(toastEl.className).toContain('py-[var(--pxd-space-md)]');
      expect(toastEl.className).toContain('px-[var(--pxd-space-xl)]');
    });

    it('replaces message in-place without creating a second toast element (latest message wins)', async () => {
      dispatchPoeEvent('poexd-toast', {
        message: 'First Message',
      });
      await nextTick();

      expect(getAllToastElements().length).toBe(1);
      expect(getToastElement()?.textContent?.trim()).toBe('First Message');

      dispatchPoeEvent('poexd-toast', {
        message: 'Second Message',
      });
      await nextTick();

      const toasts = getAllToastElements();
      expect(toasts.length).toBe(1);
      expect(toasts[0].textContent?.trim()).toBe('Second Message');
    });
  });

  describe('Timeout & Persistence Semantics', () => {
    it('disappears after default 3000ms duration', async () => {
      dispatchPoeEvent('poexd-toast', {
        message: 'Disappearing toast',
      });
      await nextTick();

      expect(getToastElement()).not.toBeNull();

      vi.advanceTimersByTime(2999);
      await nextTick();
      expect(getToastElement()).not.toBeNull();

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(getToastElement()).toBeNull();
    });

    it('stays persistent when durationMs is 0 and does not disappear on its own', async () => {
      dispatchPoeEvent('poexd-toast', {
        message: 'Persistent sync message',
        durationMs: 0,
      });
      await nextTick();

      expect(getToastElement()).not.toBeNull();

      vi.advanceTimersByTime(10000);
      await nextTick();
      expect(getToastElement()).not.toBeNull();
      expect(getToastElement()?.textContent?.trim()).toBe('Persistent sync message');
    });

    it('allows subsequent message to replace a persistent toast and set a new timeout', async () => {
      dispatchPoeEvent('poexd-toast', {
        message: 'Persistent sync message',
        durationMs: 0,
      });
      await nextTick();

      vi.advanceTimersByTime(5000);
      await nextTick();
      expect(getToastElement()).not.toBeNull();

      // Subsequent message with 4000ms replaces it
      dispatchPoeEvent('poexd-toast', {
        message: 'Sync Success',
        tone: 'success',
        durationMs: 4000,
      });
      await nextTick();

      const toastEl = getToastElement();
      expect(toastEl).not.toBeNull();
      expect(toastEl?.textContent?.trim()).toBe('Sync Success');
      expect(toastEl?.dataset.tone).toBe('success');

      vi.advanceTimersByTime(3999);
      await nextTick();
      expect(getToastElement()).not.toBeNull();

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(getToastElement()).toBeNull();
    });

    it('resets timer when a second timed toast arrives before the first expires', async () => {
      dispatchPoeEvent('poexd-toast', {
        message: 'Message 1',
        durationMs: 3000,
      });
      await nextTick();

      vi.advanceTimersByTime(2000);
      await nextTick();

      // Dispatch second message at t = 2000ms
      dispatchPoeEvent('poexd-toast', {
        message: 'Message 2',
        durationMs: 3000,
      });
      await nextTick();

      // Advance by 1500ms (t = 3500ms total, Msg 1 would have expired, but Msg 2 should still be visible)
      vi.advanceTimersByTime(1500);
      await nextTick();
      expect(getToastElement()?.textContent?.trim()).toBe('Message 2');

      // Advance another 1500ms (t = 5000ms total, Msg 2 expires)
      vi.advanceTimersByTime(1500);
      await nextTick();
      expect(getToastElement()).toBeNull();
    });
  });

  describe('Theme Tone Presentation', () => {
    it('applies standard tone styling for default, success, and error without raw colors', async () => {
      // Default
      dispatchPoeEvent('poexd-toast', {
        message: 'Default tone',
        tone: 'default',
      });
      await nextTick();
      let toastEl = getToastElement()!;
      expect(toastEl.dataset.tone).toBe('default');
      expect(toastEl.className).toContain('border-border');
      expect(toastEl.className).toContain('bg-popover');
      expect(toastEl.className).toContain('text-popover-foreground');

      // Success
      dispatchPoeEvent('poexd-toast', {
        message: 'Success tone',
        tone: 'success',
      });
      await nextTick();
      toastEl = getToastElement()!;
      expect(toastEl.dataset.tone).toBe('success');
      expect(toastEl.className).toContain('border-primary');
      expect(toastEl.className).toContain('bg-popover');

      // Error
      dispatchPoeEvent('poexd-toast', {
        message: 'Error tone',
        tone: 'error',
      });
      await nextTick();
      toastEl = getToastElement()!;
      expect(toastEl.dataset.tone).toBe('error');
      expect(toastEl.className).toContain('border-destructive');
      expect(toastEl.className).toContain('color-mix');
    });
  });

  describe('UI Foundation Scale, Density & Positioning Invariance', () => {
    it('syncs canonical runtime tokens to Toast Shadow Host and responds to scale changes', () => {
      const container = document.querySelector('poexd-toast-container') as HTMLElement;
      expect(container).not.toBeNull();

      // Default baseline: scale 1.0 -> sectionTitlePx is 14px
      expect(container.style.getPropertyValue('--pxd-font-section-title')).toBe('14px');

      // Scale 1.2 -> sectionTitlePx is 14 * 1.2 = 16.8px
      syncToastPreferences({ fontSizeScale: 1.2 });
      expect(container.style.getPropertyValue('--pxd-font-section-title')).toBe('16.8px');

      // Scale 0.85 -> 14 * 0.85 = 11.9px
      syncToastPreferences({ fontSizeScale: 0.85 });
      expect(container.style.getPropertyValue('--pxd-font-section-title')).toBe('11.9px');
    });

    it('updates spacing on density changes without altering invariant positioning geometry', async () => {
      const container = document.querySelector('poexd-toast-container') as HTMLElement;
      expect(container).not.toBeNull();

      // Density compact (0.8) -> spaceMd (8px) becomes 6.4px
      syncToastPreferences({ fontSizeScale: 1.0, densityScale: 0.8 });
      expect(container.style.getPropertyValue('--pxd-space-md')).toBe('6.4px');
      expect(container.style.getPropertyValue('--pxd-space-xl')).toBe('12.8px');

      dispatchPoeEvent('poexd-toast', { message: 'Density test' });
      await nextTick();
      const toastEl = getToastElement()!;

      // Top positioning remains invariant at top-[20px]
      expect(toastEl.className).toContain('top-[20px]');
      expect(toastEl.className).not.toContain('top-5');
    });

    it('supplies Theme, Scale, and Density properly when Sidebar is completely unmounted', async () => {
      expect(document.querySelector('poexd-sidebar-container')).toBeNull();

      syncToastPreferences({
        theme: 'catppuccin',
        fontSizeScale: 1.2,
        densityScale: 0.8,
      });

      const container = document.querySelector('poexd-toast-container') as HTMLElement;
      expect(container.getAttribute('data-poexd-theme')).toBe('catppuccin');
      expect(container.style.getPropertyValue('--pxd-font-section-title')).toBe('16.8px');
      expect(container.style.getPropertyValue('--pxd-space-md')).toBe('7.68px'); // 8 * 1.2 * 0.8 = 7.68px

      dispatchPoeEvent('poexd-toast', { message: 'Independent Toast' });
      await nextTick();
      expect(getToastElement()?.textContent?.trim()).toBe('Independent Toast');
    });
  });

  describe('WXT Async Mount & Cleanup Race Guard (No Resurrection)', () => {
    it('prevents resurrection if cleanup is called while createShadowRootUi is pending', async () => {
      // Tear down the beforeEach cleanupHost first
      cleanupHost?.();
      cleanupHost = null;

      let resolveDeferredUi: ((ui: any) => void) | null = null;
      const mockMount = vi.fn();
      const mockRemove = vi.fn();
      const mockShadowHost = document.createElement('poexd-toast-container-mock');
      const mockUi = {
        mount: mockMount,
        remove: mockRemove,
        shadowHost: mockShadowHost,
      };

      const deferredPromise = new Promise((resolve) => {
        resolveDeferredUi = resolve;
      });

      const fakeCtx = {
        options: { cssInjectionMode: 'ui' },
        onInvalidated: vi.fn(),
      };

      const origCreateShadowRootUi = (globalThis as any).createShadowRootUi;
      (globalThis as any).createShadowRootUi = vi.fn().mockImplementation(() => deferredPromise);

      try {
        const testCleanup = initToastHost(fakeCtx);
        expect((globalThis as any).createShadowRootUi).toHaveBeenCalled();

        // While createShadowRootUi is still pending, invoke cleanup
        testCleanup();

        // Now resolve createShadowRootUi
        resolveDeferredUi!(mockUi);
        await deferredPromise;
        await nextTick();

        // Verify ui.mount was NEVER executed and no resurrection occurred
        expect(mockMount).not.toHaveBeenCalled();
        expect(document.querySelector('poexd-toast-container-mock')).toBeNull();
        expect(getToastShadowRoot()).toBeNull();
      } finally {
        (globalThis as any).createShadowRootUi = origCreateShadowRootUi;
      }
    });

    it('cleans up UI and listeners completely on host teardown', async () => {
      dispatchPoeEvent('poexd-toast', {
        message: 'Before cleanup',
        durationMs: 0,
      });
      await nextTick();
      expect(getToastElement()).not.toBeNull();

      cleanupHost!();
      cleanupHost = null;
      await nextTick();

      expect(document.querySelector('poexd-toast-container')).toBeNull();
      expect(getToastShadowRoot()).toBeNull();

      // Subsequent dispatch does not show toast
      dispatchPoeEvent('poexd-toast', {
        message: 'After cleanup',
      });
      await nextTick();
      expect(getToastElement()).toBeNull();
    });
  });

  describe('Producer Delegation & Zero Local Toast Audit', () => {
    it('verifies BookmarkPane delegates showToast to global poexd-toast without local renderer or timer', () => {
      const bookmarkSource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/BookmarkPane.vue'),
        'utf-8',
      );
      expect(bookmarkSource).not.toContain('toastMessage');
      expect(bookmarkSource).not.toContain('toastTimer');
      expect(bookmarkSource).not.toContain('toast-tip');
      expect(bookmarkSource).not.toContain('toast-fade');
      expect(bookmarkSource).toMatch(
        /const showToast = \(message: string\) =>\s*\{[\s\S]*?dispatchPoeEvent\('poexd-toast'/,
      );
    });

    it('verifies FilterPane delegates showToast to global poexd-toast without local renderer, timer, or scoped style', () => {
      const filterSource = readFileSync(
        path.resolve(__dirname, '../components/sidebar/FilterPane.vue'),
        'utf-8',
      );
      expect(filterSource).not.toContain('toastMessage');
      expect(filterSource).not.toContain('toastTimer');
      expect(filterSource).not.toContain('toast-tip');
      expect(filterSource).not.toContain('toast-fade');
      expect(filterSource).not.toContain('<style');
      expect(filterSource).toMatch(
        /const showToast = \(msg: string\) =>\s*\{[\s\S]*?dispatchPoeEvent\('poexd-toast'/,
      );
    });
  });
});
