import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import {
  sliceCategoryGroup,
  useProgressiveAffixRender,
} from '@/components/sidebar/composables/useProgressiveAffixRender';
import type { CategoryGroup, ModGroup } from '@/components/sidebar/types';

const mods = (prefix: string, count: number): ModGroup[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${i}`,
    key: `${prefix}_${i}`,
    details: '',
    tiers: [],
    generation_type: '1',
    affinities: ['normal'],
  }));

const category = (
  label: string,
  sizes: { prefixes?: number; suffixes?: number; all?: number },
  hasBothSplit = false,
): CategoryGroup => ({
  affinity: label,
  label,
  prefixes: mods(`${label}_p`, sizes.prefixes ?? 0),
  suffixes: mods(`${label}_s`, sizes.suffixes ?? 0),
  all: mods(`${label}_a`, sizes.all ?? 0),
  hasSplit: hasBothSplit,
  hasBothSplit,
  priority: 0,
});

const renderedCount = (cat: CategoryGroup) =>
  cat.prefixes.length + cat.suffixes.length + cat.all.length;

describe('sliceCategoryGroup', () => {
  it('splits the budget across both columns and keeps full totals', () => {
    const sliced = sliceCategoryGroup(category('一般', { prefixes: 50, suffixes: 50 }, true), 10);
    expect(sliced.prefixes).toHaveLength(5);
    expect(sliced.suffixes).toHaveLength(5);
    expect(sliced.totals).toEqual({ prefixes: 50, suffixes: 50, all: 0 });
  });

  it('gives the unused share of a short column to the other column', () => {
    const sliced = sliceCategoryGroup(category('一般', { prefixes: 2, suffixes: 50 }, true), 10);
    expect(sliced.prefixes).toHaveLength(2);
    expect(sliced.suffixes).toHaveLength(8);
  });

  it('returns the original lists when the budget covers everything', () => {
    const cat = category('一般', { all: 3 });
    expect(sliceCategoryGroup(cat, 10).all).toBe(cat.all);
  });
});

describe('useProgressiveAffixRender', () => {
  let frames: Map<number, () => void>;
  let nextFrameId: number;

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const runFrame = async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb());
    await nextTick();
  };

  const setup = (
    initial: CategoryGroup[],
    expanded: string[],
    frameBudgetMs: number | null = null,
  ) => {
    const categories = shallowRef(initial);
    const expandedCategories = ref(new Set(expanded));
    const scope = effectScope();
    const api = scope.run(() =>
      useProgressiveAffixRender({
        categories,
        expandedCategories,
        initialCount: 10,
        stepCount: 10,
        frameBudgetMs,
      }),
    )!;
    return { categories, expandedCategories, scope, ...api };
  };

  it('renders small lists completely without waiting for a frame', () => {
    const { renderedCategories, scope } = setup(
      [category('一般', { prefixes: 3 }), category('精髓', { all: 4 })],
      ['一般', '精髓'],
    );
    expect(renderedCategories.value.map(renderedCount)).toEqual([3, 4]);
    expect(frames.size).toBe(0);
    scope.stop();
  });

  it('renders a large list in steps, in category order, without dropping rendered items', async () => {
    const { renderedCategories, scope } = setup(
      [category('一般', { prefixes: 25 }), category('精髓', { all: 5 })],
      ['一般', '精髓'],
    );
    expect(renderedCategories.value.map(renderedCount)).toEqual([10, 0]);
    expect(renderedCategories.value[0].totals.prefixes).toBe(25);

    await runFrame();
    expect(renderedCategories.value.map(renderedCount)).toEqual([20, 0]);
    await runFrame();
    expect(renderedCategories.value.map(renderedCount)).toEqual([25, 0]);
    await runFrame();
    expect(renderedCategories.value.map(renderedCount)).toEqual([25, 5]);
    expect(frames.size).toBe(0);
    scope.stop();
  });

  it('starts over when the category list is replaced', async () => {
    const { categories, renderedCategories, scope } = setup(
      [category('一般', { prefixes: 25 })],
      ['一般'],
    );
    await runFrame();
    await runFrame();
    expect(renderedCount(renderedCategories.value[0])).toBe(25);

    categories.value = [category('一般', { prefixes: 40 })];
    await nextTick();
    expect(renderedCount(renderedCategories.value[0])).toBe(10);
    scope.stop();
  });

  it('renders a newly expanded category progressively instead of all at once', async () => {
    const { expandedCategories, renderedCategories, scope } = setup(
      [category('一般', { prefixes: 5 }), category('精髓', { all: 30 })],
      ['一般'],
    );
    await runFrame();
    expandedCategories.value.add('精髓');
    await nextTick();
    expect(renderedCount(renderedCategories.value[1])).toBe(10);
    scope.stop();
  });

  it('reveals a mod beyond the rendered range before scrolling to it', async () => {
    const { renderedCategories, revealMod, scope } = setup(
      [category('一般', { prefixes: 100 })],
      ['一般'],
    );
    revealMod('一般', '一般_p_60');
    await nextTick();
    expect(renderedCategories.value[0].prefixes.some((m) => m.id === '一般_p_60')).toBe(true);
    scope.stop();
  });

  it('keeps growing through the timer fallback when frames are throttled', async () => {
    const { renderedCategories, scope } = setup([category('一般', { prefixes: 25 })], ['一般']);
    expect(renderedCount(renderedCategories.value[0])).toBe(10);
    vi.advanceTimersByTime(50);
    await nextTick();
    expect(renderedCount(renderedCategories.value[0])).toBe(20);
    scope.stop();
  });

  it('shrinks the next step when a step takes longer than the frame budget', async () => {
    const { renderedCategories, scope } = setup(
      [category('一般', { prefixes: 200 })],
      ['一般'],
      10,
    );
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    frames.forEach((cb) => {
      cb();
      now += 40; // 這批 10 筆花了 40ms，是預算 10ms 的 4 倍
    });
    frames.clear();
    await nextTick();
    expect(renderedCount(renderedCategories.value[0])).toBe(20);

    await runFrame();
    // (10 + 10 * 10 / 40) / 2 ≈ 6，再受最小批量 8 限制
    expect(renderedCount(renderedCategories.value[0])).toBe(28);
    scope.stop();
  });

  it('stops scheduling frames once the scope is disposed', async () => {
    const { scope } = setup([category('一般', { prefixes: 100 })], ['一般']);
    expect(frames.size).toBe(1);
    scope.stop();
    await runFrame();
    expect(frames.size).toBe(0);
  });
});
