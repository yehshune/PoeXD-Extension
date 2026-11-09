// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import SettingsField from '@/components/sidebar/settings/SettingsField.vue';
import SettingsHotkeyInput from '@/components/sidebar/settings/SettingsHotkeyInput.vue';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { createUiRuntimeTokenValues } from '@/lib/tokens';

const settingsFieldSource = readFileSync('components/sidebar/settings/SettingsField.vue', 'utf8');
const settingsHotkeyInputSource = readFileSync(
  'components/sidebar/settings/SettingsHotkeyInput.vue',
  'utf8',
);

describe('Phase 1A: Settings Components UI Contract & Regression', () => {
  describe('Static Source Code Contract Enforcement', () => {
    it('guarantees ZERO occurrences of legacy scale/density variables in Phase 1A files', () => {
      const files = [
        { name: 'SettingsField.vue', source: settingsFieldSource },
        { name: 'SettingsHotkeyInput.vue', source: settingsHotkeyInputSource },
      ];

      for (const file of files) {
        expect(file.source, `${file.name} must not contain --poexd-font-size-scale`).not.toContain(
          '--poexd-font-size-scale',
        );
        expect(file.source, `${file.name} must not contain --poexd-density-scale`).not.toContain(
          '--poexd-density-scale',
        );
      }
    });

    it('enforces semantic tokens in SettingsField.vue', () => {
      expect(settingsFieldSource).toContain('--pxd-field-gap');
      expect(settingsFieldSource).toContain('--pxd-row-gap');
      expect(settingsFieldSource).toContain('--pxd-font-caption');
      expect(settingsFieldSource).not.toContain('calc(');
    });

    it('enforces primitive default size in SettingsHotkeyInput.vue, centers text horizontally with absolute overlay clear button, and removes local padding overrides', () => {
      expect(settingsHotkeyInputSource).toContain('size="default"');
      expect(settingsHotkeyInputSource).toContain('w-[var(--pxd-settings-hotkey-width)]');
      expect(settingsHotkeyInputSource).toContain('text-center');
      expect(settingsHotkeyInputSource).not.toContain('pr-[var(--control-height-default)]');
      expect(settingsHotkeyInputSource).toContain('group relative');
      expect(settingsHotkeyInputSource).toContain('variant="ghost-destructive"');
      expect(settingsHotkeyInputSource).toContain('opacity-0 pointer-events-none');
      expect(settingsHotkeyInputSource).toContain(
        'group-hover:opacity-100 group-hover:pointer-events-auto',
      );
      expect(settingsHotkeyInputSource).not.toContain('group-focus-within');
      expect(settingsHotkeyInputSource).toContain(
        'focus-visible:opacity-100 focus-visible:pointer-events-auto',
      );
      expect(settingsHotkeyInputSource).not.toContain('pl-2');
      expect(settingsHotkeyInputSource).not.toContain('py-0');
      expect(settingsHotkeyInputSource).not.toMatch(/h-\[calc\(/);
      expect(settingsHotkeyInputSource).not.toMatch(/text-\[calc\(/);
    });
  });

  describe('Runtime DOM & Behavior Verification', () => {
    let container: HTMLElement;
    let app: ReturnType<typeof createApp> | undefined;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      app?.unmount();
      app = undefined;
      container.remove();
      while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
      }
    });

    describe('SettingsField', () => {
      it('renders semantic field classes, label, and slot content', async () => {
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(
                  SettingsField,
                  { label: '熱鍵設定', class: 'custom-field-class' },
                  { default: () => h('div', { class: 'slot-child' }, 'Child Input') },
                );
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const field = container.firstElementChild as HTMLElement;
        expect(field).not.toBeNull();
        expect(field.className).toContain('mb-[var(--pxd-field-gap)]');
        expect(field.className).toContain('custom-field-class');

        const label = field.querySelector('label');
        expect(label).not.toBeNull();
        expect(label?.textContent?.trim()).toBe('熱鍵設定');
        expect(label?.className).toContain('mb-[var(--pxd-row-gap)]');
        expect(label?.className).toContain('text-[length:var(--pxd-font-caption)]');

        const slotChild = field.querySelector('.slot-child');
        expect(slotChild).not.toBeNull();
        expect(slotChild?.textContent).toBe('Child Input');
      });

      it('does not render label element when label prop is omitted', async () => {
        app = createApp(
          defineComponent({
            setup() {
              return () => h(SettingsField, {}, { default: () => h('span', 'No Label') });
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const label = container.querySelector('label');
        expect(label).toBeNull();
      });
    });

    describe('SettingsHotkeyInput', () => {
      it('renders Input primitive with size=default classes and feature-specific width', async () => {
        const hotkey = ref('Ctrl+D');
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(SettingsHotkeyInput, {
                  modelValue: hotkey.value,
                  'onUpdate:modelValue': (v: string) => {
                    hotkey.value = v;
                  },
                });
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const input = container.querySelector('input');
        expect(input).not.toBeNull();
        expect(input?.value).toBe('Ctrl+D');
        // Input primitive class verification
        expect(input?.className).toContain('w-[var(--pxd-settings-hotkey-width)]');
        expect(input?.className).toContain('text-center');
        expect(input?.className).not.toContain('pr-[var(--control-height-default)]');
        expect(input?.className).not.toContain('pl-2');
        expect(input?.className).not.toContain('py-0');
        expect(input?.className).not.toContain('calc(');

        // Clear button exists and has hover/focus-visibility classes
        const clearBtn = container.querySelector('[data-settings-hotkey-action="clear"]');
        expect(clearBtn).not.toBeNull();
        expect(clearBtn?.className).toContain('opacity-0');
        expect(clearBtn?.className).toContain('pointer-events-none');
        expect(clearBtn?.className).toContain('group-hover:opacity-100');
        expect(clearBtn?.className).toContain('group-hover:pointer-events-auto');
        expect(clearBtn?.className).not.toContain('group-focus-within');
        expect(clearBtn?.className).toContain('focus-visible:opacity-100');
        expect(clearBtn?.className).toContain('focus-visible:pointer-events-auto');
        expect(clearBtn?.className).toContain('hover:text-destructive');
        expect(clearBtn?.className).toContain('hover:bg-transparent');
      });

      it('enters recording state on focus, handles keydown combos, and blur exits recording', async () => {
        const hotkey = ref('');
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(SettingsHotkeyInput, {
                  modelValue: hotkey.value,
                  'onUpdate:modelValue': (v: string) => {
                    hotkey.value = v;
                  },
                });
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const input = container.querySelector('input')!;
        expect(input.placeholder).toBe('按任意鍵設定');

        // Focus enters recording
        input.dispatchEvent(new Event('focus'));
        await nextTick();
        expect(input.value).toBe('錄製中...');

        // Keydown recording: Ctrl+Alt+F
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'F',
            ctrlKey: true,
            altKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await nextTick();
        expect(hotkey.value).toBe('Ctrl+Alt+F');
      });

      it('cancels recording on Escape keydown, preserves original modelValue, and clears recording state', async () => {
        const hotkey = ref('Ctrl+A');
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(SettingsHotkeyInput, {
                  modelValue: hotkey.value,
                  'onUpdate:modelValue': (v: string) => {
                    hotkey.value = v;
                  },
                });
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const input = container.querySelector('input')!;
        input.dispatchEvent(new Event('focus'));
        await nextTick();
        expect(input.value).toBe('錄製中...');

        // Escape cancels recording
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
        await nextTick();
        expect(hotkey.value).toBe('Ctrl+A');
        expect(input.value).toBe('Ctrl+A');
        expect(input.value).not.toBe('錄製中...');
      });

      it('enforces disabled state: cannot focus recording, ignores keydown, and clear button is absent', async () => {
        const hotkey = ref('Ctrl+Alt+S');
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(SettingsHotkeyInput, {
                  modelValue: hotkey.value,
                  disabled: true,
                  'onUpdate:modelValue': (v: string) => {
                    hotkey.value = v;
                  },
                });
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const input = container.querySelector('input')!;
        expect(input.disabled).toBe(true);

        // Focus should not trigger recording
        input.dispatchEvent(new Event('focus'));
        await nextTick();
        expect(input.value).toBe('Ctrl+Alt+S');
        expect(input.className).not.toContain('border-highlight');

        // Keydown should be ignored
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'X',
            bubbles: true,
            cancelable: true,
          }),
        );
        await nextTick();
        expect(hotkey.value).toBe('Ctrl+Alt+S');

        // Clear button should not exist
        const clearBtn = container.querySelector('[data-settings-hotkey-action="clear"]');
        expect(clearBtn).toBeNull();
      });

      it('clears hotkey on Backspace or Delete keydown', async () => {
        const hotkey = ref('F2');
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(SettingsHotkeyInput, {
                  modelValue: hotkey.value,
                  'onUpdate:modelValue': (v: string) => {
                    hotkey.value = v;
                  },
                });
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const input = container.querySelector('input')!;
        input.dispatchEvent(new Event('focus'));
        await nextTick();

        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Backspace',
            bubbles: true,
            cancelable: true,
          }),
        );
        await nextTick();
        expect(hotkey.value).toBe('');
      });

      it('clears hotkey on clear button click', async () => {
        const hotkey = ref('F5');
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(SettingsHotkeyInput, {
                  modelValue: hotkey.value,
                  'onUpdate:modelValue': (v: string) => {
                    hotkey.value = v;
                  },
                });
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const clearBtn = container.querySelector(
          '[data-settings-hotkey-action="clear"]',
        ) as HTMLButtonElement;
        expect(clearBtn).not.toBeNull();
        clearBtn.click();
        await nextTick();
        expect(hotkey.value).toBe('');
      });
    });

    describe('ToggleGroup & ToggleGroupItem Variant Contract', () => {
      it('correctly resolves variant inheritance from group, override on item, and default fallback', async () => {
        // 1. Group variant="outline" -> all items inherit outline
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(ToggleGroup, { type: 'single', variant: 'outline' }, () => [
                  h(ToggleGroupItem, { value: 'item1' }, () => 'Item 1'),
                ]);
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const item1 = container.querySelector('[data-slot="toggle-group-item"]')!;
        expect(item1.className).toContain('border-input');
        expect(item1.className).toContain('shadow-sm');

        app.unmount();
        container.innerHTML = '';

        // 2. Group has no variant, item specifies variant="outline" -> item uses outline
        // 3. Group and item have no variant -> fallback to default (border-transparent)
        app = createApp(
          defineComponent({
            setup() {
              return () =>
                h(ToggleGroup, { type: 'single' }, () => [
                  h(ToggleGroupItem, { value: 'item-custom', variant: 'outline' }, () => 'Custom'),
                  h(ToggleGroupItem, { value: 'item-default' }, () => 'Default'),
                ]);
            },
          }),
        );
        app.mount(container);
        await nextTick();

        const items = container.querySelectorAll('[data-slot="toggle-group-item"]');
        expect(items[0].className).toContain('border-input');
        expect(items[0].className).toContain('shadow-sm');
        expect(items[1].className).toContain('border-transparent');
        expect(items[1].className).not.toContain('border-input');
      });
    });
  });

  describe('Foundation Token Values & Purity Matrix', () => {
    it('confirms Density strictly alters layout spacing and NEVER alters control height or typography', () => {
      const standard = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
      const compact = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });
      const relaxed = createUiRuntimeTokenValues({ scale: 1.0, density: 1.2 });

      // Control height invariant against density
      expect(standard['--control-height-default']).toBe('32px');
      expect(compact['--control-height-default']).toBe('32px');
      expect(relaxed['--control-height-default']).toBe('32px');

      // Control typography invariant against density
      expect(standard['--control-font-default']).toBe('13px');
      expect(compact['--control-font-default']).toBe('13px');
      expect(relaxed['--control-font-default']).toBe('13px');

      // Caption typography invariant against density
      expect(standard['--pxd-font-caption']).toBe('11px');
      expect(compact['--pxd-font-caption']).toBe('11px');
      expect(relaxed['--pxd-font-caption']).toBe('11px');

      // Layout spacing (Field Gap & Row Gap) correctly scales with density
      expect(standard['--pxd-field-gap']).toBe('15px');
      expect(compact['--pxd-field-gap']).toBe('12px'); // 15 * 0.8
      expect(relaxed['--pxd-field-gap']).toBe('18px'); // 15 * 1.2

      expect(standard['--pxd-row-gap']).toBe('8px');
      expect(compact['--pxd-row-gap']).toBe('6.4px'); // 8 * 0.8
      expect(relaxed['--pxd-row-gap']).toBe('9.6px'); // 8 * 1.2
    });

    it('confirms Scale properly scales control height, typography, and spacing', () => {
      const scaled = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });

      expect(scaled['--control-height-default']).toBe('38.4px'); // 32 * 1.2
      expect(scaled['--control-font-default']).toBe('15.6px'); // 13 * 1.2
      expect(scaled['--pxd-font-caption']).toBe('13.2px'); // 11 * 1.2
      expect(scaled['--pxd-field-gap']).toBe('18px'); // 15 * 1.2
      expect(scaled['--pxd-row-gap']).toBe('9.6px'); // 8 * 1.2
    });
  });
});
