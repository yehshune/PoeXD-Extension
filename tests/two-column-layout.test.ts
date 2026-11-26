// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TWO_COLUMN_ATTR,
  TWO_COLUMN_COLLAPSED_ATTR,
  TWO_COLUMN_COLLAPSE_BTN_CLASS,
  TWO_COLUMN_HEADER_OPEN_ATTR,
  TWO_COLUMN_HEADER_TAB_CLASS,
  TWO_COLUMN_HIDE_HEADER_ATTR,
  TWO_COLUMN_MAX_WIDTH_VAR,
  TWO_COLUMN_SPLITTER_CLASS,
  TWO_COLUMN_STYLE_ID,
  TWO_COLUMN_TOP_BTN_CLASS,
  TWO_COLUMN_WIDTH_VAR,
  buildTwoColumnLayoutCss,
  createTwoColumnLayoutController,
} from '@/entrypoints/content/logic/two-column-layout';
import {
  TWO_COLUMN_COLLAPSED_WIDTH,
  TWO_COLUMN_DEFAULT_FILTER_WIDTH,
  TWO_COLUMN_MIN_CONTENT_WIDTH,
  clampTwoColumnFilterWidth,
  isTwoColumnEligiblePath,
  resolveTwoColumnGeometry,
  resolveTwoColumnMaxWidthPx,
} from '@/utils/two-column-layout';

function mountMockTradeDom(contentWidth = 1280, includeResults = true): HTMLElement {
  const resultsMarkup = includeResults
    ? `
      <div class="results compact two">
        <div class="row row-total"></div>
        <div class="resultset"></div>
        <div class="row controls">
          <button type="button" class="btn load-more-btn">Load More</button>
        </div>
      </div>
    `
    : '';
  document.body.innerHTML = `
    <div class="content">
      <div class="wrapper">
        <div id="statusBar"></div>
        <div class="linkBack"></div>
        <div class="logo"></div>
        <div class="language-select"></div>
        <div id="trade">
          <div class="navigation"></div>
          <div class="top">
            <div class="search-panel">
              <div class="search-bar"></div>
              <div class="search-bar search-advanced"></div>
              <div class="controls"></div>
            </div>
          </div>
          <div id="vue3-portal">${resultsMarkup}</div>
        </div>
      </div>
    </div>
  `;
  const content = document.querySelector<HTMLElement>('.content')!;
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
    width: contentWidth,
    height: 900,
    top: 0,
    left: 0,
    right: contentWidth,
    bottom: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return content;
}

describe('two-column-layout pure geometry', () => {
  it('accepts PoE 1 and PoE 2 search/live paths and excludes exchange/settings/about/history', () => {
    expect(isTwoColumnEligiblePath('/trade')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade2')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/search/Covens')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/search/Covens/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade2/search/poe2/Dawn/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/live/Covens/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade2/live/poe2/Dawn/abc123')).toBe(true);

    expect(isTwoColumnEligiblePath('/trade/exchange/Covens')).toBe(false);
    expect(isTwoColumnEligiblePath('/trade2/exchange/poe2/Dawn')).toBe(false);
    expect(isTwoColumnEligiblePath('/trade/about')).toBe(false);
    expect(isTwoColumnEligiblePath('/trade/settings')).toBe(false);
    expect(isTwoColumnEligiblePath('/trade/history')).toBe(false);
    expect(isTwoColumnEligiblePath('')).toBe(false);
  });

  it('resolves max width presets, defaults to 560px single-row width, and clamps up to 1200px safely', () => {
    expect(TWO_COLUMN_DEFAULT_FILTER_WIDTH).toBe(560);
    expect(resolveTwoColumnMaxWidthPx('full')).toBeNull();
    expect(resolveTwoColumnMaxWidthPx('2200')).toBe(2200);
    expect(resolveTwoColumnMaxWidthPx('1920')).toBe(1920);
    expect(resolveTwoColumnMaxWidthPx('1600')).toBe(1600);

    expect(clampTwoColumnFilterWidth(560, 1400).clamped).toBe(560);
    expect(clampTwoColumnFilterWidth(200, 1400).clamped).toBe(360);
    expect(clampTwoColumnFilterWidth(1050, 2560).clamped).toBe(1050);
    expect(clampTwoColumnFilterWidth(1500, 2560).clamped).toBe(1200);
    expect(clampTwoColumnFilterWidth(1200, 2560, '1600')).toEqual({
      clamped: 1048,
      maxFilterWidth: 1048,
    });
    expect(clampTwoColumnFilterWidth(600, 1020)).toEqual({ clamped: 468, maxFilterWidth: 468 });
  });

  it('falls back cleanly when disabled, on console role, ineligible route, or narrow container', () => {
    expect(
      resolveTwoColumnGeometry({
        enabled: false,
        pageRole: 'normal',
        pathname: '/trade/search/Covens',
        contentWidth: 1400,
        preferredFilterWidth: 560,
        filtersCollapsed: false,
      }),
    ).toMatchObject({ active: false, reason: 'disabled' });

    expect(
      resolveTwoColumnGeometry({
        enabled: true,
        pageRole: 'live-search-primary',
        pathname: '/trade/search/Covens',
        contentWidth: 1400,
        preferredFilterWidth: 560,
        filtersCollapsed: false,
      }),
    ).toMatchObject({ active: false, reason: 'non-normal-role' });

    expect(
      resolveTwoColumnGeometry({
        enabled: true,
        pageRole: 'normal',
        pathname: '/trade/exchange/Covens',
        contentWidth: 1400,
        preferredFilterWidth: 560,
        filtersCollapsed: false,
      }),
    ).toMatchObject({ active: false, reason: 'ineligible-route' });

    expect(
      resolveTwoColumnGeometry({
        enabled: true,
        pageRole: 'normal',
        pathname: '/trade/search/Covens',
        contentWidth: TWO_COLUMN_MIN_CONTENT_WIDTH - 1,
        preferredFilterWidth: 560,
        filtersCollapsed: false,
      }),
    ).toMatchObject({ active: false, reason: 'narrow' });

    expect(
      resolveTwoColumnGeometry({
        enabled: true,
        pageRole: 'normal',
        pathname: '/trade/search/Covens',
        contentWidth: 2560,
        preferredFilterWidth: 960,
        maxWidth: '1920',
        filtersCollapsed: true,
      }),
    ).toMatchObject({
      active: true,
      reason: 'active',
      leftWidth: TWO_COLUMN_COLLAPSED_WIDTH,
      maxWidthCss: '1920px',
      filtersCollapsed: true,
    });
  });
});

