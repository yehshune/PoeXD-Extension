// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryPreferencesStorage } from '@/utils/preferences';
import type { CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';
import {
  STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH,
  STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
  createStatGroupTemplateStore,
  filterTemplates,
  normalizeStatGroupTemplateName,
  parseStatGroupTemplateTransfer,
  serializeStatGroupTemplates,
  statGroupTemplateStorageKey,
  type StatGroupTemplate,
} from '@/utils/stat-group-template-store';

vi.mock('@/utils/trade-stat-dictionary', () => ({
  translateStatLines: (statId: string) => {
    if (statId === 'explicit.stat_life') return ['+# 最大生命'];
    if (statId === 'explicit.stat_fire_res') return ['+#% 火焰抗性'];
    return [];
  },
}));

const lifeGroup: CriteriaOverlayStatGroup = {
  type: 'and',
  filters: [{ id: 'explicit.stat_life', value: { min: 70 } }],
};

const resGroup: CriteriaOverlayStatGroup = {
  type: 'count',
  value: { min: 2 },
  filters: [{ id: 'explicit.stat_fire_res', value: { min: 30 } }],
};

describe('Stat Group Template Store', () => {
  it('supports CRUD lifecycle (add, rename, updateStatGroups, reorder, remove, clear) and notifies subscribers', async () => {
    const storage = createInMemoryPreferencesStorage();
    let idSeq = 0;
    let time = 100;
    const store = createStatGroupTemplateStore({
      version: 'poe1',
      storage,
      createId: () => `tpl-${++idSeq}`,
      now: () => ++time,
    });

    const observed: StatGroupTemplate[][] = [];
    const unsub = store.subscribe((next) => observed.push(next));

    expect(await store.load()).toEqual([]);

    const afterAdd1 = await store.add('  生命  ', [lifeGroup]);
    expect(afterAdd1).toEqual([
      { id: 'tpl-1', name: '生命', statGroups: [lifeGroup], createdAt: 101, updatedAt: 101 },
    ]);

    const afterAdd2 = await store.add('抗性', [resGroup]);
    expect(afterAdd2.map((t) => t.id)).toEqual(['tpl-1', 'tpl-2']);

    const afterRename = await store.rename('tpl-1', '最大生命');
    expect(afterRename[0]).toMatchObject({ id: 'tpl-1', name: '最大生命', updatedAt: 103 });

    const afterUpdate = await store.updateStatGroups('tpl-1', [lifeGroup, resGroup]);
    expect(afterUpdate[0].statGroups).toHaveLength(2);

    const afterReorder = await store.reorder(['tpl-2', 'tpl-1']);
    expect(afterReorder.map((t) => t.id)).toEqual(['tpl-2', 'tpl-1']);

    const afterRemove = await store.remove('tpl-2');
    expect(afterRemove.map((t) => t.id)).toEqual(['tpl-1']);

    const afterClear = await store.clear();
    expect(afterClear).toEqual([]);

    // Subscriber received external storage change notifications
    expect(observed.length).toBeGreaterThan(0);
    unsub();
  });

  it('preserves unrecognized stored entries from newer versions across writes', async () => {
    const key = statGroupTemplateStorageKey('poe2');
    const futureEntry = { id: 'future-1', schemaVersion: 99, unknownPayload: true };
    const validEntry: StatGroupTemplate = {
      id: 't1',
      name: 'Existing',
      statGroups: [lifeGroup],
      createdAt: 1,
      updatedAt: 1,
    };
    const storage = createInMemoryPreferencesStorage({
      [key]: [validEntry, futureEntry],
    });
    const store = createStatGroupTemplateStore({
      version: 'poe2',
      storage,
      createId: () => 't2',
      now: () => 50,
    });

    expect(await store.load()).toEqual([validEntry]);

    await store.add('Added', [resGroup]);
    const raw = (await storage.get([key]))[key] as unknown[];
    expect(raw).toHaveLength(3);
    expect(raw[2]).toEqual(futureEntry);

    await store.clear();
    expect((await storage.get([key]))[key]).toEqual([futureEntry]);
  });

  it('normalizes template names and rejects empty or overlong names', () => {
    expect(normalizeStatGroupTemplateName('  抗性組合  ')).toBe('抗性組合');
    expect(() => normalizeStatGroupTemplateName('   ')).toThrow();
    expect(() =>
      normalizeStatGroupTemplateName('a'.repeat(STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH + 1)),
    ).toThrow();
  });

  it('serializes and parses transfer payloads, rejecting game-version mismatch and counting skipped entries', () => {
    const templates: StatGroupTemplate[] = [
      { id: 't1', name: '生命', statGroups: [lifeGroup], createdAt: 1, updatedAt: 1 },
    ];
    const json = serializeStatGroupTemplates('poe1', templates);
    const parsedJson = JSON.parse(json);
    expect(parsedJson).toMatchObject({
      format: STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
      gameVersion: 'poe1',
    });
    expect(parsedJson.templates[0]).not.toHaveProperty('id');

    expect(parseStatGroupTemplateTransfer(json, 'poe1')).toEqual({
      entries: [{ name: '生命', statGroups: [lifeGroup] }],
      skipped: 0,
    });

    // Reject game version mismatch
    expect(() => parseStatGroupTemplateTransfer(json, 'poe2')).toThrow();

    // Count skipped invalid entries
    const mixed = JSON.stringify({
      format: STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
      version: 1,
      gameVersion: 'poe1',
      templates: [
        { name: 'Valid', statGroups: [lifeGroup] },
        { name: '', statGroups: [lifeGroup] },
        { name: 'NoGroups', statGroups: [] },
      ],
    });
    expect(parseStatGroupTemplateTransfer(mixed, 'poe1')).toEqual({
      entries: [{ name: 'Valid', statGroups: [lifeGroup] }],
      skipped: 2,
    });
  });

  it('filters templates by name, stat id, or localized stat line', () => {
    const templates: StatGroupTemplate[] = [
      { id: 't1', name: '防禦核心', statGroups: [lifeGroup], createdAt: 1, updatedAt: 1 },
      { id: 't2', name: '元素抗性', statGroups: [resGroup], createdAt: 2, updatedAt: 2 },
    ];

    expect(filterTemplates(templates, '   ', 'poe1')).toBe(templates);
    expect(filterTemplates(templates, '防禦', 'poe1').map((t) => t.id)).toEqual(['t1']);
    expect(filterTemplates(templates, 'stat_fire_res', 'poe1').map((t) => t.id)).toEqual(['t2']);
    expect(filterTemplates(templates, '最大生命', 'poe1').map((t) => t.id)).toEqual(['t1']);
  });
});
