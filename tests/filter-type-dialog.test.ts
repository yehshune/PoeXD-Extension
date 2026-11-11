// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import FilterPane from '@/components/sidebar/FilterPane.vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { registerTierSlotRefresher } from '@/utils/tier-slot-registry';

const source = readFileSync('components/sidebar/FilterPane.vue', 'utf8');
const dialogContentSource = readFileSync('components/ui/dialog/DialogContent.vue', 'utf8');

// Mock chrome extension APIs
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

const sampleModsData = {
  test_mod: [
    {
      id: 'stat_1',
      level: '1',
      types: ['body-armour', 'body_armours_str', 'helmet', 'boots', 'gloves', 'bow', 'shield'],
    },
  ],
};

global.fetch = vi.fn().mockImplementation(async () => ({
  ok: true,
  json: async () => sampleModsData,
}));

beforeEach(() => mockModsData(sampleModsData));

describe('FilterPane Item Type Selector & Dialog (Static Contracts)', () => {
  it('eliminates legacy modal classes and custom overlays', () => {
    expect(source).not.toContain('custom-select-modal-overlay');
    expect(source).not.toContain('custom-select-modal-content');
    expect(source).not.toContain('.modal-header');
    expect(source).not.toContain('.modal-title');
    expect(source).not.toContain('.modal-close-btn');
    expect(source).not.toContain('modal-close-btn');
    expect(source).not.toContain('.modal-fade-');
    expect(source).not.toContain('@keyframes modal-zoom');
    expect(source).not.toContain('dropdown-search-input');
    expect(source).not.toContain('dropdown-options-list');
  });

  it('eliminates manual Escape keydown and document click-outside listeners', () => {
    expect(source).not.toContain('handleDropdownKeyDown');
    expect(source).not.toContain('handleClickOutside');
    expect(source).not.toContain("window.addEventListener('keydown', handleDropdownKeyDown");
    expect(source).not.toContain("document.addEventListener('click', handleClickOutside");
  });

  it('migrates type option buttons to shadcn Button without legacy type-btn class', () => {
    expect(source).not.toMatch(/<button[^>]*class="[^"]*type-btn/);
    expect(source).not.toContain('.type-btn {');
    expect(source).not.toContain('.type-btn:hover');
    expect(source).not.toContain('.type-btn.selected');
    expect(source).not.toContain('.main-type-btn');
    expect(source).not.toContain('.sub-type-btn');
  });

  it('L. uses typeOptionsRootRef for scroll lookup instead of filterPaneRoot or document', () => {
    expect(source).toContain('typeOptionsRootRef');
    expect(source).toContain('typeOptionsRootRef.value?.querySelector');
    expect(source).not.toContain("filterPaneRoot.value?.querySelector('.type-btn.selected')");
    expect(source).not.toContain("filterPaneRoot.value?.querySelector('.type-btn')");
    expect(source).not.toContain("document.querySelector('.type-btn.selected')");
  });

  it('preserves generic Dialog default dialog z-index token and provides overlayClass override API', () => {
    expect(dialogContentSource).toContain('z-(--pxd-z-dialog)');
    expect(dialogContentSource).toContain("overlayClass?: HTMLAttributes['class']");
    expect(dialogContentSource).toContain("reactiveOmit(props, 'class', 'overlayClass')");
    expect(dialogContentSource).toContain('props.overlayClass');
  });

  it('relies on generic Dialog primitive stacking without custom z-index override in FilterPane', () => {
    expect(source).not.toContain('z-[1000000000]');
    expect(source).not.toContain('z-[1000000001]');
    expect(source).not.toContain('overlay-class="z-');
    expect(source).toContain('layer="nested"');
  });

  it('does not dispatch poexd-modal-active-changed directly from FilterPane.vue and declares local emit', () => {
    expect(source).not.toContain("dispatchPoeEvent('poexd-modal-active-changed'");
    expect(source).toContain("'type-dialog-open-changed'");
  });

  it('configures Type Dialog as a medium centered dialog with bounded scroll ownership', () => {
    // Retains centered placement without placement="inset"
    expect(source).not.toContain('placement="inset"');
    // Bounded medium geometry
    expect(source).toContain('max-h-[72vh]');
    expect(source).toContain('max-w-[720px]');
    // Decoupled from density-aware layout spacing
    expect(source).not.toContain('calc(100vw-2*var(--pxd-pane-padding))');
    expect(source).toContain('w-[calc(100vw-32px)]');
    // Options root holds vertical scroll ownership
    expect(source).toContain('ref="typeOptionsRootRef"');
    expect(source).toMatch(/ref="typeOptionsRootRef"[^>]*overflow-y-auto/);
  });

  it('ensures typeSearchInputRef has type-safe ref and does not use as any', () => {
    expect(source).not.toContain('typeSearchInputRef.value as any');
    expect(source).not.toContain('typeSearchInputRef.value as');
    expect(source).toContain('ref<HTMLInputElement | { $el?: HTMLInputElement } | null>');
  });

  it('conforms Dialog controls and typography to Foundation primitives and semantic tokens', () => {
    // DialogTitle uses semantic section-title typography
    expect(source).toContain('text-[length:var(--pxd-font-section-title)]');
    expect(source).not.toContain('text-[calc(13px*var(--poexd-font-size-scale');

    // Dialog Search Input uses size="default"
    expect(source).toMatch(/<Input[^>]*ref="typeSearchInputRef"[^>]*size="default"/);
    expect(source).not.toContain('h-8');

    // All option buttons use size="sm" without h-auto
    expect(source).toMatch(/<Button[^>]*v-if="row\.mainOption"[^>]*size="sm"/);
    expect(source).toMatch(/<Button[^>]*v-for="subOpt in row\.subOptions"[^>]*size="sm"/);
    expect(source).toMatch(/<Button[^>]*v-for="opt in group\.singleOptions"[^>]*size="sm"/);

    // Fallback label aligns with size="sm" control height
    expect(source).toContain('min-h-[var(--control-height-sm)]');
  });
});

