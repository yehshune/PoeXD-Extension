// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import { initPoeRuntimeMutation } from '@/entrypoints/main-world/poe-runtime-mutation';

describe('initPoeRuntimeMutation runtime regression', () => {
  let listeners: Map<string, (payload: any) => void>;
  let bridge: MainWorldBridge;
  let mockStore: any;
  let tradeEl: HTMLElement;
  let teardownMutation: (() => void) | null = null;

  beforeEach(() => {
    listeners = new Map();
    bridge = {
      dispatchEvent: vi.fn(),
      addListener: (type: string, handler: (payload: any) => void) => {
        listeners.set(type, handler);
        return () => listeners.delete(type);
      },
    } as unknown as MainWorldBridge;

    document.body.innerHTML = '';
    mockStore = {
      state: {
        persistent: {
          stats: [
            {
              type: 'and',
              filters: [],
            },
            {
              type: 'and',
              filters: [],
            },
          ],
        },
      },
      _withCommit: vi.fn((fn: () => void) => fn()),
      commit: vi.fn(),
    };

    tradeEl = document.createElement('div');
    tradeEl.id = 'trade';
    (tradeEl as any).__vue__ = { $store: mockStore };
    document.body.appendChild(tradeEl);

    teardownMutation = initPoeRuntimeMutation(bridge);
  });

  afterEach(() => {
    if (teardownMutation) {
      teardownMutation();
      teardownMutation = null;
    }
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('adds stat filter via _withCommit and setStatFilter with non-enumerable poexdCategory', () => {
    const addHandler = listeners.get('poexd-add-stat-filter');
    expect(addHandler).toBeDefined();

    addHandler!({
      statId: 'explicit.stat_resist_fire',
      groupIndex: 0,
      min: '20',
      max: '40',
      category: 'ring',
    });

    expect(mockStore._withCommit).toHaveBeenCalled();
    expect(mockStore.commit).toHaveBeenCalledWith('setStatFilter', {
      group: 0,
      index: 0,
      value: expect.objectContaining({
        id: 'explicit.stat_resist_fire',
        disabled: false,
        value: { min: 20, max: 40 },
      }),
    });

    // Verify non-enumerable poexdCategory
    const committedValue = mockStore.commit.mock.calls[0][1].value;
    expect(committedValue.poexdCategory).toBe('ring');
    expect(Object.keys(committedValue)).not.toContain('poexdCategory');
    expect(JSON.stringify(committedValue)).not.toContain('poexdCategory');
    expect(JSON.parse(JSON.stringify(committedValue))).toEqual({
      id: 'explicit.stat_resist_fire',
      disabled: false,
      value: { min: 20, max: 40 },
    });
  });

  it('preserves non-enumerable metadata on stored filter object even if setStatFilter clones payload', () => {
    // 模擬 PoE Vuex mutation clone payload 的行為（例如 state.stats[group].filters[index] = { ...value }）
    mockStore.commit = vi.fn((mutation: string, payload: any) => {
      if (mutation === 'setStatFilter') {
        const { group, index, value } = payload;
        // 刻意使用 shallow clone 丟失 non-enumerable 屬性
        mockStore.state.persistent.stats[group].filters[index] = { ...value };
      }
    });

    const addHandler = listeners.get('poexd-add-stat-filter');
    addHandler!({
      statId: 'explicit.stat_resist_cold',
      groupIndex: 0,
      category: 'boots',
      modGroup: '增加 #% 冰冷抗性|||||增加 #% 能量護盾',
    });

    // 驗證存放在 Vuex store 的實際 storedFilter 物件仍保有 poexdBindingId、poexdCategory 與 poexdModGroup
    const storedFilter = mockStore.state.persistent.stats[0].filters[0];
    expect(storedFilter).toBeDefined();
    expect(storedFilter.poexdCategory).toBe('boots');
    expect(storedFilter.poexdModGroup).toBe('增加 #% 冰冷抗性|||||增加 #% 能量護盾');
    expect(storedFilter.poexdBindingId).toBeDefined();
    expect(Object.keys(storedFilter)).not.toContain('poexdCategory');
    expect(Object.keys(storedFilter)).not.toContain('poexdModGroup');
    expect(Object.keys(storedFilter)).not.toContain('poexdBindingId');
  });

  it('updates stat category and ensures poexdCategory remains non-enumerable and removable', () => {
    // Put an existing filter into store state
    const existingFilter: any = {
      id: 'explicit.stat_life',
      disabled: false,
      poexdBindingId: 'binding-life',
    };
    mockStore.state.persistent.stats[0].filters = [existingFilter];

    const updateHandler = listeners.get('poexd-update-stat-category');
    expect(updateHandler).toBeDefined();

    // 1. Assign category
    updateHandler!({ bindingId: 'binding-life', groupIndex: 0, filterIndex: 0, category: 'boots' });
    expect(existingFilter.poexdCategory).toBe('boots');
    expect(Object.keys(existingFilter)).not.toContain('poexdCategory');
    expect(JSON.stringify(existingFilter)).not.toContain('poexdCategory');

    // 2. Assign and update modGroup independently without clearing category
    updateHandler!({
      bindingId: 'binding-life',
      groupIndex: 0,
      filterIndex: 0,
      modGroup: '增加 #% 最大生命|||||+# 護甲',
    });
    expect(existingFilter.poexdCategory).toBe('boots');
    expect(existingFilter.poexdModGroup).toBe('增加 #% 最大生命|||||+# 護甲');
    expect(Object.keys(existingFilter)).not.toContain('poexdModGroup');
    expect(JSON.stringify(existingFilter)).not.toContain('poexdModGroup');

    // 3. Updating category without explicit modGroup clears stale modGroup, and removing category cleans up
    updateHandler!({
      bindingId: 'binding-life',
      groupIndex: 0,
      filterIndex: 0,
      category: 'helmet',
    });
    expect(existingFilter.poexdCategory).toBe('helmet');
    expect(existingFilter.poexdModGroup).toBeUndefined();

    updateHandler!({ bindingId: 'binding-life', groupIndex: 0, filterIndex: 0, category: '' });
    expect(existingFilter.poexdCategory).toBeUndefined();
    expect(JSON.stringify(existingFilter)).not.toContain('poexdCategory');
  });

  it('moves and splices stat filter across groups via _withCommit', () => {
    const filterA = { id: 'stat_a', disabled: false };
    const filterB = { id: 'stat_b', disabled: false };
    const filterC = { id: 'stat_c', disabled: false };

    mockStore.state.persistent.stats[0].filters = [filterA, filterB];
    mockStore.state.persistent.stats[1].filters = [filterC];

    const moveHandler = listeners.get('poexd-move-stat-filter');
    expect(moveHandler).toBeDefined();

    // Move filterA from group 0 index 0 to group 1 index 1 (end)
    moveHandler!(
      JSON.stringify({
        fromGroup: 0,
        fromFilter: 0,
        toGroup: 1,
        toFilter: 1,
      }),
    );

    expect(mockStore._withCommit).toHaveBeenCalled();
    // Group 0 should now only have filterB
    expect(mockStore.state.persistent.stats[0].filters).toEqual([filterB]);
    // Group 1 should now have [filterC, filterA]
    expect(mockStore.state.persistent.stats[1].filters).toEqual([filterC, filterA]);
  });

  it('rejects malformed move payloads and does not execute _withCommit mutation', () => {
    const filterA = { id: 'stat_a', disabled: false };
    mockStore.state.persistent.stats[0].filters = [filterA];

    const moveHandler = listeners.get('poexd-move-stat-filter');
    expect(moveHandler).toBeDefined();

    mockStore._withCommit.mockClear();

    // 1. Invalid JSON
    moveHandler!('not-json');
    expect(mockStore._withCommit).not.toHaveBeenCalled();

    // 2. Missing fields
    moveHandler!(JSON.stringify({ fromGroup: 0, fromFilter: 0 }));
    expect(mockStore._withCommit).not.toHaveBeenCalled();

    // 3. String index
    moveHandler!(JSON.stringify({ fromGroup: '0', fromFilter: 0, toGroup: 0, toFilter: 0 }));
    expect(mockStore._withCommit).not.toHaveBeenCalled();

    // 4. Negative index
    moveHandler!(JSON.stringify({ fromGroup: -1, fromFilter: 0, toGroup: 0, toFilter: 0 }));
    expect(mockStore._withCommit).not.toHaveBeenCalled();

    // 5. Fractional index
    moveHandler!(JSON.stringify({ fromGroup: 0.5, fromFilter: 0, toGroup: 0, toFilter: 0 }));
    expect(mockStore._withCommit).not.toHaveBeenCalled();

    // 6. Non-object
    moveHandler!(JSON.stringify('string-payload'));
    expect(mockStore._withCommit).not.toHaveBeenCalled();

    // Verify store state remained completely untouched
    expect(mockStore.state.persistent.stats[0].filters).toEqual([filterA]);
  });
});
