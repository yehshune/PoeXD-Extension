import { computed, nextTick, onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import type { CategoryGroup } from '../types';

export interface CategoryGroupTotals {
  prefixes: number;
  suffixes: number;
  all: number;
}

/** 實際要渲染的大類：清單只含目前已排入的詞綴，totals 保留完整數量供標題計數使用 */
export interface RenderedCategoryGroup extends CategoryGroup {
  totals: CategoryGroupTotals;
}

export interface UseProgressiveAffixRenderOptions {
  categories: Ref<CategoryGroup[]>;
  expandedCategories: Ref<Set<string>>;
  /** 大類清單換掉（切換類別、搜尋）後第一個 frame 最多渲染幾筆 */
  initialCount?: number;
  /** 第一批補畫的筆數；之後依實際渲染耗時調整 */
  stepCount?: number;
  /** 每批補畫的目標耗時（ms），依上一批的實測耗時換算下一批筆數；null 表示固定 stepCount */
  frameBudgetMs?: number | null;
}

const DEFAULT_INITIAL_COUNT = 40;
const DEFAULT_STEP_COUNT = 20;
const DEFAULT_FRAME_BUDGET_MS = 12;
const MIN_STEP_COUNT = 8;
const MAX_STEP_COUNT = 200;

const totalOf = (cat: CategoryGroup) => cat.prefixes.length + cat.suffixes.length + cat.all.length;

const totalsOf = (cat: CategoryGroup): CategoryGroupTotals => ({
  prefixes: cat.prefixes.length,
  suffixes: cat.suffixes.length,
  all: cat.all.length,
});

/** 依預算截取大類內容；雙欄排版時前後綴各分一半，讓兩欄同步長出來 */
export function sliceCategoryGroup(cat: CategoryGroup, budget: number): RenderedCategoryGroup {
  const totals = totalsOf(cat);
  if (budget >= totalOf(cat)) return { ...cat, totals };

  let remaining = Math.max(0, budget);
  let prefixCount: number;
  let suffixCount: number;
  if (cat.hasBothSplit) {
    prefixCount = Math.min(totals.prefixes, Math.ceil(remaining / 2));
    suffixCount = Math.min(totals.suffixes, remaining - prefixCount);
    prefixCount = Math.min(totals.prefixes, remaining - suffixCount);
  } else {
    prefixCount = Math.min(totals.prefixes, remaining);
    suffixCount = Math.min(totals.suffixes, remaining - prefixCount);
  }
  remaining -= prefixCount + suffixCount;

  return {
    ...cat,
    prefixes: cat.prefixes.slice(0, prefixCount),
    suffixes: cat.suffixes.slice(0, suffixCount),
    all: cat.all.slice(0, remaining),
    totals,
  };
}

/** 讓指定詞綴落在已渲染範圍內所需的預算 */
function budgetToReveal(cat: CategoryGroup, modId: string): number | null {
  const prefixIdx = cat.prefixes.findIndex((m) => m.id === modId);
  const suffixIdx = prefixIdx === -1 ? cat.suffixes.findIndex((m) => m.id === modId) : -1;
  if (cat.hasBothSplit && (prefixIdx !== -1 || suffixIdx !== -1)) {
    return 2 * (Math.max(prefixIdx, suffixIdx) + 1) + 1;
  }
  if (prefixIdx !== -1) return prefixIdx + 1;
  if (suffixIdx !== -1) return cat.prefixes.length + suffixIdx + 1;
  const allIdx = cat.all.findIndex((m) => m.id === modId);
  if (allIdx !== -1) return cat.prefixes.length + cat.suffixes.length + allIdx + 1;
  return null;
}

/** 下一批補畫前的保底等待：視窗被遮住時 Chrome 會把 rAF 節流到約每秒一次，用 timer 讓清單仍能長完 */
const FALLBACK_DELAY_MS = 50;

/** 優先在下一個 frame 執行，rAF 被節流時改由 timer 保底；兩者只會執行一次 */
const scheduleFrame = (cb: () => void): (() => void) => {
  let rafHandle: number | undefined;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
    if (timerHandle !== undefined) clearTimeout(timerHandle);
    rafHandle = timerHandle = undefined;
  };
  const run = () => {
    cancel();
    cb();
  };
  if (typeof requestAnimationFrame === 'function') rafHandle = requestAnimationFrame(run);
  timerHandle = setTimeout(run, FALLBACK_DELAY_MS);
  return cancel;
};

