// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type PropType } from 'vue';
import { ConfigProvider } from 'reka-ui';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

describe('Real DOM Runtime Portal Isolation (happy-dom)', () => {
  let host: HTMLElement;
  let shadowRoot: ShadowRoot;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    shadowRoot.appendChild(appRoot);
    shadowRoot.appendChild(portalRoot);
  });

  afterEach(() => {
    host.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('teleports Dialog content into portalRoot and leaves document.body unpolluted when portalTarget is provided', async () => {
    const isDialogOpen = ref(false);
    const TestComponent = defineComponent({
      props: {
        portalTarget: {
          type: Object as PropType<HTMLElement | null>,
          default: null,
        },
      },
      setup(props) {
        return () =>
          h(
            ConfigProvider,
            { teleportTo: props.portalTarget ?? undefined, scrollBody: false },
            () => [
              h(
                Dialog,
                {
                  open: isDialogOpen.value,
                  'onUpdate:open': (v: boolean) => (isDialogOpen.value = v),
                },
                () => [
                  h(DialogTrigger, () => 'Trigger'),
                  h(DialogContent, () => [
                    h(DialogTitle, () => 'Shadow Dialog Title'),
                    h(DialogDescription, () => 'Shadow Dialog Description'),
                  ]),
                ],
              ),
            ],
          );
      },
    });

    const app = createApp(TestComponent, { portalTarget: portalRoot });
    app.mount(appRoot);

    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(document.body.querySelector('[data-slot="dialog-content"]')).toBeNull();

    // Open Dialog
    isDialogOpen.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Assert it mounted in portalRoot inside Shadow Root
    const dialogInPortal = portalRoot.querySelector('[data-slot="dialog-content"]');
    expect(dialogInPortal).not.toBeNull();
    expect(dialogInPortal?.textContent).toContain('Shadow Dialog Title');

    // Assert document.body outside Shadow host has NO dialog content
    const dialogInBody = Array.from(document.body.children).filter(
      (el) => el !== host && el.querySelector('[data-slot="dialog-content"]'),
    );
    expect(dialogInBody).toHaveLength(0);

    app.unmount();
  });

  it('teleports DropdownMenu content into portalRoot and leaves document.body unpolluted when portalTarget is provided', async () => {
    const isDropdownOpen = ref(false);
    const TestDropdownComponent = defineComponent({
      props: {
        portalTarget: {
          type: Object as PropType<HTMLElement | null>,
          default: null,
        },
      },
      setup(props) {
        return () =>
          h(
            ConfigProvider,
            { teleportTo: props.portalTarget ?? undefined, scrollBody: false },
            () => [
              h(
                DropdownMenu,
                {
                  open: isDropdownOpen.value,
                  'onUpdate:open': (v: boolean) => (isDropdownOpen.value = v),
                },
                () => [
                  h(DropdownMenuTrigger, () => 'Menu Trigger'),
                  h(DropdownMenuContent, () => [h(DropdownMenuItem, () => 'Shadow MenuItem')]),
                ],
              ),
            ],
          );
      },
    });

    const app = createApp(TestDropdownComponent, { portalTarget: portalRoot });
    app.mount(appRoot);

    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    // Open Dropdown
    isDropdownOpen.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Assert it mounted in portalRoot inside Shadow Root
    const menuInPortal = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(menuInPortal).not.toBeNull();
    expect(menuInPortal?.textContent).toContain('Shadow MenuItem');

    // Assert document.body outside Shadow host has NO menu content
    const menuInBody = Array.from(document.body.children).filter(
      (el) => el !== host && el.querySelector('[data-slot="dropdown-menu-content"]'),
    );
    expect(menuInBody).toHaveLength(0);

    app.unmount();
  });

  it('falls back to document.body when portalTarget is NOT provided (default fallback)', async () => {
    const isDialogOpen = ref(false);
    const FallbackComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: undefined, scrollBody: false }, () => [
            h(
              Dialog,
              {
                open: isDialogOpen.value,
                'onUpdate:open': (v: boolean) => (isDialogOpen.value = v),
              },
              () => [
                h(DialogTrigger, () => 'Fallback Trigger'),
                h(DialogContent, () => [
                  h(DialogTitle, () => 'Fallback Dialog Title'),
                  h(DialogDescription, () => 'Fallback Dialog Description'),
                ]),
              ],
            ),
          ]);
      },
    });

    const app = createApp(FallbackComponent);
    app.mount(appRoot);

    // Open Dialog without portalTarget
    isDialogOpen.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Without portalRoot specified, Reka UI falls back to document.body
    const dialogInBody = document.body.querySelector('[data-slot="dialog-content"]');
    expect(dialogInBody).not.toBeNull();
    expect(dialogInBody?.textContent).toContain('Fallback Dialog Title');

    // portalRoot should NOT contain it
    expect(portalRoot.querySelector('[data-slot="dialog-content"]')).toBeNull();

    app.unmount();
  });

  describe('Trigger wrapper asChild vs direct reset separation', () => {
    it('applies native button reset classes when DropdownMenuTrigger is used directly without asChild', async () => {
      const TestComponent = defineComponent({
        setup() {
          return () => h(DropdownMenu, () => [h(DropdownMenuTrigger, () => 'Direct Trigger')]);
        },
      });

      const app = createApp(TestComponent);
      app.mount(appRoot);
      await nextTick();

      const trigger = appRoot.querySelector('button');
      expect(trigger).not.toBeNull();
      expect(trigger?.className).toContain('border-none');
      expect(trigger?.className).toContain('bg-transparent');
      expect(trigger?.className).toContain('h-[var(--control-height-sm,1.75rem)]');
      expect(trigger?.className).toContain('px-[var(--button-padding-x-sm,12px)]');
      expect(trigger?.className).toContain('focus-visible:ring-1');
      expect(trigger?.className).toContain('m-0');
      expect(trigger?.className).toContain('appearance-none');
      expect(trigger?.className).toContain('font-[inherit]');
      expect(trigger?.className).toContain('cursor-pointer');

      app.unmount();
    });

    it('does NOT apply trigger reset classes onto child Button when DropdownMenuTrigger is used with asChild', async () => {
      const TestComponent = defineComponent({
        setup() {
          return () =>
            h(DropdownMenu, () => [
              h(DropdownMenuTrigger, { asChild: true }, () =>
                h(Button, { variant: 'outline' }, () => 'Button Trigger'),
              ),
            ]);
        },
      });

      const app = createApp(TestComponent);
      app.mount(appRoot);
      await nextTick();

      const button = appRoot.querySelector('button');
      expect(button).not.toBeNull();
      // Child Button's own styling is intact
      expect(button?.className).toContain('border-input');
      expect(button?.className).toContain('bg-background');
      expect(button?.className).toContain('border-solid');
      // Trigger reset classes MUST NOT be merged onto the child Button
      expect(button?.className).not.toContain('border-none');
      expect(button?.className).not.toContain('bg-transparent');
      expect(button?.className).not.toContain('px-[var(--button-padding-x-sm,12px)]');

      app.unmount();
    });

    it('applies native reset to DialogTrigger only when direct and not with asChild', async () => {
      const DirectComponent = defineComponent({
        setup() {
          return () => h(Dialog, () => [h(DialogTrigger, () => 'Direct Dialog Trigger')]);
        },
      });
      const app1 = createApp(DirectComponent);
      app1.mount(appRoot);
      await nextTick();

      const directBtn = appRoot.querySelector('button');
      expect(directBtn?.className).toContain('border-none');
      expect(directBtn?.className).toContain('bg-transparent');
      expect(directBtn?.className).toContain('h-[var(--control-height-sm,1.75rem)]');
      expect(directBtn?.className).toContain('px-[var(--button-padding-x-sm,12px)]');
      expect(directBtn?.className).toContain('focus-visible:ring-1');
      app1.unmount();

      const AsChildComponent = defineComponent({
        setup() {
          return () =>
            h(Dialog, () => [
              h(DialogTrigger, { asChild: true }, () =>
                h(Button, { variant: 'default' }, () => 'Dialog Button'),
              ),
            ]);
        },
      });
      const app2 = createApp(AsChildComponent);
      app2.mount(appRoot);
      await nextTick();

      const childBtn = appRoot.querySelector('button');
      expect(childBtn?.className).toContain('bg-primary');
      expect(childBtn?.className).not.toContain('border-none');
      expect(childBtn?.className).not.toContain('bg-transparent');
      app2.unmount();
    });

    it('applies native reset to DialogClose only when direct and not with asChild', async () => {
      const DirectClose = defineComponent({
        setup() {
          return () => h(Dialog, { open: true }, () => [h(DialogClose, () => 'Close Direct')]);
        },
      });
      const app1 = createApp(DirectClose);
      app1.mount(appRoot);
      await nextTick();

      const directBtn = appRoot.querySelector('button');
      expect(directBtn?.className).toContain('border-none');
      expect(directBtn?.className).toContain('bg-transparent');
      expect(directBtn?.className).toContain('p-0');
      app1.unmount();

      const AsChildClose = defineComponent({
        setup() {
          return () =>
            h(Dialog, { open: true }, () => [
              h(DialogClose, { asChild: true }, () =>
                h(Button, { variant: 'secondary' }, () => 'Cancel'),
              ),
            ]);
        },
      });
      const app2 = createApp(AsChildClose);
      app2.mount(appRoot);
      await nextTick();

      const childBtn = appRoot.querySelector('button');
      expect(childBtn?.className).toContain('bg-secondary');
      expect(childBtn?.className).not.toContain('border-none');
      expect(childBtn?.className).not.toContain('bg-transparent');
      expect(childBtn?.className).not.toContain('p-0');
      app2.unmount();
    });
  });

  describe('DropdownMenu Non-Modal Contract & Scroll Lock Protection', () => {
    it('defaults modal=false and does not lock body scroll or overflow when open', async () => {
      const isDropdownOpen = ref(false);
      const Component = defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot }, () => [
              h(
                DropdownMenu,
                {
                  open: isDropdownOpen.value,
                  'onUpdate:open': (v: boolean) => (isDropdownOpen.value = v),
                },
                () => [
                  h(DropdownMenuTrigger, () => 'Trigger Non-Modal'),
                  h(DropdownMenuContent, () => [h(DropdownMenuItem, () => 'Item 1')]),
                ],
              ),
            ]);
        },
      });

      const app = createApp(Component);
      app.mount(appRoot);
      await nextTick();

      // Open Dropdown
      isDropdownOpen.value = true;
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // Assert Dropdown opened
      expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
      // Assert document.body is not locked
      expect(document.body.style.overflow).not.toBe('hidden');
      expect(document.body.getAttribute('data-scroll-locked')).toBeNull();

      app.unmount();
    });

    it('allows consumer to explicitly override modal=true', async () => {
      const isDropdownOpen = ref(false);
      const Component = defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot }, () => [
              h(
                DropdownMenu,
                {
                  modal: true,
                  open: isDropdownOpen.value,
                  'onUpdate:open': (v: boolean) => (isDropdownOpen.value = v),
                },
                () => [
                  h(DropdownMenuTrigger, () => 'Trigger Modal Override'),
                  h(DropdownMenuContent, () => [h(DropdownMenuItem, () => 'Modal Item')]),
                ],
              ),
            ]);
        },
      });

      const app = createApp(Component);
      app.mount(appRoot);
      await nextTick();

      isDropdownOpen.value = true;
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
      app.unmount();
    });
  });
});
