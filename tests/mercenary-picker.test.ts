// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createMercenaryCatalog, type MercenaryDataFile } from '@/utils/mercenary-data';
import { useMercenaryPicker } from '@/components/injected/mercenary/useMercenaryPicker';
import type { CriteriaOverlayFormSnapshot } from '@/utils/criteria-overlay';
import {
  isMercenaryConditionGroup,
  isMercenaryFilterGroup,
} from '@/entrypoints/content/logic/injected-controls';
import { isMercenarySearch } from '@/entrypoints/main-world/dom-tagger';

const catalogData: MercenaryDataFile = {
  patch: '3.29.0',
  builds: [
    {
      tradeType: 'WarrantA',
      infamous: false,
      core: [0],
      main: [1],
      mainCount: 1,
      utility: [],
      utilityCount: 0,
    },
    {
      tradeType: 'MiscScionWandAttacksNoble',
      infamous: true,
      core: [0],
      main: [1, 2],
      mainCount: 2,
      utility: [],
      utilityCount: 0,
    },
  ],
  skills: [
    { tradeId: 'mercenary.skill_1', slots: 'low', supports: [0] },
    { tradeId: 'mercenary.skill_2', slots: 'high', supports: [0, 1, 2, 3, 4, 5, 6] },
    { tradeId: 'mercenary.skill_12583', slots: 'none', supports: [] },
  ],
  supports: [
    { tradeId: 'mercenary.support_10', tier: 1, family: 'Chain' },
    { tradeId: 'mercenary.support_11', tier: 2, family: 'Chain' },
    { tradeId: 'mercenary.support_12', tier: 3, family: 'Chain' },
    { tradeId: 'mercenary.support_20', tier: 3, family: null },
    { tradeId: 'mercenary.support_21', tier: 3, family: null },
    { tradeId: 'mercenary.support_22', tier: 3, family: null },
    { tradeId: 'mercenary.support_23', tier: 3, family: null },
  ],
};
const catalog = createMercenaryCatalog(catalogData, {
  patch: '3.29.0',
  builds: ['Kineticist', 'Infamous Kineticist'],
  skills: ['Flame Dash', 'Barrage', 'Kinetic Bolt'],
  supports: [
    'Lesser Chain',
    'Chain',
    'Greater Chain',
    'Gilded A',
    'Gilded B',
    'Gilded C',
    'Gilded D',
  ],
});

function setup(form: CriteriaOverlayFormSnapshot | null) {
  const manager = {
    readFormSnapshot: vi.fn(async () => form),
    replaceStatGroup: vi.fn(async () => true),
    overlay: vi.fn(async () => true),
    updateStatGroup: vi.fn(async () => true),
  };
  const picker = useMercenaryPicker({ manager, loadCatalog: async () => catalog });
  return { manager, picker };
}

const formWith = (overrides: CriteriaOverlayFormSnapshot): CriteriaOverlayFormSnapshot => ({
  name: null,
  type: null,
  disc: null,
  term: null,
  stats: [],
  ...overrides,
});

describe('useMercenaryPicker (edit)', () => {
  it('prefills the build from the page item type and the skill from the target group', async () => {
    const { picker } = setup(
      formWith({
        type: 'MiscScionWandAttacksNoble',
        disc: 'mercenary_warrant',
        // 官方表單上的空群組也佔一個位置，選擇器的群組索引必須與頁面一致
        stats: [
          { type: 'and', filters: [] },
          {
            type: 'mercenary',
            value: { min: 2 },
            filters: [
              { id: 'mercenary.skill_2' },
              { id: 'mercenary.support_11' },
              { id: 'mercenary.support_12' },
            ],
          },
        ],
      }),
    );
    await picker.open({ mode: 'edit', groupIndex: 1 });
    expect(picker.build.value?.name).toBe('Infamous Kineticist');
    expect(picker.activeSkill.value?.name).toBe('Barrage');
    expect(picker.activeDraft.value).toEqual({
      picks: { Chain: 2 },
      minSupports: 1,
      minTouched: true,
    });
    expect(picker.itemToApply.value).toBeUndefined();
    expect(
      picker.skillSections.value.map((s) => [s.role, s.skills.map((e) => [e.skill.name, e.weak])]),
    ).toEqual([
      ['core', [['Flame Dash', false]]],
      [
        'main',
        [
          ['Barrage', false],
          ['Kinetic Bolt', true],
        ],
      ],
    ]);
  });

  it('keeps one skill, replaces the target group and sets the build type when it differs', async () => {
    const { picker, manager } = setup(formWith({}));
    await picker.open({ mode: 'edit', groupIndex: 3 });
    picker.selectBuild(0);
    picker.focusSkill(0);
    picker.focusSkill(1);
    expect(picker.selectedSkillIndices.value).toEqual([1]);
    picker.toggleFamily('Chain', true);
    picker.setFamilyTier('Chain', 2);
    picker.toggleFamily('#3', true);

    expect(await picker.apply()).toBe(true);
    expect(manager.replaceStatGroup).toHaveBeenCalledWith(
      3,
      [
        {
          type: 'mercenary',
          value: { min: 3 },
          filters: [
            { id: 'mercenary.skill_2' },
            { id: 'mercenary.support_11' },
            { id: 'mercenary.support_12' },
            { id: 'mercenary.support_20' },
          ],
        },
      ],
      'Barrage',
      { name: null, type: 'WarrantA', disc: 'mercenary_warrant', term: null },
    );
  });
});

