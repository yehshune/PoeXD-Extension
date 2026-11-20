import { computed, nextTick, reactive, shallowRef } from 'vue';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { requestPageGuideDemo, type PageGuideDemoAction } from '@/utils/page-guide-demo-channel';
import { clearResultReveal, revealFirstResult } from '@/utils/page-guide-reveal';
import {
  PAGE_GUIDE_TOUR_STEPS,
  type PageGuideDemoFocus,
  type PageGuideStepCondition,
  type PageGuideStepDemo,
  type PageGuideTourStep,
} from './page-guide-tour';
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
  /** 固定顯示第一筆結果平常要 hover 才出現的按鈕；enabled=false 時還原 */
  revealResults: (enabled: boolean) => void;
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
  revealResults: (enabled) => {
    if (enabled) revealFirstResult();
    else clearResultReveal();
  },
};

/** 側欄提供給導覽的環境：哪些條件步驟要出現、切到某步驟前要先準備什麼（例如展開側欄） */
export interface PageGuideTourContext {
  isConditionMet: (condition: PageGuideStepCondition) => boolean;
  prepareStep: (step: PageGuideTourStep) => Promise<void>;
  /** 播放步驟的示範；需要等示範畫面出現的（例如展開清單）在出現後才 resolve */
  runStepDemo: (demo: PageGuideStepDemo) => Promise<void>;
  /** 離開步驟或結束導覽時停止示範並還原 */
  stopStepDemo: () => void;
}

const DEFAULT_TOUR_CONTEXT: PageGuideTourContext = {
  isConditionMet: () => false,
  prepareStep: async () => {},
  runStepDemo: async () => {},
  stopStepDemo: () => {},
};

/** 示範畫面出現後，找外框新目標的重試次數與間隔 */
const DEMO_TARGET_RETRIES = 10;
const DEMO_TARGET_RETRY_MS = 50;

/**
 * 頁面導覽的共用狀態：設定旁的「在頁面上指出」與初始導覽都走這裡，
 * 由 PageGuideHost 依狀態畫出外框與說明框。
 */
