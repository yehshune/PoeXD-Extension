// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  createPageGuideSession,
  type FilterPaneDemoHandle,
  type FilterPaneSnapshot,
  type PageGuideHost,
} from '@/components/sidebar/page-guide/usePageGuide';
import type { PageGuideTourStep } from '@/components/sidebar/page-guide/page-guide-tour';
import {
  DEFAULT_PREFERENCES,
  createInMemoryPreferencesStorage,
  createPreferencesModule,
  type Preferences,
  type PreferencesModule,
} from '@/utils/preferences';

function visible<T extends Element>(
  el: T,
  rect: Partial<DOMRect> = { top: 0, left: 0, width: 10, height: 10 },
): T {
  const top = rect.top ?? 0;
  const left = rect.left ?? 0;
  const width = rect.width ?? 10;
  const height = rect.height ?? 10;
  el.getBoundingClientRect = () =>
    ({
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

function addElement(html: string, rect?: Partial<DOMRect>): Element {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const el = wrapper.firstElementChild!;
  document.body.appendChild(el);
  return visible(el, rect);
}

async function createTestPreferences(
  initial: Record<string, unknown> = {},
): Promise<PreferencesModule> {
  const outcome = await createPreferencesModule('poe2', createInMemoryPreferencesStorage(initial));
  if (!outcome.ok) throw new Error('Failed to create test preferences module');
  return outcome.value;
}

const steps: PageGuideTourStep[] = [
  {
    id: 'search',
    targetId: 'search-input',
    titleKey: 'pageGuide.tour.affixSelector.title',
    bodyKey: 'pageGuide.tour.affixSelector.body',
  },
  {
    id: 'tier',
    targetId: 'tier-trigger',
    titleKey: 'pageGuide.tour.tier.title',
    bodyKey: 'pageGuide.tour.tier.body',
  },
  {
    id: 'results',
    targetId: 'mock-result-actions',
    titleKey: 'pageGuide.tour.resultActions.title',
    bodyKey: 'pageGuide.tour.resultActions.body',
    demoFocus: 'actions',
  },
];

function createFakeHost(overrides: Partial<PageGuideHost> = {}): PageGuideHost {
  return {
    getEnvironment: () => ({ hostname: 'www.pathofexile.com', browserLocale: 'zh-TW' }),
    requestDemo: vi.fn(async (action) => {
      if (action === 'add-stat-filter') addElement('<span class="poexd-tier-trigger"></span>');
      return true;
    }),
    notify: vi.fn(),
    wait: async () => {},
    now: () => 0,
    nextAnimationFrame: async () => {},
    scrollIntoView: vi.fn(),
    revealResults: vi.fn(),
    getViewportHeight: () => 900,
    ...overrides,
  };
}

/** 可手動步進時間與 rAF 的假時鐘，用來精準測試示範中途取消與逐幀拖曳 */
function createControllableClock() {
  let currentTime = 0;
  const pendingWaits: Array<{ resolve: () => void; ms: number }> = [];
  const pendingFrames: Array<() => void> = [];

  const settleMicrotasks = async () => {
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
      await nextTick();
    }
  };

  return {
    now: () => currentTime,
    wait: (ms: number) =>
      new Promise<void>((resolve) => {
        pendingWaits.push({ resolve, ms });
      }),
    nextAnimationFrame: () =>
      new Promise<void>((resolve) => {
        pendingFrames.push(resolve);
      }),
    flushNextWait: async () => {
      const next = pendingWaits.shift();
      if (!next) return false;
      currentTime += next.ms;
      next.resolve();
      await settleMicrotasks();
      return true;
    },
    flushNextFrame: async (deltaMs = 150) => {
      const next = pendingFrames.shift();
      if (!next) return false;
      currentTime += deltaMs;
      next();
      await settleMicrotasks();
      return true;
    },
    pendingWaitCount: () => pendingWaits.length,
    pendingFrameCount: () => pendingFrames.length,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('pointAt', () => {
  it('scrolls to the element, labels it, and clears itself after a few seconds', async () => {
    const host = createFakeHost();
    const guide = createPageGuideSession(host, { steps });
    const input = addElement('<div class="search-bar"></div>');

    await guide.pointAt('search-input', '模糊搜尋');

    expect(host.scrollIntoView).toHaveBeenCalledWith(input);
    expect(guide.state.mode).toBe('point');
    expect(guide.state.label).toBe('模糊搜尋');
    expect(guide.element.value).toBe(input);

    await vi.advanceTimersByTimeAsync(3300);
    expect(guide.state.mode).toBe('idle');
    expect(guide.element.value).toBeNull();
  });

  it('asks for a search first when the target needs results', async () => {
    const host = createFakeHost();
    const guide = createPageGuideSession(host, { steps });

    await guide.pointAt('result-price', '價格換算');

    expect(guide.state.mode).toBe('idle');
    expect(host.notify).toHaveBeenCalledWith(expect.stringContaining('搜尋'));
  });

  it('adds a demo stat filter for the tier button and restores it afterwards', async () => {
    const host = createFakeHost();
    const guide = createPageGuideSession(host, { steps });

    await guide.pointAt('tier-trigger', 'T 階');
    expect(host.requestDemo).toHaveBeenCalledWith('add-stat-filter');
    expect(guide.state.mode).toBe('point');

    await vi.advanceTimersByTimeAsync(3300);
    expect(host.requestDemo).toHaveBeenLastCalledWith('restore');
  });

  it('does not touch the form when the tier button already exists', async () => {
    const host = createFakeHost();
    const guide = createPageGuideSession(host, { steps });
    addElement('<span class="poexd-tier-trigger"></span>');

    await guide.pointAt('tier-trigger', 'T 階');
    await guide.stop();

    expect(host.requestDemo).not.toHaveBeenCalled();
  });

  it('asks the page to open the filter panel for the affix selector', async () => {
    const host = createFakeHost({
      requestDemo: vi.fn(async (action) => {
        if (action === 'show-filters')
          addElement('<button class="poexd-filter-select-btn"></button>');
        return true;
      }),
    });
    const guide = createPageGuideSession(host, { steps });

    await guide.pointAt('affix-selector', '詞綴選擇器');
    expect(host.requestDemo).toHaveBeenCalledWith('show-filters');
    expect(guide.state.mode).toBe('point');

    await guide.stop();
    expect(host.requestDemo).toHaveBeenLastCalledWith('restore');
  });
});

describe('tour state machine', () => {
  it('walks the steps and restores the demo filter when leaving its step', async () => {
    const host = createFakeHost();
    const guide = createPageGuideSession(host, { steps });
    addElement('<div class="search-bar"></div>');

    await guide.startTour();
    expect(guide.currentStep.value?.id).toBe('search');

    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('tier');
    expect(host.requestDemo).toHaveBeenCalledWith('add-stat-filter');

    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('results');
    expect(host.requestDemo).toHaveBeenLastCalledWith('restore');
    expect(guide.element.value).toBeNull();

    await guide.previousStep();
    expect(guide.currentStep.value?.id).toBe('tier');
  });

  it('restores the demo stat filter when stepping back from tier to affix-selector', async () => {
    const tourSteps: PageGuideTourStep[] = [
      {
        id: 'affix-selector',
        targetId: 'affix-selector',
        titleKey: 'pageGuide.tour.affixSelector.title',
        bodyKey: 'pageGuide.tour.affixSelector.body',
      },
      {
        id: 'tier',
        targetId: 'tier-trigger',
        titleKey: 'pageGuide.tour.tier.title',
        bodyKey: 'pageGuide.tour.tier.body',
      },
    ];
    const requestDemo = vi.fn(async (action: string) => {
      if (action === 'show-filters') {
        addElement('<button class="poexd-filter-select-btn"></button>');
      } else if (action === 'add-stat-filter') {
        addElement('<span class="poexd-tier-trigger"></span>');
      } else if (action === 'restore') {
        document.body.innerHTML = '';
      }
      return true;
    });
    const guide = createPageGuideSession(createFakeHost({ requestDemo }), { steps: tourSteps });

    await guide.startTour();
    expect(guide.currentStep.value?.id).toBe('affix-selector');

    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('tier');
    expect(requestDemo).toHaveBeenCalledWith('add-stat-filter');

    requestDemo.mockClear();
    await guide.previousStep();
    expect(guide.currentStep.value?.id).toBe('affix-selector');
    expect(requestDemo).toHaveBeenCalledWith('restore');
  });

  it('always inserts and selects the dedicated demo stat filter on the tier step even when another filter already exists', async () => {
    const existing = addElement(
      '<div class="filter"><button class="poexd-tier-trigger" id="existing"></button></div>',
    );
    const existingTrigger = existing.querySelector('#existing')!;
    const requestDemo = vi.fn(async (action: string) => {
      if (action === 'add-stat-filter') {
        const demoFilter = addElement(
          '<div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" id="demo"></button></div>',
        );
        visible(demoFilter.querySelector('#demo')!);
      } else if (action === 'restore') {
        document.querySelector('[data-poexd-page-guide-demo="true"]')?.remove();
      }
      return true;
    });
    const guide = createPageGuideSession(createFakeHost({ requestDemo }), { steps });

    await guide.startTour();
    await guide.nextStep();

    expect(guide.currentStep.value?.id).toBe('tier');
    expect(requestDemo).toHaveBeenCalledWith('add-stat-filter');
    expect(guide.element.value).not.toBe(existingTrigger);
    expect((guide.element.value as HTMLElement)?.id).toBe('demo');

    await guide.stop();
    expect(document.querySelector('[data-poexd-page-guide-demo="true"]')).toBeNull();
  });

  it('waits for delayed demo stat filter row before locating tier trigger when other filters exist', async () => {
    const existing = addElement(
      '<div class="filter"><button class="poexd-tier-trigger" id="existing"></button></div>',
    );
    const existingTrigger = existing.querySelector('#existing')!;
    let waitCalls = 0;
    const guide = createPageGuideSession(
      createFakeHost({
        requestDemo: vi.fn(async () => true),
        wait: async () => {
          waitCalls += 1;
          if (waitCalls === 4) {
            const demoFilter = addElement(
              '<div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" id="delayed-demo"></button></div>',
            );
            visible(demoFilter.querySelector('#delayed-demo')!);
          }
        },
      }),
      { steps },
    );

    await guide.startTour();
    await guide.nextStep();

    expect(guide.currentStep.value?.id).toBe('tier');
    expect(guide.element.value).not.toBe(existingTrigger);
    expect((guide.element.value as HTMLElement)?.id).toBe('delayed-demo');
  });

  it('shows the mock result only for result steps and hides it on stop', async () => {
    const host = createFakeHost();
    const guide = createPageGuideSession(host, { steps });
    await guide.startTour();
    expect(guide.state.demoFocus).toBeNull();
    await guide.nextStep();
    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('results');
    expect(guide.state.demoFocus).toBe('actions');
    expect(host.revealResults).toHaveBeenLastCalledWith(false);

    await guide.previousStep();
    expect(guide.state.demoFocus).toBeNull();
    await guide.stop();
    expect(guide.state.demoFocus).toBeNull();
  });

  it('frames the mock row once it renders for the result step', async () => {
    const guide = createPageGuideSession(createFakeHost(), { steps: [steps[2]!] });
    const mock = addElement(
      '<div data-poexd-guide-mock><div class="row"><div class="poexd-left-actions"></div></div></div>',
    );
    visible(mock.querySelector('.poexd-left-actions')!);

    await guide.startTour();
    expect(guide.element.value).toBe(mock.querySelector('.poexd-left-actions'));
  });

  it('ends after the last step and on stop, always restoring the demo', async () => {
    const host = createFakeHost();
    const guide = createPageGuideSession(host, { steps });

    await guide.startTour();
    await guide.nextStep();
    await guide.stop();
    expect(guide.state.mode).toBe('idle');
    expect(host.requestDemo).toHaveBeenLastCalledWith('restore');

    await guide.startTour();
    await guide.nextStep();
    await guide.nextStep();
    await guide.nextStep();
    expect(guide.state.mode).toBe('idle');
  });

  it('ignores a step that finishes loading after the tour was stopped', async () => {
    let release: () => void = () => {};
    const host = createFakeHost({
      requestDemo: vi.fn(
        (action) =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(true);
            if (action === 'restore') resolve(true);
          }),
      ),
    });
    const guide = createPageGuideSession(host, { steps });
    await guide.startTour();
    const pending = guide.nextStep();
    await guide.stop();
    release();
    await pending;
    expect(guide.state.mode).toBe('idle');
  });

  it('switches to the next visible selector when the target disappears', async () => {
    const collapseStep: PageGuideTourStep = {
      id: 'collapse',
      targetId: 'sidebar-collapse',
      titleKey: 'pageGuide.tour.collapse.title',
      bodyKey: 'pageGuide.tour.collapse.body',
    };
    const root = document.createElement('div');
    root.innerHTML =
      '<button data-sidebar-action="collapse"></button><button data-sidebar-action="expand"></button>';
    document.body.appendChild(root);
    const [collapse, expand] = Array.from(root.children);
    visible(collapse!);

    const guide = createPageGuideSession(createFakeHost({ getSidebarRoot: () => root }), {
      steps: [collapseStep],
    });

    await guide.startTour();
    expect(guide.element.value).toBe(collapse);

    collapse!.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
    visible(expand!);
    guide.refreshElement();
    expect(guide.element.value).toBe(expand);
  });

  it('opens and closes non-blocking result preview and ignores preview while tour is active', async () => {
    const guide = createPageGuideSession(createFakeHost(), { steps });
    guide.openResultPreview('mods');
    expect(guide.state.mode).toBe('preview');
    expect(guide.state.demoFocus).toBe('mods');

    guide.closeResultPreview();
    expect(guide.state.mode).toBe('idle');
    expect(guide.state.demoFocus).toBeNull();

    await guide.startTour();
    guide.openResultPreview('mods');
    expect(guide.state.mode).toBe('tour');
    guide.closeResultPreview();
    expect(guide.state.mode).toBe('tour');
  });
});

describe('preferences binding, conditional steps, reload detection, and expandOnTourExit', () => {
  const conditionalSteps: PageGuideTourStep[] = [
    {
      id: 'locale',
      titleKey: 'pageGuide.tour.locale.title',
      bodyKey: 'pageGuide.tour.locale.body',
      setup: 'locale',
    },
    {
      id: 'market-translation',
      titleKey: 'pageGuide.tour.marketTranslation.title',
      bodyKey: 'pageGuide.tour.marketTranslation.body',
      setup: 'market-translation',
      when: 'market-translation-offer',
    },
    {
      id: 'sidebar',
      targetId: 'sidebar-nav',
      titleKey: 'pageGuide.tour.sidebar.title',
      bodyKey: 'pageGuide.tour.sidebar.body',
    },
    {
      id: 'search',
      targetId: 'search-input',
      titleKey: 'pageGuide.tour.affixSelector.title',
      bodyKey: 'pageGuide.tour.affixSelector.body',
    },
  ];

  it('re-evaluates conditional market-translation step reactively when displayLocale changes', async () => {
    const preferences = await createTestPreferences({ displayLocale: 'en' });
    const guide = createPageGuideSession(
      createFakeHost({
        preferences,
        getEnvironment: () => ({ hostname: 'www.pathofexile.com', browserLocale: 'en-US' }),
      }),
      { steps: conditionalSteps },
    );

    await guide.startTour();
    expect(guide.stepCount.value).toBe(3);

    await guide.setDisplayLocale('zh-TW');
    expect(guide.setup.displayLocale).toBe('zh-TW');
    expect(guide.stepCount.value).toBe(4);

    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('market-translation');
    expect(guide.stepNumber.value).toBe(2);
  });

  it('auto-switches non-Chinese displayLocale when enabling marketTranslation and tracks reloadRequired against page-load baseline', async () => {
    const baseline: Readonly<Preferences> = Object.freeze({
      ...DEFAULT_PREFERENCES,
      displayLocale: 'en',
      marketTranslation: false,
    });
    const preferences = await createTestPreferences({
      displayLocale: 'en',
      marketTranslation: false,
      marketTranslationBilingual: true,
    });
    const reload = vi.fn();
    const guide = createPageGuideSession(
      createFakeHost({
        preferences,
        getPageLoadPreferences: () => baseline,
        getEnvironment: () => ({ hostname: 'www.pathofexile.com', browserLocale: 'zh-CN' }),
        reload,
      }),
      { steps: conditionalSteps },
    );

    expect(guide.setup.displayLocale).toBe('en');
    expect(guide.setup.marketTranslation).toBe(false);
    expect(guide.setup.reloadRequired).toBe(false);

    await guide.setMarketTranslation(true);
    expect(preferences.read().marketTranslation).toBe(true);
    expect(preferences.read().displayLocale).toBe('zh-CN');
    expect(guide.setup.marketTranslation).toBe(true);
    expect(guide.setup.displayLocale).toBe('zh-CN');
    expect(guide.setup.reloadRequired).toBe(true);

    await guide.setMarketTranslation(false);
    expect(preferences.read().marketTranslation).toBe(false);
    expect(guide.setup.reloadRequired).toBe(false);

    guide.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('writes appearance and result preferences through PreferencesModule and projects readonly setup', async () => {
    const preferences = await createTestPreferences();
    const guide = createPageGuideSession(createFakeHost({ preferences }), { steps });

    await guide.setSidebarPosition('right');
    await guide.setFontSizeScale(1.15);
    await guide.setCompactDensity(true);
    await guide.setEnablePureBackground(true);
    await guide.setResultFeature('enableResultPobCopy', false);
    await guide.setResultModHighlightStyle('bar');
    await guide.setResultModHighlightColor('gold');
    await guide.setMarketTranslationBilingual(false);
    await guide.setMarketTranslationResultBilingual(true);

    expect(preferences.read()).toMatchObject({
      sidebarPosition: 'right',
      fontSizeScale: 1.15,
      densityScale: 0.8,
      enablePureBackground: true,
      enableResultPobCopy: false,
      resultModHighlightStyle: 'bar',
      resultModHighlightColor: 'gold',
      marketTranslationBilingual: false,
      marketTranslationResultBilingual: true,
    });
    expect(guide.setup.sidebarPosition).toBe('right');
    expect(guide.setup.fontSizeScale).toBe(1.15);
    expect(guide.setup.compactDensity).toBe(true);
    expect(guide.setup.enablePureBackground).toBe(true);
    expect(guide.setup.resultFeatures.enableResultPobCopy).toBe(false);
    expect(guide.setup.resultModHighlightStyle).toBe('bar');
    expect(guide.setup.resultModHighlightColor).toBe('gold');
    expect(guide.setup.marketTranslationBilingual).toBe(false);
    expect(guide.setup.marketTranslationResultBilingual).toBe(true);
  });

  it('prepares sidebar collapse/expand per step scope and restores expansion on tour exit only when expanded beforehand', async () => {
    const sidebarRoot = document.createElement('div');
    sidebarRoot.innerHTML = '<div class="sidebar-nav"></div>';
    document.body.appendChild(sidebarRoot);
    visible(sidebarRoot.firstElementChild!);
    addElement('<div class="search-bar"></div>');

    let collapsed = false;
    const toggleCollapse = vi.fn(() => {
      collapsed = !collapsed;
    });
    const guide = createPageGuideSession(
      createFakeHost({
        getEnvironment: () => ({ hostname: 'pathofexile.tw', browserLocale: 'zh-TW' }),
        isCollapsed: () => collapsed,
        toggleCollapse,
        getSidebarRoot: () => sidebarRoot,
      }),
      { steps: conditionalSteps },
    );

    // 導覽開始時側欄是展開的
    await guide.startTour();
    expect(collapsed).toBe(false);

    // sidebar 步驟維持展開
    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('sidebar');
    expect(collapsed).toBe(false);

    // page 步驟自動收合
    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('search');
    expect(collapsed).toBe(true);

    // 離開導覽時自動恢復展開
    await guide.stop();
    expect(collapsed).toBe(false);

    // 若開始導覽前原本就是收合的，結束時不應強制展開
    collapsed = true;
    await guide.startTour();
    await guide.nextStep(); // sidebar -> 暫時展開
    expect(collapsed).toBe(false);
    await guide.nextStep(); // search -> 收合
    expect(collapsed).toBe(true);
    await guide.stop();
    expect(collapsed).toBe(true);
  });

  it('detaches host cleanly without triggering sidebar expand on unmount', async () => {
    const preferences = await createTestPreferences({ displayLocale: 'zh-TW' });
    let collapsed = false;
    const toggleCollapse = vi.fn(() => {
      collapsed = !collapsed;
    });
    const guide = createPageGuideSession(undefined, { steps: conditionalSteps });
    guide.attachHost(
      createFakeHost({
        preferences,
        isCollapsed: () => collapsed,
        toggleCollapse,
      }),
    );

    await guide.startTour();
    collapsed = true;
    toggleCollapse.mockClear();

    guide.detachHost();
    expect(guide.state.mode).toBe('idle');
    expect(toggleCollapse).not.toHaveBeenCalled();
  });
});

describe('deterministic interactive demo scripts', () => {
  it('plays the collapse drag demo smoothly and restores stored collapsedTabTop on completion and mid-flight cancellation', async () => {
    const preferences = await createTestPreferences({
      sidebarPosition: 'left',
      collapsedTabTop: 140,
    });
    const clock = createControllableClock();
    const sidebarRoot = document.createElement('div');
    sidebarRoot.innerHTML =
      '<button data-sidebar-action="collapse"></button><button data-sidebar-action="expand"></button>';
    document.body.appendChild(sidebarRoot);
    const collapseBtn = visible(sidebarRoot.querySelector('[data-sidebar-action="collapse"]')!, {
      top: 12,
      left: 10,
      width: 28,
      height: 28,
    });
    const expandBtn = visible(sidebarRoot.querySelector('[data-sidebar-action="expand"]')!, {
      top: 140,
      left: 0,
      width: 42,
      height: 34,
    });

    let collapsed = false;
    let previewedTop = 140;
    const previewPositions: number[] = [];
    const host = createFakeHost({
      preferences,
      isCollapsed: () => collapsed,
      toggleCollapse: vi.fn(() => {
        collapsed = !collapsed;
      }),
      getSidebarPosition: () => 'left',
      getCollapsedTabTop: () => previewedTop,
      previewCollapsedTabTop: vi.fn((top: number) => {
        previewedTop = top;
        previewPositions.push(top);
      }),
      getSidebarRoot: () => sidebarRoot,
      querySidebar: (selector) => {
        if (selector === '[data-sidebar-action="collapse"]') return collapseBtn as any;
        if (selector === '[data-sidebar-action="expand"]') return expandBtn as any;
        return null;
      },
      wait: clock.wait,
      now: clock.now,
      nextAnimationFrame: clock.nextAnimationFrame,
      getViewportHeight: () => 900,
    });

    const collapseStep: PageGuideTourStep = {
      id: 'collapse',
      targetId: 'sidebar-collapse',
      titleKey: 'pageGuide.tour.collapse.title',
      bodyKey: 'pageGuide.tour.collapse.body',
      setup: 'collapse-drag',
      demo: 'collapse',
      interactive: true,
    };
    const guide = createPageGuideSession(host, { steps: [collapseStep] });

    // 1. 完整播放：游標點擊收合鈕 -> 拖曳展開把手 -> 拖回原位 -> 結束還原
    const replayPromise = guide.replayStepDemo('collapse');
    expect(guide.setup.demoPlaying).toBe(true);
    expect(guide.setup.demoCursor).not.toBeNull();

    // 逐步推進 wait / rAF 直到完成
    for (let i = 0; i < 60; i += 1) {
      if (clock.pendingWaitCount() > 0) await clock.flushNextWait();
      else if (clock.pendingFrameCount() > 0) await clock.flushNextFrame(200);
      else break;
    }
    await replayPromise;

    expect(collapsed).toBe(true);
    expect(previewPositions.some((top) => top > 200)).toBe(true);
    expect(previewedTop).toBe(140);
    expect(guide.setup.demoPlaying).toBe(false);
    expect(guide.setup.demoCursor).toBeNull();

    // 2. 中途取消：在拖曳進行一半時呼叫 stop()，應立即還原 collapsedTabTop 與游標
    collapsed = false;
    previewPositions.length = 0;
    const midFlight = guide.replayStepDemo('collapse');
    // 推進到已經開始拖曳並改動 previewCollapsedTabTop
    for (let i = 0; i < 30 && previewPositions.length < 2; i += 1) {
      if (clock.pendingWaitCount() > 0) await clock.flushNextWait();
      else if (clock.pendingFrameCount() > 0) await clock.flushNextFrame(150);
    }
    expect(previewPositions.length).toBeGreaterThanOrEqual(2);
    expect(previewedTop).not.toBe(140);

    await guide.stop();
    // 釋放任何殘留 wait/rAF，不應再改寫狀態
    while (clock.pendingWaitCount() > 0) await clock.flushNextWait();
    while (clock.pendingFrameCount() > 0) await clock.flushNextFrame(150);
    await midFlight;

    expect(previewedTop).toBe(140);
    expect(guide.setup.demoPlaying).toBe(false);
    expect(guide.setup.demoCursor).toBeNull();
  });

  it('plays the affix-selector demo, locks demoState, inserts demo filter, and restores snapshot on completion and cancellation', async () => {
    const preferences = await createTestPreferences({ displayLocale: 'zh-TW' });
    const triggerBtn = addElement('<button class="poexd-filter-select-btn"></button>', {
      top: 200,
      left: 300,
      width: 100,
      height: 30,
    });
    const sidebarRoot = document.createElement('div');
    sidebarRoot.innerHTML = `
      <div data-sidebar-dialog="affix">
        <button data-filter-action="open-type-dialog"></button>
        <input data-filter-search />
        <div data-mod-id="mod-life" data-mod-official-id="explicit.stat_3299347043">
          <button data-mod-action="add-now"></button>
        </div>
      </div>
    `;
    document.body.appendChild(sidebarRoot);
    const affixDialog = visible(sidebarRoot.querySelector('[data-sidebar-dialog="affix"]')!, {
      top: 40,
      left: 40,
      width: 900,
      height: 600,
    });
    const searchInput = visible(sidebarRoot.querySelector('[data-filter-search]')!, {
      top: 100,
      left: 100,
      width: 240,
      height: 32,
    });
    const modRow = visible(sidebarRoot.querySelector('[data-mod-id="mod-life"]')!, {
      top: 240,
      left: 100,
      width: 260,
      height: 44,
    });
    visible(modRow.querySelector('[data-mod-action="add-now"]')!, {
      top: 246,
      left: 310,
      width: 40,
      height: 24,
    });

    const typedQueries: string[] = [];
    const restoredSnapshots: FilterPaneSnapshot[] = [];
    let currentSnapshot: FilterPaneSnapshot = { selectedType: 'helmet', searchQuery: '火抗' };
    const filterHandle: FilterPaneDemoHandle = {
      isLoading: () => false,
      getSnapshot: () => ({ ...currentSnapshot }),
      restoreSnapshot: vi.fn((snap) => {
        currentSnapshot = { ...snap };
        restoredSnapshots.push(snap);
      }),
      selectTypeForDemo: vi.fn((type) => {
        currentSnapshot = { ...currentSnapshot, selectedType: type };
      }),
      setSearchQueryForDemo: vi.fn((query) => {
        currentSnapshot = { ...currentSnapshot, searchQuery: query };
        typedQueries.push(query);
      }),
      findDemoLifeMod: () => ({ id: 'mod-life', label: '+# 最大生命' }),
    };

    let modalOpen = false;
    let insertedDemoRow: Element | null = null;
    const observedHoveredIds: Array<string | null> = [];
    const clock = createControllableClock();

    const host = createFakeHost({
      preferences,
      getPoeVersion: () => 'poe2',
      getSidebarRoot: () => sidebarRoot,
      openAffixModal: vi.fn(() => {
        modalOpen = true;
      }),
      closeAffixModal: vi.fn(() => {
        modalOpen = false;
      }),
      getFilterPaneHandle: () => (modalOpen ? filterHandle : null),
      requestDemo: vi.fn(async (action) => {
        if (action === 'add-stat-filter') {
          insertedDemoRow = addElement(
            '<div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" data-tier-slot-key="slot-demo"></button></div>',
          );
          visible(insertedDemoRow.querySelector('.poexd-tier-trigger')!);
        }
        return true;
      }),
      wait: clock.wait,
      now: clock.now,
      nextAnimationFrame: clock.nextAnimationFrame,
    });

    const guide = createPageGuideSession(host, { steps });

    // 1. 完整播放
    const run1 = guide.replayStepDemo('affix-selector');
    for (let i = 0; i < 60; i += 1) {
      if (guide.demoState.affixHoveredModId !== null) {
        observedHoveredIds.push(guide.demoState.affixHoveredModId);
      }
      if (clock.pendingWaitCount() > 0) await clock.flushNextWait();
      else break;
    }
    await run1;

    expect(filterHandle.selectTypeForDemo).toHaveBeenCalledWith('body-armour');
    expect(typedQueries).toEqual(['最', '最大', '最大生', '最大生命']);
    expect(observedHoveredIds).toContain('mod-life');
    expect(host.requestDemo).toHaveBeenCalledWith('add-stat-filter');
    expect(restoredSnapshots).toEqual([{ selectedType: 'helmet', searchQuery: '火抗' }]);
    expect(modalOpen).toBe(false);
    expect(guide.demoState.affixMode).toBe(false);
    expect(guide.demoState.affixHoveredModId).toBeNull();
    expect(guide.demoSpotlightElement.value).toBeNull();
    expect(guide.demoRingElements.value).toEqual([insertedDemoRow]);
    expect(guide.setup.demoPlaying).toBe(false);
    expect(guide.setup.demoCursor).toBeNull();
    // 確保 spotlight 曾框過 affixDialog、ring 曾框過 searchInput（間接驗證沒有漏掉節點）
    expect(affixDialog).toBeDefined();
    expect(searchInput).toBeDefined();
    expect(triggerBtn).toBeDefined();

    // 2. 中途取消（打字打到一半呼叫 stop()）：應還原 FilterPaneSnapshot、關閉彈窗並重設 demoState
    restoredSnapshots.length = 0;
    typedQueries.length = 0;
    const run2 = guide.replayStepDemo('affix-selector');
    for (let i = 0; i < 30 && typedQueries.length < 2; i += 1) {
      if (clock.pendingWaitCount() > 0) await clock.flushNextWait();
    }
    expect(guide.demoState.affixMode).toBe(true);
    expect(modalOpen).toBe(true);
    expect(typedQueries.length).toBeGreaterThanOrEqual(2);

    await guide.stop();
    while (clock.pendingWaitCount() > 0) await clock.flushNextWait();
    await run2;

    expect(modalOpen).toBe(false);
    expect(restoredSnapshots).toEqual([{ selectedType: 'helmet', searchQuery: '火抗' }]);
    expect(currentSnapshot).toEqual({ selectedType: 'helmet', searchQuery: '火抗' });
    expect(guide.demoState.affixMode).toBe(false);
    expect(guide.demoState.affixHoveredModId).toBeNull();
    expect(guide.setup.demoPlaying).toBe(false);
    expect(guide.setup.demoCursor).toBeNull();
  });

  it('plays the tier-menu demo, locks tier demoState, frames row + menu, and unlocks cleanly on leave or stop', async () => {
    const tierStep: PageGuideTourStep = {
      id: 'tier',
      targetId: 'tier-trigger',
      titleKey: 'pageGuide.tour.tier.title',
      bodyKey: 'pageGuide.tour.tier.body',
      demo: 'tier-menu',
      demoTargetId: 'tier-menu',
    };
    const nextStepDef: PageGuideTourStep = {
      id: 'locale',
      titleKey: 'pageGuide.tour.locale.title',
      bodyKey: 'pageGuide.tour.locale.body',
    };

    const sidebarRoot = document.createElement('div');
    document.body.appendChild(sidebarRoot);

    let demoRow: Element | null = null;
    let openMenu: Element | null = null;

    const host = createFakeHost({
      getSidebarRoot: () => sidebarRoot,
      requestDemo: vi.fn(async (action) => {
        if (action === 'add-stat-filter') {
          demoRow = addElement(
            '<div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" data-tier-slot-key="slot-demo"></button></div>',
          );
          visible(demoRow.querySelector('.poexd-tier-trigger')!);
        } else if (action === 'restore') {
          demoRow?.remove();
          demoRow = null;
        }
        return true;
      }),
      querySidebar: (selector) => {
        if (selector === '[data-slot="dropdown-menu-content"][data-state="open"]') {
          return openMenu as any;
        }
        return sidebarRoot.querySelector(selector);
      },
    });

    // 當 tierMenuSlotKey 被設為 'slot-demo' 時，模擬獨立掛載的 TierDropdownHost 展開選單
    const guide = createPageGuideSession(host, { steps: [tierStep, nextStepDef] });
    const origWait = host.wait!;
    host.wait = async (ms) => {
      if (guide.demoState.tierMenuSlotKey === 'slot-demo' && !openMenu) {
        openMenu = document.createElement('div');
        openMenu.setAttribute('data-slot', 'dropdown-menu-content');
        openMenu.setAttribute('data-state', 'open');
        visible(openMenu, { top: 200, left: 400, width: 240, height: 300 });
        sidebarRoot.appendChild(openMenu);
      }
      await origWait(ms);
    };

    await guide.startTour();

    expect(guide.demoState.tierTriggerSlotKey).toBe('slot-demo');
    expect(guide.demoState.tierMenuSlotKey).toBe('slot-demo');
    expect(guide.demoRingElements.value).toEqual([demoRow, openMenu]);

    // 離開步驟時應解鎖並清掉 ring
    await guide.nextStep();
    expect(guide.demoState.tierTriggerSlotKey).toBeNull();
    expect(guide.demoState.tierMenuSlotKey).toBeNull();
    expect(guide.demoRingElements.value).toEqual([]);
  });

  it('cancels tier-menu demo cleanly when stopped mid-flight while polling for the dropdown menu', async () => {
    const tierStep: PageGuideTourStep = {
      id: 'tier',
      targetId: 'tier-trigger',
      titleKey: 'pageGuide.tour.tier.title',
      bodyKey: 'pageGuide.tour.tier.body',
      demo: 'tier-menu',
      demoTargetId: 'tier-menu',
    };
    const clock = createControllableClock();
    const sidebarRoot = document.createElement('div');
    document.body.appendChild(sidebarRoot);

    const demoRow = addElement(
      '<div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" data-tier-slot-key="slot-cancel"></button></div>',
    );
    visible(demoRow.querySelector('.poexd-tier-trigger')!);

    const host = createFakeHost({
      getSidebarRoot: () => sidebarRoot,
      requestDemo: vi.fn(async () => true),
      querySidebar: () => null,
      wait: clock.wait,
    });
    const guide = createPageGuideSession(host, { steps: [tierStep] });

    const startPromise = guide.startTour();
    // 推進確保示範詞綴與進入 tier-menu 輪詢，此時已鎖定 tierTriggerSlotKey / tierMenuSlotKey
    for (let i = 0; i < 6 && guide.demoState.tierMenuSlotKey === null; i += 1) {
      await clock.flushNextWait();
    }
    expect(guide.demoState.tierTriggerSlotKey).toBe('slot-cancel');
    expect(guide.demoState.tierMenuSlotKey).toBe('slot-cancel');

    // 輪詢下拉選單途中取消導覽
    await guide.stop();
    while (clock.pendingWaitCount() > 0) await clock.flushNextWait();
    await startPromise;

    expect(guide.state.mode).toBe('idle');
    expect(guide.demoState.tierTriggerSlotKey).toBeNull();
    expect(guide.demoState.tierMenuSlotKey).toBeNull();
    expect(guide.demoRingElements.value).toEqual([]);
  });

  it('temporarily expands collapsed two-column filter pane for filter/stat steps and restores it when leaving or stopping', async () => {
    const affixStep: PageGuideTourStep = {
      id: 'affix',
      targetId: 'affix-selector',
      titleKey: 'pageGuide.tour.affixSelector.title',
      bodyKey: 'pageGuide.tour.affixSelector.body',
    };
    const tierStep: PageGuideTourStep = {
      id: 'tier',
      targetId: 'tier-trigger',
      titleKey: 'pageGuide.tour.tier.title',
      bodyKey: 'pageGuide.tour.tier.body',
    };
    const resultsStep: PageGuideTourStep = {
      id: 'results',
      titleKey: 'pageGuide.tour.locale.title',
      bodyKey: 'pageGuide.tour.locale.body',
    };

    let twoColCollapsed = true;
    document.documentElement.setAttribute('data-poexd-two-column', 'active');
    document.documentElement.setAttribute('data-poexd-two-column-collapsed', 'true');

    const collapseBtn = addElement('<button class="poexd-two-col-collapse-btn"></button>');
    const affixBtn = addElement('<button class="poexd-filter-select-btn"></button>');
    const syncVisibility = () => {
      if (twoColCollapsed) {
        document.documentElement.setAttribute('data-poexd-two-column-collapsed', 'true');
        visible(affixBtn, { top: 0, left: 0, width: 0, height: 0 });
      } else {
        document.documentElement.removeAttribute('data-poexd-two-column-collapsed');
        visible(affixBtn, { top: 200, left: 20, width: 32, height: 32 });
      }
    };
    collapseBtn.addEventListener('click', () => {
      twoColCollapsed = !twoColCollapsed;
      syncVisibility();
    });
    syncVisibility();

    const host = createFakeHost({
      requestDemo: vi.fn(async (action) => {
        if (action === 'add-stat-filter') {
          const row = addElement(
            '<div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" data-tier-slot-key="slot-2col"></button></div>',
          );
          visible(row.querySelector('.poexd-tier-trigger')!);
        }
        return true;
      }),
    });

    try {
      const guide = createPageGuideSession(host, { steps: [affixStep, tierStep, resultsStep] });
      await guide.startTour();

      // 進入需要 filters 的步驟時自動展開雙欄左側篩選欄
      expect(twoColCollapsed).toBe(false);
      expect(guide.element.value).toBe(affixBtn);

      // 前進到 tier 步驟（同為 stat-filter）時維持展開
      await guide.nextStep();
      expect(twoColCollapsed).toBe(false);

      // 離開篩選步驟到結果步驟時自動還原回原本的收合狀態
      await guide.nextStep();
      expect(twoColCollapsed).toBe(true);
    } finally {
      document.documentElement.removeAttribute('data-poexd-two-column');
      document.documentElement.removeAttribute('data-poexd-two-column-collapsed');
    }
  });
});
