// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TWO_COLUMN_ATTR,
  TWO_COLUMN_NARROW_ATTR,
  TWO_COLUMN_COLLAPSED_ATTR,
  TWO_COLUMN_COLLAPSE_BTN_CLASS,
  TWO_COLUMN_CONTROLS_ATTR,
  TWO_COLUMN_FILTERS_ATTR,
  TWO_COLUMN_HEADER_OPEN_ATTR,
  TWO_COLUMN_HEADER_TAB_CLASS,
  TWO_COLUMN_HIDE_HEADER_ATTR,
  TWO_COLUMN_MAX_WIDTH_VAR,
  TWO_COLUMN_RESULTS_ATTR,
  TWO_COLUMN_SEARCH_BAR_ATTR,
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
  it('accepts PoE 1 and PoE 2 search/live/exchange paths and excludes settings/about/history', () => {
    expect(isTwoColumnEligiblePath('/trade')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade2')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/search/Covens')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/search/Covens/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade2/search/poe2/Dawn/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/live/Covens/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade2/live/poe2/Dawn/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/exchange/Covens')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade/exchange/Covens/abc123')).toBe(true);
    expect(isTwoColumnEligiblePath('/trade2/exchange/poe2/Dawn')).toBe(true);

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
        pathname: '/trade/history',
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
      resultsWidth: 1920 - TWO_COLUMN_COLLAPSED_WIDTH - 12,
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
    document.documentElement.removeAttribute(TWO_COLUMN_NARROW_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_COLLAPSED_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HIDE_HEADER_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HEADER_OPEN_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_SEARCH_BAR_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_CONTROLS_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_FILTERS_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_RESULTS_ATTR);
    document.documentElement.style.removeProperty(TWO_COLUMN_WIDTH_VAR);
    document.documentElement.style.removeProperty(TWO_COLUMN_MAX_WIDTH_VAR);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(TWO_COLUMN_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_NARROW_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_COLLAPSED_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HIDE_HEADER_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_HEADER_OPEN_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_SEARCH_BAR_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_CONTROLS_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_FILTERS_ATTR);
    document.documentElement.removeAttribute(TWO_COLUMN_RESULTS_ATTR);
    document.documentElement.style.removeProperty(TWO_COLUMN_WIDTH_VAR);
    document.documentElement.style.removeProperty(TWO_COLUMN_MAX_WIDTH_VAR);
  });

  it('uses PoE-native oklch styles, avoids scroll-jank CSS (no backdrop-filter or container-type), and promotes GPU scroll layers', () => {
    const css = buildTwoColumnLayoutCss();
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\s*\(/i);
    expect(css).toContain('oklch(');
    // Host-native controls do NOT follow PoeXD light/dark sidebar themes
    expect(css).not.toContain('var(--card');
    expect(css).not.toContain('var(--primary');
    // Scroll performance invariants: no backdrop-filter blur, no container-type, no will-change layer spikes, and offscreen row virtualization
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('container-type');
    expect(css).not.toContain('will-change: scroll-position');
    expect(css).toContain('content-visibility: auto !important;');
    expect(css).toContain('contain-intrinsic-block-size: auto 280px !important;');
    expect(css).toContain('contain-intrinsic-block-size: auto 81px !important;');
    expect(css).toContain('overscroll-behavior: contain !important;');
    expect(css).toContain('contain: paint !important;');
    expect(css).toContain('display: flow-root !important;');
    expect(css).toContain('height: 100vh !important;');
    expect(css).toContain('overflow-y: auto !important;');
    expect(css).toContain('.results > .row.row-total');
    expect(css).toContain('.results.compact:not(.two) .resultset');
    expect(css).toContain('.search-advanced-items.exchange > .search-advanced-pane');
    expect(css).toContain('.resultset.exchange > .row.exchange');
    expect(css).toContain('align-items: stretch !important;');
    expect(css).toContain('max-width: 760px !important;');
    expect(css).toContain('clamp(280px, 42vh, 460px)');
    expect(css).toContain('text-overflow: ellipsis !important;');
    expect(css).not.toContain('repeat(3, minmax(0, 1fr))');
    expect(css).not.toContain('.search-advanced-pane.brown {\n      order: -1');
    expect(css).toContain(TWO_COLUMN_MAX_WIDTH_VAR);
  });

  it('activates via batch applyConfig, sets responsive breakpoint attributes, manages header overlay, and cleans up completely', () => {
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

    const tradeEl = document.querySelector<HTMLElement>('#trade')!;
    const wrapperEl = document.querySelector<HTMLElement>('.wrapper')!;
    expect(document.documentElement.getAttribute(TWO_COLUMN_ATTR)).toBe('active');
    expect(tradeEl.style.getPropertyValue('grid-template-columns')).toBe('960px minmax(0, 1fr)');
    expect(wrapperEl.style.getPropertyValue('max-width')).toBe('1920px');
    // 不在 <html> 寫入動態 CSS 變數，避免觸發整份文件 2 萬+ 節點樣式重算
    expect(document.documentElement.style.getPropertyValue(TWO_COLUMN_WIDTH_VAR)).toBe('');
    expect(document.documentElement.style.getPropertyValue(TWO_COLUMN_MAX_WIDTH_VAR)).toBe('');
    expect(document.documentElement.getAttribute(TWO_COLUMN_SEARCH_BAR_ATTR)).toBe('single');
    expect(document.documentElement.getAttribute(TWO_COLUMN_CONTROLS_ATTR)).toBe('single');
    expect(document.documentElement.getAttribute(TWO_COLUMN_FILTERS_ATTR)).toBe('wide');
    // At 1920px maxWidth with 960px left column, resultsWidth = 948px (< 1060px -> narrow)
    expect(document.documentElement.getAttribute(TWO_COLUMN_RESULTS_ATTR)).toBe('narrow');
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

    // Collapsing left pane widens results pane past 1060px -> results becomes 'wide'
    collapseBtn!.click();
    expect(document.documentElement.getAttribute(TWO_COLUMN_COLLAPSED_ATTR)).toBe('true');
    expect(document.documentElement.getAttribute(TWO_COLUMN_RESULTS_ATTR)).toBe('wide');
    expect(tradeEl.style.getPropertyValue('grid-template-columns')).toBe(
      `${TWO_COLUMN_COLLAPSED_WIDTH}px minmax(0, 1fr)`,
    );

    collapseBtn!.click();
    expect(document.documentElement.hasAttribute(TWO_COLUMN_COLLAPSED_ATTR)).toBe(false);
    expect(tradeEl.style.getPropertyValue('grid-template-columns')).toBe('960px minmax(0, 1fr)');

    splitter!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onCommit).toHaveBeenCalledWith(TWO_COLUMN_DEFAULT_FILTER_WIDTH);

    controller.applyConfig({ enabled: false });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_ATTR)).toBe(false);
    expect(document.documentElement.hasAttribute(TWO_COLUMN_RESULTS_ATTR)).toBe(false);
    expect(tradeEl.style.getPropertyValue('grid-template-columns')).toBe('');
    expect(wrapperEl.style.getPropertyValue('max-width')).toBe('');
    expect(document.getElementById(TWO_COLUMN_STYLE_ID)).toBeNull();
    expect(document.querySelector(`.${TWO_COLUMN_SPLITTER_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${TWO_COLUMN_TOP_BTN_CLASS}`)).toBeNull();

    controller.cleanup();
  });

  it('bridges late-mounted .results inside #vue3-portal and triggers load-more via rAF without hot-path layout thrashing', async () => {
    vi.useFakeTimers();
    mountMockTradeDom(2560, false);
    let currentTime = 5000;
    const controller = createTwoColumnLayoutController({ now: () => currentTime });
    controller.applyConfig({ enabled: true });

    expect(document.querySelector(`.${TWO_COLUMN_TOP_BTN_CLASS}`)).toBeNull();

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

    Object.defineProperty(resultsEl, 'clientHeight', { value: 1200, configurable: true });
    Object.defineProperty(resultsEl, 'scrollHeight', { value: 1220, configurable: true });

    resultsEl.scrollTop = 10;
    resultsEl.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(32);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Cooldown prevents immediate double-fire
    currentTime += 300;
    resultsEl.scrollTop = 20;
    resultsEl.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(32);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // After cooldown, scrolling again triggers load-more
    currentTime += 1500;
    resultsEl.scrollTop = 20;
    resultsEl.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(32);
    expect(clickSpy).toHaveBeenCalledTimes(2);

    controller.cleanup();
  });

  it('stays active on exchange route and deactivates automatically on live-search-primary role or history route', () => {
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
    expect(document.documentElement.getAttribute(TWO_COLUMN_ATTR)).toBe('active');

    window.history.replaceState({}, '', '/trade/history');
    controller.sync();
    expect(document.documentElement.hasAttribute(TWO_COLUMN_ATTR)).toBe(false);

    controller.cleanup();
  });

  it('supports auto-hiding official header in single-column mode and marks narrow fallback state', () => {
    mountMockTradeDom(TWO_COLUMN_MIN_CONTENT_WIDTH - 40);
    const controller = createTwoColumnLayoutController();

    // Single-column mode (enabled: false) still hides official header when autoHideHeader is true
    controller.applyConfig({ enabled: false, autoHideHeader: true });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_ATTR)).toBe(false);
    expect(document.documentElement.getAttribute(TWO_COLUMN_HIDE_HEADER_ATTR)).toBe('true');
    expect(document.querySelector(`.${TWO_COLUMN_HEADER_TAB_CLASS}`)).not.toBeNull();
    expect(document.getElementById(TWO_COLUMN_STYLE_ID)).not.toBeNull();

    // Narrow fallback sets TWO_COLUMN_NARROW_ATTR while keeping single-column header hide intact
    controller.applyConfig({ enabled: true, autoHideHeader: true });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_ATTR)).toBe(false);
    expect(document.documentElement.getAttribute(TWO_COLUMN_NARROW_ATTR)).toBe('true');
    expect(document.documentElement.getAttribute(TWO_COLUMN_HIDE_HEADER_ATTR)).toBe('true');

    // Disabling autoHideHeader removes header controls while keeping narrow marker for two-column
    controller.applyConfig({ autoHideHeader: false });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_HIDE_HEADER_ATTR)).toBe(false);
    expect(document.querySelector(`.${TWO_COLUMN_HEADER_TAB_CLASS}`)).toBeNull();
    expect(document.documentElement.getAttribute(TWO_COLUMN_NARROW_ATTR)).toBe('true');

    // Disabling two-column clears narrow marker too
    controller.applyConfig({ enabled: false });
    expect(document.documentElement.hasAttribute(TWO_COLUMN_NARROW_ATTR)).toBe(false);

    controller.cleanup();
  });
});
