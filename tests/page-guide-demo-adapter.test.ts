// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  createPageGuideDemo,
  pickDemoStatId,
} from '@/entrypoints/main-world/page-guide-demo-adapter';
import {
  parsePoePageGuideDemo,
  parsePoePageGuideDemoResult,
  serializePoePageGuideDemo,
  serializePoePageGuideDemoResult,
} from '@/utils/event-protocol-types';

vi.mock('@/entrypoints/main-world/poe-runtime-reader', () => ({
  getVueStore: () => null,
  readKnownStatIds: () => ['explicit.stat_3299347043', 'explicit.stat_1'],
}));

function createStore(advancedSearchHidden = false) {
  const transient = { advancedSearchHidden };
  const persistent = {
    name: null,
    type: null,
    disc: null,
    term: null,
    status: 'online',
    filters: {},
    stats: [] as unknown[],
  };
  const store = {
    state: { persistent, transient },
    commit: vi.fn((mutation: string, payload: unknown) => {
      if (mutation === 'pushStatGroup') persistent.stats.push(payload);
      if (mutation === 'toggleSearch') {
        transient.advancedSearchHidden = !transient.advancedSearchHidden;
      }
    }),
    _withCommit: vi.fn((fn: () => void) => fn()),
  };
  return store;
}

describe('pickDemoStatId', () => {
  it('prefers the life stat when the site knows it', () => {
    expect(pickDemoStatId(['explicit.stat_1', 'explicit.stat_3299347043'])).toBe(
      'explicit.stat_3299347043',
    );
  });

  it('falls back to the first explicit stat', () => {
    expect(pickDemoStatId(['implicit.stat_9', 'explicit.stat_7'])).toBe('explicit.stat_7');
  });

  it('uses the preferred id before the stat list has loaded', () => {
    expect(pickDemoStatId(null)).toBe('explicit.stat_3299347043');
  });

  it('gives up when there is no explicit stat at all', () => {
    expect(pickDemoStatId(['implicit.stat_9'])).toBeNull();
  });
});

describe('createPageGuideDemo', () => {
  it('pushes one stat group and restores the previous stats without saving', () => {
    const store = createStore();
    const demo = createPageGuideDemo(() => store as never);

    demo.addStatFilter();
    expect(store.commit).toHaveBeenCalledWith('pushStatGroup', {
      type: 'and',
      filters: [{ id: 'explicit.stat_3299347043', value: {}, disabled: false }],
    });
    expect(demo.isActive()).toBe(true);

    demo.restore();
    expect(store._withCommit).toHaveBeenCalled();
    expect(store.state.persistent.stats).toEqual([]);
    expect(store.commit).not.toHaveBeenCalledWith('save', expect.anything());
    expect(demo.isActive()).toBe(false);
  });

  it('keeps the first snapshot when the filter is added twice', () => {
    const store = createStore();
    const demo = createPageGuideDemo(() => store as never);
    demo.addStatFilter();
    demo.addStatFilter();
    demo.restore();
    expect(store.state.persistent.stats).toEqual([]);
  });

  it('opens a collapsed filter panel and collapses it again on restore', () => {
    const store = createStore(true);
    const demo = createPageGuideDemo(() => store as never);

    demo.addStatFilter();
    expect(store.state.transient.advancedSearchHidden).toBe(false);

    demo.restore();
    expect(store.state.transient.advancedSearchHidden).toBe(true);
    expect(store.state.persistent.stats).toEqual([]);
    expect(demo.isActive()).toBe(false);
  });

  it('leaves an already open panel alone', () => {
    const store = createStore(false);
    const demo = createPageGuideDemo(() => store as never);
    demo.showFilters();
    expect(demo.isActive()).toBe(false);
    demo.restore();
    expect(store.commit).not.toHaveBeenCalledWith('toggleSearch', undefined);
  });

  it('fails clearly without the official store', () => {
    const demo = createPageGuideDemo(() => null);
    expect(() => demo.addStatFilter()).toThrow('FORM_STATE_NOT_FOUND');
    expect(() => demo.restore()).not.toThrow();
  });
});

describe('page guide demo protocol', () => {
  it('round-trips requests and results', () => {
    const request = { requestId: 'r1', action: 'add-stat-filter' as const };
    expect(parsePoePageGuideDemo(serializePoePageGuideDemo(request))).toEqual(request);
    const result = { requestId: 'r1', success: false, error: 'X' };
    expect(parsePoePageGuideDemoResult(serializePoePageGuideDemoResult(result))).toEqual(result);
  });

  it('rejects malformed payloads', () => {
    expect(parsePoePageGuideDemo('{"requestId":"r","action":"save"}')).toBeUndefined();
    expect(parsePoePageGuideDemo('{"requestId":"r","action":"show-filters"}')).toEqual({
      requestId: 'r',
      action: 'show-filters',
    });
    expect(parsePoePageGuideDemo('not json')).toBeUndefined();
    expect(parsePoePageGuideDemoResult('{"requestId":1}')).toBeUndefined();
  });
});
