// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.pathofexile.com/trade/search/Covens" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import PinnedItemPane from '@/components/sidebar/pinned-items/PinnedItemPane.vue';
import PinnedItemCardView from '@/components/sidebar/pinned-items/PinnedItemCardView.vue';
import { GOLD_COIN_ICON_URL } from '@/utils/poe-cdn-url';
import { createPinnedItemSnapshot } from '@/utils/pinned-items';
import { PRICE_COMPARISON_CURRENCIES } from '@/utils/price-comparison';

const { mockList, mockFetchCurrencyRates, prefState, prefListeners } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockFetchCurrencyRates: vi.fn(async () => ({
    primary: 'chaos',
    rates: { chaos: 1, divine: 200, exalted: 15 },
  })),
  prefState: { enablePriceComparison: true },
  prefListeners: new Set<(snapshot: { enablePriceComparison: boolean }) => void>(),
}));

vi.mock('@/utils/preferences', () => ({
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      read: () => ({ enablePriceComparison: prefState.enablePriceComparison }),
      subscribe: (listener: (snapshot: { enablePriceComparison: boolean }) => void) => {
        prefListeners.add(listener);
        listener({ enablePriceComparison: prefState.enablePriceComparison });
        return () => prefListeners.delete(listener);
      },
    },
  })),
}));

vi.mock('@/entrypoints/content/logic/result-price-presenter', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/entrypoints/content/logic/result-price-presenter')>();
  return {
    ...actual,
    fetchCurrencyRates: mockFetchCurrencyRates,
  };
});