/**
 * 詞綴清單分批渲染：類別詞綴多時（PoE1 頭盔上千筆）一次掛載全部 ModItem 會讓主執行緒卡住近一秒。
 * 改成先畫出前幾十筆，其餘每個 frame 依大類順序補上，每批筆數依實測耗時調整；
 * 已排入的項目不會被收回，只會增加。
 */
export function useProgressiveAffixRender({
  categories,
  expandedCategories,
  initialCount = DEFAULT_INITIAL_COUNT,
  stepCount = DEFAULT_STEP_COUNT,
  frameBudgetMs = DEFAULT_FRAME_BUDGET_MS,
}: UseProgressiveAffixRenderOptions) {
  /** 已確定的各大類預算；尚未排入的大類從 initialCount 的共用額度分配 */
  const budgets = shallowRef(new Map<string, number>());

  const effectiveBudgets = computed(() => {
    const result = new Map<string, number>();
    let pool = initialCount;
    for (const cat of categories.value) {
      if (!expandedCategories.value.has(cat.label)) continue;
      const total = totalOf(cat);
      let budget = budgets.value.get(cat.label);
      if (budget === undefined) {
        budget = Math.min(total, pool);
        pool -= budget;
      }
      result.set(cat.label, Math.min(budget, total));
    }
    return result;
  });

  const renderedCategories = computed<RenderedCategoryGroup[]>(() =>
    categories.value.map((cat) => {
      const budget = effectiveBudgets.value.get(cat.label);
      return budget === undefined
        ? { ...cat, totals: totalsOf(cat) }
        : sliceCategoryGroup(cat, budget);
    }),
  );

  const findIncomplete = () =>
    categories.value.find((cat) => {
      const budget = effectiveBudgets.value.get(cat.label);
      return budget !== undefined && budget < totalOf(cat);
    });

  let cancelPending: (() => void) | null = null;
  /** 每批筆數會隨機器與 build（dev 比 production 慢數倍）調整，讓每批接近 frameBudgetMs */
  let currentStep = stepCount;
  let disposed = false;

  const adaptStep = (added: number, elapsedMs: number) => {
    if (frameBudgetMs === null || added <= 0 || elapsedMs <= 0) return;
    const fitted = (added * frameBudgetMs) / elapsedMs;
    // 與前一次取平均，避免單次 GC 之類的雜訊讓批量大幅震盪
    const smoothed = Math.round((currentStep + fitted) / 2);
    currentStep = Math.min(MAX_STEP_COUNT, Math.max(MIN_STEP_COUNT, smoothed));
  };

  const step = () => {
    cancelPending = null;
    const target = findIncomplete();
    if (!target) return;
    const before = effectiveBudgets.value.get(target.label) ?? 0;
    const added = Math.min(currentStep, totalOf(target) - before);
    const next = new Map(effectiveBudgets.value);
    next.set(target.label, before + added);
    const startedAt = performance.now();
    budgets.value = next;
    // nextTick 在這批 ModItem 掛載完成後才 resolve，期間就是這批的渲染耗時
    void nextTick(() => {
      if (!disposed) adaptStep(added, performance.now() - startedAt);
    });
  };

  watch(
    effectiveBudgets,
    (effective) => {
      // 把共用額度分到的數量固定下來，之後新展開的大類才能拿到完整的 initialCount
      if ([...effective.keys()].some((label) => !budgets.value.has(label))) {
        budgets.value = new Map(effective);
      }
      if (!cancelPending && findIncomplete()) cancelPending = scheduleFrame(step);
    },
    { immediate: true },
  );

  // 換了一份大類清單（切換類別、搜尋、篩選）就重新從頭分批
  watch(categories, () => {
    budgets.value = new Map();
  });

  // 收合的大類釋放預算，之後重新展開時同樣分批渲染
  watch(
    () => [...expandedCategories.value],
    (labels) => {
      const expanded = new Set(labels);
      if ([...budgets.value.keys()].every((label) => expanded.has(label))) return;
      budgets.value = new Map([...budgets.value].filter(([label]) => expanded.has(label)));
    },
  );

  /** 捲動到某個詞綴前，確保它已渲染 */
  const revealMod = (label: string, modId: string) => {
    const cat = categories.value.find((c) => c.label === label);
    if (!cat) return;
    const needed = budgetToReveal(cat, modId);
    const current = effectiveBudgets.value.get(label) ?? 0;
    if (needed === null || needed <= current) return;
    const next = new Map(effectiveBudgets.value);
    next.set(label, needed);
    budgets.value = next;
  };

  onScopeDispose(() => {
    disposed = true;
    cancelPending?.();
    cancelPending = null;
  });

  return { renderedCategories, revealMod };
}
