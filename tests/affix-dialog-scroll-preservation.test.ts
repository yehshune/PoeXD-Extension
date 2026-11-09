// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { dispatchPoeEvent } from '@/utils/event-contracts';

// Mock other sidebar panes to isolate Sidebar
vi.mock('@/components/sidebar/FilterPane.vue', () => ({
  default: defineComponent({
    name: 'FilterPane',
    props: {
      targetGroupIndex: { type: Number, default: 0 },
      isOpen: { type: Boolean, default: false },
    },
    emits: ['type-dialog-open-changed'],
    setup(_props, { emit }) {
      let isTypeOpen = false;
      return () =>
        h('div', {
          'data-test': 'filter-pane-mock',
          onClick: () => {
            isTypeOpen = !isTypeOpen;
            emit('type-dialog-open-changed', isTypeOpen);
          },
        });
    },
  }),
}));

vi.mock('@/components/sidebar/BookmarkPane.vue', () => ({
  default: { name: 'BookmarkPane', template: '<div data-test="bookmark-pane"></div>' },
}));
vi.mock('@/components/sidebar/HistoryPane.vue', () => ({
  default: { name: 'HistoryPane', template: '<div data-test="history-pane"></div>' },
}));
vi.mock('@/components/sidebar/SettingsPane.vue', () => ({
  default: { name: 'SettingsPane', template: '<div data-test="settings-pane"></div>' },
}));
vi.mock('@/components/sidebar/ToolsPane.vue', () => ({
  default: { name: 'ToolsPane', template: '<div data-test="tools-pane"></div>' },
}));

(globalThis as any).chrome = {
  runtime: {
    getURL: vi.fn((path: string) => path),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

describe('Affix & Type Dialog Host Scroll Preservation & Restoration', () => {
  let app: any = null;
  let host: HTMLElement | null = null;
  let portalRoot: HTMLElement | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);

    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    document.body.appendChild(portalRoot);

    vi.clearAllMocks();
    window.scrollX = 0;
    window.scrollY = 0;
    window.scrollTo = vi.fn((options: any) => {
      if (typeof options === 'object') {
        window.scrollX = options.left ?? window.scrollX;
        window.scrollY = options.top ?? window.scrollY;
      }
    });
  });

  afterEach(() => {
    app?.unmount();
    host?.remove();
    portalRoot?.remove();
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('1. preserves and restores host scroll position when Affix Modal opens and closes', async () => {
    app = createApp(Sidebar, { portalTarget: portalRoot });
    app.mount(host!);
    await nextTick();

    // User scrolled down the POE site to 1250px
    window.scrollY = 1250;
    window.scrollX = 0;

    // Open Affix Modal
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();

    // Simulate something (browser or internal event) resetting scroll while modal is active
    window.scrollY = 0;

    // Close Affix Modal
    dispatchPoeEvent('poexd-close-affix-modal');
    await nextTick();

    // Fast-forward microtasks and timeouts
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: 1250,
        left: 0,
        behavior: 'instant',
      }),
    );
    expect(window.scrollY).toBe(1250);
  });

  it('2. preserves initial scroll across nested type dialog and restores on final modal close', async () => {
    app = createApp(Sidebar, { portalTarget: portalRoot });
    app.mount(host!);
    await nextTick();

    // User scrolled to 880px
    window.scrollY = 880;

    // Open Affix Modal
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();

    // Trigger nested Type Dialog from inside FilterPane
    const filterPaneMock = document.querySelector('[data-test="filter-pane-mock"]') as HTMLElement;
    filterPaneMock?.click();
    await nextTick();

    // Scroll gets disturbed to 0 during nested interaction
    window.scrollY = 0;

    // Close nested Type Dialog first (type-dialog-open-changed: false)
    filterPaneMock?.click();
    await nextTick();

    // Close Affix Modal
    dispatchPoeEvent('poexd-close-affix-modal');
    await nextTick();

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: 880,
        left: 0,
        behavior: 'instant',
      }),
    );
    expect(window.scrollY).toBe(880);
  });

  it('3. DialogContent binds handleCloseAutoFocus to prevent scroll jumps on dismiss', () => {
    const source = readFileSync('components/ui/dialog/DialogContent.vue', 'utf8');
    expect(source).toContain('@close-auto-focus="handleCloseAutoFocus"');
    expect(source).toContain('handleCloseAutoFocus');
    expect(source).toContain('event.preventDefault()');
  });
});
