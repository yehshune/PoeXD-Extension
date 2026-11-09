import { describe, expect, it, vi } from 'vitest';
import { createInMemoryPreferencesStorage } from '@/utils/preferences';
import {
  createStatGroupTemplateStore,
  statGroupTemplateStorageKey,
  STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH,
} from '@/utils/stat-group-template-store';
import type { CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';

const groups: CriteriaOverlayStatGroup[] = [
  { type: 'and', filters: [{ id: 'explicit.stat_life', value: { min: 70 } }] },
  { type: 'count', value: { min: 2 }, filters: [{ id: 'explicit.a' }, { id: 'explicit.b' }] },
];

function setup(initial: Record<string, unknown> = {}) {
  const storage = createInMemoryPreferencesStorage(initial);
  let id = 0;
  let time = 1000;
  const store = createStatGroupTemplateStore('poe2', {
    storage,
    createId: () => `t${++id}`,
    now: () => ++time,
  });
  return { storage, store };
}

describe('StatGroupTemplateStore', () => {
  it('stores several stat groups under one game-version key, duplicates allowed', async () => {
    const { storage, store } = setup();
    await store.create('  生命抗性 ', groups);
    await store.create('生命抗性', groups);

    const templates = await store.list();
    expect(templates.map((t) => [t.id, t.name])).toEqual([
      ['t1', '生命抗性'],
      ['t2', '生命抗性'],
    ]);
    expect(templates[0].statGroups).toEqual(groups);
    expect(Object.keys(storage.inspect())).toEqual([statGroupTemplateStorageKey('poe2')]);
    expect(statGroupTemplateStorageKey('poe2')).toBe('poexdStatGroupTemplatesV1_poe2');
  });

  it('copies the groups so later edits to the input do not leak into storage', async () => {
    const { store } = setup();
    const input = JSON.parse(JSON.stringify(groups));
    await store.create('A', input);
    input[0].filters[0].value.min = 1;
    expect((await store.list())[0].statGroups[0].filters[0].value).toEqual({ min: 70 });
  });

  it('rejects empty groups and invalid names', async () => {
    const { store } = setup();
    await expect(store.create('空的', [])).rejects.toThrow('沒有可儲存的詞綴群組');
    await expect(store.create('   ', groups)).rejects.toThrow('名稱不可為空白');
    await expect(
      store.create('x'.repeat(STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH + 1), groups),
    ).rejects.toThrow('最多');
  });

  it('renames, removes and reorders templates', async () => {
    const { store } = setup();
    await store.create('A', groups);
    await store.create('B', groups);
    await store.create('C', groups);

    await store.rename('t2', 'B2');
    await store.reorder(['t3', 't1']);
    await store.remove('t1');

    expect((await store.list()).map((t) => t.name)).toEqual(['C', 'B2']);
    await expect(store.rename('missing', 'x')).rejects.toThrow('找不到');
  });

  it('skips malformed entries on read but keeps them on write', async () => {
    const key = statGroupTemplateStorageKey('poe2');
    const bad = { id: 'bad', name: 'Bad', statGroups: 'nope' };
    const { storage, store } = setup({
      [key]: [{ id: 'ok', name: 'OK', statGroups: groups, createdAt: 1, updatedAt: 1 }, bad],
    });
    expect((await store.list()).map((t) => t.id)).toEqual(['ok']);

    await store.create('New', groups);
    const raw = storage.inspect()[key] as unknown[];
    expect(raw).toHaveLength(3);
    expect(raw).toContainEqual(bad);
  });

  it('notifies subscribers only when its own key changes', async () => {
    const { storage, store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.create('A', groups);
    expect(listener).toHaveBeenCalledWith([expect.objectContaining({ name: 'A' })]);
    await storage.setExternal({ other: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('appends several templates in one write and clears the version list', async () => {
    const { storage, store } = setup({ [statGroupTemplateStorageKey('poe2')]: ['future-format'] });
    await store.create('既有', groups);
    await store.createMany([
      { name: '匯入一', statGroups: [groups[0]] },
      { name: '匯入二', statGroups: [groups[1]] },
    ]);
    expect((await store.list()).map((t) => [t.id, t.name])).toEqual([
      ['t1', '既有'],
      ['t2', '匯入一'],
      ['t3', '匯入二'],
    ]);

    await store.clear();
    expect(await store.list()).toEqual([]);
    // 無法解析的項目仍原樣保留
    expect(storage.inspect()[statGroupTemplateStorageKey('poe2')]).toEqual(['future-format']);
  });
});
