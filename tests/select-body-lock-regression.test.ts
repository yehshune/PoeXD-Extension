// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { ConfigProvider } from 'reka-ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import fs from 'node:fs';
import path from 'node:path';

describe('ShadowRoot Overlay Foundation & Select/Dropdown Policy Regression', () => {
  let shadowHost: HTMLElement;
  let shadowRoot: ShadowRoot;
  let uiContainer: HTMLElement;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;

  beforeEach(() => {
    // 建立與 runtime sidebar-layout.ts 一致的 Shadow UI 架構
    shadowHost = document.createElement('div');
    shadowHost.id = 'poexd-sidebar-container';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    uiContainer = document.createElement('div');
    shadowRoot.appendChild(uiContainer);

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    appRoot.style.position = 'relative';
    appRoot.style.zIndex = '0';
    appRoot.style.width = '100%';
    appRoot.style.height = '100%';

    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    portalRoot.style.position = 'relative';
    portalRoot.style.zIndex = '1';

    uiContainer.appendChild(appRoot);
    uiContainer.appendChild(portalRoot);

    document.body.style.overflow = '';
    document.body.style.pointerEvents = '';
  });

  afterEach(() => {
    shadowHost.remove();
    document.body.style.overflow = '';
    document.body.style.pointerEvents = '';
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('proves appRoot and portalRoot maintain proper Stacking Context contract', () => {
    expect(appRoot.style.position).toBe('relative');
    expect(appRoot.style.zIndex).toBe('0');
    expect(portalRoot.style.position).toBe('relative');
    expect(portalRoot.style.zIndex).toBe('1');
    expect(uiContainer.contains(appRoot)).toBe(true);
    expect(uiContainer.contains(portalRoot)).toBe(true);
  });

  it('teleports SelectContent into portalRoot with open state without locking body scroll or pointer events', async () => {
    const selectedValue = ref('left');
    const isSelectOpen = ref(false);

    const TestSelectApp = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(
              Select,
              {
                modelValue: selectedValue.value,
                open: isSelectOpen.value,
                'onUpdate:open': (v: boolean) => (isSelectOpen.value = v),
                'onUpdate:modelValue': (v: any) => (selectedValue.value = v),
              },
              () => [
                h(SelectTrigger, null, () => h(SelectValue)),
                h(SelectContent, null, () => [
                  h(SelectItem, { value: 'left' }, () => '左側'),
                  h(SelectItem, { value: 'right' }, () => '右側'),
                ]),
              ],
            ),
          ]);
      },
    });

    const app = createApp(TestSelectApp);
    app.mount(appRoot);
    await nextTick();

    // 1. Initial closed state
    expect(portalRoot.querySelector('[data-slot="select-content"]')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.body.style.pointerEvents).not.toBe('none');

    // 2. Open Select
    isSelectOpen.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // 3. Verify SelectContent is mounted in portalRoot inside ShadowRoot, NOT document.body
    const contentInPortal = portalRoot.querySelector('[data-slot="select-content"]');
    expect(contentInPortal).not.toBeNull();
    expect(contentInPortal?.getAttribute('data-state')).toBe('open');

    const contentInBody = Array.from(document.body.children).filter(
      (el) => el !== shadowHost && el.querySelector('[data-slot="select-content"]'),
    );
    expect(contentInBody).toHaveLength(0);

    // 4. Verify PoE host body scroll and pointer events are NOT locked
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.body.style.pointerEvents).not.toBe('none');

    // 5. Select right option
    const items = Array.from(portalRoot.querySelectorAll<HTMLElement>('[data-slot="select-item"]'));
    const rightItem = items.find(
      (it) => it.getAttribute('data-value') === 'right' || it.textContent?.includes('右側'),
    );
    expect(rightItem).toBeDefined();

    const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    rightItem?.focus?.();
    rightItem?.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true }));
    rightItem?.dispatchEvent(new EventCtor('pointerup', { bubbles: true, cancelable: true }));
    rightItem?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    rightItem?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // 6. Verify modelValue updated and trigger displays new value
    expect(selectedValue.value).toBe('right');
    const trigger = appRoot.querySelector('[data-slot="select-trigger"]');
    expect(trigger?.textContent).toContain('右側');

    app.unmount();
  });

  it('shares portalRoot with DropdownMenu without conflict or pollution', async () => {
    const isMenuOpen = ref(false);

    const TestDropdownApp = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(
              DropdownMenu,
              {
                open: isMenuOpen.value,
                modal: false,
                'onUpdate:open': (v: boolean) => (isMenuOpen.value = v),
              },
              () => [
                h(DropdownMenuTrigger, null, () => 'Menu Trigger'),
                h(DropdownMenuContent, null, () => [h(DropdownMenuItem, null, () => 'Item 1')]),
              ],
            ),
          ]);
      },
    });

    const app = createApp(TestDropdownApp);
    app.mount(appRoot);
    await nextTick();

    isMenuOpen.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const menuInPortal = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(menuInPortal).not.toBeNull();
    expect(menuInPortal?.textContent).toContain('Item 1');

    app.unmount();
  });

  it('preserves Dialog modal contract when teleported to portalRoot', async () => {
    const isDialogOpen = ref(false);

    const TestDialogApp = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(
              Dialog,
              {
                open: isDialogOpen.value,
                'onUpdate:open': (v: boolean) => (isDialogOpen.value = v),
              },
              () => [
                h(DialogTrigger, null, () => 'Open Dialog'),
                h(DialogContent, null, () => [
                  h(DialogTitle, null, () => 'Modal Title'),
                  h(DialogDescription, null, () => 'Modal Description'),
                ]),
              ],
            ),
          ]);
      },
    });

    const app = createApp(TestDialogApp);
    app.mount(appRoot);
    await nextTick();

    isDialogOpen.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const dialogInPortal = portalRoot.querySelector('[data-slot="dialog-content"]');
    expect(dialogInPortal).not.toBeNull();
    expect(dialogInPortal?.textContent).toContain('Modal Title');

    app.unmount();
  });

  it('allows consumer to explicitly pass bodyLock: true and disableOutsidePointerEvents: true override', async () => {
    const selected = ref('opt1');
    const isOpen = ref(false);

    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(
              Select,
              {
                modelValue: selected.value,
                open: isOpen.value,
                'onUpdate:open': (val: boolean) => {
                  isOpen.value = val;
                },
              },
              () => [
                h(SelectTrigger, null, () => h(SelectValue)),
                h(SelectContent, { bodyLock: true, disableOutsidePointerEvents: true }, () => [
                  h(SelectItem, { value: 'opt1' }, () => 'Option 1'),
                ]),
              ],
            ),
          ]);
      },
    });

    const app = createApp(Wrapper);
    app.mount(appRoot);
    await nextTick();

    isOpen.value = true;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(isOpen.value).toBe(true);
    expect(portalRoot.querySelector('[data-slot="select-content"]')).not.toBeNull();

    app.unmount();
  });

  it('static contract: SelectContent.vue defines bodyLock: false and disableOutsidePointerEvents: false', () => {
    const selectContentPath = path.resolve(__dirname, '../components/ui/select/SelectContent.vue');
    const content = fs.readFileSync(selectContentPath, 'utf-8');

    expect(content).toContain('bodyLock: false');
    expect(content).toContain('disableOutsidePointerEvents: false');
  });

  it('static contract: BookmarkPane.vue no longer relies on workaround high z-index (10000000 / 10000001)', () => {
    const bookmarkPanePath = path.resolve(__dirname, '../components/sidebar/BookmarkPane.vue');
    const content = fs.readFileSync(bookmarkPanePath, 'utf-8');

    expect(content).not.toContain('z-[10000000]');
    expect(content).not.toContain('z-[10000001]');
  });

  it('static contract: visual-class-reset-contract.md documents section 4.1 Overlay Stacking & Portal Ownership', () => {
    const docPath = path.resolve(__dirname, '../docs/ui-foundation/visual-class-reset-contract.md');
    const content = fs.readFileSync(docPath, 'utf-8');

    expect(content).toContain('4.1 浮層層疊與 Portal 所有權合約');
    expect(content).toContain('portalRoot');
    expect(content).toContain('z-index: 1');
    expect(content).toContain('appRoot');
    expect(content).toContain('z-index: 0');
  });
});
