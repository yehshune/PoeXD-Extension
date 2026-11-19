// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  findPageGuideElement,
  getPageGuideTarget,
  PAGE_GUIDE_TARGETS,
} from '@/components/sidebar/page-guide/page-guide-targets';
import { PAGE_GUIDE_TOUR_STEPS } from '@/components/sidebar/page-guide/page-guide-tour';

function setVisible(el: Element, visible: boolean) {
  const size = visible ? 10 : 0;
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: size, bottom: size, width: size, height: size }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findPageGuideElement', () => {
  it('returns the first visible element, trying selectors in order', () => {
    document.body.innerHTML = `
      <div class="search-left"><div class="multiselect" id="hidden"></div><input id="input" /></div>
    `;
    setVisible(document.getElementById('hidden')!, false);
    setVisible(document.getElementById('input')!, true);
    const found = findPageGuideElement(getPageGuideTarget('search-input'), {
      page: document,
      sidebar: null,
    });
    expect(found?.id).toBe('input');
  });

  it('skips elements clipped away by a collapsed container', () => {
    document.body.innerHTML = `
      <div id="panel" style="overflow: hidden"><button class="poexd-filter-select-btn" id="btn"></button></div>
    `;
    const button = document.getElementById('btn')!;
    button.getBoundingClientRect = () =>
      ({ top: 100, bottom: 130, left: 0, right: 40, width: 40, height: 30 }) as DOMRect;
    document.getElementById('panel')!.getBoundingClientRect = () =>
      ({ top: 90, bottom: 90, left: 0, right: 400, width: 400, height: 0 }) as DOMRect;
    const target = getPageGuideTarget('affix-selector');
    expect(findPageGuideElement(target, { page: document, sidebar: null })).toBeNull();
  });

  it('looks inside the sidebar root for sidebar targets', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<nav class="sidebar-nav"></nav>';
    setVisible(shadow.querySelector('nav')!, true);
    const target = getPageGuideTarget('sidebar-nav');
    expect(findPageGuideElement(target, { page: document, sidebar: shadow })).not.toBeNull();
    expect(findPageGuideElement(target, { page: document, sidebar: null })).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(
      findPageGuideElement(getPageGuideTarget('result-price'), { page: document, sidebar: null }),
    ).toBeNull();
  });

  it('ignores mock results when resolving real result targets', () => {
    document.body.innerHTML = `
      <div class="results" data-poexd-guide-mock>
        <div class="row" data-id="m1">
          <div class="poexd-filter-mod-highlight"><span class="poexd-result-mod-en">life</span></div>
        </div>
      </div>
    `;
    setVisible(document.querySelector('.poexd-filter-mod-highlight')!, true);
    setVisible(document.querySelector('.poexd-result-mod-en')!, true);
    expect(
      findPageGuideElement(getPageGuideTarget('result-mod-highlight'), {
        page: document,
        sidebar: null,
      }),
    ).toBeNull();
    expect(
      findPageGuideElement(getPageGuideTarget('result-mod-en'), {
        page: document,
        sidebar: null,
      }),
    ).toBeNull();
  });

  it('prefers the demo tier trigger when multiple triggers exist', () => {
    document.body.innerHTML = `
      <div class="filter"><button class="poexd-tier-trigger" id="existing"></button></div>
      <div class="filter" data-poexd-page-guide-demo="true"><button class="poexd-tier-trigger" id="demo"></button></div>
    `;
    setVisible(document.getElementById('existing')!, true);
    setVisible(document.getElementById('demo')!, true);
    expect(
      findPageGuideElement(getPageGuideTarget('tier-trigger'), {
        page: document,
        sidebar: null,
      })?.id,
    ).toBe('demo');
  });
});

describe('page guide tour', () => {
  it('only points at known targets', () => {
    for (const step of PAGE_GUIDE_TOUR_STEPS) {
      if (step.targetId) expect(PAGE_GUIDE_TARGETS).toHaveProperty(step.targetId);
    }
  });

  it('only leaves setup steps without a target', () => {
    const untargeted = PAGE_GUIDE_TOUR_STEPS.filter((step) => !step.targetId);
    expect(untargeted.every((step) => step.setup)).toBe(true);
  });

  it('starts with the language step so later steps use the chosen language', () => {
    expect(PAGE_GUIDE_TOUR_STEPS[0]?.setup).toBe('locale');
  });

  it('teaches result features on the mock row instead of waiting for real results', () => {
    const resultSteps = PAGE_GUIDE_TOUR_STEPS.filter((step) => step.demoFocus);
    expect(resultSteps.map((step) => step.demoFocus)).toEqual(['actions', 'mods', 'price']);
    expect(resultSteps.every((step) => step.targetId?.startsWith('mock-result-'))).toBe(true);
    expect(resultSteps.every((step) => step.setup === 'result-features')).toBe(true);
    expect(
      PAGE_GUIDE_TOUR_STEPS.some(
        (step) => step.targetId && getPageGuideTarget(step.targetId).needs === 'results',
      ),
    ).toBe(false);
  });
});
