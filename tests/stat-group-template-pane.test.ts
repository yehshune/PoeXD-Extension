// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createInMemoryPreferencesStorage } from '@/utils/preferences';
import type { CriteriaOverlayOp, CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';
import {
  createCriteriaOverlayManager,
  statGroupTemplateStorageKey,
  type CriteriaOverlayPageChannel,
} from '@/entrypoints/content/logic/criteria-overlay-manager';
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
  let id = 2;
  const storage = createInMemoryPreferencesStorage({
    [statGroupTemplateStorageKey('poe1')]: [
      { id: 't1', name: '生命抗性', statGroups: groups, createdAt: 1, updatedAt: 1 },
      { id: 't2', name: '移速', statGroups: [groups[0]], createdAt: 2, updatedAt: 2 },
    ],
  });
  const committedGroups: CriteriaOverlayStatGroup[][] = [];
  const channel: CriteriaOverlayPageChannel = {
    read: vi.fn(async () => ({
      snapshot: {
        stats: [{ type: 'and', filters: [{ id: 'explicit.form_existing' }] }],
      },
      knownStatIds: null,
    })),
    commit: vi.fn(async (ops: readonly CriteriaOverlayOp[]) => {
      const pushed: CriteriaOverlayStatGroup[] = [];
      for (const op of ops) {
        if (op.kind === 'pushStatGroup') {
          pushed.push({
            type: op.type,
            filters: op.filters.map((f) => ({
              id: f.id,
              ...(f.value ? { value: f.value } : {}),
              ...(f.disabled ? { disabled: f.disabled } : {}),
            })),
          });
        } else if (op.kind === 'setStatGroupValue' && pushed.length > 0) {
          pushed[pushed.length - 1].value = op.value ?? undefined;
        }
      }
      committedGroups.push(pushed);
    }),
  };
  const manager = createCriteriaOverlayManager({
    version: 'poe1',
    storage,
    channel,
    createId: () => `t${++id}`,
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
  return { container, committedGroups, manager, channel };
}

const items = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-test="stat-group-template-item"]'));

describe('StatGroupTemplatePane', () => {
  it('lists templates in stored order with a summary, filterable by name and stat text', async () => {
    const { container } = await mountPane();
    expect(items(container).map((el) => el.dataset.templateId)).toEqual(['t1', 't2']);
    expect(items(container)[0].textContent).toContain('2 個詞綴群組 · 3 條詞綴 · 且(1) 計數≥1(2)');

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
    await new Promise((r) => setTimeout(r, 180));
    await flush();
    expect(items(container).map((el) => el.dataset.templateId)).toEqual(['t2']);

    // 支援依群組內詞綴篩選
    input.value = 'explicit.b';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 180));
    await flush();
    expect(items(container).map((el) => el.dataset.templateId)).toEqual(['t1']);
  });

  it('supports inline rename and single-row delete button', async () => {
    const { container, manager } = await mountPane();
    const firstRow = () => items(container)[0];
    firstRow()
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-rename"]')!
      .click();
    await flush();

    const renameInput = firstRow().querySelector<HTMLInputElement>(
      '[data-test="stat-group-template-rename-input"]',
    )!;
    expect(renameInput).not.toBeNull();
    expect(renameInput.value).toBe('生命抗性');

    renameInput.value = '三抗血量';
    renameInput.dispatchEvent(new Event('input'));
    // 中文輸入法組字中 (isComposing: true) 按 Enter 不應提早送出
    renameInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    await flush();
    expect(
      firstRow().querySelector('[data-test="stat-group-template-rename-input"]'),
    ).not.toBeNull();

    renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(manager.templates.value[0].name).toBe('三抗血量');
    expect(firstRow().textContent).toContain('三抗血量');

    firstRow()
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-delete"]')!
      .click();
    await flush();
    expect(manager.templates.value.map((t) => t.id)).toEqual(['t2']);
  });

  it('opens the import dialog from the toolbar menu and imports selected entries', async () => {
    const { container, manager } = await mountPane();
    const exported = manager.exportTemplates();
    container.querySelector<HTMLButtonElement>('[data-test="stat-group-template-menu"]')!.click();
    await flush();

    document.body
      .querySelector<HTMLElement>('[data-test="stat-group-template-open-import"]')!
      .click();
    await flush();

    const dialog = document.body.querySelector<HTMLElement>(
      '[data-test="stat-group-template-import-dialog"]',
    )!;
    expect(dialog).not.toBeNull();

    const input = dialog.querySelector<HTMLInputElement>(
      '[data-test="stat-group-template-import-input"]',
    )!;
    input.value = exported;
    input.dispatchEvent(new Event('input'));
    await flush();

    const importItems = dialog.querySelectorAll('[data-test="stat-group-template-import-item"]');
    expect(importItems).toHaveLength(2);

    dialog
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-import-confirm"]')!
      .click();
    await flush();

    expect(manager.templates.value.map((t) => t.name)).toEqual([
      '生命抗性',
      '移速',
      '生命抗性',
      '移速',
    ]);
  });

  it('overlays every group of a template', async () => {
    const { container, committedGroups } = await mountPane();
    items(container)[0]
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-apply"]')!
      .click();
    await flush();
    expect(committedGroups).toEqual([groups]);
  });

  const popover = () => document.body.querySelector('[data-test="search-preview-popover"]');

  it('toggles a pinned preview outside the list and overlays a single group from it', async () => {
    const { container, committedGroups } = await mountPane();
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
    expect(committedGroups).toEqual([[groups[1]]]);

    toggle.click();
    await flush();
    expect(popover()).toBeNull();
  });

  it('預覽可暫時微調詞綴並疊加微調後的條件，存回後寫進範本並重設暫存', async () => {
    const { container, committedGroups, manager } = await mountPane();
    items(container)[0]
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-toggle"]')!
      .click();
    await flush();
    // 常用詞綴群組只有詞綴：沒有上架狀態、沒有開啟搜尋
    expect(popover()?.querySelector('[data-test="preview-status-select"]')).toBeNull();
    expect(popover()?.querySelector('[data-test="preview-open-current"]')).toBeNull();
    expect(popover()?.querySelector('[data-test="preview-overwrite-bookmark"]')).toBeNull();

    const min = popover()!.querySelector<HTMLInputElement>('[data-stat-bound][data-bound="min"]')!;
    min.value = '5';
    min.dispatchEvent(new Event('change'));
    await flush();
    const saveBack = () =>
      popover()?.querySelector<HTMLButtonElement>('[data-test="preview-overwrite-bookmark"]');
    expect(saveBack()?.textContent).toContain('存回詞綴群組');
    expect(popover()?.querySelector('[data-test="preview-reset-tune"]')).not.toBeNull();

    // 暫時疊加：用微調後的條件，範本本身不變
    popover()!.querySelector<HTMLButtonElement>('[data-test="preview-overlay-stats"]')!.click();
    await flush();
    expect(committedGroups[0][0].filters[0]).toEqual({ id: 'explicit.a', value: { min: 5 } });
    expect(manager.templates.value[0].statGroups).toEqual(groups);

    saveBack()!.click();
    await flush();
    const saved = manager.templates.value[0];
    expect(saved.name).toBe('生命抗性');
    expect(saved.statGroups[0].filters[0]).toEqual({ id: 'explicit.a', value: { min: 5 } });
    expect(saved.statGroups[1]).toEqual(groups[1]);
    expect(saveBack()).toBeNull();
    expect(popover()?.querySelector('[data-test="preview-reset-tune"]')).toBeNull();
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
    const { container, manager } = await mountPane();
    items(container)[0]
      .querySelector<HTMLButtonElement>('[data-test="stat-group-template-toggle"]')!
      .click();
    await flush();
    await manager.removeTemplate(manager.templates.value[0]);
    await flush();
    expect(popover()).toBeNull();
  });

  it('renders the shared drag-to-delete trash zone', async () => {
    const { container } = await mountPane();
    expect(container.querySelector('.drag-trash-zone')?.textContent).toContain('拖曳至此處刪除');
  });

  it('shows an empty state when nothing is saved', async () => {
    const { container, manager } = await mountPane();
    await manager.clearTemplates();
    await flush();
    expect(container.querySelector('[data-test="stat-group-template-empty"]')).not.toBeNull();
  });

  it('頂部主按鈕擷取目前表單並開啟儲存對話框', async () => {
    const { container, manager, channel } = await mountPane();
    const save = container.querySelector<HTMLButtonElement>(
      '[data-test="stat-group-template-save-current"]',
    )!;
    expect(save.disabled).toBe(false);
    save.click();
    await flush();
    expect(channel.read).toHaveBeenCalled();
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
    await new Promise((r) => setTimeout(r, 180));
    await flush();
    expect(items(container)).toHaveLength(1);

    toggle.click();
    await flush();
    expect(items(container)).toHaveLength(2);
  });
});
