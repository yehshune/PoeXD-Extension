// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainWorldSearchForm } from '@/entrypoints/main-world/main-world-search-form';
import { setFilterCategory } from '@/entrypoints/main-world/category-binding-manager';

interface FakeFilter {
  id: string;
  [key: string]: unknown;
}

function createStore(options: { cloneOnCommit?: boolean } = {}) {
  const persistent = {
    name: null,
    type: null,
    disc: null,
    term: null,
    status: 'online',
    filters: {},
    stats: [
      { type: 'and', filters: [] as FakeFilter[] },
      { type: 'and', filters: [] as FakeFilter[] },
    ] as Array<{ type: string; filters: FakeFilter[] }>,
  };
  const transient = { advancedSearchHidden: true };
  const store = {
    state: { persistent, transient },
    _withCommit: vi.fn((fn: () => void) => fn()),
    commit: vi.fn((mutation: string, payload: any) => {
      if (mutation === 'setStatFilter') {
        const value = options.cloneOnCommit ? { ...payload.value } : payload.value;
        const filters = persistent.stats[payload.group]!.filters;
        filters[payload.index ?? filters.length] = value;
      }
      if (mutation === 'pushStatGroup') persistent.stats.push(payload);
      if (mutation === 'toggleSearch') {
        transient.advancedSearchHidden = !transient.advancedSearchHidden;
      }
      if (mutation === 'setStatus' && payload === 'boom') throw new Error('boom');
    }),
  };
  return store;
}

function createForm(store: ReturnType<typeof createStore> | null) {
  const scheduled: Array<() => void> = [];
  const deps = {
    getStore: () => store as never,
    getRoot: () => null,
    persist: vi.fn(),
    retag: vi.fn(),
    schedule: vi.fn((task: () => void) => {
      scheduled.push(task);
    }),
  };
  const flush = () => scheduled.splice(0).forEach((task) => task());
  return { form: createMainWorldSearchForm(deps), deps, flush };
}

afterEach(() => {
  sessionStorage.clear();
});

