// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import SidebarFilterEmptyState from '@/components/sidebar/layout/SidebarFilterEmptyState.vue';
import ResultBoardModFilterPanel from '@/components/sidebar/result-board/ResultBoardModFilterPanel.vue';
import ItemTypeSelectorPanel from '@/components/sidebar/ItemTypeSelectorPanel.vue';

let activeApp: App | null = null;
let container: HTMLDivElement | null = null;

function mountComponent(
  component: Parameters<typeof createApp>[0],
  props: Record<string, unknown>,
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  activeApp = createApp(component, props);
  activeApp.mount(container);
  return container;
}

afterEach(() => {
  activeApp?.unmount();
  activeApp = null;
  container?.remove();
  container = null;
});

describe('SidebarFilterEmptyState', () => {
  it('renders active filter summary and emits reset on button click', async () => {
    const onReset = vi.fn();
    const el = mountComponent(SidebarFilterEmptyState, {
      message: '沒有符合條件的結果',
      activeFilters: ['關鍵字「頭盔」', '僅直購'],
      onReset,
    });
    await nextTick();

    expect(el.textContent).toContain('沒有符合條件的結果');
    expect(el.textContent).toContain('目前篩選：關鍵字「頭盔」 · 僅直購');
    const resetBtn = el.querySelector('[data-filter-empty-reset]') as HTMLButtonElement | null;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn?.textContent).toContain('重設篩選');

    resetBtn?.click();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('defaults action label to 清除搜尋 when mode="search" and hides button when showReset=false', async () => {
    const el = mountComponent(SidebarFilterEmptyState, {
      mode: 'search',
      message: '找不到相符的書籤',
      showReset: true,
    });
    await nextTick();
    expect(el.querySelector('[data-filter-empty-reset]')?.textContent).toContain('清除搜尋');

    activeApp?.unmount();
    container?.remove();

    const elNoReset = mountComponent(SidebarFilterEmptyState, {
      message: '沒有符合條件的賣家',
      showReset: false,
    });
    await nextTick();
    expect(elNoReset.querySelector('[data-filter-empty-reset]')).toBeNull();
  });

  it('resets query and quick filter from ResultBoardModFilterPanel empty state', async () => {
    const onQueryUpdate = vi.fn();
    const onQuickFilterUpdate = vi.fn();
    const el = mountComponent(ResultBoardModFilterPanel, {
      open: true,
      query: '不存在',
      quickFilter: 't1',
      options: [],
      allOptionCount: 5,
      optionByKey: new Map(),
      conditions: [],
      'onUpdate:query': onQueryUpdate,
      'onUpdate:quickFilter': onQuickFilterUpdate,
    });
    await nextTick();

    const empty = el.querySelector('[data-board-mod-picker-no-match]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('關鍵字「不存在」');
    const resetBtn = empty?.querySelector('[data-filter-empty-reset]') as HTMLButtonElement | null;
    expect(resetBtn).not.toBeNull();

    resetBtn?.click();
    expect(onQueryUpdate).toHaveBeenCalledWith('');
    expect(onQuickFilterUpdate).toHaveBeenCalledWith('all');
  });

  it('clears search query from ItemTypeSelectorPanel empty state', async () => {
    const onSearchUpdate = vi.fn();
    const el = mountComponent(ItemTypeSelectorPanel, {
      searchQuery: 'no_such_type',
      activeCategory: 'body-armour',
      groupedAvailableTypes: [],
      recentOptions: [],
      'onUpdate:searchQuery': onSearchUpdate,
    });
    await nextTick();

    const empty = el.querySelector('.no-options-found');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('關鍵字「no_such_type」');
    const resetBtn = empty?.querySelector('[data-filter-empty-reset]') as HTMLButtonElement | null;
    expect(resetBtn).not.toBeNull();

    resetBtn?.click();
    expect(onSearchUpdate).toHaveBeenCalledWith('');
  });
});
