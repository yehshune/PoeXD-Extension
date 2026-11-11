import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMercenaryCatalog,
  loadMercenaryCatalog,
  resetMercenaryCatalogForTests,
  translateMercenaryStat,
  type MercenaryDataFile,
  type MercenaryNamesFile,
} from '@/utils/mercenary-data';
import {
  buildMercenaryExcludeGroup,
  mercenarySelectionHints,
  buildMercenaryStatGroup,
  listBuildSkills,
  listSkillSupportFamilies,
  parseMercenaryStatGroup,
} from '@/utils/mercenary-query';

const data: MercenaryDataFile = {
  patch: '3.29.0',
  builds: [
    {
      tradeType: 'MiscScionWandAttacksNoble',
      infamous: true,
      core: [1],
      main: [0, 2],
      mainCount: 2,
      utility: [1, 3],
      utilityCount: 1,
    },
  ],
  skills: [
    { tradeId: 'mercenary.skill_12583', slots: 'high', supports: [0, 1, 2, 3] },
    { tradeId: 'mercenary.skill_2', slots: 'low', supports: [3] },
    { tradeId: 'mercenary.skill_3', slots: 'high', supports: [0, 1, 2, 3, 4, 5, 6] },
    { tradeId: 'mercenary.skill_4', slots: 'none', supports: [] },
  ],
  supports: [
    { tradeId: 'mercenary.support_10', tier: 1, family: 'Chain' },
    { tradeId: 'mercenary.support_11', tier: 2, family: 'Chain' },
    { tradeId: 'mercenary.support_12', tier: 3, family: 'Chain' },
    { tradeId: 'mercenary.support_20', tier: 3, family: null },
    { tradeId: 'mercenary.support_30', tier: 1, family: 'Pierce' },
    { tradeId: 'mercenary.support_31', tier: 3, family: 'Pierce' },
    { tradeId: 'mercenary.support_40', tier: 3, family: null },
  ],
};
const names: MercenaryNamesFile = {
  patch: '3.29.0',
  builds: ['Infamous Kineticist'],
  skills: ['Kinetic Bolt', 'Flame Dash', 'Barrage', 'Haste'],
  supports: [
    'Lesser Chain',
    'Chain',
    'Greater Chain',
    'Gilded Return',
    'Lesser Pierce',
    'Greater Pierce',
    'Gilded Nova',
  ],
};
const catalog = createMercenaryCatalog(data, names);

describe('listSkillSupportFamilies', () => {
  it('groups supports by family, names a family by its T2 member and keeps exclusives apart', () => {
    const families = listSkillSupportFamilies(catalog, catalog.skills[0]);
    expect(families.map((f) => [f.key, f.name, f.maxTier, f.members.length])).toEqual([
      ['Chain', 'Chain', 3, 3],
      ['#3', 'Gilded Return', 3, 1],
    ]);
  });
});

describe('buildMercenaryStatGroup', () => {
  it('expands a family to every tier at or above the minimum and requires all picks', () => {
    const group = buildMercenaryStatGroup(catalog, {
      skill: 0,
      supports: [
        { family: 'Chain', minTier: 2 },
        { family: '#3', minTier: 3 },
      ],
      minSupports: 2,
    });
    expect(group).toEqual({
      type: 'mercenary',
      value: { min: 3 },
      filters: [
        { id: 'mercenary.skill_12583' },
        { id: 'mercenary.support_11' },
        { id: 'mercenary.support_12' },
        { id: 'mercenary.support_20' },
      ],
    });
  });

  it('clamps the required support count to the checked supports', () => {
    const group = buildMercenaryStatGroup(catalog, {
      skill: 0,
      supports: [{ family: 'Chain', minTier: 1 }],
      minSupports: 5,
    });
    expect(group.value).toEqual({ min: 2 });
    expect(group.filters).toHaveLength(4);
    expect(
      buildMercenaryStatGroup(catalog, { skill: 0, supports: [], minSupports: 0 }).value,
    ).toEqual({ min: 1 });
  });

  it('ignores families the skill cannot link', () => {
    const group = buildMercenaryStatGroup(catalog, {
      skill: 1,
      supports: [{ family: 'Chain', minTier: 1 }],
      minSupports: 1,
    });
    expect(group).toEqual({
      type: 'mercenary',
      value: { min: 1 },
      filters: [{ id: 'mercenary.skill_2' }],
    });
  });
});

describe('buildMercenaryExcludeGroup', () => {
  it('builds an official not group from skills', () => {
    expect(buildMercenaryExcludeGroup([catalog.skills[0]])).toEqual({
      type: 'not',
      filters: [{ id: 'mercenary.skill_12583' }],
    });
  });
});