describe('createTwoColumnLayoutController', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/trade/search/Covens');
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(TWO_COLUMN_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_COLLAPSED_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HIDE_HEADER_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HEADER_OPEN_ATTR);
    document.documentElement.style.removeProperty(TWO_COLUMN_WIDTH_VAR);
    document.documentElement.style.removeProperty(TWO_COLUMN_MAX_WIDTH_VAR);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(TWO_COLUMN_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_COLLAPSED_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HIDE_HEADER_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HEADER_OPEN_ATTR);
    document.documentElement.style.removeProperty(TWO_COLUMN_WIDTH_VAR);
    document.documentElement.style.removeProperty(TWO_COLUMN_MAX_WIDTH_VAR);
  });

  it('uses Theme Bridge CSS vars & oklch fallbacks, locks viewport scroll, preserves native compact-two, and protects button overflow', () => {
    const css = buildTwoColumnLayoutCss();
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\s*\(/i);
    expect(css).toContain('oklch(');
    expect(css).toContain('var(--card');
    expect(css).toContain('var(--border');
    expect(css).toContain('var(--primary');
    expect(css).toContain('height: 100vh !important;');
    expect(css).toContain('overflow-y: auto !important;');
    expect(css).toContain('.results > .row.row-total');
    expect(css).toContain('.results.compact:not(.two) .resultset');
    expect(css).toContain('align-items: stretch !important;');
    expect(css).toContain('max-width: 760px !important;');
    expect(css).toContain('min-width: 480px');
    expect(css).toContain('min-width: 560px');
    expect(css).toContain('min-width: 920px');
    expect(css).toContain('clamp(280px, 42vh, 460px)');
    expect(css).toContain('text-overflow: ellipsis !important;');
    expect(css).not.toContain('repeat(3, minmax(0, 1fr))');
    expect(css).not.toContain('.search-advanced-pane.brown {\n      order: -1');
    expect(css).toContain(TWO_COLUMN_MAX_WIDTH_VAR);
  });

  it('activates via batch applyConfig, manages header overlay, toggles collapse, and cleans up completely', () => {
    vi.useFakeTimers();
    mountMockTradeDom(2560);
    const onCommit = vi.fn();
    const controller = createTwoColumnLayoutController({ onFilterWidthCommit: onCommit });

    controller.applyConfig({
      enabled: true,
      preferredFilterWidth: 960,
      maxWidth: '1920',
      autoHideHeader: true,
    });

    expect(document.documentElement.getAttribute(TWO_COLUMN_ATTR)).toBe('active');
    expect(document.documentElement.style.getPropertyValue(TWO_COLUMN_WIDTH_VAR)).toBe('960px');
    expect(document.documentElement.style.getPropertyValue(TWO_COLUMN_MAX_WIDTH_VAR)).toBe(
      '1920px',
    );
    expect(document.documentElement.getAttribute(TWO_COLUMN_HIDE_HEADER_ATTR)).toBe('true');
    expect(document.getElementById(TWO_COLUMN_STYLE_ID)).not.toBeNull();

    const headerTab = document.querySelector<HTMLButtonElement>(`.${TWO_COLUMN_HEADER_TAB_CLASS}`);
    expect(headerTab).not.toBeNull();
    headerTab!.dispatchEvent(new Event('pointerenter'));
    expect(document.documentElement.hasAttribute(TWO_COLUMN_HEADER_OPEN_ATTR)).toBe(false);
    vi.advanceTimersByTime(150);
    expect(document.documentElement.getAttribute(TWO_COLUMN_HEADER_OPEN_ATTR)).toBe('true');

    headerTab!.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(300);
    expect(document.documentElement.hasAttribute(TWO_COLUMN_HEADER_OPEN_ATTR)).toBe(false);

    controller.applyConfig({ autoHideHeader: false });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_HIDE_HEADER_ATTR)).toBe(false);
    expect(document.querySelector(`.${TWO_COLUMN_HEADER_TAB_CLASS}`)).toBeNull();

    const splitter = document.querySelector<HTMLElement>(`.${TWO_COLUMN_SPLITTER_CLASS}`);
    const collapseBtn = document.querySelector<HTMLButtonElement>(
      `.${TWO_COLUMN_COLLAPSE_BTN_CLASS}`,
    );
    expect(splitter).not.toBeNull();
    expect(collapseBtn).not.toBeNull();

    collapseBtn!.click();
    expect(document.documentElement.getAttribute(TWO_COLUMN_COLLAPSED_ATTR)).toBe('true');
    expect(document.documentElement.style.getPropertyValue(TWO_COLUMN_WIDTH_VAR)).toBe(
      `${TWO_COLUMN_COLLAPSED_WIDTH}px`,
    );

    collapseBtn!.click();
    expect(document.documentElement.hasAttribute(TWO_COLUMN_COLLAPSED_ATTR)).toBe(false);
    expect(document.documentElement.style.getPropertyValue(TWO_COLUMN_WIDTH_VAR)).toBe('960px');

    splitter!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onCommit).toHaveBeenCalledWith(TWO_COLUMN_DEFAULT_FILTER_WIDTH);

    controller.applyConfig({ enabled: false });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_ATTR)).toBe(false);
    expect(document.getElementById(TWO_COLUMN_STYLE_ID)).toBeNull();
    expect(document.querySelector(`.${TWO_COLUMN_SPLITTER_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${TWO_COLUMN_TOP_BTN_CLASS}`)).toBeNull();

    controller.cleanup();
  });

  it('bridges late-mounted .results inside #vue3-portal and triggers load-more even with tiny scroll distance', async () => {
    // Start with a blank search page (no .results inside #vue3-portal yet)
    mountMockTradeDom(2560, false);
    let currentTime = 5000;
    const controller = createTwoColumnLayoutController({ now: () => currentTime });
    controller.applyConfig({ enabled: true });

    expect(document.querySelector(`.${TWO_COLUMN_TOP_BTN_CLASS}`)).toBeNull();

    // Vue mounts .results dynamically inside #vue3-portal after user clicks Search
    const portal = document.getElementById('vue3-portal')!;
    portal.innerHTML = `
      <div class="results compact two">
        <div class="row row-total"></div>
        <div class="resultset"></div>
        <div class="row controls">
          <button type="button" class="btn load-more-btn">Load More</button>
        </div>
      </div>
    `;
    await Promise.resolve();

    const resultsEl = document.querySelector<HTMLElement>('#trade .results')!;
    const loadMoreBtn = document.querySelector<HTMLButtonElement>('.load-more-btn')!;
    const topBtn = document.querySelector<HTMLButtonElement>(`.${TWO_COLUMN_TOP_BTN_CLASS}`)!;
    expect(topBtn).not.toBeNull();

    const clickSpy = vi.fn();
    loadMoreBtn.addEventListener('click', clickSpy);

    // Simulate a 2K screen where total scroll room is only 20px (<= 40px)
    Object.defineProperty(resultsEl, 'clientHeight', { value: 1200, configurable: true });
    Object.defineProperty(resultsEl, 'scrollHeight', { value: 1220, configurable: true });

    resultsEl.scrollTop = 10;
    resultsEl.dispatchEvent(new Event('scroll'));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Cooldown prevents immediate double-fire
    currentTime += 300;
    resultsEl.scrollTop = 20;
    resultsEl.dispatchEvent(new Event('scroll'));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // After cooldown, scrolling again triggers load-more
    currentTime += 1500;
    resultsEl.scrollTop = 20;
    resultsEl.dispatchEvent(new Event('scroll'));
    expect(clickSpy).toHaveBeenCalledTimes(2);

    controller.cleanup();
  });

  it('deactivates automatically on live-search-primary role or exchange route', () => {
    mountMockTradeDom(1400);
    const controller = createTwoColumnLayoutController();
    controller.applyConfig({ enabled: true });
    expect(document.documentElement.getAttribute(TWO_COLUMN_ATTR)).toBe('active');

    controller.applyConfig({ pageRole: 'live-search-primary' });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_ATTR)).toBe(false);

    controller.applyConfig({ pageRole: 'normal' });
    expect(document.documentElement.getAttribute(TWO_COLUMN_ATTR)).toBe('active');

    window.history.replaceState({}, '', '/trade/exchange/Covens');
    controller.sync();
    expect(document.documentElement.hasAttribute(TWO_COLUMN_ATTR)).toBe(false);

    controller.cleanup();
  });
});
