// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import FilterPane from '@/components/sidebar/FilterPane.vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import {
  clearTierCategorySelectionTarget,
  getTierCategorySelectionTarget,
  registerTierSlotRefresher,
  setTierCategorySelectionTarget,
} from '@/utils/tier-slot-registry';
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '@/components/sidebar/composables/useDebouncedSearch';

const source = readFileSync('components/sidebar/FilterPane.vue', 'utf8');
const panelSource = readFileSync('components/sidebar/ItemTypeSelectorPanel.vue', 'utf8');
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

/** 種類搜尋框的防抖結束、畫面更新後再檢查 */
const waitForSearchDebounce = async () => {
  await new Promise((resolve) => setTimeout(resolve, DEFAULT_SEARCH_DEBOUNCE_MS + 20));
  await nextTick();
};

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

  it('L. uses optionsRootRef in ItemTypeSelectorPanel for scroll lookup instead of document', () => {
    expect(panelSource).toContain('optionsRootRef');
    expect(panelSource).toContain('optionsRootRef.value?.querySelector');
    expect(source).not.toContain("filterPaneRoot.value?.querySelector('.type-btn.selected')");
    expect(source).not.toContain("filterPaneRoot.value?.querySelector('.type-btn')");
    expect(source).not.toContain("document.querySelector('.type-btn.selected')");
  });

  it('preserves generic Dialog default dialog z-index token and provides overlayClass override API', () => {
    expect(dialogContentSource).toContain('z-(--pxd-z-dialog)');
    expect(dialogContentSource).toContain("overlayClass?: HTMLAttributes['class']");
    // 之後可能再多排除其他屬性（例如 inert），只要求 class 與 overlayClass 不往下傳
    expect(dialogContentSource).toMatch(/reactiveOmit\(props, 'class', 'overlayClass'[,)]/);
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

  it('configures Type Selector as Popover inside FilterPane and centered Dialog for external trigger', () => {
    // Retains centered placement without placement="inset"
    expect(source).not.toContain('placement="inset"');
    // Popover anchored below trigger inside FilterPane
    expect(source).toContain('<PopoverContent');
    expect(source).toContain('align="start"');
    expect(source).toContain('side="bottom"');
    // Bounded wide geometry for external Dialog
    expect(source).toContain('max-h-[82vh]');
    expect(source).toContain('max-w-[920px]');
    expect(source).toContain('w-[calc(100vw-32px)]');
    // Options root holds vertical scroll ownership in panel
    expect(panelSource).toContain('ref="optionsRootRef"');
    expect(panelSource).toMatch(/ref="optionsRootRef"[^>]*overflow-y-auto/);
  });

  it('ensures searchInputRef has type-safe ref and does not use as any', () => {
    expect(panelSource).not.toContain('searchInputRef.value as any');
    expect(panelSource).not.toContain('searchInputRef.value as');
    expect(panelSource).toContain('ref<HTMLInputElement | { $el?: HTMLInputElement } | null>');
  });

  it('conforms Selector controls and typography to Foundation primitives and semantic tokens', () => {
    // DialogTitle uses semantic section-title typography
    expect(source).toContain('text-[length:var(--pxd-font-section-title)]');
    expect(source).not.toContain('text-[calc(13px*var(--poexd-font-size-scale');

    // Search Input uses size="default"
    expect(panelSource).toMatch(/<Input[^>]*ref="searchInputRef"[^>]*size="default"/);
    expect(panelSource).not.toContain('h-8');

    // All option buttons use size="sm" without h-auto
    expect(panelSource).toMatch(/<Button[^>]*v-if="row\.mainOption"[^>]*size="sm"/);
    expect(panelSource).toMatch(/<Button[^>]*v-for="subOpt in row\.subOptions"[^>]*size="sm"/);
    expect(panelSource).toMatch(/<Button[^>]*v-for="opt in group\.singleOptions"[^>]*size="sm"/);

    // Fallback label aligns with size="sm" control height
    expect(panelSource).toContain('min-h-[var(--control-height-sm)]');
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
    clearTierCategorySelectionTarget();
  });

  afterEach(() => {
    if (app) {
      app.unmount();
    }
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
    clearTierCategorySelectionTarget();
    vi.restoreAllMocks();
  });

  it('A. opens Popover below item-type trigger button without modal overlay', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    expect(triggerBtn).toBeTruthy();

    expect(portalRoot.querySelector('[data-sidebar-dialog="affix-type"]')).toBeNull();

    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const content = portalRoot.querySelector(
      '[data-slot="popover-content"][data-sidebar-dialog="affix-type"]',
    );
    expect(content).toBeTruthy();
    expect(portalRoot.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(content?.className).toContain('z-(--pxd-z-floating)');
    expect(content?.className).toContain('data-[state=open]:zoom-in-95');
  });

  it('B. enforces Shadow Root portal contract: Popover content mounts into portalRoot, not outside host', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    // Content in portalRoot
    const portalContent = portalRoot.querySelector('[data-slot="popover-content"]');
    expect(portalContent).toBeTruthy();

    // Not inside FilterPane subtree
    const appContent = appRoot.querySelector('[data-slot="popover-content"]');
    expect(appContent).toBeNull();

    // Not in global document.body outside shadow host
    const directBodyContent = Array.from(document.body.children).find(
      (el) => el !== host && el.querySelector?.('[data-slot="popover-content"]'),
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

    // Filter for 弓（搜尋框有防抖，等防抖結束再檢查）
    searchInput.value = '弓';
    searchInput.dispatchEvent(new Event('input'));
    await waitForSearchDebounce();

    expect(portalRoot.textContent).toContain('弓');
    expect(portalRoot.textContent).not.toContain('頭盔');

    // Filter for non-existent
    searchInput.value = 'zzzzz_not_found';
    searchInput.dispatchEvent(new Event('input'));
    await waitForSearchDebounce();

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
    setTierCategorySelectionTarget(targetPayload);

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
      bindingId: '',
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
    setTierCategorySelectionTarget(targetPayload);

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
    expect(getTierCategorySelectionTarget()).toBeNull();

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

    setTierCategorySelectionTarget({
      slotKey: 'slot-test-key',
      groupIndex: 0,
      filterIndex: 0,
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
    await new Promise((r) => setTimeout(r, 10));

    expect(nativeTriggerClick).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('H. closes Dialog and does not dispatch poexd-close-affix-modal on Escape dismiss with selecting target', async () => {
    await mountFilterPane();

    setTierCategorySelectionTarget({
      groupIndex: 3,
      filterIndex: 1,
    });

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
    expect(getTierCategorySelectionTarget()).toBeNull();

    removeListener();
  });

  it('I. closes Dialog and does not dispatch poexd-close-affix-modal on built-in close button', async () => {
    await mountFilterPane();

    setTierCategorySelectionTarget({
      groupIndex: 2,
      filterIndex: 0,
    });

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
    expect(getTierCategorySelectionTarget()).toBeNull();

    removeListener();
  });

  it('enforces runtime stacking: external Type Dialog mounts with nested dialog layer token, while Popover uses floating token', async () => {
    await mountFilterPane();

    // Inside FilterPane: Popover uses floating layer
    const triggerBtn = appRoot.querySelector(
      '.custom-select-container button',
    ) as HTMLButtonElement;
    triggerBtn.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));

    const popoverContent = portalRoot.querySelector('[data-slot="popover-content"]') as HTMLElement;
    expect(popoverContent).toBeTruthy();
    expect(popoverContent.className).toContain('z-(--pxd-z-floating)');

    // Close Popover, then trigger external centered Dialog
    triggerBtn.click();
    await nextTick();
    dispatchPoeEvent('poexd-trigger-select-type-modal');
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

  it('N. toggles item-type Popover open and closed on repeated trigger pointer+click inside Shadow DOM', async () => {
    await mountFilterPane();

    const triggerBtn = appRoot.querySelector(
      '[data-filter-action="open-type-dialog"]',
    ) as HTMLButtonElement;
    expect(triggerBtn).toBeTruthy();

    const triggerLabel = triggerBtn.querySelector('span') as HTMLElement;
    expect(triggerLabel).toBeTruthy();

    const simulateShadowTriggerClick = async (target: HTMLElement) => {
      const PointerEventCtor = globalThis.PointerEvent ?? MouseEvent;
      // 模擬真實瀏覽器 Shadow DOM 事件跨越邊界冒泡至 document 時的 retargeting：
      // document 監聽到的 event.target 會被 retarget 成 shadow host，
      // 但同步階段的 composedPath() 仍包含實際被點擊的 trigger 元素。
      const pointerDownEvent = new PointerEventCtor('pointerdown', {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerType: 'mouse',
      });
      vi.spyOn(pointerDownEvent, 'composedPath').mockReturnValue([
        target,
        triggerBtn,
        shadowRoot,
        host,
        document.body,
        document,
      ]);
      host.dispatchEvent(pointerDownEvent);

      // 模擬點擊 focusable button 觸發的 focusin（同樣 retarget 至 shadow host，
      // 且在 DismissableLayer 兩次 nextTick 後 composedPath() 已為空陣列）
      triggerBtn.focus();
      const focusInEvent = new FocusEvent('focusin', {
        bubbles: true,
        composed: true,
      });
      vi.spyOn(focusInEvent, 'composedPath').mockReturnValue([]);
      host.dispatchEvent(focusInEvent);

      await nextTick();
      await nextTick();
      target.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 20));
    };

    // 1. 首次點擊打開 Popover
    await simulateShadowTriggerClick(triggerLabel);
    expect(
      portalRoot.querySelector('[data-slot="popover-content"][data-sidebar-dialog="affix-type"]'),
    ).toBeTruthy();

    // 2. 再次點擊同一顆按鈕應關閉 Popover，而不是先關再重開
    await simulateShadowTriggerClick(triggerLabel);
    expect(
      portalRoot.querySelector('[data-slot="popover-content"][data-sidebar-dialog="affix-type"]'),
    ).toBeNull();

    // 3. 第三次點擊應能再度打開，且點外部區域仍可正常關閉
    await simulateShadowTriggerClick(triggerBtn);
    expect(
      portalRoot.querySelector('[data-slot="popover-content"][data-sidebar-dialog="affix-type"]'),
    ).toBeTruthy();

    const PointerEventCtor = globalThis.PointerEvent ?? MouseEvent;
    const outsidePointerDown = new PointerEventCtor('pointerdown', {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerType: 'mouse',
    });
    vi.spyOn(outsidePointerDown, 'composedPath').mockReturnValue([
      appRoot,
      shadowRoot,
      host,
      document.body,
      document,
    ]);
    host.dispatchEvent(outsidePointerDown);
    await nextTick();
    await new Promise((r) => setTimeout(r, 20));
    expect(
      portalRoot.querySelector('[data-slot="popover-content"][data-sidebar-dialog="affix-type"]'),
    ).toBeNull();
  });

  it('將 cluster_jewel 父類別列為純標籤，僅開放點選巨型／中型／小型子類別', async () => {
    setTierCategorySelectionTarget({
      slotKey: 'tier-slot-cluster',
      groupIndex: 0,
      filterIndex: 0,
      bindingId: 'b-cluster',
      availableTypes: [
        'cluster_jewel',
        'large_cluster_jewel',
        'medium_cluster_jewel',
        'small_cluster_jewel',
      ],
      currentCategory: 'cluster_jewel',
    });

    await mountFilterPane();
    dispatchPoeEvent('poexd-trigger-select-type-modal');
    await nextTick();
    await nextTick();

    const dialog = portalRoot.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();

    const fallbackLabels = Array.from(dialog.querySelectorAll('.type-row-fallback-label')).map(
      (el) => el.textContent?.trim(),
    );
    expect(fallbackLabels).toContain('星團珠寶');

    const buttons = Array.from(dialog.querySelectorAll('button')).map((el) =>
      el.textContent?.trim(),
    );
    expect(buttons).not.toContain('星團珠寶');
    expect(buttons).toContain('巨型');
    expect(buttons).toContain('中型');
    expect(buttons).toContain('小型');
  });

  it('官方類別帶入 cluster_jewel 時自動落到巨型星團並顯示子類快切列，手動切換小型後不被父類覆蓋', async () => {
    mockModsData({
      int_cluster: [
        {
          id: 'explicit.stat_724930776',
          level: '1',
          types: ['cluster_jewel', 'large_cluster_jewel', 'medium_cluster_jewel'],
          affinities: ['cluster'],
          values: [['2', '3']],
        },
        {
          id: 'explicit.stat_724930776',
          level: '84',
          types: ['cluster_jewel', 'small_cluster_jewel'],
          affinities: ['cluster'],
          values: [['12', '14']],
        },
      ],
    });

    await mountFilterPane();
    dispatchPoeEvent('poexd-equipment-type-changed', { type: 'cluster_jewel' });
    await nextTick();
    await nextTick();

    const triggerBtn = appRoot.querySelector(
      '[data-filter-action="open-type-dialog"]',
    ) as HTMLButtonElement;
    expect(triggerBtn.textContent?.trim()).toBe('巨型星團珠寶');

    const quickSwitch = appRoot.querySelector('[data-slot="subtype-quick-switch"]') as HTMLElement;
    expect(quickSwitch).toBeTruthy();

    const smallBtn = quickSwitch.querySelector(
      '[data-subtype-key="small_cluster_jewel"]',
    ) as HTMLButtonElement;
    expect(smallBtn).toBeTruthy();
    smallBtn.click();
    await nextTick();
    expect(triggerBtn.textContent?.trim()).toBe('小型星團珠寶');

    // 官方類別再次上報泛用 cluster_jewel 時，不覆蓋已選好的小型星團珠寶
    dispatchPoeEvent('poexd-equipment-type-changed', { type: 'cluster_jewel' });
    await nextTick();
    expect(triggerBtn.textContent?.trim()).toBe('小型星團珠寶');

    // 已屬於同一官方主分類（jewel.cluster），不顯示多餘的「同步成星團珠寶」按鈕
    expect(appRoot.querySelector('[data-filter-action="sync-official-category"]')).toBeNull();
  });

  it('隱藏容器父類後，搜尋父類名稱（如劫盜裝備）仍可命中其子類別按鈕', async () => {
    setTierCategorySelectionTarget({
      slotKey: 'tier-slot-heist',
      groupIndex: 0,
      filterIndex: 0,
      bindingId: 'b-heist',
      availableTypes: [
        'heist_equipment',
        'heist_gear',
        'heist_tool',
        'heist_cloak',
        'heist_brooch',
      ],
      currentCategory: 'heist_gear',
    });

    await mountFilterPane();
    dispatchPoeEvent('poexd-trigger-select-type-modal');
    await nextTick();
    await nextTick();

    const dialog = portalRoot.querySelector('[role="dialog"]') as HTMLElement;
    const searchInput = dialog.querySelector('input[type="text"]') as HTMLInputElement;
    searchInput.value = '劫盜裝備';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForSearchDebounce();

    const buttons = Array.from(dialog.querySelectorAll('button')).map((el) =>
      el.textContent?.trim(),
    );
    expect(buttons).toContain('武器');
    expect(buttons).toContain('工具');
    expect(buttons).toContain('披風');
    expect(buttons).toContain('胸針');
  });
});
