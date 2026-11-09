// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';

const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8');
const filterPaneSource = readFileSync('components/sidebar/FilterPane.vue', 'utf8');
const dialogContentSource = readFileSync('components/ui/dialog/DialogContent.vue', 'utf8');

// Spy records for FilterPane lifecycle
const filterPaneLifecycle = {
  mountCount: 0,
  unmountCount: 0,
  lastProps: {
    targetGroupIndex: 0,
    isOpen: false,
  },
  reset() {
    this.mountCount = 0;
    this.unmountCount = 0;
    this.lastProps = { targetGroupIndex: 0, isOpen: false };
  },
};

vi.mock('@/components/sidebar/FilterPane.vue', () => ({
  default: defineComponent({
    name: 'FilterPane',
    props: {
      targetGroupIndex: { type: Number, default: 0 },
      isOpen: { type: Boolean, default: false },
    },
    setup(props) {
      filterPaneLifecycle.mountCount++;
      return () => {
        filterPaneLifecycle.lastProps = {
          targetGroupIndex: props.targetGroupIndex,
          isOpen: props.isOpen,
        };
        return h('div', {
          'data-test': 'filter-pane-mock',
          'data-is-open': String(props.isOpen),
          'data-target-group': String(props.targetGroupIndex),
        });
      };
    },
    unmounted() {
      filterPaneLifecycle.unmountCount++;
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

vi.mock('@/utils/preferences', () => ({
  DEFAULT_PREFERENCES: {
    sidebarPosition: 'left',
    sidebarSize: 'medium',
    sidebarWidth: 340,
    fontSizeScale: 1,
    densityScale: 1,
  },
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => ({
        sidebarPosition: 'left',
        sidebarSize: 'medium',
        sidebarWidth: 340,
        fontSizeScale: 1,
        densityScale: 1,
      })),
    },
  })),
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

describe('Sidebar Affix Selector Modal (Static & Stacking Contracts)', () => {
  it('eliminates legacy modal classes and custom overlays from Sidebar.vue', () => {
    expect(sidebarSource).not.toContain('.poexd-modal-overlay');
    expect(sidebarSource).not.toContain('.poexd-modal-container');
    expect(sidebarSource).not.toContain('.modal-header');
    expect(sidebarSource).not.toContain('.modal-title');
    expect(sidebarSource).not.toContain('.modal-close-btn');
    expect(sidebarSource).not.toContain('.modal-body');
  });

  it('eliminates .poe-btn-danger in Sidebar.vue in favor of semantic Button variants', () => {
    expect(sidebarSource).not.toContain('.poe-btn-danger');
  });

  it('enforces portalRoot + Dialog primitive as stacking SSOT without custom business z-index ladders', () => {
    // Affix Dialog retains inset placement and geometry without custom z-index
    expect(sidebarSource).toContain('placement="inset"');
    expect(sidebarSource).toContain('inset-x-[5vw]');
    expect(sidebarSource).toContain('inset-y-[5vh]');
    expect(sidebarSource).not.toContain('z-[999999998]');
    expect(sidebarSource).not.toContain('z-[999999999]');

    // Item Type Dialog has no custom z-index overrides
    expect(filterPaneSource).not.toContain('z-[1000000000]');
    expect(filterPaneSource).not.toContain('z-[1000000001]');

    // Shared Global Dialog has no custom z-index overrides
    expect(sidebarSource).not.toContain('z-[1000000002]');
    expect(sidebarSource).not.toContain('z-[1000000003]');

    // Generic DialogContent primitive defaults to z-50
    expect(dialogContentSource).toContain('z-50');
  });

  it('enforces unified center fade and zoom animation without directional slide in DialogContent', () => {
    expect(dialogContentSource).toContain('data-[state=open]:animate-in');
    expect(dialogContentSource).toContain('data-[state=closed]:animate-out');
    expect(dialogContentSource).toContain('data-[state=closed]:fade-out-0');
    expect(dialogContentSource).toContain('data-[state=open]:fade-in-0');
    expect(dialogContentSource).toContain('data-[state=closed]:zoom-out-95');
    expect(dialogContentSource).toContain('data-[state=open]:zoom-in-95');
    expect(dialogContentSource).not.toContain('slide-in-from-left-1/2');
    expect(dialogContentSource).not.toContain('slide-in-from-top');
    expect(dialogContentSource).not.toContain('slide-out-to-left-1/2');
    expect(dialogContentSource).not.toContain('slide-out-to-top');
  });
});

describe('Generic DialogContent Extension (Regression Contracts)', () => {
  it('operates normally without optional props', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      setup() {
        return () =>
          h(Dialog, { open: true }, () => [
            h(DialogContent, null, () => [
              h(DialogTitle, 'Generic Title'),
              h(DialogDescription, 'Generic Desc'),
            ]),
          ]);
      },
    });
    app.mount(host);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = document.body.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    const closeBtn = document.body.querySelector('[data-slot="dialog-close"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(closeBtn).toBeTruthy();

    // Default classes preserved
    expect(overlay.className).toContain('bg-black/80');

    app.unmount();
    host.remove();
  });

  it('wires overlayMousedown, overlayMouseup, and closeClass when provided', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mousedownSpy = vi.fn();
    const mouseupSpy = vi.fn();

    const app = createApp({
      setup() {
        return () =>
          h(Dialog, { open: true }, () => [
            h(
              DialogContent,
              {
                overlayMousedown: mousedownSpy,
                overlayMouseup: mouseupSpy,
                closeClass: 'test-custom-close',
              },
              () => [h(DialogTitle, 'Props Title'), h(DialogDescription, 'Props Desc')],
            ),
          ]);
      },
    });
    app.mount(host);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = document.body.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    const closeBtn = document.body.querySelector('[data-slot="dialog-close"]') as HTMLElement;

    expect(closeBtn.className).toContain('test-custom-close');

    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(mousedownSpy).toHaveBeenCalledTimes(1);

    overlay.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(mouseupSpy).toHaveBeenCalledTimes(1);

    app.unmount();
    host.remove();
  });

  it('preserves default centered placement with translate and zoom animation', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      setup() {
        return () =>
          h(Dialog, { open: true }, () => [
            h(DialogContent, null, () => [
              h(DialogTitle, 'Centered Title'),
              h(DialogDescription, 'Centered Desc'),
            ]),
          ]);
      },
    });
    app.mount(host);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = document.body.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.className).toContain('-translate-x-1/2');
    expect(content.className).toContain('-translate-y-1/2');
    expect(content.className).toContain('left-1/2');
    expect(content.className).toContain('top-1/2');
    expect(content.className).toContain('data-[state=open]:zoom-in-95');
    expect(content.className).toContain('data-[state=closed]:zoom-out-95');

    app.unmount();
    host.remove();
  });

  it('supports placement="inset" without translate or zoom animation', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp({
      setup() {
        return () =>
          h(Dialog, { open: true }, () => [
            h(
              DialogContent,
              {
                placement: 'inset',
                class: 'inset-x-[5vw] inset-y-[5vh] w-auto h-auto max-w-none max-h-none',
              },
              () => [h(DialogTitle, 'Inset Title'), h(DialogDescription, 'Inset Desc')],
            ),
          ]);
      },
    });
    app.mount(host);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = document.body.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    expect(content).toBeTruthy();
    // Inset placement must NOT contain transform-centered or zoom classes
    expect(content.className).not.toContain('-translate-x-1/2');
    expect(content.className).not.toContain('-translate-y-1/2');
    expect(content.className).not.toContain('zoom-in-95');
    expect(content.className).not.toContain('zoom-out-95');

    // Generic base classes and fade animation must remain intact
    expect(content.className).toContain('fixed');
    expect(content.className).toContain('bg-background');
    expect(content.className).toContain('data-[state=open]:fade-in-0');
    expect(content.className).toContain('data-[state=closed]:fade-out-0');
    expect(content.className).toContain('inset-x-[5vw]');
    expect(content.className).toContain('inset-y-[5vh]');

    app.unmount();
    host.remove();
  });
});

