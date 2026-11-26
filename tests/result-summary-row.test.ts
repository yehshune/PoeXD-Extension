// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import ResultPriceLabel from '@/components/sidebar/result-row/ResultPriceLabel.vue';
import ResultSummaryRow from '@/components/sidebar/result-row/ResultSummaryRow.vue';

const ICON = 'https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyRerollRare.png';

let app: App | undefined;

function mount(render: () => ReturnType<typeof h>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp({ render });
  app.mount(container);
  return container;
}

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

describe('ResultSummaryRow', () => {
  it('keeps the icon box even without an icon so rows align', () => {
    const container = mount(() =>
      h('ul', [
        h('li', { class: 'group' }, [h(ResultSummaryRow, { icon: ICON })]),
        h('li', { class: 'group' }, [h(ResultSummaryRow, {})]),
      ]),
    );
    const boxes = container.querySelectorAll('[data-result-row-icon]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.querySelector('img')?.getAttribute('src')).toBe(ICON);
    expect(boxes[1]!.querySelector('img')).toBeNull();
  });

  it('puts passed attributes on the clickable row and toggles on click and keys', async () => {
    let toggles = 0;
    const container = mount(() =>
      h(
        ResultSummaryRow,
        { 'data-row-toggle': '', expanded: true, onToggle: () => (toggles += 1) },
        { title: () => h('span', 'Name'), actions: () => h('button', { 'data-act': '' }) },
      ),
    );
    const row = container.querySelector<HTMLElement>('[data-row-toggle]')!;
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    row.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await nextTick();
    expect(toggles).toBe(3);
    expect(container.querySelector('[data-result-row-expanded-actions] [data-act]')).not.toBeNull();
  });

  it('hides the icon box when expanded and renders expanded-icon slot when provided', () => {
    const container = mount(() =>
      h('ul', [
        h('li', { class: 'group' }, [
          h(
            ResultSummaryRow,
            { icon: ICON, expanded: true },
            {
              'expanded-icon': () => h('div', { 'data-big-icon': '' }),
              actions: () => h('button', 'x'),
            },
          ),
        ]),
      ]),
    );
    expect(container.querySelector('[data-result-row-icon]')).toBeNull();
    expect(
      container.querySelector('[data-result-row-expanded-icon] [data-big-icon]'),
    ).not.toBeNull();
  });

  it('keeps the price visible on hover when expanded and gives the actions their own row', () => {
    const container = mount(() =>
      h('ul', [
        h('li', { class: 'group' }, [
          h(
            ResultSummaryRow,
            { icon: ICON, expanded: true },
            {
              price: () => h('span', { 'data-price': '' }, '5'),
              actions: () => h('button', { 'data-act': '' }),
            },
          ),
        ]),
      ]),
    );
    const price = container.querySelector<HTMLElement>('[data-result-row-price]')!;
    expect(price.querySelector('[data-price]')).not.toBeNull();
    expect(price.className).not.toContain('group-hover:opacity-0');
    // 操作浮在上方區域的右下角：不蓋住價格，也不在版面上預留一列
    const actions = container.querySelector<HTMLElement>('[data-result-row-expanded-actions]')!;
    expect(actions.contains(price)).toBe(false);
    expect(actions.className).toContain('absolute');
    expect(actions.className).toContain('bottom-[var(--pxd-space-md)]');
    expect(container.querySelector('[role="button"]')?.contains(actions)).toBe(false);
    expect(actions.className).toContain('group-hover:opacity-100');
    expect(actions.style.getPropertyValue('--pxd-hover-overlay-bg')).toContain('20%');
  });

  it('renders price below the title without hiding on hover and keeps actions in the hover overlay when collapsed', () => {
    const container = mount(() =>
      h('ul', [
        h('li', { class: 'group' }, [
          h(
            ResultSummaryRow,
            { icon: ICON },
            {
              title: () => h('span', { 'data-title': '' }, 'Name'),
              price: () => h('span', { 'data-price': '' }, '5'),
              actions: () => h('button', { 'data-act': '' }),
            },
          ),
        ]),
      ]),
    );
    const price = container.querySelector<HTMLElement>('[data-result-row-price]')!;
    expect(price.querySelector('[data-price]')).not.toBeNull();
    expect(price.className).not.toContain('group-hover:opacity-0');
    expect(container.querySelector('.pxd-hover-actions-overlay [data-act]')).not.toBeNull();
    expect(container.querySelector('[data-result-row-expanded-actions]')).toBeNull();
  });

  it('omits the actions overlay when there are no actions', () => {
    const container = mount(() => h(ResultSummaryRow, {}));
    expect(container.querySelector('.pxd-hover-actions-overlay')).toBeNull();
  });
});

describe('ResultPriceLabel', () => {
  it('shows the amount with the currency icon, or the currency code without one', () => {
    const container = mount(() =>
      h('div', [
        h(ResultPriceLabel, { amount: '3', currency: 'chaos', icon: ICON, 'data-a': '' }),
        h(ResultPriceLabel, { amount: '2', currency: 'divine', struck: true, 'data-b': '' }),
      ]),
    );
    const withIcon = container.querySelector('[data-a]')!;
    expect(withIcon.textContent?.trim()).toBe('3');
    expect(withIcon.querySelector('[data-result-price-icon]')?.getAttribute('title')).toBe('chaos');
    const withoutIcon = container.querySelector('[data-b]')!;
    expect(withoutIcon.textContent?.trim()).toBe('2 divine');
    expect(withoutIcon.classList.contains('line-through')).toBe(true);
  });
});