describe('MainWorldSearchForm 的寫入不變式', () => {
  it('新增詞綴：寫入綁定並延遲重新標記', () => {
    const store = createStore();
    const { form, deps, flush } = createForm(store);

    expect(form.addStatFilter({ statId: 'explicit.stat_1', groupIndex: 0, category: 'ring' })).toBe(
      true,
    );
    expect(deps.persist).toHaveBeenCalledTimes(1);
    expect(deps.retag).not.toHaveBeenCalled();
    expect(deps.schedule).toHaveBeenCalledWith(expect.any(Function), 20);
    flush();
    expect(deps.retag).toHaveBeenCalledTimes(1);
  });

  it('Vuex clone payload 時，store 裡實際存放的詞綴仍保有隱藏屬性', () => {
    const store = createStore({ cloneOnCommit: true });
    const { form } = createForm(store);

    form.addStatFilter({
      statId: 'explicit.stat_cold',
      groupIndex: 1,
      category: 'boots',
      modGroup: 'cold|||||es',
    });

    const stored = store.state.persistent.stats[1]!.filters[0]!;
    expect(stored.poexdCategory).toBe('boots');
    expect(stored.poexdModGroup).toBe('cold|||||es');
    expect(typeof stored.poexdBindingId).toBe('string');
    expect(Object.keys(stored)).toEqual(['id', 'disabled']);
  });

  it('同一輪內的多次寫入只排一次重新標記', () => {
    const store = createStore();
    const { form, deps, flush } = createForm(store);

    form.addStatFilter({ statId: 'explicit.stat_1', groupIndex: 0 });
    form.addStatFilter({ statId: 'explicit.stat_2', groupIndex: 0 });
    form.moveStatFilter({ fromGroup: 0, fromFilter: 0, toGroup: 1, toFilter: 0 });

    expect(deps.persist).toHaveBeenCalledTimes(3);
    expect(deps.schedule).toHaveBeenCalledTimes(1);
    flush();
    expect(deps.retag).toHaveBeenCalledTimes(1);

    // 執行過後，下一次寫入會重新排程
    form.moveStatFilter({ fromGroup: 1, fromFilter: 0, toGroup: 0, toFilter: 5 });
    expect(deps.schedule).toHaveBeenCalledTimes(2);
  });

  it('移動詞綴：跨群組移動並寫入；來源不存在時不動', () => {
    const store = createStore();
    const { form, deps } = createForm(store);
    form.addStatFilter({ statId: 'explicit.stat_1', groupIndex: 0 });
    form.addStatFilter({ statId: 'explicit.stat_2', groupIndex: 0 });
    deps.persist.mockClear();

    expect(form.moveStatFilter({ fromGroup: 0, fromFilter: 1, toGroup: 1, toFilter: 0 })).toBe(
      true,
    );
    expect(store.state.persistent.stats[0]!.filters.map((f) => f.id)).toEqual(['explicit.stat_1']);
    expect(store.state.persistent.stats[1]!.filters.map((f) => f.id)).toEqual(['explicit.stat_2']);
    expect(deps.persist).toHaveBeenCalledTimes(1);

    expect(form.moveStatFilter({ fromGroup: 0, fromFilter: 9, toGroup: 1, toFilter: 0 })).toBe(
      false,
    );
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('改分類：由 binding manager 寫入，並立即重新標記', () => {
    const store = createStore();
    const filter: FakeFilter = { id: 'explicit.stat_life' };
    setFilterCategory(filter, 'helmet');
    store.state.persistent.stats[0]!.filters.push(filter);
    const { form, deps } = createForm(store);

    form.setFilterBinding({ bindingId: filter.poexdBindingId as string, category: 'gloves' });

    expect(filter.poexdCategory).toBe('gloves');
    expect(deps.retag).toHaveBeenCalledTimes(1);
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('套用 Criteria Overlay：完成後寫入；失敗時還原表單、往外拋，且不寫入', async () => {
    const store = createStore();
    const { form, deps } = createForm(store);

    await form.applyOverlayOps([{ kind: 'setStatus', status: 'any' } as never]);
    expect(deps.persist).toHaveBeenCalledTimes(1);
    expect(deps.schedule).toHaveBeenCalledTimes(1);

    await expect(
      form.applyOverlayOps([{ kind: 'setStatus', status: 'boom' } as never]),
    ).rejects.toThrow('boom');
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('示範詞綴：加入時不寫入，移除時寫入；只在相反狀態時切換篩選面板', () => {
    const store = createStore();
    const { form, deps } = createForm(store);

    expect(form.setAdvancedSearchHidden(false)).toBe(true);
    expect(form.setAdvancedSearchHidden(false)).toBe(false);
    const group = form.addDemoStatGroup('explicit.stat_life', 'body-armour');
    expect(group?.filters?.[0]?.poexdPageGuideDemo).toBe(true);
    expect(group?.filters?.[0]?.poexdCategory).toBe('body-armour');
    expect(deps.persist).not.toHaveBeenCalled();

    form.removeStatGroups(new Set([group!]));
    expect(store.state.persistent.stats).toHaveLength(2);
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it('找不到官方 store 時不寫入也不重新標記', async () => {
    const { form, deps } = createForm(null);
    expect(form.addStatFilter({ statId: 'explicit.stat_1', groupIndex: 0 })).toBe(false);
    expect(form.moveStatFilter({ fromGroup: 0, fromFilter: 0, toGroup: 0, toFilter: 0 })).toBe(
      false,
    );
    expect(form.setAdvancedSearchHidden(false)).toBeNull();
    form.removeStatGroups(new Set([{}]));
    await expect(form.applyOverlayOps([])).rejects.toThrow('FORM_STATE_NOT_FOUND');
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();
  });
});