export function createPageGuide(deps: PageGuideDeps = defaultDeps) {
  const state = reactive({
    mode: 'idle' as GuideMode,
    /** 目前步驟在「會出現的步驟」中的位置 */
    stepIndex: 0,
    stepId: '',
    label: '',
    /** 結果步驟顯示的示意結果列；null 時不顯示 */
    demoFocus: null as PageGuideDemoFocus | null,
  });
  const element = shallowRef<Element | null>(null);
  const demoRingElements = shallowRef<readonly Element[]>([]);
  const demoSpotlightElement = shallowRef<Element | null>(null);
  const tourContext = shallowRef<PageGuideTourContext>(DEFAULT_TOUR_CONTEXT);
  let sidebarRoot: ParentNode | null = null;
  let activeDemoAction: PageGuideDemoAction | null = null;
  let pendingDemoStatFilter: Promise<boolean> | null = null;
  let pointTimer: ReturnType<typeof setTimeout> | undefined;
  let runToken = 0;

  /** 條件會在導覽中改變（例如第一步換了語言），每次重新計算 */
  const visibleSteps = computed(() =>
    deps.steps.filter((step) => !step.when || tourContext.value.isConditionMet(step.when)),
  );

  const roots = () => ({ page: document, sidebar: sidebarRoot });

  const restoreDemo = async () => {
    pendingDemoStatFilter = null;
    if (!activeDemoAction) return;
    activeDemoAction = null;
    await deps.requestDemo('restore');
  };

  const locate = async (targetId: PageGuideTargetId): Promise<Element | null> => {
    const target = getPageGuideTarget(targetId);
    deps.revealResults(target.needs === 'results');
    const found = findPageGuideElement(target, roots());
    const demoAction = target.needs ? DEMO_ACTION_BY_NEED[target.needs] : undefined;
    if (found || !demoAction) return found;
    if (await deps.requestDemo(demoAction)) {
      if (demoAction === 'add-stat-filter' || !activeDemoAction) {
        activeDemoAction = demoAction;
      }
    }
    await deps.wait(DEMO_RENDER_WAIT_MS);
    return findPageGuideElement(target, roots());
  };

  const reset = () => {
    clearTimeout(pointTimer);
    demoRingElements.value = [];
    demoSpotlightElement.value = null;
    tourContext.value.stopStepDemo();
    state.demoFocus = null;
    state.mode = 'idle';
    state.label = '';
    state.stepId = '';
    element.value = null;
  };

  const stop = async () => {
    runToken += 1;
    reset();
    deps.revealResults(false);
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
    const step = visibleSteps.value[index];
    if (!step) return;
    const needs = step.targetId ? getPageGuideTarget(step.targetId).needs : undefined;
    const nextDemoAction = needs ? DEMO_ACTION_BY_NEED[needs] : undefined;
    if (
      !nextDemoAction ||
      (activeDemoAction === 'add-stat-filter' && nextDemoAction !== 'add-stat-filter')
    ) {
      await restoreDemo();
    }
    demoRingElements.value = [];
    demoSpotlightElement.value = null;
    tourContext.value.stopStepDemo();
    await tourContext.value.prepareStep(step);
    if (token !== runToken) return;
    // 示意結果列要先畫出來，外框才找得到裡面的按鈕
    state.demoFocus = step.demoFocus ?? null;
    if (step.demoFocus) await nextTick();
    if (!step.targetId) deps.revealResults(false);
    // 導覽的階級步驟一律優先確保專用示範詞綴存在，避免在尚未等第 6 步播完就跳步時誤抓到頁面原本的其他詞綴
    if (nextDemoAction === 'add-stat-filter') {
      await ensureDemoStatFilter();
      if (token !== runToken) return;
    }
    const found = step.targetId ? await locate(step.targetId) : null;
    if (token !== runToken) return;
    if (found) deps.scrollIntoView(found);
    state.mode = 'tour';
    state.stepIndex = index;
    state.stepId = step.id;
    state.label = '';
    element.value = found;
    if (step.demo) await runDemo(step, token);
  };

  const runDemo = async (step: PageGuideTourStep, token: number) => {
    if (!step.demo) return;
    await tourContext.value.runStepDemo(step.demo);
    if (token !== runToken || !step.demoTargetId) return;
    const target = getPageGuideTarget(step.demoTargetId);
    for (let attempt = 0; attempt < DEMO_TARGET_RETRIES; attempt += 1) {
      const found = findPageGuideElement(target, roots());
      if (token !== runToken) return;
      if (found) {
        element.value = found;
        return;
      }
      await deps.wait(DEMO_TARGET_RETRY_MS);
    }
  };

  /** 目前步驟在會出現的步驟中的位置；條件改變後步驟可能前移或消失 */
  const currentVisibleIndex = () => {
    const index = visibleSteps.value.findIndex((step) => step.id === state.stepId);
    return index >= 0 ? index : state.stepIndex;
  };

  const startTour = () => showStep(0);
  const nextStep = () => {
    const index = currentVisibleIndex();
    return index >= visibleSteps.value.length - 1 ? stop() : showStep(index + 1);
  };
  const previousStep = () => {
    const index = currentVisibleIndex();
    return index > 0 ? showStep(index - 1) : undefined;
  };

  const currentStep = computed(() =>
    state.mode === 'tour' ? (deps.steps.find((step) => step.id === state.stepId) ?? null) : null,
  );
  const stepCount = computed(() => visibleSteps.value.length);
  const stepNumber = computed(() => currentVisibleIndex() + 1);

  /**
   * 目標被移除或藏起來時（例如導覽中收合側欄）同步改找對照表裡下一個看得到的元素；
   * 不送示範動作，找不到就維持原樣。
   */
  const refreshElement = () => {
    const step = currentStep.value;
    if (!step?.targetId) return;
    const current = element.value;
    if (current?.isConnected) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return;
    }
    // 示範的畫面（例如 T 階清單）被關掉後，退回步驟原本的目標
    const found = findPageGuideElement(getPageGuideTarget(step.targetId), roots());
    if (found && found !== current) element.value = found;
  };

  /** 供第 6 步／第 7 步確保專用示範詞綴已插入，避免頁面上原有其他詞綴干擾第 7 步目標 */
  const ensureDemoStatFilter = async (): Promise<boolean> => {
    if (activeDemoAction === 'add-stat-filter') return true;
    if (pendingDemoStatFilter) return pendingDemoStatFilter;
    const run = (async () => {
      const ok = await deps.requestDemo('add-stat-filter');
      if (ok) {
        activeDemoAction = 'add-stat-filter';
        await deps.wait(DEMO_RENDER_WAIT_MS);
        // 官方頁面重新標記示範列與注入 T 階按鈕皆為非同步，持續等到示範列的 T 按鈕出現再繼續
        for (let attempt = 0; attempt < DEMO_TARGET_RETRIES; attempt += 1) {
          if (document.querySelector('[data-poexd-page-guide-demo="true"] .poexd-tier-trigger')) {
            break;
          }
          await deps.wait(DEMO_TARGET_RETRY_MS);
        }
      }
      return ok;
    })();
    pendingDemoStatFilter = run;
    try {
      return await run;
    } finally {
      if (pendingDemoStatFilter === run) pendingDemoStatFilter = null;
    }
  };

  /** 切換進度為 demo 播放後的自訂焦點（例如詞綴面板中的步驟目標，或同時框住 T 按鈕與選單） */
  const setDemoElements = (targets: {
    ring?: Element | readonly Element[] | null;
    spotlight?: Element | null;
  }) => {
    if ('ring' in targets) {
      if (!targets.ring) demoRingElements.value = [];
      else demoRingElements.value = Array.isArray(targets.ring) ? targets.ring : [targets.ring];
    }
    if ('spotlight' in targets) demoSpotlightElement.value = targets.spotlight ?? null;
  };

  return {
    state,
    element,
    demoRingElements,
    demoSpotlightElement,
    currentStep,
    stepCount,
    stepNumber,
    setSidebarRoot: (root: ParentNode | null) => {
      sidebarRoot = root;
    },
    setTourContext: (context: PageGuideTourContext | null) => {
      tourContext.value = context ?? DEFAULT_TOUR_CONTEXT;
    },
    setDemoElements,
    ensureDemoStatFilter,
    pointAt,
    startTour,
    nextStep,
    previousStep,
    refreshElement,
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
