// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import {
  executeCriteriaOverlayOps,
  initCriteriaOverlayAdapter,
  readCriteriaOverlaySnapshot,
} from '@/entrypoints/main-world/criteria-overlay-adapter';
import {
  parsePoeCriteriaOverlayCommitResult,
  parsePoeCriteriaOverlayReadResult,
  serializePoeCriteriaOverlayCommit,
  serializePoeCriteriaOverlayRead,
} from '@/utils/event-protocol-types';
import type { CriteriaOverlayOp } from '@/utils/criteria-overlay';

function createStore() {
  const persistent = {
    id: 'x',
    tab: 'search',
    name: null,
    type: 'Gold Ring',
    disc: null,
    term: null,
    status: 'securable',
    league: 'Standard',
    filters: { type_filters: { filters: { rarity: { option: 'rare' } } } },
    stats: [{ type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 1 } }] }],
  };
  Object.defineProperty(persistent.stats[0].filters[0], 'poexdCategory', {
    value: 'ring',
    enumerable: false,
  });
  return { state: { persistent, transient: {} }, commit: vi.fn(), _withCommit: vi.fn() };
}

describe('readCriteriaOverlaySnapshot', () => {
  it('copies only criteria fields and drops non-enumerable extension metadata', () => {
    const snapshot = readCriteriaOverlaySnapshot(createStore() as any);
    expect(Object.keys(snapshot ?? {})).toEqual([
      'name',
      'type',
      'disc',
      'term',
      'status',
      'filters',
      'stats',
    ]);
    expect((snapshot as any).stats[0].filters[0]).toEqual({
      id: 'explicit.stat_1',
      value: { min: 1 },
    });
  });

  it('returns null without a store', () => {
    expect(readCriteriaOverlaySnapshot(null)).toBeNull();
  });
});

describe('executeCriteriaOverlayOps', () => {
  const ops: CriteriaOverlayOp[] = [
    { kind: 'setItem', item: { name: null, type: 'Vaal Regalia', disc: null, term: null } },
    { kind: 'setStatus', status: 'online' },
    {
      kind: 'setPropertyFilter',
      group: 'misc_filters',
      index: 'corrupted',
      value: { option: 'false' },
    },
    { kind: 'setPropertyFilter', group: 'trade_filters', index: 'price', value: null },
    { kind: 'setPropertyFilterGroupDisabled', group: 'misc_filters', disable: false },
    { kind: 'pushStatGroup', type: 'count', filters: [{ id: 'explicit.stat_2' }] },
    { kind: 'setStatGroupValue', group: 1, value: { min: 1 } },
    { kind: 'setStatGroupDisabled', group: 1, disable: true },
    { kind: 'removeStatGroup', group: 1 },
  ];

  it('maps every op to the official mutation and saves through the root component', () => {
    const store = createStore();
    const root = { save: vi.fn(), setPropertyFilterGroupDisabled: vi.fn() };
    executeCriteriaOverlayOps(store as any, root, ops);

    expect(store.commit.mock.calls).toEqual([
      ['setItem', { name: null, type: 'Vaal Regalia', disc: null, term: null }],
      ['setStatus', 'online'],
      [
        'setPropertyFilter',
        { group: 'misc_filters', index: 'corrupted', value: { option: 'false' } },
      ],
      ['setPropertyFilter', { group: 'trade_filters', index: 'price', value: {} }],
      ['pushStatGroup', { type: 'count', filters: [{ id: 'explicit.stat_2' }] }],
      ['setStatGroupValue', { group: 1, value: { min: 1 } }],
      ['setFilterGroupDisabled', { type: 'stats', group: 1, disable: true }],
      ['removeStatGroup', { group: 1 }],
    ]);
    expect(root.setPropertyFilterGroupDisabled).toHaveBeenCalledWith({
      group: 'misc_filters',
      disable: false,
    });
    expect(root.save).toHaveBeenCalledWith(true);
  });

  it('rewrites a group in place by removing its filters back to front and re-adding them', () => {
    const store = createStore();
    store.state.persistent.stats[0].filters.push({ id: 'explicit.stat_9', value: { min: 2 } });
    executeCriteriaOverlayOps(store as any, null, [
      {
        kind: 'setStatGroupFilters',
        group: 0,
        filters: [{ id: 'explicit.stat_1' }, { id: 'mercenary.skill_1' }],
      },
    ]);
    expect(store.commit.mock.calls.slice(0, 4)).toEqual([
      ['removeStatFilter', { group: 0, index: 1 }],
      ['removeStatFilter', { group: 0, index: 0 }],
      ['setStatFilter', { group: 0, value: { id: 'explicit.stat_1' } }],
      ['setStatFilter', { group: 0, value: { id: 'mercenary.skill_1' } }],
    ]);
  });

  it('restores the form and still saves when a mutation throws midway', () => {
    const store = createStore();
    store._withCommit.mockImplementation((fn: () => void) => fn());
    store.commit.mockImplementation((type: string) => {
      if (type === 'setStatus') {
        store.state.persistent.type = 'Vaal Regalia';
        throw new Error('boom');
      }
    });
    const root = { save: vi.fn() };

    expect(() => executeCriteriaOverlayOps(store as any, root, ops)).toThrow('boom');
    expect(store._withCommit).toHaveBeenCalledTimes(1);
    expect(store.state.persistent.type).toBe('Gold Ring');
    expect(store.state.persistent.stats).toEqual([
      { type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 1 } }] },
    ]);
    expect(root.save).toHaveBeenCalledWith(true);
  });

  it('falls back to raw mutations and the dirty flag without a root component', () => {
    const store = createStore();
    executeCriteriaOverlayOps(store as any, null, [ops[4]]);
    expect(store.commit.mock.calls).toEqual([
      ['setFilterGroupDisabled', { type: 'filters', group: 'misc_filters', disable: false }],
      ['setSearchDirty', undefined],
    ]);
  });
});

