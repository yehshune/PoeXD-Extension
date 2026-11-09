// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createApp } from 'vue';
import { toggleVariants } from '@/components/ui/toggle';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

describe('Toggle & ToggleGroup Hover / Selected Visual Differentiation Contract', () => {
  it('enforces muted hover and accent selected tokens in toggleVariants outline variant', () => {
    const defaultClasses = toggleVariants({ variant: 'default' });
    const outlineClasses = toggleVariants({ variant: 'outline' });

    // Outline variant MUST use muted for hover, not standalone accent hover
    expect(outlineClasses).toContain('hover:bg-muted');
    expect(outlineClasses).toContain('hover:text-muted-foreground');
    expect(outlineClasses).not.toMatch(/(?:^|\s)hover:bg-accent(?:\s|$)/);
    expect(outlineClasses).not.toMatch(/(?:^|\s)hover:text-accent-foreground(?:\s|$)/);

    // Selected state MUST use accent
    expect(outlineClasses).toContain('data-[state=on]:bg-accent');
    expect(outlineClasses).toContain('data-[state=on]:text-accent-foreground');

    // When selected, hover MUST retain accent semantic styling and NOT degrade to muted
    expect(outlineClasses).toContain('data-[state=on]:hover:bg-accent');
    expect(outlineClasses).toContain('data-[state=on]:hover:text-accent-foreground');

    // Default variant preserves base hover muted
    expect(defaultClasses).toContain('hover:bg-muted');
    expect(defaultClasses).toContain('data-[state=on]:bg-accent');
  });

  it('renders ToggleGroup with outline variant inheriting distinctive muted hover and accent selected tokens', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = createApp({
      components: { ToggleGroup, ToggleGroupItem },
      template: `
        <ToggleGroup type="single" variant="outline" model-value="left">
          <ToggleGroupItem value="left">左側</ToggleGroupItem>
          <ToggleGroupItem value="right">右側</ToggleGroupItem>
        </ToggleGroup>
      `,
    });

    app.mount(container);

    const items = container.querySelectorAll<HTMLElement>('[data-slot="toggle-group-item"]');
    expect(items.length).toBe(2);

    // Both items must have outline classes with muted hover and accent selected
    items.forEach((item) => {
      expect(item.className).toContain('hover:bg-muted');
      expect(item.className).toContain('data-[state=on]:bg-accent');
      expect(item.className).toContain('data-[state=on]:hover:bg-accent');
      expect(item.className).not.toMatch(/(?:^|\s)hover:bg-accent(?:\s|$)/);
    });

    app.unmount();
    container.remove();
  });
});
