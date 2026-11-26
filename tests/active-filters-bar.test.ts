// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_FILTERS_BAR_CLASS,
  ACTIVE_FILTERS_EMPTY_CLASS,
  ACTIVE_FILTERS_ONLY_ATTR,
  ACTIVE_FILTERS_SHOW_ALL_BTN_CLASS,
  ACTIVE_FILTERS_STYLE_ID,
  ACTIVE_FILTERS_TOGGLE_CLASS,
  buildActiveFiltersBarCss,
  countActiveBlueFilters,
  createActiveFiltersBar,
  isBlueGroupEnabled,
} from '@/entrypoints/content/logic/active-filters-bar';

function mountMockBluePane() {
  document.body.innerHTML = `
    <div id="trade">
      <div class="top">
        <div class="search-panel">
          <div class="search-bar search-advanced">
            <div class="search-advanced-items">
              <div class="search-advanced-pane blue">
                <div class="filter-group expanded">
                  <div class="filter-group-header">
                    <button type="button" class="btn toggle-btn"></button>
                    <span class="filter-title">類別過濾</span>
                  </div>
                  <div class="filter-group-body">
                    <div class="filter filter-property">
                      <div class="multiselect filter-select"></div>
                    </div>
                  </div>
                </div>
                <div class="filter-group expanded">
                  <div class="filter-group-header">
                    <button type="button" class="btn toggle-btn"></button>
                    <span class="filter-title">護甲篩選</span>
                  </div>
                  <div class="filter-group-body">
                    <div class="filter filter-property">
                      <input class="form-control minmax modified" value="10" />
                      <input class="form-control minmax" value="" />
                    </div>
                    <div class="filter filter-property spaced">
                      <input class="form-control minmax" value="" />
                    </div>
                  </div>
                </div>
                <div class="filter-group">
                  <div class="filter-group-header">
                    <button type="button" class="btn toggle-btn off"></button>
                    <span class="filter-title">插槽篩選</span>
                  </div>
                  <div class="filter-group-body" style="display: none">
                    <div class="filter filter-property full-span">
                      <input class="form-control socket str modified" value="2" />
                      <input class="form-control socket dex modified" value="3" />
                    </div>
                  </div>
                </div>
              </div>
              <div class="search-advanced-pane brown"></div>
            </div>
          </div>
          <div class="controls">
            <button type="button" class="btn clear-btn">清除</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

describe('active-filters-bar', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(ACTIVE_FILTERS_ONLY_ATTR);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(ACTIVE_FILTERS_ONLY_ATTR);
  });

  it('uses PoE host-native oklch styles, preserves focus-within, and never force-expands unchecked groups', () => {
    const css = buildActiveFiltersBarCss();
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\s*\(/i);
    expect(css).toContain('oklch(');
    expect(css).not.toContain('var(--card');
    expect(css).not.toContain('var(--primary');
    expect(css).toContain(':has(.filter-group-body .modified, .filter-group-body :focus-within)');
    expect(css).toContain(
      '> .filter-group.expanded > .filter-group-body > .filter:not(:has(.modified, :focus-within))',
    );
    // Unchecked (collapsed) groups keep their official collapsed header without forced display:block on body
    expect(css).not.toContain('> .filter-group-body {\n      display: block !important;');
    expect(css).toContain('data-poexd-console-result-only="true"');
  });

  it('counts only modified filter rows inside enabled (checked) blue groups', () => {
    mountMockBluePane();
    const bluePane = document.querySelector('.search-advanced-pane.blue')!;
    const groups = bluePane.querySelectorAll('.filter-group');
    expect(isBlueGroupEnabled(groups[1]!)).toBe(true);
    expect(isBlueGroupEnabled(groups[2]!)).toBe(false);

    // 護甲篩選 (enabled, 1 modified row) counted; 插槽篩選 (unchecked/disabled, 2 modified inputs) NOT counted
    expect(countActiveBlueFilters(bluePane)).toBe(1);

    // Re-checking 插槽篩選 includes it as 1 filter row (not 2 inputs)
    groups[2]!.classList.add('expanded');
    groups[2]!.querySelector('.toggle-btn')!.classList.remove('off');
    expect(countActiveBlueFilters(bluePane)).toBe(2);
  });

  it('mounts toggle bar without modifying official group checkboxes and resets on official clear', () => {
    mountMockBluePane();
    const controller = createActiveFiltersBar();
    controller.sync();

    const bar = document.querySelector(`.${ACTIVE_FILTERS_BAR_CLASS}`)!;
    const toggleBtn = document.querySelector<HTMLButtonElement>(`.${ACTIVE_FILTERS_TOGGLE_CLASS}`)!;
    const emptyEl = document.querySelector(`.${ACTIVE_FILTERS_EMPTY_CLASS}`);
    expect(bar).not.toBeNull();
    expect(bar.querySelectorAll('button')).toHaveLength(1);
    expect(emptyEl).not.toBeNull();
    expect(document.getElementById(ACTIVE_FILTERS_STYLE_ID)).not.toBeNull();
    expect(toggleBtn.textContent).toContain('(1)');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

    // Toggle active-only ON without touching official group checkboxes
    toggleBtn.click();
    expect(document.documentElement.getAttribute(ACTIVE_FILTERS_ONLY_ATTR)).toBe('true');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(
      document.querySelectorAll('.search-advanced-pane.blue > .filter-group.expanded'),
    ).toHaveLength(2);

    // Clicking official Clear exits active-only mode automatically
    document.querySelector<HTMLButtonElement>('.clear-btn')!.click();
    expect(document.documentElement.hasAttribute(ACTIVE_FILTERS_ONLY_ATTR)).toBe(false);
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

    // Empty hint "Show All" button also exits active-only mode
    toggleBtn.click();
    expect(document.documentElement.getAttribute(ACTIVE_FILTERS_ONLY_ATTR)).toBe('true');
    document.querySelector<HTMLButtonElement>(`.${ACTIVE_FILTERS_SHOW_ALL_BTN_CLASS}`)!.click();
    expect(document.documentElement.hasAttribute(ACTIVE_FILTERS_ONLY_ATTR)).toBe(false);

    // Cleanup removes bar, empty hint, style, and root attribute
    toggleBtn.click();
    controller.cleanup();
    expect(document.documentElement.hasAttribute(ACTIVE_FILTERS_ONLY_ATTR)).toBe(false);
    expect(document.querySelector(`.${ACTIVE_FILTERS_BAR_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${ACTIVE_FILTERS_EMPTY_CLASS}`)).toBeNull();
    expect(document.getElementById(ACTIVE_FILTERS_STYLE_ID)).toBeNull();
  });

  it('does not mount on /exchange pages where only brown panes exist', () => {
    document.body.innerHTML = `
      <div id="trade">
        <div class="search-advanced-items exchange">
          <div class="search-advanced-pane brown"></div>
          <div class="search-advanced-pane brown"></div>
        </div>
      </div>
    `;
    const controller = createActiveFiltersBar();
    controller.sync();
    expect(document.querySelector(`.${ACTIVE_FILTERS_BAR_CLASS}`)).toBeNull();
    controller.cleanup();
  });
});
