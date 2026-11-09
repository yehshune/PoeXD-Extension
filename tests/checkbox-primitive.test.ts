// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { Checkbox } from '@/components/ui/checkbox';
import { FORM_INDICATOR_SPECS } from '@/lib/tokens';

describe('Checkbox Primitive Baseline Contract', () => {
  it('1. unchecked state renders neutral border and bg without primary accent or indicator', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = createApp(
      defineComponent({
        setup() {
          const checked = ref(false);
          return () => h(Checkbox, { modelValue: checked.value, 'data-testid': 'cb' });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const root = container.querySelector('[data-slot="checkbox"]') as HTMLButtonElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-state')).toBe('unchecked');

    // Baseline classes: neutral border-input and bg-background, sizing from FORM_INDICATOR_SPECS
    expect(root.className).toContain('border-input');
    expect(root.className).toContain('bg-background');
    expect(root.className).toContain(FORM_INDICATOR_SPECS.checkbox.sizeClass);
    expect(root.className).toContain('hover:bg-accent');
    expect(root.className).toContain('focus-visible:ring-ring');

    // No primary accent on outer root
    expect(root.className).not.toContain('border-primary');
    expect(root.className).not.toContain('bg-primary');
    expect(root.className).not.toContain('data-[state=checked]:bg-primary');

    // No indicator mounted when unchecked
    const indicator = root.querySelector('[data-slot="checkbox-indicator"]');
    expect(indicator).toBeNull();

    app.unmount();
    container.remove();
  });

  it('2. checked state retains neutral outer border/bg and renders inset primary square indicator without Check icon', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = createApp(
      defineComponent({
        setup() {
          const checked = ref(true);
          return () => h(Checkbox, { modelValue: checked.value, 'data-testid': 'cb' });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const root = container.querySelector('[data-slot="checkbox"]') as HTMLButtonElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-state')).toBe('checked');

    // Outer root remains neutral
    expect(root.className).toContain('border-input');
    expect(root.className).toContain('bg-background');
    expect(root.className).not.toContain('border-primary');
    expect(root.className).not.toContain('bg-primary');

    // Indicator exists
    const indicator = root.querySelector('[data-slot="checkbox-indicator"]') as HTMLElement;
    expect(indicator).not.toBeNull();
    expect(indicator.getAttribute('data-state')).toBe('checked');

    // Inset indicator uses scale-aware indicatorClass, bg-primary, theme-derived small radius
    expect(indicator.className).toContain(FORM_INDICATOR_SPECS.checkbox.indicatorClass);
    expect(indicator.className).toContain('bg-primary');
    expect(indicator.className).toContain('rounded-[calc(var(--radius)*0.25)]');

    // Absolutely NO Check or SVG icon rendered
    expect(root.querySelector('svg')).toBeNull();
    expect(indicator.querySelector('svg')).toBeNull();

    app.unmount();
    container.remove();
  });

  it('3. switches between unchecked and checked on click interaction', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = createApp(
      defineComponent({
        setup() {
          const checked = ref(false);
          return () =>
            h(Checkbox, {
              modelValue: checked.value,
              'onUpdate:modelValue': (val: boolean | 'indeterminate') => {
                checked.value = val === true;
              },
            });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const root = container.querySelector('[data-slot="checkbox"]') as HTMLButtonElement;
    expect(root.getAttribute('data-state')).toBe('unchecked');
    expect(root.querySelector('[data-slot="checkbox-indicator"]')).toBeNull();

    // Click to check
    root.click();
    await nextTick();

    expect(root.getAttribute('data-state')).toBe('checked');
    const indicator = root.querySelector('[data-slot="checkbox-indicator"]');
    expect(indicator).not.toBeNull();
    expect(root.querySelector('svg')).toBeNull();

    // Click to uncheck
    root.click();
    await nextTick();
    await nextTick();

    expect(root.getAttribute('data-state')).toBe('unchecked');
    const uncheckedIndicator = root.querySelector('[data-slot="checkbox-indicator"]');
    // Indicator is either unmounted from DOM or hidden in unchecked state
    expect(
      uncheckedIndicator === null || uncheckedIndicator.getAttribute('data-state') === 'unchecked',
    ).toBe(true);

    app.unmount();
    container.remove();
  });

  it('4. preserves disabled state behavior', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = createApp(
      defineComponent({
        setup() {
          return () => h(Checkbox, { disabled: true });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const root = container.querySelector('[data-slot="checkbox"]') as HTMLButtonElement;
    expect(root.disabled).toBe(true);
    expect(root.className).toContain('disabled:cursor-not-allowed');
    expect(root.className).toContain('disabled:opacity-50');

    app.unmount();
    container.remove();
  });

  it('5. preserves indeterminate semantics and indicator styling contract', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = createApp(
      defineComponent({
        setup() {
          const state = ref<'indeterminate' | boolean>('indeterminate');
          return () => h(Checkbox, { modelValue: state.value });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const root = container.querySelector('[data-slot="checkbox"]') as HTMLButtonElement;
    expect(root.getAttribute('data-state')).toBe('indeterminate');

    const indicator = root.querySelector('[data-slot="checkbox-indicator"]') as HTMLElement;
    expect(indicator).not.toBeNull();
    expect(indicator.getAttribute('data-state')).toBe('indeterminate');
    expect(indicator.className).toContain('data-[state=indeterminate]:h-0.5');
    expect(indicator.querySelector('svg')).toBeNull();

    app.unmount();
    container.remove();
  });
});