describe('mercenarySelectionHints', () => {
  const families = listSkillSupportFamilies(catalog, catalog.skills[2]);
  const pick = (family: string, minTier: 1 | 2 | 3 = 3) => ({ family, minTier });

  it('reports the usual range and warns when the requirement exceeds the max links', () => {
    const supports = ['Chain', '#3', '#6', 'Pierce'].map((f) => pick(f));
    expect(
      mercenarySelectionHints(catalog.skills[2], families, { supports, minSupports: 4 }),
    ).toEqual([{ kind: 'range', min: 4, max: 5 }]);
    const lowSkill = catalog.skills[1];
    expect(
      mercenarySelectionHints(lowSkill, listSkillSupportFamilies(catalog, lowSkill), {
        supports: [pick('#3')],
        minSupports: 1,
      }),
    ).toEqual([{ kind: 'range', min: 1, max: 2 }]);
  });

  it('explains any-of selections and full-link T3 requirements', () => {
    const supports = ['Chain', '#3', '#6', 'Pierce'].map((f) => pick(f, 2));
    expect(
      mercenarySelectionHints(catalog.skills[2], families, { supports, minSupports: 2 }),
    ).toContainEqual({
      kind: 'any-of',
      picked: 4,
      min: 2,
    });
    const skill = { ...catalog.skills[2], slots: 'low' as const };
    expect(
      mercenarySelectionHints(skill, families, {
        supports: supports.map((p) => pick(p.family)),
        minSupports: 4,
      }),
    ).toContainEqual({ kind: 'exceeds-max', max: 2 });
    expect(
      mercenarySelectionHints(skill, families, {
        supports: [pick('#3'), pick('#6')],
        minSupports: 2,
      }),
    ).toContainEqual({ kind: 'max-links-t3' });
  });
});

describe('parseMercenaryStatGroup', () => {
  it('round-trips a built group', () => {
    const selection = {
      skill: 2,
      supports: [
        { family: 'Chain', minTier: 2 as const },
        { family: 'Pierce', minTier: 1 as const },
      ],
      minSupports: 1,
    };
    const parsed = parseMercenaryStatGroup(catalog, buildMercenaryStatGroup(catalog, selection));
    expect(parsed).toEqual(selection);
  });

  it('returns null without a known skill and ignores disabled filters', () => {
    expect(
      parseMercenaryStatGroup(catalog, { filters: [{ id: 'mercenary.support_10' }] }),
    ).toBeNull();
    expect(
      parseMercenaryStatGroup(catalog, {
        filters: [{ id: 'mercenary.skill_12583' }, { id: 'mercenary.support_12', disabled: true }],
      }),
    ).toEqual({ skill: 0, supports: [], minSupports: 0 });
  });
});

describe('listBuildSkills', () => {
  it('lists core, main and utility skills once and flags weak skills', () => {
    const skills = listBuildSkills(catalog, catalog.builds[0]);
    expect(skills.map((s) => [s.skill.name, s.role, s.weak])).toEqual([
      ['Flame Dash', 'core', false],
      ['Kinetic Bolt', 'main', true],
      ['Barrage', 'main', false],
      ['Haste', 'utility', false],
    ]);
  });
});

describe('loadMercenaryCatalog', () => {
  it('falls back through locales and skips names from another patch', async () => {
    const files: Record<string, unknown> = {
      'json/poe1/mercenary.json': data,
      'json/poe1/locales/ja/mercenary.json': { ...names, patch: '3.28.0' },
      'json/poe1/locales/en/mercenary.json': names,
    };
    const requested: string[] = [];
    const loaded = await loadMercenaryCatalog(['ja', 'zh-CN', 'en'], async (path) => {
      requested.push(path);
      return files[path] ?? null;
    });
    expect(loaded.skills[2].name).toBe('Barrage');
    expect(requested).toEqual([
      'json/poe1/mercenary.json',
      'json/poe1/locales/ja/mercenary.json',
      'json/poe1/locales/zh-CN/mercenary.json',
      'json/poe1/locales/en/mercenary.json',
    ]);
  });

  it('throws when the structure file is unavailable', async () => {
    await expect(loadMercenaryCatalog(['en'], async () => null)).rejects.toThrow();
  });
});

describe('translateMercenaryStat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMercenaryCatalogForTests();
  });

  it('loads the catalog in the background and then resolves skill and support names', async () => {
    const files: Record<string, unknown> = {
      'json/poe1/mercenary.json': data,
      'json/poe1/locales/en/mercenary.json': names,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => ({ ok: path in files, json: async () => files[path] })),
    );
    expect(translateMercenaryStat('explicit.stat_1')).toBeNull();
    expect(translateMercenaryStat('mercenary.skill_12583')).toBeNull();
    await vi.waitFor(() =>
      expect(translateMercenaryStat('mercenary.skill_12583')).toBe('Kinetic Bolt'),
    );
    expect(translateMercenaryStat('mercenary.support_11')).toBe('Chain');
    expect(translateMercenaryStat('mercenary.skill_999')).toBeNull();
  });
});