describe('useMercenaryPicker (supports)', () => {
  it('does not cap checked supports and auto-follows the max links until the user picks a count', async () => {
    const { picker } = setup(null);
    await picker.open({ mode: 'edit', groupIndex: 0 });
    picker.focusSkill(1);
    picker.selectAllFamilies(true);
    expect(picker.pickedCount.value).toBe(5);
    expect(picker.activeDraft.value?.minSupports).toBe(5);

    picker.setMinSupports(3);
    expect(picker.hints.value).toContainEqual({ kind: 'any-of', picked: 5, min: 3 });
    picker.toggleFamily('#6', false);
    expect(picker.activeDraft.value?.minSupports).toBe(3);

    picker.setAllTiers(1);
    expect(Object.values(picker.activeDraft.value!.picks)).toEqual([1, 1, 1, 1]);
    picker.selectAllFamilies(false);
    expect(picker.activeDraft.value).toMatchObject({ picks: {}, minSupports: 0 });
  });

  it('applies the full-links T3 shortcut', async () => {
    const { picker } = setup(null);
    await picker.open({ mode: 'edit', groupIndex: 0 });
    picker.focusSkill(1);
    picker.applyMaxLinksT3();
    expect(picker.resultGroups.value[0].value).toEqual({ min: 6 });
    expect(picker.hints.value).toContainEqual({ kind: 'max-links-t3' });
  });

  it('reports a load failure without throwing', async () => {
    const manager = {
      readFormSnapshot: vi.fn(async () => null),
      replaceStatGroup: vi.fn(),
      overlay: vi.fn(),
      updateStatGroup: vi.fn(),
    };
    const picker = useMercenaryPicker({
      manager,
      loadCatalog: async () => {
        throw new Error('offline');
      },
    });
    await picker.open({ mode: 'edit', groupIndex: 0 });
    expect(picker.loadFailed.value).toBe(true);
    expect(await picker.apply()).toBe(false);
  });
});

describe('useMercenaryPicker (batch)', () => {
  it('adds one group per checked skill plus an exclusion for unchecked weak skills', async () => {
    const { picker, manager } = setup(
      formWith({ type: 'MiscScionWandAttacksNoble', disc: 'mercenary_warrant' }),
    );
    await picker.open({ mode: 'batch' });
    picker.toggleSkill(0, true);
    picker.toggleSkill(1, true);
    picker.toggleFamily('#3', true);
    expect(picker.activeSkill.value?.name).toBe('Barrage');
    expect(picker.excludableWeakSkills.value.map((s) => s.name)).toEqual(['Kinetic Bolt']);

    expect(await picker.apply()).toBe(true);
    expect(manager.overlay).toHaveBeenCalledWith(
      {
        statGroups: [
          { type: 'mercenary', value: { min: 1 }, filters: [{ id: 'mercenary.skill_1' }] },
          {
            type: 'mercenary',
            value: { min: 2 },
            filters: [{ id: 'mercenary.skill_2' }, { id: 'mercenary.support_20' }],
          },
          { type: 'not', filters: [{ id: 'mercenary.skill_12583' }] },
        ],
        fields: [],
        sectionDisabled: {},
      },
      'Infamous Kineticist',
    );
  });

  it('drops a skill when unchecked and can skip the exclusion', async () => {
    const { picker } = setup(null);
    await picker.open({ mode: 'batch' });
    picker.selectBuild(1);
    picker.toggleSkill(0, true);
    picker.toggleSkill(1, true);
    picker.toggleSkill(1, false);
    picker.excludeWeak.value = false;
    expect(picker.activeSkill.value?.name).toBe('Flame Dash');
    expect(picker.resultGroups.value).toHaveLength(1);
  });
});

