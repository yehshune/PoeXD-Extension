// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createInMemoryPreferencesStorage } from '@/utils/preferences';
import { createStatGroupTemplateStore } from '@/utils/stat-group-template-store';
import type { OverlayCriteria, CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';
import type { CriteriaOverlaySession } from '@/entrypoints/content/logic/criteria-overlay-session';
import { createCriteriaOverlayManager } from '@/components/injected/criteria-overlay-manager';
import StatGroupTemplatePane from '@/components/sidebar/stat-group-templates/StatGroupTemplatePane.vue';

vi.mock('@/utils/trade-stat-dictionary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/trade-stat-dictionary')>()),
  loadTradeDictionaries: vi.fn(async () => {}),
}));

const SEARCH_URL = 'https://www.pathofexile.com/trade/search/Standard';

const groups: CriteriaOverlayStatGroup[] = [
  { type: 'and', filters: [{ id: 'explicit.a', value: { min: 1 } }] },
  { type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.b' }, { id: 'explicit.c' }] },
];

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

async function mountPane(url = SEARCH_URL) {
  let id = 0;
  const store = createStatGroupTemplateStore('poe1', {
    storage: createInMemoryPreferencesStorage(),
    createId: () => `t${++id}`,
  });
  await store.create('生命抗性', groups);
  await store.create('移速', [groups[0]]);
  const applied: OverlayCriteria[] = [];
  const session = {
    capture: vi.fn(async () => ({ statGroups: groups, fields: [], sectionDisabled: {} })),
    apply: vi.fn(async (c: OverlayCriteria) => {
      applied.push(c);
      return {
        addedStatGroups: c.statGroups.length,
        skippedDuplicateStatGroups: 0,
        skippedUnknownStatFilters: 0,
        changedFields: 0,
        changedItem: false,
        changedStatus: false,
      };
    }),
    undo: vi.fn(async () => true),
    canUndo: () => false,
    subscribeUndo: () => () => {},
  } as unknown as CriteriaOverlaySession;
  const manager = createCriteriaOverlayManager({
    version: 'poe1',
    createStore: () => store,
    session,
    notify: () => {},
    confirm: async () => true,
    loadDictionaries: async () => {},
  });
  await manager.start();

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () => h(StatGroupTemplatePane, { manager, readUrl: () => url }),
  });
  app.mount(container);
  cleanup = () => app.unmount();
  await flush();
  return { container, store, applied, manager, session };
}

const items = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-test="stat-group-template-item"]'));

describe('StatGroupTemplatePane', () => {
  it('lists templates in stored order with a summary, filterable by name', async () => {
    const { container } = await mountPane();
    expect(items(container).map((el) => el.dataset.templateId)).toEqual(['t1', 't2']);
    expect(items(container)[0].textContent).toContain('2 個詞綴群組 · 3 條詞綴');

    expect(container.querySelector('[data-test="stat-group-template-search"]')).toBeNull();
    container
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-search-toggle"]')!
      .click();
    await flush();
    const input = container.querySelector<HTMLInputElement>(
      '[data-test="stat-group-template-search"]',
    )!;
    input.value = '移速';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(items(container).map((el) => el.dataset.templateId)).toEqual(['t2']);
  });

  it('overlays every group of a template', async () => {
    const { container, applied } = await mountPane();
    items(container)[0]
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-apply"]')!
      .click();
    await flush();
    expect(applied).toEqual([{ statGroups: groups, fields: [], sectionDisabled: {} }]);
  });

  const popover = () => document.body.querySelector('[data-test="search-preview-popover"]');

  it('toggles a pinned preview outside the list and overlays a single group from it', async () => {
    const { container, applied } = await mountPane();
    const toggle = items(container)[0].querySelector<HTMLButtonElement>(
      '[data-test="stat-group-template-toggle"]',
    )!;
    toggle.click();
    await flush();
    expect(popover()?.querySelectorAll('.preview-stat-group')).toHaveLength(2);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    popover()!
      .querySelectorAll<HTMLButtonElement>('[data-test="preview-overlay-stat-group"]')[1]
      .click();
    await flush();
    expect(applied).toEqual([{ statGroups: [groups[1]], fields: [], sectionDisabled: {} }]);

    toggle.click();
    await flush();
    expect(popover()).toBeNull();
  });

  it('switches the preview to another template instead of opening a second one', async () => {
    const { container } = await mountPane();
    const toggles = container.querySelectorAll<HTMLButtonElement>(
      '[data-test="stat-group-template-toggle"]',
    );
    toggles[0].click();
    await flush();
    toggles[1].click();
    await flush();
    expect(document.body.querySelectorAll('[data-test="search-preview-popover"]')).toHaveLength(1);
    expect(popover()?.querySelectorAll('.preview-stat-group')).toHaveLength(1);
  });

  it('disables overlay outside the official search page and explains why', async () => {
    const { container } = await mountPane('https://www.pathofexile.com/trade/exchange/Standard');
    const apply = items(container)[0].querySelector<HTMLButtonElement>(
      '[data-test="stat-group-template-apply"]',
    )!;
    expect(apply.disabled).toBe(true);

    items(container)[0]
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-toggle"]')!
      .click();
    await flush();
    expect(popover()?.querySelector('[data-test="preview-overlay-stat-group"]')).toBeNull();
    expect(popover()?.querySelector('[data-test="preview-overlay-hint"]')?.textContent).toContain(
      '搜尋頁',
    );
  });

  it('closes the preview when its template is deleted', async () => {
    const { container, store } = await mountPane();
    items(container)[0]
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-toggle"]')!
      .click();
    await flush();
    await store.remove('t1');
    await flush();
    expect(popover()).toBeNull();
  });

  it('renders the shared drag-to-delete trash zone', async () => {
    const { container } = await mountPane();
    expect(container.querySelector('.drag-trash-zone')?.textContent).toContain('拖曳至此處刪除');
  });

  it('shows an empty state when nothing is saved', async () => {
    const { container, store } = await mountPane();
    for (const template of await store.list()) await store.remove(template.id);
    await flush();
    expect(container.querySelector('[data-test="stat-group-template-empty"]')).not.toBeNull();
  });

  it('頂部主按鈕擷取目前表單並開啟儲存對話框', async () => {
    const { container, manager, session } = await mountPane();
    const save = container.querySelector<HTMLButtonElement>(
      '[data-test="stat-group-template-save-current"]',
    )!;
    expect(save.disabled).toBe(false);
    save.click();
    await flush();
    expect(session.capture).toHaveBeenCalled();
    expect(manager.saveDialog.open.value).toBe(true);
  });

  it('不在搜尋頁時停用儲存，沒有可復原的套用時停用復原', async () => {
    const { container } = await mountPane('https://www.pathofexile.com/trade/exchange/Standard');
    expect(
      container.querySelector<HTMLButtonElement>('[data-test="stat-group-template-save-current"]')!
        .disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[data-test="stat-group-template-undo"]')!
        .disabled,
    ).toBe(true);
  });

  it('關閉搜尋時清空查詢條件', async () => {
    const { container } = await mountPane();
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-test="stat-group-template-search-toggle"]',
    )!;
    toggle.click();
    await flush();
    const input = container.querySelector<HTMLInputElement>(
      '[data-test="stat-group-template-search"]',
    )!;
    input.value = '移速';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(items(container)).toHaveLength(1);

    toggle.click();
    await flush();
    expect(items(container)).toHaveLength(2);
  });
});
