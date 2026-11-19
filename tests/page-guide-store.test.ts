// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    titleKey: 'pageGuide.tour.search.title',
    bodyKey: 'pageGuide.tour.search.body',
  },
  {
    id: 'tier',
    targetId: 'tier-trigger',
    titleKey: 'pageGuide.tour.tier.title',
    bodyKey: 'pageGuide.tour.tier.body',
  },
  {
    id: 'results',
    targetId: 'result-actions',
    titleKey: 'pageGuide.tour.results.title',
    bodyKey: 'pageGuide.tour.results.body',
    fallback: 'result-card',
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
    // 沒有結果時沒有元素，說明框改用示意卡
    expect(guide.element.value).toBeNull();

    await guide.previousStep();
    expect(guide.currentStep.value?.id).toBe('tier');
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
