// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPageGuideDemo,
  DEMO_STAT_CATEGORY,
  initPageGuideDemoAdapter,
  pickDemoStatId,
} from '@/entrypoints/main-world/page-guide-demo-adapter';
import {
  setFilterCategory,
  setFilterModGroup,
} from '@/entrypoints/main-world/category-binding-manager';
import { createMainWorldSearchForm } from '@/entrypoints/main-world/main-world-search-form';
import { requestMainWorld } from '@/utils/cross-world-rpc';
import { findFirstTierSlotKey } from '@/utils/page-guide-demo-state';
import { setupTestMainWorldBridge } from './helpers/main-world-bridge-harness';

vi.mock('@/entrypoints/main-world/poe-runtime-reader', () => ({
  getVueStore: () => null,
  getTradeRootComponent: () => null,
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

/** 以假的 store 建立表單；寫入與重新標記改成記錄呼叫 */
function formFor(store: ReturnType<typeof createStore> | null) {
  const deps = {
    getStore: () => store as never,
    getRoot: () => null,
    persist: vi.fn(),
    retag: vi.fn(),
    schedule: vi.fn((task: () => void) => task()),
  };
  return { form: createMainWorldSearchForm(deps), deps };
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
  it('binds the demo stat to body armour so the tier list shows tier values', () => {
    const store = createStore();
    const demo = createPageGuideDemo(formFor(store).form);

    demo.addStatFilter();
    const group = store.state.persistent.stats[0] as { filters: Record<string, unknown>[] };
    expect(group.filters[0]!.poexdCategory).toBe(DEMO_STAT_CATEGORY);
    expect(DEMO_STAT_CATEGORY).toBe('body-armour');
    // 隱藏屬性不會被官方存進網址或搜尋條件
    expect(JSON.stringify(group)).not.toContain('body-armour');
  });

  it('pushes one stat group and restores the previous stats without saving', () => {
    const store = createStore();
    const demo = createPageGuideDemo(formFor(store).form);

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
    const demo = createPageGuideDemo(formFor(store).form);
    demo.addStatFilter();
    demo.addStatFilter();
    demo.restore();
    expect(store.state.persistent.stats).toEqual([]);
  });

  it('opens a collapsed filter panel and collapses it again on restore', () => {
    const store = createStore(true);
    const demo = createPageGuideDemo(formFor(store).form);

    demo.addStatFilter();
    expect(store.state.transient.advancedSearchHidden).toBe(false);

    demo.restore();
    expect(store.state.transient.advancedSearchHidden).toBe(true);
    expect(store.state.persistent.stats).toEqual([]);
    expect(demo.isActive()).toBe(false);
  });

  it('leaves an already open panel alone', () => {
    const store = createStore(false);
    const demo = createPageGuideDemo(formFor(store).form);
    demo.showFilters();
    expect(demo.isActive()).toBe(false);
    demo.restore();
    expect(store.commit).not.toHaveBeenCalledWith('toggleSearch', undefined);
  });

  it('fails clearly without the official store', () => {
    const demo = createPageGuideDemo(formFor(null).form);
    expect(() => demo.addStatFilter()).toThrow('FORM_STATE_NOT_FOUND');
    expect(() => demo.restore()).not.toThrow();
  });

  it('preserves existing filters and their hidden bindings on restore', () => {
    const store = createStore();
    const existingFilter = { id: 'explicit.stat_3299347043', value: { min: 50 }, disabled: false };
    setFilterCategory(existingFilter, 'helmet');
    setFilterModGroup(existingFilter, 'life');
    const originalGroup = { type: 'and', filters: [existingFilter] };
    store.state.persistent.stats.push(originalGroup);

    const demo = createPageGuideDemo(formFor(store).form);
    demo.addStatFilter();
    expect(store.state.persistent.stats).toHaveLength(2);
    const demoGroup = store.state.persistent.stats[1] as { filters: Record<string, unknown>[] };
    expect(demoGroup.filters[0]!.poexdPageGuideDemo).toBe(true);

    demo.restore();
    expect(store.state.persistent.stats).toEqual([originalGroup]);
    expect(store.state.persistent.stats[0]).toBe(originalGroup);
    expect(existingFilter).toHaveProperty('poexdCategory', 'helmet');
    expect(existingFilter).toHaveProperty('poexdModGroup', 'life');
    expect(typeof (existingFilter as Record<string, unknown>).poexdBindingId).toBe('string');
  });
});

describe('findFirstTierSlotKey', () => {
  it('prefers the page-guide demo tier trigger over an existing filter trigger', () => {
    document.body.innerHTML = `
      <div class="filter"><button class="poexd-tier-trigger" data-tier-slot-key="existing"></button></div>
      <div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" data-tier-slot-key="demo"></button></div>
    `;
    expect(findFirstTierSlotKey()).toBe('demo');
    document.body.innerHTML = '';
  });
});

describe('initPageGuideDemoAdapter over Cross-World RPC', () => {
  let teardown: (() => void) | null = null;

  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it('handles restore over Cross-World RPC and rejects invalid actions with INVALID_REQUEST', async () => {
    const bridge = setupTestMainWorldBridge('page-guide-demo-nonce');
    teardown = initPageGuideDemoAdapter(bridge);

    expect(await requestMainWorld('page-guide.demo', { action: 'restore' })).toEqual({
      ok: true,
      data: null,
    });
    expect(await requestMainWorld('page-guide.demo', { action: 'save' as any })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  it('surfaces FORM_STATE_NOT_FOUND when no official store is mounted', async () => {
    const bridge = setupTestMainWorldBridge('page-guide-demo-nonce');
    teardown = initPageGuideDemoAdapter(bridge);

    const outcome = await requestMainWorld('page-guide.demo', { action: 'show-filters' });
    expect(outcome).toMatchObject({
      ok: false,
      error: 'FORM_STATE_NOT_FOUND',
    });
  });
});
