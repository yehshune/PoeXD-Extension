// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import { initCriteriaOverlayAdapter } from '@/entrypoints/main-world/criteria-overlay-adapter';
import {
  executeCriteriaOverlayOps,
  readCriteriaOverlaySnapshot,
} from '@/entrypoints/main-world/main-world-search-form';
import { requestMainWorld } from '@/utils/cross-world-rpc';
import type { CriteriaOverlayOp } from '@/utils/criteria-overlay';
import { setupTestMainWorldBridge } from './helpers/main-world-bridge-harness';

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
    { kind: 'setStatFilter', group: 1, filter: { id: 'explicit.stat_4', disabled: false } },
    {
      kind: 'setStatFilter',
      group: 1,
      index: 0,
      filter: { id: 'explicit.stat_3', disabled: false },
    },
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
      ['setStatFilter', { group: 1, value: { id: 'explicit.stat_4', disabled: false } }],
      ['setStatFilter', { group: 1, index: 0, value: { id: 'explicit.stat_3', disabled: false } }],
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
  let bridge: MainWorldBridge;
  let teardown: (() => void) | null = null;
  let store: ReturnType<typeof createStore>;
  let root: { save: ReturnType<typeof vi.fn>; loaded?: boolean };

  beforeEach(() => {
    bridge = setupTestMainWorldBridge('criteria-overlay-adapter-nonce');
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

  it('answers a read request with the form snapshot over Cross-World RPC', async () => {
    const outcome = await requestMainWorld('criteria-overlay.read', undefined);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.data.snapshot as any).type).toBe('Gold Ring');
    }
  });

  it('replies only after the official async save() has written the URL', async () => {
    let finishSave!: () => void;
    root.save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    let settled = false;
    const pending = requestMainWorld('criteria-overlay.commit', {
      ops: [{ kind: 'setStatus', status: 'online' }],
    }).then((res) => {
      settled = true;
      return res;
    });
    await Promise.resolve();
    expect(root.save).toHaveBeenCalledWith(true);
    expect(settled).toBe(false);

    finishSave();
    const outcome = await pending;
    expect(outcome).toEqual({ ok: true, data: null });
  });

  it('executes a valid commit and reports success', async () => {
    const outcome = await requestMainWorld('criteria-overlay.commit', {
      ops: [{ kind: 'setStatus', status: 'online' }],
    });
    expect(store.commit).toHaveBeenCalledWith('setStatus', 'online');
    expect(root.save).toHaveBeenCalledWith(true);
    expect(outcome).toEqual({ ok: true, data: null });
  });

  describe('sync', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let updateUrl: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      updateUrl = vi.fn();
      (root as any).updateUrl = updateUrl;
    });
    afterEach(() => errorSpy.mockRestore());

    it('writes the URL with the official updateUrl() so the search is not marked dirty', async () => {
      let finishUpdate!: () => void;
      root.loaded = true;
      updateUrl.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishUpdate = () => {
              window.history.replaceState(null, '', '/trade/search/Standard/synced');
              resolve();
            };
          }),
      );
      let settled = false;
      const pending = requestMainWorld('criteria-overlay.sync', undefined).then((res) => {
        settled = true;
        return res;
      });
      await Promise.resolve();
      expect(updateUrl).toHaveBeenCalledOnce();
      expect(root.save).not.toHaveBeenCalled();
      expect(store.commit).not.toHaveBeenCalled();
      expect(settled).toBe(false);

      finishUpdate();
      const outcome = await pending;
      expect(outcome).toEqual({
        ok: true,
        data: { url: window.location.href },
      });
      expect(window.location.pathname).toBe('/trade/search/Standard/synced');
    });

    it('falls back to save(true) when the official page has no updateUrl()', async () => {
      (root as any).updateUrl = undefined;
      const outcome = await requestMainWorld('criteria-overlay.sync', undefined);
      expect(root.save).toHaveBeenCalledWith(true);
      expect(outcome).toMatchObject({ ok: true, data: { url: expect.any(String) } });
    });

    it('refuses to report success while the official page has not loaded', async () => {
      root.loaded = false;
      const outcome = await requestMainWorld('criteria-overlay.sync', undefined);
      expect(updateUrl).not.toHaveBeenCalled();
      expect(root.save).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({
        ok: false,
        code: 'PAGE_NOT_LOADED',
        error: 'PAGE_NOT_LOADED',
        diagnostics: {
          storeFound: true,
          rootFound: true,
          hasUpdateUrl: true,
          hasSave: true,
          loaded: false,
        },
      });
      expect(errorSpy).toHaveBeenCalled();
    });

    it('reports TRADE_ROOT_NOT_FOUND instead of silently skipping the URL write', async () => {
      (root as any).updateUrl = undefined;
      (root as any).save = undefined;
      const outcome = await requestMainWorld('criteria-overlay.sync', undefined);
      expect(outcome).toMatchObject({
        ok: false,
        code: 'TRADE_ROOT_NOT_FOUND',
        error: 'TRADE_ROOT_NOT_FOUND',
      });
    });

    it('passes the official URL write error through', async () => {
      updateUrl.mockRejectedValue(new Error('CompressionStream failed'));
      const outcome = await requestMainWorld('criteria-overlay.sync', undefined);
      expect(outcome).toMatchObject({
        ok: false,
        code: 'CompressionStream failed',
        error: 'CompressionStream failed',
        diagnostics: { method: 'updateUrl' },
      });
    });
  });

  it('rejects commits containing ops outside the whitelist with INVALID_REQUEST', async () => {
    const outcome = await requestMainWorld('criteria-overlay.commit', {
      ops: [{ kind: 'clearSearchForm' } as any],
    });
    expect(store.commit).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });
});
