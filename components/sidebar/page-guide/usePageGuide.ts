import { computed, reactive, shallowRef } from 'vue';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { requestPageGuideDemo, type PageGuideDemoAction } from '@/utils/page-guide-demo-channel';
import { PAGE_GUIDE_TOUR_STEPS, type PageGuideTourStep } from './page-guide-tour';
import {
  findPageGuideElement,
  getPageGuideTarget,
  type PageGuideNeed,
  type PageGuideTargetId,
} from './page-guide-targets';

/** 單點指出的外框停留時間 */
const POINT_DURATION_MS = 3200;
/** 示範條件加入後，等官方與 T 階按鈕重新渲染 */
const DEMO_RENDER_WAIT_MS = 160;

type GuideMode = 'idle' | 'point' | 'tour';

/** 需要先在官方頁面暫時補出元素的位置，對應要送出的示範動作 */
const DEMO_ACTION_BY_NEED: Partial<Record<PageGuideNeed, PageGuideDemoAction>> = {
  filters: 'show-filters',
  'stat-filter': 'add-stat-filter',
};

export interface PageGuideDeps {
  steps: readonly PageGuideTourStep[];
  requestDemo: (action: PageGuideDemoAction) => Promise<boolean>;
  notify: (message: string) => void;
  wait: (ms: number) => Promise<void>;
  scrollIntoView: (el: Element) => void;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

const defaultDeps: PageGuideDeps = {
  steps: PAGE_GUIDE_TOUR_STEPS,
  requestDemo: requestPageGuideDemo,
  notify: (message) => dispatchPoeEvent('poexd-toast', { message }),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  scrollIntoView: (el) =>
    el.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    }),
};

/**
 * 頁面導覽的共用狀態：設定旁的「在頁面上指出」與初始導覽都走這裡，
 * 由 PageGuideHost 依狀態畫出外框與說明框。
 */
export function createPageGuide(deps: PageGuideDeps = defaultDeps) {
  const state = reactive({
    mode: 'idle' as GuideMode,
    stepIndex: 0,
    label: '',
  });
  const element = shallowRef<Element | null>(null);
  let sidebarRoot: ParentNode | null = null;
  let demoActive = false;
  let pointTimer: ReturnType<typeof setTimeout> | undefined;
  let runToken = 0;

  const restoreDemo = async () => {
    if (!demoActive) return;
    demoActive = false;
    await deps.requestDemo('restore');
  };

  const locate = async (targetId: PageGuideTargetId): Promise<Element | null> => {
    const target = getPageGuideTarget(targetId);
    const roots = { page: document, sidebar: sidebarRoot };
    const found = findPageGuideElement(target, roots);
    const demoAction = target.needs ? DEMO_ACTION_BY_NEED[target.needs] : undefined;
    if (found || !demoAction) return found;
    demoActive = (await deps.requestDemo(demoAction)) || demoActive;
    await deps.wait(DEMO_RENDER_WAIT_MS);
    return findPageGuideElement(target, roots);
  };

  const reset = () => {
    clearTimeout(pointTimer);
    state.mode = 'idle';
    state.label = '';
    element.value = null;
  };

  const stop = async () => {
    runToken += 1;
    reset();
    await restoreDemo();
  };

  /** 設定旁的「在頁面上指出」：捲過去、框一下，幾秒後自動消失。 */
  const pointAt = async (targetId: PageGuideTargetId, label: string) => {
    await stop();
    const token = runToken;
    const found = await locate(targetId);
    if (token !== runToken) return;
    if (!found) {
      await restoreDemo();
      const needsResults = getPageGuideTarget(targetId).needs === 'results';
      deps.notify(t(needsResults ? 'pageGuide.point.needsResults' : 'pageGuide.point.notFound'));
      return;
    }
    deps.scrollIntoView(found);
    element.value = found;
    state.label = label;
    state.mode = 'point';
    pointTimer = setTimeout(() => {
      if (token === runToken) void stop();
    }, POINT_DURATION_MS);
  };

  const showStep = async (index: number) => {
    const token = ++runToken;
    clearTimeout(pointTimer);
    const step = deps.steps[index];
    if (!step) return;
    const needs = getPageGuideTarget(step.targetId).needs;
    if (!needs || !DEMO_ACTION_BY_NEED[needs]) await restoreDemo();
    const found = await locate(step.targetId);
    if (token !== runToken) return;
    if (found) deps.scrollIntoView(found);
    state.mode = 'tour';
    state.stepIndex = index;
    state.label = '';
    element.value = found;
  };

  const startTour = () => showStep(0);
  const nextStep = () =>
    state.stepIndex >= deps.steps.length - 1 ? stop() : showStep(state.stepIndex + 1);
  const previousStep = () => (state.stepIndex > 0 ? showStep(state.stepIndex - 1) : undefined);

  const currentStep = computed(() =>
    state.mode === 'tour' ? (deps.steps[state.stepIndex] ?? null) : null,
  );

  return {
    state,
    element,
    currentStep,
    stepCount: deps.steps.length,
    setSidebarRoot: (root: ParentNode | null) => {
      sidebarRoot = root;
    },
    pointAt,
    startTour,
    nextStep,
    previousStep,
    stop,
  };
}

export type PageGuide = ReturnType<typeof createPageGuide>;

let sharedGuide: PageGuide | null = null;

/** 整個側欄共用同一份導覽狀態。 */
export function usePageGuide(): PageGuide {
  sharedGuide ??= createPageGuide();
  return sharedGuide;
}
