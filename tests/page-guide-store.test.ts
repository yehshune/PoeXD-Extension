// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createPageGuide, type PageGuideDeps } from '@/components/sidebar/page-guide/usePageGuide';
import type { PageGuideTourStep } from '@/components/sidebar/page-guide/page-guide-tour';

function visible(el: Element) {
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 }) as DOMRect;
  return el;
}

function addElement(html: string): Element {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const el = wrapper.firstElementChild!;
  document.body.appendChild(el);
  return visible(el);
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

function createDeps(overrides: Partial<PageGuideDeps> = {}): PageGuideDeps {
  return {
    steps,
    requestDemo: vi.fn(async (action) => {
      if (action === 'add-stat-filter') addElement('<span class="poexd-tier-trigger"></span>');
      return true;
    }),
    notify: vi.fn(),
    wait: async () => {},
    scrollIntoView: vi.fn(),
    revealResults: vi.fn(),
    ...overrides,
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
    const deps = createDeps();
    const guide = createPageGuide(deps);
    const input = addElement('<div class="search-bar"></div>');

    await guide.pointAt('search-input', '模糊搜尋');

    expect(deps.scrollIntoView).toHaveBeenCalledWith(input);
    expect(guide.state.mode).toBe('point');
    expect(guide.state.label).toBe('模糊搜尋');
    expect(guide.element.value).toBe(input);

    await vi.advanceTimersByTimeAsync(3300);
    expect(guide.state.mode).toBe('idle');
    expect(guide.element.value).toBeNull();
  });

  it('asks for a search first when the target needs results', async () => {
    const deps = createDeps();
    const guide = createPageGuide(deps);

    await guide.pointAt('result-price', '價格換算');

    expect(guide.state.mode).toBe('idle');
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('搜尋'));
  });

  it('adds a demo stat filter for the tier button and restores it afterwards', async () => {
    const deps = createDeps();
    const guide = createPageGuide(deps);

    await guide.pointAt('tier-trigger', 'T 階');
    expect(deps.requestDemo).toHaveBeenCalledWith('add-stat-filter');
    expect(guide.state.mode).toBe('point');

    await vi.advanceTimersByTimeAsync(3300);
    expect(deps.requestDemo).toHaveBeenLastCalledWith('restore');
  });

  it('does not touch the form when the tier button already exists', async () => {
    const deps = createDeps();
    const guide = createPageGuide(deps);
    addElement('<span class="poexd-tier-trigger"></span>');

    await guide.pointAt('tier-trigger', 'T 階');
    await guide.stop();

    expect(deps.requestDemo).not.toHaveBeenCalled();
  });
});

describe('filters panel', () => {
  it('asks the page to open the filter panel for the affix selector', async () => {
    const deps = createDeps({
      requestDemo: vi.fn(async (action) => {
        if (action === 'show-filters')
          addElement('<button class="poexd-filter-select-btn"></button>');
        return true;
      }),
    });
    const guide = createPageGuide(deps);

    await guide.pointAt('affix-selector', '詞綴選擇器');
    expect(deps.requestDemo).toHaveBeenCalledWith('show-filters');
    expect(guide.state.mode).toBe('point');

    await guide.stop();
    expect(deps.requestDemo).toHaveBeenLastCalledWith('restore');
  });
});

describe('tour', () => {
  it('walks the steps and restores the demo filter when leaving its step', async () => {
    const deps = createDeps();
    const guide = createPageGuide(deps);
    addElement('<div class="search-bar"></div>');

    await guide.startTour();
    expect(guide.currentStep.value?.id).toBe('search');

    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('tier');
    expect(deps.requestDemo).toHaveBeenCalledWith('add-stat-filter');

    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('results');
    expect(deps.requestDemo).toHaveBeenLastCalledWith('restore');
    // 示意結果列由 PageGuideHost 畫出，這裡沒有掛載所以找不到元素
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
    const guide = createPageGuide(createDeps({ steps: tourSteps, requestDemo }));

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
    const guide = createPageGuide(createDeps({ requestDemo }));

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
    const guide = createPageGuide(
      createDeps({
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
    );

    await guide.startTour();
    await guide.nextStep();

    expect(guide.currentStep.value?.id).toBe('tier');
    expect(guide.element.value).not.toBe(existingTrigger);
    expect((guide.element.value as HTMLElement)?.id).toBe('delayed-demo');
  });

  it('shows the mock result only for result steps and hides it on stop', async () => {
    const deps = createDeps();
    const guide = createPageGuide(deps);
    await guide.startTour();
    expect(guide.state.demoFocus).toBeNull();
    await guide.nextStep();
    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('results');
    expect(guide.state.demoFocus).toBe('actions');
    // 示意結果列取代真實結果，不再去展開官方結果的按鈕
    expect(deps.revealResults).toHaveBeenLastCalledWith(false);

    await guide.previousStep();
    expect(guide.state.demoFocus).toBeNull();
    await guide.stop();
    expect(guide.state.demoFocus).toBeNull();
  });

  it('frames the mock row once it renders for the result step', async () => {
    const guide = createPageGuide(createDeps({ steps: [steps[2]!] }));
    const mock = addElement(
      '<div data-poexd-guide-mock><div class="row"><div class="poexd-left-actions"></div></div></div>',
    );
    visible(mock.querySelector('.poexd-left-actions')!);

    await guide.startTour();
    expect(guide.element.value).toBe(mock.querySelector('.poexd-left-actions'));
  });

  it('ends after the last step and on stop, always restoring the demo', async () => {
    const deps = createDeps();
    const guide = createPageGuide(deps);

    await guide.startTour();
    await guide.nextStep();
    await guide.stop();
    expect(guide.state.mode).toBe('idle');
    expect(deps.requestDemo).toHaveBeenLastCalledWith('restore');

    await guide.startTour();
    await guide.nextStep();
    await guide.nextStep();
    await guide.nextStep();
    expect(guide.state.mode).toBe('idle');
  });

  it('ignores a step that finishes loading after the tour was stopped', async () => {
    let release: () => void = () => {};
    const deps = createDeps({
      requestDemo: vi.fn(
        (action) =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(true);
            if (action === 'restore') resolve(true);
          }),
      ),
    });
    const guide = createPageGuide(deps);
    await guide.startTour();
    const pending = guide.nextStep();
    await guide.stop();
    release();
    await pending;
    expect(guide.state.mode).toBe('idle');
  });
});