describe('Sidebar Affix Selector Modal (Runtime Contracts)', () => {
  let host: HTMLElement;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: any;

  const getAffixContent = (): HTMLElement | null => {
    return (
      Array.from(portalRoot.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
        (el) => el.className.includes('inset-x-[5vw]'),
      ) ?? null
    );
  };

  const getAffixOverlay = (): HTMLElement | null => {
    const content = getAffixContent();
    if (!content) return null;
    return (content.previousElementSibling as HTMLElement | null)?.matches(
      '[data-slot="dialog-overlay"]',
    )
      ? (content.previousElementSibling as HTMLElement)
      : portalRoot.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
  };

  const mountSidebar = async () => {
    filterPaneLifecycle.reset();

    host = document.createElement('div');
    document.body.appendChild(host);

    appRoot = document.createElement('div');
    portalRoot = document.createElement('div');
    host.appendChild(appRoot);
    host.appendChild(portalRoot);

    app = createApp({
      setup() {
        return () => h(Sidebar, { portalTarget: portalRoot });
      },
    });

    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 40));
  };

  beforeEach(async () => {
    await mountSidebar();
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
    vi.restoreAllMocks();
  });

  it('25. preserves FilterPane mount persistence across open -> close -> reopen lifecycle', async () => {
    // Initially unmountOnHide=false means FilterPane is mounted on start
    expect(filterPaneLifecycle.mountCount).toBe(1);
    expect(filterPaneLifecycle.unmountCount).toBe(0);
    expect(filterPaneLifecycle.lastProps.isOpen).toBe(false);

    // Open Affix Modal
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 1 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(filterPaneLifecycle.mountCount).toBe(1);
    expect(filterPaneLifecycle.unmountCount).toBe(0);
    expect(filterPaneLifecycle.lastProps.isOpen).toBe(true);
    expect(filterPaneLifecycle.lastProps.targetGroupIndex).toBe(1);

    // Close Affix Modal
    dispatchPoeEvent('poexd-close-affix-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Must NOT unmount!
    expect(filterPaneLifecycle.mountCount).toBe(1);
    expect(filterPaneLifecycle.unmountCount).toBe(0);
    expect(filterPaneLifecycle.lastProps.isOpen).toBe(false);

    // Reopen Affix Modal
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 2 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Mount count must STILL be 1 (same instance)
    expect(filterPaneLifecycle.mountCount).toBe(1);
    expect(filterPaneLifecycle.unmountCount).toBe(0);
    expect(filterPaneLifecycle.lastProps.isOpen).toBe(true);
    expect(filterPaneLifecycle.lastProps.targetGroupIndex).toBe(2);

    dispatchPoeEvent('poexd-close-affix-modal');
  });

  it('26. opens dialog and passes targetGroupIndex upon poexd-open-affix-modal event', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 5 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getAffixContent();
    const overlay = getAffixOverlay();
    expect(content).toBeTruthy();
    expect(overlay).toBeTruthy();
    expect(content!.getAttribute('data-state')).toBe('open');
    expect(content!.className).toContain('inset-x-[5vw]');
    expect(content!.className).toContain('inset-y-[5vh]');
    expect(content!.className).not.toContain('-translate-x-1/2');
    expect(content!.className).not.toContain('-translate-y-1/2');
    expect(content!.className).not.toContain('zoom-in-95');
    expect(content!.className).not.toContain('zoom-out-95');

    expect(filterPaneLifecycle.lastProps.targetGroupIndex).toBe(5);
    expect(filterPaneLifecycle.lastProps.isOpen).toBe(true);

    dispatchPoeEvent('poexd-close-affix-modal');
  });

  it('27. closes dialog upon poexd-close-affix-modal event without unmounting FilterPane', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(getAffixContent()!.getAttribute('data-state')).toBe('open');

    dispatchPoeEvent('poexd-close-affix-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(getAffixContent()!.getAttribute('data-state')).toBe('closed');
    expect(filterPaneLifecycle.unmountCount).toBe(0);
  });

  it('28. closes modal on mousedown Overlay + mouseup Overlay (Case A)', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = getAffixOverlay();
    expect(overlay).toBeTruthy();

    overlay!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    overlay!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(getAffixContent()!.getAttribute('data-state')).toBe('closed');
    expect(filterPaneLifecycle.lastProps.isOpen).toBe(false);
  });

  it('29. does NOT close on mousedown Overlay + mouseup Content (Case B) and clears flag on document mouseup', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = getAffixOverlay();
    const content = getAffixContent();

    overlay!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    content!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Must remain open
    expect(content!.getAttribute('data-state')).toBe('open');

    // Document mouseup clears mousedown flag
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // Subsequent mouseup on overlay without prior mousedown on overlay must NOT close
    overlay!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(content!.getAttribute('data-state')).toBe('open');

    dispatchPoeEvent('poexd-close-affix-modal');
  });

  it('30. does NOT close on mousedown Content + mouseup Overlay (Case C)', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = getAffixOverlay();
    const content = getAffixContent();

    content!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    overlay!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Must remain open
    expect(content!.getAttribute('data-state')).toBe('open');

    dispatchPoeEvent('poexd-close-affix-modal');
  });

  it('31. keeps Dialog open on pointerdown outside / overlay alone without mouseup', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = getAffixOverlay();
    const content = getAffixContent();

    // Reka pointerdown outside event simulation
    overlay!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Must remain open
    expect(content!.getAttribute('data-state')).toBe('open');

    dispatchPoeEvent('poexd-close-affix-modal');
  });

  it('32. closes modal via built-in close button exactly once without unmounting FilterPane', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getAffixContent();
    const closeBtn = content!.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();

    closeBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(content!.getAttribute('data-state')).toBe('closed');
    expect(filterPaneLifecycle.lastProps.isOpen).toBe(false);
    expect(filterPaneLifecycle.unmountCount).toBe(0);
  });

  it('33. Escape handles Affix alone and prioritizes Shared Dialog when both open', async () => {
    // 1. Affix only
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(getAffixContent()!.getAttribute('data-state')).toBe('open');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(getAffixContent()!.getAttribute('data-state')).toBe('closed');

    // 2. Both open: Shared Dialog + Affix Modal
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    let confirmResolved: any = null;
    (window as any).poexdConfirm('巢狀確認測試').then((val: any) => {
      confirmResolved = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Press Escape #1: Must close Shared Dialog, Affix must remain open!
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 40));

    expect(confirmResolved).toBe(false);
    expect(getAffixContent()!.getAttribute('data-state')).toBe('open');

    // Press Escape #2: Now closes Affix Modal!
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 40));

    expect(getAffixContent()!.getAttribute('data-state')).toBe('closed');
  });

  it('34. dispatches poexd-modal-active-changed exactly once on open and close', async () => {
    const activeStates: boolean[] = [];
    const removeListener = listenPoeEvent('poexd-modal-active-changed', (detail) => {
      activeStates.push(detail);
    });

    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(activeStates).toEqual([true]);

    dispatchPoeEvent('poexd-close-affix-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(activeStates).toEqual([true, false]);

    removeListener();
  });

  it('35. does not dispatch duplicate modal-active-changed when Shared Dialog opens while Affix is open', async () => {
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const activeStates: boolean[] = [];
    const removeListener = listenPoeEvent('poexd-modal-active-changed', (detail) => {
      activeStates.push(detail);
    });

    // Open Shared Dialog
    let confirmPromise = (window as any).poexdConfirm('訊息');
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Since Affix is already active, active-changed must NOT be dispatched again
    expect(activeStates).toEqual([]);

    // Close Shared Dialog
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await confirmPromise;
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Still empty (modal is still active because Affix is open)
    expect(activeStates).toEqual([]);

    removeListener();
    dispatchPoeEvent('poexd-close-affix-modal');
  });
});