describe('useMercenaryPicker (skill guarantee)', () => {
  it('adds an and group when any subset of the checked supports is enough', async () => {
    const { picker, manager } = setup(formWith({}));
    await picker.open({ mode: 'edit', groupIndex: 0 });
    picker.focusSkill(1);
    picker.selectAllFamilies(true);
    picker.setMinSupports(3);
    expect(picker.unguaranteedSkills.value.map((s) => s.name)).toEqual(['Barrage']);
    await picker.apply();
    expect(manager.replaceStatGroup).toHaveBeenCalledWith(
      0,
      [
        expect.objectContaining({ type: 'mercenary', value: { min: 4 } }),
        { type: 'and', filters: [{ id: 'mercenary.skill_2' }] },
      ],
      'Barrage',
      undefined,
    );

    picker.requireSkill.value = false;
    expect(picker.resultGroups.value).toHaveLength(1);
  });

  it('skips the and group when every checked support is required or the page already requires the skill', async () => {
    const { picker } = setup(
      formWith({ stats: [{ type: 'and', filters: [{ id: 'mercenary.skill_2' }] }] }),
    );
    await picker.open({ mode: 'batch' });
    picker.toggleSkill(0, true);
    picker.toggleFamily('Chain', true);
    expect(picker.unguaranteedSkills.value).toEqual([]);
    picker.toggleSkill(1, true);
    picker.selectAllFamilies(true);
    picker.setMinSupports(2);
    expect(picker.unguaranteedSkills.value).toEqual([]);
  });
});

describe('useMercenaryPicker (build search)', () => {
  it('matches builds by localized name, English name and trade type', async () => {
    const english = createMercenaryCatalog(catalogData, {
      patch: '3.29.0',
      builds: ['Kineticist EN', 'Infamous Kineticist EN'],
      skills: ['a', 'b', 'c'],
      supports: ['1', '2', '3', '4', '5', '6', '7'],
    });
    const picker = useMercenaryPicker({
      manager: {
        readFormSnapshot: vi.fn(async () => null),
        replaceStatGroup: vi.fn(),
        overlay: vi.fn(),
        updateStatGroup: vi.fn(),
      },
      loadCatalog: async () => catalog,
      loadEnglishCatalog: async () => english,
    });
    await picker.open({ mode: 'batch' });
    await vi.waitFor(() =>
      expect(picker.buildOptions.value[0].keywords).toEqual([
        'infamous kineticist',
        'infamous kineticist en',
        'miscscionwandattacksnoble',
      ]),
    );
  });
});

describe('useMercenaryPicker (group kinds)', () => {
  it('builds and / not / count groups from the checked skills', async () => {
    const { picker, manager } = setup(null);
    await picker.open({ mode: 'batch' });
    picker.selectBuild(1);
    picker.setGroupKind('not');
    // 切到「排除」且未勾選時預先勾選較差技能
    expect(picker.selectedSkills.value.map((s) => s.name)).toEqual(['Kinetic Bolt']);
    expect(picker.resultGroups.value).toEqual([
      { type: 'not', filters: [{ id: 'mercenary.skill_12583' }] },
    ]);

    picker.toggleSkill(1, true);
    picker.setGroupKind('and');
    expect(picker.resultGroups.value).toEqual([
      {
        type: 'and',
        filters: [{ id: 'mercenary.skill_2' }, { id: 'mercenary.skill_12583' }],
      },
    ]);

    picker.setGroupKind('count');
    picker.countMin.value = 5;
    expect(picker.resultGroups.value[0]).toEqual({
      type: 'count',
      value: { min: 2 },
      filters: [{ id: 'mercenary.skill_2' }, { id: 'mercenary.skill_12583' }],
    });
    await picker.apply();
    expect(manager.overlay).toHaveBeenCalledWith(
      expect.objectContaining({ statGroups: [expect.objectContaining({ type: 'count' })] }),
      'Infamous Kineticist',
    );
  });
});