describe('tour context', () => {
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
      id: 'collapse',
      targetId: 'sidebar-collapse',
      titleKey: 'pageGuide.tour.collapse.title',
      bodyKey: 'pageGuide.tour.collapse.body',
    },
  ];

  it('re-evaluates conditional steps while the tour runs', async () => {
    const guide = createPageGuide(createDeps({ steps: conditionalSteps }));
    const offer = ref(false);
    guide.setTourContext({
      isConditionMet: () => offer.value,
      prepareStep: async () => {},
      runStepDemo: async () => {},
      stopStepDemo: () => {},
    });

    await guide.startTour();
    expect(guide.currentStep.value?.id).toBe('locale');
    // 沒有目標的步驟不去找元素
    expect(guide.element.value).toBeNull();
    expect(guide.stepCount.value).toBe(2);

    // 例如第一步把語言改成中文，市集漢化步驟隨之出現
    offer.value = true;
    expect(guide.stepCount.value).toBe(3);
    await guide.nextStep();
    expect(guide.currentStep.value?.id).toBe('market-translation');
    expect(guide.stepNumber.value).toBe(2);
  });

  it('prepares each step before locating its target', async () => {
    const guide = createPageGuide(createDeps({ steps: conditionalSteps }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    guide.setSidebarRoot(root);
    const prepareStep = vi.fn(async (step: PageGuideTourStep) => {
      if (step.id === 'collapse') {
        root.innerHTML = '<button data-sidebar-action="collapse"></button>';
        visible(root.firstElementChild!);
      }
    });
    guide.setTourContext({
      isConditionMet: () => false,
      prepareStep,
      runStepDemo: async () => {},
      stopStepDemo: () => {},
    });

    await guide.startTour();
    await guide.nextStep();
    expect(prepareStep).toHaveBeenCalledTimes(2);
    expect(guide.element.value).toBe(root.firstElementChild);
  });

  it('switches to the next visible selector when the target disappears', async () => {
    const guide = createPageGuide(createDeps({ steps: [conditionalSteps[2]!] }));
    const root = document.createElement('div');
    root.innerHTML =
      '<button data-sidebar-action="collapse"></button><button data-sidebar-action="expand"></button>';
    document.body.appendChild(root);
    guide.setSidebarRoot(root);
    const [collapse, expand] = Array.from(root.children);
    visible(collapse!);

    await guide.startTour();
    expect(guide.element.value).toBe(collapse);

    collapse!.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
    visible(expand!);
    guide.refreshElement();
    expect(guide.element.value).toBe(expand);
  });

  it('runs the step demo and moves the frame to the demo target', async () => {
    const tierStep: PageGuideTourStep = {
      id: 'tier',
      targetId: 'tier-trigger',
      titleKey: 'pageGuide.tour.tier.title',
      bodyKey: 'pageGuide.tour.tier.body',
      demo: 'tier-menu',
      demoTargetId: 'tier-menu',
    };
    const guide = createPageGuide(createDeps({ steps: [tierStep, conditionalSteps[0]!] }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    guide.setSidebarRoot(root);
    const runStepDemo = vi.fn(async () => {
      root.innerHTML = '<div data-slot="dropdown-menu-content" data-state="open"></div>';
      visible(root.firstElementChild!);
    });
    const stopStepDemo = vi.fn();
    guide.setTourContext({
      isConditionMet: () => false,
      prepareStep: async () => {},
      runStepDemo,
      stopStepDemo,
    });

    await guide.startTour();
    expect(runStepDemo).toHaveBeenCalledWith('tier-menu');
    expect(guide.element.value).toBe(root.firstElementChild);

    stopStepDemo.mockClear();
    await guide.nextStep();
    expect(stopStepDemo).toHaveBeenCalled();
    expect(runStepDemo).toHaveBeenCalledTimes(1);

    stopStepDemo.mockClear();
    await guide.stop();
    expect(stopStepDemo).toHaveBeenCalled();
  });
});
