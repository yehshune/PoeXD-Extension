import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomFilter } from '@/entrypoints/content/logic/dom-filter';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';

afterEach(() => vi.unstubAllGlobals());

class FakeElement {
  children: FakeElement[] = [];
  resultRoot?: FakeElement;
  ownerResults?: FakeElement;
  ownerRow?: FakeElement;
  style = { display: '', removeProperty: vi.fn() };
  classList = { contains: vi.fn(() => false), add: vi.fn() };

  constructor(readonly kind: 'wrapper' | 'results' | 'row' | 'annotation' | 'icon') {}

  matches(selector: string) {
    if (selector === TRADE_RESULTS_SELECTOR) return this.kind === 'results';
    if (selector === '.row') return this.kind === 'row';
    if (selector === '.poexd-price-comparison') return this.kind === 'annotation';
    return false;
  }

  querySelector(selector: string) {
    if (selector === TRADE_RESULTS_SELECTOR) return this.resultRoot;
    return null;
  }

  querySelectorAll(selector: string) {
    if (selector === '.row') return this.children.filter((child) => child.kind === 'row');
    return [];
  }

  closest(selector: string) {
    if (selector === `${TRADE_RESULTS_SELECTOR} .row`)
      return this.kind === 'row' ? this : this.ownerRow;
    if (selector === TRADE_RESULTS_SELECTOR && this.kind === 'row') return this.ownerResults;
    if (selector === '.poexd-price-comparison' && this.kind === 'annotation') return this;
    return null;
  }

  contains(element: FakeElement) {
    return this === element || this.children.includes(element);
  }
}

function setupDom(currentResults: () => FakeElement | null) {
  const body = new FakeElement('wrapper');
  const observers: any[] = [];
  const frames: FrameRequestCallback[] = [];

  class FakeMutationObserver {
    target?: unknown;
    constructor(readonly callback: (mutations: any[]) => void) {
      observers.push(this);
    }
    observe(target: unknown) {
      this.target = target;
    }
    disconnect() {}
  }

  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('MutationObserver', FakeMutationObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('document', {
    body,
    querySelector: (selector: string) =>
      selector === TRADE_RESULTS_SELECTOR ? currentResults() : null,
  });
  return {
    body,
    observers,
    flushFrame() {
      frames.splice(0).forEach((callback) => callback(0));
    },
  };
}

describe('DomFilter result lifecycle', () => {
  it('observes the stable body before results exist and initializes a later result root', async () => {
    let results: FakeElement | null = null;
    const dom = setupDom(() => results);
    const highlighter = { apply: vi.fn() };
    const filter = new DomFilter('poe1', undefined, highlighter as any);

    await filter.init();
    const bodyObserver = dom.observers.find((observer) => observer.target === dom.body);
    expect(bodyObserver).toBeDefined();

    results = new FakeElement('results');
    const wrapper = new FakeElement('wrapper');
    wrapper.resultRoot = results;
    bodyObserver.callback([{ addedNodes: [wrapper] }]);
    dom.flushFrame();

    expect(highlighter.apply).toHaveBeenCalledWith(results);
    filter.cleanup();
  });

  it('processes only a newly added live-search row and skips prices', async () => {
    const results = new FakeElement('results');
    const dom = setupDom(() => results);
    const pricePresenter = { apply: vi.fn() };
    const highlighter = { apply: vi.fn() };
    const filter = new DomFilter('poe1', pricePresenter as any, highlighter as any);
    filter.setPageMode('live');

    await filter.init();
    dom.flushFrame();
    pricePresenter.apply.mockClear();
    highlighter.apply.mockClear();

    const row = new FakeElement('row');
    row.ownerResults = results;
    const bodyObserver = dom.observers.find((observer) => observer.target === dom.body);
    bodyObserver.callback([{ addedNodes: [row] }]);
    dom.flushFrame();

    expect(highlighter.apply).toHaveBeenCalledWith(row);
    expect(pricePresenter.apply).not.toHaveBeenCalled();
    filter.setPageMode('search');
    dom.flushFrame();
    expect(pricePresenter.apply).toHaveBeenCalledWith(results);
    filter.cleanup();
  });

  it('ignores price annotation mutations and rows outside results', () => {
    const results = new FakeElement('results');
    const dom = setupDom(() => results);
    const highlighter = { apply: vi.fn() };
    const filter = new DomFilter('poe1', undefined, highlighter as any);
    filter.init();
    dom.flushFrame();
    highlighter.apply.mockClear();

    const row = new FakeElement('row');
    row.ownerResults = results;
    const annotation = new FakeElement('annotation');
    annotation.ownerRow = row;
    const icon = new FakeElement('icon');
    icon.ownerRow = row;
    const unrelatedRow = new FakeElement('row');
    const bodyObserver = dom.observers.find((observer) => observer.target === dom.body);
    bodyObserver.callback([
      { target: annotation, addedNodes: [icon] },
      { target: dom.body, addedNodes: [unrelatedRow] },
    ]);
    dom.flushFrame();

    expect(highlighter.apply).not.toHaveBeenCalled();
    filter.cleanup();
  });

  it('skips recently reordered rows while still enhancing newly added rows in the same batch', () => {
    const results = new FakeElement('results');
    const dom = setupDom(() => results);
    const highlighter = { apply: vi.fn() };
    const pricePresenter = { apply: vi.fn() };
    const movedRow = new FakeElement('row');
    movedRow.ownerResults = results;
    const newRow = new FakeElement('row');
    newRow.ownerResults = results;

    const itemNormalizer = {
      apply: vi.fn(),
      applyBatch: vi.fn(),
    };
    const sortController = {
      isReordering: false,
      isRecentlyMovedRow: vi.fn((node: unknown) => node === movedRow),
      apply: vi.fn(),
      applyBatch: vi.fn(),
    };
    const filter = new DomFilter(
      'poe1',
      pricePresenter as any,
      highlighter as any,
      itemNormalizer as any,
      undefined,
      undefined,
      undefined,
      sortController as any,
    );
    filter.init();
    dom.flushFrame();
    highlighter.apply.mockClear();
    pricePresenter.apply.mockClear();
    itemNormalizer.applyBatch.mockClear();
    sortController.applyBatch.mockClear();

    const bodyObserver = dom.observers.find((observer) => observer.target === dom.body);
    bodyObserver.callback([{ target: results, addedNodes: [movedRow, newRow] }]);
    dom.flushFrame();

    expect(pricePresenter.apply).toHaveBeenCalledTimes(1);
    expect(pricePresenter.apply).toHaveBeenCalledWith(newRow);
    expect(highlighter.apply).toHaveBeenCalledTimes(1);
    expect(highlighter.apply).toHaveBeenCalledWith(newRow);
    expect(itemNormalizer.applyBatch).toHaveBeenCalledTimes(1);
    expect(itemNormalizer.applyBatch).toHaveBeenCalledWith([newRow]);
    expect(sortController.applyBatch).toHaveBeenCalledTimes(1);
    expect(sortController.applyBatch).toHaveBeenCalledWith([newRow]);
    filter.cleanup();
  });
});
