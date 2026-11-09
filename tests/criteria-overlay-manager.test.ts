import { describe, expect, it, vi } from 'vitest';
import { createInMemoryPreferencesStorage } from '@/utils/preferences';
import {
  createStatGroupTemplateStore,
  type StatGroupTemplate,
} from '@/utils/stat-group-template-store';
import type { OverlayCriteria, CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';
import type { CriteriaOverlaySession } from '@/entrypoints/content/logic/criteria-overlay-session';
import {
  createCriteriaOverlayManager,
  filterTemplatesByName,
} from '@/components/injected/criteria-overlay-manager';

const groups: CriteriaOverlayStatGroup[] = [
  { type: 'and', filters: [{ id: 'explicit.a', value: { min: 1 } }] },
  { type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.b' }] },
];

const formCriteria: OverlayCriteria = {
  status: 'online',
  statGroups: groups,
  fields: [{ section: 'type_filters', field: 'rarity', value: { option: 'rare' } }],
  sectionDisabled: {},
};

function fakeSession(capture: OverlayCriteria = formCriteria) {
  const applied: OverlayCriteria[] = [];
  const session: CriteriaOverlaySession = {
    capture: vi.fn(async () => capture),
    apply: vi.fn(async (c: OverlayCriteria) => {
      applied.push(c);
      return {
        addedStatGroups: c.statGroups.length,
        skippedDuplicateStatGroups: 0,
        skippedUnknownStatFilters: 0,
        changedFields: c.fields.length,
        changedItem: false,
        changedStatus: false,
      };
    }),
    undo: vi.fn(async () => true),
    canUndo: () => false,
    subscribeUndo: () => () => {},
  };
  return { session, applied };
}

async function setup(options: { prompt?: string | null; capture?: OverlayCriteria } = {}) {
  let id = 0;
  const store = createStatGroupTemplateStore('poe1', {
    storage: createInMemoryPreferencesStorage(),
    createId: () => `t${++id}`,
  });
  await store.create('A', groups);
  await store.create('B', groups);
  const { session, applied } = fakeSession(options.capture);
  const notify = vi.fn();
  const manager = createCriteriaOverlayManager({
    version: 'poe1',
    createStore: () => store,
    session,
    notify,
    confirm: async () => true,
    prompt: async () => (options.prompt === undefined ? null : options.prompt),
    loadDictionaries: async () => {},
  });
  await manager.start();
  return { manager, store, session, applied, notify };
}

const names = (templates: readonly StatGroupTemplate[]) => templates.map((t) => t.name);

describe('filterTemplatesByName', () => {
  it('matches case-insensitively and returns everything for a blank query', () => {
    const templates = [{ name: 'Life Res' }, { name: '移速' }] as StatGroupTemplate[];
    expect(filterTemplatesByName(templates, '  ')).toBe(templates);
    expect(names(filterTemplatesByName(templates, 'res'))).toEqual(['Life Res']);
  });
});

describe('createCriteriaOverlayManager', () => {
  it('loads templates on start and is idempotent', async () => {
    const { manager } = await setup();
    await manager.start();
    expect(names(manager.templates.value)).toEqual(['A', 'B']);
  });

  it('overlays a template as stat groups only', async () => {
    const { manager, applied, notify } = await setup();
    await manager.applyTemplate(manager.templates.value[0]);
    expect(applied).toEqual([{ statGroups: groups, fields: [], sectionDisabled: {} }]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('A'), 'success');
  });

  it('overlays arbitrary criteria from a Search Preview', async () => {
    const { manager, applied } = await setup();
    await manager.overlay(formCriteria, '書籤');
    expect(applied).toEqual([formCriteria]);
  });

  it('refuses an empty overlay without touching the page', async () => {
    const { manager, session, notify } = await setup();
    await manager.overlay({ statGroups: [], fields: [], sectionDisabled: {} }, '空');
    expect(session.apply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('opens the save dialog with only the current stat groups and saves the picked ones', async () => {
    const { manager, store } = await setup();
    await manager.beginSaveTemplate();
    expect(manager.saveDialog.open.value).toBe(true);
    expect(manager.saveDialog.parts.value.map((p) => p.key)).toEqual(['stat:0', 'stat:1']);

    await manager.saveTemplate({ name: '計數', keys: ['stat:1'] });
    expect(manager.saveDialog.open.value).toBe(false);
    const saved = (await store.list()).at(-1)!;
    expect(saved.name).toBe('計數');
    expect(saved.statGroups).toEqual([groups[1]]);
  });

  it('reports when the form has no stat groups to save', async () => {
    const { manager, notify } = await setup({
      capture: { status: 'online', statGroups: [], fields: [], sectionDisabled: {} },
    });
    await manager.beginSaveTemplate();
    expect(manager.saveDialog.open.value).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('詞綴群組'), 'error');
  });

  it('renames, removes and reorders templates', async () => {
    const { manager, store } = await setup({ prompt: ' 新名稱 ' });
    const [a, b] = manager.templates.value;
    await manager.renameTemplate(a);
    await manager.reorderTemplates([b.id, a.id]);
    expect(names(await store.list())).toEqual(['B', '新名稱']);
    await manager.removeTemplate(b);
    expect(names(await store.list())).toEqual(['新名稱']);
  });

  it('surfaces errors as toasts instead of throwing', async () => {
    const { manager, session, notify } = await setup();
    vi.mocked(session.apply).mockRejectedValueOnce(new Error('頁面尚未就緒'));
    await manager.applyTemplate(manager.templates.value[0]);
    expect(notify).toHaveBeenCalledWith('頁面尚未就緒', 'error');
    expect(manager.busy.value).toBe(false);
  });

  it('exports templates as shareable JSON', async () => {
    const { manager } = await setup();
    const parsed = JSON.parse(manager.exportTemplates());
    expect(parsed.gameVersion).toBe('poe1');
    expect(parsed.templates.map((t: { name: string }) => t.name)).toEqual(['A', 'B']);
  });

  it('imports pasted templates after the existing ones and reports skipped entries', async () => {
    const source = await setup();
    const text = JSON.stringify({
      ...JSON.parse(source.manager.exportTemplates()),
      templates: [
        { name: 'C', statGroups: groups },
        { name: '', statGroups: groups },
      ],
    });
    const { manager, store, notify } = await setup({ prompt: text });
    await manager.importTemplates();
    expect(names(await store.list())).toEqual(['A', 'B', 'C']);
    expect(notify).toHaveBeenCalledWith('已匯入 1 筆常用詞綴群組（略過 1 筆無效項目）', 'success');
  });

  it('reports invalid import content without writing', async () => {
    const { manager, store, notify } = await setup({ prompt: 'not json' });
    await manager.importTemplates();
    expect(names(await store.list())).toEqual(['A', 'B']);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('格式'), 'error');
  });

  it('clears every template after confirmation', async () => {
    const { manager, store } = await setup();
    await manager.clearTemplates();
    expect(await store.list()).toEqual([]);
  });
});