describe('useMercenaryPicker (group)', () => {
  const countForm = () =>
    formWith({
      stats: [
        { type: 'and', filters: [] },
        {
          type: 'count',
          value: { min: 2 },
          filters: [
            { id: 'explicit.stat_1' },
            { id: 'mercenary.skill_1', disabled: true },
            { id: 'mercenary.support_11' },
          ],
        },
      ],
    });

  it('prefills skills already in the group and rewrites it in place', async () => {
    const { picker, manager } = setup(countForm());
    await picker.open({ mode: 'group', groupIndex: 1 });
    expect(picker.targetGroupType.value).toBe('count');
    expect(picker.selectedSkills.value.map((s) => s.name)).toEqual(['Flame Dash']);
    expect(picker.countMin.value).toBe(2);
    expect(picker.isMercenaryKind.value).toBe(false);

    picker.toggleSkill(1, true);
    picker.countMin.value = 9;
    expect(await picker.apply()).toBe(true);
    expect(manager.updateStatGroup).toHaveBeenCalledWith(
      1,
      [
        { id: 'explicit.stat_1' },
        { id: 'mercenary.skill_1', disabled: true },
        { id: 'mercenary.support_11' },
        { id: 'mercenary.skill_2' },
      ],
      'Flame Dash',
      { min: 4 },
    );
  });

  it('removes unchecked skills and can apply with none left', async () => {
    const { picker, manager } = setup(
      formWith({ stats: [{ type: 'not', filters: [{ id: 'mercenary.skill_1' }] }] }),
    );
    await picker.open({ mode: 'group', groupIndex: 0 });
    picker.toggleSkill(0, false);
    expect(picker.canApply.value).toBe(true);
    await picker.apply();
    expect(manager.updateStatGroup).toHaveBeenCalledWith(0, [], '', undefined);
  });
});

describe('isMercenaryConditionGroup', () => {
  const group = (type: string, mercenarySearch: string) => {
    const el = document.createElement('div');
    el.setAttribute('data-poexd-group-type', type);
    el.setAttribute('data-poexd-mercenary-search', mercenarySearch);
    return el;
  };

  it('offers the mercenary button on condition groups of a mercenary search only', () => {
    expect(isMercenaryConditionGroup(group('count', '1'))).toBe(true);
    expect(isMercenaryConditionGroup(group('if', '1'))).toBe(true);
    expect(isMercenaryConditionGroup(group('weight', '1'))).toBe(false);
    expect(isMercenaryConditionGroup(group('mercenary', '1'))).toBe(false);
    expect(isMercenaryConditionGroup(group('and', '0'))).toBe(false);
  });
});

describe('isMercenarySearch', () => {
  it('detects warrant searches by item disc, mercenary groups or mercenary entries', () => {
    expect(isMercenarySearch('mercenary_warrant', [])).toBe(true);
    expect(isMercenarySearch(null, [{ type: 'mercenary', filters: [] }])).toBe(true);
    expect(isMercenarySearch(null, [{ type: 'not', filters: [{ id: 'mercenary.skill_1' }] }])).toBe(
      true,
    );
    expect(isMercenarySearch(null, [{ type: 'and', filters: [{ id: 'explicit.stat_1' }] }])).toBe(
      false,
    );
  });
});

describe('isMercenaryFilterGroup', () => {
  const group = (html: string, type?: string) => {
    const el = document.createElement('div');
    el.className = 'filter-group';
    if (type !== undefined) el.setAttribute('data-poexd-group-type', type);
    el.innerHTML = `<div class="filter-group-body">${html}</div>`;
    return el;
  };

  it('prefers the tagged group type', () => {
    expect(isMercenaryFilterGroup(group('', 'mercenary'))).toBe(true);
    expect(
      isMercenaryFilterGroup(group('<i class="mutate-type mutate-type-mercenary"></i>', 'and')),
    ).toBe(false);
  });

  it('falls back to options that are all mercenary entries', () => {
    expect(isMercenaryFilterGroup(group('<i class="mutate-type mutate-type-mercenary"></i>'))).toBe(
      true,
    );
    expect(
      isMercenaryFilterGroup(
        group(
          '<i class="mutate-type mutate-type-mercenary"></i><i class="mutate-type mutate-type-pseudo"></i>',
        ),
      ),
    ).toBe(false);
    expect(isMercenaryFilterGroup(group(''))).toBe(false);
  });
});