describe('FilterPane Item Type Selector & Dialog (Runtime Contracts)', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  const mountFilterPane = async (props: Record<string, any> = {}) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    shadowRoot.appendChild(appRoot);
    shadowRoot.appendChild(portalRoot);

    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(FilterPane, { isOpen: true, ...props }),
          ]);
      },
    });

    app = createApp(Wrapper);
    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));
    await nextTick();
  };

  beforeEach(() => {
    delete (window as any).__poexd_selecting_target__;
  });

  afterEach(() => {
    if (app) {
      app.unmount();
    }
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
    delete (window as any).__poexd_selecting_target__;
    vi.restoreAllMocks();
  });

  it('A. opens Dialog when clicking item-type trigger button and displays 選擇物品類別', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    expect(triggerBtn).toBeTruthy();

    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeNull();

    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const content = portalRoot.querySelector('[data-slot="dialog-content"]');
    expect(content).toBeTruthy();
    expect(content?.textContent).toContain('選擇物品類別');
    expect(content?.className).toContain('-translate-x-1/2');
    expect(content?.className).toContain('max-h-[72vh]');
    expect(content?.className).toContain('max-w-[720px]');
    expect(content?.className).toContain('w-[calc(100vw-32px)]');
    expect(content?.className).not.toContain('--pxd-pane-padding');
    expect(content?.className).toContain('data-[state=open]:zoom-in-95');
    expect(content?.className).not.toContain('inset-x-[5vw]');
  });

  it('B. enforces Shadow Root portal contract: Dialog content mounts into portalRoot, not outside host', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    // Content in portalRoot
    const portalContent = portalRoot.querySelector('[data-slot="dialog-content"]');
    expect(portalContent).toBeTruthy();

    // Not inside FilterPane subtree
    const appContent = appRoot.querySelector('[data-slot="dialog-content"]');
    expect(appContent).toBeNull();

    // Not in global document.body outside shadow host
    const directBodyContent = Array.from(document.body.children).find(
      (el) => el !== host && el.querySelector?.('[data-slot="dialog-content"]'),
    );
    expect(directBodyContent).toBeUndefined();
  });

  it('C. preserves type search filtering in Dialog', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const searchInput = portalRoot.querySelector(
      'input[placeholder="搜尋種類..."]',
    ) as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    // Initially contains both 胸甲 and 弓
    expect(portalRoot.textContent).toContain('胸甲');
    expect(portalRoot.textContent).toContain('弓');

    // Filter for 弓
    searchInput.value = '弓';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(portalRoot.textContent).toContain('弓');
    expect(portalRoot.textContent).not.toContain('頭盔');

    // Filter for non-existent
    searchInput.value = 'zzzzz_not_found';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(portalRoot.textContent).toContain('找不到相符的物品類別');
  });

  it('D. marks currently selectedType button with selected state class and data-selected="true"', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    // Default selectedType is 'body-armour'
    const selectedBtn = portalRoot.querySelector(
      'button[data-selected="true"]',
    ) as HTMLButtonElement;
    expect(selectedBtn).toBeTruthy();
    expect(selectedBtn.textContent?.trim()).toContain('胸甲');
    expect(selectedBtn.className).toContain('bg-accent');
    expect(selectedBtn.className).toContain('text-accent-foreground');
  });

  it('E. closes Dialog, dispatches poexd-update-stat-category, and preserves global selectedType when choosing option with target', async () => {
    await mountFilterPane();

    const targetPayload = {
      groupIndex: 1,
      filterIndex: 2,
      availableTypes: ['body-armour', 'helmet', 'bow'],
      currentCategory: 'bow',
    };
    (window as any).__poexd_selecting_target__ = targetPayload;

    const updateEventSpy = vi.fn();
    const removeListener = listenPoeEvent('poexd-update-stat-category', (data) => {
      updateEventSpy(data);
    });

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    // Find helmet option button
    const buttons = Array.from(portalRoot.querySelectorAll('button'));
    const helmetBtn = buttons.find((b) => b.textContent?.trim() === '頭盔');
    expect(helmetBtn).toBeTruthy();

    helmetBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    expect(updateEventSpy).toHaveBeenCalledWith({
      groupIndex: 1,
      filterIndex: 2,
      category: 'helmet',
    });

    // Dialog should be closed
    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeNull();

    // Trigger button preserves original FilterPane selectedType (胸甲), not polluted by per-filter target
    expect(triggerBtn.textContent).toContain('胸甲');

    removeListener();
  });

  it('F. does not dispatch poexd-close-affix-modal on option selection with selecting target', async () => {
    await mountFilterPane();

    const targetPayload = {
      groupIndex: 0,
      filterIndex: 0,
    };
    (window as any).__poexd_selecting_target__ = targetPayload;

    const closeAffixModalSpy = vi.fn();
    const removeListener = listenPoeEvent('poexd-close-affix-modal', () => {
      closeAffixModalSpy();
    });

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const buttons = Array.from(portalRoot.querySelectorAll('button'));
    const helmetBtn = buttons.find((b) => b.textContent?.trim() === '頭盔');
    helmetBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    // Type Dialog does not touch Affix Dialog
    expect(closeAffixModalSpy).not.toHaveBeenCalled();
    expect((window as any).__poexd_selecting_target__).toBeNull();

    removeListener();
  });

  it('G. coordinates category update and invokes refreshAndReopenTierSlot via stable slotKey', async () => {
    await mountFilterPane();

    const nativeTriggerClick = vi.fn();
    const unregister = registerTierSlotRefresher(async (slotKey) => {
      if (slotKey === 'slot-test-key') {
        nativeTriggerClick();
        return true;
      }
      return false;
    });

    (window as any).__poexd_selecting_target__ = {
      slotKey: 'slot-test-key',
      groupIndex: 0,
      filterIndex: 0,
    };

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const buttons = Array.from(portalRoot.querySelectorAll('button'));
    const helmetBtn = buttons.find((b) => b.textContent?.trim() === '頭盔');
    helmetBtn?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 10));

    expect(nativeTriggerClick).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('H. closes Dialog and does not dispatch poexd-close-affix-modal on Escape dismiss with selecting target', async () => {
    await mountFilterPane();

    (window as any).__poexd_selecting_target__ = {
      groupIndex: 3,
      filterIndex: 1,
    };

    const closeSpy = vi.fn();
    const removeListener = listenPoeEvent('poexd-close-affix-modal', () => {
      closeSpy();
    });

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeTruthy();

    // Simulate Reka Escape dismiss via window keydown event
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
    expect((window as any).__poexd_selecting_target__).toBeNull();

    removeListener();
  });

  it('I. closes Dialog and does not dispatch poexd-close-affix-modal on built-in close button', async () => {
    await mountFilterPane();

    (window as any).__poexd_selecting_target__ = {
      groupIndex: 2,
      filterIndex: 0,
    };

    const closeSpy = vi.fn();
    const removeListener = listenPoeEvent('poexd-close-affix-modal', () => {
      closeSpy();
    });

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const closeBtn = portalRoot.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
    expect((window as any).__poexd_selecting_target__).toBeNull();

    removeListener();
  });

  it('enforces runtime stacking: Overlay and Content mount into portalRoot with nested dialog layer token', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const overlay = portalRoot.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    const content = portalRoot.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(content).toBeTruthy();

    expect(overlay.className).toContain('z-(--pxd-z-dialog-nested)');
    expect(content.className).toContain('z-(--pxd-z-dialog-nested)');
    expect(overlay.className).not.toContain('z-(--pxd-z-dialog)');
    expect(content.className).not.toContain('z-(--pxd-z-dialog)');
  });

  it('J. opens Dialog programmatically when receiving poexd-trigger-select-type-modal event', async () => {
    await mountFilterPane();

    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeNull();

    dispatchPoeEvent('poexd-trigger-select-type-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeTruthy();
  });

  it('K. focuses typeSearchInputRef after Dialog opens', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    // Watcher has setTimeout 100ms
    await new Promise((r) => setTimeout(r, 120));

    const input = portalRoot.querySelector('input[placeholder="搜尋種類..."]') as HTMLInputElement;
    expect(input).toBeTruthy();
    // In happy-dom shadow root activeElement or document activeElement
    const active = shadowRoot.activeElement || document.activeElement;
    expect(active === input || input.matches(':focus')).toBe(true);
  });

  it('L. verifies runtime classes of Dialog controls match Foundation size contracts', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const searchInput = portalRoot.querySelector(
      'input[placeholder="搜尋種類..."]',
    ) as HTMLInputElement;
    expect(searchInput.className).toContain('h-[var(--control-height-default,2rem)]');
    expect(searchInput.className).not.toContain('h-8');

    const typeBtn = portalRoot.querySelector('[data-selected="true"]') as HTMLButtonElement;
    expect(typeBtn).toBeTruthy();
    expect(typeBtn.className).toContain('h-[var(--control-height-sm,1.75rem)]');
    expect(typeBtn.className).not.toContain('h-auto');
  });

  it('M. emits type-dialog-open-changed on open and close, without dispatching global poexd-modal-active-changed', async () => {
    const emittedStates: boolean[] = [];
    const globalModalEvents: boolean[] = [];

    const removeGlobalListener = listenPoeEvent('poexd-modal-active-changed', (detail) => {
      globalModalEvents.push(detail);
    });

    await mountFilterPane({
      onTypeDialogOpenChanged: (isOpen: boolean) => {
        emittedStates.push(isOpen);
      },
    });

    expect(emittedStates).toEqual([]);
    expect(globalModalEvents).toEqual([]);

    dispatchPoeEvent('poexd-trigger-select-type-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    expect(emittedStates).toEqual([true]);
    expect(globalModalEvents).toEqual([]);

    const closeBtn = portalRoot.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    expect(emittedStates).toEqual([true, false]);
    expect(globalModalEvents).toEqual([]);

    removeGlobalListener();
  });
});