vi.mock('@/utils/pinned-item-client', () => ({
  createPinnedItemClient: () => ({
    list: mockList,
    subscribe: () => () => {},
    pin: vi.fn(async () => ({ ok: true })),
    unpin: vi.fn(async () => ({ ok: true })),
    reorder: vi.fn(async () => ({ ok: true })),
    clear: vi.fn(async () => ({ ok: true })),
    markSold: vi.fn(async () => ({ ok: true })),
    clearSold: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('@/utils/trade-context', () => ({
  getPoeVersion: () => 'poe1',
  getTradeLeague: () => 'Covens',
}));

function makeSnapshot(id: string, fee?: number, priceAmount = 300) {
  return createPinnedItemSnapshot(
    {
      id,
      item: { name: 'Loath Visor', typeLine: 'Destroyer Regalia', frameType: 2 },
      listing: {
        hideout_token: 'tok',
        ...(fee !== undefined ? { fee } : {}),
        account: { name: 'Seller#1234' },
        price: { amount: priceAmount, currency: 'chaos' },
      },
    },
    { gameVersion: 'poe1', origin: 'https://www.pathofexile.com', league: 'Covens' },
    100,
  )!;
}

describe('PinnedItemPane gold fee, price comparison toggle & mod range display', () => {
  let container: HTMLElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    prefState.enablePriceComparison = true;
    prefListeners.clear();
    mockFetchCurrencyRates.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    container.remove();
  });

  const flush = async () => {
    for (let i = 0; i < 4; i += 1) {
      await nextTick();
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  it('displays listing fee with official gold coin CDN icon when expanded and hides fee when zero or absent', async () => {
    mockList.mockResolvedValue([makeSnapshot('with-fee', 12450), makeSnapshot('no-fee')]);

    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    const rows = container.querySelectorAll<HTMLElement>('.pinned-item-row');
    expect(rows).toHaveLength(2);

    rows[0].querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    rows[1].querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();

    const expandedWrapper = rows[0].firstElementChild!;
    expect(
      expandedWrapper.firstElementChild?.hasAttribute('data-pinned-item-expanded-header'),
    ).toBe(true);

    const feeEl = rows[0].querySelector<HTMLElement>('[data-pinned-item-fee]');
    const feeIcon = rows[0].querySelector<HTMLImageElement>('[data-pinned-item-fee-icon]');
    expect(feeEl).not.toBeNull();
    expect(feeEl?.textContent).toContain('手續費：');
    expect(feeEl?.textContent).toContain('12,450');
    expect(feeIcon?.getAttribute('src')).toBe(GOLD_COIN_ICON_URL);

    expect(rows[1].querySelector('[data-pinned-item-fee]')).toBeNull();
  });

  it('respects enablePriceComparison preference and renders official currency CDN icon', async () => {
    mockList.mockResolvedValue([makeSnapshot('cmp-1', 348, 300)]);

    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();

    const conv = container.querySelector<HTMLElement>('[data-pinned-item-price-conversion]');
    const convIcon = container.querySelector<HTMLImageElement>(
      '[data-pinned-item-price-conversion-icon]',
    );
    expect(mockFetchCurrencyRates).toHaveBeenCalledTimes(1);
    expect(conv?.textContent).toContain('≈ 1.5');
    expect(conv?.className).toContain('leading-none');
    expect(convIcon?.className).toContain('block');
    expect(convIcon?.getAttribute('src')).toBe(PRICE_COMPARISON_CURRENCIES.divine.icon);

    // Toggle preference off -> converted badge hides immediately
    prefState.enablePriceComparison = false;
    prefListeners.forEach((fn) => fn({ enablePriceComparison: false }));
    await flush();

    expect(container.querySelector('[data-pinned-item-price-conversion]')).toBeNull();

    // Toggle preference back on -> badge returns
    prefState.enablePriceComparison = true;
    prefListeners.forEach((fn) => fn({ enablePriceComparison: true }));
    await flush();

    expect(container.querySelector('[data-pinned-item-price-conversion]')).not.toBeNull();
  });

  it('does not fetch currency rates on mount when enablePriceComparison starts disabled', async () => {
    prefState.enablePriceComparison = false;
    mockList.mockResolvedValue([makeSnapshot('cmp-off', undefined, 300)]);

    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    expect(mockFetchCurrencyRates).not.toHaveBeenCalled();

    container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();

    expect(container.querySelector('[data-pinned-item-price-conversion]')).toBeNull();
  });

  it('reveals .lc.l and .d mod numerical ranges inline in PinnedItemCardView shadow DOM', async () => {
    const snap = makeSnapshot('mod-range');
    snap.card = {
      icon: { t: 'div', c: 'newItemContainer' },
      popup: [
        {
          t: 'div',
          c: 'item-popup',
          k: [
            {
              t: 'div',
              c: 'item-popup__content',
              k: [
                {
                  t: 'div',
                  c: 'item-mod',
                  k: [
                    {
                      t: 'span',
                      c: 's lc',
                      f: 'stat.explicit.stat_3489782002',
                      k: [{ t: 'span', k: ['+10 最大能量護盾'] }],
                    },
                    {
                      t: 'span',
                      c: 'lc l pr',
                      k: ['P10', { t: 'span', c: 'd', k: [' [9—12]'] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const app = createApp({
      render: () => h(PinnedItemCardView, { snapshot: snap, collapsed: false, part: 'popup' }),
    });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    const hostEl = container.firstElementChild as HTMLElement;
    const shadow = hostEl.shadowRoot!;
    const styleText = shadow.querySelector('style')?.textContent ?? '';
    expect(styleText).toContain('#trade .item-popup .item-mod > .lc.l .d');
    expect(styleText).toContain(
      'grid-template-columns: minmax(auto, 1fr) minmax(0, auto) minmax(auto, 1fr)',
    );
    expect(styleText).toContain('grid-column: 1');
    expect(styleText).toContain('grid-column: 2');
    expect(styleText).toContain('display: inline');
    expect(styleText).toContain('position: static');

    const rangeNode = shadow.querySelector('.item-mod .lc.l .d');
    expect(rangeNode?.textContent).toContain('[9—12]');
  });
});
