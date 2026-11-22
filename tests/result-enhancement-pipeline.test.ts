import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResultEnhancementPipeline,
  type ResultEnhancement,
} from '@/entrypoints/content/logic/result-enhancement-pipeline';
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
    disconnected = false;
    constructor(readonly callback: (mutations: any[]) => void) {
      observers.push(this);
    }
    observe(target: unknown) {
      this.target = target;
    }
    disconnect() {
      this.disconnected = true;
    }
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

describe('ResultEnhancementPipeline', () => {
  it('observes the stable body before results exist and initializes a later result root', () => {
    let results: FakeElement | null = null;
    const dom = setupDom(() => results);
    const highlighter: ResultEnhancement = { scope: 'always', apply: vi.fn() };
    const pipeline = new ResultEnhancementPipeline({
      version: 'poe1',
      enhancements: [highlighter],
    });

    pipeline.init();
    const bodyObserver = dom.observers.find((observer) => observer.target === dom.body);
    expect(bodyObserver).toBeDefined();

    results = new FakeElement('results');
    const wrapper = new FakeElement('wrapper');
    wrapper.resultRoot = results;
    bodyObserver.callback([{ addedNodes: [wrapper] }]);
    dom.flushFrame();

    expect(highlighter.apply).toHaveBeenCalledWith(results);
    pipeline.cleanup();
  });

  it('processes only a newly added live-search row and skips search-normal enhancements', () => {
    const results = new FakeElement('results');
    const dom = setupDom(() => results);
    const pricePresenter: ResultEnhancement = {
      scope: 'search-normal',
      apply: vi.fn(),
      setPageMode: vi.fn(),
    };
    const highlighter: ResultEnhancement = { scope: 'always', apply: vi.fn() };
    const pipeline = new ResultEnhancementPipeline({
      version: 'poe1',
      enhancements: [pricePresenter, highlighter],
    });
    pipeline.setPageMode('live');
    expect(pricePresenter.setPageMode).toHaveBeenCalledWith('live');

    pipeline.init();
    dom.flushFrame();
    vi.mocked(pricePresenter.apply).mockClear();
    vi.mocked(highlighter.apply).mockClear();

    const row = new FakeElement('row');
    row.ownerResults = results;
    const bodyObserver = dom.observers.find((observer) => observer.target === dom.body);
    bodyObserver.callback([{ addedNodes: [row] }]);
    dom.flushFrame();

    expect(highlighter.apply).toHaveBeenCalledWith(row);
    expect(pricePresenter.apply).not.toHaveBeenCalled();

    pipeline.setPageMode('search');
    dom.flushFrame();
    expect(pricePresenter.apply).toHaveBeenCalledWith(results);
    pipeline.cleanup();
  });

  it('ignores extension annotation mutations and rows outside results', () => {
    const results = new FakeElement('results');
    const dom = setupDom(() => results);
    const highlighter: ResultEnhancement = { scope: 'always', apply: vi.fn() };
    const pipeline = new ResultEnhancementPipeline({
      version: 'poe1',
      enhancements: [highlighter],
    });
    pipeline.init();
    dom.flushFrame();
    vi.mocked(highlighter.apply).mockClear();

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
    pipeline.cleanup();
  });

  it('skips recently reordered rows while still enhancing newly added rows in batch order', () => {
    const results = new FakeElement('results');
    const dom = setupDom(() => results);
    const callOrder: string[] = [];
    const movedRow = new FakeElement('row');
    movedRow.ownerResults = results;
    const newRow = new FakeElement('row');
    newRow.ownerResults = results;

    const pricePresenter: ResultEnhancement = {
      scope: 'search-normal',
      apply: vi.fn(() => callOrder.push('price')),
    };
    const itemNormalizer: ResultEnhancement = {
      scope: 'search-normal',
      apply: vi.fn(),
      applyBatch: vi.fn(() => callOrder.push('normalizer:batch')),
    };
    const sortController: ResultEnhancement = {
      scope: 'search-normal',
      apply: vi.fn(),
      applyBatch: vi.fn(() => callOrder.push('sort:batch')),
    };
    const highlighter: ResultEnhancement = {
      scope: 'always',
      apply: vi.fn(() => callOrder.push('highlight')),
    };
    const pipeline = new ResultEnhancementPipeline({
      version: 'poe1',
      enhancements: [pricePresenter, itemNormalizer, sortController, highlighter],
      reorderGuard: {
        isReordering: false,
        isRecentlyMovedRow: (node: unknown) => node === movedRow,
      },
    });
    pipeline.init();
    dom.flushFrame();
    callOrder.length = 0;
    vi.mocked(pricePresenter.apply).mockClear();
    vi.mocked(highlighter.apply).mockClear();
    vi.mocked(itemNormalizer.applyBatch!).mockClear();
    vi.mocked(sortController.applyBatch!).mockClear();

    const bodyObserver = dom.observers.find((observer) => observer.target === dom.body);
    bodyObserver.callback([{ target: results, addedNodes: [movedRow, newRow] }]);
    dom.flushFrame();

    expect(pricePresenter.apply).toHaveBeenCalledTimes(1);
    expect(pricePresenter.apply).toHaveBeenCalledWith(newRow);
    expect(highlighter.apply).toHaveBeenCalledTimes(1);
    expect(highlighter.apply).toHaveBeenCalledWith(newRow);
    expect(itemNormalizer.applyBatch).toHaveBeenCalledWith([newRow]);
    expect(sortController.applyBatch).toHaveBeenCalledWith([newRow]);
    expect(callOrder).toEqual(['price', 'highlight', 'normalizer:batch', 'sort:batch']);
    pipeline.cleanup();
  });

  it('fans out applyPreferences, setPageRole, handleFetchResponse, handleSearchQuery, and cleanup without wiping state on init', async () => {
    const results = new FakeElement('results');
    const dom = setupDom(() => results);
    const events: string[] = [];

    const first: ResultEnhancement = {
      scope: 'search-normal',
      apply: vi.fn(),
      applyPreferences: async () => {
        await Promise.resolve();
        events.push('pref:1');
      },
      setPageRole: (role) => events.push(`role:1:${role}`),
      cleanup: () => events.push('cleanup:1'),
    };
    const second: ResultEnhancement = {
      scope: 'always',
      apply: vi.fn(),
      applyPreferences: () => {
        events.push('pref:2');
      },
      setPageRole: (role) => events.push(`role:2:${role}`),
      cleanup: () => events.push('cleanup:2'),
    };

    const onFetchResponse = vi.fn(async (_detail, league) => {
      events.push(`fetch:${league}`);
    });
    const onSearchQuery = vi.fn((searchId) => {
      events.push(`query:${searchId}`);
    });

    const pipeline = new ResultEnhancementPipeline({
      version: 'poe1',
      enhancements: [first, second],
      onFetchResponse,
      onSearchQuery,
    });

    await pipeline.applyPreferences({} as any);
    pipeline.setPageRole('live-search-primary');
    // init() 只重設 observer，不得觸發增強項目的 cleanup()
    pipeline.init();
    expect(events).toEqual([
      'pref:1',
      'pref:2',
      'role:1:live-search-primary',
      'role:2:live-search-primary',
    ]);

    await pipeline.handleFetchResponse('{"result":[]}', 'Standard');
    pipeline.handleSearchQuery('AbCd1234Ef', {});
    expect(events).toContain('fetch:Standard');
    expect(events).toContain('query:AbCd1234Ef');

    pipeline.cleanup();
    expect(dom.observers[0].disconnected).toBe(true);
    expect(events.slice(-2)).toEqual(['cleanup:1', 'cleanup:2']);
  });
});
