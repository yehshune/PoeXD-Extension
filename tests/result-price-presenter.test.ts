import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultPricePresenter } from '@/entrypoints/content/logic/result-price-presenter';

afterEach(() => vi.unstubAllGlobals());

describe('Result price presenter', () => {
  it('adds one image unit comparison to the row with the matching result id', async () => {
    let annotation: any;
    let renderedChildren: any[] = [];
    const priceField = {
      insertAdjacentElement: vi.fn((_position: string, element: any) => {
        annotation = element;
      }),
    };
    const price = {
      querySelector: vi.fn((selector: string) =>
        selector === '[data-field="price"]' ? priceField : annotation || null,
      ),
    };
    const row = {
      getAttribute: vi.fn((name: string) => (name === 'data-id' ? 'result-1' : null)),
      querySelector: vi.fn((selector: string) => (selector === '.price' ? price : null)),
    };
    const root = {
      querySelectorAll: vi.fn(() => [row]),
      matches: vi.fn(() => false),
    };
    const style = { id: '', textContent: '', remove: vi.fn() };
    const image = { className: '', src: '', alt: '', title: '' };
    const span = {
      className: '',
      setAttribute: vi.fn(),
      replaceChildren: vi.fn((...children: any[]) => {
        renderedChildren = children;
      }),
    };
    vi.stubGlobal('window', {
      location: { origin: 'https://www.pathofexile.com' },
    });
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => root),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
      createElement: vi.fn((tag: string) =>
        tag === 'span' ? span : tag === 'img' ? image : style,
      ),
      createTextNode: vi.fn((text: string) => ({ textContent: text })),
      head: { appendChild: vi.fn() },
    });
    const loadRates = vi.fn(async () => ({
      primary: 'chaos',
      rates: { chaos: 1, divine: 200 },
    }));
    const presenter = new ResultPricePresenter('poe1', loadRates, true);

    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade/fetch/result-1?query=search-1',
        data: {
          result: [
            {
              id: 'result-1',
              listing: { price: { amount: 200, currency: 'chaos' } },
            },
          ],
        },
      }),
      'Allflame',
    );
    presenter.apply(root as any);

    expect(loadRates).toHaveBeenCalledWith('Allflame');
    expect(priceField.insertAdjacentElement).toHaveBeenCalledWith('afterend', span);
    expect(style.textContent).toContain('background-color: var(--muted)');
    expect(style.textContent).toContain('border: 1px solid var(--border)');
    expect(style.textContent).not.toContain('color: var(--primary)');
    expect(style.textContent).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(renderedChildren[0].textContent).toBe('≈ 1 ');
    expect(renderedChildren[1]).toMatchObject({
      alt: '神聖石',
      title: '神聖石',
    });
    expect(renderedChildren[1].src).toContain('CurrencyModValues');

    await presenter.setEnabled(false);
    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade/fetch/result-1?query=search-2',
        data: {
          result: [
            {
              id: 'result-1',
              listing: { price: { amount: 400, currency: 'chaos' } },
            },
          ],
        },
      }),
      'Allflame',
    );
    expect(loadRates).toHaveBeenCalledTimes(1);

    await presenter.setEnabled(true);
    expect(loadRates).toHaveBeenCalledTimes(2);
    expect(renderedChildren[0].textContent).toBe('≈ 2 ');

    presenter.setPageMode('live');
    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade/fetch/result-1?query=search-3',
        data: {
          result: [
            {
              id: 'result-1',
              listing: { price: { amount: 600, currency: 'chaos' } },
            },
          ],
        },
      }),
      'Allflame',
    );
    expect(loadRates).toHaveBeenCalledTimes(2);

    presenter.setPageMode('search');
    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade/fetch/result-1?query=search-4',
        data: {
          result: [
            {
              id: 'result-1',
              listing: { price: { amount: 800, currency: 'chaos' } },
            },
          ],
        },
      }),
      'Allflame',
    );
    expect(loadRates).toHaveBeenCalledTimes(3);
  });

  it('getPrimaryPrice: 當標價幣種為基準幣時比率為 1，為其他幣種時乘上匯率', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://www.pathofexile.com' },
    });
    const loadRates = vi.fn(async () => ({
      primary: 'exalted',
      rates: { chaos: 0.1, divine: 15 },
    }));
    const presenter = new ResultPricePresenter('poe2', loadRates, true);

    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/item-ex,item-div,item-chaos?query=search-rates',
        data: {
          result: [
            {
              id: 'item-ex',
              listing: { price: { amount: 5, currency: 'exalted' } },
            },
            {
              id: 'item-div',
              listing: { price: { amount: 2, currency: 'divine' } },
            },
            {
              id: 'item-chaos',
              listing: { price: { amount: 50, currency: 'chaos' } },
            },
          ],
        },
      }),
      'Standard',
    );

    expect(presenter.getPrimaryPrice('item-ex')).toBe(5); // 5 * 1 (基準幣自指)
    expect(presenter.getPrimaryPrice('item-div')).toBe(30); // 2 * 15
    expect(presenter.getPrimaryPrice('item-chaos')).toBe(5); // 50 * 0.1
    expect(presenter.getPrimaryPrice('item-unknown')).toBeUndefined();
  });

  it('skips rates and annotations on realms without poe.ninja data (Taiwan / QQ)', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://pathofexile.tw' } });
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
    });
    const loadRates = vi.fn(async () => ({ primary: 'chaos', rates: { chaos: 1 } }));
    const presenter = new ResultPricePresenter('poe1', loadRates, false);

    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade/fetch/result-1?query=search-1',
        data: {
          result: [{ id: 'result-1', listing: { price: { amount: 5, currency: 'chaos' } } }],
        },
      }),
      '亡焰咒海',
    );
    await presenter.setEnabled(true);

    expect(loadRates).not.toHaveBeenCalled();
    expect(presenter.isEnabled()).toBe(false);
    expect(presenter.getPrimaryPrice('result-1')).toBeUndefined();
  });
});