describe('initCriteriaOverlayAdapter', () => {
  let listeners: Map<string, (payload: any) => void>;
  let dispatched: Array<[string, any]>;
  let bridge: MainWorldBridge;
  let teardown: (() => void) | null = null;
  let store: ReturnType<typeof createStore>;
  let root: { save: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    listeners = new Map();
    dispatched = [];
    bridge = {
      dispatchEvent: (type: string, payload: any) => dispatched.push([type, payload]),
      addListener: (type: string, handler: (payload: any) => void) => {
        listeners.set(type, handler);
        return () => listeners.delete(type);
      },
    } as unknown as MainWorldBridge;
    store = createStore();
    root = { save: vi.fn() };
    document.body.innerHTML = '<div id="trade"></div>';
    const el = document.querySelector('#trade') as any;
    el.__vue_app__ = {
      config: { globalProperties: { $store: store } },
      _container: { _vnode: { component: { proxy: root } } },
    };
    teardown = initCriteriaOverlayAdapter(bridge);
  });

  afterEach(() => {
    teardown?.();
    document.body.innerHTML = '';
  });

  it('answers a read request with the form snapshot', () => {
    listeners.get('poexd-criteria-overlay-read')!(
      serializePoeCriteriaOverlayRead({ requestId: 'r1' }),
    );
    const [type, payload] = dispatched[0];
    expect(type).toBe('poexd-criteria-overlay-read-result');
    const result = parsePoeCriteriaOverlayReadResult(payload);
    expect(result?.requestId).toBe('r1');
    expect((result?.snapshot as any).type).toBe('Gold Ring');
  });

  it('executes a valid commit and reports success', () => {
    listeners.get('poexd-criteria-overlay-commit')!(
      serializePoeCriteriaOverlayCommit({
        requestId: 'c1',
        ops: [{ kind: 'setStatus', status: 'online' }],
      }),
    );
    expect(store.commit).toHaveBeenCalledWith('setStatus', 'online');
    expect(root.save).toHaveBeenCalledWith(true);
    expect(parsePoeCriteriaOverlayCommitResult(dispatched[0][1])).toEqual({
      requestId: 'c1',
      success: true,
    });
  });

  it('ignores commits containing ops outside the whitelist', () => {
    listeners.get('poexd-criteria-overlay-commit')!(
      JSON.stringify({ requestId: 'c2', ops: [{ kind: 'clearSearchForm' }] }),
    );
    expect(store.commit).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });
});
